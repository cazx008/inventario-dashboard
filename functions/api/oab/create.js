/**
 * Cloudflare Pages Functions — Emisión de Orden de Abastecimiento (OAB)
 * Ruta: POST /api/oab/create
 * Crea de forma atómica la cabecera OAB y sus líneas asociadas en Solicitudes de Insumos.
 */

const OAB_DB_ID = '3eb86805-4e27-81f9-860a-c51fc794ebb0';
const SOLICITUDES_DB_ID = '2bc86805-4e27-8036-ba88-d52ec84742ba';

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
  const authCheck = await requirePermission(context, 'Emitir_OAB');
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

  try {
    const payload = await request.json();
    const { folio, fechaEmision, tasaBCV, totalUSD, totalBs, notas, lineas } = payload;

    if (!folio || !lineas || !Array.isArray(lineas) || lineas.length === 0) {
      return new Response(JSON.stringify({ error: 'Datos incompletos. Se requiere folio y al menos una línea.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const headers = {
      'Authorization': `Bearer ${notionApiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    };

    // 1. Crear Cabecera en BD_Ordenes_Abastecimiento
    const oabPageRes = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        parent: { database_id: OAB_DB_ID },
        properties: {
          'Folio': {
            title: [{ text: { content: folio } }]
          },
          'Fecha Emisión': {
            date: { start: fechaEmision || new Date().toISOString().split('T')[0] }
          },
          'Total Estimado ($ USD)': {
            number: Number(totalUSD) || 0
          },
          'Total Estimado (Bs BCV)': {
            number: Number(totalBs) || 0
          },
          'Tasa BCV Aplicada': {
            number: Number(tasaBCV) || 0
          },
          'Estado General': {
            select: { name: 'Solicitado' }
          },
          'Notas': {
            rich_text: notas ? [{ text: { content: String(notas) } }] : []
          }
        }
      })
    });

    if (!oabPageRes.ok) {
      const errData = await oabPageRes.json();
      return new Response(JSON.stringify({ error: 'Error al crear OAB en Notion', detail: errData }), {
        status: oabPageRes.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const oabPage = await oabPageRes.json();
    const oabId = oabPage.id;

    // Actualizar la secuencia atómica en Cloudflare KV si el folio tiene formato OAB-YYYYMMDD-##
    if (env.INVENTORY_KV && folio) {
      const match = folio.match(/^OAB-(\d{8})-(\d+)/);
      if (match) {
        const dateCompact = match[1];
        const seqNum = parseInt(match[2], 10);
        const kvKey = `oab_seq:${dateCompact}`;
        try {
          const currentVal = await env.INVENTORY_KV.get(kvKey);
          const currentSeq = currentVal ? parseInt(currentVal, 10) : 0;
          if (seqNum > currentSeq) {
            await env.INVENTORY_KV.put(kvKey, String(seqNum));
          }
        } catch (kvErr) {
          console.warn('Advertencia actualizando secuencia KV en creación de OAB:', kvErr);
        }
      }
    }

    // 2. Crear Líneas en Solicitudes de Insumos
    const createdLines = [];
    for (const linea of lineas) {
      const lineProps = {
        'Nombre de Solicitud': {
          title: [{ text: { content: `[${folio}] ${linea.nombre || 'Insumo'}` } }]
        },
        'Orden de Abastecimiento': {
          relation: [{ id: oabId }]
        },
        'Cantidad Solicitada': {
          number: Number(linea.cantidadSolicitada) || 0
        },
        'Cantidad Stock': {
          number: Number(linea.cantidadStock) || 0
        },
        'Stock mínimo': {
          number: Number(linea.stockMinimo) || 0
        },
        'Costo Estimado ($ USD)': {
          number: Number(linea.costoUnitarioUSD) || 0
        },
        'Subtotal Estimado ($ USD)': {
          number: Number(linea.subtotalUSD) || 0
        },
        'Estado Flujo': {
          select: { name: 'Solicitado' }
        },
        'Fecha de Solicitud': {
          date: { start: fechaEmision || new Date().toISOString().split('T')[0] }
        }
      };

      if (linea.prioridad) {
        lineProps['Prioridad'] = { select: { name: linea.prioridad } };
      }
      if (linea.insumoId) {
        lineProps['Producto'] = { relation: [{ id: linea.insumoId }] };
      }
      if (linea.dashboardId) {
        lineProps['Dashboard'] = { relation: [{ id: linea.dashboardId }] };
      }
      // Tríada Canónica Odoo 18: Pedido (sale.order) + Proyectos (analytic.account) + Proyecto / Obra (rich_text inmutable)
      if (linea.proyectoNombre) {
        lineProps['Proyecto / Obra'] = {
          rich_text: [{ text: { content: String(linea.proyectoNombre).trim() } }]
        };
      }

      const rawPedidoId = linea.pedidoId || linea.orderId;
      const pedidoIdToLink = rawPedidoId || (linea.proyectoId && linea.proyectoId.length > 20 ? linea.proyectoId : null);
      if (pedidoIdToLink) {
        lineProps['Pedido'] = { relation: [{ id: pedidoIdToLink }] };
      }

      let finalProyectoId = linea.proyectoId && linea.proyectoId !== pedidoIdToLink ? linea.proyectoId : null;
      if (!finalProyectoId && pedidoIdToLink) {
        try {
          const ordRes = await fetch(`https://api.notion.com/v1/pages/${pedidoIdToLink}`, { headers });
          if (ordRes.ok) {
            const ordData = await ordRes.json();
            finalProyectoId = ordData.properties?.['BD_Proyectos']?.relation?.[0]?.id || null;
          }
        } catch (ordErr) {
          console.warn('Advertencia resolviendo BD_Proyectos desde pedido en create.js:', ordErr);
        }
      }
      if (finalProyectoId) {
        lineProps['Proyectos'] = { relation: [{ id: finalProyectoId }] };
      }

      try {
        const lineRes = await fetch('https://api.notion.com/v1/pages', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            parent: { database_id: SOLICITUDES_DB_ID },
            properties: lineProps
          })
        });

        if (lineRes.ok) {
          const lineData = await lineRes.json();
          createdLines.push({ id: lineData.id, nombre: linea.nombre });
        }
      } catch (errLine) {
        console.error('Error insertando línea OAB:', errLine);
      }
    }

    // 3. Disparar Alerta Automatizada a Telegram (Gerencia y Compras)
    try {
      const dashboardBaseUrl = env.PUBLIC_DASHBOARD_URL || 'https://api.sanesca.cloud';
      const cleanFolio = encodeURIComponent(folio);
      const dashboardLink = `${dashboardBaseUrl}/?folio=${cleanFolio}`;

      const itemsSummary = lineas.slice(0, 5).map(l => 
        `• <b>${l.nombre || 'Insumo'}</b>: ${l.cantidadSolicitada || l.cantidadSugerida || 0} und ($${Number(l.costoUnitarioUSD || 0).toFixed(2)})`
      ).join('\n');
      const remainingCount = lineas.length > 5 ? `\n<i>... y ${lineas.length - 5} renglón(es) adicional(es)</i>` : '';

      const bcvDisplay = tasaBCV ? ` @ BCV ${Number(tasaBCV).toFixed(2)}` : '';
      const bsDisplay = totalBs ? ` (Bs ${Number(totalBs).toLocaleString('es-VE', { minimumFractionDigits: 2 })})` : '';

      const telegramText = `<b>📋 NUEVA ORDEN DE ABASTECIMIENTO (OAB)</b>\n\n` +
        `<b>Folio:</b> <code>${folio}</code>\n` +
        `<b>Fecha:</b> ${fechaEmision || new Date().toISOString().split('T')[0]}\n` +
        `<b>Total Estimado:</b> <b>$${Number(totalUSD || 0).toFixed(2)} USD</b>${bsDisplay}${bcvDisplay}\n` +
        `<b>Renglones Solicitados (${lineas.length}):</b>\n${itemsSummary}${remainingCount}\n\n` +
        `<i>Emitido desde Almacén Central Sanesca PRO para revisión de Compras y Gerencia.</i>`;

      const telegramButtons = [
        [
          {
            text: '📱 Revisar OAB (Mini App)',
            web_app: { url: dashboardLink }
          }
        ],
        [
          {
            text: '🌐 Abrir en PC / Navegador',
            url: dashboardLink
          }
        ]
      ];

      await sendTelegramAlert({
        env,
        text: telegramText,
        buttons: telegramButtons,
        threadId: 145 // Tópico 'Compras' en Supergrupo Sanesca - Producción (-1003139956223)
      });
    } catch (tgErr) {
      console.warn('Advertencia despachando alerta Telegram para OAB:', tgErr);
    }

    return new Response(JSON.stringify({
      status: 'success',
      folio,
      oabId,
      lineasCreadas: createdLines.length,
      lineas: createdLines
    }), {
      status: 201,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: `Excepción interna: ${error.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
