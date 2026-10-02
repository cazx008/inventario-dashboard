/**
 * Cloudflare Pages Functions — Solicitud 2FA para PIN o Sesión Temporal en PC
 * Ruta: POST /api/auth/pin-request
 * 
 * Genera un ticket efímero (TTL 120s) y despacha una alerta push condicional
 * exclusivamente al chat privado de Mikel (Superadmin, ID 1143226405).
 */

import { executeRedis, checkLockout, extractClientMeta, getVzlaTime, recordAuditLog, SUPERADMIN_TELEGRAM_ID } from './_audit.js';

const EMPLEADOS_DB_ID = '18a86805-4e27-80ee-974f-cb6ccc1d23d9';
const DEFAULT_BOT_TOKEN = '8818827554:AAFtwP7rGOLjIrtYVC1UZfYIv0QbZq8f7cM';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método no permitido. Use POST.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const notionApiKey = env.NOTION_API_KEY;
  const botToken = env.TELEGRAM_BOT_TOKEN || DEFAULT_BOT_TOKEN;

  try {
    const body = await request.json().catch(() => ({}));
    const { employeeId, requestType } = body;

    if (!employeeId) {
      return new Response(JSON.stringify({ error: 'Se requiere employeeId.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 1. Validar si el empleado está bloqueado por fuerza bruta
    const lockInfo = await checkLockout(env, employeeId);
    if (lockInfo.locked) {
      return new Response(JSON.stringify({
        error: `Terminal temporalmente bloqueada tras 3 intentos fallidos. Tiempo restante: ${Math.ceil(lockInfo.remainingSeconds / 60)} min.`,
        locked: true,
        remainingSeconds: lockInfo.remainingSeconds
      }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 2. Control anti-spam: Cooldown de 45s entre solicitudes por empleado
    const inCooldown = await executeRedis(env, 'GET', `auth:cooldown:pin_req:${employeeId}`);
    if (inCooldown) {
      return new Response(JSON.stringify({
        error: 'Ya existe una solicitud activa enviada a Sistemas. Por favor espera antes de enviar otra.'
      }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 3. Consultar datos del empleado en Notion
    const headers = {
      'Authorization': `Bearer ${notionApiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    };

    const empRes = await fetch(`https://api.notion.com/v1/pages/${employeeId}`, { headers });
    if (!empRes.ok) {
      return new Response(JSON.stringify({ error: 'Empleado no encontrado en Notion.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const empData = await empRes.json();
    const employeeName = empData.properties?.Nombre?.title?.[0]?.plain_text || 'Empleado';
    const pinRichText = empData.properties?.PIN_App?.rich_text?.[0]?.plain_text || '';
    const hasPin = Boolean(pinRichText && pinRichText.trim().length === 4);

    // Obtener puestos asignados y permisos
    const rolRelations = empData.properties?.Rol?.relation || [];
    let puestosNombres = [];
    const permissionsSet = new Set();
    for (const r of rolRelations.slice(0, 3)) {
      try {
        const pRes = await fetch(`https://api.notion.com/v1/pages/${r.id}`, { headers });
        if (pRes.ok) {
          const pData = await pRes.json();
          const pName = pData.properties?.['Nombre del puesto']?.title?.[0]?.plain_text || pData.properties?.Nombre?.title?.[0]?.plain_text;
          if (pName) puestosNombres.push(pName);
          const perms = pData.properties?.Permisos_App?.multi_select || [];
          perms.forEach(p => permissionsSet.add(p.name));
        }
      } catch (e) {}
    }
    const puestoStr = puestosNombres.length > 0 ? puestosNombres.join(', ') : 'Operativo';
    const permissions = Array.from(permissionsSet);

    // 4. Generar Ticket Efímero en Redis (TTL 120 segundos)
    const requestId = crypto.randomUUID();
    const ticketPayload = {
      id: requestId,
      employeeId,
      employeeName,
      puesto: puestoStr,
      puestos: puestosNombres,
      permissions: permissions.length > 0 ? permissions : ['Ver_Kardex'],
      hasPin,
      status: 'PENDING',
      createdAt: Date.now()
    };

    await executeRedis(env, 'SETEX', `pin_req:${requestId}`, 120, JSON.stringify(ticketPayload));
    await executeRedis(env, 'SETEX', `auth:cooldown:pin_req:${employeeId}`, 45, '1');

    // 5. Enviar Alerta Push Condicional a Mikel por Telegram
    const clientMeta = extractClientMeta(request);
    const { readable } = getVzlaTime();

    let botones = [];
    if (hasPin) {
      botones = [
        [
          {
            text: '✅ Aprobar modificar PIN en PC',
            callback_data: `2fa_appr_mod:${requestId}`
          }
        ],
        [
          {
            text: '❌ Rechazar Solicitud',
            callback_data: `2fa_reject:${requestId}`
          }
        ]
      ];
    } else {
      botones = [
        [
          {
            text: '🔑 Aprobar introducir PIN en PC',
            callback_data: `2fa_appr_new:${requestId}`
          }
        ],
        [
          {
            text: '⏱️ Aprobar sesión temporal (1h)',
            callback_data: `2fa_appr_temp:${requestId}`
          }
        ],
        [
          {
            text: '❌ Rechazar Solicitud',
            callback_data: `2fa_reject:${requestId}`
          }
        ]
      ];
    }

    const alertText = 
      `🔐 *Solicitud de Autenticación 2FA en PC*\n\n` +
      `👤 Empleado: *${employeeName}*\n` +
      `🏢 Puesto: ${puestoStr}\n` +
      `🔑 Condición: ${hasPin ? '✅ Tiene PIN registrado' : '⚠️ Sin PIN configurado'}\n` +
      `⏱️ Hora: ${readable}\n` +
      `💻 Terminal: ${clientMeta.canal} (\`${clientMeta.ip}\` - ${clientMeta.city})\n` +
      `⏳ *Expira en:* 120 segundos\n\n` +
      `Selecciona una acción para responder a la terminal:`;

    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: SUPERADMIN_TELEGRAM_ID,
        text: alertText,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: botones
        }
      })
    });

    if (!tgRes.ok) {
      const errText = await tgRes.text();
      console.error('Error enviando alerta 2FA a Telegram:', errText);
    }

    // 6. Registrar en auditoría
    recordAuditLog({
      env,
      context,
      request,
      eventType: 'PIN_REQUEST_2FA',
      employeeId,
      employeeName,
      puesto: puestoStr,
      area: 'Planta',
      isSuccess: true,
      details: `Solicitud 2FA iniciada en PC (${hasPin ? 'Modificar PIN' : 'Nuevo PIN / Sesión Temporal'}).`,
      alertSecurity: false
    });

    return new Response(JSON.stringify({
      ok: true,
      requestId,
      ttl: 120,
      hasPin,
      employeeName
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
