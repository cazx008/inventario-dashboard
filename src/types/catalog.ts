export interface ConceptRoot {
  id: string;
  name: string;
  codePrefix: string;
  defaultUoM: string;
  namingPattern: string;
  requiredModifiers: string[];
}

export interface CatalogItem {
  id: string;
  insumoId: string;
  dashboardId?: string | null;
  nombre: string;
  codigo: string;
  codigoValery?: string;
  marca?: string;
  categoria: string;
  rolMaterial?: string;
  conceptoId?: string | null;
  conceptoNombre?: string;
  unidad: string;
  unidadNotion?: string;
  costoUnitarioUSD: number;
  largo?: number | null;
  ancho?: number | null;
  espesor?: number | null;
  dimensiones?: string;
  color?: string;
  ubicacion?: string;
  stockBase: number;
  stockMinimo: number;
  estadoStock: string;
  contando: boolean;
  activo: boolean;
  isDescontinuado?: boolean;
  isHuerfano?: boolean;
  hasKardexMovements?: boolean;
}

export interface CatalogUpsertPayload {
  action: 'create' | 'update';
  insumoId?: string;
  dashboardId?: string;
  nombre: string;
  codigo: string;
  codigoValery?: string;
  marca?: string;
  categoria?: string;
  rolMaterial?: string;
  conceptoId?: string;
  unidad: string;
  costoUnitarioUSD?: number;
  largo?: number;
  ancho?: number;
  espesor?: number;
  color?: string;
  ubicacion?: string;
  stockMinimo?: number;
  activo?: boolean;
  supervisorPIN?: string;
}

export interface CatalogAuditIssue {
  id: string;
  insumoId: string;
  nombre: string;
  codigo: string;
  categoria: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  tipo: 'HUERFANO' | 'COSTO_CERO' | 'CODIGO_VACIO' | 'CODIGO_DUPLICADO' | 'SIN_CONCEPTO';
  mensaje: string;
  actionable: boolean;
  actionType: string;
}

export interface CatalogAuditReport {
  ok: boolean;
  score: number;
  healthStatus: 'EXCELENTE' | 'BUENO' | 'ATENCION' | 'CRITICO';
  kpis: {
    totalCatalogItems: number;
    totalStockRecords: number;
    countOrphans: number;
    countZeroCost: number;
    countDuplicateCode: number;
    countMissingCode: number;
    countMissingConcept: number;
    totalIssues: number;
  };
  issues: CatalogAuditIssue[];
  zeroCostCandidates: Array<{
    id: string;
    nombre: string;
    codigo: string;
    categoria: string;
    uom: string;
  }>;
  orphanCandidates: Array<{
    id: string;
    nombre: string;
    codigo: string;
    categoria: string;
  }>;
  updatedAt: number;
  source?: string;
}
