/**
 * Cloudflare Pages Functions — Consulta de Detalles de OAB para Transcripción
 * Ruta: GET /api/oab/details?folio=OAB-... o GET /api/oab/details?list=pending
 * 
 * Permite buscar una OAB y sus líneas activas para transcribir los vistos buenos de Magaly y cotizaciones de Compras.
 */

const OAB_DB_ID = '3eb86805-4e27-81f9-860a-c51fc794ebb0';
const SOLICITUDES_DB_ID = '2bc86805-4e27-8036-ba88-d52ec84742ba';

const round2 = (num) => Math.round((Number(num || 0) + Number.EPSILON) * 100) / 100;

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Notion-Version',
      },
    });
  }

  const notionApiKey = env.NOTION_API_KEY;
  if (!notionApiKey) {
    return new Response(JSON.stringify({
      error: 'NOTION_API_KEY no configurada en Cloudflare Pages',
      status: 'offline'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const headers = {
    'Authorization': `Bearer ${notionApiKey}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };

  const folioParam = url.searchParams.get('folio');
  const listParam = url.searchParams.get('list');

  try {
    // Modo 1: Listar OABs pendientes de revisión/aprobación
    if (listParam === 'pending' || !folioParam) {
      const pendingRes = await fetch(`https://api.notion.com/v1/databases/${OAB_DB_ID}/query`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          filter: {
            or: [
              { property: 'Estado General', select: { equals: 'Solicitado' } },
              { property: 'Estado General', select: { equals: 'Aprobado por Gerencia' } },
              { property: 'Estado General', select: { equals: 'En Compra' } },
              { property: 'Estado General', select: { equals: 'Recepción Parcial' } }
            ]
          },
          sorts: [{ timestamp: 'created_time', direction: 'descending' }],
          page_size: 25
        })
      });

      if (!pendingRes.ok) {
        const err = await pendingRes.json();
        return new Response(JSON.stringify({ error: 'Error consultando OABs en Notion', detail: err }), {
          status: pendingRes.status,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      const pendingData = await pendingRes.json();
      const list = (pendingData.results || []).map(page => {
        const p = page.properties;
        return {
          id: page.id,
          folio: p['Folio']?.title?.[0]?.plain_text || 'S/F',
          fechaEmision: p['Fecha Emisión']?.date?.start || '',
          totalUSD: round2(p['Total Estimado ($ USD)']?.number || 0),
          totalBs: round2(p['Total Estimado (Bs BCV)']?.number || 0),
          estadoGeneral: p['Estado General']?.select?.name || 'Solicitado',
          proveedor: p['Proveedor Adjudicado']?.rich_text?.[0]?.plain_text || '',
          cotizacion: p['N° Cotización']?.rich_text?.[0]?.plain_text || '',
          notas: p['Notas']?.rich_text?.[0]?.plain_text || ''
        };
      });

      return new Response(JSON.stringify({ status: 'success', orders: list }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Modo 2: Obtener detalle completo de una OAB específica por Folio
    const searchFolio = folioParam.trim();
    const oabQueryRes = await fetch(`https://api.notion.com/v1/databases/${OAB_DB_ID}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        filter: {
          property: 'Folio',
          title: { equals: searchFolio }
        },
        page_size: 1
      })
    });

    if (!oabQueryRes.ok) {
      return new Response(JSON.stringify({ error: `No se pudo buscar la OAB ${searchFolio}` }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const oabQueryData = await oabQueryRes.json();
    if (!oabQueryData.results || oabQueryData.results.length === 0) {
      return new Response(JSON.stringify({ error: `No se encontró ninguna OAB con folio ${searchFolio}` }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const oabPage = oabQueryData.results[0];
    const op = oabPage.properties;
    const oabHeader = {
      id: oabPage.id,
      folio: op['Folio']?.title?.[0]?.plain_text || searchFolio,
      fechaEmision: op['Fecha Emisión']?.date?.start || '',
      totalUSD: round2(op['Total Estimado ($ USD)']?.number || 0),
      totalBs: round2(op['Total Estimado (Bs BCV)']?.number || 0),
      tasaBCV: round2(op['Tasa BCV Aplicada']?.number || 36.50),
      estadoGeneral: op['Estado General']?.select?.name || 'Solicitado',
      proveedor: op['Proveedor Adjudicado']?.rich_text?.[0]?.plain_text || '',
      cotizacion: op['N° Cotización']?.rich_text?.[0]?.plain_text || '',
      fechaEstimadaEntrega: op['Fecha Estimada Entrega']?.date?.start || '',
      notas: op['Notas']?.rich_text?.[0]?.plain_text || '',
      notasCompras: op['Notas Compras']?.rich_text?.[0]?.plain_text || ''
    };

    // Consultar las líneas asociadas en Solicitudes de Insumos (con paginación completa)
    const lines = [];
    let hasMore = true;
    let nextCursor = undefined;

    while (hasMore) {
      const queryPayload = {
        filter: {
          property: 'Orden de Abastecimiento',
          relation: { contains: oabPage.id }
        },
        page_size: 100
      };
      if (nextCursor) {
        queryPayload.start_cursor = nextCursor;
      }

      const lineasRes = await fetch(`https://api.notion.com/v1/databases/${SOLICITUDES_DB_ID}/query`, {
        method: 'POST',
        headers,
        body: JSON.stringify(queryPayload)
      });

      if (!lineasRes.ok) break;

      const linesData = await lineasRes.json();
      for (const line of linesData.results || []) {
        const lp = line.properties;
        const cantSol = lp['Cantidad Solicitada']?.number || 0;
        const cantApr = lp['Cantidad Aprobada']?.number ?? cantSol;
        const cantRec = lp['Cantidad Recibida']?.number || 0;
        const backorder = lp['Backorder Pendiente']?.number != null
          ? lp['Backorder Pendiente'].number
          : Math.max(0, cantApr - cantRec);
        const costUSD = round2(lp['Costo Estimado ($ USD)']?.number || 0);
        
        let rawNombre = lp['Nombre de Solicitud']?.title?.[0]?.plain_text || 
                        lp['Insumo']?.title?.[0]?.plain_text || 
                        lp['Nombre']?.title?.[0]?.plain_text || 'Insumo';
        const cleanNombre = rawNombre.replace(/^\[[^\]]+\]\s*/, '').trim() || rawNombre;

        lines.push({
          solicitudId: line.id,
          nombre: cleanNombre,
          cantidadSolicitada: cantSol,
          cantidadAprobada: cantApr,
          cantidadRecibidaPrevia: cantRec,
          backorderPendiente: backorder,
          costoUnitarioUSD: costUSD,
          subtotalUSD: round2(cantApr * costUSD),
          estadoFlujo: lp['Estado Flujo']?.select?.name || 'Solicitado',
          dashboardId: lp['Dashboard']?.relation?.[0]?.id,
          insumoId: lp['Producto']?.relation?.[0]?.id || lp['BD_Materiales_Insumos']?.relation?.[0]?.id,
          prioridad: lp['Prioridad']?.select?.name || 'Alta',
          proyectoNombre: lp['Proyecto / Obra']?.rich_text?.[0]?.plain_text || ''
        });
      }

      hasMore = linesData.has_more;
      nextCursor = linesData.next_cursor;
    }

    const pendingLines = lines.filter(l => l.backorderPendiente > 0);
    const completedLines = lines.filter(l => l.backorderPendiente <= 0);

    return new Response(JSON.stringify({
      status: 'success',
      oab: oabHeader,
      lines,
      pendingLines,
      completedLines
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Excepción buscando OAB: ${err.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
