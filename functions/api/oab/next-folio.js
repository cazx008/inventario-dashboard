/**
 * Cloudflare Pages Functions — Generador Atómico de Folio Secuencial Diario OAB
 * Ruta: GET /api/oab/next-folio?preview=true o GET /api/oab/next-folio
 * 
 * Genera correlativos canónicos OAB-YYYYMMDD-01, 02, 03...
 * - preview=true: Solo consulta el siguiente número disponible sin incrementarlo en KV (no quema números si se cancela el modal).
 * - preview=false: Reserva atómicamente el siguiente número incrementando la secuencia en Cloudflare KV.
 */

const OAB_DB_ID = '3eb86805-4e27-81f9-860a-c51fc794ebb0';

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

  const isPreview = url.searchParams.get('preview') === 'true';

  try {
    // 1. Obtener fecha de hoy en huso horario legal de Venezuela (America/Caracas)
    const now = new Date();
    const caracasFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Caracas',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const dateFormatted = caracasFormatter.format(now); // YYYY-MM-DD
    const dateCompact = dateFormatted.replace(/-/g, ''); // YYYYMMDD
    const kvKey = `oab_seq:${dateCompact}`;

    let currentSeq = 0;
    let kvAvailable = false;

    // 2. Intentar leer desde Cloudflare KV
    if (env.INVENTORY_KV) {
      try {
        const val = await env.INVENTORY_KV.get(kvKey);
        if (val !== null) {
          currentSeq = parseInt(val, 10) || 0;
          kvAvailable = true;
        }
      } catch (kvReadErr) {
        console.warn('Advertencia leyendo secuencia en Cloudflare KV:', kvReadErr);
      }
    }

    // 3. Fallback a Notion ERP si no hay registro en KV
    if (!kvAvailable && env.NOTION_API_KEY) {
      try {
        const notionRes = await fetch(`https://api.notion.com/v1/databases/${OAB_DB_ID}/query`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.NOTION_API_KEY}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            filter: {
              property: 'Folio',
              title: { starts_with: `OAB-${dateCompact}-` }
            },
            page_size: 100
          })
        });

        if (notionRes.ok) {
          const notionData = await notionRes.json();
          let maxNotionSeq = 0;
          for (const page of notionData.results || []) {
            const folioStr = page.properties?.['Folio']?.title?.[0]?.plain_text || '';
            const match = folioStr.match(new RegExp(`^OAB-${dateCompact}-(\\d+)`));
            if (match) {
              const num = parseInt(match[1], 10);
              if (num > maxNotionSeq) maxNotionSeq = num;
            }
          }
          currentSeq = Math.max(currentSeq, maxNotionSeq);
        }
      } catch (notionErr) {
        console.warn('Advertencia consultando secuencia previa en Notion:', notionErr);
      }
    }

    const nextSeq = currentSeq + 1;
    const formattedNum = String(nextSeq).padStart(2, '0');
    const finalFolio = `OAB-${dateCompact}-${formattedNum}`;

    // 4. Si NO es preview, persistir el incremento atómicamente en Cloudflare KV
    if (!isPreview && env.INVENTORY_KV) {
      try {
        await env.INVENTORY_KV.put(kvKey, String(nextSeq));
      } catch (kvWriteErr) {
        console.warn('Advertencia guardando secuencia en Cloudflare KV:', kvWriteErr);
      }
    }

    return new Response(JSON.stringify({
      status: 'success',
      folio: finalFolio,
      correlativo: nextSeq,
      fecha: dateCompact,
      fechaIso: dateFormatted,
      isPreview
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    // Fallback defensivo ante cualquier excepción
    const d = new Date();
    const fallbackDate = d.toISOString().slice(0, 10).replace(/-/g, '');
    const fallbackFolio = `OAB-${fallbackDate}-01`;

    return new Response(JSON.stringify({
      status: 'fallback',
      folio: fallbackFolio,
      correlativo: 1,
      fecha: fallbackDate,
      isPreview,
      error: error.message
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}
