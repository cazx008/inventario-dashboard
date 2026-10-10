/**
 * Cloudflare Pages Functions — Consulta de Órdenes y Proyectos Activos (Hidratados)
 * Ruta: GET /api/orders/active
 * 
 * Consulta BD_Pedidos en Notion (3d086805-4e27-814b-9ff4-e694d56a58bb) y resuelve
 * en memoria las relaciones con BD_Clientes y BD_Proyectos para entregar nombres
 * comerciales legibles a los buscadores de la suite, eliminando clones ORD-000.
 */

const PEDIDOS_DB_ID = '3d086805-4e27-814b-9ff4-e694d56a58bb';

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
      orders: []
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

  try {
    // 1. Consultar pedidos recientes ordenados por fecha de creación descendente
    const res = await fetch(`https://api.notion.com/v1/databases/${PEDIDOS_DB_ID}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        page_size: 50,
        sorts: [
          {
            timestamp: 'created_time',
            direction: 'descending'
          }
        ]
      })
    });

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: `Notion error ${res.status}: ${err}`, orders: [] }), {
        status: res.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const data = await res.json();
    const results = data.results || [];

    // 2. Extraer IDs únicos de relaciones (BD_Clientes y BD_Proyectos)
    const pageIdsToResolve = new Set();
    const parsedRaw = results.map(page => {
      const props = page.properties || {};
      const numDoc = props['Número de Documento']?.title?.[0]?.plain_text?.trim() || 'ORD-S/N';
      const clienteId = props['BD_Clientes']?.relation?.[0]?.id || null;
      const proyectoId = props['BD_Proyectos']?.relation?.[0]?.id || null;
      const tipoDoc = props['Tipo de Documento']?.select?.name || '';
      const estado = props['Estado']?.status?.name || 'Activo';
      const fecha = props['Fecha del Documento']?.date?.start || page.created_time?.split('T')[0];

      if (clienteId) pageIdsToResolve.add(clienteId);
      if (proyectoId) pageIdsToResolve.add(proyectoId);

      let tipo = 'PED';
      if (tipoDoc.includes('PRS') || numDoc.startsWith('PRS')) tipo = 'PRS';
      else if (tipoDoc.includes('FAC') || numDoc.startsWith('FAC')) tipo = 'FAC';
      else if (tipoDoc.includes('O/E')) tipo = 'OE';

      return {
        id: page.id,
        codigo: numDoc,
        clienteId,
        proyectoId,
        tipo,
        estado,
        fecha
      };
    });

    // 3. Resolver nombres de páginas en paralelo (con caché en memoria del Worker)
    const titleCache = new Map();
    const idsArray = Array.from(pageIdsToResolve);

    await Promise.all(
      idsArray.map(async (pageId) => {
        try {
          const pageRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers });
          if (pageRes.ok) {
            const pageData = await pageRes.json();
            const titleProp = Object.values(pageData.properties || {}).find(p => p.type === 'title');
            const titleText = titleProp?.title?.[0]?.plain_text?.trim();
            if (titleText) {
              titleCache.set(pageId, titleText);
            }
          }
        } catch (e) {
          console.warn(`Error resolviendo título para ${pageId}:`, e.message);
        }
      })
    );

    // 4. Mapear resultados finales hidratados
    const hydratedOrders = parsedRaw.map(o => {
      const clienteName = o.clienteId ? (titleCache.get(o.clienteId) || 'Cliente Registrado') : 'Cliente General';
      const proyectoName = o.proyectoId ? (titleCache.get(o.proyectoId) || o.codigo) : o.codigo;

      return {
        id: o.id,
        codigo: o.codigo,
        cliente: clienteName,
        proyecto: proyectoName,
        proyectoId: o.proyectoId,
        tipo: o.tipo,
        estado: o.estado,
        fecha: o.fecha
      };
    });

    return new Response(JSON.stringify({
      orders: hydratedOrders,
      count: hydratedOrders.length,
      timestamp: new Date().toISOString()
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=60, s-maxage=120'
      }
    });

  } catch (error) {
    return new Response(JSON.stringify({
      error: error.message,
      orders: []
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
