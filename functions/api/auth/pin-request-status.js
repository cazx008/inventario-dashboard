/**
 * Cloudflare Pages Functions — Consulta de Estado de Ticket 2FA
 * Ruta: GET /api/auth/pin-request-status?id=requestId
 * 
 * Polling suave desde la terminal de PC (cada 2 segundos) para detectar
 * la resolución efectuada por Mikel en Telegram.
 */

import { executeRedis } from './_audit.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Método no permitido. Use GET.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  try {
    const url = new URL(request.url);
    const requestId = url.searchParams.get('id');

    if (!requestId) {
      return new Response(JSON.stringify({ error: 'Falta parámetro id.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const raw = await executeRedis(env, 'GET', `pin_req:${requestId}`);
    if (!raw) {
      return new Response(JSON.stringify({
        status: 'EXPIRED',
        message: 'La solicitud ha caducado por tiempo de espera.'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const ticket = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const now = Date.now();
    const elapsedSec = Math.floor((now - (ticket.createdAt || now)) / 1000);
    const remainingSeconds = Math.max(0, 120 - elapsedSec);

    return new Response(JSON.stringify({
      status: ticket.status || 'PENDING',
      action: ticket.action || null,
      oneTimeToken: ticket.oneTimeToken || null,
      tempToken: ticket.tempToken || null,
      profile: ticket.profile || null,
      employeeId: ticket.employeeId,
      employeeName: ticket.employeeName,
      remainingSeconds
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
