/**
 * Cloudflare Pages Functions — Transcripción y Aprobación Gerencial (Magaly & Compras)
 * Ruta: POST /api/oab/review
 * 
 * Actualiza las cantidades aprobadas por renglón en Solicitudes de Insumos,
 * registra el proveedor y cotización de Compras, y transiciona el estado a 'En Compra'.
 */

const OAB_DB_ID = '3eb86805-4e27-81f9-860a-c51fc794ebb0';
const SOLICITUDES_DB_ID = '2bc86805-4e27-8036-ba88-d52ec84742ba';

import { requirePermission } from '../auth/_guard.js';
import { sendTelegramAlert } from '../telegram/notify.js';


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
  const authCheck = await requirePermission(context, 'Revisar_OAB');
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
      oabId,
      folioOAB,
      proveedorNombre,
      numeroCotizacion,
      fechaEstimadaEntrega,
      notasCompras,
      comprobanteUrl,
      lineas
    } = payload;

    if (!oabId || !lineas || !Array.isArray(lineas)) {
      return new Response(JSON.stringify({ error: 'Faltan parámetros requeridos (oabId, lineas).' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Validación preventiva: Bloquear si todas las líneas están en cero
    const totalApprovedUnits = lineas.reduce((sum, l) => sum + (Number(l.cantidadAprobada) || 0), 0);
    if (totalApprovedUnits <= 0) {
      return new Response(JSON.stringify({
        error: 'No se puede pasar a "En Compra" una orden con todas las líneas en cero. Si la gerencia rechazó la solicitud, utilice la anulación formal de la orden.'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    let totalAprobadoUSD = 0;
    const lineResults = [];

    // 1. Actualizar cada línea en Solicitudes de Insumos
    for (const line of lineas) {
      const { solicitudId, cantidadAprobada, costoUnitarioUSD } = line;
      if (!solicitudId) continue;

      const cantApr = Number(cantidadAprobada) || 0;
      const unitCost = Number(costoUnitarioUSD) || 0;
      const subtotal = cantApr * unitCost;
      totalAprobadoUSD += subtotal;

      const lineState = cantApr > 0 ? 'En Compra' : 'Cancelada';

      const patchRes = await fetch(`https://api.notion.com/v1/pages/${solicitudId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          properties: {
            'Cantidad Aprobada': { number: cantApr },
            'Costo Estimado ($ USD)': { number: unitCost },
            'Subtotal Estimado ($ USD)': { number: subtotal },
            'Estado Flujo': { select: { name: lineState } }
          }
        })
      });

      lineResults.push({
        solicitudId,
        cantidadAprobada: cantApr,
        estado: lineState,
        ok: patchRes.ok
      });
    }

    // 2. Actualizar Cabecera en BD_Ordenes_Abastecimiento
    const oabUpdateProps = {
      'Estado General': { select: { name: 'En Compra' } },
      'Total Estimado ($ USD)': { number: totalAprobadoUSD }
    };

    if (proveedorNombre) {
      oabUpdateProps['Proveedor Adjudicado'] = {
        rich_text: [{ text: { content: String(proveedorNombre) } }]
      };
    }

    if (numeroCotizacion) {
      oabUpdateProps['N° Cotización'] = {
        rich_text: [{ text: { content: String(numeroCotizacion) } }]
      };
    }

    if (fechaEstimadaEntrega) {
      oabUpdateProps['Fecha Estimada Entrega'] = {
        date: { start: fechaEstimadaEntrega }
      };
    }

    if (notasCompras) {
      oabUpdateProps['Notas Compras'] = {
        rich_text: [{ text: { content: String(notasCompras) } }]
      };
    }

    if (comprobanteUrl) {
      oabUpdateProps['Comprobante Firmado'] = {
        files: [
          {
            name: `HojaViajera_Magaly_${folioOAB || oabId}.jpg`,
            external: { url: comprobanteUrl }
          }
        ]
      };
    }

    const oabPatchRes = await fetch(`https://api.notion.com/v1/pages/${oabId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ properties: oabUpdateProps })
    });

    // 3. Despachar Alerta formal a Telegram (Tópico 'Inventario' - threadId 146)
    try {
      const dashboardBaseUrl = env.PUBLIC_DASHBOARD_URL || 'https://sanesca-inventario.pages.dev';
      const cleanFolio = encodeURIComponent(folioOAB || 'S/F');
      const rampaLink = `${dashboardBaseUrl}/?rampa=true&folio=${cleanFolio}`;

      const telegramText = `<b>🟢 ORDEN DE ABASTECIMIENTO EN COMPRA</b>\n\n` +
        `<b>Folio OAB:</b> <code>${folioOAB || 'S/F'}</code>\n` +
        `<b>Proveedor:</b> ${proveedorNombre || 'Por Definir'}\n` +
        `<b>N° Cotización / Factura:</b> <code>${numeroCotizacion || 'S/N'}</code>\n` +
        `<b>Total Aprobado:</b> $${totalAprobadoUSD.toFixed(2)} USD\n` +
        `<b>Renglones en Tránsito:</b> ${lineResults.filter(l => l.cantidadAprobada > 0).length}\n` +
        (fechaEstimadaEntrega ? `<b>Entrega Estimada:</b> ${fechaEstimadaEntrega}\n` : '') +
        (comprobanteUrl ? `\n📄 <b>Hoja Viajera Magaly:</b> <a href="${comprobanteUrl}">Ver Documento Firmado</a>\n` : '') +
        `\n<i>Mercancía en tránsito hacia almacén. Rampa de recepción habilitada.</i>`;

      const telegramButtons = [
        [
          {
            text: '🚚 Abrir Terminal de Rampa',
            web_app: { url: rampaLink }
          }
        ],
        [
          {
            text: '🌐 Abrir en Navegador',
            url: rampaLink
          }
        ]
      ];

      await sendTelegramAlert({
        env,
        text: telegramText,
        buttons: telegramButtons,
        threadId: 146
      });
    } catch (tgErr) {
      console.warn('Advertencia despachando alerta Telegram para OAB En Compra:', tgErr);
    }

    return new Response(JSON.stringify({
      status: 'success',
      folioOAB,
      totalAprobadoUSD,
      lineasActualizadas: lineResults.length,
      detalle: lineResults
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: `Excepción en revisión de OAB: ${error.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
