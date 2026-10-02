/**
 * Cloudflare Pages Functions — Listado de Empleados Activos para Login en PC
 * Ruta: GET /api/auth/employees
 * 
 * Retorna únicamente el nombre e ID de los empleados activos para el selector de oficina.
 * Por seguridad estricta, NUNCA expone el PIN_App ni datos sensibles.
 */

const EMPLEADOS_DB_ID = '18a86805-4e27-80ee-974f-cb6ccc1d23d9';
const DEPARTAMENTOS_DB_ID = '77c41cdd-9656-49af-b98f-99e7c7a7af90';

// Caché en memoria de departamentos para Cloudflare Worker
let cachedDeptMap = null;
let deptCacheTime = 0;

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Método no permitido. Use GET.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const notionApiKey = env.NOTION_API_KEY;
  if (!notionApiKey) {
    return new Response(JSON.stringify({ error: 'NOTION_API_KEY no presente.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  try {
    const headers = {
      'Authorization': `Bearer ${notionApiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    };

    // 1. Resolver nombres de departamentos (con caché de 5 minutos)
    const now = Date.now();
    let deptMap = cachedDeptMap;
    if (!deptMap || now - deptCacheTime > 5 * 60 * 1000) {
      try {
        const deptRes = await fetch(`https://api.notion.com/v1/databases/${DEPARTAMENTOS_DB_ID}/query`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ page_size: 100 })
        });
        if (deptRes.ok) {
          const deptData = await deptRes.json();
          deptMap = {};
          deptData.results.forEach(d => {
            const dName = d.properties.Nombre?.title?.[0]?.plain_text || 
                          d.properties.Name?.title?.[0]?.plain_text || 
                          'Departamento';
            deptMap[d.id] = dName;
          });
          cachedDeptMap = deptMap;
          deptCacheTime = now;
        }
      } catch (deptErr) {
        console.warn('Advertencia cargando departamentos:', deptErr);
        deptMap = cachedDeptMap || {};
      }
    }

    // 2. Traer ÚNICAMENTE empleados no despedidos con departamentos asignados en 'Areas'
    const res = await fetch(`https://api.notion.com/v1/databases/${EMPLEADOS_DB_ID}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        filter: {
          and: [
            { property: 'Despedido', checkbox: { equals: false } },
            { property: 'Areas', relation: { is_not_empty: true } }
          ]
        },
        sorts: [
          { property: 'Nombre', direction: 'ascending' }
        ],
        page_size: 100
      })
    });

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: `Error consultando Notion: ${err}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const data = await res.json();
    const employees = (data.results || [])
      .map(p => {
        const name = p.properties.Nombre?.title?.[0]?.plain_text || '';
        const hasPin = !!p.properties.PIN_App?.rich_text?.[0]?.plain_text;
        const areas = (p.properties.Areas?.relation || [])
          .map(r => (deptMap && deptMap[r.id]) || '')
          .filter(Boolean);

        return {
          id: p.id,
          name,
          hasPin,
          areas
        };
      })
      .filter(e => e.name.trim().length > 0)
      .sort((a, b) => {
        // Priorizar empleados con PIN configurado primero, luego alfabético
        if (a.hasPin && !b.hasPin) return -1;
        if (!a.hasPin && b.hasPin) return 1;
        return a.name.localeCompare(b.name, 'es');
      });

    return new Response(JSON.stringify({
      status: 'success',
      count: employees.length,
      employees
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=60' // Caché 60s
      }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Excepción interna: ${err.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
