/**
 * fetch-inventory.js
 * Extrae datos de la BD Dashboard de Notion y genera data/inventory.json + data/meta.json
 * 
 * Arquitectura simplificada: 1 sola query al Dashboard.
 * Las propiedades de BSD (Marca, Código, Unidad, Medidas, Color, Categoría, Rol)
 * llegan como rollups vía la relación Producto.
 * 
 * Filtro base: Contando = true (solo publica ítems marcados para la web)
 * 
 * @see specs_frontend.md — Catálogo de 17 columnas
 * @see pre_fase1_propiedades_interfaz.md — Inventario de propiedades
 */

const { Client } = require('@notionhq/client');
const fs = require('fs');
const path = require('path');

// --- Configuration ---
const NOTION_TOKEN = process.env.SANESCATOKEN || process.env.NOTION_TOKEN;
const DASHBOARD_DB_ID = process.env.NOTION_DASHBOARD_DB_ID || '2b586805-4e27-80fe-b6e8-e4c6dc325696';
const OUTPUT_DIR = path.join(__dirname, '..', 'data');

let notion = null;
if (NOTION_TOKEN) {
  notion = new Client({ auth: NOTION_TOKEN });
} else {
  console.error('❌ ERROR: Variable SANESCATOKEN o NOTION_TOKEN no definida.');
  process.exit(1);
}

// --- Notion Property Extractors (reutilizados de fetch-notion.js) ---

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
        // Handle relation items specially (they contain IDs, not extractable values)
        if (item.type === 'relation') {
          return item.relation?.map(r => r.id) || [];
        }
        // Handle date items in arrays (rollup of date fields)
        if (item.type === 'date') {
          return item.date?.start || null;
        }
        return extractProperty(item);
      }) || [];
      // Si el array tiene 1 solo elemento, devolver el valor directo (patrón show_original)
      if (items.length === 1) return items[0];
      // Si tiene múltiples, devolver el array
      if (items.length > 1) return items;
      return null;
    }
    default: return null;
  }
}

// --- Extractor de Color de Select/Status ---

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

// --- Rollup que preserva color del select original ---

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

// --- Batch page title resolver (for relation → name) ---

const _pageTitleCache = new Map();

