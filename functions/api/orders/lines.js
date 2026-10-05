/**
 * Cloudflare Pages Functions — Consulta de Líneas de Mobiliario por Pedido (BOM)
 * Ruta: GET /api/orders/lines?orderId=...
 * 
 * Consulta BD_Pedidos_Lineas (3d086805-4e27-811c-b163-cd5f972b0855) filtrando por
 * la relación con BD_Pedidos para permitir imputación de insumos a muebles específicos.
 */

const PEDIDOS_LINEAS_DB_ID = '3d086805-4e27-811c-b163-cd5f972b0855';

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

  const url = new URL(request.url);
  const orderId = url.searchParams.get('orderId');

  const notionApiKey = env.NOTION_API_KEY;
  if (!notionApiKey) {
    return new Response(JSON.stringify({ lines: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const headers = {
    'Authorization': `Bearer ${notionApiKey}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };

  try {
    const filter = orderId ? {
      property: 'BD_Pedidos',
      relation: { contains: orderId }
    } : undefined;

    const res = await fetch(`https://api.notion.com/v1/databases/${PEDIDOS_LINEAS_DB_ID}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...(filter ? { filter } : {}),
        page_size: 50
      })
    });

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: err, lines: [] }), {
        status: res.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const data = await res.json();
    const lines = (data.results || []).map(page => {
      const props = page.properties;
      const nombre = props['Línea']?.title?.[0]?.plain_text || 'Mobiliario';
      const cantidad = props['Cantidad']?.number || 1;
      const estado = props['Estado']?.status?.name || 'En producción';

      return {
        id: page.id,
        nombre,
        cantidad,
        estado
      };
    });

    return new Response(JSON.stringify({
      lines,
      count: lines.length
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=60'
      }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message, lines: [] }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
