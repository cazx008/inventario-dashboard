/**
 * Cloudflare Pages Functions — Ontología ISO Diccionario de Conceptos
 * Ruta: GET /api/catalog/concepts
 * 
 * Micro-Fase 11A — Arquitectura Industrial Sanesca PRO
 * 
 * Devuelve el catálogo maestro de Conceptos Raíz ontológicos de Notion
 * (BD_Diccionario_Conceptos: 38186805-4e27-81ab-ba97-c1f57f114713)
 * con caché sub-10ms en Cloudflare Edge KV.
 */

import { getCachedConcepts, setCachedConcepts } from '../_kv.js';
import { toDisplayUoM } from './_uomMap.js';

const DICCIONARIO_CONCEPTOS_DB_ID = '38186805-4e27-81ab-ba97-c1f57f114713';

export async function onRequest(context) {
  const { request, env } = context;

  // Manejo de CORS
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Notion-Version',
      },
    });
  }

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Método no permitido. Use GET.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const url = new URL(request.url);
  const forceRefresh = url.searchParams.get('refresh') === 'true';

  // 1. Intentar servir desde caché Edge KV
  if (!forceRefresh) {
    const cached = await getCachedConcepts(env);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      return new Response(JSON.stringify({
        ok: true,
        source: 'edge_kv_cache',
        count: cached.length,
        concepts: cached,
        timestamp: Date.now()
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=3600'
        }
      });
    }
  }

  // 2. Consulta a Notion API
  const notionApiKey = env.NOTION_API_KEY || env.NOTION_TOKEN || env.SANESCATOKEN;
  if (!notionApiKey) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'NOTION_API_KEY no configurada en el entorno serverless.',
      concepts: []
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const notionHeaders = {
    'Authorization': `Bearer ${notionApiKey.trim()}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  };

  try {
    const concepts = [];
    let cursor = undefined;

    do {
      const response = await fetch(`https://api.notion.com/v1/databases/${DICCIONARIO_CONCEPTOS_DB_ID}/query`, {
        method: 'POST',
        headers: notionHeaders,
        body: JSON.stringify({
          start_cursor: cursor,
          page_size: 100,
          sorts: [
            {
              property: 'Concepto Raíz',
              direction: 'ascending'
            }
          ]
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Error Notion API (${response.status}): ${errText}`);
      }

      const data = await response.json();
      for (const page of (data.results || [])) {
        const p = page.properties;
        const concepto = p['Concepto Raíz']?.title?.map(t => t.plain_text).join('').trim() || '';
        if (!concepto) continue;

        const prefijo = p['Prefijo de Código']?.rich_text?.map(t => t.plain_text).join('').trim().toUpperCase() || '';
        const uomNotion = p['Unidad de Medida Estándar']?.select?.name || 'Unidad';
        const uomDisplay = toDisplayUoM(uomNotion);
        const patronISO = p['Patrón de Nombre ISO']?.rich_text?.map(t => t.plain_text).join('').trim() || '';
        const modificadoresObligatorios = p['Modificadores Obligatorios']?.multi_select?.map(m => m.name.trim()) || [];
        const modificadoresOpcionales = p['Modificadores Opcionales']?.multi_select?.map(m => m.name.trim()) || [];
        const codigoUNSPSC = p['Código UNSPSC']?.rich_text?.map(t => t.plain_text).join('').trim() || '';
        const definicion = p['Definición']?.rich_text?.map(t => t.plain_text).join('').trim() || '';
        const sinonimos = p['Sinónimos']?.rich_text?.map(t => t.plain_text).join('').trim() || '';

        concepts.push({
          id: page.id,
          concepto,
          prefijo,
          uomNotion,
          uomDisplay,
          patronISO,
          modificadoresObligatorios,
          modificadoresOpcionales,
          codigoUNSPSC,
          definicion,
          sinonimos
        });
      }

      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    // 3. Guardar en caché Edge KV
    context.waitUntil(setCachedConcepts(env, concepts));

    return new Response(JSON.stringify({
      ok: true,
      source: 'notion_api',
      count: concepts.length,
      concepts,
      timestamp: Date.now()
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600'
      }
    });

  } catch (error) {
    console.error('[concepts.js] Error consultando conceptos de Notion:', error);
    return new Response(JSON.stringify({
      ok: false,
      error: error.message || 'Error interno consultando conceptos ontológicos.'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
