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
