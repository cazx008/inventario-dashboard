/**
 * Cloudflare Pages Functions — Depósito Pericial en Cloudflare R2
 * Ruta: POST /api/storage/upload
 * 
 * Almacena fotografías de Notas de Entrega físicas en el bucket R2 'sanesca-evidencias'
 * bajo la clave canónica: evidencias/oab/{folioOAB}/{cleanNotaEntrega}.jpg
 * y genera una URL HTTPS pública permanente e inmutable para Notion.
 */

function parseBase64(dataUrl) {
  const matches = dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    throw new Error('La imagen no contiene una cadena Base64 válida.');
  }
  const mimeType = matches[1];
  const base64Data = matches[2];
  
  // Decodificar Base64 a buffer binario
  const binaryString = atob(base64Data);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return { buffer: bytes.buffer, mimeType };
}

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
    const payload = await request.json();
    const { folioOAB, numeroNotaEntrega, imageBase64 } = payload;

    if (!imageBase64) {
      return new Response(JSON.stringify({ error: 'Falta el parámetro imageBase64.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const cleanFolio = (folioOAB || 'OAB-GENERAL').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    const cleanNota = (numeroNotaEntrega || 'S_N').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    const r2Key = `evidencias/oab/${cleanFolio}/${cleanNota}.jpg`;
    const baseUrl = env.R2_PUBLIC_URL || env.R2_BUCKET_URL || 'https://api.sanesca.cloud';
    const finalUrl = `${baseUrl}/${r2Key}`;

    // Si el bucket R2 está conectado en Cloudflare
    if (env.EVIDENCIAS_BUCKET) {
      const { buffer, mimeType } = parseBase64(imageBase64);

      await env.EVIDENCIAS_BUCKET.put(r2Key, buffer, {
        httpMetadata: {
          contentType: mimeType || 'image/jpeg',
          cacheControl: 'public, max-age=31536000, immutable'
        }
      });

      return new Response(JSON.stringify({
        status: 'success',
        url: finalUrl,
        r2Key,
        storage: 'cloudflare_r2'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Modo simulación defensivo para desarrollo local (Vite)
    return new Response(JSON.stringify({
      status: 'success',
      url: finalUrl,
      r2Key,
      storage: 'simulated_local',
      message: 'R2 no configurado en entorno local; URL canónica generada exitosamente.'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (error) {
    return new Response(JSON.stringify({
      error: `Error al procesar almacenamiento en R2: ${error.message}`,
      status: 'error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
