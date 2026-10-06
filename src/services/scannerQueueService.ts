/**
 * Servicio de Cola Secuencial de Escaneo en Ráfaga y Buffer FIFO Anti-Rate Limit
 * Archivo: src/services/scannerQueueService.ts
 * Sanesca PRO — Inventario Industrial
 * 
 * Gestiona el amortiguamiento de escaneos rápidos ('Zero-Mouse'), bifurcación de
 * discrepancias críticas hacia firma de supervisor y drenaje secuencial a 500ms (Notion API).
 */

import { submitStockAdjustment } from './kardexService';
import { StockAdjustmentResult } from '../types/adjustment';
import { playScanBeep, playSuccessChime, playWarningTone, playErrorTone } from './audioFeedback';

export interface ScannerQueueItem {
  id: string;
  timestamp: number;
  dashboardId: string;
  insumoId?: string;
  nombre: string;
  unidad: string;
  conteoFisico: number;
  stockActual: number;
  costoUnitarioUSD: number;
  tasaBCV: number;
  delta: number;
  impactoUSD: number;
  motivo: string;
  justificacion: string;
  supervisorPin?: string;
  status: 'ENCOLADO' | 'PROCESANDO' | 'PENDIENTE_FIRMA' | 'COMPLETADO' | 'ERROR';
  errorMessage?: string;
  retryCount: number;
}

export interface EnqueueParams {
  dashboardId: string;
  insumoId?: string;
  nombre: string;
  unidad?: string;
  conteoFisico: number;
  stockActual: number;
  costoUnitarioUSD?: number;
  tasaBCV?: number;
  motivo?: string;
  justificacion?: string;
  supervisorPin?: string;
}

export const CRITICAL_DELTA_THRESHOLD = 5;
export const CRITICAL_IMPACT_THRESHOLD_USD = 5.0;
const DRAIN_INTERVAL_MS = 500; // Cadencia calibrada: 2 req/s (~65% cuota Notion)
const DB_NAME = 'sanesca_scanner_queue_db';
const DB_VERSION = 1;
const STORE_NAME = 'scanner_items';

type QueueListener = (items: ScannerQueueItem[]) => void;
type ProcessedListener = (result: StockAdjustmentResult, item: ScannerQueueItem) => void;

let memoryQueue: ScannerQueueItem[] = [];
let isDraining = false;
let isPausedForBackoff = false;
const queueListeners: Set<QueueListener> = new Set();
const processedListeners: Set<ProcessedListener> = new Set();

// Apertura IndexedDB
function openQueueDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB no disponible'));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Persistir estado completo a IndexedDB
async function persistQueueToDB(items: ScannerQueueItem[]): Promise<void> {
  try {
    const db = await openQueueDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    for (const item of items) {
      store.put(item);
    }
  } catch (e) {
    // Fallback a localStorage si falla IndexedDB
    try {
      localStorage.setItem('sanesca_scanner_queue_backup', JSON.stringify(items));
    } catch {}
  }
}

// Cargar estado inicial desde IndexedDB
export async function initScannerQueue(): Promise<ScannerQueueItem[]> {
  try {
    const db = await openQueueDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const items = (req.result as ScannerQueueItem[]) || [];
        memoryQueue = items.sort((a, b) => a.timestamp - b.timestamp);
        notifyQueueListeners();
        // Si hay items encolados pendientes al iniciar, reactivar bucle
        if (memoryQueue.some(i => i.status === 'ENCOLADO')) {
          triggerDrainLoop();
        }
        resolve(memoryQueue);
      };
      req.onerror = () => {
        resolve(loadFromLocalStorage());
      };
    });
  } catch (e) {
    return loadFromLocalStorage();
  }
}

function loadFromLocalStorage(): ScannerQueueItem[] {
  try {
    const raw = localStorage.getItem('sanesca_scanner_queue_backup');
    if (raw) {
      memoryQueue = JSON.parse(raw);
      notifyQueueListeners();
    }
  } catch {}
  return memoryQueue;
}

