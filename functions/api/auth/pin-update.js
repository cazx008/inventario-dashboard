/**
 * Cloudflare Pages Functions — Actualización de PIN Operativo con Validación 2FA
 * Ruta: POST /api/auth/pin-update
 * 
 * Permite actualizar el PIN de 4 dígitos si:
 * 1. Viene respaldado por un 'oneTimeToken' firmado tras aprobación 2FA de Mikel en Telegram.
 * 2. O viene respaldado por un token JWT de sesión de Superadmin o del propio empleado autenticado.
 * 
 * Impacta directamente la propiedad 'PIN_App' en 'DB_Lista de empleados (Contactos)'
 * y asienta el evento forense en 'BD_Auditoria_Accesos_Logs'.
 */

import { verifyJWT } from './_utils.js';
import { executeRedis, recordAuditLog } from './_audit.js';

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

  const notionApiKey = env.NOTION_API_KEY;
  const botToken = env.TELEGRAM_BOT_TOKEN || DEFAULT_BOT_TOKEN;

  if (!notionApiKey) {
    return new Response(JSON.stringify({ error: 'NOTION_API_KEY no presente.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  try {
    const authHeader = request.headers.get('Authorization') || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : '';

    const body = await request.json().catch(() => ({}));
    const { employeeId, newPin, oneTimeToken } = body;
    const sessionToken = bearerToken || body.token;

    // 1. Validar formato del nuevo PIN (exactamente 4 dígitos numéricos)
    if (!newPin || !/^\d{4}$/.test(String(newPin).trim())) {
      return new Response(JSON.stringify({ error: 'El PIN debe contener exactamente 4 dígitos numéricos.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const cleanPin = String(newPin).trim();
    let isAuthorized = false;
    let authMethod = '';
    let targetEmployeeId = employeeId;

    // 2. Comprobar autorización vía 2FA One-Time Token (Prioridad en PC)
    if (oneTimeToken) {
      // Verificar si ya fue consumido (burn-after-reading)
      const tokenSig = oneTimeToken.split('.')[2] || oneTimeToken.substring(oneTimeToken.length - 16);
      const isBurned = await executeRedis(env, 'GET', `auth:burned_token:${tokenSig}`);
      if (isBurned) {
        return new Response(JSON.stringify({ error: 'Este token de aprobación 2FA ya fue utilizado previamente.' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      const approvalPayload = await verifyJWT(oneTimeToken, botToken);
      if (!approvalPayload || approvalPayload.type !== 'PIN_CHANGE_APPROVAL') {
        return new Response(JSON.stringify({ error: 'Token de aprobación 2FA inválido o expirado.' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      if (employeeId && approvalPayload.employeeId !== employeeId) {
        return new Response(JSON.stringify({ error: 'El token de aprobación no corresponde al empleado indicado.' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      targetEmployeeId = approvalPayload.employeeId || employeeId;
      isAuthorized = true;
      authMethod = '2FA Telegram Aprobado por Mikel';

      // Quemar token inmediatamente (TTL 300s)
      await executeRedis(env, 'SETEX', `auth:burned_token:${tokenSig}`, 300, 'BURNED');

    } else if (sessionToken) {
      // 3. Comprobar autorización vía sesión activa (Exclusiva para Superadmin)
      const caller = await verifyJWT(sessionToken, botToken);
      if (!caller) {
        return new Response(JSON.stringify({ error: 'Sesión inválida o expirada.' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      const isSuperadmin = (caller.permissions || []).includes('Superadmin');
      if (!isSuperadmin) {
        return new Response(JSON.stringify({
          error: 'Por política de seguridad Zero Trust, todo cambio o asignación de PIN requiere la autorización interactiva 2FA de Sistemas (Mikel) enviada a Telegram.'
        }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      targetEmployeeId = employeeId || caller.sub;
      authMethod = `Superadmin (${caller.name})`;
      isAuthorized = true;
    } else {
      return new Response(JSON.stringify({ error: 'No autorizado. Se requiere token 2FA de Sistemas o sesión de Superadmin.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    if (!isAuthorized || !targetEmployeeId) {
      return new Response(JSON.stringify({ error: 'Operación no autorizada.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 4. Actualizar la propiedad PIN_App en Notion
    const headers = {
      'Authorization': `Bearer ${notionApiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    };

    const patchRes = await fetch(`https://api.notion.com/v1/pages/${targetEmployeeId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        properties: {
          'PIN_App': {
            rich_text: [
              {
                text: { content: cleanPin }
              }
            ]
          }
        }
      })
    });

    if (!patchRes.ok) {
      const errText = await patchRes.text();
      return new Response(JSON.stringify({ error: `Error actualizando PIN en Notion: ${errText}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const patchData = await patchRes.json();
    const updatedName = patchData.properties?.Nombre?.title?.[0]?.plain_text || 'Empleado';

    // 5. Registrar evento en la bitácora de auditoría
    recordAuditLog({
      env,
      context,
      request,
      eventType: 'PIN_CHANGE_APPROVED',
      employeeId: targetEmployeeId,
      employeeName: updatedName,
      puesto: 'Personal',
      area: 'Planta',
      isSuccess: true,
      details: `PIN actualizado con éxito vía ${authMethod}.`,
      alertSecurity: false
    });

    return new Response(JSON.stringify({
      status: 'success',
      message: `PIN operativo asignado/actualizado con éxito para ${updatedName}.`,
      employeeId: targetEmployeeId,
      employeeName: updatedName
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
