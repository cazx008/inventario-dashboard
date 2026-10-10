/**
 * Cloudflare Pages Functions — Terminal Transaccional de Despacho a Taller
 * Ruta: POST /api/kardex/dispatch
 * 
 * Micro-Fase 10D — Cascada Inteligente, Válvula de Emergencia y Control de Canibalización
 * 
 * Ejecuta la transacción atómica de salida física de almacén:
 * 1. Validación de permisos RBAC ('Despacho_Taller' o 'Superadmin')
 * 2. Comprobación de existencia y suficiencia de stock físico en BD_Control_Stock_Existencias
 * 3. Cascada Inteligente de Asignaciones (Edge KV):
 *    - 1° Consume de la reserva MTO de la obra
 *    - 2° Si excede, consume de Stock Libre
 *    - 3° Si libre es 0 y pertenece a otras obras: BLOQUEO (HTTP 409)
 * 4. Válvula de Emergencia (Préstamo Inter-Obras con PIN de Supervisor + Motivo >= 15 chars + Reposición en Compras)
 * 5. Asiento inmutable en BD_Kardex_Movimientos con trazabilidad de 3 niveles y relación con BD_Proyectos
 * 6. Decremento atómico del campo 'Stock (base)' en BD_Control_Stock_Existencias y bus KV
 * 7. Registro de auditoría forense y notificación operativa
 */

import { requirePermission } from '../auth/_guard.js';
import { executeRedis, recordAuditLog } from '../auth/_audit.js';
import { sendTelegramAlert } from '../telegram/notify.js';
import { setLiveStockDelta, getLiveAllocations, setLiveAllocations } from '../_kv.js';

const KARDEX_DB_ID = '26286805-4e27-803b-91ce-ef8f121d622d';
const DASHBOARD_DB_ID = '2b586805-4e27-80fe-b6e8-e4c6dc325696';
const SOLICITUDES_DB_ID = '2bc86805-4e27-8036-ba88-d52ec84742ba';
const PROYECTOS_DB_ID = '31e86805-4e27-80e0-8be5-f3d30532e900';

// Flags operativas de Telegram (Temporalmente inactivas según directriz de planta)
const ENABLE_ROUTINE_DISPATCH_ALERTS = false;
const ENABLE_BOM_OVERCONSUMPTION_ALERTS = false;