async function resolvePageTitle(pageId) {
  if (_pageTitleCache.has(pageId)) return _pageTitleCache.get(pageId);
  try {
    const page = await notion.pages.retrieve({ page_id: pageId });
    // Find the title property (could be "Nombre", "Name", etc.)
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
  // Flatten nested arrays (rollup of relation returns [[id1], [id2]])
  const flatIds = ids.flat().filter(id => typeof id === 'string');
  if (flatIds.length === 0) return null;
  const names = await Promise.all(flatIds.map(id => resolvePageTitle(id)));
  const valid = names.filter(n => n != null);
  return valid.length > 0 ? valid.join(', ') : null;
}

// --- Database Query with Pagination ---

async function queryDashboard() {
  const allPages = [];
  let cursor = undefined;

  console.log('📡 Consultando BD Dashboard (filter: Contando = true)...');

  do {
    const response = await notion.databases.query({
      database_id: DASHBOARD_DB_ID,
      start_cursor: cursor,
      page_size: 100,
      filter: {
        property: 'Contando',
        checkbox: {
          equals: true,
        },
      },
      sorts: [
        { property: 'Nombre', direction: 'ascending' },
      ],
    });

    allPages.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  console.log(`  ✅ ${allPages.length} ítems con Contando=true`);
  return allPages;
}

// --- Transform a Notion page into a normalized inventory item ---

async function transformItem(page) {
  const p = page.properties;

  // --- Direct properties from Dashboard ---
  const nombre = extractProperty(p['Nombre']);
  const stockBase = extractProperty(p['Stock (base)']) ?? 0;
  const stockMinimo = extractProperty(p['Stock mínimo']) ?? 0;
  const estadoStock = extractSelectWithColor(p['Estado de Stock']);
  const prioridad = extractSelectWithColor(p['Prioridades']);
  const origenConsumo = extractSelectWithColor(p['Origen de Consumo']);
  const movimiento = extractProperty(p['Movimiento']);
  const seReconto3D = extractProperty(p['Se recontó (3D)']);
  const seRecontoHoy = extractProperty(p['Se recontó hoy']);
  const contando = extractProperty(p['Contando']);

  // --- Rollups from BSD via Producto relation ---
  const marca = extractProperty(p['Marca']);
  const codigo = extractProperty(p['Codigo']);
  const unidad = extractRollupSelect(p['Unidad']);
  const color = extractProperty(p['Color']);
  const largo = extractProperty(p['Largo']);
  const ancho = extractProperty(p['Ancho']);
  const espesor = extractProperty(p['Espesor']);
  const categoriaMaterial = extractRollupSelect(p['Categoría de material']);
  const rolMaterial = extractRollupSelect(p['Rol del Material']);

  // --- Rollups that need resolution ---
  const grupoProceso = extractRollupSelect(p['Grupo de Proceso']);
  const fechaReconteo = extractProperty(p['Fecha de Reconteo']);

  // --- Relations that need title resolution ---
  const departamentoIds = extractProperty(p['Departamentos']); // rollup of relation → IDs
  const departamento = await resolveRelationIds(
    Array.isArray(departamentoIds) ? departamentoIds : (departamentoIds ? [departamentoIds] : [])
  );
  const procesoIds = extractProperty(p['Proceso']); // relation → IDs
  const proceso = await resolveRelationIds(
    Array.isArray(procesoIds) ? procesoIds : (procesoIds ? [procesoIds] : [])
  );

  // --- Derived fields ---
  const deficit = Math.max(0, stockMinimo - stockBase);
  const coberturaPct = stockMinimo > 0 ? Math.round((stockBase / stockMinimo) * 100) : (stockBase > 0 ? 999 : 0);

  // Semáforo calculado (redundante con Estado de Stock, pero útil para lógica frontend)
  let semaforo;
  if (stockBase === 0) semaforo = 'rojo';
  else if (stockBase < stockMinimo) semaforo = 'naranja';
  else semaforo = 'verde';

  // Dimensiones formateadas
  const dimensionesFmt = formatDimensiones(largo, ancho, espesor);

  // Días desde último reconteo
  let diasDesdeReconteo = null;
  let ultimaFechaReconteo = null;
  if (Array.isArray(fechaReconteo) && fechaReconteo.length > 0) {
    // Obtener la fecha más reciente del array
    const fechas = fechaReconteo
      .filter(f => f != null)
      .map(f => new Date(f))
      .sort((a, b) => b - a);
    if (fechas.length > 0) {
      ultimaFechaReconteo = fechas[0].toISOString().split('T')[0];
      diasDesdeReconteo = Math.floor((Date.now() - fechas[0].getTime()) / (1000 * 60 * 60 * 24));
    }
  } else if (typeof fechaReconteo === 'string') {
    ultimaFechaReconteo = fechaReconteo;
    diasDesdeReconteo = Math.floor((Date.now() - new Date(fechaReconteo).getTime()) / (1000 * 60 * 60 * 24));
  }

  const necesitaReconteo = diasDesdeReconteo !== null ? diasDesdeReconteo > 7 && !seReconto3D : null;

  return {
    id: page.id,
    nombre,
    codigo: typeof codigo === 'string' ? codigo : (Array.isArray(codigo) ? codigo[0] : null),
    marca: typeof marca === 'string' ? marca : (Array.isArray(marca) ? marca[0] : null),
    stockBase,
    stockMinimo,
    deficit,
    coberturaPct,
    semaforo,
    estadoStock: estadoStock?.name || null,
    estadoStockColor: estadoStock?.color || null,
    prioridad: prioridad?.name || null,
    prioridadColor: prioridad?.color || null,
    origenConsumo: origenConsumo?.name || null,
    origenConsumoColor: origenConsumo?.color || null,
    categoriaMaterial: categoriaMaterial?.name || (typeof categoriaMaterial === 'string' ? categoriaMaterial : null),
    categoriaMaterialColor: categoriaMaterial?.color || null,
    rolMaterial: rolMaterial?.name || (typeof rolMaterial === 'string' ? rolMaterial : null),
    rolMaterialColor: rolMaterial?.color || null,
    unidad: unidad?.name || (typeof unidad === 'string' ? unidad : null),
    color: typeof color === 'string' ? color : (Array.isArray(color) ? color[0] : null),
    dimensiones: dimensionesFmt,
    departamento: departamento || null,
    proceso: proceso || null,
    grupoProceso: grupoProceso?.name || (typeof grupoProceso === 'string' ? grupoProceso : null),
    grupoProcesoColor: grupoProceso?.color || null,
    seReconto3D: seReconto3D || false,
    seRecontoHoy: seRecontoHoy || false,
    ultimaFechaReconteo,
    diasDesdeReconteo,
    necesitaReconteo,
  };
}

// --- Helper: Format dimensions (L × A × E) ---

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

// --- Helper: Format departamento (can be array or string from rollup) ---

function formatDepartamento(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) {
    const names = val.filter(v => v != null && v !== '').map(v => typeof v === 'string' ? v : String(v));
    return names.length > 0 ? names.join(', ') : null;
  }
  return null;
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

// --- Compute select option orders for frontend sorting ---

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
  console.log('🏭 Sanesca — Dashboard de Inventario — Extractor v1.0.0');
  console.log('─'.repeat(60));

  const startTime = Date.now();

  // Query Dashboard
  const pages = await queryDashboard();

  // Transform items (async — resolves relation IDs to names)
  console.log('🔄 Transformando datos (resolviendo relaciones)...');
  const items = [];
  // Process in batches to avoid API rate limits
  const BATCH_SIZE = 10;
  for (let i = 0; i < pages.length; i += BATCH_SIZE) {
    const batch = pages.slice(i, i + BATCH_SIZE);
    const batchItems = await Promise.all(batch.map(p => transformItem(p)));
    items.push(...batchItems);
    if (i + BATCH_SIZE < pages.length) {
      process.stdout.write(`  📦 ${items.length}/${pages.length} procesados...\r`);
    }
  }
  console.log(`  ✅ ${items.length} ítems transformados (${_pageTitleCache.size} páginas resueltas)`);

  // Compute KPIs
  const kpis = computeKPIs(items);
  console.log(`  📊 KPIs: ${kpis.estado.sinStock} sin stock, ${kpis.estado.bajoMinimo} bajo mínimo, ${kpis.estado.enStock} en stock`);

  // Select orders for frontend
  const selectOrders = getSelectOrders();

  // Build output
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
    version: '1.0.0',
    durationMs: Date.now() - startTime,
  };

  // Write output files
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'inventory.json'),
    JSON.stringify(inventory, null, 2),
    'utf-8'
  );

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'meta.json'),
    JSON.stringify(meta, null, 2),
    'utf-8'
  );

  console.log('─'.repeat(60));
  console.log(`✅ Datos generados exitosamente:`);
  console.log(`   📁 data/inventory.json (${items.length} ítems)`);
  console.log(`   📁 data/meta.json`);
  console.log(`   ⏱️  ${meta.durationMs}ms`);
  console.log(`   🕐 ${meta.lastSyncLocal}`);
}

main().catch(err => {
  console.error('❌ Error fatal:', err.message);
  process.exit(1);
});
