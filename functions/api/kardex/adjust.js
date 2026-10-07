/**
 * Cloudflare Pages Functions — Módulo Serverless de Conteo Cíclico y Ajustes de Kardex (Fase 9F)
 * Ruta: POST /api/kardex/adjust
 * 
 * Ejecuta la transacción atómica de ajuste de inventario bajo el estándar Odoo 18:
 * 1. Control CORS y cabeceras de seguridad.
 * 2. Defensa en profundidad: Autorización RBAC (Almacén, Auditoría o Superadmin).
 * 3. Idempotencia mediante clave X-Idempotency-Key en Upstash Redis.
 * 4. Verificación de umbral de riesgo: si |Δ| > 5 und o |Impacto| > $5.00 USD, exige rol supervisor o PIN.
 * 5. Asiento inmutable en BD_Kardex_Movimientos (tipo '🟡 Ajuste / Merma', folio ADJ-YYYYMMDD-####).
 * 6. Actualización atómica en BD_Control_Stock_Existencias (Stock base = Conteo Físico, recálculo semáforo).
 *    (Al vincularse en Kardex, el rollup Fecha de Reconteo de Notion resetea automáticamente el ciclo a 0 días).
 * 7. Registro de auditoría forense inmutable en BD_Auditoria_Accesos_Logs.
 * 8. Alerta condicional a Telegram si la merma representa una pérdida > $10.00 USD.
 */

import { requirePermission } from '../auth/_guard.js';
import { recordAuditLog, executeRedis, getVzlaTime } from '../auth/_audit.js';
import { sendTelegramAlert } from '../telegram/notify.js';

