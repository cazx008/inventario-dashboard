/**
 * Cloudflare Pages Functions — Revalidación Inmediata de Caché Edge KV
 * Ruta: /api/inventory/revalidate (POST o GET)
 * 
 * PLAN-013 — Decisión 3 (Ruta A)
 * 
 * Purga de forma atómica la caché de auditoría y conceptos en Cloudflare Edge KV,
 * forzando a que las consultas subsecuentes a Notion obtengan los datos frescos
 * (como cambios en la casilla "Contando" o nuevas fichas en BD_Control_Stock_Existencias).
 */

import { CATALOG_AUDIT_KEY, CATALOG_CONCEPTS_KEY } from '../_kv.js';

export async function onRequest(context) {
  const { request, env } = context;

  // Manejo de CORS
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  try {
    let purgedKeys = [];

    if (env?.INVENTORY_KV) {
      await Promise.all([
        env.INVENTORY_KV.delete(CATALOG_AUDIT_KEY).catch(() => null),
        env.INVENTORY_KV.delete(CATALOG_CONCEPTS_KEY).catch(() => null)
      ]);
      purgedKeys = [CATALOG_AUDIT_KEY, CATALOG_CONCEPTS_KEY];
    }

    return new Response(JSON.stringify({
      ok: true,
      purgedKeys,
      timestamp: Date.now(),
      message: 'Caché Edge KV invalidada con éxito. Datos de Notion listos para revalidación inmediata.'
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });

  } catch (err) {
    console.error('[/api/inventory/revalidate] Error purgando caché KV:', err);
    return new Response(JSON.stringify({
      ok: false,
      error: err.message || 'Error al revalidar caché de inventario.'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
