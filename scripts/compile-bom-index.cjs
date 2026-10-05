/**
 * Sanesca PRO — Compilador del Índice de Recetas BOM Optimizado
 * Script: scripts/compile-bom-index.cjs
 * 
 * Lee el catálogo maestro (1.68 MB) y genera un diccionario normalizado
 * ultraligero (~250 KB sin indentar / ~35 KB gzip) estructurado para
 * evaluación instantánea en memoria sin redundancia de datos.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const CATALOG_PATH = path.resolve(ROOT_DIR, '../../data/CATALOGO_PRODUCTOS_MASTER.json');
const MAP_PATH = path.resolve(ROOT_DIR, '../../data/catalogo_insumos_notion_map.json');
const INVENTORY_PATH = path.resolve(ROOT_DIR, 'data/inventory.json');
const OUTPUT_SRC = path.resolve(ROOT_DIR, 'src/data/bom_index_optimized.json');
const OUTPUT_DATA = path.resolve(ROOT_DIR, 'data/bom_index_optimized.json');
const OUTPUT_FUNCTIONS = path.resolve(ROOT_DIR, 'functions/api/bom/bom_index_optimized.json');

console.log('--- Iniciando Compilación de Índice BOM Optimizado (Formato Normalizado) ---');

// 1. Cargar fuentes
if (!fs.existsSync(CATALOG_PATH)) {
  console.error(`Error: No existe el catálogo maestro en ${CATALOG_PATH}`);
  process.exit(1);
}

const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
const notionMap = fs.existsSync(MAP_PATH) ? JSON.parse(fs.readFileSync(MAP_PATH, 'utf8')) : [];
const invData = fs.existsSync(INVENTORY_PATH) ? JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8')) : [];
const invItems = Array.isArray(invData) ? invData : (invData.items || invData.data || []);

// 2. Diccionario Maestro de Insumos (Solo 1 entrada por material M*)
const insumosDict = {};
for (const n of notionMap) {
  if (!n.codigoValery) continue;
  const vCode = n.codigoValery.trim().toUpperCase();
  const iCode = (n.codigoInterno || '').trim().toUpperCase();
  const invMatch = invItems.find(it => (it.codigo || '').trim().toUpperCase() === iCode);

  insumosDict[vCode] = {
    v: vCode,
    c: iCode,
    dId: invMatch ? invMatch.id : null,
    n: invMatch ? invMatch.nombre : (n.nombre || vCode),
    u: invMatch ? (invMatch.unidad || 'Und') : (n.unidad || 'Und'),
    costo: n.costoUSD || (invMatch ? invMatch.costoReposicionUSD || 0 : 0)
  };
}

// 3. Diccionario Normalizado de Recetas
// Cada producto contiene: { n: "Nombre", m: [ [ "M66", 2.6 ], [ "M23", 0.002 ] ] }
const bomIndex = {
  _meta: {
    generado: new Date().toISOString(),
    version: '1.2.0',
    descripcion: 'Índice BOM Normalizado Sanesca PRO'
  },
  insumos: insumosDict,
  recetas: {}
};

let totalConBOM = 0;
let totalLineas = 0;

for (const [prodCode, p] of Object.entries(catalog.productos || {})) {
  if (!p.desglose_partes || p.desglose_partes.length === 0) continue;

  const codeUpper = prodCode.trim().toUpperCase();
  const componentes = [];

  for (const part of p.desglose_partes) {
    const rawParte = (part.parte || '').trim().toUpperCase();
    if (!rawParte.startsWith('M')) continue; // Solo insumos tangibles

    const cant = Number(part.cantidad) || 0;
    if (cant <= 0) continue;

    // Asegurar que el insumo exista en el diccionario
    if (!insumosDict[rawParte]) {
      insumosDict[rawParte] = {
        v: rawParte,
        c: rawParte,
        dId: null,
        n: rawParte,
        u: 'Und',
        costo: 0
      };
    }

    componentes.push([rawParte, Number(cant.toFixed(4))]);
    totalLineas++;
  }

  if (componentes.length > 0) {
    bomIndex.recetas[codeUpper] = {
      n: p.descripcion || codeUpper,
      cat: p.categoria || 'Mobiliario',
      m: componentes
    };
    totalConBOM++;
  }
}

// 4. Guardar archivo optimizado minificado
const outputMin = JSON.stringify(bomIndex);
const srcDir = path.dirname(OUTPUT_SRC);
if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir, { recursive: true });

const fnDir = path.dirname(OUTPUT_FUNCTIONS);
if (!fs.existsSync(fnDir)) fs.mkdirSync(fnDir, { recursive: true });

fs.writeFileSync(OUTPUT_SRC, outputMin, 'utf8');
fs.writeFileSync(OUTPUT_DATA, outputMin, 'utf8');
fs.writeFileSync(OUTPUT_FUNCTIONS, outputMin, 'utf8');

const stats = fs.statSync(OUTPUT_SRC);
const sizeKB = (stats.size / 1024).toFixed(1);

console.log('----------------------------------------------------');
console.log(`✅ Compilación Normalizada Exitosa.`);
console.log(`- Muebles con receta BOM: ${totalConBOM}`);
console.log(`- Diccionario de insumos únicos: ${Object.keys(insumosDict).length}`);
console.log(`- Relaciones de despiece indexadas: ${totalLineas}`);
console.log(`- Archivo generado: ${OUTPUT_SRC}`);
console.log(`- Tamaño final: ${sizeKB} KB (Reducción a ${sizeKB} KB desde 1,642 KB)`);
console.log('----------------------------------------------------');
