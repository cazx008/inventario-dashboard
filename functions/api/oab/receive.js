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
import { setLiveStockDelta, getLiveAllocations, setLiveAllocations } from '../_kv.js';

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
      comprobanteUrl,
      numeroFacturaFiscal,
      numeroControlFiscal,
      fotoPendienteSync
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
    const receptionDate = fechaRecepcion || new Date().toISOString().split('T')[0];

    try {
      const idempotencyFilters = [
        {
          property: 'Folio OAB',
          rich_text: { equals: cleanFolio }
        },
        {
          property: 'Código (Nota de entrega)',
          rich_text: { equals: cleanNota }
        }
      ];

      // Si la nota es 'S/N' (sin guía formal), requerir además coincidencia de fecha
      // para no bloquear recepciones sucesivas sin nota en días distintos
      if (cleanNota.toUpperCase() === 'S/N') {
        idempotencyFilters.push({
          property: 'Fecha de Recepción',
          date: { equals: receptionDate }
        });
      }

      const idempotencyQuery = await fetch(`https://api.notion.com/v1/databases/${KARDEX_DB_ID}/query`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          filter: {
            and: idempotencyFilters
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

    const results = [];
    let hasBackorders = false;
    const processedSolicitudIds = new Set();

    // 0.1 Consulta Global de Líneas de la OAB en Notion para Reconciliación Integral de Saldos
    const oabLinesById = new Map();
    let allOABLines = [];
    if (oabId) {
      try {
        const oabLinesRes = await fetch(`https://api.notion.com/v1/databases/${SOLICITUDES_DB_ID}/query`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            filter: {
              property: 'Orden de Abastecimiento',
              relation: { contains: oabId }
            },
            page_size: 100
          })
        });
        if (oabLinesRes.ok) {
          const oabLinesData = await oabLinesRes.json();
          allOABLines = oabLinesData.results || [];
          for (const line of allOABLines) {
            oabLinesById.set(line.id, line);
          }
        }
      } catch (errLines) {
        console.warn('Advertencia consultando líneas completas de OAB en Notion:', errLines);
      }
    }

    for (const item of items) {
      const {
        solicitudId,
        dashboardId,
        insumoId,
        nombre,
        cantidadAprobada = 0,
        cantidadRecibida = 0,
        cantidadRecibidaHoy = null,
        cantidadRecibidaPrevia = null,
        cantidadRechazada = 0,
        costoUnitarioUSD = 0,
        costoAprobadoUSD = 0,
        notasDiscrepancia = '',
        proyectoId = null,
        proyectoNombre = null
      } = item;

      if (solicitudId) {
        processedSolicitudIds.add(solicitudId);
      }

      // Resolver Proyecto MTO desde payload o desde la línea de Notion
      const notionLine = solicitudId ? oabLinesById.get(solicitudId) : null;
      const resolvedProyectoNombre = proyectoNombre ||
        notionLine?.properties?.['Proyecto (Texto)']?.rich_text?.[0]?.plain_text ||
        notionLine?.properties?.['Proyecto']?.title?.[0]?.plain_text ||
        null;
      const resolvedProyectoId = proyectoId ||
        notionLine?.properties?.['Proyecto']?.relation?.[0]?.id ||
        null;

      // Delta físico que baja hoy del camión
      const receivedNum = Number(cantidadRecibidaHoy !== null ? cantidadRecibidaHoy : cantidadRecibida) || 0;
      const rejectedNum = Number(cantidadRechazada) || 0;
      const unitCost = Number(costoUnitarioUSD) || 0;
      const approvedCost = Number(costoAprobadoUSD) || unitCost;

      // Cantidad recibida en fletes anteriores y cantidad total aprobada desde Notion o payload
      const prevReceived = notionLine
        ? (notionLine.properties?.['Cantidad Recibida']?.number || 0)
        : (Number(cantidadRecibidaPrevia) || 0);

      const approvedNum = notionLine
        ? (notionLine.properties?.['Cantidad Aprobada']?.number ?? (Number(cantidadAprobada) || 0))
        : (Number(cantidadAprobada) || 0);

      // Total acumulado histórico y saldo de backorder
      const totalReceived = prevReceived + receivedNum;
      const backorder = Math.max(0, approvedNum - totalReceived);

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

        const extraDetails = [];
        if (isOvercost) {
          extraDetails.push(`ALERTA DE AUDITORÍA: Costo recibido $${unitCost.toFixed(2)} excede en +${overcostPct.toFixed(1)}% el costo aprobado en OAB ($${approvedCost.toFixed(2)}).`);
        }
        if (numeroFacturaFiscal) {
          extraDetails.push(`[SENIAT: FAC ${numeroFacturaFiscal.trim()}${numeroControlFiscal ? ` | CTRL ${numeroControlFiscal.trim()}` : ''}]`);
        }
        if (fotoPendienteSync) {
          extraDetails.push(`[FOTO_PENDIENTE_R2]`);
        }
        if (resolvedProyectoNombre) {
          extraDetails.push(`[RESERVA_MTO: ${resolvedProyectoNombre}]`);
        }
        if (extraDetails.length > 0) {
          kardexProps['Detalle (ext)'] = {
            rich_text: [{ text: { content: extraDetails.join(' · ') } }]
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

            const patchDashRes = await fetch(`https://api.notion.com/v1/pages/${dashboardId}`, {
              method: 'PATCH',
              headers,
              body: JSON.stringify({
                properties: {
                  'Stock (base)': { number: newStock }
                }
              })
            });

            if (patchDashRes.ok) {
              const kvPromise = setLiveStockDelta(env, dashboardId, {
                stock: newStock,
                unitCost: unitCost > 0 ? unitCost : undefined,
                source: 'RECEIVE_RAMP'
              });
              if (context?.waitUntil) {
                context.waitUntil(kvPromise);
              } else {
                await kvPromise;
              }
            }
          }
        } catch (stockErr) {
          console.error('Error incrementando stock en Dashboard:', stockErr);
        }
      }

      // 3.05 Transmutación Atómica MTO en Edge KV (Fase 10B)
      if (dashboardId && receivedNum > 0 && resolvedProyectoNombre) {
        try {
          const liveAllocData = await getLiveAllocations(env);
          const allocationsList = Array.isArray(liveAllocData.allocations) ? liveAllocData.allocations : [];
          const existingAlloc = allocationsList.find(a =>
            a.dashboardId === dashboardId && (
              (resolvedProyectoId && a.proyectoId === resolvedProyectoId) ||
              (a.proyectoNombre && a.proyectoNombre.trim().toLowerCase() === resolvedProyectoNombre.trim().toLowerCase())
            )
          );

          if (existingAlloc) {
            existingAlloc.cantidadApartada = (existingAlloc.cantidadApartada || 0) + receivedNum;
            existingAlloc.cantidadTransito = Math.max(0, (existingAlloc.cantidadTransito || 0) - receivedNum);
            if (unitCost > 0) existingAlloc.costoUnitarioUSD = unitCost;
            existingAlloc.updatedAt = Date.now();
          } else {
            allocationsList.push({
              id: `alloc_${dashboardId}_${resolvedProyectoId || Date.now()}`,
              dashboardId,
              insumoId: insumoId || undefined,
              insumoNombre: nombre,
              proyectoId: resolvedProyectoId || undefined,
              proyectoNombre: resolvedProyectoNombre,
              cantidadApartada: receivedNum,
              cantidadTransito: 0,
              cantidadConsumida: 0,
              costoUnitarioUSD: unitCost,
              createdAt: Date.now(),
              updatedAt: Date.now()
            });
          }

          liveAllocData.allocations = allocationsList;
          const allocPromise = setLiveAllocations(env, liveAllocData);
          if (context?.waitUntil) {
            context.waitUntil(allocPromise);
          } else {
            await allocPromise;
          }
        } catch (allocErr) {
          console.warn('Advertencia transmutando asignación MTO en Edge KV:', allocErr);
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
              'Cantidad Recibida': { number: totalReceived },
              'Backorder Pendiente': { number: backorder },
              'Estado Flujo': { select: { name: lineState } }
            }
          })
        });
      }

      results.push({
        nombre,
        solicitudId,
        receivedNum,
        totalReceived,
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
      // Reconciliación con líneas de la OAB que NO vinieron en el payload de este flete
      let globalPendingBackorders = results.reduce((sum, r) => sum + r.backorder, 0);
      for (const line of allOABLines) {
        if (!processedSolicitudIds.has(line.id)) {
          const lp = line.properties;
          const cantApr = lp['Cantidad Aprobada']?.number || lp['Cantidad Solicitada']?.number || 0;
          const cantRec = lp['Cantidad Recibida']?.number || 0;
          const bo = lp['Backorder Pendiente']?.number != null
            ? lp['Backorder Pendiente'].number
            : Math.max(0, cantApr - cantRec);
          globalPendingBackorders += bo;
          if (bo > 0) hasBackorders = true;
        }
      }

      const overallState = (hasBackorders || globalPendingBackorders > 0) ? 'Recepción Parcial' : 'Completada';
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

      if (numeroFacturaFiscal) {
        oabUpdateProps['Notas'] = {
          rich_text: [{ text: { content: `[SENIAT: FAC ${numeroFacturaFiscal.trim()}${numeroControlFiscal ? ` | CTRL ${numeroControlFiscal.trim()}` : ''}]` } }]
        };
      }

      await fetch(`https://api.notion.com/v1/pages/${oabId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ properties: oabUpdateProps })
      });
    }

    // 6. Notificaciones a Telegram: Clasificación Semántica (Incidencias vs Reporte de Recepción Parcial)
    const criticalIncidents = results.filter(r => r.rejectedNum > 0 || r.isOvercost);
    const partialDeliveries = results.filter(r => r.backorder > 0 && r.rejectedNum === 0 && !r.isOvercost);

    const dashboardBaseUrl = env.PUBLIC_DASHBOARD_URL || 'https://api.sanesca.cloud';
    const cleanFolioEncoded = encodeURIComponent(folioOAB);
    const kardexLink = `${dashboardBaseUrl}/?kardex=true&folio=${cleanFolioEncoded}`;

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

    if (criticalIncidents.length > 0) {
      try {
        const incidentRows = criticalIncidents.map(inc => {
          const parts = [];
          if (inc.rejectedNum > 0) parts.push(`❌ ${inc.rejectedNum} rechazo(s)`);
          if (inc.isOvercost) parts.push(`⚠️ +${inc.overcostPct.toFixed(1)}% sobrecosto ($${inc.unitCost.toFixed(2)} vs $${inc.approvedCost.toFixed(2)})`);
          return `• <b>${inc.nombre || 'Insumo'}</b>: ${parts.join(' | ')}`;
        }).join('\n');

        const evidenceLine = comprobanteUrl ? `\n📸 <b>Comprobante R2:</b> <a href="${comprobanteUrl}">Ver Foto de Nota</a>` : '';

        const telegramText = `<b>🔴 ALERTA DE INCIDENCIA EN RAMPA (DISCREPANCIA / SOBRECOSTO)</b>\n\n` +
          `<b>Folio OAB:</b> <code>${folioOAB}</code>\n` +
          `<b>N° Nota / Remisión:</b> <code>${numeroNotaEntrega || 'S/N'}</code>\n` +
          `<b>Fecha:</b> ${receptionDate}\n\n` +
          `<b>Discrepancias Detectadas (${criticalIncidents.length}):</b>\n${incidentRows}\n` +
          `${evidenceLine}\n\n` +
          `<i>Se requiere conciliación inmediata con el proveedor y ajuste en cuentas por pagar.</i>`;

        await sendTelegramAlert({
          env,
          text: telegramText,
          buttons: telegramButtons,
          threadId: 146
        });
      } catch (tgErr) {
        console.warn('Advertencia despachando alerta Telegram para Incidencia en Rampa:', tgErr);
      }
    } else if (hasBackorders && partialDeliveries.length > 0) {
      try {
        const deliveryRows = partialDeliveries.map(p =>
          `• <b>${p.nombre || 'Insumo'}</b>: Recibido hoy: <b>${p.receivedNum}</b> und | Pendiente (Backorder): <b>${p.backorder}</b> und`
        ).join('\n');

        const evidenceLine = comprobanteUrl ? `\n📸 <b>Comprobante R2:</b> <a href="${comprobanteUrl}">Ver Foto de Nota</a>` : '';

        const telegramText = `<b>📦 REPORTE DE RECEPCIÓN PARCIAL EN RAMPA</b>\n\n` +
          `<b>Folio OAB:</b> <code>${folioOAB}</code>\n` +
          `<b>N° Nota / Remisión:</b> <code>${numeroNotaEntrega || 'S/N'}</code>\n` +
          `<b>Fecha:</b> ${receptionDate}\n\n` +
          `<b>Estado de Entrega:</b> La orden permanece en <i>Recepción Parcial</i> con fletes pendientes.\n\n` +
          `<b>Balance de Renglones:</b>\n${deliveryRows}\n` +
          `${evidenceLine}`;

        await sendTelegramAlert({
          env,
          text: telegramText,
          buttons: telegramButtons,
          threadId: 146
        });
      } catch (tgErr) {
        console.warn('Advertencia despachando reporte Telegram para Recepción Parcial:', tgErr);
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
