/**
 * Cloudflare Pages Functions — Terminal Transaccional de Despacho a Taller
 * Ruta: POST /api/kardex/dispatch
 * 
 * Ejecuta la transacción atómica de salida física de almacén:
 * 1. Validación de permisos RBAC ('Despacho_Taller' o 'Superadmin')
 * 2. Comprobación de existencia y suficiencia de stock físico en BD_Control_Stock_Existencias
 * 3. Asiento inmutable '🔴 Salida a Producción' en BD_Kardex_Movimientos con trazabilidad en 3 niveles:
 *    - Nivel 1: Consumo General (MTS / Taller General)
 *    - Nivel 2: Cruce de Tienda / Proyecto (MTO / Presupuestado vs No Presupuestado)
 *    - Nivel 3: Mobiliario Específico (Líneas de Pedido / BOM)
 * 4. Decremento atómico del campo 'Stock (base)' en BD_Control_Stock_Existencias
 * 5. Notificación operativa al canal de Telegram de Planta
 */

import { requirePermission } from '../auth/_guard.js';
import { executeRedis } from '../auth/_audit.js';
import { sendTelegramAlert } from '../telegram/notify.js';

const KARDEX_DB_ID = '26286805-4e27-803b-91ce-ef8f121d622d';
const DASHBOARD_DB_ID = '2b586805-4e27-80fe-b6e8-e4c6dc325696';

// Flags operativas de Telegram (Temporalmente inactivas según directriz de planta)
const ENABLE_ROUTINE_DISPATCH_ALERTS = false;
const ENABLE_BOM_OVERCONSUMPTION_ALERTS = false;

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
      fechaDespacho
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

    // 3. Determinar Glosa y Clasificación Canónica del Movimiento según Nivel de Imputación
    let destinoLabel = '';
    let origenConsumo = 'Stock General';

    if (nivelImputacion === 'MOBILIARIO' && (mobiliarioNombre || pedidoCodigo)) {
      destinoLabel = `${proyectoNombre || pedidoCodigo || 'Obra'} / ${mobiliarioNombre || 'Mobiliario'}`;
      origenConsumo = esNoPresupuestado ? 'Proyecto (No Presupuestado)' : 'Proyecto (Presupuestado)';
    } else if (nivelImputacion === 'TIENDA' && (proyectoNombre || pedidoCodigo)) {
      const tagExtra = esNoPresupuestado ? ' [NO PRESUPUESTADO / CRUCE]' : '';
      destinoLabel = `${proyectoNombre || pedidoCodigo || 'Obra'}${tagExtra}`;
      origenConsumo = esNoPresupuestado ? 'Proyecto (No Presupuestado)' : 'Proyecto (Presupuestado)';
    } else {
      destinoLabel = `Taller General (${areaDestino})`;
      origenConsumo = 'Stock General';
    }

    const orderTag = pedidoId ? `[ORDER_UUID:${pedidoId}] ` : '';
    const empaqueTag = payload.empaqueComercialInfo ? ` | Empaque: ${payload.empaqueComercialInfo}` : '';
    const sobreconsumoTag = payload.sobreconsumoFlag ? ` | ⚠️ SOBRECONSUMO BOM: ${payload.porcentajeDemanda || '>115%'}` : '';
    const detalleExtStr = `${orderTag}Nivel: ${nivelImputacion} | Pedido: ${pedidoCodigo || 'N/A'} | Proyecto: ${proyectoNombre || 'N/A'}${mobiliarioNombre ? ' | Mobiliario: ' + mobiliarioNombre : ''}${empaqueTag}${sobreconsumoTag} | Despachador: ${authCheck.user?.name || 'Almacén'}`;

    const glosaTitle = `Salida a Taller: ${itemActualName} (-${qty} ${unidad}) → ${destinoLabel}`;
    const propositoParts = [
      motivoSalida,
      `Receptor: ${operarioReceptor}`,
      notas ? `Notas: ${notas}` : null,
      payload.sobreconsumoFlag ? `[⚠️ SOBRECONSUMO BOM: ${payload.porcentajeDemanda || '>115%'}]` : null
    ].filter(Boolean);
    const propositoStr = propositoParts.join(' | ');

    // 4. Crear Asiento Inmutable en BD_Kardex_Movimientos
    const kardexProps = {
      'Descripción': {
        title: [{ text: { content: glosaTitle } }]
      },
      'Movimiento': {
        select: { name: '🔴 Salida a Producción' }
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

    // 5. Decremento Atómico en BD_Control_Stock_Existencias (Dashboard)
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
      executeRedis(env, 'HSET', 'inventory:live_stock', dashboardId, JSON.stringify({
        stock: newStock,
        timestamp: Date.now()
      })).catch(e => console.warn('Advertencia actualizando live_stock en Redis:', e));
    }

    // 6. Notificación Operativa en Telegram (Inactiva temporalmente según gobernanza)
    const isSobreconsumo = Boolean(payload.sobreconsumoFlag);
    const shouldSendTelegram = (isSobreconsumo && ENABLE_BOM_OVERCONSUMPTION_ALERTS) ||
                               (!isSobreconsumo && ENABLE_ROUTINE_DISPATCH_ALERTS);

    if (shouldSendTelegram) {
      const telegramMessage = [
        `📤 <b>DESPACHO A PRODUCCIÓN / TALLER</b>`,
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
      message: `Salida de ${qty} ${unidad} de '${itemActualName}' procesada con éxito.`,
      kardexId: kardexData.id,
      previousStock: currentStock,
      newStock,
      cantidadDespachada: qty,
      nivelImputacion,
      destinoLabel,
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
