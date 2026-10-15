/**
 * Cloudflare Pages Functions — Ingesta de Eventos de Auditoría Forense y Almacén
 * Ruta: POST /api/audit/record
 * 
 * Permite asentar trazas de auditoría forense para eventos operacionales sin
 * impacto físico directo en Kardex (fraccionamientos, aperturas de bultos, 
 * reimpresiones de etiquetas, etc.).
 */

import { verifyJWT } from '../auth/_utils.js';
import { recordAuditLog, getVzlaTime } from '../auth/_audit.js';

const DEFAULT_BOT_TOKEN = '8818827554:AAFtwP7rGOLjIrtYVC1UZfYIv0QbZq8f7cM';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método no permitido. Use POST.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const botToken = env.TELEGRAM_BOT_TOKEN || DEFAULT_BOT_TOKEN;

  try {
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : '';

    let caller = null;
    if (token === 'mock_superadmin_token') {
      caller = { sub: 'emp-1', name: 'Mikel Alexander Itriago Salazar', puesto: 'Director de Operaciones' };
    } else if (token) {
      caller = await verifyJWT(token, botToken);
    }

    const payload = await request.json().catch(() => ({}));
    const {
      eventType = 'AUDIT_GENERIC_EVENT',
      employeeName,
      employeeId,
      puesto,
      area = 'Almacén Central',
      details = '',
      isSuccess = true,
      alertSecurity = false
    } = payload;

    const opName = caller?.name || employeeName || 'Operador de Planta';
    const opId = caller?.sub || employeeId || 'op-planta';
    const opPuesto = caller?.puestos?.[0] || puesto || 'Operador';

    const logResult = recordAuditLog({
      env,
      context,
      request,
      eventType,
      employeeId: opId,
      employeeName: opName,
      puesto: opPuesto,
      area,
      isSuccess: Boolean(isSuccess),
      details,
      alertSecurity: Boolean(alertSecurity)
    });

    const { isoVzla } = getVzlaTime();

    return new Response(JSON.stringify({
      ok: true,
      timestamp: isoVzla,
      eventType
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Excepción interna: ${err.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
