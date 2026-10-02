/**
 * Cloudflare Pages Functions — Módulo de Alertas Automatizadas por Telegram
 * Ruta: POST /api/telegram/notify (o invocación directa vía sendTelegramAlert)
 * 
 * Envía notificaciones operativas enriquecidas a Gerencia y Compras
 * al canal oficial de Sanesca (-1003139956223) mediante el bot oficial.
 */

const DEFAULT_BOT_TOKEN = '8818827554:AAFtwP7rGOLjIrtYVC1UZfYIv0QbZq8f7cM';
const DEFAULT_CHAT_ID = '-1003139956223';

/**
 * Función interna para despachar mensajes a Telegram con control de timeout defensivo.
 */
export async function sendTelegramAlert({
  env = {},
  text,
  buttons = [],
  threadId = null
}) {
  const botToken = env.TELEGRAM_BOT_TOKEN || DEFAULT_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID || DEFAULT_CHAT_ID;

  if (!botToken || !chatId) {
    console.info('[Telegram Alert Simulado]:', text);
    return {
      status: 'simulated_local',
      message: 'Credenciales de Telegram no configuradas; alerta registrada localmente.'
    };
  }

  const payload = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: false
  };

  if (threadId) {
    payload.message_thread_id = Number(threadId);
  }

  if (buttons && Array.isArray(buttons) && buttons.length > 0) {
    payload.reply_markup = {
      inline_keyboard: buttons
    };
  }

  // Timeout de seguridad de 3.5 segundos con AbortController
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500);

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[Telegram API Error ${res.status}]:`, errText);
      return { status: 'telegram_error', code: res.status, details: errText };
    }

    const data = await res.json();
    return { status: 'success', data };
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn('[Telegram Alert Timeout/Excepción]:', err.message);
    return { status: 'network_timeout_or_error', error: err.message };
  }
}

/**
 * Handler HTTP para pruebas o triggers externos
 */
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
    return new Response(JSON.stringify({ error: 'Método no permitido. Utilice POST.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  try {
    const body = await request.json();
    const { text, buttons, threadId } = body;

    if (!text) {
      return new Response(JSON.stringify({ error: 'El parámetro text es requerido.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const result = await sendTelegramAlert({ env, text, buttons, threadId });
    return new Response(JSON.stringify(result), {
      status: result.status === 'success' || result.status === 'simulated_local' ? 200 : 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
