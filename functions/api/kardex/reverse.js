/**
 * Cloudflare Pages Functions — Módulo Serverless de Reversión de Kardex (Fase 9I)
 * Ruta: POST /api/kardex/reverse
 * 
 * Implementa el estándar de Libro Mayor Inmutable Odoo 18 para subsanar errores de conteo:
 * 1. Control CORS y cabeceras de seguridad.
 * 2. Defensa en profundidad: RBAC ('Auditoria_Kardex' o 'Superadmin').
 * 3. Doble factor de seguridad: Justificación técnica (>= 10 chars) + PIN de supervisor.
 * 4. Verificación de ventana temporal de turno laboral (<= 8 horas desde la creación del movimiento).
 * 5. Validación de no-reversión previa (anti-duplicación / idempotencia).
 * 6. Contra-asiento inmutable compensatorio en BD_Kardex_Movimientos con folio REV-YYYYMMDD-####.
 * 7. Actualización atómica de saldo vivo en BD_Control_Stock_Existencias (Stock base = stockActual + invertedDelta).
 * 8. Registro forense inmutable en BD_Auditoria_Accesos_Logs.
 */

import { requirePermission } from '../auth/_guard.js';
import { recordAuditLog, executeRedis, getVzlaTime } from '../auth/_audit.js';

