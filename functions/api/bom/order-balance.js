/**
 * Cloudflare Pages Functions — Balance de Cierre de Tienda y Auditoría de Mermas BOM
 * Ruta: GET /api/bom/order-balance?orderId={UUID}&pedidoCodigo={CODIGO}
 * 
 * Computa la varianza industrial comparando la demanda matemática teórica
 * (BOM de muebles en BD_Pedidos_Lineas) contra los despachos reales de Kardex
 * imputados a la orden.
 */

import bomIndex from './bom_index_optimized.json';

const PEDIDOS_LINEAS_DB_ID = '3d086805-4e27-811c-b163-cd5f972b0855';
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

  const url = new URL(request.url);
  const orderId = url.searchParams.get('orderId');
  const pedidoCodigo = url.searchParams.get('pedidoCodigo') || '';

  if (!orderId) {
    return new Response(JSON.stringify({ error: 'Falta el parámetro orderId requerido.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const notionApiKey = env.NOTION_API_KEY;
  if (!notionApiKey) {
    return new Response(JSON.stringify({ error: 'NOTION_API_KEY no configurada en el servidor.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const headers = {
    'Authorization': `Bearer ${notionApiKey}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };

  try {
    // 1. Consultar Líneas de Mobiliario del Pedido (BD_Pedidos_Lineas)
    const lineasRes = await fetch(`https://api.notion.com/v1/databases/${PEDIDOS_LINEAS_DB_ID}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        filter: {
          property: 'BD_Pedidos',
          relation: { contains: orderId }
        },
        page_size: 100
      })
    });

    if (!lineasRes.ok) {
      const err = await lineasRes.text();
      return new Response(JSON.stringify({ error: `Error consultando líneas de pedido: ${err}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const lineasData = await lineasRes.json();
    const rawLines = lineasData.results || [];

    // 2. Calcular Demanda Teórica por Insumo
    const demandaTeorica = {}; // matCode -> cantTeorica
    const mueblesConBOM = [];
    const mueblesSinBOM = [];

    for (const page of rawLines) {
      const p = page.properties;
      const rawTitle = p['Línea']?.title?.[0]?.plain_text || 'Mobiliario';
      const cantidadMueble = p['Cantidad']?.number || 1;

      // Extracción Regex robusta del código de producto P*
      const match = rawTitle.match(/\b(P\d+[-A-Z0-9]*)\b/i);
      const prodCode = match ? match[1].toUpperCase() : null;

      const receta = prodCode && bomIndex.recetas ? bomIndex.recetas[prodCode] : null;

      if (receta && Array.isArray(receta.m)) {
        mueblesConBOM.push({
          id: page.id,
          codigo: prodCode,
          nombre: receta.n || rawTitle,
          cantidad: cantidadMueble,
          partesCount: receta.m.length
        });

        for (const [matCode, cantUnitaria] of receta.m) {
          const totalTeorico = Number((cantUnitaria * cantidadMueble).toFixed(4));
          demandaTeorica[matCode] = (demandaTeorica[matCode] || 0) + totalTeorico;
        }
      } else {
        mueblesSinBOM.push({
          id: page.id,
          codigo: prodCode || 'S/C',
          nombre: rawTitle,
          cantidad: cantidadMueble,
          motivo: prodCode ? 'No posee receta cuantitativa en catálogo Valery' : 'Sin código P* en el título'
        });
      }
    }

    // 3. Consultar Salidas Reales en Kardex (BD_Kardex_Movimientos)
    // Buscamos movimientos de tipo 'Salida a Producción' con tag canónico [ORDER_UUID:{orderId}] o mención del pedido
    const kardexFilters = [
      {
        property: 'Movimiento',
        select: { equals: '🔴 Salida a Producción' }
      }
    ];

    const subFilters = [
      {
        property: 'Detalle (ext)',
        rich_text: { contains: `[ORDER_UUID:${orderId}]` }
      },
      {
        property: 'Detalle (ext)',
        rich_text: { contains: orderId }
      }
    ];

    if (pedidoCodigo) {
      subFilters.push({
        property: 'Detalle (ext)',
        rich_text: { contains: pedidoCodigo }
      });
      subFilters.push({
        property: 'Descripción',
        title: { contains: pedidoCodigo }
      });
    }

    const kardexRes = await fetch(`https://api.notion.com/v1/databases/${KARDEX_DB_ID}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        filter: {
          and: [
            ...kardexFilters,
            { or: subFilters }
          ]
        },
        page_size: 100
      })
    });

    let kardexRows = [];
    if (kardexRes.ok) {
      const kData = await kardexRes.json();
      kardexRows = kData.results || [];
    }

    // Construir índice inverso de dashboardId -> matCode
    const dashboardToMat = {};
    const codeToMat = {};
    for (const [vCode, info] of Object.entries(bomIndex.insumos || {})) {
      if (info.dId) dashboardToMat[info.dId] = vCode;
      if (info.c) codeToMat[info.c.toUpperCase()] = vCode;
    }

    // 4. Agregar Despachos Reales
    const despachoReal = {}; // matCode -> { cant, salidasCount }
    const salidasDetalle = [];

    for (const row of kardexRows) {
      const kp = row.properties;
      const rawQty = Math.abs(kp['Cantidad (Stock)']?.number || 0);
      const dashRel = kp['Dashboard']?.relation?.[0]?.id;
      const descTitle = kp['Descripción']?.title?.[0]?.plain_text || '';
      const detalle = kp['Detalle (ext)']?.rich_text?.[0]?.plain_text || '';

      // Determinar a qué insumo corresponde
      let matchedMat = dashRel ? dashboardToMat[dashRel] : null;

      if (!matchedMat) {
        // Fallback por código interno en descripción o detalle
        for (const [iCode, vCode] of Object.entries(codeToMat)) {
          if (descTitle.toUpperCase().includes(iCode) || detalle.toUpperCase().includes(iCode)) {
            matchedMat = vCode;
            break;
          }
        }
      }

      const key = matchedMat || `EXT_${dashRel || descTitle.slice(0, 15)}`;
      if (!despachoReal[key]) {
        despachoReal[key] = { cant: 0, salidasCount: 0, rawTitle: descTitle };
      }
      despachoReal[key].cant += rawQty;
      despachoReal[key].salidasCount += 1;

      salidasDetalle.push({
        id: row.id,
        glosa: descTitle,
        cantidad: rawQty,
        fecha: kp['Fecha de Entrega']?.date?.start || 'N/A'
      });
    }

    // 5. Consolidar Matriz de Varianza
    const allMatKeys = new Set([...Object.keys(demandaTeorica), ...Object.keys(despachoReal)]);
    const balance = [];

    let totalTeoricoUSD = 0;
    let totalRealUSD = 0;
    let mermasCriticasCount = 0;

    for (const key of allMatKeys) {
      const info = bomIndex.insumos?.[key] || {
        v: key,
        c: key.startsWith('EXT_') ? 'ADICIONAL' : key,
        n: despachoReal[key]?.rawTitle || key,
        u: 'Und',
        costo: 0
      };

      const teorico = Number((demandaTeorica[key] || 0).toFixed(4));
      const real = Number((despachoReal[key]?.cant || 0).toFixed(4));
      const diferencia = Number((real - teorico).toFixed(4));
      
      let varianzaPct = 0;
      if (teorico > 0) {
        varianzaPct = Number(((diferencia / teorico) * 100).toFixed(1));
      } else if (real > 0) {
        varianzaPct = 100; // 100% sobreconsumo no presupuestado
      }

      const costoUnitario = Number(info.costo) || 0;
      const subtotalTeoricoUSD = Number((teorico * costoUnitario).toFixed(2));
      const subtotalRealUSD = Number((real * costoUnitario).toFixed(2));
      const costoVariacionUSD = Number((diferencia * costoUnitario).toFixed(2));

      totalTeoricoUSD += subtotalTeoricoUSD;
      totalRealUSD += subtotalRealUSD;

      let estado = 'NORMAL';
      if (teorico === 0 && real > 0) {
        estado = 'NO_PRESUPUESTADO';
        mermasCriticasCount++;
      } else if (varianzaPct > 5) {
        estado = 'MERMA_EXCESIVA';
        mermasCriticasCount++;
      } else if (diferencia < 0) {
        estado = 'AHORRO';
      } else if (diferencia === 0) {
        estado = 'EXACTO';
      }

      balance.push({
        mat: info.v,
        codigo: info.c,
        dashboardId: info.dId,
        nombre: info.n,
        unidad: info.u,
        teorico,
        real,
        diferencia,
        varianzaPct,
        costoUnitarioUSD: costoUnitario,
        costoVariacionUSD,
        estado,
        salidasCount: despachoReal[key]?.salidasCount || 0
      });
    }

    // Ordenar: primero los de mayor costo de variación positiva (mayores mermas en $)
    balance.sort((a, b) => b.costoVariacionUSD - a.costoVariacionUSD);

    const diferenciaNetaUSD = Number((totalRealUSD - totalTeoricoUSD).toFixed(2));
    const varianzaGlobalPct = totalTeoricoUSD > 0 
      ? Number(((diferenciaNetaUSD / totalTeoricoUSD) * 100).toFixed(1))
      : 0;

    return new Response(JSON.stringify({
      orderId,
      pedidoCodigo,
      timestamp: Date.now(),
      kpis: {
        totalTeoricoUSD: Number(totalTeoricoUSD.toFixed(2)),
        totalRealUSD: Number(totalRealUSD.toFixed(2)),
        diferenciaNetaUSD,
        varianzaGlobalPct,
        itemsAuditadosCount: balance.length,
        mermasCriticasCount,
        mueblesConBOMCount: mueblesConBOM.length,
        mueblesSinBOMCount: mueblesSinBOM.length,
        salidasKardexCount: salidasDetalle.length
      },
      balance,
      mueblesConBOM,
      mueblesSinBOM,
      salidasDetalle
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: `Error en cálculo de balance BOM: ${error.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
