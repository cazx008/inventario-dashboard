import { RegisterReceptionPayload, registerReception, uploadEvidenceToR2 } from './oabService';

const DB_NAME = 'sanesca_inventario_rampa_db';
const DB_VERSION = 2;
const STORE_QUEUE = 'reception_queue';
const STORE_PHOTO_QUEUE = 'photo_retry_queue';

export interface PendingPhotoItem {
  id?: number;
  folioOAB: string;
  numeroNotaEntrega: string;
  imageBase64: string;
  queuedAt: string;
  attempts: number;
  lastError?: string;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        db.createObjectStore(STORE_QUEUE, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORE_PHOTO_QUEUE)) {
        db.createObjectStore(STORE_PHOTO_QUEUE, { keyPath: 'id', autoIncrement: true });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Reintento con backoff exponencial y jitter (1s, 2s, 4s, 8s ± 200ms)
 * para mitigar caídas transitorias de red o microcortes hacia Cloudflare R2.
 */
export async function uploadEvidenceWithBackoff(
  folioOAB: string,
  numeroNotaEntrega: string,
  base64: string,
  maxAttempts = 4
): Promise<string> {
  const delays = [1000, 2000, 4000, 8000];
  let lastError: any = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await uploadEvidenceToR2(folioOAB, numeroNotaEntrega, base64);
    } catch (err: any) {
      lastError = err;
      if (attempt < maxAttempts - 1) {
        const jitter = Math.floor(Math.random() * 400) - 200; // ±200ms
        const delay = Math.max(500, delays[attempt] + jitter);
        console.warn(`[R2-Backoff] Intento ${attempt + 1}/${maxAttempts} para ${folioOAB}. Reintentando en ${delay}ms...`, err);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw lastError || new Error(`Agotados los ${maxAttempts} intentos de subida a R2`);
}

/**
 * Encolar foto fallida para reintento en segundo plano sin frenar la rampa ni bloquear el camión.
 */
export async function queuePhotoForRetry(item: Omit<PendingPhotoItem, 'id' | 'queuedAt'>): Promise<number> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PHOTO_QUEUE, 'readwrite');
    const store = tx.objectStore(STORE_PHOTO_QUEUE);
    const photoToStore: PendingPhotoItem = {
      ...item,
      queuedAt: new Date().toISOString()
    };
    const req = store.add(photoToStore);
    tx.oncomplete = () => {
      notifyQueueChange();
      resolve(Number(req.result));
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPendingPhotosCount(): Promise<number> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PHOTO_QUEUE, 'readonly');
      const store = tx.objectStore(STORE_PHOTO_QUEUE);
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return 0;
  }
}

export async function getPendingPhotos(): Promise<PendingPhotoItem[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PHOTO_QUEUE, 'readonly');
    const store = tx.objectStore(STORE_PHOTO_QUEUE);
    const request = store.openCursor();
    const items: PendingPhotoItem[] = [];

    request.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest).result as IDBCursorWithValue;
      if (cursor) {
        items.push({ id: Number(cursor.key), ...cursor.value });
        cursor.continue();
      } else {
        resolve(items);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deletePendingPhoto(id: number): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PHOTO_QUEUE, 'readwrite');
    const store = tx.objectStore(STORE_PHOTO_QUEUE);
    store.delete(id);
    tx.oncomplete = () => {
      notifyQueueChange();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Reintento diferido de fotos fallidas en segundo plano
 */
export async function syncPendingPhotos(): Promise<{ synced: number; remaining: number }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const count = await getPendingPhotosCount();
    return { synced: 0, remaining: count };
  }

  const photos = await getPendingPhotos();
  let synced = 0;

  for (const photo of photos) {
    try {
      await uploadEvidenceWithBackoff(photo.folioOAB, photo.numeroNotaEntrega, photo.imageBase64, 2);
      if (photo.id) {
        await deletePendingPhoto(photo.id);
        synced++;
      }
    } catch (err) {
      console.warn(`[photoRetrySync] Reintento diferido falló para foto de ${photo.folioOAB}:`, err);
      break; // No spamear R2 si persiste la indisponibilidad
    }
  }

  const remaining = await getPendingPhotosCount();
  notifyQueueChange();
  return { synced, remaining };
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
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_QUEUE, 'readonly');
      const store = tx.objectStore(STORE_QUEUE);
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return 0;
  }
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
 * Resiliente a caídas de R2: no detiene la recepción física del camión.
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

      // Subida resiliente a Cloudflare R2 con backoff exponencial
      if (payload.comprobanteFile && !payload.comprobanteUrl) {
        try {
          const r2Url = await uploadEvidenceWithBackoff(
            payload.folioOAB,
            payload.numeroNotaEntrega,
            payload.comprobanteFile,
            4
          );
          payload.comprobanteUrl = r2Url;
          delete payload.comprobanteFile; // Purgar binario pesado de memoria RAM
        } catch (uploadErr) {
          console.warn(`[rampaOfflineSync] R2 inalcanzable tras backoff para ${payload.folioOAB}. Registrando recepción sin foto y encolando para reintento diferido:`, uploadErr);
          // Encolar foto para subida diferida
          await queuePhotoForRetry({
            folioOAB: payload.folioOAB,
            numeroNotaEntrega: payload.numeroNotaEntrega,
            imageBase64: payload.comprobanteFile!,
            attempts: 4,
            lastError: String(uploadErr)
          });
          payload.fotoPendienteSync = true;
          delete payload.comprobanteFile;
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

export function notifyQueueChange() {
  if (typeof window === 'undefined') return;
  Promise.all([getPendingReceptionCount(), getPendingPhotosCount()]).then(([receptionCount, photoCount]) => {
    window.dispatchEvent(new CustomEvent('rampa-sync-updated', { 
      detail: { 
        count: receptionCount,
        photoCount 
      } 
    }));
  }).catch(console.error);
}

// Iniciar listener de reconexión automática en el navegador
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('[rampaOfflineSync] Conexión online detectada. Drenando cola de recepciones y fotos diferidas...');
    syncPendingReceptions().catch(console.error);
    syncPendingPhotos().catch(console.error);
  });
}
