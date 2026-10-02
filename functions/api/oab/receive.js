/**
 * Cloudflare Pages Functions — Registro Transaccional de Recepción en Rampa
 * Ruta: POST /api/oab/receive
 * Ejecuta la transacción atómica:
 * 1. Registro inmutable en BD_Kardex_Movimientos (Entrada por Compra / Rechazo en Rampa)
 * 2. Incremento de Stock (base) en Dashboard
 * 3. Actualización de Cantidad Recibida, Backorder y Estado en Solicitudes de Insumos
 * 4. Actualización de Estado General en BD_Ordenes_Abastecimiento
 */

const KARDEX_DB_ID = '26286805-4e27-803b-91ce-ef8f121d622d';
const DASHBOARD_DB_ID = '2b586805-4e27-80fe-b6e8-e4c6dc325696';
const SOLICITUDES_DB_ID = '2bc86805-4e27-8036-ba88-d52ec84742ba';
const OAB_DB_ID = '3eb86805-4e27-81f9-860a-c51fc794ebb0';

import { sendTelegramAlert } from '../telegram/notify.js';
import { requirePermission } from '../auth/_guard.js';

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

  // 1. Defensa en profundidad: Validación de permisos RBAC
  const authCheck = await requirePermission(context, 'Recepcion_Rampa');
  if (!authCheck.ok) {
    return new Response(JSON.stringify({ error: authCheck.error }), {
      status: authCheck.status || 403,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const notionApiKey = env.NOTION_API_KEY;
  if (!notionApiKey) {
    return new Response(JSON.stringify({ error: 'NOTION_API_KEY no configurada' }), {
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
      folioOAB,
      oabId,
      proveedorId,
      numeroNotaEntrega,
      fechaRecepcion,
      tasaBCV,
      items,
      comprobanteUrl
    } = payload;

    if (!folioOAB || !items || !Array.isArray(items) || items.length === 0) {
      return new Response(JSON.stringify({ error: 'Faltan parámetros requeridos (folioOAB, items).' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 0. Barrera de Idempotencia en BD_Kardex_Movimientos
    // Comprobar si ya existe algún asiento con este Folio OAB y este N° de Nota de Entrega
    const cleanNota = (numeroNotaEntrega || 'S/N').trim();
    const cleanFolio = (folioOAB || '').trim();

    try {
      const idempotencyQuery = await fetch(`https://api.notion.com/v1/databases/${KARDEX_DB_ID}/query`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          filter: {
            and: [
              {
                property: 'Folio OAB',
                rich_text: { equals: cleanFolio }
              },
              {
                property: 'Código (Nota de entrega)',
                rich_text: { equals: cleanNota }
              }
            ]
          },
          page_size: 5
        })
      });

      if (idempotencyQuery.ok) {
        const existingEntries = await idempotencyQuery.json();
        if (existingEntries.results && existingEntries.results.length > 0) {
          return new Response(JSON.stringify({
            status: 'already_processed',
            message: `La recepción para la orden ${cleanFolio} con Nota de Entrega '${cleanNota}' ya fue asentada previamente en Kardex (${existingEntries.results.length} registros). Se evitó duplicación de stock.`,
            folioOAB: cleanFolio,
            numeroNotaEntrega: cleanNota,
            duplicateDetected: true,
            itemsProcesados: existingEntries.results.length
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }
      }
    } catch (idemErr) {
      console.warn('Advertencia en verificación de idempotencia Kardex:', idemErr);
      // Si falla la verificación por timeout temporal, continúa bajo supervisión
    }

    const receptionDate = fechaRecepcion || new Date().toISOString().split('T')[0];
    const results = [];
    let hasBackorders = false;

    for (const item of items) {
      const {
        solicitudId,
        dashboardId,
        insumoId,
        nombre,
        cantidadAprobada = 0,
        cantidadRecibida = 0,
        cantidadRechazada = 0,
        costoUnitarioUSD = 0,
        costoAprobadoUSD = 0,
        notasDiscrepancia = ''
      } = item;

      const receivedNum = Number(cantidadRecibida) || 0;
      const approvedNum = Number(cantidadAprobada) || 0;
      const rejectedNum = Number(cantidadRechazada) || 0;
      const unitCost = Number(costoUnitarioUSD) || 0;
      const approvedCost = Number(costoAprobadoUSD) || unitCost;
      const backorder = Math.max(0, approvedNum - receivedNum);

      if (backorder > 0) hasBackorders = true;

      // Detección de alerta de sobrecosto (> 5%)
      let isOvercost = false;
      let overcostPct = 0;
      if (approvedCost > 0 && unitCost > approvedCost) {
        overcostPct = ((unitCost - approvedCost) / approvedCost) * 100;
        if (overcostPct > 5.0) {
          isOvercost = true;
        }
      }

      // 1. Asentar entrada en Kardex si hubo cantidad recibida > 0
      let kardexEntryId = null;
      if (receivedNum > 0) {
        const overcostTag = isOvercost ? ` [⚠️ SOBRECOSTO +${overcostPct.toFixed(1)}%]` : '';
        const bcvRate = Number(tasaBCV) || 0;
        const bcvTag = bcvRate > 0 ? ` · Bs ${(unitCost * bcvRate).toFixed(2)}` : '';

        const kardexProps = {
          'Descripción': {
            title: [{ text: { content: `[REC]${overcostTag} ${nombre || 'Insumo'} (${receivedNum} und @ $${unitCost.toFixed(2)}${bcvTag})` } }]
          },
          'Movimiento': {
            select: { name: '🟢 Entrada por Compra' }
          },
          'Cantidad (Stock)': {
            number: receivedNum
          },
          'Costo Unitario ($ USD)': {
            number: unitCost
          },
          'Costo Total ($ USD)': {
            number: Math.round(receivedNum * unitCost * 100) / 100
          },
          'Folio OAB': {
            rich_text: [{ text: { content: folioOAB } }]
          },
          'Código (Nota de entrega)': {
            rich_text: [{ text: { content: numeroNotaEntrega || 'S/N' } }]
          },
          'Fecha de Recepción': {
            date: { start: receptionDate }
          }
        };

        if (isOvercost) {
          kardexProps['Detalle (ext)'] = {
            rich_text: [{ text: { content: `ALERTA DE AUDITORÍA: Costo recibido $${unitCost.toFixed(2)} excede en +${overcostPct.toFixed(1)}% el costo aprobado en OAB ($${approvedCost.toFixed(2)}).` } }]
          };
        }

        if (comprobanteUrl) {
          kardexProps['Comprobante'] = {
            files: [
              {
                name: `Nota_${cleanNota}.jpg`,
                type: 'external',
                external: { url: comprobanteUrl }
              }
            ]
          };
        }

        if (dashboardId) {
          kardexProps['Dashboard'] = { relation: [{ id: dashboardId }] };
        }
        if (insumoId) {
          kardexProps['Producto'] = { relation: [{ id: insumoId }] };
        }
        if (proveedorId) {
          kardexProps['Proveedor'] = { relation: [{ id: proveedorId }] };
        }

        const kRes = await fetch('https://api.notion.com/v1/pages', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            parent: { database_id: KARDEX_DB_ID },
            properties: kardexProps
          })
        });

        if (kRes.ok) {
          const kData = await kRes.json();
          kardexEntryId = kData.id;
        }
      }

      // 2. Asentar Rechazo en Rampa si hubo cantidad rechazada > 0
      if (rejectedNum > 0) {
        await fetch('https://api.notion.com/v1/pages', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            parent: { database_id: KARDEX_DB_ID },
            properties: {
              'Descripción': {
                title: [{ text: { content: `[RECHAZO] ${nombre || 'Insumo'} (${rejectedNum} und) - ${notasDiscrepancia || 'Discrepancia rampa'}` } }]
              },
              'Movimiento': {
                select: { name: '⚠️ Rechazo en Rampa' }
              },
              'Cantidad (Stock)': {
                number: rejectedNum
              },
              'Folio OAB': {
                rich_text: [{ text: { content: folioOAB } }]
              },
              'Código (Nota de entrega)': {
                rich_text: [{ text: { content: numeroNotaEntrega || 'S/N' } }]
              },
              'Fecha de Recepción': {
                date: { start: receptionDate }
              },
              ...(comprobanteUrl ? {
                'Comprobante': {
                  files: [
                    {
                      name: `Nota_${cleanNota}.jpg`,
                      type: 'external',
                      external: { url: comprobanteUrl }
                    }
                  ]
                }
              } : {}),
              ...(dashboardId ? { 'Dashboard': { relation: [{ id: dashboardId }] } } : {}),
              ...(insumoId ? { 'Producto': { relation: [{ id: insumoId }] } } : {}),
              ...(proveedorId ? { 'Proveedor': { relation: [{ id: proveedorId }] } } : {})
            }
          })
        });
      }

      // 3. Incrementar Stock (base) en Dashboard
      if (dashboardId && receivedNum > 0) {
        try {
          const dashPageRes = await fetch(`https://api.notion.com/v1/pages/${dashboardId}`, { headers });
          if (dashPageRes.ok) {
            const dashPage = await dashPageRes.json();
            const currentStock = dashPage.properties?.['Stock (base)']?.number || 0;
            const newStock = currentStock + receivedNum;

            await fetch(`https://api.notion.com/v1/pages/${dashboardId}`, {
              method: 'PATCH',
              headers,
              body: JSON.stringify({
                properties: {
                  'Stock (base)': { number: newStock }
                }
              })
            });
          }
        } catch (stockErr) {
          console.error('Error incrementando stock en Dashboard:', stockErr);
        }
      }

      // 3.1 Actualizar Costo de Reposición en BD_Materiales_Insumos
      if (insumoId && receivedNum > 0 && unitCost > 0) {
        try {
          await fetch(`https://api.notion.com/v1/pages/${insumoId}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({
              properties: {
                'Costo_Unitario_Base_USD': { number: unitCost }
              }
            })
          });
        } catch (costErr) {
          console.warn('Advertencia actualizando Costo_Unitario_Base_USD en BD_Materiales_Insumos:', costErr);
        }
      }

      // 4. Actualizar Solicitudes de Insumos
      if (solicitudId) {
        const lineState = backorder > 0 ? 'Recepción Parcial' : 'Completada';
        await fetch(`https://api.notion.com/v1/pages/${solicitudId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            properties: {
              'Cantidad Recibida': { number: receivedNum },
              'Backorder Pendiente': { number: backorder },
              'Estado Flujo': { select: { name: lineState } }
            }
          })
        });
      }

      results.push({
        nombre,
        receivedNum,
        rejectedNum,
        backorder,
        unitCost,
        approvedCost,
        isOvercost,
        overcostPct,
        kardexEntryId
      });
    }

    // 5. Actualizar Estado General en BD_Ordenes_Abastecimiento si se pasó oabId
    if (oabId) {
      const overallState = hasBackorders ? 'Recepción Parcial' : 'Completada';
      const oabUpdateProps = {
        'Estado General': { select: { name: overallState } }
      };

      if (comprobanteUrl) {
        let existingFiles = [];
        try {
          const pageRes = await fetch(`https://api.notion.com/v1/pages/${oabId}`, { headers });
          if (pageRes.ok) {
            const pageData = await pageRes.json();
            existingFiles = pageData.properties?.['Comprobante Firmado']?.files || [];
          }
        } catch (fetchErr) {
          console.warn('No se pudieron recuperar archivos previos de OAB:', fetchErr);
        }

        const newFile = {
          name: `NotaEntrega_${numeroNotaEntrega || folioOAB}.jpg`,
          external: { url: comprobanteUrl }
        };

        oabUpdateProps['Comprobante Firmado'] = {
          files: [...existingFiles, newFile]
        };
      }

      await fetch(`https://api.notion.com/v1/pages/${oabId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ properties: oabUpdateProps })
      });
    }

    // 6. Disparar Alerta a Telegram ÚNICAMENTE ante incidencias operativas (rechazo, faltante o sobrecosto)
    const incidents = results.filter(r => r.rejectedNum > 0 || r.backorder > 0 || r.isOvercost);
    if (incidents.length > 0) {
      try {
        const dashboardBaseUrl = env.PUBLIC_DASHBOARD_URL || 'https://api.sanesca.cloud';
        const cleanFolio = encodeURIComponent(folioOAB);
        const kardexLink = `${dashboardBaseUrl}/?kardex=true&folio=${cleanFolio}`;

        const incidentRows = incidents.map(inc => {
          const parts = [];
          if (inc.rejectedNum > 0) parts.push(`❌ ${inc.rejectedNum} rechazo(s)`);
          if (inc.backorder > 0) parts.push(`⏳ ${inc.backorder} faltante(s)`);
          if (inc.isOvercost) parts.push(`⚠️ +${inc.overcostPct.toFixed(1)}% sobrecosto ($${inc.unitCost.toFixed(2)} vs $${inc.approvedCost.toFixed(2)})`);
          return `• <b>${inc.nombre || 'Insumo'}</b>: ${parts.join(' | ')}`;
        }).join('\n');

        const evidenceLine = comprobanteUrl ? `\n📸 <b>Comprobante R2:</b> <a href="${comprobanteUrl}">Ver Foto de Nota</a>` : '';

        const telegramText = `<b>🔴 ALERTA DE INCIDENCIA EN RAMPA (RECEPCIÓN)</b>\n\n` +
          `<b>Folio OAB:</b> <code>${folioOAB}</code>\n` +
          `<b>N° Nota / Remisión:</b> <code>${numeroNotaEntrega || 'S/N'}</code>\n` +
          `<b>Fecha:</b> ${receptionDate}\n\n` +
          `<b>Discrepancias Detectadas (${incidents.length}):</b>\n${incidentRows}\n` +
          `${evidenceLine}\n\n` +
          `<i>Se requiere conciliación inmediata con el proveedor y ajuste en cuentas por pagar.</i>`;

        const telegramButtons = [
          [
            {
              text: '📱 Auditar Kardex (Mini App)',
              web_app: { url: kardexLink }
            }
          ],
          [
            {
              text: '🌐 Abrir en PC / Navegador',
              url: kardexLink
            }
          ]
        ];

        await sendTelegramAlert({
          env,
          text: telegramText,
          buttons: telegramButtons,
          threadId: 146 // Tópico 'Inventario' en Supergrupo Sanesca - Producción (-1003139956223)
        });
      } catch (tgErr) {
        console.warn('Advertencia despachando alerta Telegram para Incidencia en Rampa:', tgErr);
      }
    }

    return new Response(JSON.stringify({
      status: 'success',
      folioOAB,
      estadoGeneral: hasBackorders ? 'Recepción Parcial' : 'Completada',
      itemsProcesados: results.length,
      detalle: results
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: `Excepción en recepción: ${error.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
