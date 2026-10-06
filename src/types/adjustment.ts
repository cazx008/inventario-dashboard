/**
 * Tipos y Contratos para Conteo Cíclico y Ajustes de Kardex (Fase 9F)
 * Archivo: src/types/adjustment.ts
 */

export const STOCK_ADJUSTMENT_REASONS = [
  'Diferencia de Conteo Cíclico',
  'Merma por Rotura / Daño Físico',
  'Material Oxidado / Deformado / Vencido',
  'Sobrante No Registrado / Retazo Reincorporado',
  'Corrección por Conteo Previo Erróneo',
] as const;

export type StockAdjustmentReason = typeof STOCK_ADJUSTMENT_REASONS[number];

export interface StockAdjustmentPayload {
  dashboardId: string;
  insumoId?: string;
  nombre: string;
  conteoFisico: number;
  stockActual: number;
  motivo: StockAdjustmentReason | string;
  justificacion: string;
  costoUnitarioUSD?: number;
  costoReferencialUSD?: number;
  tasaBCV?: number;
  unidad?: string;
  supervisorPin?: string;
  idempotencyKey?: string;
  stockTeoricoAlCapturar?: number;
  isOfflineSync?: boolean;
}

export interface StockAdjustmentResult {
  status: 'success' | 'error' | 'already_processed';
  message: string;
  folio?: string;
  kardexId?: string;
  previousStock?: number;
  newStock?: number;
  delta?: number;
  impactoUSD?: number;
  impactoBs?: number;
  nuevoEstadoStock?: string;
  requiresSupervisorPin?: boolean;
  timestamp?: string;
  error?: string;
}
