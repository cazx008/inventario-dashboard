/**
 * Cloudflare Pages Functions — Consulta Paginada del Libro Mayor (Kardex)
 * Ruta: GET /api/kardex/list
 * 
 * Permite al Encargado de Inventario y a Gerencia auditar los movimientos
 * de entrada, salida y ajustes de almacén con filtrado reactivo.
 */

const KARDEX_DB_ID = '26286805-4e27-803b-91ce-ef8f121d622d';

export async function onRequest(context) {
  const { request, env } = context;

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
      error: 'NOTION_API_KEY no configurada en el entorno.',
      results: [],
      nextCursor: null,
      hasMore: false
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor') || undefined;
  const pageSize = Math.min(100, Math.max(10, parseInt(url.searchParams.get('pageSize') || '50', 10)));
  const dashboardId = url.searchParams.get('dashboardId') || null;
  const tipo = url.searchParams.get('tipo') || null;
  const folioOAB = url.searchParams.get('folioOAB') || null;

  const headers = {
    'Authorization': `Bearer ${notionApiKey}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };

  try {
    const filters = [];

    if (dashboardId) {
      filters.push({
        property: 'Dashboard',
        relation: { contains: dashboardId }
      });
    }

    if (tipo) {
      filters.push({
        property: 'Movimiento',
        select: { equals: tipo }
      });
    }

    if (folioOAB) {
      filters.push({
        property: 'Folio OAB',
        rich_text: { contains: folioOAB }
      });
    }

    const queryPayload = {
      page_size: pageSize,
      sorts: [
        {
          property: 'Fecha de Recepción',
          direction: 'descending'
        }
      ]
    };

    if (filters.length === 1) {
      queryPayload.filter = filters[0];
    } else if (filters.length > 1) {
      queryPayload.filter = { and: filters };
    }

    if (cursor) {
      queryPayload.start_cursor = cursor;
    }

    const notionRes = await fetch(`https://api.notion.com/v1/databases/${KARDEX_DB_ID}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify(queryPayload)
    });

    if (!notionRes.ok) {
      const errText = await notionRes.text();
      return new Response(JSON.stringify({
        error: `Error Notion API: ${notionRes.status}`,
        details: errText,
        results: [],
        hasMore: false
      }), {
        status: notionRes.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const data = await notionRes.json();
    const mappedResults = (data.results || []).map(page => {
      const props = page.properties;

      // Extraer comprobante si existe
      let comprobanteUrl = null;
      const fileProp = props['Comprobante'] || props['Foto'] || props['Comprobante Firmado'];
      if (fileProp?.files && fileProp.files.length > 0) {
        const fileObj = fileProp.files[0];
        comprobanteUrl = fileObj.file?.url || fileObj.external?.url || null;
      }

      return {
        id: page.id,
        descripcion: props['Descripción']?.title?.[0]?.plain_text || 'Movimiento de Almacén',
        movimiento: props['Movimiento']?.select?.name || '🟢 Entrada por Compra',
        cantidad: props['Cantidad (Stock)']?.number || 0,
        costoUnitarioUSD: props['Costo Unitario ($ USD)']?.number || 0,
        costoTotalUSD: props['Costo Total ($ USD)']?.number || 0,
        folioOAB: props['Folio OAB']?.rich_text?.[0]?.plain_text || '—',
        numeroNotaEntrega: props['Código (Nota de entrega)']?.rich_text?.[0]?.plain_text || '—',
        fecha: props['Fecha de Recepción']?.date?.start || page.created_time?.split('T')[0] || '—',
        dashboardId: props['Dashboard']?.relation?.[0]?.id || null,
        insumoId: props['Producto']?.relation?.[0]?.id || null,
        comprobanteUrl
      };
    });

    return new Response(JSON.stringify({
      status: 'success',
      results: mappedResults,
      nextCursor: data.next_cursor || null,
      hasMore: Boolean(data.has_more),
      totalReturned: mappedResults.length,
      timestamp: Date.now()
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });

  } catch (error) {
    return new Response(JSON.stringify({
      error: `Error interno en consulta de Kardex: ${error.message}`,
      results: [],
      hasMore: false
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
