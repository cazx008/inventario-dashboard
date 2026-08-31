/**
 * Cloudflare Worker: sanesca-sync
 * Receptor de Webhooks de Notion para disparar GitHub Actions (repository_dispatch)
 * 
 * Account ID: 98ee9f66220ad7147392ace5bb911953
 * Repositorio: cazx008/inventario-dashboard
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Sync-Secret',
        },
      });
    }

    const corsHeaders = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    };

    // Health check o estado general
    if (request.method === 'GET' && !url.searchParams.has('trigger')) {
      return new Response(JSON.stringify({
        status: 'online',
        service: 'sanesca-sync-worker',
        target_repo: env.GITHUB_REPO || 'cazx008/inventario-dashboard',
        timestamp: new Date().toISOString(),
      }, null, 2), { headers: corsHeaders });
    }

    // Validación de Token Secreto Opcional (si se define SYNC_SECRET en env)
    if (env.SYNC_SECRET) {
      const secretHeader = request.headers.get('X-Sync-Secret') || url.searchParams.get('secret');
      if (secretHeader !== env.SYNC_SECRET) {
        return new Response(JSON.stringify({
          error: 'Unauthorized: Invalid or missing secret token'
        }), { status: 401, headers: corsHeaders });
      }
    }

    const githubToken = env.GITHUB_TOKEN || env.GH_TOKEN;
    const targetRepo = url.searchParams.get('repo') || env.GITHUB_REPO || 'cazx008/inventario-dashboard';
    const eventType = url.searchParams.get('event') || 'notion-sync';

    if (!githubToken) {
      return new Response(JSON.stringify({
        error: 'Configuration Error: GITHUB_TOKEN not configured in Worker environment secrets.'
      }), { status: 500, headers: corsHeaders });
    }

    try {
      const ghResponse = await fetch(`https://api.github.com/repos/${targetRepo}/dispatches`, {
        method: 'POST',
        headers: {
          'User-Agent': 'Sanesca-Sync-Worker',
          'Accept': 'application/vnd.github.v3+json',
          'Authorization': `Bearer ${githubToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event_type: eventType,
          client_payload: {
            triggered_by: 'notion-webhook',
            timestamp: new Date().toISOString(),
            source_url: request.url,
          }
        }),
      });

      if (ghResponse.status === 204) {
        return new Response(JSON.stringify({
          ok: true,
          status: 'success',
          message: `Sincronización disparada exitosamente en ${targetRepo}`,
          event_type: eventType,
          timestamp: new Date().toISOString(),
        }, null, 2), { status: 200, headers: corsHeaders });
      } else {
        const errText = await ghResponse.text();
        return new Response(JSON.stringify({
          ok: false,
          status: 'error',
          http_status: ghResponse.status,
          github_error: errText,
        }, null, 2), { status: ghResponse.status, headers: corsHeaders });
      }
    } catch (err) {
      return new Response(JSON.stringify({
        ok: false,
        status: 'exception',
        error: err.message,
      }), { status: 500, headers: corsHeaders });
    }
  },
};
