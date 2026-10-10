/**
 * Cloudflare Pages Functions — Anulación Atómica de Órdenes de Abastecimiento (OAB)
 * Ruta: POST /api/oab/cancel
 * 
 * Permite anular una OAB y sus líneas asociadas en Notion ERP con registro de auditoría
 * inmutable y alerta en tiempo real a Telegram.
 */

const OAB_DB_ID = '3eb86805-4e27-81f9-860a-c51fc794ebb0';
const SOLICITUDES_DB_ID = '2bc86805-4e27-8036-ba88-d52ec84742ba';

import { requirePermission } from '../auth/_guard.js';
import { recordAuditLog, getVzlaTime } from '../auth/_audit.js';
import { sendTelegramAlert } from '../telegram/notify.js';
import { getLiveAllocations, setLiveAllocations } from '../_kv.js';

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

  // 1. Defensa en profundidad: Validación de permisos RBAC ('Emitir_OAB' o 'Superadmin')
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

  const headers = {
    'Authorization': `Bearer ${notionApiKey}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };

  try {
    const payload = await request.json();
    const { oabId, folioOAB, motivoCancelacion } = payload;

    if (!oabId && !folioOAB) {
      return new Response(JSON.stringify({ error: 'Se requiere oabId o folioOAB para anular la orden.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const cleanMotivo = (motivoCancelacion || '').trim();
    if (cleanMotivo.length < 5) {
      return new Response(JSON.stringify({ 
        error: 'El motivo de anulación es obligatorio y debe tener al menos 5 caracteres justificativos.' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    let targetOabId = oabId;
    let finalFolio = folioOAB || '';

    // Si no se proporcionó oabId, buscarlo por folio
    if (!targetOabId) {
      const searchRes = await fetch(`https://api.notion.com/v1/databases/${OAB_DB_ID}/query`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          filter: {
            property: 'Folio',
            title: { equals: finalFolio.trim() }
          },
          page_size: 1
        })
      });

      if (searchRes.ok) {
        const searchData = await searchRes.json();
        if (searchData.results && searchData.results.length > 0) {
          targetOabId = searchData.results[0].id;
          finalFolio = searchData.results[0].properties['Folio']?.title?.[0]?.plain_text || finalFolio;
        }
      }
    }

    if (!targetOabId) {
      return new Response(JSON.stringify({ error: `No se encontró la OAB especificada (${finalFolio || 'S/F'}).` }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const { readable } = getVzlaTime();
    const operatorName = authCheck.user?.name || 'Superadmin';
    const operatorPuesto = authCheck.user?.puestos?.[0] || 'Administración';

    // 2. Anular la cabecera OAB en BD_Ordenes_Abastecimiento
    const patchOabRes = await fetch(`https://api.notion.com/v1/pages/${targetOabId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        properties: {
          'Estado General': { select: { name: 'Cancelada' } },
          'Notas': {
            rich_text: [
              {
                text: {
                  content: `[ANULADA el ${readable} por ${operatorName} (${operatorPuesto})]: ${cleanMotivo}`
                }
              }
            ]
          }
        }
      })
    });

    if (!patchOabRes.ok) {
      const errText = await patchOabRes.text();
      console.error('[cancel.js] Error anulando cabecera OAB:', errText);
      return new Response(JSON.stringify({ error: 'Error actualizando cabecera OAB en Notion.', detail: errText }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 3. Buscar todas las líneas asociadas en Solicitudes de Insumos
    const lineasRes = await fetch(`https://api.notion.com/v1/databases/${SOLICITUDES_DB_ID}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        filter: {
          property: 'Orden de Abastecimiento',
          relation: { contains: targetOabId }
        },
        page_size: 100
      })
    });

    let canceledLinesCount = 0;
    if (lineasRes.ok) {
      const lineasData = await lineasRes.json();
      const linesList = lineasData.results || [];

      // Revertir Tránsito MTO en Edge KV si las líneas tenían cantidades aprobadas (D4-10B.1)
      try {
        const liveAllocData = await getLiveAllocations(env);
        const allocationsList = Array.isArray(liveAllocData.allocations) ? liveAllocData.allocations : [];
        let allocationsReverted = false;

        for (const linePage of linesList) {
          const lp = linePage.properties || {};
          const cantApr = lp['Cantidad Aprobada']?.number || 0;
          const dId = lp['Dashboard']?.relation?.[0]?.id;
          const pId = lp['Proyectos']?.relation?.[0]?.id || lp['Proyecto']?.relation?.[0]?.id;
          const pNom = (lp['Proyecto / Obra']?.rich_text?.[0]?.plain_text || lp['Proyecto']?.title?.[0]?.plain_text || '').trim();

          if (cantApr > 0 && dId && pNom && !pNom.toLowerCase().includes('stock general')) {
            const alloc = allocationsList.find(a =>
              a.dashboardId === dId && (
                (pId && a.proyectoId === pId) ||
                (a.proyectoNombre && a.proyectoNombre.trim().toLowerCase() === pNom.toLowerCase())
              )
            );
            if (alloc && alloc.cantidadTransito > 0) {
              alloc.cantidadTransito = Math.max(0, (alloc.cantidadTransito || 0) - cantApr);
              alloc.updatedAt = Date.now();
              allocationsReverted = true;
            }
          }
        }

        if (allocationsReverted) {
          liveAllocData.allocations = allocationsList;
          const allocPromise = setLiveAllocations(env, liveAllocData);
          if (context?.waitUntil) {
            context.waitUntil(allocPromise);
          } else {
            await allocPromise;
          }
        }
      } catch (kvErr) {
        console.warn('Advertencia revirtiendo tránsito en cancel.js:', kvErr);
      }

      for (const linePage of linesList) {
        await fetch(`https://api.notion.com/v1/pages/${linePage.id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            properties: {
              'Estado Flujo': { select: { name: 'Cancelada' } }
            }
          })
        });
        canceledLinesCount++;
      }
    }

    // 4. Registro de Auditoría Forense
    recordAuditLog({
      env,
      context,
      request,
      eventType: 'OAB_CANCELED',
      employeeId: authCheck.user?.sub || 'SUPERADMIN',
      employeeName: operatorName,
      puesto: operatorPuesto,
      area: 'Abastecimiento / Compras',
      isSuccess: true,
      details: `Anulación de OAB Folio: ${finalFolio || targetOabId}. Motivo: ${cleanMotivo}. Renglones cancelados: ${canceledLinesCount}.`,
      alertSecurity: false
    });

    // 5. Alerta Inmediata por Telegram
    const telegramHtml = 
      `🚫 <b>ORDEN DE ABASTECIMIENTO ANULADA</b> 🚫\n\n` +
      `📋 <b>Folio:</b> <code>${finalFolio}</code>\n` +
      `👤 <b>Operador:</b> <b>${operatorName}</b> (${operatorPuesto})\n` +
      `📦 <b>Líneas canceladas:</b> ${canceledLinesCount}\n` +
      `📝 <b>Motivo:</b> <i>"${cleanMotivo}"</i>\n` +
      `🕒 <b>Fecha:</b> ${readable}\n\n` +
      `ℹ️ <i>Las cantidades asociadas fueron excluidas de tránsito y compras.</i>`;

    await sendTelegramAlert({
      env,
      text: telegramHtml
    });

    return new Response(JSON.stringify({
      status: 'success',
      message: `OAB ${finalFolio} anulada exitosamente junto con ${canceledLinesCount} renglones.`,
      folio: finalFolio,
      canceledLinesCount
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (error) {
    console.error('[cancel.js] Excepción no controlada:', error);
    return new Response(JSON.stringify({ error: error.message || 'Error interno del servidor al anular OAB.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
