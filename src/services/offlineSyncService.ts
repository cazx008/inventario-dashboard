/**
 * Motor de Sincronización Diferida (Offline Sync Service)
 * Sanesca PRO — Inventario Industrial
 * 
 * Gestiona el drenado de la cola de IndexedDB hacia la API de Notion ERP
 * al recuperar conectividad o por solicitud manual del operario.
 */

import { 
  getPendingAdjustments, 
  removeOfflineAdjustment, 
  updateAdjustmentSyncAttempt,
  getPendingAdjustmentsCount,
  OfflineAdjustmentRecord 
} from './offlineStorageService';
import { submitStockAdjustment } from './kardexService';
import { StockAdjustmentResult } from '../types/adjustment';

export interface SyncBatchResult {
  syncedCount: number;
  failedCount: number;
  totalProcessed: number;
  isOffline: boolean;
  errors: string[];
}

/**
 * Sincroniza todos los ajustes de conteo pendientes en la cola IndexedDB
 */
export async function syncPendingAdjustments(bcvRate = 36.50): Promise<SyncBatchResult> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      syncedCount: 0,
      failedCount: 0,
      totalProcessed: 0,
      isOffline: true,
      errors: ['Dispositivo sin conexión a internet.']
    };
  }

  const pending = await getPendingAdjustments();
  if (pending.length === 0) {
    return {
      syncedCount: 0,
      failedCount: 0,
      totalProcessed: 0,
      isOffline: false,
      errors: []
    };
  }

  let syncedCount = 0;
  let failedCount = 0;
  const errors: string[] = [];

  for (const item of pending) {
    try {
      await submitStockAdjustment({
        dashboardId: item.dashboardItemId,
        insumoId: item.insumoId,
        nombre: item.itemNombre,
        conteoFisico: item.conteoFisicoReal,
        stockActual: item.stockSistemaAlCapturar,
        stockTeoricoAlCapturar: item.stockSistemaAlCapturar,
        isOfflineSync: true,
        motivo: item.motivo,
        justificacion: item.justificacion,
        costoReferencialUSD: item.costoReferencialUSD,
        tasaBCV: bcvRate,
        unidad: item.unidad,
        supervisorPin: item.supervisorPin,
        idempotencyKey: item.localId,
      });

      // Si se asentó exitosamente, eliminar de IndexedDB
      await removeOfflineAdjustment(item.localId);
      syncedCount++;
    } catch (err: any) {
      console.warn(`Fallo al sincronizar ajuste offline [${item.localId}]:`, err);
      const errMsg = err?.message || 'Error de red o servidor al sincronizar';
      await updateAdjustmentSyncAttempt(item.localId, errMsg);
      failedCount++;
      errors.push(`${item.itemNombre}: ${errMsg}`);
    }
  }

  return {
    syncedCount,
    failedCount,
    totalProcessed: pending.length,
    isOffline: false,
    errors
  };
}
