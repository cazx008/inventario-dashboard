export interface InventoryItem {
  id: string;
  nombre: string;
  codigo?: string;
  marca?: string;
  stockBase: number;
  stockMinimo: number;
  deficit: number;
  estadoStock: string;
  estadoStockColor?: string;
  prioridad: string;
  prioridadColor?: string;
  categoriaMaterial?: string;
  rolMaterial?: string;
  origenConsumo?: string;
  unidad?: string;
  color?: string;
  dimensiones?: string;
  grupoProceso?: string;
  proceso?: string;
  departamento?: string;
  seReconto3D?: boolean;
  diasDesdeReconteo?: number | null;
  // Nuevas columnas para Abastecimiento / OAB
  enTransitoOAB?: number;
  stockProyectado?: number;
  costoUnitarioUSD?: number;
  insumoId?: string; // id en BD_Materiales_Insumos
  isOptimisticSync?: boolean;
  syncNote?: string;
}

export interface KpiSummary {
  total: number;
  estado: {
    sinStock: number;
    bajoMinimo: number;
    enStock: number;
    enReconteo: number;
    descontinuado: number;
  };
  prioridad: {
    urgente: number;
    alta: number;
    media: number;
    baja: number;
    porPedido: number;
  };
  auditados3D: number;
  auditados3DPct: number;
}

export interface ColumnDef {
  key: keyof InventoryItem | string;
  label: string;
  sortable: boolean;
  groupable: boolean;
  align: 'left' | 'right' | 'center';
}

export interface SortLevel {
  key: string;
  dir: 'asc' | 'desc';
}

export interface FilterRule {
  property: string;
  operator: string;
  value: string;
}
