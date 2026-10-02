/**
 * Cloudflare Pages Functions — Proxy Seguro Notion API
 * Ruta: /api/notion/*
 * Protege NOTION_API_KEY en secrets de Cloudflare y gestiona CORS de manera segura.
 */
export async function onRequest(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);

  // Manejo de preflight CORS
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Notion-Version',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  // Resolver la ruta relativa de Notion
  const notionPath = Array.isArray(params.path) ? params.path.join('/') : (params.path || '');
  const searchParams = url.search;
  const notionTargetUrl = `https://api.notion.com/v1/${notionPath}${searchParams}`;

  const notionApiKey = env.NOTION_API_KEY;
  if (!notionApiKey) {
    return new Response(
      JSON.stringify({ 
        error: 'NOTION_API_KEY no configurada en las variables de entorno de Cloudflare Pages' 
      }), 
      {
        status: 500,
        headers: { 
          'Content-Type': 'application/json', 
          'Access-Control-Allow-Origin': '*' 
        },
      }
    );
  }

  const forwardHeaders = new Headers();
  forwardHeaders.set('Authorization', `Bearer ${notionApiKey}`);
  forwardHeaders.set('Notion-Version', '2022-06-28');
  forwardHeaders.set('Content-Type', 'application/json');

  let bodyPayload = null;
  if (['POST', 'PATCH', 'PUT'].includes(request.method)) {
    bodyPayload = await request.text();
  }

  try {
    const notionResponse = await fetch(notionTargetUrl, {
      method: request.method,
      headers: forwardHeaders,
      body: bodyPayload,
    });

    const responseBody = await notionResponse.text();

    return new Response(responseBody, {
      status: notionResponse.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: `Fallo al comunicarse con Notion API: ${error.message}` }), 
      {
        status: 502,
        headers: { 
          'Content-Type': 'application/json', 
          'Access-Control-Allow-Origin': '*' 
        },
      }
    );
  }
}
