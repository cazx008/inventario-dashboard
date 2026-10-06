/**
 * Servicio de Persistencia Local Offline en IndexedDB
 * Sanesca PRO — Inventario Industrial
 * 
 * Almacena en el navegador los conteos físicos y ajustes de almacén realizados
 * cuando el operario se encuentra en zonas sin cobertura WiFi o sufre cortes de red.
 */

export interface OfflineAdjustmentRecord {
  localId: string;
  timestamp: number;
  dashboardItemId: string;
  insumoId?: string;
  itemNombre: string;
  unidad: string;
  conteoFisicoReal: number;
  stockSistemaAlCapturar: number;
  costoReferencialUSD?: number;
  motivo: string;
  justificacion: string;
  supervisorPin?: string;
  deltaOriginal: number;
  synced: boolean;
  syncAttempts: number;
  lastError?: string;
}

const DB_NAME = 'sanesca_offline_db';
const DB_VERSION = 1;
const STORE_NAME = 'pending_adjustments';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB no está soportado en este entorno.'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'localId' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('synced', 'synced', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Guarda un ajuste de conteo físico en la cola local IndexedDB
 */
export async function saveOfflineAdjustment(
  adjustment: Omit<OfflineAdjustmentRecord, 'localId' | 'timestamp' | 'synced' | 'syncAttempts'>
): Promise<OfflineAdjustmentRecord> {
  const db = await openDatabase();
  const fullRecord: OfflineAdjustmentRecord = {
    ...adjustment,
    localId: `OFFLINE-ADJ-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
    timestamp: Date.now(),
    synced: false,
    syncAttempts: 0,
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(fullRecord);

    req.onsuccess = () => resolve(fullRecord);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Obtiene todos los ajustes pendientes de sincronización
 */
export async function getPendingAdjustments(): Promise<OfflineAdjustmentRecord[]> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => {
        const results = (req.result as OfflineAdjustmentRecord[]) || [];
        resolve(results.sort((a, b) => a.timestamp - b.timestamp));
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Error leyendo cola IndexedDB:', err);
    return [];
  }
}

/**
 * Elimina un ajuste de la cola local tras una sincronización exitosa
 */
export async function removeOfflineAdjustment(localId: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(localId);

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Registra un error o incremento de intento en un ajuste que falló al sincronizar
 */
export async function updateAdjustmentSyncAttempt(localId: string, errorMsg: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(localId);

    getReq.onsuccess = () => {
      const record = getReq.result as OfflineAdjustmentRecord | undefined;
      if (!record) {
        resolve();
        return;
      }
      record.syncAttempts = (record.syncAttempts || 0) + 1;
      record.lastError = errorMsg;
      const putReq = store.put(record);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/**
 * Retorna la cantidad de ajustes pendientes en la cola local
 */
export async function getPendingAdjustmentsCount(): Promise<number> {
  try {
    const list = await getPendingAdjustments();
    return list.length;
  } catch {
    return 0;
  }
}
