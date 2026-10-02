/**
 * Módulo Serverless de Auditoría Forense, Telemetría y Defensa Anti-Fuerza Bruta
 * Archivo: functions/api/auth/_audit.js
 * 
 * Stack: Cloudflare Pages Functions + Upstash Redis (REST) + Notion API (BD_Auditoria_Accesos_Logs)
 */

export const AUDIT_DB_ID = '3ec86805-4e27-8111-8cc9-fcfb594f3b1e';
export const SUPERADMIN_TELEGRAM_ID = 1143226405;
const DEFAULT_BOT_TOKEN = '8818827554:AAFtwP7rGOLjIrtYVC1UZfYIv0QbZq8f7cM';
const DEFAULT_REDIS_URL = 'https://blessed-gelding-291298.upstash.io';
const DEFAULT_REDIS_TOKEN = 'gQAAAAAABHHiAAIgcDI3N2U3MjBjMDI4Mjg0ZWRjYmY5MjU5N2FhODAxOGQwMQ';

export function getRedisConfig(env) {
  return {
    url: env.UPSTASH_REDIS_REST_URL || DEFAULT_REDIS_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN || DEFAULT_REDIS_TOKEN
  };
}

/**
 * Ejecuta un comando único en Upstash Redis
 */
export async function executeRedis(env, ...cmd) {
  const { url, token } = getRedisConfig(env);
  try {
    const res = await fetch(`${url}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(cmd)
    });
    const data = await res.json();
    return data.result;
  } catch (err) {
    console.error('[_audit.js] Error executeRedis:', err);
    return null;
  }
}

/**
 * Ejecuta un pipeline de comandos en Upstash Redis
 */
export async function executeRedisPipeline(env, commands) {
  const { url, token } = getRedisConfig(env);
  try {
    const res = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(commands)
    });
    return await res.json();
  } catch (err) {
    console.error('[_audit.js] Error executeRedisPipeline:', err);
    return [];
  }
}

/**
 * Obtiene la hora formateada en Venezuela (VET: UTC-4) y detecta horario inusual
 */
export function getVzlaTime() {
  const now = new Date();
  const vzlaOffsetMs = -4 * 60 * 60 * 1000;
  const vzlaDate = new Date(now.getTime() + vzlaOffsetMs);

  const hours = vzlaDate.getUTCHours();
  const minutes = vzlaDate.getUTCMinutes();
  const dayOfWeek = vzlaDate.getUTCDay(); // 0 = Domingo

  // Horario habitual de planta y taller: Lunes a Sábado, 06:30 a 17:30
  const isSunday = dayOfWeek === 0;
  const isTooEarly = hours < 6 || (hours === 6 && minutes < 30);
  const isTooLate = hours > 17 || (hours === 17 && minutes > 30);
  const isHorarioInusual = isSunday || isTooEarly || isTooLate;

  const yyyy = vzlaDate.getUTCFullYear();
  const mm = String(vzlaDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(vzlaDate.getUTCDate()).padStart(2, '0');
  const hh = String(hours).padStart(2, '0');
  const min = String(minutes).padStart(2, '0');
  const ss = String(vzlaDate.getUTCSeconds()).padStart(2, '0');

  const isoVzla = `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}-04:00`;
  const readable = `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss} VET`;

  return { isoVzla, readable, isHorarioInusual };
}

/**
 * Extrae metadatos forenses de la petición HTTP
 */
export function extractClientMeta(request) {
  if (!request) return { ip: 'N/A', city: 'N/A', country: 'VE', ray: 'N/A', userAgent: 'N/A', canal: 'PC Oficina' };

  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || '127.0.0.1';
  const country = request.headers.get('cf-ipcountry') || 'VE';
  const city = request.headers.get('cf-ipcity') || 'Caracas';
  const ray = request.headers.get('cf-ray') || 'N/A';
  const userAgent = request.headers.get('user-agent') || 'Desconocido';

  let canal = 'PC Oficina (Chrome)';
  if (userAgent.includes('Edg/')) canal = 'PC Oficina (Edge)';
  else if (userAgent.includes('Firefox/')) canal = 'PC Oficina (Firefox)';
  else if (userAgent.includes('Telegram')) canal = 'Telegram Mobile (Mini App)';

  return { ip, country, city, ray, userAgent, canal };
}

/**
 * Verifica si un empleado está bajo bloqueo temporal por fuerza bruta
 */
export async function checkLockout(env, employeeId) {
  if (!employeeId) return { locked: false, remainingSeconds: 0 };
  const ttl = await executeRedis(env, 'TTL', `auth:lockout:${employeeId}`);
  if (typeof ttl === 'number' && ttl > 0) {
    return { locked: true, remainingSeconds: ttl };
  }
  return { locked: false, remainingSeconds: 0 };
}

/**
 * Registra un intento fallido de PIN, evalúa si alcanza 3 y activa el bloqueo de 10 min
 */
export async function recordFailedPinAttempt(env, { employeeId, employeeName, puesto, request }) {
  const botToken = env.TELEGRAM_BOT_TOKEN || DEFAULT_BOT_TOKEN;
  const meta = extractClientMeta(request);
  const { readable, isoVzla } = getVzlaTime();

  // Incrementa contador de fallos consecutivos (TTL 600s / 10m)
  const pipe = await executeRedisPipeline(env, [
    ['INCR', `auth:failed_streak:${employeeId}`],
    ['EXPIRE', `auth:failed_streak:${employeeId}`, 600],
    ['INCR', `auth:attempts:24h:${employeeId}`],
    ['EXPIRE', `auth:attempts:24h:${employeeId}`, 86400]
  ]);

  const streak = pipe[0]?.result || 1;

  if (streak >= 3) {
    // Activa bloqueo temporal de 10 minutos (600s)
    await executeRedis(env, 'SETEX', `auth:lockout:${employeeId}`, 600, 'LOCKED');

    // Alerta de emergencia a Mikel por Telegram
    const alertMsg = 
      `🚨 *ALERTA DE SEGURIDAD: 3 Intentos Fallidos de PIN*\n\n` +
      `👤 Empleado: *${employeeName || 'Desconocido'}*\n` +
      `🏢 Puesto: ${puesto || 'Sin Puesto'}\n` +
      `⏱️ Hora: ${readable}\n` +
      `🌐 IP: \`${meta.ip}\` (${meta.city}, ${meta.country})\n` +
      `💻 Terminal: ${meta.canal}\n` +
      `🔒 Estado: *Terminal bloqueada por 10 minutos*\n\n` +
      `¿Deseas desbloquear a este colaborador de inmediato?`;

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: SUPERADMIN_TELEGRAM_ID,
        text: alertMsg,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🔓 Desbloquear Inmediatamente',
                callback_data: `unlock_pin:${employeeId}`
              }
            ]
          ]
        }
      })
    }).catch(e => console.error('Error enviando alerta lockout a Mikel:', e));

    return { locked: true, streak, remainingSeconds: 600 };
  }

  return { locked: false, streak, remainingSeconds: 0 };
}

