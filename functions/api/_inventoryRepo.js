/**
 * Cloudflare Pages Functions — Repositorio Central de Inventario Físico (SSOT)
 * functions/api/_inventoryRepo.js
 * 
 * Marco de Gobernanza: PLAN-017 (OpenSpec plan-017-migracion-operativa-catalogo-unificado)
 * Patrón: Hexagonal Architecture (Ports & Adapters) hacia Notion ERP / Odoo 18
 * 
 * Unifica el acceso a la tabla rectora:
 * BD_Catalogo_Insumos (26286805-4e27-8067-8847-d39de1bf0bde)
 */

export const CATALOGO_INSUMOS_DB_ID = '26286805-4e27-8067-8847-d39de1bf0bde';

export function getNotionHeaders(env) {
  const token = env?.NOTION_API_KEY || (typeof process !== 'undefined' ? process.env?.NOTION_API_KEY : '');
  return {
    'Authorization': `Bearer ${token}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  };
}

export function extractPlainText(prop) {
  if (!prop) return '';
  if (prop.title) return prop.title.map(t => t.plain_text).join('').trim();
  if (prop.rich_text) return prop.rich_text.map(t => t.plain_text).join('').trim();
  if (prop.select) return prop.select.name?.trim() || '';
  return '';
}

/**
 * Normaliza una página de BD_Catalogo_Insumos al modelo canónico de inventario
 */
export function normalizeCatalogItem(page) {
  if (!page || !page.properties) return null;
  const p = page.properties;

  const stockBase = typeof p['Stock (base)']?.number === 'number' ? p['Stock (base)'].number : 0;
  const stockMinimo = typeof p['Stock mínimo']?.number === 'number' ? p['Stock mínimo'].number : 0;
  const contando = p['Contando']?.checkbox ?? true;
  const activo = p['Activo']?.checkbox ?? (p['Descontinuado']?.checkbox !== true);
  
  let estadoStock = p['Estado de Stock']?.select?.name;
  if (!estadoStock) {
    if (stockBase <= 0) estadoStock = 'Sin Stock';
    else if (stockMinimo > 0 && stockBase < stockMinimo) estadoStock = 'Bajo Mínimo';
    else estadoStock = 'En Stock';
  }

  const nombre = extractPlainText(p['Nombre del producto']) ||
                 extractPlainText(p['Concepto']) ||
                 extractPlainText(p['Nombre'] || p['Descripción'] || p['Material']) ||
                 'Insumo sin Nombre';

  const codigo = extractPlainText(p['Codigo'] || p['Código']).toUpperCase().trim();
  const codigoValery = extractPlainText(p['Código Valery'] || p['Codigo Valery']).trim();
  const categoria = p['Categoría de material']?.select?.name || p['Categoria']?.select?.name || 'General';
  const rol = p['Rol del Material']?.select?.name || 'Insumo';
  const uom = p['Unidad de medida']?.select?.name || p['Unidad']?.select?.name || 'UND';
  const ubicacion = extractPlainText(p['Ubicación'] || p['Pasillo'] || p['Estante']);
  const costo = typeof p['Costo_Unitario_Base_USD']?.number === 'number' ? p['Costo_Unitario_Base_USD'].number : 0;

  return {
    id: page.id,
    insumoId: page.id,
    dashboardId: page.id, // En la arquitectura unificada id === insumoId === dashboardId
    nombre,
    codigo,
    codigoValery,
    categoria,
    rol,
    uom,
    stockBase,
    stockMinimo,
    estadoStock,
    ubicacion,
    contando,
    activo,
    costo,
    url: page.url
  };
}

/**
 * Consulta un insumo de forma directa por ID o código SKU en BD_Catalogo_Insumos
 */
export async function getInventoryItem(idOrCode, env) {
  if (!idOrCode) return null;
  const headers = getNotionHeaders(env);

  const cleanTarget = String(idOrCode).trim();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanTarget);

  if (isUuid) {
    try {
      const res = await fetch(`https://api.notion.com/v1/pages/${cleanTarget}`, { headers });
      if (res.ok) {
        const page = await res.json();
        return normalizeCatalogItem(page);
      }
    } catch (_) {}
  }

  // Búsqueda por SKU o Código
  try {
    const qRes = await fetch(`https://api.notion.com/v1/databases/${CATALOGO_INSUMOS_DB_ID}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        filter: {
          or: [
            { property: 'Código', rich_text: { equals: cleanTarget } },
            { property: 'Codigo', rich_text: { equals: cleanTarget } },
            { property: 'Código Valery', rich_text: { contains: cleanTarget } }
          ]
        },
        page_size: 1
      })
    });

    if (qRes.ok) {
      const qData = await qRes.json();
      if (qData.results && qData.results.length > 0) {
        return normalizeCatalogItem(qData.results[0]);
      }
    }
  } catch (_) {}

  return null;
}

/**
 * Mutación Atómica de Existencia Física en BD_Catalogo_Insumos
 * 
 * @param {string} insumoId ID canónico de la página en BD_Catalogo_Insumos
 * @param {object} mutation { delta: number, newStockBase: number, stockMinimo: number, ubicacion: string }
 * @param {object} env Variables de entorno Cloudflare Pages
 */
export async function updatePhysicalStock(insumoId, mutation, env) {
  if (!insumoId) throw new Error('insumoId es requerido para actualizar existencias');
  const headers = getNotionHeaders(env);

  // 1. Obtener estado actual si se requiere cálculo relativo (delta)
  let finalStock = typeof mutation.newStockBase === 'number' ? mutation.newStockBase : null;
  let stockMinimo = mutation.stockMinimo;

  if (finalStock === null || stockMinimo === undefined) {
    const current = await getInventoryItem(insumoId, env);
    if (!current) throw new Error(`Insumo ${insumoId} no encontrado en Catálogo`);
    
    if (finalStock === null) {
      finalStock = Math.max(0, current.stockBase + (Number(mutation.delta) || 0));
    }
    if (stockMinimo === undefined) {
      stockMinimo = current.stockMinimo;
    }
  }

  // 2. Determinar semáforo de abastecimiento
  let estadoStock = 'En Stock';
  if (finalStock <= 0) estadoStock = 'Sin Stock';
  else if (stockMinimo > 0 && finalStock < stockMinimo) estadoStock = 'Bajo Mínimo';

  // 3. Preparar payload para Notion
  const patchProperties = {
    'Stock (base)': { number: Math.round((finalStock + Number.EPSILON) * 100) / 100 },
    'Estado de Stock': { select: { name: estadoStock } }
  };

  if (typeof mutation.stockMinimo === 'number') {
    patchProperties['Stock mínimo'] = { number: mutation.stockMinimo };
  }
  if (mutation.ubicacion !== undefined) {
    patchProperties['Ubicación'] = { rich_text: [{ text: { content: mutation.ubicacion.trim() } }] };
  }
  if (typeof mutation.contando === 'boolean') {
    patchProperties['Contando'] = { checkbox: mutation.contando };
  }

  // 4. Ejecutar PATCH en Notion
  const patchRes = await fetch(`https://api.notion.com/v1/pages/${insumoId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ properties: patchProperties })
  });

  if (!patchRes.ok) {
    const errText = await patchRes.text();
    throw new Error(`Fallo en Notion PATCH /pages/${insumoId}: ${errText}`);
  }

  const updatedPage = await patchRes.json();
  return normalizeCatalogItem(updatedPage);
}
