/**
 * Normalizador Canónico Bidireccional de Unidades de Medida (UoM)
 * Archivo: functions/api/catalog/_uomMap.js
 * 
 * Estandariza la conversión entre:
 * 1. Opciones ontológicas en BD_Diccionario_Conceptos / Notion ('Unidad', 'Metro Lineal', etc.)
 * 2. Siglas compactas industriales utilizadas en la interfaz ('UND', 'ML', 'PLANCHA', etc.)
 */

export const NOTION_TO_DISPLAY_UOM = {
  'Unidad': 'UND',
  'Metro Lineal': 'ML',
  'Litro': 'L',
  'Lámina': 'PLANCHA',
  'Kilogramo': 'KG',
  'Par': 'PAR',
  'Caja': 'CJ',
  'Paquete': 'PAQ',
  // Variantes históricas / defensivas
  'Und': 'UND',
  'und': 'UND',
  'Metro': 'ML',
  'metro': 'ML',
  'ml': 'ML',
  'M2': 'M2',
  'Metro Cuadrado': 'M2',
  'Kg': 'KG',
  'kg': 'KG',
  'Kilo': 'KG',
  'L': 'L',
  'Galon': 'GAL',
  'Galón': 'GAL',
  'Cunete': 'CUNETE',
  'Cuñete': 'CUNETE'
};

export const DISPLAY_TO_NOTION_UOM = {
  'UND': 'Unidad',
  'ML': 'Metro Lineal',
  'L': 'Litro',
  'PLANCHA': 'Lámina',
  'KG': 'Kilogramo',
  'PAR': 'Par',
  'CJ': 'Caja',
  'PAQ': 'Paquete',
  'M2': 'Metro Cuadrado',
  'GAL': 'Galón',
  'CUNETE': 'Cuñete'
};

export const SUPPORTED_UOMS = [
  { code: 'UND', notionName: 'Unidad', label: 'Unidad (UND)' },
  { code: 'ML', notionName: 'Metro Lineal', label: 'Metro Lineal (ML)' },
  { code: 'PLANCHA', notionName: 'Lámina', label: 'Lámina / Plancha (PLANCHA)' },
  { code: 'L', notionName: 'Litro', label: 'Litro (L)' },
  { code: 'KG', notionName: 'Kilogramo', label: 'Kilogramo (KG)' },
  { code: 'PAR', notionName: 'Par', label: 'Par (PAR)' },
  { code: 'CJ', notionName: 'Caja', label: 'Caja (CJ)' },
  { code: 'PAQ', notionName: 'Paquete', label: 'Paquete (PAQ)' },
  { code: 'M2', notionName: 'Metro Cuadrado', label: 'Metro Cuadrado (M2)' },
  { code: 'GAL', notionName: 'Galón', label: 'Galón (GAL)' }
];

/**
 * Convierte un valor de UoM de Notion al código compacto industrial.
 * @param {string|null|undefined} notionValue
 * @returns {string}
 */
export function toDisplayUoM(notionValue) {
  if (!notionValue || typeof notionValue !== 'string') return 'UND';
  const trimmed = notionValue.trim();
  return NOTION_TO_DISPLAY_UOM[trimmed] || trimmed.toUpperCase();
}

/**
 * Convierte un código compacto industrial al nombre formal de Notion.
 * @param {string|null|undefined} displayCode
 * @returns {string}
 */
export function toNotionUoM(displayCode) {
  if (!displayCode || typeof displayCode !== 'string') return 'Unidad';
  const upper = displayCode.trim().toUpperCase();
  return DISPLAY_TO_NOTION_UOM[upper] || displayCode.trim();
}
