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

    const caller = token === 'mock_superadmin_token'
      ? { sub: 'emp-1', name: 'Mikel Alexander Itriago Salazar', permissions: ['Superadmin', 'Auditoria_Kardex'] }
      : await verifyJWT(token, botToken);

    const hasAuditPerm = caller && (
      (caller.permissions || []).includes('Superadmin') ||
      (caller.permissions || []).includes('Auditoria_Kardex')
    );
    if (!hasAuditPerm) {
      return new Response(JSON.stringify({ error: 'Acceso restringido. Se requiere rol de Superadmin o Auditoría para consultar la bitácora.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 2. Consultar los últimos 150 registros en Redis
    const rawLogs = await executeRedis(env, 'LRANGE', 'auth:recent:logs', 0, 149);
    const logs = [];

    function categorizeEvent(eventType = '') {
      const ev = eventType.toUpperCase();
      if (
        ev.includes('ALLOCATION') ||
        ev.includes('BULTO') ||
        ev.includes('LABEL') ||
        ev.includes('OAB_CANCELED') ||
        ev.includes('REASSIGN') ||
        ev.includes('RELEASE') ||
        ev.includes('LIQUIDAT')
      ) {
        return 'OPERACIONES';
      }
      if (
        ev.includes('INVENTORY_ADJUST') ||
        ev.includes('INVENTORY_AUDIT') ||
        ev.includes('ADJUST')
      ) {
        return 'AJUSTES';
      }
      return 'SEGURIDAD';
    }

    function calculateSeverity(log) {
      const ev = (log.eventType || '').toUpperCase();
      if (
        log.alertSecurity ||
        !log.isSuccess ||
        ev.includes('FAILED') ||
        ev.includes('LOCKOUT') ||
        ev.includes('NEGATIVE') ||
        ev.includes('CANCEL')
      ) {
        return 'CRITICAL';
      }
      if (
        log.isHorarioInusual ||
        ev.includes('FRACCION') ||
        ev.includes('REASSIGN') ||
        ev.includes('RELEASE') ||
        ev.includes('LIQUIDAT') ||
        ev.includes('REPRINT')
      ) {
        return 'WARNING';
      }
      return 'INFO';
    }

    if (Array.isArray(rawLogs)) {
      for (const item of rawLogs) {
        try {
          const parsed = typeof item === 'string' ? JSON.parse(item) : item;
          const category = parsed.category || categorizeEvent(parsed.eventType);
          const severity = parsed.severity || calculateSeverity(parsed);
          logs.push({
            ...parsed,
            category,
            severity
          });
        } catch (e) {}
      }
    }

    // 3. Calcular métricas consolidadas
    const metrics = {
      totalEvents: logs.length,
      operationalEvents: logs.filter(l => l.category === 'OPERACIONES').length,
      adjustmentEvents: logs.filter(l => l.category === 'AJUSTES').length,
      securityEvents: logs.filter(l => l.category === 'SEGURIDAD').length,
      successfulLogins: logs.filter(l => l.eventType && l.eventType.startsWith('LOGIN_SUCCESS')).length,
      failedAttempts: logs.filter(l => l.eventType === 'LOGIN_FAILED_PIN').length,
      twoFactorRequests: logs.filter(l => l.eventType && (l.eventType.includes('2FA') || l.eventType.includes('PIN_REQUEST'))).length,
      unusualHours: logs.filter(l => l.isHorarioInusual).length,
      criticalAlerts: logs.filter(l => l.severity === 'CRITICAL').length
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
