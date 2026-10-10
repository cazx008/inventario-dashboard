/**
 * Cloudflare Edge KV Helper — Bus de Deltas de Inventario
 * Archivo: functions/api/_kv.js
 * 
 * Gestiona los saldos y costos en caliente entre despliegues estáticos
 * utilizando Cloudflare KV (INVENTORY_KV, 100k lecturas/día gratuitas).
 */

export const LIVE_DELTAS_KEY = 'live_stock_deltas';
export const DELTA_TTL_SECONDS = 172800; // 48 horas

/**
 * Obtiene el mapa completo de deltas activos de inventario
 * @param {object} env Variables de entorno de Cloudflare Pages
 * @returns {Promise<Record<string, { stock?: number, estadoStock?: string, unitCost?: number, updatedAt?: number, source?: string }>>}
 */
export async function getLiveStockDeltas(env) {
  if (!env?.INVENTORY_KV) {
    return {};
  }
  try {
    const data = await env.INVENTORY_KV.get(LIVE_DELTAS_KEY, 'json');
    return data && typeof data === 'object' ? data : {};
  } catch (err) {
    console.warn('[_kv.js] Error leyendo deltas de KV:', err);
    return {};
  }
}

/**
 * Registra o actualiza el delta de un ítem en Cloudflare KV
 * @param {object} env Variables de entorno de Cloudflare Pages
 * @param {string} dashboardId ID de la página en BD_Control_Stock_Existencias
 * @param {object} deltaData Datos de la mutación ({ stock, estadoStock, unitCost, source })
 */
export async function setLiveStockDelta(env, dashboardId, deltaData) {
  if (!env?.INVENTORY_KV || !dashboardId) {
    return;
  }
  try {
    const currentDeltas = await getLiveStockDeltas(env);
    currentDeltas[dashboardId] = {
      ...(currentDeltas[dashboardId] || {}),
      ...deltaData,
      updatedAt: Date.now()
    };
    await env.INVENTORY_KV.put(LIVE_DELTAS_KEY, JSON.stringify(currentDeltas), {
      expirationTtl: DELTA_TTL_SECONDS
    });
  } catch (err) {
    console.warn(`[_kv.js] Error guardando delta para ${dashboardId}:`, err);
  }
}

/**
 * Elimina el delta de un ítem en Cloudflare KV (ej. al revertir un movimiento)
 * @param {object} env Variables de entorno de Cloudflare Pages
 * @param {string} dashboardId ID de la página en BD_Control_Stock_Existencias
 */
export async function removeLiveStockDelta(env, dashboardId) {
  if (!env?.INVENTORY_KV || !dashboardId) {
    return;
  }
  try {
    const currentDeltas = await getLiveStockDeltas(env);
    if (currentDeltas[dashboardId]) {
      delete currentDeltas[dashboardId];
      await env.INVENTORY_KV.put(LIVE_DELTAS_KEY, JSON.stringify(currentDeltas), {
        expirationTtl: DELTA_TTL_SECONDS
      });
    }
  } catch (err) {
    console.warn(`[_kv.js] Error eliminando delta para ${dashboardId}:`, err);
  }
}

/**
 * Purga completa de los deltas (ejecutada tras generar un nuevo snapshot estático)
 * @param {object} env Variables de entorno de Cloudflare Pages
 */
export async function clearLiveStockDeltas(env) {
  if (!env?.INVENTORY_KV) {
    return;
  }
  try {
    await env.INVENTORY_KV.delete(LIVE_DELTAS_KEY);
  } catch (err) {
    console.warn('[_kv.js] Error purgando deltas de KV:', err);
  }
}

// -------------------------------------------------------------
// GESTIÓN DE ASIGNACIONES MTO Y DEUDAS OPERATIVAS (Fase 10A)
// -------------------------------------------------------------
export const LIVE_ALLOCATIONS_KEY = 'live_stock_allocations';
export const ALLOCATION_TTL_SECONDS = 604800; // 7 días

/**
 * Obtiene el mapa completo de reservas MTO y deudas operativas desde Cloudflare KV
 * @param {object} env Variables de entorno de Cloudflare Pages
 * @returns {Promise<{ allocations: Array<object>, debts: Array<object> }>}
 */
export async function getLiveAllocations(env) {
  if (!env?.INVENTORY_KV) {
    return { allocations: [], debts: [] };
  }
  try {
    const data = await env.INVENTORY_KV.get(LIVE_ALLOCATIONS_KEY, 'json');
    if (data && typeof data === 'object') {
      return {
        allocations: Array.isArray(data.allocations) ? data.allocations : [],
        debts: Array.isArray(data.debts) ? data.debts : []
      };
    }
    return { allocations: [], debts: [] };
  } catch (err) {
    console.warn('[_kv.js] Error leyendo asignaciones de KV:', err);
    return { allocations: [], debts: [] };
  }
}

/**
 * Guarda el mapa completo de asignaciones y deudas en Cloudflare KV
 * @param {object} env Variables de entorno
 * @param {{ allocations: Array<object>, debts: Array<object> }} data
 */