const KARDEX_DB_ID = '26286805-4e27-803b-91ce-ef8f121d622d';
const DASHBOARD_DB_ID = '2b586805-4e27-80fe-b6e8-e4c6dc325696';
const SUPERVISOR_PIN_DEFAULT = '1234';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Notion-Version, X-Idempotency-Key',
      },
    });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método no permitido. Use POST.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // 1. Autorización RBAC: Requiere 'Auditoria_Kardex' o 'Superadmin' (Decisión /grill-me)
  const authCheck = await requirePermission(context, 'Auditoria_Kardex');
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
    const payload = await request.json().catch(() => ({}));
    const {
      dashboardId,
      insumoId,
      nombre,
      conteoFisico,
      motivo,
      justificacion = '',
      costoUnitarioUSD = 0,
      costoReferencialUSD = 0,
      tasaBCV = 0,
      unidad = 'Und',
      supervisorPin = null,
      stockTeoricoAlCapturar = null,
      isOfflineSync = false,
      silenceTelegram: rawSilenceTelegram = false
    } = payload;

    const idempotencyKey = request.headers.get('x-idempotency-key') || payload.idempotencyKey;

    // Validación de parámetros mandatorios
    if (!dashboardId || conteoFisico === undefined || conteoFisico === null || isNaN(conteoFisico) || Number(conteoFisico) < 0) {
      return new Response(JSON.stringify({
        error: 'Parámetros inválidos. Se requiere dashboardId y conteoFisico numérico (>= 0).'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    if (!motivo || typeof motivo !== 'string' || !motivo.trim()) {
      return new Response(JSON.stringify({
        error: 'Debe seleccionar un motivo de ajuste válido.'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const cleanJustificacion = String(justificacion || '').trim();
    if (cleanJustificacion.length < 10) {
      return new Response(JSON.stringify({
        error: `Justificación técnica insuficiente (${cleanJustificacion.length}/10 caracteres mín.). Debe explicar el hallazgo.`
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 2. Comprobación de Idempotencia en Redis
    if (idempotencyKey) {
      const cached = await executeRedis(env, 'GET', `kardex:idemp:${idempotencyKey}`);
      if (cached) {
        try {
          const parsedCached = JSON.parse(cached);
          return new Response(JSON.stringify({
            ...parsedCached,
            idempotentReplay: true
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        } catch (_) {}
      }
    }

    // 3. Consultar existencia actual en Notion (BD_Control_Stock_Existencias)
    const dashRes = await fetch(`https://api.notion.com/v1/pages/${dashboardId}`, { headers });
    if (!dashRes.ok) {
      const errTxt = await dashRes.text();
      return new Response(JSON.stringify({ error: `Material no encontrado en almacén: ${errTxt}` }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const dashPage = await dashRes.json();
    const currentStock = dashPage.properties?.['Stock (base)']?.number ?? 0;
    const stockMinimo = dashPage.properties?.['Stock mínimo']?.number ?? 0;
    const itemActualName = dashPage.properties?.['Insumo']?.title?.[0]?.plain_text || nombre || 'Material';

    const physicalCount = Number(conteoFisico);
    const delta = Math.round((physicalCount - currentStock) * 100) / 100;
    const refCost = Number(costoReferencialUSD) || 0;
    const baseUnitCost = Number(costoUnitarioUSD) || 0;
    const unitCost = refCost > 0 ? refCost : baseUnitCost;
    const rateBCV = Number(tasaBCV) || 0;
    const impactoUSD = Math.round(Math.abs(delta) * unitCost * 100) / 100;
    const impactoBs = rateBCV > 0 ? Math.round(impactoUSD * rateBCV * 100) / 100 : 0;

    const permissions = authCheck.user?.permissions || [];
    const isSuperadmin = permissions.includes('Superadmin');
    const isSupervisor = isSuperadmin || (authCheck.user?.puestos || []).some(p => 
      p.toLowerCase().includes('supervisor') || p.toLowerCase().includes('gerente')
    );

    // 4. Gobernanza de Seguridad: Umbral Financiero Puro (> $5.00 USD) acordado en /grill-me
    const esCritico = impactoUSD > 5.00;
    let supervisorAutorizo = null;

    if (esCritico && !isSupervisor) {
      const expectedPin = env.SUPERVISOR_PIN || SUPERVISOR_PIN_DEFAULT;
      const givenPin = String(supervisorPin || '').trim();

      if (!givenPin || givenPin !== expectedPin) {
        return new Response(JSON.stringify({
          error: `Ajuste Crítico no autorizado: El impacto financiero ($${impactoUSD.toFixed(2)} USD) supera el umbral operativo ($5.00 USD). Ingrese el PIN de supervisor para validar.`,
          requiresSupervisorPin: true,
          delta,
          impactoUSD
        }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      supervisorAutorizo = 'Mikel Itriago (PIN de Supervisor Validado)';
    } else if (isSupervisor && esCritico) {
      supervisorAutorizo = `${authCheck.user?.name || 'Supervisor'} (Sesión de Mando)`;
    }

    // Modo Regularización: Solo Superadmin o supervisor autenticado pueden silenciar Telegram
    const isPrivilegedAdmin = isSuperadmin || Boolean(supervisorAutorizo);
    const silenceTelegram = Boolean(rawSilenceTelegram) && isPrivilegedAdmin;

    const { isoVzla, readable } = getVzlaTime();
    const todayStr = isoVzla.split('T')[0];

    // 5. Bifurcación Transaccional según Δ (Odoo 18 Estándar):
    // Si Δ == 0 (Conteo Conforme): NO se crea fila en Kardex para evitar ruido, solo se audita.
    // Si Δ != 0 (Ajuste Físico): Se crea asiento inmutable en BD_Kardex_Movimientos.
    let kardexDataId = null;
    let folioCorrelativo = null;

    if (delta !== 0) {
      const rand4 = Math.floor(1000 + Math.random() * 9000);
      const dateCompact = todayStr.replace(/-/g, '');
      folioCorrelativo = `ADJ-${dateCompact}-${rand4}`;

      const stockDesfasado = stockTeoricoAlCapturar !== null && stockTeoricoAlCapturar !== undefined && Number(stockTeoricoAlCapturar) !== currentStock;
      const tagPrefix = stockDesfasado || isOfflineSync ? '[AJUSTE OFFLINE]' : '[AJUSTE]';
      const glosaTitle = `${tagPrefix} ${itemActualName} (${delta > 0 ? '+' : ''}${delta} ${unidad}) · ${motivo}${stockDesfasado ? ` [Saldo previo: ${stockTeoricoAlCapturar} → Actual: ${currentStock}]` : ''}`;

      const propositoStr = [
        `Motivo: ${motivo}`,
        `Auditor: ${authCheck.user?.name || 'Almacén'}`,
        supervisorAutorizo ? `Autorizó: ${supervisorAutorizo}` : null,
        rateBCV > 0 ? `Tasa BCV: ${rateBCV.toFixed(2)} Bs/$` : null,
        stockDesfasado ? `Conflicto Offline Resuelto (Saldo capturado ${stockTeoricoAlCapturar} vs actual ${currentStock})` : (isOfflineSync ? 'Sincronizado diferido (Offline)' : null)
      ].filter(Boolean).join(' | ');

      const detalleExtStr = [
        `[FOLIO: ${folioCorrelativo}]`,
        `Motivo: ${motivo}`,
        `Justificación: ${cleanJustificacion}`,
        `Stock Teórico: ${currentStock} (Capturado: ${stockTeoricoAlCapturar ?? currentStock}) → Conteo Físico: ${physicalCount}`,
        `Discrepancia: ${delta > 0 ? '+' : ''}${delta} ${unidad}`,
        `Impacto Financiero: $${impactoUSD.toFixed(2)} USD${impactoBs > 0 ? ` (Bs ${impactoBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })})` : ''}`,
        `Auditor: ${authCheck.user?.name || 'Almacén'}${supervisorAutorizo ? ` | Aprobó: ${supervisorAutorizo}` : ''}`,
        isOfflineSync ? 'Origen: Cola Local Offline' : null
      ].filter(Boolean).join(' | ');

      const kardexProps = {
        'Descripción': {
          title: [{ text: { content: glosaTitle } }]
        },
        'Movimiento': {
          select: { name: '🟡 Ajuste / Merma' }
        },
        'Origen de Consumo': {
          select: { name: 'Stock General' }
        },
        'Cantidad (Stock)': {
          number: delta
        },
        'Costo Unitario ($ USD)': {
          number: unitCost
        },
        'Costo Total ($ USD)': {
          number: impactoUSD
        },
        'Código (Nota de entrega)': {
          rich_text: [{ text: { content: folioCorrelativo } }]
        },
        'Fecha de Recepción': {
          date: { start: todayStr }
        },
        'Fecha de Entrega': {
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

      const kData = await kardexRes.json();
      kardexDataId = kData.id;
    }

    // 6. Actualización Atómica en BD_Control_Stock_Existencias (Aplica para Δ = 0 y Δ != 0)
    let nuevoEstadoStockLimpio = 'En Stock';
    let nuevoEstadoStockConEmoji = '🟢 En Stock';
    if (physicalCount === 0) {
      nuevoEstadoStockLimpio = 'Sin Stock';
      nuevoEstadoStockConEmoji = '🔴 Sin Stock';
    } else if (physicalCount < stockMinimo) {
      nuevoEstadoStockLimpio = 'Bajo Mínimo';
      nuevoEstadoStockConEmoji = '🟠 Bajo Mínimo';
    }

    const patchDashRes = await fetch(`https://api.notion.com/v1/pages/${dashboardId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        properties: {
          'Stock (base)': { number: physicalCount },
          'Estado de Stock': { status: { name: nuevoEstadoStockLimpio } }
        }
      })
    });

    if (!patchDashRes.ok) {
      const errTxt = await patchDashRes.text();
      console.error('Alerta crítica: Falló PATCH de stock en Dashboard:', errTxt);
      return new Response(JSON.stringify({
        error: `Error persistiendo saldo en Notion (BD_Control_Stock_Existencias): ${errTxt}`
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 6.0 Sincronización Multi-Dispositivo en Tiempo Real: Saldo en vivo en Redis para SWR
    executeRedis(env, 'HSET', 'inventory:live_stock', dashboardId, JSON.stringify({
      stock: physicalCount,
      estadoStock: nuevoEstadoStockLimpio,
      unitCost: unitCost,
      timestamp: Date.now()
    })).catch(err => {
      console.warn('Advertencia guardando live_stock en Redis:', err);
    });

    // 6.1 Enriquecimiento Condicional de Catálogo Maestro (BD_Catalogo_Insumos) (Fase 9I - Decisión D4)
    const targetInsumoId = insumoId || dashPage.properties?.['Producto']?.relation?.[0]?.id || dashPage.properties?.['Insumos']?.relation?.[0]?.id;
    if (refCost > 0 && targetInsumoId) {
      const enrichCatalogPromise = (async () => {
        try {
          const insumoRes = await fetch(`https://api.notion.com/v1/pages/${targetInsumoId}`, { headers });
          if (insumoRes.ok) {
            const insumoData = await insumoRes.json();
            const currentMasterCost = insumoData.properties?.['Costo_Unitario_Base_USD']?.number || 0;
            if (currentMasterCost <= 0) {
              await fetch(`https://api.notion.com/v1/pages/${targetInsumoId}`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify({
                  properties: {
                    'Costo_Unitario_Base_USD': { number: refCost }
                  }
                })
              });
            }
          }
        } catch (enrichErr) {
          console.warn('Advertencia enriqueciendo costo base en BD_Catalogo_Insumos:', enrichErr);
        }
      })();

      if (context?.waitUntil) {
        context.waitUntil(enrichCatalogPromise);
      } else {
        await enrichCatalogPromise;
      }
    }

    // 7. Registro de Auditoría Forense en BD_Auditoria_Accesos_Logs
    const eventType = delta === 0 ? 'INVENTORY_COUNT_VERIFIED' : 'INVENTORY_ADJUSTMENT';
    const auditDetails = delta === 0
      ? `VERIFICACIÓN CONFORME | ${itemActualName} | Saldo Ratificado: ${physicalCount} ${unidad} | Auditor: ${authCheck.user?.name || 'Almacén'} | Obs: ${cleanJustificacion}`
      : `${folioCorrelativo} | ${itemActualName} | Δ: ${delta > 0 ? '+' : ''}${delta} ${unidad} | Saldo: ${currentStock} ➔ ${physicalCount} | Impacto: $${impactoUSD.toFixed(2)} USD | Motivo: ${motivo} | Justif: ${cleanJustificacion}${supervisorAutorizo ? ` | Aprobó: ${supervisorAutorizo}` : ''}${silenceTelegram ? ' | 🔕 MODO_REGULARIZACION' : ''}`;

    recordAuditLog({
      env,
      context,
      request,
      eventType,
      employeeId: authCheck.user?.sub,
      employeeName: authCheck.user?.name,
      puesto: authCheck.user?.puestos?.[0] || 'Almacenista',
      area: 'Almacén / Control Físico',
      isSuccess: true,
      details: auditDetails,
      alertSecurity: esCritico
    });

    // 8. Notificación Push en Telegram ante Pérdida Crítica (Δ < 0 e Impacto >= $10.00 USD)
    // Silenciable por Superadmin durante tareas de regularización / carga masiva
    if (!silenceTelegram && delta < 0 && impactoUSD >= 10.00) {
      // Congelar snapshot financiero en Redis por 7 días para auditoría confidencial privada
      const costSnapshot = {
        folio: folioCorrelativo,
        itemNombre: itemActualName,
        delta,
        unidad,
        unitCost,
        impactoUSD,
        impactoBs,
        currentStock,
        physicalCount,
        motivo,
        justificacion: cleanJustificacion,
        auditor: authCheck.user?.name || 'Almacén',
        supervisor: supervisorAutorizo || 'N/A',
        timestamp: isoVzla
      };

      executeRedis(env, 'SETEX', `telegram:adj_cost:${folioCorrelativo}`, 604800, JSON.stringify(costSnapshot)).catch(err => {
        console.warn('Advertencia guardando snapshot de costo en Redis:', err);
      });

      // Mensaje sanitizado para el grupo de producción (Sin cifras monetarias en chat público)
      const alertMsg = [
        `⚠️ <b>ALERTA DE DESCUADRE FÍSICO EN ALMACÉN</b>`,
        `📦 <b>Material:</b> ${itemActualName}`,
        `📉 <b>Pérdida / Faltante Físico:</b> ${delta} ${unidad}`,
        `📊 <b>Stock Teórico:</b> ${currentStock} → <b>Conteo Físico:</b> ${physicalCount} ${unidad}`,
        `🏷️ <b>Motivo:</b> ${motivo}`,
        `📝 <b>Justificación:</b> ${cleanJustificacion}`,
        `👤 <b>Auditor:</b> ${authCheck.user?.name || 'Almacén'}`,
        supervisorAutorizo ? `🔑 <b>Autorización:</b> ${supervisorAutorizo}` : null,
        `🔖 <b>Folio Kardex:</b> <code>${folioCorrelativo}</code>`,
        `⏱️ <b>Fecha/Hora:</b> ${readable}`
      ].filter(Boolean).join('\n');

      const buttons = [
        [
          {
            text: '🔒 Consultar Costo Financiero (Mando)',
            callback_data: `cost_audit:${folioCorrelativo}`
          }
        ]
      ];

      // Enrutar al Tópico 146 (Inventario) con botón interactivo de popup privado
      sendTelegramAlert({ env, text: alertMsg, buttons, threadId: 146 }).catch(e => {
        console.warn('Advertencia despachando alerta Telegram de ajuste:', e);
      });
    }

    const successResponse = {
      status: 'success',
      message: delta === 0
        ? `Conteo físico de '${itemActualName}' ratificado conforme (${physicalCount} ${unidad}). Existencias confirmadas sin discrepancia.`
        : `Ajuste de inventario procesado con éxito (${delta > 0 ? '+' : ''}${delta} ${unidad}). Folio ${folioCorrelativo}.`,
      folio: folioCorrelativo,
      kardexId: kardexDataId,
      dashboardId,
      insumoId: targetInsumoId || insumoId,
      itemNombre: itemActualName,
      previousStock: currentStock,
      newStock: physicalCount,
      delta,
      impactoUSD,
      impactoBs,
      unitCost,
      newCost: unitCost,
      telegramSilenced: silenceTelegram,
      nuevoEstadoStock: nuevoEstadoStockConEmoji,
      timestamp: isoVzla
    };

    // Guardar en caché de idempotencia por 24 horas si venía clave
    if (idempotencyKey) {
      executeRedis(env, 'SETEX', `kardex:idemp:${idempotencyKey}`, 86400, JSON.stringify(successResponse)).catch(() => {});
    }

    return new Response(JSON.stringify(successResponse), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    return new Response(JSON.stringify({
      error: `Excepción interna procesando ajuste de inventario: ${error.message}`
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
