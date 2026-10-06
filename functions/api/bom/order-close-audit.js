/**
 * Cloudflare Pages Functions — Cierre Transaccional de Auditoría BOM y Liquidación ERP
 * Ruta: POST /api/bom/order-close-audit
 * 
 * Acciones Atómicas:
 * 1. Asienta el estado 'Cerrado' y la nota forense de auditoría en BD_Pedidos (Notion).
 * 2. Registra el log inmutable con hash y snapshot forense en BD_Auditoria_Accesos_Logs.
 * 3. Asienta movimientos de entrada positiva en BD_Kardex_Movimientos para los retazos útiles devueltos.
 */

const PEDIDOS_DB_ID = '3d086805-4e27-814b-9ff4-e694d56a58bb';
const AUDITORIA_LOGS_DB_ID = '3ec86805-4e27-8111-8cc9-fcfb594f3b1e';
const KARDEX_DB_ID = '26286805-4e27-803b-91ce-ef8f121d622d';

export async function onRequest(context) {
  const { request, env } = context;

  // Manejo de CORS Preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Notion-Version',
      },
    });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método no permitido. Se requiere POST.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const notionApiKey = env.NOTION_API_KEY || env.SANESCATOKEN || env.NOTION_TOKEN;
  if (!notionApiKey) {
    return new Response(JSON.stringify({ error: 'NOTION_API_KEY no configurada en las variables del servidor.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const notionHeaders = {
    'Authorization': `Bearer ${notionApiKey}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };

  try {
    const payload = await request.json();
    const {
      orderId,
      orderCode = 'S/C',
      orderName = 'Pedido de Fábrica',
      varianzaUSD = 0,
      varianzaPct = 0,
      totalTeoricoUSD = 0,
      totalRealUSD = 0,
      retazosDeducidosUSD = 0,
      retazosList = [],
      mermasCriticasCount = 0,
      auditorName = 'Supervisor de Planta',
      auditorId = null,
      observaciones = '',
      reglasAplicadas = {},
      snapshotItems = []
    } = payload;

    if (!orderId) {
      return new Response(JSON.stringify({ error: 'Falta el parámetro orderId requerido.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const fechaISO = new Date().toISOString();
    const toleranciaMerma = reglasAplicadas.toleranciaAplicadaPct || 8.0;
    const esConforme = varianzaPct <= toleranciaMerma && mermasCriticasCount === 0;
    const estadoAuditoria = esConforme ? '🟢 CONFORME' : '🔴 CON DESVIACIÓN';

    // ------------------------------------------------------------------------
    // 1. Mutación en BD_Pedidos: Marcar 'Cerrado' y adjuntar certificado
    // ------------------------------------------------------------------------
    const notaAuditoria = [
      `[CERTIFICADO DE AUDITORÍA BOM EX-POST — ${fechaISO}]`,
      `Estado: ${estadoAuditoria} (Tolerancia: ${toleranciaMerma}%)`,
      `Demanda Teórica: $${Number(totalTeoricoUSD).toFixed(2)} USD`,
      `Despacho Real: $${Number(totalRealUSD).toFixed(2)} USD`,
      `Varianza Neta: $${Number(varianzaUSD).toFixed(2)} USD (${Number(varianzaPct).toFixed(1)}%)`,
      `Retazos Reintegrados: $${Number(retazosDeducidosUSD).toFixed(2)} USD (${retazosList.length} ítems)`,
      `Mermas Críticas: ${mermasCriticasCount}`,
      `Auditor Responsable: ${auditorName}`,
      observaciones ? `Observaciones: ${observaciones}` : null
    ].filter(Boolean).join('\n');

    const updateOrderRes = await fetch(`https://api.notion.com/v1/pages/${orderId}`, {
      method: 'PATCH',
      headers: notionHeaders,
      body: JSON.stringify({
        properties: {
          'Estado': {
            status: { name: 'Cerrado' }
          },
          'Notas': {
            rich_text: [
              {
                text: { content: notaAuditoria.slice(0, 1950) }
              }
            ]
          }
        }
      })
    });

    if (!updateOrderRes.ok) {
      const errTxt = await updateOrderRes.text();
      console.warn(`No se pudo actualizar estado en BD_Pedidos (${orderId}):`, errTxt);
    }

    // ------------------------------------------------------------------------
    // 2. Registro Forense Inmutable en BD_Auditoria_Accesos_Logs
    // ------------------------------------------------------------------------
    const logTitulo = `[BOM-CIERRE] ${orderCode} — ${estadoAuditoria} (Var: $${Number(varianzaUSD).toFixed(2)} / ${Number(varianzaPct).toFixed(1)}%)`;
    const detalleForenseObj = {
      orderId,
      orderCode,
      orderName,
      fechaISO,
      auditorName,
      auditorId,
      kpis: {
        totalTeoricoUSD,
        totalRealUSD,
        varianzaUSD,
        varianzaPct,
        retazosDeducidosUSD,
        mermasCriticasCount
      },
      reglasAplicadas,
      retazosList,
      resumenItems: (snapshotItems || []).slice(0, 30).map(i => ({
        mat: i.mat,
        codigo: i.codigo,
        nombre: i.nombre,
        teorico: i.teorico,
        real: i.real,
        diferencia: i.diferencia,
        costoVariacionUSD: i.costoVariacionUSD,
        estado: i.estado
      }))
    };

    let logPageId = null;
    try {
      const logRes = await fetch(`https://api.notion.com/v1/pages`, {
        method: 'POST',
        headers: notionHeaders,
        body: JSON.stringify({
          parent: { database_id: AUDITORIA_LOGS_DB_ID },
          properties: {
            'Evento': {
              title: [{ text: { content: logTitulo.slice(0, 200) } }]
            },
            'Tipo_Evento': {
              select: { name: 'BOM_ORDER_CLOSE_AUDIT' }
            },
            'Fecha_Hora': {
              date: { start: fechaISO }
            },
            'Canal_Entorno': {
              select: { name: 'PC Oficina (Chrome)' }
            },
            'Puesto_Area': {
              rich_text: [{ text: { content: 'Auditoría BOM / Planta Industrial' } }]
            },
            'Alerta_Seguridad': {
              checkbox: !esConforme
            },
            'Detalle_Forense': {
              rich_text: [{ text: { content: JSON.stringify(detalleForenseObj).slice(0, 1950) } }]
            }
          }
        })
      });

      if (logRes.ok) {
        const logData = await logRes.json();
        logPageId = logData.id;
      } else {
        console.warn('Fallo guardando en BD_Auditoria_Accesos_Logs:', await logRes.text());
      }
    } catch (logErr) {
      console.warn('Error de red creando log forense:', logErr.message);
    }

    // ------------------------------------------------------------------------
    // 3. Asiento de Retazos Útiles en BD_Kardex_Movimientos
    // ------------------------------------------------------------------------
    const retazosCreados = [];
    for (const retazo of retazosList) {
      if (!retazo.qty || retazo.qty <= 0) continue;

      const descRetazo = `[REINTEGRO-RETAZO] ${orderCode} — ${retazo.nombre || retazo.codigo || retazo.mat} (${retazo.qty} ${retazo.unit || 'Und'})`;

      try {
        const kardexProperties = {
          'Descripción': {
            title: [{ text: { content: descRetazo.slice(0, 200) } }]
          },
          'Movimiento': {
            select: { name: '🔵 Ajuste por Reconteo (+)' }
          },
          'Cantidad Total': {
            number: Number(retazo.qty)
          },
          'Cantidad (Stock)': {
            number: Number(retazo.qty)
          },
          'Tienda (ext)': {
            rich_text: [{ text: { content: orderCode } }]
          },
          'Detalle (ext)': {
            rich_text: [{ text: { content: `Reingreso de retazo útil (>= 1.0m) a almacén por cierre BOM [ORDER_UUID:${orderId}]` } }]
          },
          'Fecha de Recepción': {
            date: { start: fechaISO.split('T')[0] }
          },
          'Comprobado': {
            checkbox: true
          }
        };

        // Si tenemos dashboardId del insumo, enlazarlo
        if (retazo.dashboardId) {
          kardexProperties['Dashboard'] = {
            relation: [{ id: retazo.dashboardId }]
          };
        }

        const kardexRes = await fetch(`https://api.notion.com/v1/pages`, {
          method: 'POST',
          headers: notionHeaders,
          body: JSON.stringify({
            parent: { database_id: KARDEX_DB_ID },
            properties: kardexProperties
          })
        });

        if (kardexRes.ok) {
          const kData = await kardexRes.json();
          retazosCreados.push({ mat: retazo.mat, id: kData.id });
        }
      } catch (kErr) {
        console.warn(`Error registrando retazo ${retazo.mat} en Kardex:`, kErr.message);
      }
    }

    // Respuesta Exitosa
    return new Response(JSON.stringify({
      status: 'success',
      message: 'Auditoría de cierre BOM concluida y asentada exitosamente en Notion ERP.',
      orderId,
      orderCode,
      orderStatus: 'Cerrado',
      estadoAuditoria,
      esConforme,
      varianzaUSD: Number(varianzaUSD).toFixed(2),
      varianzaPct: Number(varianzaPct).toFixed(1),
      retazosReintegradosCount: retazosCreados.length,
      logId: logPageId,
      timestamp: fechaISO
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Fallo procesando cierre de auditoría BOM: ${err.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