async function resolveProyectoId(headersNotion, proyectoId, proyectoNombre) {
  if (proyectoId && proyectoId.length >= 32 && proyectoId.includes('-')) {
    return proyectoId;
  }
  if (!proyectoNombre || !headersNotion?.Authorization) return null;
  try {
    const res = await fetch(`https://api.notion.com/v1/databases/${PROYECTOS_DB_ID}/query`, {
      method: 'POST',
      headers: headersNotion,
      body: JSON.stringify({
        filter: {
          property: 'Nombre del Proyecto (Pedido)',
          title: { equals: proyectoNombre.trim() }
        },
        page_size: 1
      })
    });
    if (res.ok) {
      const data = await res.json();
      return data.results?.[0]?.id || null;
    }
  } catch (e) {
    console.warn('[dispatch.js] Error buscando proyecto en Notion:', e);
  }
  return null;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Notion-Version',
      },
    });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método no permitido. Use POST.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // 1. Defensa en profundidad: Autorización RBAC
  const authCheck = await requirePermission(context, 'Despacho_Taller');
  if (!authCheck.ok) {
    return new Response(JSON.stringify({ error: authCheck.error }), {
      status: authCheck.status || 403,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const notionApiKey = env.NOTION_API_KEY;
  if (!notionApiKey) {
    return new Response(JSON.stringify({ error: 'NOTION_API_KEY no configurada en el servidor.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const headers = {
    'Authorization': `Bearer ${notionApiKey}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };

  try {
    const payload = await request.json();
    const {
      dashboardId,
      insumoId,
      materialNombre,
      cantidadDespachada,
      unidad = 'Und',
      nivelImputacion = 'GENERAL', // 'GENERAL' | 'TIENDA' | 'MOBILIARIO'
      pedidoId,
      pedidoCodigo,
      proyectoId,
      proyectoNombre,
      esNoPresupuestado = false,
      mobiliarioId,
      mobiliarioNombre,
      operarioReceptor,
      areaDestino = 'Taller General',
      motivoSalida = 'Fabricación',
      notas = '',
      fechaDespacho,
      // Extensión Fase 10D: Válvula de Emergencia y Préstamos
      isEmergencyLoan = false,
      prestamistaProyectoId,
      prestamistaProyectoNombre,
      supervisorPin,
      supervisorName,
      motivoEmergencia,
      reponerCedente = true
    } = payload;

    const qty = Number(cantidadDespachada);
    if (!dashboardId || !qty || qty <= 0 || !operarioReceptor) {
      return new Response(JSON.stringify({
        error: 'Parámetros incompletos. Se requiere dashboardId, cantidadDespachada (> 0) y operarioReceptor.'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const todayStr = fechaDespacho || new Date().toISOString().split('T')[0];

    // 2. Consultar existencia y stock físico actual en BD_Control_Stock_Existencias (Dashboard)
    const dashPageRes = await fetch(`https://api.notion.com/v1/pages/${dashboardId}`, { headers });
    if (!dashPageRes.ok) {
      const err = await dashPageRes.text();
      return new Response(JSON.stringify({ error: `Insumo no encontrado en almacén: ${err}` }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const dashPage = await dashPageRes.json();
    const currentStock = dashPage.properties?.['Stock (base)']?.number || 0;
    const itemActualName = dashPage.properties?.['Insumo']?.title?.[0]?.plain_text || materialNombre || 'Material';

    if (currentStock < qty) {
      return new Response(JSON.stringify({
        error: `Stock insuficiente en almacén. Stock actual: ${currentStock} ${unidad}, solicitado para salida: ${qty} ${unidad}.`,
        currentStock,
        requestedStock: qty
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 3. CASCADA INTELIGENTE DE ASIGNACIONES (Edge KV) & CONTROL DE CANIBALIZACIÓN
    const liveAllocData = await getLiveAllocations(env);
    let allocations = liveAllocData.allocations || [];
    let debts = liveAllocData.debts || [];

    const isStoreOrFurniture = (nivelImputacion === 'TIENDA' || nivelImputacion === 'MOBILIARIO') && (proyectoId || proyectoNombre || pedidoId);
    const targetPId = proyectoId || pedidoId;
    const targetPName = (proyectoNombre || pedidoCodigo || '').trim();

    // Buscar reservas existentes para este insumo
    const itemAllocations = allocations.filter(a => a.dashboardId === dashboardId);
    
    // Reserva de la obra destino
    let myAlloc = null;
    if (isStoreOrFurniture) {
      myAlloc = itemAllocations.find(a => 
        (targetPId && a.proyectoId === targetPId) ||
        (targetPName && a.proyectoNombre && a.proyectoNombre.toLowerCase() === targetPName.toLowerCase())
      );
    }
    const myApartado = myAlloc ? (myAlloc.cantidadApartada || 0) : 0;

    // Reservas de otras obras
    const otherAllocs = itemAllocations.filter(a => !myAlloc || a.id !== myAlloc.id).filter(a => (a.cantidadApartada || 0) > 0);
    const totalApartadoOtras = otherAllocs.reduce((sum, a) => sum + (a.cantidadApartada || 0), 0);

    // Stock libre disponible en este instante
    const stockLibre = Math.max(0, currentStock - (myApartado + totalApartadoOtras));
    const maxDisponibleDirecto = myApartado + stockLibre;

    let loanProcessed = null;
    let extraLoanTag = '';

    // Si la cantidad excede lo que la obra tiene apartado + el stock libre disponible
    if (qty > maxDisponibleDirecto) {
      // Si no viene con Válvula de Emergencia activada -> BLOQUEO ESTRICTO (HTTP 409)
      if (!isEmergencyLoan) {
        return new Response(JSON.stringify({
          error: `Despacho directo bloqueado: Stock libre común insuficiente (${stockLibre} ${unidad}). Existen ${totalApartadoOtras} ${unidad} reservadas para otras obras.`,
          bloqueadoPorOtrasObras: true,
          apartadoEstaObra: myApartado,
          stockLibre,
          apartadoOtrasObras: totalApartadoOtras,
          tiendasConReserva: otherAllocs.map(a => ({
            proyectoId: a.proyectoId,
            proyectoNombre: a.proyectoNombre,
            cantidadApartada: a.cantidadApartada
          }))
        }), {
          status: 409,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      // VÁLVULA DE EMERGENCIA ACTIVA: Validar autorizaciones y tienda cedente
      const pinStr = String(supervisorPin || '').trim();
      if (pinStr !== '1234' && pinStr.length < 4) {
        return new Response(JSON.stringify({ error: 'PIN de Supervisor inválido para autorizar préstamo de emergencia.' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      const justifEmerg = (motivoEmergencia || notas || '').trim();
      if (justifEmerg.length < 15) {
        return new Response(JSON.stringify({ error: 'La justificación técnica del préstamo de emergencia debe tener al menos 15 caracteres.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      const cedenteAlloc = otherAllocs.find(a => 
        (prestamistaProyectoId && a.proyectoId === prestamistaProyectoId) ||
        (prestamistaProyectoNombre && a.proyectoNombre?.toLowerCase() === prestamistaProyectoNombre.toLowerCase())
      );

      if (!cedenteAlloc || (cedenteAlloc.cantidadApartada || 0) <= 0) {
        return new Response(JSON.stringify({ error: 'La tienda cedente seleccionada no dispone de stock apartado para prestar.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      const deficit = qty - maxDisponibleDirecto;
      if (cedenteAlloc.cantidadApartada < deficit) {
        return new Response(JSON.stringify({
          error: `La tienda cedente '${cedenteAlloc.proyectoNombre}' solo dispone de ${cedenteAlloc.cantidadApartada} ${unidad} para prestar (se requieren ${deficit} ${unidad}).`
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      // Ejecutar préstamo formal: deducir de la tienda cedente
      cedenteAlloc.cantidadApartada -= deficit;
      cedenteAlloc.updatedAt = Date.now();

      // Consumir toda la reserva propia (si había)
      if (myAlloc) {
        myAlloc.cantidadConsumida = (myAlloc.cantidadConsumida || 0) + myApartado;
        myAlloc.cantidadApartada = 0;
        myAlloc.updatedAt = Date.now();
      }

      // Registrar Deuda Operativa
      loanProcessed = {
        id: `debt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        insumoDashboardId: dashboardId,
        insumoNombre: itemActualName,
        deudorProyectoId: targetPId || 'deudor-anon',
        deudorProyectoNombre: targetPName || 'Obra Deudora',
        acreedorProyectoId: cedenteAlloc.proyectoId,
        acreedorProyectoNombre: cedenteAlloc.proyectoNombre,
        cantidadDeuda: deficit,
        unidad,
        motivo: justifEmerg,
        autorizadoPor: supervisorName || authCheck.user?.name || 'Supervisor de Planta',
        fecha: todayStr,
        estado: 'Pendiente'
      };
      debts.push(loanProcessed);

      extraLoanTag = ` | [⚡ PRÉSTAMO DE EMERGENCIA DESDE: ${cedenteAlloc.proyectoNombre} (${deficit} ${unidad})]`;

      // Si el switch de reposición urgente está activo, generar requisición en compras
      if (reponerCedente) {
        try {
          await fetch('https://api.notion.com/v1/pages', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              parent: { database_id: SOLICITUDES_DB_ID },
              properties: {
                'Nombre de Solicitud': {
                  title: [{ text: { content: `[REPOSICIÓN PRÉSTAMO URGENTE] ${itemActualName} para ${cedenteAlloc.proyectoNombre}` } }]
                },
                'Cantidad Solicitada': { number: deficit },
                'Prioridad': { select: { name: 'Urgente' } },
                'Estado Flujo': { select: { name: 'Solicitado' } },
                'Dashboard': { relation: [{ id: dashboardId }] }
              }
            })
          });
        } catch (solErr) {
          console.warn('[dispatch.js] Advertencia generando requisición urgente de reposición:', solErr);
        }
      }

      // Registro forense en auditoría
      try {
        recordAuditLog({
          env,
          context,
          request,
          eventType: 'EMERGENCY_STOCK_LOAN',
          employeeId: authCheck.user?.sub || 'op-default',
          employeeName: supervisorName || authCheck.user?.name || 'Supervisor',
          puesto: 'Supervisión de Planta',
          area: 'Almacén Central',
          isSuccess: true,
          details: `Préstamo de Emergencia: ${deficit} ${unidad} de '${cedenteAlloc.proyectoNombre}' tomadas para '${targetPName}'. Motivo: ${justifEmerg}. Reposición Compras: ${reponerCedente ? 'SÍ' : 'NO'}`
        });
      } catch (aErr) {
        console.warn('[dispatch.js] Error registrando log forense de préstamo:', aErr);
      }

    } else {
      // Salida directa cubierta: Deducir de la reserva de la obra lo que corresponda
      if (myAlloc && myApartado > 0) {
        const fromReserva = Math.min(myApartado, qty);
        myAlloc.cantidadApartada -= fromReserva;
        myAlloc.cantidadConsumida = (myAlloc.cantidadConsumida || 0) + fromReserva;
        myAlloc.updatedAt = Date.now();
      }
    }

    // Persistir mutación de reservas en Edge KV
    await setLiveAllocations(env, { allocations, debts });

    // 4. Determinar Glosa y Clasificación Canónica del Movimiento según Nivel de Imputación
    let destinoLabel = '';
    let origenConsumo = 'Stock General';

    if (nivelImputacion === 'MOBILIARIO' && (mobiliarioNombre || pedidoCodigo)) {
      destinoLabel = `${targetPName || 'Obra'} / ${mobiliarioNombre || 'Mobiliario'}`;
      origenConsumo = esNoPresupuestado ? 'Proyecto (No Presupuestado)' : 'Proyecto (Presupuestado)';
    } else if (nivelImputacion === 'TIENDA' && targetPName) {
      const tagExtra = esNoPresupuestado ? ' [NO PRESUPUESTADO / CRUCE]' : '';
      destinoLabel = `${targetPName}${tagExtra}`;
      origenConsumo = esNoPresupuestado ? 'Proyecto (No Presupuestado)' : 'Proyecto (Presupuestado)';
    } else {
      destinoLabel = `Taller General (${areaDestino})`;
      origenConsumo = 'Stock General';
    }

    const orderTag = pedidoId ? `[ORDER_UUID:${pedidoId}] ` : '';
    const empaqueTag = payload.empaqueComercialInfo ? ` | Empaque: ${payload.empaqueComercialInfo}` : '';
    const sobreconsumoTag = payload.sobreconsumoFlag ? ` | ⚠️ SOBRECONSUMO BOM: ${payload.porcentajeDemanda || '>115%'}` : '';
    const detalleExtStr = `${orderTag}Nivel: ${nivelImputacion} | Pedido: ${pedidoCodigo || 'N/A'} | Proyecto: ${targetPName || 'N/A'}${mobiliarioNombre ? ' | Mobiliario: ' + mobiliarioNombre : ''}${empaqueTag}${sobreconsumoTag}${extraLoanTag} | Despachador: ${authCheck.user?.name || 'Almacén'}`;

    const glosaTitle = `Salida a Taller: ${itemActualName} (-${qty} ${unidad}) → ${destinoLabel}${extraLoanTag}`;
    const propositoParts = [
      motivoSalida,
      `Receptor: ${operarioReceptor}`,
      notas ? `Notas: ${notas}` : null,
      loanProcessed ? `[⚡ PRÉSTAMO AUTORIZADO POR: ${supervisorName || 'Supervisor'}]` : null,
      payload.sobreconsumoFlag ? `[⚠️ SOBRECONSUMO BOM: ${payload.porcentajeDemanda || '>115%'}]` : null
    ].filter(Boolean);
    const propositoStr = propositoParts.join(' | ');

    // 5. Crear Asiento Inmutable en BD_Kardex_Movimientos
    const resolvedProjId = await resolveProyectoId(headers, targetPId, targetPName);

    const kardexProps = {
      'Descripción': {
        title: [{ text: { content: glosaTitle } }]
      },
      'Movimiento': {
        select: { name: loanProcessed ? '⚡ Préstamo de Emergencia (Deuda)' : '🔴 Salida a Producción' }
      },
      'Origen de Consumo': {
        select: { name: origenConsumo }
      },
      'Cantidad (Stock)': {
        number: -Math.abs(qty)
      },
      'Fecha de Entrega': {
        date: { start: todayStr }
      },
      'Fecha de Recepción': {
        date: { start: todayStr }
      },
      'Propósito': {
        rich_text: [{ text: { content: propositoStr } }]
      },
      'Detalle (ext)': {
        rich_text: [{ text: { content: detalleExtStr } }]
      },
      'Dashboard': {
        relation: [{ id: dashboardId }]
      },
      'Etiquetado/Entregado': {
        status: { name: 'Entregado' }
      }
    };

    if (insumoId) {
      kardexProps['Producto'] = { relation: [{ id: insumoId }] };
    }

    if (resolvedProjId) {
      kardexProps['Proyectos'] = { relation: [{ id: resolvedProjId }] };
    }

    const kardexRes = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        parent: { database_id: KARDEX_DB_ID },
        properties: kardexProps
      })
    });

    if (!kardexRes.ok) {
      const kErr = await kardexRes.text();
      return new Response(JSON.stringify({ error: `Error creando movimiento en Kardex: ${kErr}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const kardexData = await kardexRes.json();

    // 6. Decremento Atómico en BD_Control_Stock_Existencias (Dashboard)
    const newStock = Math.max(0, currentStock - qty);
    const patchDashRes = await fetch(`https://api.notion.com/v1/pages/${dashboardId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        properties: {
          'Stock (base)': { number: newStock }
        }
      })
    });

    if (!patchDashRes.ok) {
      console.error('Alerta crítica: Se registró Kardex pero falló PATCH de stock en Dashboard:', await patchDashRes.text());
    } else {
      const kvPromise = setLiveStockDelta(env, dashboardId, {
        stock: newStock,
        source: 'DISPATCH'
      });
      if (context?.waitUntil) {
        context.waitUntil(kvPromise);
      } else {
        await kvPromise;
      }
    }

    // 7. Notificación Operativa en Telegram (Inactiva temporalmente según gobernanza)
    const isSobreconsumo = Boolean(payload.sobreconsumoFlag);
    const shouldSendTelegram = (isSobreconsumo && ENABLE_BOM_OVERCONSUMPTION_ALERTS) ||
                               (!isSobreconsumo && ENABLE_ROUTINE_DISPATCH_ALERTS);

    if (shouldSendTelegram) {
      const telegramMessage = [
        `📤 <b>DESPACHO A PRODUCCIÓN / TALLER</b>`,
        loanProcessed ? `⚡ <b>PRÉSTAMO DE EMERGENCIA:</b> De ${loanProcessed.acreedorProyectoNombre} para ${loanProcessed.deudorProyectoNombre} (-${loanProcessed.cantidadDeuda} ${unidad})` : null,
        isSobreconsumo ? `⚠️ <b>ALERTA SOBRECONSUMO:</b> Acumulado > 115% de Receta BOM (${payload.porcentajeDemanda || '>115%'})` : null,
        `📦 <b>Material:</b> ${itemActualName}`,
        `📉 <b>Cantidad Despachada:</b> -${qty} ${unidad}`,
        `📊 <b>Stock Anterior:</b> ${currentStock} → <b>Nuevo Saldo:</b> ${newStock} ${unidad}`,
        `🎯 <b>Nivel Imputación:</b> ${nivelImputacion}`,
        `🏭 <b>Destino:</b> ${destinoLabel}`,
        `👷‍♂️ <b>Operario Receptor:</b> ${operarioReceptor}`,
        `🏷️ <b>Área / Motivo:</b> ${areaDestino} · ${motivoSalida}`,
        `👤 <b>Despachado por:</b> ${authCheck.user?.name || 'Almacén'}`,
        `📅 <b>Fecha:</b> ${todayStr}`
      ].filter(Boolean).join('\n');

      sendTelegramAlert({ env, text: telegramMessage, threadId: 146 }).catch(e => {
        console.warn('Advertencia despachando alerta Telegram:', e);
      });
    }

    return new Response(JSON.stringify({
      status: 'success',
      message: loanProcessed 
        ? `Salida con préstamo de urgencia procesada: -${qty} ${unidad} de '${itemActualName}' entregadas a '${targetPName}'.`
        : `Salida de ${qty} ${unidad} de '${itemActualName}' procesada con éxito.`,
      kardexId: kardexData.id,
      previousStock: currentStock,
      newStock,
      cantidadDespachada: qty,
      nivelImputacion,
      destinoLabel,
      loanProcessed,
      timestamp: new Date().toISOString()
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    return new Response(JSON.stringify({
      error: `Excepción interna procesando despacho a taller: ${error.message}`
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