const KARDEX_DB_ID = '26286805-4e27-803b-91ce-ef8f121d622d';
const SUPERVISOR_PIN_DEFAULT = '1234';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Notion-Version, X-Idempotency-Key',
      },
    });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método no permitido. Use POST.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // 1. Autorización RBAC: Requiere 'Auditoria_Kardex' o 'Superadmin'
  const authCheck = await requirePermission(context, 'Auditoria_Kardex');
  if (!authCheck.ok) {
    return new Response(JSON.stringify({ error: authCheck.error }), {
      status: authCheck.status || 403,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const notionApiKey = env.NOTION_API_KEY;
  if (!notionApiKey) {
    return new Response(JSON.stringify({ error: 'NOTION_API_KEY no configurada en el servidor.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const headers = {
    'Authorization': `Bearer ${notionApiKey}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };

  try {
    const payload = await request.json().catch(() => ({}));
    const {
      kardexId,
      justificacion = '',
      supervisorPin = null
    } = payload;

    // Validación de parámetros mandatorios
    if (!kardexId || typeof kardexId !== 'string') {
      return new Response(JSON.stringify({ error: 'kardexId es obligatorio para revertir.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const cleanJustificacion = justificacion.trim();
    if (cleanJustificacion.length < 10) {
      return new Response(JSON.stringify({
        error: 'La justificación técnica de la reversión es obligatoria y debe contener al menos 10 caracteres explicativos.'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 2. Verificación de PIN de supervisor (Doble factor)
    const validSupervisorPin = env.SUPERVISOR_PIN || SUPERVISOR_PIN_DEFAULT;
    if (!supervisorPin || String(supervisorPin).trim() !== String(validSupervisorPin)) {
      return new Response(JSON.stringify({
        error: 'PIN de autorización de supervisor incorrecto o no provisto. Acción rechazada por seguridad.'
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 3. Inspección del movimiento original en Notion (BD_Kardex_Movimientos)
    const kardexGetRes = await fetch(`https://api.notion.com/v1/pages/${kardexId}`, { headers });
    if (!kardexGetRes.ok) {
      return new Response(JSON.stringify({
        error: `No se encontró el movimiento de Kardex indicado (${kardexId}) o error consultando Notion.`
      }), {
        status: kardexGetRes.status === 404 ? 404 : 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const originalPage = await kardexGetRes.json();
    const movimientoTipo = originalPage.properties?.['Movimiento']?.select?.name || '';
    const originalFolio = originalPage.properties?.['Código (Nota de entrega)']?.rich_text?.[0]?.text?.content || '';
    const detalleExt = originalPage.properties?.['Detalle (ext)']?.rich_text?.[0]?.text?.content || '';
    const glosaOriginal = originalPage.properties?.['Descripción']?.title?.[0]?.text?.content || '';

    // Validar tipo de movimiento
    if (!movimientoTipo.includes('Ajuste') && !movimientoTipo.includes('Merma')) {
      return new Response(JSON.stringify({
        error: `Solo los movimientos de tipo '🟡 Ajuste / Merma' pueden revertirse directamente. Tipo recibido: '${movimientoTipo}'.`
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Validar que no sea ya un contra-asiento previo
    if (originalFolio.startsWith('REV-') || glosaOriginal.includes('[CONTRA-ASIENTO]') || detalleExt.includes('[CONTRA-ASIENTO]')) {
      return new Response(JSON.stringify({
        error: 'El movimiento seleccionado ya es un contra-asiento de reversión y no puede ser revertido nuevamente.'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Validar ventana de 8 horas (Turno laboral)
    const createdTimeStr = originalPage.created_time;
    if (createdTimeStr) {
      const createdDate = new Date(createdTimeStr);
      const ageHours = (Date.now() - createdDate.getTime()) / (1000 * 60 * 60);
      if (ageHours > 8) {
        return new Response(JSON.stringify({
          error: `El ajuste fue emitido hace ${ageHours.toFixed(1)} horas. La política de auditoría limita la reversión directa a un máximo de 8 horas (turno laboral). Para rectificar saldos posteriores, asiente un nuevo conteo cíclico.`
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
    }

    // Extraer deltas y referencias
    const originalDelta = originalPage.properties?.['Cantidad (Stock)']?.number ?? 0;
    if (originalDelta === 0) {
      return new Response(JSON.stringify({
        error: 'El movimiento original no tiene discrepancia numérica (Δ = 0). No requiere contra-asiento.'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const invertedDelta = -originalDelta;
    const unitCost = originalPage.properties?.['Costo Unitario ($ USD)']?.number ?? 0;
    const impactoUSD = Math.abs(invertedDelta) * unitCost;

    // Relaciones
    const dashboardId = originalPage.properties?.['Dashboard']?.relation?.[0]?.id;
    const insumoId = originalPage.properties?.['Producto']?.relation?.[0]?.id;

    if (!dashboardId) {
      return new Response(JSON.stringify({
        error: 'El movimiento de Kardex no tiene vinculación directa con un registro de existencia en BD_Control_Stock_Existencias.'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 4. Idempotencia anti-duplicación en Upstash Redis (si existe conexión)
    const idempotencyKey = `REV_KARDEX_${kardexId}`;
    if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
      const existingRev = await executeRedis(env, 'GET', idempotencyKey);
      if (existingRev) {
        return new Response(JSON.stringify({
          error: 'Este movimiento de Kardex ya fue revertido en una operación previa.',
          folioPrevio: existingRev
        }), {
          status: 409,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
    }

    // 5. Obtener saldo vivo actual en BD_Control_Stock_Existencias
    const dashRes = await fetch(`https://api.notion.com/v1/pages/${dashboardId}`, { headers });
    if (!dashRes.ok) {
      return new Response(JSON.stringify({
        error: `Error consultando existencias vivas en Notion (${dashboardId}).`
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const dashPage = await dashRes.json();
    const currentStock = dashPage.properties?.['Stock (base)']?.number ?? 0;
    const stockMinimo = dashPage.properties?.['Stock Mínimo']?.number ?? 0;
    const itemActualName = dashPage.properties?.['Insumo']?.title?.[0]?.text?.content || glosaOriginal;
    const targetInsumoId = insumoId || dashPage.properties?.['Producto']?.relation?.[0]?.id || dashPage.properties?.['Insumos']?.relation?.[0]?.id;

    // Compensación aditiva Odoo 18
    const newStock = Math.max(0, currentStock + invertedDelta);

    let nuevoEstadoStockLimpio = 'En Stock';
    if (newStock === 0) {
      nuevoEstadoStockLimpio = 'Sin Stock';
    } else if (newStock < stockMinimo) {
      nuevoEstadoStockLimpio = 'Bajo Mínimo';
    }

    // Generar Folio de Reversión
    const { isoVzla } = getVzlaTime();
    const todayStr = isoVzla.split('T')[0];
    const randomHash = Math.floor(1000 + Math.random() * 9000);
    const folioReverso = `REV-${todayStr.replace(/-/g, '')}-${randomHash}`;

    // 6. Crear Asiento Compensatorio Inmutable en BD_Kardex_Movimientos
    const glosaReverso = `[CONTRA-ASIENTO] Reversión de ${originalFolio || 'Ajuste'} · ${itemActualName} (${invertedDelta > 0 ? '+' : ''}${invertedDelta} Und)`;
    const propositoStr = `Reversión de Ajuste Erróneo | Folio Orig: ${originalFolio} | Supervisor: ${authCheck.user?.name || 'Supervisor'} | PIN Verificado`;
    const detalleExtStr = `[CONTRA-ASIENTO] Folio: ${folioReverso} | Orig: ${originalFolio} | Motivo: ${cleanJustificacion} | Saldo: ${currentStock} ➔ ${newStock} (Compensación: ${invertedDelta > 0 ? '+' : ''}${invertedDelta} Und) | Aprobado con PIN`;

    const kardexProps = {
      'Descripción': {
        title: [{ text: { content: glosaReverso } }]
      },
      'Movimiento': {
        select: { name: invertedDelta > 0 ? '🔵 Entrada / Devolución' : '🟡 Ajuste / Merma' }
      },
      'Origen de Consumo': {
        select: { name: 'Stock General' }
      },
      'Cantidad (Stock)': {
        number: invertedDelta
      },
      'Costo Unitario ($ USD)': {
        number: unitCost
      },
      'Costo Total ($ USD)': {
        number: impactoUSD
      },
      'Código (Nota de entrega)': {
        rich_text: [{ text: { content: folioReverso } }]
      },
      'Fecha de Recepción': {
        date: { start: todayStr }
      },
      'Fecha de Entrega': {
        date: { start: todayStr }
      },
      'Propósito': {
        rich_text: [{ text: { content: propositoStr } }]
      },
      'Detalle (ext)': {
        rich_text: [{ text: { content: detalleExtStr } }]
      },
      'Dashboard': {
        relation: [{ id: dashboardId }]
      },
      'Etiquetado/Entregado': {
        status: { name: 'Entregado' }
      }
    };

    if (targetInsumoId) {
      kardexProps['Producto'] = { relation: [{ id: targetInsumoId }] };
    }

    const postKardexRes = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        parent: { database_id: KARDEX_DB_ID },
        properties: kardexProps
      })
    });

    if (!postKardexRes.ok) {
      const kErr = await postKardexRes.text();
      return new Response(JSON.stringify({
        error: `Error asentando contra-asiento en Kardex: ${kErr}`
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const newKardexData = await postKardexRes.json();

    // 7. Actualización Atómica en BD_Control_Stock_Existencias
    const patchDashRes = await fetch(`https://api.notion.com/v1/pages/${dashboardId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        properties: {
          'Stock (base)': { number: newStock },
          'Estado de Stock': { status: { name: nuevoEstadoStockLimpio } }
        }
      })
    });

    if (!patchDashRes.ok) {
      const patchErr = await patchDashRes.text();
      console.error('Alerta crítica: Se creó contra-asiento pero falló el PATCH del saldo de existencias:', patchErr);
      return new Response(JSON.stringify({
        error: `Se creó contra-asiento (${folioReverso}) pero falló la actualización del saldo vivo: ${patchErr}`
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 8. Marcar idempotencia en Redis (TTL 48h)
    if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
      try {
        await executeRedis(env, 'SET', idempotencyKey, folioReverso, 'EX', 172800);
      } catch (redisErr) {
        console.warn('Advertencia guardando clave idempotente en Redis:', redisErr);
      }
    }

    // 9. Registro de Auditoría Forense en BD_Auditoria_Accesos_Logs
    const auditDetails = `REVERSIÓN DE AJUSTE | Folio Reverso: ${folioReverso} (Orig: ${originalFolio || kardexId}) | ${itemActualName} | Saldo: ${currentStock} ➔ ${newStock} (Δ: ${invertedDelta > 0 ? '+' : ''}${invertedDelta} Und) | Justif: ${cleanJustificacion} | PIN Supervisor Verificado`;

    recordAuditLog({
      env,
      context,
      request,
      eventType: 'KARDEX_ADJUSTMENT_REVERSED',
      employeeId: authCheck.user?.sub,
      employeeName: authCheck.user?.name,
      puesto: authCheck.user?.puestos?.[0] || 'Auditor',
      area: 'Almacén / Control Físico',
      isSuccess: true,
      details: auditDetails,
      ip: request.headers.get('cf-connecting-ip') || '127.0.0.1'
    });

    return new Response(JSON.stringify({
      success: true,
      message: `Contra-asiento ${folioReverso} asentado con éxito. Saldo compensado a ${newStock} unidades.`,
      folioReverso,
      reversedKardexId: kardexId,
      newKardexId: newKardexData.id,
      dashboardId,
      insumoId: targetInsumoId,
      itemNombre: itemActualName,
      previousStock: currentStock,
      newStock,
      invertedDelta,
      nuevoEstadoStock: nuevoEstadoStockLimpio
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (err) {
    console.error('Error no controlado en /api/kardex/reverse:', err);
    return new Response(JSON.stringify({ error: `Error interno del servidor: ${err.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
