/**
 * Cloudflare Pages Functions — Consulta de Logs de Auditoría y Métricas
 * Ruta: GET /api/auth/audit-logs
 * 
 * Permite al Superadmin visualizar los registros recientes de acceso, fallos,
 * eventos 2FA y bloqueos directamente en el Dashboard.
 */

import { verifyJWT } from './_utils.js';
import { executeRedis } from './_audit.js';

const DEFAULT_BOT_TOKEN = '8818827554:AAFtwP7rGOLjIrtYVC1UZfYIv0QbZq8f7cM';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Método no permitido. Use GET.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const botToken = env.TELEGRAM_BOT_TOKEN || DEFAULT_BOT_TOKEN;

  try {
    // 1. Validar que el solicitante sea Superadmin
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : '';

    if (!token) {
      return new Response(JSON.stringify({ error: 'No autorizado. Se requiere token.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const caller = await verifyJWT(token, botToken);
    if (!caller || !(caller.permissions || []).includes('Superadmin')) {
      return new Response(JSON.stringify({ error: 'Acceso restringido. Solo el Superadmin puede auditar accesos.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 2. Consultar los últimos 100 registros en Redis
    const rawLogs = await executeRedis(env, 'LRANGE', 'auth:recent:logs', 0, 99);
    const logs = [];

    if (Array.isArray(rawLogs)) {
      for (const item of rawLogs) {
        try {
          const parsed = typeof item === 'string' ? JSON.parse(item) : item;
          logs.push(parsed);
        } catch (e) {}
      }
    }

    // 3. Calcular métricas consolidadas
    const metrics = {
      totalEvents: logs.length,
      successfulLogins: logs.filter(l => l.eventType && l.eventType.startsWith('LOGIN_SUCCESS')).length,
      failedAttempts: logs.filter(l => l.eventType === 'LOGIN_FAILED_PIN').length,
      twoFactorRequests: logs.filter(l => l.eventType && (l.eventType.includes('2FA') || l.eventType.includes('PIN_REQUEST'))).length,
      unusualHours: logs.filter(l => l.isHorarioInusual).length
    };

    return new Response(JSON.stringify({
      ok: true,
      metrics,
      logs
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Excepción interna: ${err.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
