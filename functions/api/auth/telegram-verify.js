/**
 * Cloudflare Pages Functions — Verificación de Identidad Telegram Mini App
 * Ruta: POST /api/auth/telegram-verify
 * 
 * Valida la firma criptográfica HMAC-SHA-256 de initData y resuelve los permisos
 * del empleado consultando su puesto en la base de datos de Notion.
 */

import { verifyTelegramInitData, signJWT } from './_utils.js';
import { recordAuditLog } from './_audit.js';

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

  const botToken = env.TELEGRAM_BOT_TOKEN || DEFAULT_BOT_TOKEN;
  const notionApiKey = env.NOTION_API_KEY;

  if (!notionApiKey) {
    return new Response(JSON.stringify({ error: 'Configuración de servidor incompleta: NOTION_API_KEY no presente.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  try {
    const body = await request.json();
    const { initData, forceRefresh } = body;

    if (!initData) {
      return new Response(JSON.stringify({ error: 'Se requiere el parámetro initData de Telegram.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 1. Verificación Criptográfica HMAC-SHA256 (Anti-Spoofing & Anti-Replay)
    const verification = await verifyTelegramInitData(initData, botToken, 86400);
    if (!verification.isValid) {
      return new Response(JSON.stringify({
        status: 'invalid_token',
        error: 'Firma criptográfica inválida o token expirado.',
        details: verification.reason
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const telegramUser = verification.user;
    if (!telegramUser || !telegramUser.id) {
      return new Response(JSON.stringify({ error: 'No se encontraron datos de usuario en initData.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const headers = {
      'Authorization': `Bearer ${notionApiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    };

    // 2. Buscar al empleado en Notion por Telegram_ID (activo y no despedido)
    const empRes = await fetch(`https://api.notion.com/v1/databases/${EMPLEADOS_DB_ID}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        filter: {
          and: [
            { property: 'Telegram_ID', number: { equals: telegramUser.id } },
            { property: 'Despedido', checkbox: { equals: false } }
          ]
        },
        page_size: 1
      })
    });

    if (!empRes.ok) {
      const errText = await empRes.text();
      return new Response(JSON.stringify({ error: `Error consultando Notion: ${errText}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const empData = await empRes.json();
    const emp = empData.results?.[0];

    // Triple Barrera de Exclusión - Regla 1: No encontrado o despedido
    if (!emp) {
      return new Response(JSON.stringify({
        status: 'denied',
        reason: 'USER_NOT_REGISTERED_OR_TERMINATED',
        message: 'Tu cuenta de Telegram no está registrada o está inactiva en el sistema de personal de Sanesca.',
        telegramId: telegramUser.id,
        telegramUsername: telegramUser.username || null
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const employeeName = emp.properties.Nombre?.title?.[0]?.plain_text || telegramUser.first_name || 'Empleado';
    const rolesRelations = emp.properties.Rol?.relation || [];

    // Triple Barrera de Exclusión - Regla 2: Sin puestos vinculados
    if (rolesRelations.length === 0) {
      return new Response(JSON.stringify({
        status: 'denied',
        reason: 'NO_POSITION_ASSIGNED',
        message: `${employeeName}, no tienes ningún puesto de trabajo asignado en el sistema de personal.`,
        employeeName
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 3. Resolver la Unión Aditiva de Permisos desde 'Puestos de trabajo'
    const permissionsSet = new Set();
    const roleNames = [];

    for (const r of rolesRelations) {
      try {
        const puestoRes = await fetch(`https://api.notion.com/v1/pages/${r.id}`, { headers });
        if (puestoRes.ok) {
          const puestoData = await puestoRes.json();
          const pName = puestoData.properties.Nombre?.title?.[0]?.plain_text || 'Puesto';
          roleNames.push(pName);
          const perms = puestoData.properties.Permisos_App?.multi_select || [];
          perms.forEach(p => permissionsSet.add(p.name));
        }
      } catch (errPuesto) {
        console.warn('Error resolviendo puesto:', errPuesto.message);
      }
    }

    const permissions = Array.from(permissionsSet);

    // Triple Barrera de Exclusión - Regla 3: Puestos sin permisos
    if (permissions.length === 0) {
      return new Response(JSON.stringify({
        status: 'denied',
        reason: 'NO_PERMISSIONS_CONFIGURED',
        message: `${employeeName}, tus puestos asignados (${roleNames.join(', ')}) no cuentan con permisos para operar este módulo.`,
        employeeName,
        puestos: roleNames
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 4. Generar Token JWT de Sesión (TTL 5 minutos / 300 segundos)
    const jwtSecret = botToken; // Clave secreta robusta compartida
    const tokenPayload = {
      sub: telegramUser.id,
      name: employeeName,
      puestos: roleNames,
      permissions,
      authMethod: 'telegram',
      exp: Math.floor(Date.now() / 1000) + 300 // 5 minutos
    };

    const token = await signJWT(tokenPayload, jwtSecret);

    recordAuditLog({
      env,
      context,
      request,
      eventType: 'LOGIN_SUCCESS_TELEGRAM',
      employeeId: emp.id,
      employeeName,
      puesto: roleNames.join(', '),
      area: 'Planta',
      isSuccess: true,
      details: `Autenticación criptográfica HMAC exitosa vía Telegram Mini App (@${telegramUser.username || telegramUser.id}).`
    });

    return new Response(JSON.stringify({
      status: 'success',
      token,
      profile: {
        id: telegramUser.id,
        name: employeeName,
        username: telegramUser.username || null,
        puestos: roleNames,
        permissions,
        expiresIn: 300
      }
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Excepción interna de autenticación: ${err.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
