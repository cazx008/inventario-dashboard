import React, { useState, useEffect } from 'react';
import { 
  X, 
  Wifi, 
  WifiOff, 
  RefreshCw, 
  Trash2, 
  CheckCircle2, 
  AlertTriangle, 
  Database,
  ArrowRight,
  Loader2
} from 'lucide-react';
import { 
  OfflineAdjustmentRecord, 
  getPendingAdjustments, 
  removeOfflineAdjustment 
} from '../services/offlineStorageService';
import { syncPendingAdjustments, SyncBatchResult } from '../services/offlineSyncService';

interface OfflineQueueModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSyncComplete?: (result: SyncBatchResult) => void;
  bcvRate?: number;
}

export const OfflineQueueModal: React.FC<OfflineQueueModalProps> = ({
  isOpen,
  onClose,
  onSyncComplete,
  bcvRate = 36.50
}) => {
  const [items, setItems] = useState<OfflineAdjustmentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  const loadQueue = async () => {
    setLoading(true);
    try {
      const records = await getPendingAdjustments();
      setItems(records);
    } catch (err) {
      console.warn('Error cargando cola offline:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadQueue();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleSyncAll = async () => {
    if (!isOnline) return;
    setIsSyncing(true);
    try {
      const result = await syncPendingAdjustments(bcvRate);
      await loadQueue();
      if (onSyncComplete) {
        onSyncComplete(result);
      }
      if (result.syncedCount > 0 && result.failedCount === 0) {
        onClose();
      }
    } catch (err) {
      console.error('Error sincronizando cola offline:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleRemove = async (localId: string) => {
    if (window.confirm('¿Deseas descartar este ajuste de la cola local? Esta acción no se puede deshacer.')) {
      await removeOfflineAdjustment(localId);
      await loadQueue();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div 
        className="relative w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden my-8"
        role="dialog"
        aria-modal="true"
        aria-labelledby="offline-queue-title"
      >
        {/* Cabecera */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="offline-queue-title" className="text-lg font-bold text-zinc-100 tracking-tight">
                  Cola Local de Conteos Offline
                </h2>
                <span className={`px-2 py-0.5 text-[10px] font-mono font-semibold uppercase rounded-full flex items-center gap-1 border ${
                  isOnline 
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                    : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                }`}>
                  {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                  {isOnline ? 'En Línea' : 'Desconectado'}
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                Ajustes guardados en el almacenamiento seguro IndexedDB pendientes de asentar en Notion
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-zinc-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Contenido */}
        <div className="p-6 space-y-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-zinc-400 gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
              <p className="text-xs">Consultando base local del dispositivo...</p>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-zinc-500 gap-2 text-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
              <p className="text-sm font-semibold text-zinc-300">Cola local vacía</p>
              <p className="text-xs max-w-sm">
                Todos los conteos físicos y mermas de almacén están 100% sincronizados con el ERP en la nube.
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
              {items.map((item) => {
                const dateStr = new Date(item.timestamp).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                return (
                  <div 
                    key={item.localId}
                    className="p-3.5 rounded-xl bg-zinc-950/70 border border-zinc-800 hover:border-zinc-700 transition space-y-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-zinc-200 text-sm">{item.itemNombre}</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                            {dateStr}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-400 mt-0.5">
                          Motivo: <span className="text-zinc-300 font-medium">{item.motivo}</span>
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemove(item.localId)}
                        className="p-1.5 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition"
                        title="Descartar ajuste"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Fila de Valores */}
                    <div className="flex items-center gap-4 text-xs pt-1 border-t border-zinc-850">
                      <div>
                        <span className="text-zinc-500 block text-[10px] uppercase">Stock Teórico</span>
                        <span className="font-mono text-zinc-400">{item.stockSistemaAlCapturar} {item.unidad}</span>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-zinc-600 self-end mb-1" />
                      <div>
                        <span className="text-amber-400 block text-[10px] uppercase font-bold">Conteo Físico Real</span>
                        <span className="font-mono text-amber-300 font-bold">{item.conteoFisicoReal} {item.unidad}</span>
                      </div>
                      <div className="ml-auto text-right">
                        <span className="text-zinc-500 block text-[10px] uppercase">Discrepancia (Δ)</span>
                        <span className={`font-mono font-bold ${item.deltaOriginal < 0 ? 'text-rose-400' : item.deltaOriginal > 0 ? 'text-cyan-400' : 'text-emerald-400'}`}>
                          {item.deltaOriginal > 0 ? `+${item.deltaOriginal}` : item.deltaOriginal} {item.unidad}
                        </span>
                      </div>
                    </div>

                    {item.lastError && (
                      <div className="flex items-center gap-1.5 text-[11px] text-rose-400 bg-rose-500/10 p-2 rounded-lg border border-rose-500/20">
                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>Fallo de subida: {item.lastError} (Reintentos: {item.syncAttempts})</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-800 bg-zinc-950/80">
          <span className="text-xs text-zinc-500 font-mono">
            {items.length} {items.length === 1 ? 'ajuste pendiente' : 'ajustes pendientes'}
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition"
            >
              Cerrar
            </button>

            {items.length > 0 && (
              <button
                type="button"
                disabled={!isOnline || isSyncing}
                onClick={handleSyncAll}
                className="px-4 py-2 text-xs font-bold bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed text-zinc-950 rounded-lg transition shadow-md shadow-amber-500/10 flex items-center gap-1.5"
              >
                {isSyncing ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Sincronizando lote...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Sincronizar Cola Ahora</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
