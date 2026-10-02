/**
 * Cloudflare Pages Functions — Autenticación por PIN para Navegadores PC
 * Ruta: POST /api/auth/pin-verify
 * 
 * Permite a los usuarios identificarse en computadoras de oficina mediante PIN de 4 dígitos.
 * Protegido activamente contra fuerza bruta en Upstash Redis (bloqueo al 3er fallo consecutivo)
 * y auditado forensemente en Notion 'BD_Auditoria_Accesos_Logs'.
 */

import { signJWT } from './_utils.js';
import {
  checkLockout,
  recordFailedPinAttempt,
  resetFailedPinAttempts,
  recordAuditLog
} from './_audit.js';

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
    return new Response(JSON.stringify({ error: 'NOTION_API_KEY no presente en servidor.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { employeeId, pin } = body;

    if (!employeeId || !pin) {
      return new Response(JSON.stringify({ error: 'Se requiere employeeId y PIN de 4 dígitos.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 1. Validar bloqueo previo por fuerza bruta (Upstash Redis)
    const lockInfo = await checkLockout(env, employeeId);
    if (lockInfo.locked) {
      const waitMin = Math.ceil(lockInfo.remainingSeconds / 60);
      return new Response(JSON.stringify({
        status: 'locked_out',
        error: `Terminal bloqueada temporalmente por 10 minutos tras 3 intentos fallidos. Reintente en ${waitMin} min o solicite desbloqueo a Sistemas.`,
        locked: true,
        remainingSeconds: lockInfo.remainingSeconds
      }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const headers = {
      'Authorization': `Bearer ${notionApiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    };

    // 2. Buscar al empleado en Notion
    const empRes = await fetch(`https://api.notion.com/v1/pages/${employeeId}`, { headers });
    if (!empRes.ok) {
      return new Response(JSON.stringify({ error: 'Empleado no encontrado en Notion.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const emp = await empRes.json();
    const isTerminated = emp.properties?.Despedido?.checkbox === true;
    const employeeName = emp.properties?.Nombre?.title?.[0]?.plain_text || 'Empleado';

    if (isTerminated) {
      recordAuditLog({
        env,
        context,
        request,
        eventType: 'ACCESS_DENIED',
        employeeId,
        employeeName,
        puesto: 'Inactivo',
        area: 'Ninguna',
        isSuccess: false,
        details: 'Intento de acceso denegado: empleado despedido/inactivo.',
        alertSecurity: true
      });

      return new Response(JSON.stringify({
        status: 'denied',
        reason: 'USER_TERMINATED',
        error: 'Este colaborador figura como inactivo en el sistema.'
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const configuredPin = emp.properties?.PIN_App?.rich_text?.[0]?.plain_text?.trim();

    // 3. Obtener nombres de puestos asignados para telemetría
    const rolesRelations = emp.properties?.Rol?.relation || [];
    const permissionsSet = new Set();
    const roleNames = [];

    for (const r of rolesRelations) {
      try {
        const puestoRes = await fetch(`https://api.notion.com/v1/pages/${r.id}`, { headers });
        if (puestoRes.ok) {
          const puestoData = await puestoRes.json();
          const pName = puestoData.properties?.Nombre?.title?.[0]?.plain_text || 'Puesto';
          roleNames.push(pName);
          const perms = puestoData.properties?.Permisos_App?.multi_select || [];
          perms.forEach(p => permissionsSet.add(p.name));
        }
      } catch (errP) {
        console.warn('Error resolviendo puesto en PIN verify:', errP.message);
      }
    }
    const puestoStr = roleNames.length > 0 ? roleNames.join(', ') : 'Operativo';

    // 4. Comparación de PIN
    if (!configuredPin || configuredPin !== String(pin).trim()) {
      // Registrar intento fallido y evaluar si se dispara el bloqueo de 10 min
      const attemptRes = await recordFailedPinAttempt(env, {
        employeeId,
        employeeName,
        puesto: puestoStr,
        request
      });

      recordAuditLog({
        env,
        context,
        request,
        eventType: 'LOGIN_FAILED_PIN',
        employeeId,
        employeeName,
        puesto: puestoStr,
        area: 'Planta',
        isSuccess: false,
        details: `PIN incorrecto (Fallo ${attemptRes.streak} de 3).${attemptRes.locked ? ' Terminal bloqueada 10 min.' : ''}`,
        alertSecurity: attemptRes.locked
      });

      if (attemptRes.locked) {
        return new Response(JSON.stringify({
          status: 'locked_out',
          error: 'Has superado el límite de 3 intentos. Terminal bloqueada por 10 minutos. Se ha enviado una alerta a Sistemas.',
          locked: true,
          remainingSeconds: 600,
          intentosRestantes: 0
        }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      const remaining = Math.max(0, 3 - attemptRes.streak);
      return new Response(JSON.stringify({
        status: 'invalid_pin',
        error: `PIN incorrecto. Te quedan ${remaining} ${remaining === 1 ? 'intento' : 'intentos'}.`,
        intentosRestantes: remaining,
        locked: false
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 5. PIN Correcto: Resetear contador de fallos
    await resetFailedPinAttempts(env, employeeId);

    const permissions = Array.from(permissionsSet);
    if (permissions.length === 0) {
      recordAuditLog({
        env,
        context,
        request,
        eventType: 'ACCESS_DENIED',
        employeeId,
        employeeName,
        puesto: puestoStr,
        area: 'Planta',
        isSuccess: false,
        details: 'Empleado sin permisos asignados en Puestos de trabajo.',
        alertSecurity: false
      });

      return new Response(JSON.stringify({
        status: 'denied',
        reason: 'NO_PERMISSIONS',
        error: 'Este empleado no tiene puestos con permisos activos en el sistema.'
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 6. Emitir JWT de sesión (TTL 8 horas / turno laboral)
    const tokenPayload = {
      sub: employeeId,
      name: employeeName,
      puestos: roleNames,
      permissions,
      authMethod: 'pin',
      exp: Math.floor(Date.now() / 1000) + (8 * 3600)
    };

    const token = await signJWT(tokenPayload, botToken);

    // 7. Asentar inicio de sesión exitoso en la bitácora
    recordAuditLog({
      env,
      context,
      request,
      eventType: 'LOGIN_SUCCESS_PIN',
      employeeId,
      employeeName,
      puesto: puestoStr,
      area: 'Planta',
      isSuccess: true,
      details: 'Inicio de sesión exitoso con PIN operativo en terminal PC.',
      alertSecurity: false
    });

    return new Response(JSON.stringify({
      status: 'success',
      token,
      profile: {
        id: employeeId,
        name: employeeName,
        puestos: roleNames,
        permissions,
        expiresIn: 8 * 3600
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Excepción interna en PIN: ${err.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