/**
 * Resetea el contador de fallos cuando el login es exitoso
 */
export async function resetFailedPinAttempts(env, employeeId) {
  if (!employeeId) return;
  await executeRedis(env, 'DEL', `auth:failed_streak:${employeeId}`);
}

/**
 * Asienta un evento completo de auditoría en Redis (<20ms) y en Notion (asíncrono)
 */
export function recordAuditLog({ env, context, request, eventType, employeeId, employeeName, puesto, area, isSuccess, details, alertSecurity }) {
  const meta = extractClientMeta(request);
  const { isoVzla, readable, isHorarioInusual } = getVzlaTime();
  const notionApiKey = env.NOTION_API_KEY;

  const shouldAlert = alertSecurity || isHorarioInusual || !isSuccess;

  const eventPayload = {
    id: crypto.randomUUID(),
    eventType,
    employeeId,
    employeeName: employeeName || 'Desconocido',
    puesto: puesto || 'N/A',
    area: area || 'N/A',
    isSuccess: Boolean(isSuccess),
    details: details || '',
    meta,
    isHorarioInusual,
    timestamp: isoVzla,
    readable
  };

  // 1. Guardar en Redis: Lista rotativa de 200 eventos recientes
  const redisPromise = executeRedisPipeline(env, [
    ['LPUSH', 'auth:recent:logs', JSON.stringify(eventPayload)],
    ['LTRIM', 'auth:recent:logs', 0, 199]
  ]);

  // 2. Persistir en Notion en segundo plano
  const notionPromise = (async () => {
    if (!notionApiKey) return;
    try {
      const titleStr = `[${eventType}] ${employeeName || 'Usuario'} - ${readable.split(' ')[0]}`;
      const detalleCompleto = `${details || ''} | IP: ${meta.ip} (${meta.city}, ${meta.country}) | Ray: ${meta.ray} | UA: ${meta.userAgent.substring(0, 100)}${isHorarioInusual ? ' | ⚠️ HORARIO_INUSUAL' : ''}`;

      const properties = {
        'Evento': {
          title: [{ text: { content: titleStr.substring(0, 200) } }]
        },
        'Fecha_Hora': {
          date: { start: isoVzla }
        },
        'Tipo_Evento': {
          select: { name: eventType }
        },
        'Puesto_Area': {
          rich_text: [{ text: { content: `${puesto || 'Sin Puesto'} - ${area || 'Sin Área'}`.substring(0, 200) } }]
        },
        'Canal_Entorno': {
          select: { name: meta.canal }
        },
        'Direccion_IP': {
          rich_text: [{ text: { content: meta.ip } }]
        },
        'Ubicacion_CF': {
          rich_text: [{ text: { content: `${meta.city}, ${meta.country}` } }]
        },
        'Detalle_Forense': {
          rich_text: [{ text: { content: detalleCompleto.substring(0, 1900) } }]
        },
        'Alerta_Seguridad': {
          checkbox: Boolean(shouldAlert)
        }
      };

      const cleanEmpId = typeof employeeId === 'string' ? employeeId.trim() : '';
      const isUuid = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(cleanEmpId);
      if (cleanEmpId && isUuid) {
        const rawHex = cleanEmpId.replace(/-/g, '');
        const formattedId = `${rawHex.slice(0, 8)}-${rawHex.slice(8, 12)}-${rawHex.slice(12, 16)}-${rawHex.slice(16, 20)}-${rawHex.slice(20)}`;
        properties['Empleado'] = {
          relation: [{ id: formattedId }]
        };
      }

      await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${notionApiKey}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          parent: { database_id: AUDIT_DB_ID },
          properties
        })
      });
    } catch (e) {
      console.error('[_audit.js] Error escribiendo log a Notion:', e);
    }
  })();

  const allWork = Promise.all([redisPromise, notionPromise]);

  if (context && typeof context.waitUntil === 'function') {
    context.waitUntil(allWork);
  } else {
    allWork.catch(e => console.error('[_audit.js] Error en background tasks:', e));
  }
}
