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
import { recordAuditLog } from '../auth/_audit.js';
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

    const projectCache = new Map();
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
      let resolvedPedidoId = item.pedidoId ||
        notionLine?.properties?.['Pedido']?.relation?.[0]?.id ||
        null;
      let resolvedProyectoId = proyectoId ||
        notionLine?.properties?.['Proyectos']?.relation?.[0]?.id ||
        notionLine?.properties?.['Proyecto']?.relation?.[0]?.id ||
        null;
      let resolvedProyectoNombre = proyectoNombre ||
        notionLine?.properties?.['Proyecto / Obra']?.rich_text?.[0]?.plain_text ||
        notionLine?.properties?.['Proyecto (Texto)']?.rich_text?.[0]?.plain_text ||
        notionLine?.properties?.['Proyecto']?.title?.[0]?.plain_text ||
        null;

      // Hidratar nombre canónico desde BD_Pedidos si se tiene Pedido y falta el nombre
      if (resolvedPedidoId && !resolvedProyectoNombre) {
        if (projectCache.has(`pedido_${resolvedPedidoId}`)) {
          resolvedProyectoNombre = projectCache.get(`pedido_${resolvedPedidoId}`);
        } else {
          try {
            const ordRes = await fetch(`https://api.notion.com/v1/pages/${resolvedPedidoId}`, { headers });
            if (ordRes.ok) {
              const ordData = await ordRes.json();
              const op = ordData.properties || {};
              const oNum = op['Número de Documento']?.title?.[0]?.plain_text || op['Nombre']?.title?.[0]?.plain_text || '';
              const oProj = op['Proyecto']?.rich_text?.[0]?.plain_text || op['Obra']?.rich_text?.[0]?.plain_text || '';
              const oFull = oProj ? `${oNum} - ${oProj}` : oNum;
              if (oFull) {
                resolvedProyectoNombre = oFull;
                projectCache.set(`pedido_${resolvedPedidoId}`, oFull);
              }
              if (!resolvedProyectoId) {
                resolvedProyectoId = op['BD_Proyectos']?.relation?.[0]?.id || null;
              }
            }
          } catch (ordErr) {
            console.warn('Advertencia resolviendo Pedido en receive.js:', ordErr);
          }
        }
      }

      // Hidratar nombre canónico desde BD_Proyectos si viene solo el ID relacional
      if (resolvedProyectoId && !resolvedProyectoNombre) {
        if (projectCache.has(resolvedProyectoId)) {
          resolvedProyectoNombre = projectCache.get(resolvedProyectoId);
        } else {
          try {
            const pRes = await fetch(`https://api.notion.com/v1/pages/${resolvedProyectoId}`, { headers });
            if (pRes.ok) {
              const pData = await pRes.json();
              const pp = pData.properties;
              const pTitle = pp['Nombre del Proyecto (Pedido)']?.title?.[0]?.plain_text ||
                             pp['Número de Documento']?.title?.[0]?.plain_text ||
                             pp['Nombre']?.title?.[0]?.plain_text ||
                             pp['Proyecto']?.title?.[0]?.plain_text ||
                             Object.values(pp).find(p => p?.type === 'title')?.title?.[0]?.plain_text ||
                             '';
              if (pTitle) {
                resolvedProyectoNombre = pTitle;
                projectCache.set(resolvedProyectoId, pTitle);
              }
            }
          } catch (pErr) {
            console.warn('Advertencia resolviendo nombre de proyecto en receive.js:', pErr);
          }
        }
      }

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

        // Relación Canónica con BD_Proyectos (Micro-Parche 10B.1 / D3-10B.1)
        let finalProyectoId = resolvedProyectoId;
        if (!finalProyectoId && resolvedProyectoNombre && !resolvedProyectoNombre.toLowerCase().includes('stock general')) {
          try {
            const projSearchRes = await fetch(`https://api.notion.com/v1/databases/31e86805-4e27-80e0-8be5-f3d30532e900/query`, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                filter: {
                  property: 'Nombre del Proyecto (Pedido)',
                  title: { equals: resolvedProyectoNombre.trim() }
                },
                page_size: 1
              })
            });
            if (projSearchRes.ok) {
              const projData = await projSearchRes.json();
              if (projData.results?.[0]?.id) {
                finalProyectoId = projData.results[0].id;
              }
            }
          } catch (projSearchErr) {
            console.warn('Advertencia buscando proyecto por nombre en BD_Proyectos:', projSearchErr);
          }
        }
        if (finalProyectoId) {
          kardexProps['Proyectos'] = { relation: [{ id: finalProyectoId }] };
        }
        if (resolvedProyectoNombre) {
          kardexProps['Tienda (ext)'] = { rich_text: [{ text: { content: resolvedProyectoNombre } }] };
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

      // 3.05 Transmutación Atómica MTO en Edge KV (Fase 10B & Micro-Parche 10B.1)
      if (dashboardId && (receivedNum > 0 || rejectedNum > 0) && resolvedProyectoNombre && !resolvedProyectoNombre.toLowerCase().includes('stock general') && !resolvedProyectoNombre.toLowerCase().includes('stock fábrica') && !resolvedProyectoNombre.toLowerCase().includes('stock fabrica')) {
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
            if (rejectedNum > 0) {
              existingAlloc.cantidadRechazada = (existingAlloc.cantidadRechazada || 0) + rejectedNum;
            }
            existingAlloc.cantidadTransito = Math.max(0, (existingAlloc.cantidadTransito || 0) - receivedNum - rejectedNum);
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
              cantidadRechazada: rejectedNum > 0 ? rejectedNum : 0,
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

      // 3.06 Autocancelación Inteligente de Deudas Operativas y Restitución a Tienda Cedente (Micro-Fase 10E / D1-10E)
      if (dashboardId && receivedNum > 0) {
        try {
          const liveAllocData = await getLiveAllocations(env);
          const debts = Array.isArray(liveAllocData.debts) ? liveAllocData.debts : [];
          
          // Buscar si existe una deuda activa para este insumo que corresponda a esta recepción
          const activeDebtIndex = debts.findIndex(d => 
            d.insumoDashboardId === dashboardId && 
            d.estado === 'Pendiente' &&
            (
              (solicitudId && d.requisicionId === solicitudId) ||
              (resolvedProyectoNombre && d.deudorProyectoNombre?.toLowerCase() === resolvedProyectoNombre.toLowerCase()) ||
              (resolvedProyectoNombre && d.acreedorProyectoNombre?.toLowerCase() === resolvedProyectoNombre.toLowerCase())
            )
          );

          if (activeDebtIndex !== -1) {
            const debt = debts[activeDebtIndex];
            const unitsToSettle = Math.min(receivedNum, debt.cantidadDeuda || 0);

            if (unitsToSettle > 0) {
              debt.cantidadDeuda = Math.max(0, (debt.cantidadDeuda || 0) - unitsToSettle);
              if (debt.cantidadDeuda === 0) {
                debt.estado = 'Saldada';
              }
              debt.updatedAt = Date.now();

              // Restituir existencias apartadas a la Tienda Cedente (Acreedora)
              const allocationsList = Array.isArray(liveAllocData.allocations) ? liveAllocData.allocations : [];
              const acreedorAlloc = allocationsList.find(a => 
                a.dashboardId === dashboardId && (
                  (debt.acreedorProyectoId && a.proyectoId === debt.acreedorProyectoId) ||
                  (a.proyectoNombre && a.proyectoNombre.trim().toLowerCase() === debt.acreedorProyectoNombre.trim().toLowerCase())
                )
              );

              if (acreedorAlloc) {
                acreedorAlloc.cantidadApartada = (acreedorAlloc.cantidadApartada || 0) + unitsToSettle;
                acreedorAlloc.updatedAt = Date.now();
              } else {
                allocationsList.push({
                  id: `alloc_${dashboardId}_${debt.acreedorProyectoId || Date.now()}`,
                  dashboardId,
                  insumoId: insumoId || undefined,
                  insumoNombre: nombre,
                  proyectoId: debt.acreedorProyectoId,
                  proyectoNombre: debt.acreedorProyectoNombre,
                  cantidadApartada: unitsToSettle,
                  cantidadTransito: 0,
                  cantidadRechazada: 0,
                  cantidadConsumida: 0,
                  costoUnitarioUSD: unitCost || 0,
                  createdAt: Date.now(),
                  updatedAt: Date.now()
                });
              }

              liveAllocData.debts = debts;
              liveAllocData.allocations = allocationsList;
              await setLiveAllocations(env, liveAllocData);

              // Asiento Inmutable en Kardex: Reposición de Préstamo
              try {
                await fetch('https://api.notion.com/v1/pages', {
                  method: 'POST',
                  headers,
                  body: JSON.stringify({
                    parent: { database_id: KARDEX_DB_ID },
                    properties: {
                      'Descripción': {
                        title: [{ text: { content: `🔄 Reposición Automática de Préstamo: ${nombre} (${unitsToSettle} ${debt.unidad || 'und'}) restituido a ${debt.acreedorProyectoNombre} ← OAB ${cleanFolio}` } }]
                      },
                      'Movimiento': {
                        select: { name: '🟢 Entrada por Devolución' }
                      },
                      'Cantidad (Stock)': {
                        number: unitsToSettle
                      },
                      'Folio OAB': {
                        rich_text: [{ text: { content: cleanFolio } }]
                      },
                      'Fecha de Recepción': {
                        date: { start: receptionDate }
                      },
                      ...(dashboardId ? { 'Dashboard': { relation: [{ id: dashboardId }] } } : {}),
                      ...(insumoId ? { 'Producto': { relation: [{ id: insumoId }] } } : {})
                    }
                  })
                });
              } catch (kardexDebtErr) {
                console.warn('Error registrando asiento de saldo de deuda en Kardex:', kardexDebtErr);
              }

              // Registro Forense de Auditoría
              recordAuditLog({
                env,
                context,
                request,
                eventType: 'EMERGENCY_DEBT_SETTLED',
                employeeId: authCheck.user?.sub || 'ALMACEN',
                employeeName: authCheck.user?.name || 'Receptor Rampa',
                puesto: authCheck.user?.puestos?.[0] || 'Almacén',
                area: 'Recepción y Rampa',
                isSuccess: true,
                details: `[EMERGENCY_DEBT_SETTLED] Deuda saldada en Rampa: ${unitsToSettle} unds de '${nombre}' restituidas a '${debt.acreedorProyectoNombre}' (Deudor: '${debt.deudorProyectoNombre}'). Folio: ${cleanFolio}. Deuda remanente: ${debt.cantidadDeuda} unds.`
              });
            }
          }
        } catch (debtErr) {
          console.warn('Advertencia en autocancelación de deudas en rampa:', debtErr);
        }
      }

      // Registro de Auditoría Forense en caso de Rechazo de Calidad (D2-10B.1)
      if (rejectedNum > 0) {
        try {
          recordAuditLog({
            env,
            context,
            request,
            eventType: 'RECHAZO_CALIDAD_RAMPA',
            employeeId: authCheck.user?.sub || 'ALMACEN',
            employeeName: authCheck.user?.name || 'Receptor Rampa',
            puesto: authCheck.user?.puestos?.[0] || 'Almacén',
            area: 'Recepción y Rampa',
            isSuccess: true,
            details: `[RECHAZO_CALIDAD_RAMPA] OAB ${folioOAB}: Rechazadas ${rejectedNum} und de '${nombre}' para obra '${resolvedProyectoNombre || 'N/A'}'. Motivo: ${notasDiscrepancia || 'Defecto físico en rampa'}. Conformes: ${receivedNum} und.`,
            alertSecurity: true
          });
        } catch (auditErr) {
          console.warn('Error registrando log forense de rechazo:', auditErr);
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
        const lineUpdateProps = {
          'Cantidad Recibida': { number: totalReceived },
          'Backorder Pendiente': { number: backorder },
          'Estado Flujo': { select: { name: lineState } }
        };
        if (resolvedProyectoNombre) {
          lineUpdateProps['Proyecto / Obra'] = {
            rich_text: [{ text: { content: String(resolvedProyectoNombre).trim() } }]
          };
        }
        if (resolvedPedidoId) {
          lineUpdateProps['Pedido'] = { relation: [{ id: resolvedPedidoId }] };
        }
        if (resolvedProyectoId) {
          lineUpdateProps['Proyectos'] = { relation: [{ id: resolvedProyectoId }] };
        }
        await fetch(`https://api.notion.com/v1/pages/${solicitudId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ properties: lineUpdateProps })
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
