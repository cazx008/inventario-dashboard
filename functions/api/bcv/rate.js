/**
 * Cloudflare Pages Functions — Consulta de Tasa Oficial BCV
 * Ruta: /api/bcv/rate
 * Retorna la tasa oficial vigente con cache y fallback de contingencia.
 */
export async function onRequest(context) {
  const { request } = context;

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

  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=1800', // 30 min cache
  };

  try {
    // 1. Intento primario: DolarApi Oficial
    const res = await fetch('https://ve.dolarapi.com/v1/dolares/oficial', {
      headers: { 'Accept': 'application/json' },
      cf: { cacheTtl: 1800 }
    });

    if (res.ok) {
      const data = await res.json();
      return new Response(JSON.stringify({
        fuente: 'BCV Oficial (DolarAPI)',
        promedio: Number(data.promedio),
        fechaActualizacion: data.fechaActualizacion || new Date().toISOString(),
        status: 'success'
      }), { headers: corsHeaders });
    }
  } catch (err) {
    // Fallback secundario
  }

  try {
    // 2. Intento secundario: pydolar
    const res2 = await fetch('https://pydolarvenezuela-api.vercel.app/api/v1/dollar?page=bcv', {
      headers: { 'Accept': 'application/json' }
    });
    if (res2.ok) {
      const data2 = await res2.json();
      const promedio = Number(data2.monitors?.usd?.price || data2.price);
      if (promedio > 0) {
        return new Response(JSON.stringify({
          fuente: 'BCV Oficial (PyDolar)',
          promedio: promedio,
          fechaActualizacion: new Date().toISOString(),
          status: 'success'
        }), { headers: corsHeaders });
      }
    }
  } catch (err) {
    // Fallback a contingencia
  }

  // Fallback con valor de referencia y flag de contingencia
  return new Response(JSON.stringify({
    fuente: 'Referencial Contingencia',
    promedio: 36.50,
    fechaActualizacion: new Date().toISOString(),
    status: 'fallback'
  }), { headers: corsHeaders });
}
