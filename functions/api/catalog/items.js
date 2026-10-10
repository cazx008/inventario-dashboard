/**
 * Cloudflare Pages Functions — Consulta Unificada del Catálogo Maestro de Insumos
 * Ruta: GET /api/catalog/items
 * 
 * Micro-Fase 11A — Arquitectura Industrial Sanesca PRO
 * 
 * Devuelve la lista unificada de insumos del Catálogo Maestro (BD_Catalogo_Insumos: 26286805)
 * cruzada con las fichas de existencias físicas (BD_Control_Stock_Existencias: 2b586805)
 * e hidratada en caliente con las adiciones de Edge KV (live_catalog_additions).
 */

import { getLiveCatalogAdditions } from '../_kv.js';
import { toDisplayUoM } from './_uomMap.js';

const CATALOGO_INSUMOS_DB_ID = '26286805-4e27-8067-8847-d39de1bf0bde';
const CONTROL_STOCK_DB_ID = '2b586805-4e27-80fe-b6e8-e4c6dc325696';

function extractPlainText(prop) {
  if (!prop) return '';
  if (prop.title) return prop.title.map(t => t.plain_text).join('').trim();
  if (prop.rich_text) return prop.rich_text.map(t => t.plain_text).join('').trim();
  if (prop.select) return prop.select.name?.trim() || '';
  if (typeof prop.number === 'number') return String(prop.number);
  return '';
}