function notifyQueueListeners() {
  const snapshot = [...memoryQueue];
  for (const listener of queueListeners) {
    try {
      listener(snapshot);
    } catch (e) {
      console.warn('Error en queue listener:', e);
    }
  }
}

function notifyItemProcessed(result: StockAdjustmentResult, item: ScannerQueueItem) {
  for (const listener of processedListeners) {
    try {
      listener(result, item);
    } catch (e) {
      console.warn('Error en processed listener:', e);
    }
  }
}

export function subscribeQueue(listener: QueueListener): () => void {
  queueListeners.add(listener);
  listener([...memoryQueue]);
  return () => {
    queueListeners.delete(listener);
  };
}

export function subscribeItemProcessed(listener: ProcessedListener): () => void {
  processedListeners.add(listener);
  return () => {
    processedListeners.delete(listener);
  };
}

export function getQueueSnapshot(): ScannerQueueItem[] {
  return [...memoryQueue];
}

/**
 * Encola un conteo físico capturado por la pistola de código de barras
 */
export async function enqueueScannedItem(params: EnqueueParams): Promise<ScannerQueueItem> {
  const delta = params.conteoFisico - params.stockActual;
  const costoUnitario = params.costoUnitarioUSD || 0;
  const impactoUSD = delta * costoUnitario;
  const tasaBCV = params.tasaBCV || 36.50;

  // Verificación de umbral de riesgo para desvío a supervisor
  const isCritical = (Math.abs(delta) > CRITICAL_DELTA_THRESHOLD) || (Math.abs(impactoUSD) > CRITICAL_IMPACT_THRESHOLD_USD);
  const requiresSignature = isCritical && !params.supervisorPin;

  const newItem: ScannerQueueItem = {
    id: `SCAN-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
    timestamp: Date.now(),
    dashboardId: params.dashboardId,
    insumoId: params.insumoId,
    nombre: params.nombre,
    unidad: params.unidad || 'UND',
    conteoFisico: params.conteoFisico,
    stockActual: params.stockActual,
    costoUnitarioUSD: costoUnitario,
    tasaBCV,
    delta,
    impactoUSD,
    motivo: params.motivo || 'Diferencia de Conteo Cíclico',
    justificacion: params.justificacion || 'Ajuste capturado vía Pistola Zero-Mouse',
    supervisorPin: params.supervisorPin,
    status: requiresSignature ? 'PENDIENTE_FIRMA' : 'ENCOLADO',
    retryCount: 0,
  };

  // Sonido de feedback correspondiente
  if (requiresSignature) {
    playWarningTone();
  } else {
    playScanBeep();
  }

  memoryQueue.push(newItem);
  notifyQueueListeners();
  await persistQueueToDB(memoryQueue);

  if (!requiresSignature) {
    triggerDrainLoop();
  }

  return newItem;
}

/**
 * Autoriza en lote un grupo de discrepancias críticas pendientes de firma
 */
export async function approveSupervisorBatch(
  pin: string,
  justificacion: string,
  itemIds?: string[]
): Promise<number> {
  let count = 0;
  memoryQueue = memoryQueue.map(item => {
    if (item.status === 'PENDIENTE_FIRMA' && (!itemIds || itemIds.includes(item.id))) {
      count++;
      return {
        ...item,
        supervisorPin: pin,
        justificacion: justificacion.trim() || item.justificacion,
        status: 'ENCOLADO' as const,
        errorMessage: undefined,
      };
    }
    return item;
  });

  if (count > 0) {
    playScanBeep();
    notifyQueueListeners();
    await persistQueueToDB(memoryQueue);
    triggerDrainLoop();
  }

  return count;
}

/**
 * Descarta un ítem de la cola (por ejemplo un escaneo erróneo en la bandeja de pendientes)
 */
export async function removeQueueItem(id: string): Promise<void> {
  memoryQueue = memoryQueue.filter(i => i.id !== id);
  notifyQueueListeners();
  await persistQueueToDB(memoryQueue);
}

/**
 * Despachador asíncrono con cadencia fija y manejo de rate-limit
 */
function triggerDrainLoop() {
  if (isDraining || isPausedForBackoff) return;
  runDrainLoop();
}

async function runDrainLoop() {
  if (isDraining || isPausedForBackoff) return;
  isDraining = true;

  try {
    while (true) {
      // Tomar el siguiente elemento encolado en orden FIFO estricto
      const nextIndex = memoryQueue.findIndex(i => i.status === 'ENCOLADO');
      if (nextIndex === -1) {
        break; // No hay más ítems pendientes de envío
      }

      const item = memoryQueue[nextIndex];
      item.status = 'PROCESANDO';
      notifyQueueListeners();

      try {
        const result = await submitStockAdjustment({
          dashboardId: item.dashboardId,
          insumoId: item.insumoId,
          nombre: item.nombre,
          conteoFisico: item.conteoFisico,
          stockActual: item.stockActual,
          motivo: item.motivo,
          justificacion: item.justificacion,
          costoUnitarioUSD: item.costoUnitarioUSD,
          tasaBCV: item.tasaBCV,
          supervisorPin: item.supervisorPin,
          stockTeoricoAlCapturar: item.stockActual,
          idempotencyKey: `IDEMP-QUEUE-${item.id}`,
        });

        // Éxito: reproducir acorde armónico
        playSuccessChime();

        // Notificar a listeners (App.tsx actualiza stock vivo y KPIs)
        notifyItemProcessed(result, item);

        // Remover ítem completado de la cola
        memoryQueue = memoryQueue.filter(i => i.id !== item.id);
        notifyQueueListeners();
        await persistQueueToDB(memoryQueue);

        // PAUSA OBLIGATORIA ANTI-RATE LIMIT (500 ms)
        await new Promise(r => setTimeout(r, DRAIN_INTERVAL_MS));

      } catch (err: any) {
        const isRateLimit = err?.statusCode === 429 || (err?.message && err.message.includes('429'));
        const requiresPin = err?.requiresSupervisorPin || (err?.message && err.message.includes('PIN'));

        if (isRateLimit) {
          // HTTP 429: Aplicar pausa y backoff exponencial con jitter
          item.status = 'ENCOLADO';
          item.retryCount = (item.retryCount || 0) + 1;
          const backoffMs = Math.min(10000, 2000 * Math.pow(1.5, item.retryCount)) + Math.floor(Math.random() * 500);
          
          isPausedForBackoff = true;
          notifyQueueListeners();
          await persistQueueToDB(memoryQueue);

          console.warn(`[FIFO Queue] Notion API Rate Limit detectado. Pausando drenaje ${backoffMs}ms...`);
          await new Promise(r => setTimeout(r, backoffMs));
          isPausedForBackoff = false;
          // Continúa el bucle reintentando
        } else if (requiresPin) {
          // Requiere firma de supervisor en el servidor
          item.status = 'PENDIENTE_FIRMA';
          item.errorMessage = err.message || 'Se requiere PIN de supervisor';
          playWarningTone();
          notifyQueueListeners();
          await persistQueueToDB(memoryQueue);
        } else {
          // Error no recuperable o de validación
          item.retryCount = (item.retryCount || 0) + 1;
          if (item.retryCount >= 3) {
            item.status = 'ERROR';
            item.errorMessage = err?.message || 'Error procesando ajuste';
            playErrorTone();
          } else {
            item.status = 'ENCOLADO';
          }
          notifyQueueListeners();
          await persistQueueToDB(memoryQueue);
          // Pausa preventiva de 1.5s antes de continuar con el siguiente
          await new Promise(r => setTimeout(r, 1500));
        }
      }
    }
  } finally {
    isDraining = false;
  }
}
