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
    const projectCache = new Map();
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

        const pedidoId = lp['Pedido']?.relation?.[0]?.id || null;
        const proyectoId = lp['Proyectos']?.relation?.[0]?.id || lp['Proyecto']?.relation?.[0]?.id || null;
        let proyectoNombre = lp['Proyecto / Obra']?.rich_text?.[0]?.plain_text || 
                             lp['Proyecto (Texto)']?.rich_text?.[0]?.plain_text ||
                             lp['Proyecto']?.title?.[0]?.plain_text || '';

        // Hidratar nombre canónico desde BD_Pedidos si viene la relación Pedido y no hay texto
        if (pedidoId && !proyectoNombre) {
          if (projectCache.has(`pedido_${pedidoId}`)) {
            proyectoNombre = projectCache.get(`pedido_${pedidoId}`);
          } else {
            try {
              const pedRes = await fetch(`https://api.notion.com/v1/pages/${pedidoId}`, { headers });
              if (pedRes.ok) {
                const pedData = await pedRes.json();
                const pp = pedData.properties || {};
                const pNum = pp['Número de Documento']?.title?.[0]?.plain_text ||
                             pp['Nombre']?.title?.[0]?.plain_text || '';
                const pProj = pp['Proyecto']?.rich_text?.[0]?.plain_text ||
                              pp['Obra']?.rich_text?.[0]?.plain_text || '';
                const resolvedFull = pProj ? `${pNum} - ${pProj}` : pNum;
                if (resolvedFull) {
                  proyectoNombre = resolvedFull;
                  projectCache.set(`pedido_${pedidoId}`, resolvedFull);
                }
              }
            } catch (pedErr) {
              console.warn('Advertencia resolviendo Pedido en details.js:', pedErr);
            }
          }
        }

        // Hidratar nombre canónico desde BD_Proyectos si viene solo el ID relacional
        if (proyectoId && !proyectoNombre) {
          if (projectCache.has(proyectoId)) {
            proyectoNombre = projectCache.get(proyectoId);
          } else {
            try {
              const projRes = await fetch(`https://api.notion.com/v1/pages/${proyectoId}`, { headers });
              if (projRes.ok) {
                const projData = await projRes.json();
                const pp = projData.properties;
                const pTitle = pp['Nombre del Proyecto (Pedido)']?.title?.[0]?.plain_text ||
                               pp['Número de Documento']?.title?.[0]?.plain_text ||
                               pp['Nombre']?.title?.[0]?.plain_text ||
                               pp['Proyecto']?.title?.[0]?.plain_text ||
                               Object.values(pp).find(p => p?.type === 'title')?.title?.[0]?.plain_text ||
                               '';
                if (pTitle) {
                  proyectoNombre = pTitle;
                  projectCache.set(proyectoId, pTitle);
                }
              }
            } catch (pErr) {
              console.warn('Advertencia resolviendo nombre de proyecto en details.js:', pErr);
            }
          }
        }

        // Fallback inteligente desde notas de cabecera si la línea no tenía proyecto
        if (!proyectoNombre && oabHeader.notas) {
          const match = oabHeader.notas.match(/Proyecto:\s*([^.\n]+)/i);
          if (match) {
            proyectoNombre = match[1].trim();
          }
        }

        // Si se tiene proyectoNombre pero no proyectoId, resolver ID canónico desde BD_Proyectos
        let finalProyectoId = proyectoId;
        if (proyectoNombre && !finalProyectoId) {
          if (projectCache.has(`name_${proyectoNombre}`)) {
            finalProyectoId = projectCache.get(`name_${proyectoNombre}`);
          } else {
            try {
              const pSearchRes = await fetch(`https://api.notion.com/v1/databases/31e86805-4e27-80e0-8be5-f3d30532e900/query`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                  filter: {
                    property: 'Nombre del Proyecto (Pedido)',
                    title: { contains: proyectoNombre }
                  },
                  page_size: 1
                })
              });
              if (pSearchRes.ok) {
                const pSearchData = await pSearchRes.json();
                if (pSearchData.results?.[0]?.id) {
                  finalProyectoId = pSearchData.results[0].id;
                  projectCache.set(`name_${proyectoNombre}`, finalProyectoId);
                }
              }
            } catch (sErr) {
              console.warn('Advertencia buscando ID de proyecto por nombre:', sErr);
            }
          }
        }

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
          pedidoId,
          proyectoId: finalProyectoId,
          proyectoNombre
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
