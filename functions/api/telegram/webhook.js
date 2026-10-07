/**
 * Cloudflare Pages Functions — Webhook de Telegram para Callbacks Interactivos
 * Ruta: POST /api/telegram/webhook
 * 
 * Procesa los eventos interactivos de botones en línea (Inline Keyboards) de Telegram:
 * 1. Callback 'cost_audit:<folio>':
 *    - Valida que el usuario de Telegram tenga rol de Mando / Dirección General.
 *    - Si está autorizado, consulta el snapshot congelado en Upstash Redis y devuelve un modal privado.
 *    - Si no está autorizado, responde con una alerta emergente de denegación.
 */

import { executeRedis, SUPERADMIN_TELEGRAM_ID } from '../auth/_audit.js';

const DEFAULT_BOT_TOKEN = '8818827554:AAFtwP7rGOLjIrtYVC1UZfYIv0QbZq8f7cM';

// IDs autorizados con rol de Dirección General / Mando para ver cifras financieras
const AUTHORIZED_TELEGRAM_IDS = new Set([
  SUPERADMIN_TELEGRAM_ID, // Mikel Alexander Itriago
  5971168128             // Magaly / Dirección
]);

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
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const botToken = env.TELEGRAM_BOT_TOKEN || DEFAULT_BOT_TOKEN;

  try {
    const update = await request.json();

    // Procesar evento de botón pulsado (Callback Query)
    if (update.callback_query) {
      const cq = update.callback_query;
      const data = cq.data || '';
      const fromId = cq.from?.id;
      const callbackQueryId = cq.id;

      if (data.startsWith('cost_audit:')) {
        const folio = data.replace('cost_audit:', '').trim();

        // 1. Verificación de Seguridad y Permisos RBAC
        const isAuthorized = AUTHORIZED_TELEGRAM_IDS.has(fromId);

        if (!isAuthorized) {
          // Denegación de acceso interactiva
          await answerCallback(botToken, callbackQueryId, {
            text: '⛔ Acceso restringido: Las cifras financieras de merma solo están autorizadas para Dirección General y Auditoría.',
            show_alert: true
          });

          return new Response(JSON.stringify({ status: 'denied', folio, fromId }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // 2. Usuario autorizado: Recuperar snapshot confidencial congelado en Redis
        let snapshot = null;
        try {
          const rawSnap = await executeRedis(env, 'GET', `telegram:adj_cost:${folio}`);
          if (rawSnap) {
            snapshot = typeof rawSnap === 'string' ? JSON.parse(rawSnap) : rawSnap;
          }
        } catch (rErr) {
          console.warn('Error leyendo snapshot de costo en Redis:', rErr);
        }

        if (!snapshot) {
          await answerCallback(botToken, callbackQueryId, {
            text: `ℹ️ El desglose financiero para el folio ${folio} no está disponible en caché o la ventana de 7 días ha expirado.`,
            show_alert: true
          });

          return new Response(JSON.stringify({ status: 'not_found', folio }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // 3. Formatear reporte confidencial privado en ventana emergente (modal nativo)
        const modalText = [
          `🔒 AUDITORÍA FINANCIERA DE AJUSTE`,
          `────────────────────────`,
          `📦 Material: ${snapshot.itemNombre}`,
          `📉 Descuadre Físico: ${snapshot.delta} ${snapshot.unidad}`,
          `💵 Costo Base Catálogo: $${Number(snapshot.unitCost || 0).toFixed(2)} USD`,
          `💰 Impacto Total USD: $${Number(snapshot.impactoUSD || 0).toFixed(2)} USD`,
          `🇻🇪 Impacto en Bs (BCV): Bs. ${Number(snapshot.impactoBs || 0).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`,
          `────────────────────────`,
          `👤 Auditor: ${snapshot.auditor}`,
          `🔑 Autorizó: ${snapshot.supervisor}`,
          `🔖 Folio: ${folio}`
        ].join('\n');

        await answerCallback(botToken, callbackQueryId, {
          text: modalText,
          show_alert: true
        });

        return new Response(JSON.stringify({ status: 'authorized', folio }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response(JSON.stringify({ status: 'ignored' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error procesando webhook de Telegram:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function answerCallback(botToken, callbackQueryId, { text, show_alert = false }) {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text,
        show_alert
      })
    });
  } catch (err) {
    console.warn('Fallo enviando answerCallbackQuery a Telegram:', err);
  }
}
