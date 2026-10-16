/**
 * fetch-inventory.js — Extractor Autónomo de Inventario Sanesca (ESM)
 * 
 * Extrae datos en caliente de la BD Dashboard de Notion y genera:
 *  - data/inventory.json y data/meta.json
 *  - public/data/inventory.json y public/data/meta.json
 * 
 * Utiliza native fetch (Node 18+) sin dependencias externas de npm.
 * 
 * Filtro base: Contando = true (solo publica ítems marcados para la web)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Configuration ---
function resolveNotionToken() {
  if (process.env.SANESCATOKEN) return process.env.SANESCATOKEN;
  if (process.env.NOTION_TOKEN) return process.env.NOTION_TOKEN;
  if (process.env.NOTION_API_KEY) return process.env.NOTION_API_KEY;

  const candidateEnvPaths = [
    path.join(__dirname, '..', '.env'),
    path.join(__dirname, '..', '..', 'apps', 'despacho', '.env'),
    path.join(__dirname, '..', '..', '..', 'apps', 'despacho', '.env'),
    path.join(__dirname, '..', '..', '06_Scripts_Automatizacion', 'bot_produccion', '.env'),
    path.join(__dirname, '..', '..', '..', '06_Scripts_Automatizacion', 'bot_produccion', '.env')
  ];

  for (const envPath of candidateEnvPaths) {
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, 'utf8');
        const match = content.match(/(?:NOTION_API_KEY|NOTION_TOKEN|SANESCATOKEN)\s*=\s*(.+)/);
        if (match && match[1]) {
          return match[1].trim().replace(/^['"]|['"]$/g, '');
        }
      } catch (_) {}
    }
  }

  return '';
}

const NOTION_TOKEN = resolveNotionToken();
const CATALOGO_INSUMOS_DB_ID = process.env.NOTION_CATALOGO_INSUMOS_DB_ID || '26286805-4e27-8067-8847-d39de1bf0bde';

const OUTPUT_DIRS = [
  path.join(__dirname, '..', 'data'),
  path.join(__dirname, '..', 'public', 'data'),
];

const NOTION_HEADERS = {
  'Authorization': `Bearer ${NOTION_TOKEN}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
};

// --- Notion Property Extractors ---

function extractProperty(prop) {
  if (!prop) return null;

  switch (prop.type) {
    case 'title':
      return prop.title?.map(t => t.plain_text).join('') || '';
    case 'rich_text':
      return prop.rich_text?.map(t => t.plain_text).join('') || '';
    case 'number':
      return prop.number;
    case 'select':
      return prop.select?.name || null;
    case 'multi_select':
      return prop.multi_select?.map(s => s.name) || [];
    case 'status':
      return prop.status?.name || null;
    case 'date':
      return prop.date?.start || null;
    case 'checkbox':
      return prop.checkbox || false;
    case 'url':
      return prop.url || null;
    case 'formula':
      return extractFormulaValue(prop.formula);
    case 'rollup':
      return extractRollupValue(prop.rollup);
    case 'relation':
      return prop.relation?.map(r => r.id) || [];
    default:
      return null;
  }
}

function extractFormulaValue(formula) {
  if (!formula) return null;
  switch (formula.type) {
    case 'string': return formula.string;
    case 'number': return formula.number;
    case 'boolean': return formula.boolean;
    case 'date': return formula.date?.start || null;
    default: return null;
  }
}

function extractRollupValue(rollup) {
  if (!rollup) return null;
  switch (rollup.type) {
    case 'number': return rollup.number;
    case 'date': return rollup.date?.start || null;
    case 'array': {
      const items = rollup.array?.map(item => {
        if (item.type === 'relation') {
          return item.relation?.map(r => r.id) || [];
        }
        if (item.type === 'date') {
          return item.date?.start || null;
        }
        return extractProperty(item);
      }) || [];
      if (items.length === 1) return items[0];
      if (items.length > 1) return items;
      return null;
    }
    default: return null;
  }
}

function extractSelectWithColor(prop) {
  if (!prop) return null;
  if (prop.type === 'select' && prop.select) {
    return { name: prop.select.name, color: prop.select.color };
  }
  if (prop.type === 'status' && prop.status) {
    return { name: prop.status.name, color: prop.status.color };
  }
  return null;
}

function extractRollupSelect(prop) {
  if (!prop || prop.type !== 'rollup') return null;
  const rollup = prop.rollup;
  if (rollup.type === 'array' && rollup.array?.length > 0) {
    const first = rollup.array[0];
    if (first.type === 'select' && first.select) {
      return { name: first.select.name, color: first.select.color };
    }
    if (first.type === 'rich_text') {
      return extractProperty(first);
    }
    return extractProperty(first);
  }
  return null;
}

// --- Page Title Resolver Cache ---

const _pageTitleCache = new Map();

async function resolvePageTitle(pageId) {
  if (_pageTitleCache.has(pageId)) return _pageTitleCache.get(pageId);
  try {
    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      headers: NOTION_HEADERS
    });
    if (!res.ok) {
      _pageTitleCache.set(pageId, null);
      return null;
    }
    const page = await res.json();
    let title = null;
    for (const [, v] of Object.entries(page.properties)) {
      if (v.type === 'title' && v.title?.length > 0) {
        title = v.title[0].plain_text;
        break;
      }
    }
    _pageTitleCache.set(pageId, title);
    return title;
  } catch {
    _pageTitleCache.set(pageId, null);
    return null;
  }
}

async function resolveRelationIds(ids) {
  if (!ids || !Array.isArray(ids) || ids.length === 0) return null;
  const flatIds = ids.flat().filter(id => typeof id === 'string');
  if (flatIds.length === 0) return null;
  const names = await Promise.all(flatIds.map(id => resolvePageTitle(id)));
  const valid = names.filter(n => n != null);
  return valid.length > 0 ? valid.join(', ') : null;
}

// --- Database Query with Pagination ---

async function queryCatalogo() {
  const allPages = [];
  let cursor = undefined;

  console.log('📡 Consultando BD Catálogo de Insumos en Notion (filtro: Contando = true)...');

  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${CATALOGO_INSUMOS_DB_ID}/query`, {
      method: 'POST',
      headers: NOTION_HEADERS,
      body: JSON.stringify({
        start_cursor: cursor,
        page_size: 100,
        filter: {
          property: 'Contando',
          checkbox: {
            equals: true,
          },
        },
        sorts: [
          { property: 'Concepto', direction: 'ascending' },
        ],
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Error en query Notion Catálogo Insumos (${res.status}): ${errText}`);
    }

    const data = await res.json();
    allPages.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
    if (cursor) {
      await new Promise(r => setTimeout(r, 80)); // Pausa defensiva rate limit
    }
  } while (cursor);

  console.log(`  ✅ ${allPages.length} ítems activos con Contando=true recuperados de Catálogo Insumos.`);
  return allPages;
}

// --- Helper: Format dimensions (L × A × E) ---

function parseDimension(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return String(val);
  if (typeof val === 'string') {
    const trimmed = val.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(val) && val.length > 0) return parseDimension(val[0]);
  return null;
}

function formatDimensiones(largo, ancho, espesor) {
  const parts = [];
  const l = parseDimension(largo);
  const a = parseDimension(ancho);
  const e = parseDimension(espesor);

  if (l) parts.push(l);
  if (a) parts.push(a);
  if (e) parts.push(e);

  return parts.length > 0 ? parts.join(' × ') : null;
}

// --- Transform a Notion page into a normalized inventory item ---

// --- Transform a Notion page into a normalized inventory item ---

async function transformItem(page) {
  const p = page.properties;

  // --- Propiedades primarias de BD_Catalogo_Insumos ---
  const concepto = extractProperty(p['Concepto']);
  const nombreProd = extractProperty(p['Nombre del producto']);
  const nombre = concepto || nombreProd || extractProperty(p['Nombre']) || 'Insumo sin Nombre';

  const stockBase = extractProperty(p['Stock (base)']) ?? 0;
  const stockMinimo = extractProperty(p['Stock mínimo']) ?? 0;
  const estadoStockObj = extractSelectWithColor(p['Estado de Stock']);
  const prioridadObj = extractSelectWithColor(p['Prioridad']) || extractSelectWithColor(p['Prioridades']);
  const origenConsumoObj = extractSelectWithColor(p['Origen de Consumo']);

  const marca = extractProperty(p['Marca']);
  const codigoRaw = extractProperty(p['Código']) || extractProperty(p['Codigo']);
  const codigo = typeof codigoRaw === 'string' ? codigoRaw.trim() : (Array.isArray(codigoRaw) ? codigoRaw[0]?.trim() : '');
  const codigoValeryRaw = extractProperty(p['Código Valery']) || extractProperty(p['Codigo Valery']);
  const codigoValery = typeof codigoValeryRaw === 'string' ? codigoValeryRaw.trim() : '';

  const unidadObj = extractSelectWithColor(p['Unidad de medida']) || extractSelectWithColor(p['Unidad']);
  const unidad = unidadObj?.name || 'UND';

  const color = extractProperty(p['Color']);
  const largo = extractProperty(p['Largo']);
  const ancho = extractProperty(p['Ancho']);
  const espesor = extractProperty(p['Espesor']);
  const dimensionesFmt = formatDimensiones(largo, ancho, espesor);

  const categoriaObj = extractSelectWithColor(p['Categoría de material']) || extractSelectWithColor(p['Categoria']);
  const rolObj = extractSelectWithColor(p['Rol del Material']);
  const ubicacion = extractProperty(p['Ubicación']) || '';
  const costoUnitarioUSD = Number(extractProperty(p['Costo_Unitario_Base_USD'])) || 0;
  const contando = extractProperty(p['Contando']) ?? true;

  // --- Relaciones que requieren resolución de títulos ---
  const departamentoIds = extractProperty(p['Departamentos']);
  const departamento = await resolveRelationIds(
    Array.isArray(departamentoIds) ? departamentoIds : (departamentoIds ? [departamentoIds] : [])
  );
  const procesoIds = extractProperty(p['Diccionario de Conceptos']) || extractProperty(p['Proceso']);
  const proceso = await resolveRelationIds(
    Array.isArray(procesoIds) ? procesoIds : (procesoIds ? [procesoIds] : [])
  );

  // --- Campos derivados y semáforo ---
  const deficit = Math.max(0, stockMinimo - stockBase);
  const coberturaPct = stockMinimo > 0 ? Math.round((stockBase / stockMinimo) * 100) : (stockBase > 0 ? 999 : 0);

  let semaforo;
  if (stockBase === 0) semaforo = 'rojo';
  else if (stockBase < stockMinimo) semaforo = 'naranja';
  else semaforo = 'verde';

  let estadoStock = estadoStockObj?.name;
  let estadoStockColor = estadoStockObj?.color;
  if (!estadoStock) {
    if (stockBase === 0) { estadoStock = 'Sin Stock'; estadoStockColor = 'red'; }
    else if (stockBase < stockMinimo) { estadoStock = 'Bajo Mínimo'; estadoStockColor = 'orange'; }
    else { estadoStock = 'En Stock'; estadoStockColor = 'green'; }
  }

  let prioridad = prioridadObj?.name || (stockBase < stockMinimo ? 'Alta' : 'Media');
  let prioridadColor = prioridadObj?.color || (stockBase < stockMinimo ? 'orange' : 'gray');

  return {
    id: page.id,
    insumoId: page.id,
    dashboardId: page.id,
    nombre,
    codigo,
    codigoValery,
    marca: typeof marca === 'string' ? marca.trim() : (Array.isArray(marca) ? marca[0]?.trim() : ''),
    costoUnitarioUSD,
    stockBase,
    stockMinimo,
    deficit,
    coberturaPct,
    semaforo,
    estadoStock,
    estadoStockColor,
    prioridad,
    prioridadColor,
    origenConsumo: origenConsumoObj?.name || null,
    origenConsumoColor: origenConsumoObj?.color || null,
    categoriaMaterial: categoriaObj?.name || 'General',
    categoriaMaterialColor: categoriaObj?.color || null,
    rolMaterial: rolObj?.name || 'Materia Prima',
    rolMaterialColor: rolObj?.color || null,
    unidad,
    color: typeof color === 'string' ? color : (Array.isArray(color) ? color[0] : null),
    dimensiones: dimensionesFmt,
    ubicacion,
    contando,
    departamento: departamento || null,
    proceso: proceso || null,
    grupoProceso: null,
    grupoProcesoColor: null,
    seReconto3D: false,
    seRecontoHoy: false,
    ultimaFechaReconteo: null,
    diasDesdeReconteo: null,
    necesitaReconteo: false,
  };
}

// --- Compute KPIs from items ---

function computeKPIs(items) {
  const total = items.length;
  const sinStock = items.filter(i => i.estadoStock === 'Sin Stock').length;
  const bajoMinimo = items.filter(i => i.estadoStock === 'Bajo Mínimo').length;
  const enStock = items.filter(i => i.estadoStock === 'En Stock').length;
  const enReconteo = items.filter(i => i.estadoStock === 'En Reconteo').length;
  const descontinuado = items.filter(i => i.estadoStock === 'Descontinuado').length;
  const auditados3D = items.filter(i => i.seReconto3D === true).length;
  const auditados3DPct = total > 0 ? Math.round((auditados3D / total) * 100) : 0;

  // Prioridades
  const urgente = items.filter(i => i.prioridad === 'Urgente').length;
  const alta = items.filter(i => i.prioridad === 'Alta').length;
  const media = items.filter(i => i.prioridad === 'Media').length;
  const baja = items.filter(i => i.prioridad === 'Baja').length;
  const porPedido = items.filter(i => i.prioridad === 'Por Pedido').length;

  return {
    total,
    estado: { sinStock, bajoMinimo, enStock, enReconteo, descontinuado },
    prioridad: { urgente, alta, media, baja, porPedido },
    auditados3D,
    auditados3DPct,
  };
}

function getSelectOrders() {
  return {
    estadoStock: ['Sin Stock', 'Descontinuado', 'Bajo Mínimo', 'En Reconteo', 'En Stock'],
    prioridad: ['Urgente', 'Alta', 'Media', 'Baja', 'Por Pedido'],
    origenConsumo: ['Proyecto (Presupuestado)', 'Proyecto (No Presupuestado)', 'Stock General', 'Mantenimiento', 'Conteo / Ajuste'],
    rolMaterial: ['Materia Prima', 'Componente', 'Revestimiento', 'Consumible', 'Herramienta', 'Suministro General'],
  };
}

// --- Main ---

async function main() {
  console.log('🏭 Sanesca — Dashboard de Inventario — Extractor Autónomo v2.0.0 (ESM)');
  console.log('─'.repeat(60));

  const startTime = Date.now();

  const pages = await queryCatalogo();

  console.log('🔄 Transformando datos y resolviendo relaciones...');
  const items = [];
  const BATCH_SIZE = 10;
  for (let i = 0; i < pages.length; i += BATCH_SIZE) {
    const batch = pages.slice(i, i + BATCH_SIZE);
    const batchItems = await Promise.all(batch.map(p => transformItem(p)));
    items.push(...batchItems);
    process.stdout.write(`  📦 ${items.length}/${pages.length} procesados...\r`);
    await new Promise(r => setTimeout(r, 40));
  }
  console.log(`\n  ✅ ${items.length} ítems transformados (${_pageTitleCache.size} relaciones resueltas)`);

  const kpis = computeKPIs(items);
  console.log(`  📊 KPIs: ${kpis.estado.sinStock} sin stock, ${kpis.estado.bajoMinimo} bajo mínimo, ${kpis.estado.enStock} en stock`);

  const selectOrders = getSelectOrders();

  const inventory = {
    items,
    kpis,
    selectOrders,
  };

  const meta = {
    lastSync: new Date().toISOString(),
    lastSyncLocal: new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' }),
    itemCount: items.length,
    buildStatus: 'success',
    version: '2.0.0',
    durationMs: Date.now() - startTime,
  };

  for (const dir of OUTPUT_DIRS) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(path.join(dir, 'inventory.json'), JSON.stringify(inventory, null, 2), 'utf-8');
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
    console.log(`  💾 Guardado en: ${dir}`);
  }

  // 5. Purga de Residuos en Edge KV (Erradicación de Doble Verdad)
  try {
    let cfToken = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_TOKEN || '';
    if (!cfToken) {
      const candidatePaths = [
        path.join(__dirname, '..', '.env'),
        path.join(__dirname, '..', '..', 'apps', 'despacho', '.env'),
        path.join(__dirname, '..', '..', '..', 'apps', 'despacho', '.env'),
        path.join(__dirname, '..', '..', '06_Scripts_Automatizacion', 'bot_produccion', '.env'),
        path.join(__dirname, '..', '..', '..', '06_Scripts_Automatizacion', 'bot_produccion', '.env')
      ];
      for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
          const match = fs.readFileSync(p, 'utf8').match(/(?:CLOUDFLARE_API_TOKEN|CF_TOKEN)\s*=\s*(.+)/);
          if (match && match[1]) {
            cfToken = match[1].trim().replace(/^['"]|['"]$/g, '');
            break;
          }
        }
      }
    }
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '98ee9f66220ad7147392ace5bb911953';
    const kvId = '3426df82fd7144ab84096d1aaf936535';

    if (cfToken && accountId && kvId) {
      await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${kvId}/values/live_stock_deltas`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${cfToken}` }
      });
      console.log('  🧹 Cloudflare Edge KV purgado con éxito (live_stock_deltas reseteado).');
    }
  } catch (purgeErr) {
    console.warn('  ⚠️ Advertencia purgando deltas en Edge KV:', purgeErr.message);
  }

  console.log('─'.repeat(60));
  console.log(`✅ Snapshot 100% sincronizado con Notion:`);
  console.log(`   📦 Total ítems: ${items.length}`);
  console.log(`   ⏱️  Duración: ${meta.durationMs}ms`);
  console.log(`   🕐 Timestamp: ${meta.lastSyncLocal}`);
}

main().catch(err => {
  console.error('❌ Error fatal:', err);
  process.exit(1);
});
