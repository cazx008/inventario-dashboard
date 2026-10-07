/**
 * Cloudflare Pages Functions — Sincronización SWR en Tiempo Real
 * Ruta: GET /api/inventory/sync
 * 
 * Consulta Notion en segundo plano para:
 * 1. Calcular el Stock en Tránsito (OAB) activo sumando Solicitudes de Insumos no completadas.
 * 2. Obtener los últimos movimientos de Kardex para detectar si hubo recepciones recientes.
 * 3. Devolver un payload ultraligero que permita a la UI reconciliar el estado sin recargar la página.
 */

import { getLiveStockDeltas } from '../_kv.js';

const SOLICITUDES_DB_ID = '2bc86805-4e27-8036-ba88-d52ec84742ba';
const KARDEX_DB_ID = '26286805-4e27-803b-91ce-ef8f121d622d';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Notion-Version',
      },
    });
  }

  // 0. Consultar deltas en caliente desde Cloudflare Edge KV (100k lecturas/día gratis, latencia sub-5ms)
  const deltas = await getLiveStockDeltas(env);
  const liveStockByDashboardId = {};
  const liveCostByDashboardId = {};

  for (const [dashId, entry] of Object.entries(deltas)) {
    if (entry && typeof entry.stock === 'number') {
      liveStockByDashboardId[dashId] = entry.stock;
    }
    if (entry && typeof entry.unitCost === 'number' && entry.unitCost > 0) {
      liveCostByDashboardId[dashId] = entry.unitCost;
    }
  }

  const notionApiKey = env.NOTION_API_KEY;
  if (!notionApiKey) {
    // Si no hay API key en local, responder con payload de sincronización con liveStock de KV
    return new Response(JSON.stringify({
      status: 'offline_or_unconfigured',
      enTransitoByDashboardId: {},
      enTransitoByName: {},
      liveStockByDashboardId,
      liveCostByDashboardId,
      activeOrdersCount: 0,
      timestamp: Date.now(),
      message: 'NOTION_API_KEY no configurada; operando con snapshot local y Edge KV live.'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const headers = {
    'Authorization': `Bearer ${notionApiKey}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };

  try {
    // 1. Consultar Solicitudes de Insumos que NO estén Completadas ni Canceladas (Paginación con Cursor defensiva)
    let allSolicitudes = [];
    let hasMore = true;
    let nextCursor = undefined;
    let pageCount = 0;
    const MAX_PAGES = 5; // Cota de seguridad de hasta 500 registros

    while (hasMore && pageCount < MAX_PAGES) {
      pageCount++;
      if (pageCount > 1) {
        // Pausa defensiva de 80ms para proteger rate-limit de Notion API (3 req/s)
        await new Promise(r => setTimeout(r, 80));
      }

      const bodyPayload = {
        filter: {
          or: [
            {
              property: 'Estado Flujo',
              select: { equals: 'En Compra' }
            },
            {
              property: 'Estado Flujo',
              select: { equals: 'Recepción Parcial' }
            }
          ]
        },
        page_size: 100
      };

      if (nextCursor) {
        bodyPayload.start_cursor = nextCursor;
      }

      const solicitudesRes = await fetch(`https://api.notion.com/v1/databases/${SOLICITUDES_DB_ID}/query`, {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyPayload)
      });

      if (!solicitudesRes.ok) {
        console.warn(`Error en consulta de solicitudes página ${pageCount}:`, solicitudesRes.status);
        break;
      }

      const data = await solicitudesRes.json();
      if (data.results && Array.isArray(data.results)) {
        allSolicitudes.push(...data.results);
      }

      hasMore = Boolean(data.has_more);
      nextCursor = data.next_cursor || undefined;
    }

    const enTransitoByDashboardId = {};
    const enTransitoByName = {};
    const activeOrdersCount = allSolicitudes.length;

    for (const page of allSolicitudes) {
      const props = page.properties;
      const estadoFlujo = props['Estado Flujo']?.select?.name || '';

      // DEFENSA EN PROFUNDIDAD (Regla Odoo): Tránsito cero para Solicitado o Borrador.
      // Solo mercancía efectivamente aprobada y comprada por Lorena suma a tránsito.
      if (estadoFlujo !== 'En Compra' && estadoFlujo !== 'Recepción Parcial') {
        continue;
      }

      const cantAprobada = props['Cantidad Aprobada']?.number || 0;
      const cantRecibida = props['Cantidad Recibida']?.number || 0;
      const backorder = props['Backorder Pendiente']?.number || 0;
      
      // Calcular pendiente en tránsito real
      let pending = 0;
      if (backorder > 0) {
        pending = backorder;
      } else if (cantAprobada > 0) {
        pending = Math.max(0, cantAprobada - cantRecibida);
      }

      if (pending <= 0) continue;

      // Extraer relación con Dashboard
      const dashRel = props['Dashboard']?.relation;
      if (dashRel && dashRel.length > 0) {
        const dashId = dashRel[0].id;
        enTransitoByDashboardId[dashId] = (enTransitoByDashboardId[dashId] || 0) + pending;
      }

      // También registrar por nombre de insumo como fallback
      let rawTitle = props['Nombre de Solicitud']?.title?.[0]?.plain_text ||
                     props['Insumo']?.title?.[0]?.plain_text || 
                     props['Nombre']?.title?.[0]?.plain_text;
      if (rawTitle) {
        const cleanTitle = rawTitle.replace(/^\[[^\]]+\]\s*/, '').trim().toLowerCase();
        if (cleanTitle) {
          enTransitoByName[cleanTitle] = (enTransitoByName[cleanTitle] || 0) + pending;
        }
      }
    }

    const isOverflow = Boolean(hasMore && pageCount >= MAX_PAGES);

    return new Response(JSON.stringify({
      status: 'synced',
      enTransitoByDashboardId,
      enTransitoByName,
      liveStockByDashboardId,
      liveCostByDashboardId,
      activeOrdersCount,
      overflow: isOverflow,
      timestamp: Date.now()
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, s-maxage=20, stale-while-revalidate=10',
        'X-Sync-Overflow': isOverflow ? 'true' : 'false'
      }
    });

  } catch (error) {
    return new Response(JSON.stringify({
      error: `Error en sincronización SWR: ${error.message}`,
      status: 'error',
      timestamp: Date.now()
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
