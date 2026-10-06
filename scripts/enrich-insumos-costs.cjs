/**
 * Sanesca PRO — Enriquecedor Maestro de Costos Base de Insumos
 * Script: scripts/enrich-insumos-costs.cjs
 * 
 * Implementa la gobernanza de costos del Pilar 1 (Fase 9E) con fallback en 3 niveles:
 *  - Nivel A: Compras Reales en Órdenes de Abastecimiento (BD_Lineas_Abastecimiento)
 *  - Nivel B: Catálogo de Inventario Físico (inventory.json)
 *  - Nivel C: Matriz Paramétrica Industrial Sanesca (precios de reposición por ítem/familia)
 * 
 * Uso:
 *   node scripts/enrich-insumos-costs.cjs --dry-run
 *   node scripts/enrich-insumos-costs.cjs --apply
 */

const fs = require('fs');
const path = require('path');

// Rutas clave
const ROOT_DIR = path.resolve(__dirname, '..');
const ENV_PATH_TELEMETRIA = path.resolve(ROOT_DIR, '../../06_Scripts_Automatizacion/bot_telemetria/.env');
const MAP_PATH = path.resolve(ROOT_DIR, '../../data/catalogo_insumos_notion_map.json');
const INVENTORY_PATH = path.resolve(ROOT_DIR, 'data/inventory.json');

// Base de datos de Notion
const INSUMOS_DB_ID = '26286805-4e27-8067-8847-d39de1bf0bde';
const LINEAS_ABASTECIMIENTO_DB_ID = '2bc86805-4e27-8036-ba88-d52ec84742ba';

// Obtener token
function getNotionToken() {
  if (process.env.SANESCATOKEN || process.env.NOTION_TOKEN) {
    return process.env.SANESCATOKEN || process.env.NOTION_TOKEN;
  }
  if (fs.existsSync(ENV_PATH_TELEMETRIA)) {
    const envTxt = fs.readFileSync(ENV_PATH_TELEMETRIA, 'utf8');
    const m = envTxt.match(/NOTION_TOKEN=(.*)/);
    if (m && m[1].trim()) return m[1].trim();
  }
  return '';
}

const NOTION_TOKEN = getNotionToken();
if (!NOTION_TOKEN) {
  console.error('ERROR: No se encontró NOTION_TOKEN en entorno ni en bot_telemetria/.env');
  process.exit(1);
}