export async function setLiveAllocations(env, data) {
  if (!env?.INVENTORY_KV) return;
  try {
    await env.INVENTORY_KV.put(LIVE_ALLOCATIONS_KEY, JSON.stringify({
      allocations: data.allocations || [],
      debts: data.debts || [],
      updatedAt: Date.now()
    }), {
      expirationTtl: ALLOCATION_TTL_SECONDS
    });
  } catch (err) {
    console.warn('[_kv.js] Error guardando asignaciones en KV:', err);
  }
}

// -------------------------------------------------------------
// GESTIÓN DE CATÁLOGO MAESTRO Y CONCEPTOS ONTOLÓGICOS (Fase 11)
// -------------------------------------------------------------
export const LIVE_CATALOG_ADDITIONS_KEY = 'live_catalog_additions';
export const CATALOG_CONCEPTS_KEY = 'catalog_concepts_cache';
export const CATALOG_AUDIT_KEY = 'catalog_audit_cache';

export const CATALOG_ADDITIONS_TTL_SECONDS = 172800; // 48 horas
export const CONCEPTS_CACHE_TTL_SECONDS = 86400; // 24 horas
export const AUDIT_CACHE_TTL_SECONDS = 900; // 15 minutos

/**
 * Obtiene la lista de insumos creados dinámicamente en caliente
 * @param {object} env
 * @returns {Promise<Array<object>>}
 */
export async function getLiveCatalogAdditions(env) {
  if (!env?.INVENTORY_KV) return [];
  try {
    const data = await env.INVENTORY_KV.get(LIVE_CATALOG_ADDITIONS_KEY, 'json');
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn('[_kv.js] Error leyendo adiciones de catálogo de KV:', err);
    return [];
  }
}

/**
 * Registra un nuevo insumo creado en caliente en Cloudflare KV
 * @param {object} env
 * @param {object} item
 */
export async function addLiveCatalogItem(env, item) {
  if (!env?.INVENTORY_KV || !item) return;
  try {
    const list = await getLiveCatalogAdditions(env);
    const filtered = list.filter(it => it.id !== item.id && it.insumoId !== item.insumoId);
    filtered.push({
      ...item,
      createdAt: Date.now()
    });
    await env.INVENTORY_KV.put(LIVE_CATALOG_ADDITIONS_KEY, JSON.stringify(filtered), {
      expirationTtl: CATALOG_ADDITIONS_TTL_SECONDS
    });
  } catch (err) {
    console.warn('[_kv.js] Error guardando insumo en adiciones de catálogo de KV:', err);
  }
}

/**
 * Actualiza un insumo en la lista de adiciones de Cloudflare KV
 * @param {object} env
 * @param {string} itemId
 * @param {object} itemPatch
 */
export async function updateLiveCatalogItem(env, itemId, itemPatch) {
  if (!env?.INVENTORY_KV || !itemId) return;
  try {
    const list = await getLiveCatalogAdditions(env);
    const updated = list.map(it => {
      if (it.id === itemId || it.insumoId === itemId) {
        return { ...it, ...itemPatch, updatedAt: Date.now() };
      }
      return it;
    });
    await env.INVENTORY_KV.put(LIVE_CATALOG_ADDITIONS_KEY, JSON.stringify(updated), {
      expirationTtl: CATALOG_ADDITIONS_TTL_SECONDS
    });
  } catch (err) {
    console.warn('[_kv.js] Error actualizando insumo en adiciones de catálogo de KV:', err);
  }
}

/**
 * Obtiene la caché de conceptos ontológicos de BD_Diccionario_Conceptos
 * @param {object} env
 */
export async function getCachedConcepts(env) {
  if (!env?.INVENTORY_KV) return null;
  try {
    return await env.INVENTORY_KV.get(CATALOG_CONCEPTS_KEY, 'json');
  } catch (err) {
    return null;
  }
}

/**
 * Guarda la caché de conceptos ontológicos en Cloudflare KV
 * @param {object} env
 * @param {Array<object>} concepts
 */
export async function setCachedConcepts(env, concepts) {
  if (!env?.INVENTORY_KV || !concepts) return;
  try {
    await env.INVENTORY_KV.put(CATALOG_CONCEPTS_KEY, JSON.stringify(concepts), {
      expirationTtl: CONCEPTS_CACHE_TTL_SECONDS
    });
  } catch (err) {
    console.warn('[_kv.js] Error guardando caché de conceptos en KV:', err);
  }
}

/**
 * Obtiene la caché del diagnóstico de salud del catálogo
 * @param {object} env
 */
export async function getCachedCatalogAudit(env) {
  if (!env?.INVENTORY_KV) return null;
  try {
    return await env.INVENTORY_KV.get(CATALOG_AUDIT_KEY, 'json');
  } catch (err) {
    return null;
  }
}

/**
 * Guarda la caché del diagnóstico de salud del catálogo en Cloudflare KV
 * @param {object} env
 * @param {object} auditData
 */
export async function setCachedCatalogAudit(env, auditData) {
  if (!env?.INVENTORY_KV || !auditData) return;
  try {
    await env.INVENTORY_KV.put(CATALOG_AUDIT_KEY, JSON.stringify(auditData), {
      expirationTtl: AUDIT_CACHE_TTL_SECONDS
    });
  } catch (err) {
    console.warn('[_kv.js] Error guardando caché de auditoría de catálogo en KV:', err);
  }
}


