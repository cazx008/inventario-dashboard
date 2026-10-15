/**
 * reconcile-her006.js — Script de Saneamiento Quirúrgico Inicial (PLAN-013 / Fase 2)
 * 
 * 1. Enlaza formalmente la propiedad 'Producto' en BD_Control_Stock_Existencias para
 *    'Tirador para Embutir de Acero Inoxidable 115mm' (HER-006) preservando sus 187 unidades.
 * 2. Identifica y archiva páginas residuales espurias ('Insumo Sin Nombre' / 'SIN CÓDIGO').
 * 3. Emite reporte de auditoría inmutable.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveNotionToken() {
  if (process.env.SANESCATOKEN) return process.env.SANESCATOKEN;
  if (process.env.NOTION_TOKEN) return process.env.NOTION_TOKEN;
  if (process.env.NOTION_API_KEY) return process.env.NOTION_API_KEY;

  const candidateEnvPaths = [
    path.join(__dirname, '..', '.env'),
    path.join(__dirname, '..', '..', '..', 'apps', 'despacho', '.env'),
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
if (!NOTION_TOKEN) {
  console.error('❌ ERROR: No se encontró token de Notion en las rutas candidatas.');
  process.exit(1);
}

const CATALOGO_INSUMOS_DB_ID = '26286805-4e27-8067-8847-d39de1bf0bde';
const CONTROL_STOCK_DB_ID = '2b586805-4e27-80fe-b6e8-e4c6dc325696';

const NOTION_HEADERS = {
  'Authorization': `Bearer ${NOTION_TOKEN}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
};

function extractPlainText(prop) {
  if (!prop) return '';
  if (prop.title) return prop.title.map(t => t.plain_text).join('').trim();
  if (prop.rich_text) return prop.rich_text.map(t => t.plain_text).join('').trim();
  if (prop.select) return prop.select.name?.trim() || '';
  if (typeof prop.number === 'number') return String(prop.number);
  return '';
}

async function fetchAllPages(dbId) {
  const pages = [];
  let cursor = undefined;
  while (true) {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: NOTION_HEADERS,
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Error Notion DB ${dbId}: ${res.status} ${txt}`);
    }
    const data = await res.json();
    pages.push(...(data.results || []));
    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }
  return pages;
}

async function runReconciliation() {
  console.log('🚀 Iniciando script de saneamiento quirúrgico PLAN-013...');

  // 1. Consultar ambas bases de datos
  console.log('📦 Consultando BD_Catalogo_Insumos...');
  const catalogPages = await fetchAllPages(CATALOGO_INSUMOS_DB_ID);
  console.log(`   Total insumos en Catálogo: ${catalogPages.length}`);

  console.log('🏢 Consultando BD_Control_Stock_Existencias...');
  const stockPages = await fetchAllPages(CONTROL_STOCK_DB_ID);
  console.log(`   Total fichas en Control Stock: ${stockPages.length}`);

  // 2. Localizar HER-006 en Catálogo
  let her006Catalog = null;
  for (const page of catalogPages) {
    const p = page.properties;
    const cod = extractPlainText(p['Codigo'] || p['Código']).toUpperCase().trim();
    const nom = extractPlainText(p['Concepto'] || p['Nombre del producto'] || p['Nombre']).toLowerCase().trim();
    if (cod === 'HER-006' || nom.includes('tirador para embutir de acero inoxidable 115mm') || nom.includes('tirador para embutir 115')) {
      her006Catalog = {
        id: page.id,
        codigo: cod,
        concepto: extractPlainText(p['Concepto'] || p['Nombre del producto'] || p['Nombre'])
      };
      break;
    }
  }

  if (!her006Catalog) {
    console.error('❌ No se encontró HER-006 en BD_Catalogo_Insumos.');
  } else {
    console.log(`✅ Localizado en Catálogo: [${her006Catalog.codigo}] "${her006Catalog.concepto}" (ID: ${her006Catalog.id})`);
  }

  // 3. Localizar ficha en Control de Stock
  let her006Stock = null;
  const corruptedPages = [];

  for (const page of stockPages) {
    const p = page.properties;
    const nom = extractPlainText(p['Nombre'] || p['Insumo']);
    const nomLower = nom.toLowerCase().trim();

    if (nomLower.includes('tirador para embutir de acero inoxidable 115mm') || nomLower.includes('tirador para embutir 115')) {
      her006Stock = {
        id: page.id,
        nombre: nom,
        stockBase: p['Stock (base)']?.number ?? 0,
        currentRelation: p['Producto']?.relation || []
      };
    }

    if (nomLower === 'insumo sin nombre' || nomLower === 'sin nombre' || nomLower === 'sin código') {
      corruptedPages.push({
        id: page.id,
        nombre: nom
      });
    }
  }

  // 4. Enlazar HER-006
  let her006Linked = false;
  if (her006Catalog && her006Stock) {
    console.log(`🔍 Ficha física de stock encontrada: "${her006Stock.nombre}" con Stock base: ${her006Stock.stockBase}`);
    const relId = her006Stock.currentRelation[0]?.id;
    if (relId === her006Catalog.id) {
      console.log('ℹ️ La relación Producto ya estaba vinculada a HER-006.');
      her006Linked = true;
    } else {
      console.log(`🔗 Vinculando relación Producto hacia ${her006Catalog.id}...`);
      const patchRes = await fetch(`https://api.notion.com/v1/pages/${her006Stock.id}`, {
        method: 'PATCH',
        headers: NOTION_HEADERS,
        body: JSON.stringify({
          properties: {
            'Producto': {
              relation: [{ id: her006Catalog.id }]
            }
          }
        })
      });
      if (patchRes.ok) {
        console.log(`✅ ¡Relación vinculada exitosamente! ${her006Catalog.codigo} ahora está unificado con sus ${her006Stock.stockBase} unidades.`);
        her006Linked = true;
      } else {
        const errTxt = await patchRes.text();
        console.error(`❌ Error actualizando relación en Notion: ${errTxt}`);
      }
    }
  }

  // 5. Purgar páginas corruptas
  console.log(`🧹 Purgando ${corruptedPages.length} páginas corruptas ('Insumo Sin Nombre')...`);
  let purgedCount = 0;
  for (const cp of corruptedPages) {
    try {
      const archRes = await fetch(`https://api.notion.com/v1/pages/${cp.id}`, {
        method: 'PATCH',
        headers: NOTION_HEADERS,
        body: JSON.stringify({ archived: true })
      });
      if (archRes.ok) purgedCount++;
    } catch (e) {
      console.warn(`Error archivando ${cp.id}:`, e.message);
    }
  }
  console.log(`✅ Se archivaron ${purgedCount} páginas residuales en Notion.`);

  console.log('\n=============================================');
  console.log('📊 RESUMEN DE EJECUCIÓN (PLAN-013 / FASE 2)');
  console.log(`- Insumo HER-006 enlazado: ${her006Linked ? 'SÍ' : 'NO'}`);
  console.log(`- Saldo físico preservado: ${her006Stock?.stockBase ?? 0} unidades`);
  console.log(`- Páginas residuales purgadas: ${purgedCount}`);
  console.log('=============================================\n');
}

runReconciliation().catch(err => {
  console.error('Fatal error en saneamiento:', err);
  process.exit(1);
});