const NOTION_HEADERS = {
  'Authorization': `Bearer ${NOTION_TOKEN}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json'
};

// Flags de CLI
const isDryRun = process.argv.includes('--dry-run') || !process.argv.includes('--apply');
const isApply = process.argv.includes('--apply');

// ============================================================================
// MATRIZ PARAMÉTRICA INDUSTRIAL SANESCA (Nivel C)
// Precios referenciales de reposición industrial en USD (Venezuela 2025-2026)
// ============================================================================

// 1. Costos específicos por código o coincidencia exacta de concepto
const COSTOS_ESPECIFICOS = {
  // Tubos y Perfiles Metálicos (Costo por metro lineal en barra 6m)
  'TUB-021': 2.00, // Tubo Hierro 1X1 1.1mm E ($12.00 / 6m)
  'TUB-022': 2.50, // Tubo Hierro 1-1/2 X 1-1/2 ($15.00 / 6m)
  'TUB-023': 2.70, // Tubo Hierro 2X1 ($16.20 / 6m)
  'TUB-024': 3.60, // Tubo Hierro 2X2 ($21.60 / 6m)
  'TUB-001': 5.80, // Tubo Inoxidable 1-1/2 X 1/2 Cal 1.1mm ($34.80 / 6m)
  'TUB-002': 6.20, // Tubo Inoxidable 1X1 ($37.20 / 6m)
  'TUB-003': 7.50, // Tubo Inoxidable 2X1 ($45.00 / 6m)
  'PLA-001': 1.60, // Ángulo de Hierro 1X1 ($9.60 / 6m)
  'PLA-002': 2.20, // Ángulo de Hierro 1-1/2 ($13.20 / 6m)
  'PLA-003': 1.40, // Platina 1X1/8 ($8.40 / 6m)
  'PLA-004': 2.10, // Platina 1-1/2X1/8 ($12.60 / 6m)
  'BAR-001': 1.10, // Cabilla de 1/2" ($6.60 / 6m)

  // Abrasivos y Herramientas (Por unidad)
  'DIS-013': 1.20, // Disco Corte Metal 4-1/2
  'DIS-012': 3.50, // Disco Corte Melamina
  'DIS-009': 1.80, // Discos Flap Circonia P40/P60/P80
  'DIS-001': 1.20, // Disco de corte fino
  'DIS-002': 2.00, // Disco de desbaste
  'LIJ-001': 0.60, // Lija de agua/hierro
  'LIJ-002': 0.60, // Lija 120
  'LIJ-003': 0.60, // Lija 150
  'LIJ-004': 0.60, // Lija 240
  'PUN-001': 2.50, // Mecha Concreto 3/8"
  'PUN-002': 1.80, // Mecha Cobalto metal
  'PUN-003': 1.50, // Punta destornillador Phillips PH2

  // Soldadura y Gases (Por unidad o m3)
  'SOL-018': 1.40, // Gas de protección mezcla Argon/CO2 ($/m3 aprox)
  'SOL-001': 3.80, // Alambre MIG ER70S-6 (costo por kg)
  'SOL-002': 2.50, // Aislante cerámico torcha MIG
  'SOL-003': 0.80, // Boquilla de contacto MIG
  'SOL-004': 3.20, // Electrodo 6013 (kg)

  // Fijaciones y Tornillería (Por unidad)
  'TOR-031': 0.025, // Tornillo 6X5/8
  'TOR-030': 0.030, // Tornillo Drywall 6 X 1-1/4
  'TOR-029': 0.035, // Tornillo Drywall 6 X 1-1/2
  'TOR-028': 0.180, // Tornillo Hexagonal Para Nivelador 3/8
  'TOR-027': 0.150, // Tornillo 3/8 X 1 1/4
  'TOR-026': 0.035, // Tornillo Drywall 6X 1-1/2
  'TOR-001': 0.030, // Tornillo Drywall general
  'TOR-002': 0.025, // Tornillo bisagra
  'TOR-003': 0.040, // Tornillo autorroscante
  'TUE-009': 0.080, // Tuerca Hexagonal 3/8" Inox
  'TUE-008': 0.060, // Tuerca Hexagonal 1/4" Inox
  'TUE-007': 0.045, // Tuerca 1/4" fina
  'TUE-006': 0.040, // Tuerca 1/4" normal
  'TUE-005': 0.090, // Tuerca ciega bellota
  'TUE-001': 0.035, // Tuerca 3/8" estándar
  'CLA-001': 0.020, // Pines plafón / clavos

  // Tableros y Maderas (Por lámina completa 1.22 x 2.44m)
  'TAB-037': 38.00, // Lamina Compuesto 18mm
  'TAB-001': 42.00, // Melamina Blanca 18mm
  'TAB-002': 48.00, // Melamina Maderada 18mm
  'TAB-003': 32.00, // MDF 15mm
  'TAB-004': 28.00, // MDF 12mm
  'TAB-005': 24.00, // MDF 9mm
  'TAB-006': 18.00, // MDF 3mm (fondo)
  'LAM-001': 24.00, // Formica Diseño Color y Maderado
  'LAM-002': 22.00, // Formica Blanca
  'LAM-003': 26.00, // Fórmica acabado especial

  // Láminas Metálicas (Por lámina)
  'LMT-001': 48.00, // Lámina Hierro 5mm
  'LMT-002': 38.00, // Lámina Hierro 3mm
  'LMT-003': 32.00, // Lámina Hierro 2mm
  'LMT-004': 26.00, // Lámina Hierro 1.5mm
  'LMT-005': 22.00, // Lámina Hierro 1.1mm (cal 18/20)
  'MAL-001': 28.00, // Malla Metal Expandido

  // Tapacantos (Por metro lineal)
  'TAP-001': 0.25, // Canto PVC 22x0.45mm
  'TAP-002': 0.45, // Canto PVC 22x1mm
  'TAP-003': 0.65, // Canto PVC 45mm

  // Adhesivos y Químicos (Por galón o unidad)
  'QUI-006': 18.00, // Sellador 1/2 Gal
  'QUI-001': 28.00, // Pega Amarilla de contacto (galón)
  'QUI-002': 12.00, // Thinner acrílico (galón)
  'QUI-003': 15.00, // Solvente desengrasante
  'ADH-001': 28.00, // Pega Forza 7K 1/4 galón ($7.00/cuarto -> $28.00/gal)
  'ADH-002': 4.50,  // Silicón Neutro tubo
  'PIN-001': 8.50,  // Pintura electrostática en polvo (kg)
  'PIN-002': 24.00, // Pintura esmalte líquido galón
  'SEL-001': 22.00, // Laca Nitrocelulosa Galón

  // Herrajes y Accesorios (Por unidad / par)
  'PCA-002': 0.85, // Pasacable Negro / Blanco
  'RUE-005': 3.80, // Rueda 2" Giratoria C/Freno
  'RUE-004': 3.20, // Rueda 2" Giratoria
  'RUE-003': 2.80, // Rueda 2" Fija
  'DES-001': 0.45, // Regatón plástico rectangular
  'DES-002': 0.50, // Nivelador de rosca 3/8"
  'HER-001': 4.50, // Correderas telescópicas pesadas par
  'HER-002': 1.80, // Bisagras de cazoleta cierre suave par
  'HER-003': 2.20, // Cerradura para mueble / gaveta
  'HER-041': 6.50, // Fosfato líquido (tratamiento químico)
  'HER-058': 2.50, // Herraje especial M157
  'CAD-001': 0.75, // Perrito para guaya
  'CAD-002': 1.20, // Guaya de acero metro
  'EMB-001': 28.00, // Rollo burbuja 1.20m
  'EMB-002': 16.00, // Rollo stretch film embalaje

  // EPP e Indumentaria
  'EPP-001': 8.50, // Peto carnaza soldador
  'EPP-002': 3.20, // Guantes carnaza
  'EPP-003': 2.20, // Lentes de seguridad
  'LIM-001': 1.50, // Insumo limpieza general
  'HMA-001': 45.00 // Nivel Láser
};

// 2. Costos de respaldo por Categoría y Subfamilia (si no hay match específico)
const COSTOS_POR_DEFECTO_CATEGORIA = {
  'Perfiles y Tubos': 2.40,               // Metro lineal
  'Tubería (Cuadrada/Rectangular)': 2.50, // Metro lineal
  'Tubería (Redonda)': 2.20,              // Metro lineal
  'Tubería (Especializada)': 3.80,        // Metro lineal
  'Platinas': 1.50,                       // Metro lineal
  'Barras y Varillas': 1.20,              // Metro lineal
  'Tableros': 36.00,                      // Lámina
  'Laminados Decorativos': 22.00,         // Lámina
  'Láminas': 30.00,                       // Lámina
  'Mallas': 26.00,                        // Lámina
  'Fijaciones (Tornillería)': 0.035,      // Unidad
  'Abrasivos': 1.50,                      // Unidad
  'Herramientas y Abrasivos': 1.80,       // Unidad
  'Adhesivos y Químicos': 16.00,          // Galón / Envase
  'Tapacantos': 0.30,                     // Metro
  'Herrajes y Accesorios': 2.80,          // Unidad
  'Equipo de Protección Personal (EPP)': 4.50,
  'Indumentaria y Seguridad': 8.00,
  'Suministros Neumáticos': 3.50,
  'Suministros de Limpieza': 2.00,
  'Equipos y Maquinaria': 50.00
};

// Helper: inferir costo paramétrico
function inferirCostoParametrico(item) {
  const code = (item.codigo || '').trim().toUpperCase();
  const concepto = (item.concepto || item.nombre || '').toLowerCase();
  const cat = item.cat || '';

  // 1. Coincidencia directa por código exacto
  if (COSTOS_ESPECIFICOS[code]) {
    return { costo: COSTOS_ESPECIFICOS[code], regla: `Específico (${code})` };
  }

  // 2. Coincidencia por prefijo y palabras clave
  if (code.startsWith('TUB-') || code.startsWith('PLA-') || code.startsWith('BAR-')) {
    if (concepto.includes('inoxidable') || concepto.includes('inox')) return { costo: 6.00, regla: 'Tubo/Perfil Inox' };
    if (concepto.includes('2x2')) return { costo: 3.60, regla: 'Tubo 2x2' };
    if (concepto.includes('2x1') || concepto.includes('1-1/2')) return { costo: 2.70, regla: 'Tubo 2x1/1-1/2' };
    if (concepto.includes('1x1')) return { costo: 2.00, regla: 'Tubo 1x1' };
    return { costo: 2.40, regla: 'Perfil/Tubo Estándar' };
  }

  if (code.startsWith('TAB-') || cat === 'Tableros') {
    if (concepto.includes('melamina')) return { costo: 42.00, regla: 'Melamina 18mm' };
    if (concepto.includes('compuesto')) return { costo: 38.00, regla: 'Tablero Compuesto' };
    if (concepto.includes('mdf 15') || concepto.includes('mdf 18')) return { costo: 32.00, regla: 'MDF Grueso' };
    if (concepto.includes('mdf')) return { costo: 22.00, regla: 'MDF Delgado' };
    return { costo: 36.00, regla: 'Tablero Estándar' };
  }

  if (code.startsWith('TOR-') || code.startsWith('TUE-') || code.startsWith('CLA-') || cat === 'Fijaciones (Tornillería)') {
    if (concepto.includes('drywall')) return { costo: 0.030, regla: 'Tornillo Drywall' };
    if (concepto.includes('3/8') || concepto.includes('hexagonal')) return { costo: 0.120, regla: 'Tornillo/Tuerca 3/8' };
    if (concepto.includes('inox')) return { costo: 0.080, regla: 'Fijación Inox' };
    return { costo: 0.035, regla: 'Tornillo Estándar' };
  }

  if (code.startsWith('DIS-') || code.startsWith('LIJ-') || cat === 'Abrasivos' || cat === 'Herramientas y Abrasivos') {
    if (concepto.includes('corte metal') || concepto.includes('corte fino')) return { costo: 1.20, regla: 'Disco Corte Metal' };
    if (concepto.includes('flap')) return { costo: 1.80, regla: 'Disco Flap' };
    if (concepto.includes('melamina')) return { costo: 3.50, regla: 'Disco Melamina' };
    if (concepto.includes('lija')) return { costo: 0.60, regla: 'Lija' };
    return { costo: 1.50, regla: 'Abrasivo Estándar' };
  }

  if (code.startsWith('QUI-') || code.startsWith('ADH-') || code.startsWith('PIN-') || code.startsWith('SEL-')) {
    if (concepto.includes('pega')) return { costo: 28.00, regla: 'Pega de Contacto' };
    if (concepto.includes('thinner') || concepto.includes('solvente')) return { costo: 12.00, regla: 'Solvente/Thinner' };
    if (concepto.includes('polvo') || concepto.includes('electrost')) return { costo: 8.50, regla: 'Pintura Polvo (kg)' };
    if (concepto.includes('silicon')) return { costo: 4.50, regla: 'Silicón Tubo' };
    return { costo: 16.00, regla: 'Químico/Adhesivo Estándar' };
  }

  if (code.startsWith('RUE-')) {
    if (concepto.includes('freno')) return { costo: 3.80, regla: 'Rueda C/Freno' };
    return { costo: 3.00, regla: 'Rueda Estándar' };
  }

  // 3. Fallback general por categoría
  if (COSTOS_POR_DEFECTO_CATEGORIA[cat]) {
    return { costo: COSTOS_POR_DEFECTO_CATEGORIA[cat], regla: `Categoría (${cat})` };
  }

  return { costo: 2.00, regla: 'Fallback General Insumo' };
}

// ============================================================================
// FLUJO DE EJECUCIÓN PRINCIPAL
// ============================================================================

async function runEnrichment() {
  console.log('================================================================');
  console.log(' SANESCA PRO — ENRIQUECIMIENTO DE COSTOS BASE DE INSUMOS (FASE 9E)');
  console.log(` Modo: ${isApply ? '🚀 APLICAR EN NOTION (--apply)' : '🔍 SIMULACIÓN (--dry-run)'}`);
  console.log('================================================================\n');

  // 1. Obtener insumos desde Notion (BD_Catalogo_Insumos)
  console.log('1. Consultando catálogo completo de BD_Catalogo_Insumos en Notion...');
  let hasMore = true;
  let cursor = undefined;
  const allNotionInsumos = [];

  while (hasMore) {
    const res = await fetch(`https://api.notion.com/v1/databases/${INSUMOS_DB_ID}/query`, {
      method: 'POST',
      headers: NOTION_HEADERS,
      body: JSON.stringify({ page_size: 100, start_cursor: cursor })
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Error consultando BD_Catalogo_Insumos:', res.status, err);
      process.exit(1);
    }

    const data = await res.json();
    for (const r of data.results) {
      allNotionInsumos.push({
        id: r.id,
        concepto: r.properties['Concepto']?.title?.[0]?.plain_text || '',
        nombre: r.properties['Nombre del producto']?.rich_text?.[0]?.plain_text || '',
        codigo: (r.properties['Código']?.rich_text?.[0]?.plain_text || '').trim().toUpperCase(),
        valery: (r.properties['Código Valery']?.rich_text?.[0]?.plain_text || '').trim().toUpperCase(),
        cat: r.properties['Categoría de material']?.select?.name || '',
        unidad: r.properties['Unidad de medida']?.select?.name || 'Und',
        costoActual: r.properties['Costo_Unitario_Base_USD']?.number
      });
    }
    hasMore = data.has_more;
    cursor = data.next_cursor;
  }
  console.log(`✓ Total insumos recuperados de Notion: ${allNotionInsumos.length} registros.\n`);

  // 2. Consultar Líneas de Abastecimiento (Nivel A)
  console.log('2. Buscando compras reales en BD_Lineas_Abastecimiento (Nivel A)...');
  const costosNivelA = {};
  try {
    const oabRes = await fetch(`https://api.notion.com/v1/databases/${LINEAS_ABASTECIMIENTO_DB_ID}/query`, {
      method: 'POST',
      headers: NOTION_HEADERS,
      body: JSON.stringify({ page_size: 100 })
    });
    if (oabRes.ok) {
      const oabData = await oabRes.json();
      for (const row of oabData.results || []) {
        const costo = row.properties['Costo Estimado ($ USD)']?.number;
        const prodRel = row.properties['Producto']?.relation;
        if (costo && costo > 0 && Array.isArray(prodRel)) {
          for (const rel of prodRel) {
            costosNivelA[rel.id] = costo;
          }
        }
      }
    }
    console.log(`✓ Precios encontrados en OAB / Compras: ${Object.keys(costosNivelA).length} referencias.`);
  } catch (err) {
    console.warn('⚠️ No se pudo consultar BD_Lineas_Abastecimiento:', err.message);
  }

  // 3. Consultar inventario físico local (Nivel B)
  console.log('\n3. Verificando catálogo local de inventario (Nivel B)...');
  const invMap = {};
  if (fs.existsSync(INVENTORY_PATH)) {
    try {
      const invData = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
      const items = Array.isArray(invData) ? invData : (invData.items || invData.data || []);
      for (const it of items) {
        if (it.codigo) {
          const cost = it.costoReposicionUSD || it.costoUnitarioUSD || it.costoUSD || 0;
          if (cost > 0) invMap[it.codigo.toUpperCase()] = cost;
        }
      }
    } catch (e) {
      console.warn('Advertencia leyendo inventory.json:', e.message);
    }
  }
  console.log(`✓ Precios encontrados en inventory.json: ${Object.keys(invMap).length} referencias.\n`);

  // 4. Procesar enriquecimiento y categorización
  console.log('4. Calculando enriquecimiento de costos en 3 niveles...');
  const stats = {
    total: allNotionInsumos.length,
    nivelA: 0,
    nivelB: 0,
    nivelC: 0,
    conValeryM: 0,
    costoTotalSum: 0,
    costosPorCat: {}
  };

  const enrichedList = [];
  const notionMapList = [];

  for (const item of allNotionInsumos) {
    let costoFinal = 0;
    let fuente = '';
    let detalleRegla = '';

    // Nivel A
    if (costosNivelA[item.id]) {
      costoFinal = costosNivelA[item.id];
      fuente = 'NIVEL_A_OAB';
      detalleRegla = 'Orden de Abastecimiento Aprobada';
      stats.nivelA++;
    } 
    // Nivel B
    else if (invMap[item.codigo]) {
      costoFinal = invMap[item.codigo];
      fuente = 'NIVEL_B_INVENTARIO';
      detalleRegla = 'Costo Reposición Dashboard';
      stats.nivelB++;
    } 
    // Nivel C (Paramétrico Industrial)
    else {
      const inf = inferirCostoParametrico(item);
      costoFinal = inf.costo;
      fuente = 'NIVEL_C_PARAMETRICO';
      detalleRegla = inf.regla;
      stats.nivelC++;
    }

    if (item.valery && item.valery.startsWith('M')) {
      stats.conValeryM++;
    }

    stats.costoTotalSum += costoFinal;
    const cat = item.cat || 'Sin Categoría';
    if (!stats.costosPorCat[cat]) stats.costosPorCat[cat] = { count: 0, sum: 0 };
    stats.costosPorCat[cat].count++;
    stats.costosPorCat[cat].sum += costoFinal;

    const nombreCompleto = item.concepto || item.nombre || item.codigo || item.valery;

    enrichedList.push({
      id: item.id,
      codigo: item.codigo,
      valery: item.valery,
      nombre: nombreCompleto,
      cat: item.cat,
      unidad: item.unidad,
      costoFinal,
      costoAnterior: item.costoActual,
      fuente,
      detalleRegla
    });

    // Formato para catalogo_insumos_notion_map.json
    notionMapList.push({
      id: item.id,
      nombre: nombreCompleto,
      codigoValery: item.valery,
      codigoInterno: item.codigo,
      costoUSD: Number(costoFinal.toFixed(4)),
      unidad: item.unidad,
      cat: item.cat,
      fuenteCosto: fuente
    });
  }

  // 5. Mostrar Reporte Estadístico
  console.log('----------------------------------------------------------------');
  console.log(' RESUMEN ESTADÍSTICO DE ENRIQUECIMIENTO');
  console.log('----------------------------------------------------------------');
  console.log(`• Total Insumos Evaluados:      ${stats.total}`);
  console.log(`• Con Receta BOM (Valery M*):    ${stats.conValeryM}`);
  console.log(`• Enriquecidos Nivel A (OAB):    ${stats.nivelA}`);
  console.log(`• Enriquecidos Nivel B (Inv):    ${stats.nivelB}`);
  console.log(`• Enriquecidos Nivel C (Param):  ${stats.nivelC}`);
  console.log(`• Cobertura de Precios Base:     100.0% (0 insumos en $0.00)\n`);

  console.log('Desglose Promedio por Familia Industrial:');
  for (const [catName, cData] of Object.entries(stats.costosPorCat)) {
    const avg = (cData.sum / cData.count).toFixed(2);
    console.log(`  - ${catName.padEnd(35)}: ${String(cData.count).padStart(3)} ítems | Promedio: $${avg} USD`);
  }

  console.log('\nMuestra de Insumos Críticos Enriquecidos (Recetas BOM):');
  const sampleBom = enrichedList.filter(e => e.valery && e.valery.startsWith('M')).slice(0, 10);
  for (const s of sampleBom) {
    console.log(`  [${s.valery.padEnd(5)}] ${s.codigo.padEnd(8)} | $${s.costoFinal.toFixed(3)} USD | ${s.unidad.padEnd(12)} | ${s.nombre.slice(0, 35)} (${s.detalleRegla})`);
  }

  // 6. Actualizar catalogo_insumos_notion_map.json localmente
  fs.writeFileSync(MAP_PATH, JSON.stringify(notionMapList, null, 2), 'utf8');
  console.log(`\n✓ Archivo local actualizado con nombres y costos: ${MAP_PATH}`);

  // 7. Si es modo --apply, actualizar Notion directamente
  if (isApply) {
    console.log('\n================================================================');
    console.log(' APLICANDO MUTACIONES EN NOTION (BD_Catalogo_Insumos)');
    console.log('================================================================');

    let updatedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < enrichedList.length; i++) {
      const item = enrichedList[i];
      try {
        const patchRes = await fetch(`https://api.notion.com/v1/pages/${item.id}`, {
          method: 'PATCH',
          headers: NOTION_HEADERS,
          body: JSON.stringify({
            properties: {
              'Costo_Unitario_Base_USD': {
                number: Number(item.costoFinal.toFixed(4))
              }
            }
          })
        });

        if (patchRes.ok) {
          updatedCount++;
          if (updatedCount % 25 === 0 || updatedCount === enrichedList.length) {
            console.log(`  -> Actualizados ${updatedCount}/${enrichedList.length} registros en Notion...`);
          }
        } else {
          failedCount++;
          console.error(`  ⚠️ Falló actualización de ${item.codigo} (${item.id}): HTTP ${patchRes.status}`);
        }
      } catch (err) {
        failedCount++;
        console.error(`  ⚠️ Error de red con ${item.codigo}:`, err.message);
      }

      // Throttle de cortesía para respetar límite de 3 peticiones/segundo de Notion
      await new Promise(r => setTimeout(r, 340));
    }

    console.log(`\n✓ Sincronización con Notion concluida.`);
    console.log(`  Éxitos: ${updatedCount} | Fallos: ${failedCount}`);
  } else {
    console.log('\nℹ️ Modo Dry-Run finalizado. Ningún registro en Notion fue modificado.');
    console.log('Para persistir los valores en Notion ERP, ejecute:');
    console.log('  node scripts/enrich-insumos-costs.cjs --apply\n');
  }
}

runEnrichment().catch(err => {
  console.error('ERROR FATAL:', err);
  process.exit(1);
});
