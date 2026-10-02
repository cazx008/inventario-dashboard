import { RegisterReceptionPayload, registerReception, uploadEvidenceToR2 } from './oabService';

const DB_NAME = 'sanesca_inventario_rampa_db';
const DB_VERSION = 1;
const STORE_QUEUE = 'reception_queue';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        db.createObjectStore(STORE_QUEUE, { keyPath: 'id', autoIncrement: true });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function queueOfflineReception(payload: RegisterReceptionPayload): Promise<number> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, 'readwrite');
    const store = tx.objectStore(STORE_QUEUE);
    const itemToStore = {
      ...payload,
      queuedAt: new Date().toISOString()
    };
    const req = store.add(itemToStore);
    tx.oncomplete = () => {
      notifyQueueChange();
      resolve(Number(req.result));
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPendingReceptions(): Promise<{ key: number; data: RegisterReceptionPayload & { queuedAt: string } }[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, 'readonly');
    const store = tx.objectStore(STORE_QUEUE);
    const request = store.openCursor();
    const items: { key: number; data: any }[] = [];

    request.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest).result as IDBCursorWithValue;
      if (cursor) {
        items.push({ key: Number(cursor.key), data: cursor.value });
        cursor.continue();
      } else {
        resolve(items);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getPendingReceptionCount(): Promise<number> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, 'readonly');
    const store = tx.objectStore(STORE_QUEUE);
    const request = store.count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function deletePendingReception(key: number): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, 'readwrite');
    const store = tx.objectStore(STORE_QUEUE);
    store.delete(key);
    tx.oncomplete = () => {
      notifyQueueChange();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Sync Daemon que drena la cola de recepciones pendientes de rampa hacia Notion ERP.
 * Protegido por la doble barrera de idempotencia en /api/oab/receive.
 */
export async function syncPendingReceptions(): Promise<{ synced: number; remaining: number }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const count = await getPendingReceptionCount();
    return { synced: 0, remaining: count };
  }

  const items = await getPendingReceptions();
  let synced = 0;

  for (const item of items) {
    try {
      const payload: RegisterReceptionPayload = { ...item.data };

      // Subida previa a Cloudflare R2 si hay evidencia fotográfica offline
      if (payload.comprobanteFile && !payload.comprobanteUrl) {
        try {
          const r2Url = await uploadEvidenceToR2(
            payload.folioOAB,
            payload.numeroNotaEntrega,
            payload.comprobanteFile
          );
          payload.comprobanteUrl = r2Url;
          delete payload.comprobanteFile; // Purgar binario pesado de memoria RAM
        } catch (uploadErr) {
          console.warn(`[rampaOfflineSync] Reintento aplazado: Fallo al subir evidencia a R2 para ${payload.folioOAB}:`, uploadErr);
          break; // Detener drenado para evitar desincronización de fotos
        }
      }

      const result = await registerReception(payload);
      if (result && (result.status === 'success' || result.status === 'already_processed')) {
        await deletePendingReception(item.key); // Purga atómica inmediata de IndexedDB
        synced++;
      } else {
        console.warn(`[rampaOfflineSync] Respuesta inesperada para item ${item.key}:`, result);
        break;
      }
    } catch (e) {
      console.error(`[rampaOfflineSync] Error sincronizando recepción ${item.key}:`, e);
      break;
    }
  }

  const remaining = await getPendingReceptionCount();
  notifyQueueChange();
  return { synced, remaining };
}

function notifyQueueChange() {
  if (typeof window === 'undefined') return;
  getPendingReceptionCount().then((count) => {
    window.dispatchEvent(new CustomEvent('rampa-sync-updated', { detail: { count } }));
  }).catch(console.error);
}

// Iniciar listener de reconexión automática en el navegador
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('[rampaOfflineSync] Conexión online detectada. Drenando cola de recepciones...');
    syncPendingReceptions().catch(console.error);
  });
}