async function fetchAllPages(dbId, headers, maxPages = 10) {
  const pages = [];
  let cursor = undefined;
  let pageCount = 0;

  while (pageCount < maxPages) {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Error Notion DB (${dbId}): ${res.status} ${errText}`);
    }

    const data = await res.json();
    pages.push(...(data.results || []));
    pageCount++;

    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }

  return pages;
}

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
  const query = (url.searchParams.get('q') || '').toLowerCase().trim();
  const categoryFilter = url.searchParams.get('categoria') || '';
  const statusFilter = url.searchParams.get('estado') || 'todos'; // 'activos', 'descontinuados', 'todos'

  const notionApiKey = env.NOTION_API_KEY || env.NOTION_TOKEN || env.SANESCATOKEN;
  if (!notionApiKey) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'NOTION_API_KEY no configurada.',
      items: []
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
    // 1. Consultar de forma paralela el Catálogo de Insumos y Control de Stock con paginación completa
    const [catalogPages, stockPages, liveAdditions] = await Promise.all([
      fetchAllPages(CATALOGO_INSUMOS_DB_ID, notionHeaders, 10),
      fetchAllPages(CONTROL_STOCK_DB_ID, notionHeaders, 10),
      getLiveCatalogAdditions(env)
    ]);

    // 2. Mapear existencias físicas por relación "Producto"
    const stockMapByInsumoId = new Map();
    for (const page of stockPages) {
      const p = page.properties;
      const insumoRel = p['Producto']?.relation || p['Insumos']?.relation || [];
      const insumoId = insumoRel[0]?.id;
      if (insumoId) {
        stockMapByInsumoId.set(insumoId, {
          dashboardId: page.id,
          stockBase: p['Stock (base)']?.number ?? 0,
          stockMinimo: p['Stock mínimo']?.number ?? 0,
          estadoStock: p['Estado de Stock']?.select?.name || 'En Stock',
          contando: p['Contando']?.checkbox ?? true,
          ubicacion: extractPlainText(p['Ubicación'] || p['Pasillo'] || p['Estante'])
        });
      }
    }

    // 3. Procesar resultados del Catálogo Maestro
    const items = [];

    for (const page of catalogPages) {
      const p = page.properties;

      const nombre = extractPlainText(p['Nombre del producto']) ||
                     extractPlainText(p['Concepto']) ||
                     extractPlainText(p['Nombre'] || p['Descripción'] || p['Material']) ||
                     'Insumo sin Nombre';
      const codeProp = p['Codigo'] || p['Código'];
      const codigo = extractPlainText(codeProp).toUpperCase();
      const codigoValery = extractPlainText(p['Codigo Valery'] || p['Código Valery'] || p['Código_Valery']).toUpperCase();
      const marca = extractPlainText(p['Marca']);
      const categoria = p['Categoría de material']?.select?.name || p['Categoría']?.select?.name || 'General';
      const rolMaterial = p['Rol del Material']?.select?.name || '';
      
      const conceptoRel = p['Diccionario de Conceptos']?.relation || [];
      const conceptoId = conceptoRel[0]?.id || null;

      const uomNotion = p['Unidad']?.select?.name || p['Unidad de Medida']?.select?.name || 'Unidad';
      const unidad = toDisplayUoM(uomNotion);

      const costoUnitarioUSD = Number(p['Costo_Unitario_Base_USD']?.number ?? p['Costo Unitario ($ USD)']?.number ?? p['Costo']?.number ?? 0);

      const largo = p['Largo']?.number ?? null;
      const ancho = p['Ancho']?.number ?? null;
      const espesor = p['Espesor']?.number ?? null;
      const color = extractPlainText(p['Color']);

      // Dimensiones formateadas
      const dimParts = [];
      if (largo) dimParts.push(`${largo}mm`);
      if (ancho) dimParts.push(`${ancho}mm`);
      if (espesor) dimParts.push(`${espesor}mm`);
      const dimensiones = dimParts.join(' × ');

      // Cruzar con existencias físicas
      const stockInfo = stockMapByInsumoId.get(page.id) || null;

      const isDescontinuado = p['Activo']?.checkbox === false || p['Descontinuado']?.checkbox === true || (stockInfo && !stockInfo.contando);
      const isHuerfano = !stockInfo;
      const activo = !isDescontinuado;

      // Filtros
      if (categoryFilter && categoria.toLowerCase() !== categoryFilter.toLowerCase()) continue;
      if (statusFilter === 'activos' && isDescontinuado) continue;
      if (statusFilter === 'descontinuados' && !isDescontinuado) continue;
      if (query) {
        const matchesQuery = nombre.toLowerCase().includes(query) ||
                             codigo.toLowerCase().includes(query) ||
                             codigoValery.toLowerCase().includes(query) ||
                             marca.toLowerCase().includes(query);
        if (!matchesQuery) continue;
      }

      items.push({
        id: page.id,
        insumoId: page.id,
        dashboardId: stockInfo?.dashboardId || null,
        nombre,
        codigo,
        codigoValery,
        marca,
        categoria,
        rolMaterial,
        conceptoId,
        unidadNotion: uomNotion,
        unidad,
        costoUnitarioUSD,
        largo,
        ancho,
        espesor,
        color,
        dimensiones,
        stockBase: stockInfo?.stockBase ?? 0,
        stockMinimo: stockInfo?.stockMinimo ?? 0,
        estadoStock: stockInfo?.estadoStock || 'Sin Registro',
        ubicacion: stockInfo?.ubicacion || '',
        contando: stockInfo?.contando ?? true,
        activo,
        isDescontinuado: Boolean(isDescontinuado),
        isHuerfano
      });
    }

    // 4. Inyectar ítems creados dinámicamente en caliente desde Edge KV
    for (const liveItem of liveAdditions) {
      if (!items.some(it => it.insumoId === liveItem.insumoId || (it.codigo && it.codigo === liveItem.codigo))) {
        items.unshift({
          ...liveItem,
          id: liveItem.id || liveItem.insumoId,
          activo: liveItem.activo ?? !liveItem.isDescontinuado
        });
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      count: items.length,
      hasMore: false,
      nextCursor: null,
      items
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
      }
    });

  } catch (error) {
    console.error('[items.js] Error consultando catálogo unificado:', error);
    return new Response(JSON.stringify({
      ok: false,
      error: error.message || 'Error consultando catálogo de insumos.'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
