import React, { useState, useEffect, useRef } from 'react';
import {
  Truck,
  X,
  Camera,
  Check,
  AlertOctagon,
  CheckCircle2,
  ChevronRight,
  FileText,
  ArrowRight,
  WifiOff,
  Image as ImageIcon,
  Trash2,
  Search,
  Plus
} from 'lucide-react';
import { OABLineItem } from '../types/oab';
import { InventoryItem } from '../types/inventory';
import {
  registerReception,
  uploadEvidenceToR2,
  fetchPendingOABs,
  fetchOABDetails,
  RegisterReceptionPayload
} from '../services/oabService';
import { 
  queueOfflineReception, 
  uploadEvidenceWithBackoff, 
  queuePhotoForRetry, 
  getPendingPhotosCount 
} from '../services/offlineReceptionStorage';
import { compressImageFile } from '../utils/imageCompressor';

interface ReceptionTerminalModalProps {
  isOpen: boolean;
  onClose: () => void;
  inventoryItems: InventoryItem[];
  onReceptionSuccess?: (receivedLines?: OABLineItem[]) => void;
}

export const ReceptionTerminalModal: React.FC<ReceptionTerminalModalProps> = ({
  isOpen,
  onClose,
  inventoryItems,
  onReceptionSuccess
}) => {
  const [pendingOrders, setPendingOrders] = useState<any[]>([]);
  const [selectedFolio, setSelectedFolio] = useState('');
  const [selectedOabId, setSelectedOabId] = useState<string | undefined>(undefined);
  const [manualFolioInput, setManualFolioInput] = useState('');
  const [notaEntrega, setNotaEntrega] = useState('');
  const [fechaRecepcion, setFechaRecepcion] = useState(new Date().toISOString().split('T')[0]);
  const [tasaBCV, setTasaBCV] = useState<number>(45.0);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [itemsToReceive, setItemsToReceive] = useState<OABLineItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [receptionComplete, setReceptionComplete] = useState<any | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [searchItemQuery, setSearchItemQuery] = useState('');

  // Estados de Facturación Fiscal SENIAT y Resiliencia R2 (Fase 9C / 9D)
  const [numeroFacturaFiscal, setNumeroFacturaFiscal] = useState('');
  const [numeroControlFiscal, setNumeroControlFiscal] = useState('');
  const [showFiscalInputs, setShowFiscalInputs] = useState(false);
  const [pendingPhotosCount, setPendingPhotosCount] = useState<number>(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Insumos filtrados para búsqueda y adición directa en rampa
  const filteredInventory = searchItemQuery.trim()
    ? inventoryItems.filter(item =>
        item.nombre.toLowerCase().includes(searchItemQuery.toLowerCase()) ||
        (item.codigo && item.codigo.toLowerCase().includes(searchItemQuery.toLowerCase())) ||
        (item.categoriaMaterial && item.categoriaMaterial.toLowerCase().includes(searchItemQuery.toLowerCase()))
      ).slice(0, 8)
    : [];

  // Monitorear conectividad online/offline
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

  // Monitorear cola de fotos diferidas y eventos de sincronización
  useEffect(() => {
    getPendingPhotosCount().then(setPendingPhotosCount).catch(() => {});
    const handleSync = (e: any) => {
      if (e.detail?.photoCount !== undefined) {
        setPendingPhotosCount(e.detail.photoCount);
      }
    };
    window.addEventListener('rampa-sync-updated', handleSync);
    return () => window.removeEventListener('rampa-sync-updated', handleSync);
  }, []);

  // Cargar lista de OABs pendientes al abrir el modal
  useEffect(() => {
    if (!isOpen) return;

    setSelectedFolio('');
    setSelectedOabId(undefined);
    setManualFolioInput('');
    setNotaEntrega('');
    setNumeroFacturaFiscal('');
    setNumeroControlFiscal('');
    setShowFiscalInputs(false);
    setFechaRecepcion(new Date().toISOString().split('T')[0]);
    setPhotoPreview(null);
    setReceptionComplete(null);
    setErrorMessage(null);
    setSearchItemQuery('');
    setItemsToReceive([]);

    // Cargar órdenes pendientes desde Notion
    fetchPendingOABs().then(orders => {
      // Priorizar órdenes en tránsito real ('En Compra' o 'Recepción Parcial')
      const rampaOrders = orders.filter(o => o.estadoGeneral === 'En Compra' || o.estadoGeneral === 'Recepción Parcial');
      const targetList = rampaOrders.length > 0 ? rampaOrders : orders;
      setPendingOrders(targetList);
      if (targetList.length > 0) {
        handleLoadOAB(targetList[0].folio);
      } else {
        setSelectedFolio('');
        setSelectedOabId(undefined);
        setItemsToReceive([]);
      }
    }).catch(() => {
      setSelectedFolio('');
      setSelectedOabId(undefined);
      setItemsToReceive([]);
    });
  }, [isOpen]);

  const handleSelectOAB = async (folio: string) => {
    setSelectedFolio(folio);
    if (!folio) {
      setSelectedOabId(undefined);
      setItemsToReceive([]);
      return;
    }
    handleLoadOAB(folio);
  };

  const handleAddItem = (item: InventoryItem) => {
    setItemsToReceive(prev => {
      const existingIdx = prev.findIndex(i =>
        (i.dashboardId && i.dashboardId === item.id) ||
        (i.insumoId && i.insumoId === item.insumoId) ||
        (i.nombre.toLowerCase() === item.nombre.toLowerCase())
      );

      if (existingIdx >= 0) {
        const copy = [...prev];
        const currentQty = copy[existingIdx].cantidadRecibida || 0;
        copy[existingIdx] = {
          ...copy[existingIdx],
          cantidadRecibida: currentQty + 1
        };
        return copy;
      }

      const newLine: OABLineItem = {
        nombre: item.nombre,
        insumoId: item.insumoId || item.id,
        dashboardId: item.id,
        cantidadStock: item.stockBase || 0,
        stockMinimo: item.stockMinimo || 0,
        deficit: item.deficit || 0,
        cantidadSugerida: 1,
        cantidadSolicitada: 1,
        cantidadAprobada: 0,
        cantidadRecibida: 1,
        cantidadRechazada: 0,
        backorderPendiente: 0,
        costoUnitarioUSD: item.costoUnitarioUSD || 0,
        costoAprobadoUSD: item.costoUnitarioUSD || 0,
        subtotalUSD: item.costoUnitarioUSD || 0,
        prioridad: item.prioridad || 'Media'
      };
      return [newLine, ...prev];
    });
    setSearchItemQuery('');
  };

  const handleRemoveItem = (indexToRemove: number) => {
    setItemsToReceive(prev => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const handleLoadOAB = async (folio: string) => {
    if (!folio) return;
    setSelectedFolio(folio);
    setIsSearching(true);
    setErrorMessage(null);

    try {
      const data = await fetchOABDetails(folio);
      if (data) {
        setSelectedOabId(data.oab.id);
        if (data.oab.cotizacion) {
          setNotaEntrega(prev => prev || data.oab.cotizacion || '');
        }
        if (data.oab.tasaBCV) {
          setTasaBCV(data.oab.tasaBCV);
        }

        const mappedLines: OABLineItem[] = data.lines.map(line => ({
          id: line.solicitudId,
          nombre: line.nombre,
          insumoId: line.insumoId,
          dashboardId: line.dashboardId,
          cantidadStock: 0,
          stockMinimo: 0,
          deficit: 0,
          cantidadSugerida: line.cantidadSolicitada,
          cantidadSolicitada: line.cantidadSolicitada,
          cantidadAprobada: line.cantidadAprobada,
          cantidadRecibida: line.cantidadAprobada, // Pre-cargar con la cantidad aprobada por Magaly
          cantidadRechazada: 0,
          backorderPendiente: 0,
          costoUnitarioUSD: line.costoUnitarioUSD,
          costoAprobadoUSD: line.costoUnitarioUSD,
          subtotalUSD: line.subtotalUSD,
          prioridad: line.prioridad || 'Alta',
          proyectoNombre: line.proyectoNombre
        }));

        setItemsToReceive(mappedLines);
      }
    } catch (err: any) {
      console.warn('No se pudo cargar detalle de OAB, usando fallback:', err);
      setSelectedOabId(undefined);
    } finally {
      setIsSearching(false);
    }
  };

  // Captura fotográfica con compresión Canvas pericial (máx 1600px, JPEG 80%)
  const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const compressed = await compressImageFile(file, 1600, 0.8);
        setPhotoPreview(compressed);
      } catch (err) {
        console.warn('Fallo compresión pericial en cliente, usando lector nativo:', err);
        const reader = new FileReader();
        reader.onload = (event) => {
          const base64 = event.target?.result as string;
          setPhotoPreview(base64);
        };
        reader.readAsDataURL(file);
      }
    }
  };

  // Touch helpers para rampa
  const handleSetFull = (idx: number) => {
    setItemsToReceive(prev => {
      const copy = [...prev];
      const approved = copy[idx].cantidadAprobada || copy[idx].cantidadSolicitada || 0;
      copy[idx] = {
        ...copy[idx],
        cantidadRecibida: approved,
        cantidadRechazada: 0,
        backorderPendiente: 0
      };
      return copy;
    });
  };

  const handleSetZero = (idx: number) => {
    setItemsToReceive(prev => {
      const copy = [...prev];
      const approved = copy[idx].cantidadAprobada || copy[idx].cantidadSolicitada || 0;
      copy[idx] = {
        ...copy[idx],
        cantidadRecibida: 0,
        cantidadRechazada: approved,
        backorderPendiente: approved
      };
      return copy;
    });
  };

  const handleQuantityChange = (idx: number, field: 'cantidadRecibida' | 'cantidadRechazada' | 'costoUnitarioUSD', value: number) => {
    setItemsToReceive(prev => {
      const copy = [...prev];
      const val = Math.max(0, value);
      copy[idx] = {
        ...copy[idx],
        [field]: val
      };

      if (field === 'cantidadRecibida' || field === 'cantidadRechazada') {
        const approved = copy[idx].cantidadAprobada || copy[idx].cantidadSolicitada || 0;
        const rec = field === 'cantidadRecibida' ? val : (copy[idx].cantidadRecibida || 0);
        copy[idx].backorderPendiente = Math.max(0, approved - rec);
      }

      return copy;
    });
  };

  const handleToggleTolerance = (idx: number) => {
    setItemsToReceive(prev => {
      const copy = [...prev];
      copy[idx] = {
        ...copy[idx],
        toleranciaExcedente: !copy[idx].toleranciaExcedente
      };
      return copy;
    });
  };

  const handleNotesChange = (idx: number, text: string) => {
    setItemsToReceive(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], notasDiscrepancia: text };
      return copy;
    });
  };

  // Confirmar recepción con tolerancia a fallas y soporte offline
  const handleConfirmReception = async () => {
    if (!notaEntrega.trim()) {
      alert('Por favor indica el Número de Nota de Entrega física o Remisión del camión.');
      return;
    }

    if (itemsToReceive.length === 0) {
      alert('Debe agregar al menos un material a recibir.');
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);

    const activeFolio = selectedFolio || manualFolioInput || `RAMPA-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
    const cleanNota = notaEntrega.trim();
    const isDeviceOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    // Subida pericial a Cloudflare R2 con backoff exponencial si estamos online y hay captura de foto
    let r2EvidenceUrl: string | undefined = undefined;
    let fotoPendienteSync = false;
    if (photoPreview && isDeviceOnline) {
      try {
        r2EvidenceUrl = await uploadEvidenceWithBackoff(activeFolio, cleanNota, photoPreview, 4);
      } catch (r2Err) {
        console.warn('Subida a R2 agotó reintentos, encolando foto para reintento diferido:', r2Err);
        await queuePhotoForRetry({
          folioOAB: activeFolio,
          numeroNotaEntrega: cleanNota,
          imageBase64: photoPreview,
          attempts: 4,
          lastError: String(r2Err)
        });
        fotoPendienteSync = true;
      }
    }

    const payload: RegisterReceptionPayload = {
      folioOAB: activeFolio,
      oabId: selectedOabId,
      numeroNotaEntrega: cleanNota,
      fechaRecepcion,
      tasaBCV: Number(tasaBCV) || 1.0,
      comprobanteUrl: r2EvidenceUrl,
      comprobanteFile: !r2EvidenceUrl && photoPreview && !fotoPendienteSync ? photoPreview : undefined,
      numeroFacturaFiscal: numeroFacturaFiscal.trim() || undefined,
      numeroControlFiscal: numeroControlFiscal.trim() || undefined,
      fotoPendienteSync: fotoPendienteSync || undefined,
      items: itemsToReceive.map(l => ({
        solicitudId: l.id,
        dashboardId: l.dashboardId,
        insumoId: l.insumoId,
        nombre: l.nombre,
        cantidadAprobada: l.cantidadAprobada || l.cantidadSolicitada,
        cantidadRecibida: l.cantidadRecibida || 0,
        cantidadRechazada: l.cantidadRechazada || 0,
        costoUnitarioUSD: l.costoUnitarioUSD || 0,
        costoAprobadoUSD: l.costoAprobadoUSD || l.costoUnitarioUSD || 0,
        toleranciaExcedente: l.toleranciaExcedente,
        notasDiscrepancia: l.notasDiscrepancia
      }))
    };

    // Caso 1: Dispositivo offline
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      try {
        await queueOfflineReception(payload);
        setReceptionComplete({
          status: 'queued_offline',
          folioOAB: activeFolio,
          estadoGeneral: 'En cola offline (Rampa)',
          itemsProcesados: itemsToReceive.length,
          message: 'Sin conexión a Internet. Recepción guardada en IndexedDB local; se sincronizará con Notion ERP en cuanto se restablezca la señal.'
        });
        if (onReceptionSuccess) onReceptionSuccess(itemsToReceive);
      } catch (idbErr: any) {
        setErrorMessage(`Error guardando en cola offline: ${idbErr.message}`);
      } finally {
        setIsProcessing(false);
      }
      return;
    }

    // Caso 2: Intento online con fallback automático ante microcortes
    try {
      const result = await registerReception(payload);
      setReceptionComplete(result);
      if (onReceptionSuccess) onReceptionSuccess(itemsToReceive);
    } catch (netErr: any) {
      console.warn('Microcorte o fallo de red en rampa. Guardando en cola offline:', netErr);
      try {
        await queueOfflineReception(payload);
        setReceptionComplete({
          status: 'queued_offline',
          folioOAB: activeFolio,
          estadoGeneral: 'En cola offline (Rampa)',
          itemsProcesados: itemsToReceive.length,
          message: 'Se detectó interrupción de red. La recepción se guardó de forma segura en la memoria de la terminal (IndexedDB) para su sincronización diferida.'
        });
        if (onReceptionSuccess) onReceptionSuccess(itemsToReceive);
      } catch (fallbackErr: any) {
        setErrorMessage(`Fallo de red y de persistencia local: ${fallbackErr.message}`);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-4 no-print">
      <div className="bg-surface border border-borderSubtle rounded-xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
        
        {/* Terminal Header */}
        <div className="px-5 py-3 bg-surfaceHigh border-b border-borderSubtle flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-signal-blue/20 text-signal-blue border border-signal-blue/40">
              <Truck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100 tracking-tight flex items-center gap-2">
                <span>Terminal Táctil de Recepción en Rampa</span>
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                  ALMACÉN CENTRAL
                </span>
                {!isOnline && (
                  <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                    <WifiOff className="w-3 h-3" />
                    Modo Offline
                  </span>
                )}
                {pendingPhotosCount > 0 && (
                  <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 flex items-center gap-1" title="Fotos encoladas para reintento automático hacia Cloudflare R2">
                    <ImageIcon className="w-3 h-3" />
                    {pendingPhotosCount} foto(s) pend. R2
                  </span>
                )}
              </h2>
              <p className="text-[11px] text-slate-400">
                Conteo físico, foto de Nota de Entrega, tolerancia de corte y asiento inmutable en Kardex
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-md hover:bg-surfaceHighest transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {receptionComplete ? (
          // Vista de Éxito / Comprobante de Entrada
          <div className="p-8 text-center space-y-4 max-w-lg mx-auto my-auto">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto border ${
              receptionComplete.status === 'queued_offline'
                ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
            }`}>
              {receptionComplete.status === 'queued_offline' ? (
                <WifiOff className="w-8 h-8" />
              ) : (
                <CheckCircle2 className="w-10 h-10" />
              )}
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-100">
                {receptionComplete.status === 'queued_offline'
                  ? '¡Recepción Guardada en Cola Offline!'
                  : '¡Recepción Asentada Exitosamente!'}
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                {receptionComplete.message || 'Los materiales han ingresado formalmente a las existencias físicas.'}
              </p>
            </div>
            <div className="bg-page border border-borderSubtle rounded-lg p-4 text-xs text-left space-y-1.5 font-mono">
              <div className="flex justify-between">
                <span className="text-slate-500">Folio OAB:</span>
                <span className="text-brand-400 font-bold">{receptionComplete.folioOAB}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Estado:</span>
                <span className="text-slate-200">{receptionComplete.estadoGeneral || 'Completada'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Ítems Procesados:</span>
                <span className="text-slate-200">{receptionComplete.itemsProcesados}</span>
              </div>
              {receptionComplete.duplicateDetected && (
                <div className="text-amber-400 text-[11px] pt-1">
                  ⚠️ Protección de Idempotencia: Esta orden ya contaba con registro previo para la misma nota.
                </div>
              )}
            </div>
            <div className="pt-2 flex justify-center gap-3">
              <button
                onClick={onClose}
                className="px-6 py-2 text-xs font-semibold rounded-lg bg-brand-500 hover:bg-brand-600 text-slate-950 transition"
              >
                Finalizar y Volver a Inventario
              </button>
            </div>
          </div>
        ) : (
          // Formulario de Recepción en Rampa
          <>
            {/* Meta bar: Selector de OAB, N° Nota de Entrega, Fecha, Tasa BCV, Foto */}
            <div className="p-3 bg-page border-b border-borderSubtle grid grid-cols-1 sm:grid-cols-5 gap-3 text-xs">
              <div>
                <label className="block text-[10px] uppercase text-slate-400 font-semibold mb-1">
                  Seleccionar OAB en Camino
                </label>
                <select
                  value={selectedFolio}
                  onChange={(e) => handleSelectOAB(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono font-bold bg-surface border border-borderSubtle rounded text-brand-400"
                >
                  <option value="">-- Ingreso Directo en Rampa --</option>
                  {pendingOrders.map(o => (
                    <option key={o.id} value={o.folio}>
                      {o.folio} ({o.estadoGeneral}) · {o.proveedor || 'Sin Prov.'}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] uppercase text-slate-400 font-semibold mb-1">
                  N° Nota de Entrega / Guía *
                </label>
                <input
                  type="text"
                  placeholder="Ej: NE-9941 / FAC-8201"
                  value={notaEntrega}
                  onChange={(e) => setNotaEntrega(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono font-bold bg-surface border border-borderSubtle rounded text-slate-100 placeholder-slate-500"
                  required
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase text-slate-400 font-semibold mb-1">
                  Fecha de Descarga
                </label>
                <input
                  type="date"
                  value={fechaRecepcion}
                  onChange={(e) => setFechaRecepcion(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-surface border border-borderSubtle rounded text-slate-200"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase text-slate-400 font-semibold mb-1">
                  Tasa BCV (Bs/USD)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={tasaBCV}
                  onChange={(e) => setTasaBCV(Number(e.target.value) || 1.0)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono font-bold bg-surface border border-borderSubtle rounded text-emerald-400"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase text-slate-400 font-semibold mb-1">
                  Foto Nota de Entrega
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded border text-xs font-medium transition ${
                      photoPreview
                        ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-400'
                        : 'bg-surfaceHigh hover:bg-surfaceHighest border-borderSubtle text-slate-300'
                    }`}
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>{photoPreview ? 'Foto Lista ✓' : 'Tomar Foto'}</span>
                  </button>

                  {photoPreview && (
                    <button
                      type="button"
                      onClick={() => setPhotoPreview(null)}
                      title="Eliminar foto"
                      className="p-1.5 bg-red-900/30 hover:bg-red-800/40 text-red-400 rounded border border-red-500/40"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoCapture}
                  className="hidden"
                />
              </div>
            </div>

            {/* Sección Opcional: Facturación Legal SENIAT (Rampa u Oficina - Fase 9C) */}
            <div className="px-4 py-2 bg-surfaceHigh/60 border-b border-borderSubtle flex flex-wrap items-center justify-between gap-2 text-xs">
              <button
                type="button"
                onClick={() => setShowFiscalInputs(prev => !prev)}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300 hover:text-white transition"
              >
                <FileText className="w-3.5 h-3.5 text-brand-400" />
                <span>🏛️ Factura Fiscal SENIAT (Opcional - Rampa u Oficina)</span>
                <span className="text-[10px] text-slate-400 underline ml-1">
                  {showFiscalInputs ? 'Ocultar' : (numeroFacturaFiscal ? `FAC: ${numeroFacturaFiscal}` : 'Desplegar')}
                </span>
              </button>

              {showFiscalInputs && (
                <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto mt-1 sm:mt-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] uppercase text-slate-400 font-mono">N° Factura:</span>
                    <input
                      type="text"
                      placeholder="Ej: 001248"
                      value={numeroFacturaFiscal}
                      onChange={(e) => setNumeroFacturaFiscal(e.target.value)}
                      className="w-28 px-2 py-1 text-xs font-mono bg-surface border border-borderSubtle rounded text-slate-200 placeholder-slate-600 focus:border-brand-400"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] uppercase text-slate-400 font-mono">N° Control:</span>
                    <input
                      type="text"
                      placeholder="Ej: 00-019842"
                      value={numeroControlFiscal}
                      onChange={(e) => setNumeroControlFiscal(e.target.value)}
                      className="w-28 px-2 py-1 text-xs font-mono bg-surface border border-borderSubtle rounded text-slate-200 placeholder-slate-600 focus:border-brand-400"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Banner de Búsqueda o Errores */}
            {isSearching && (
              <div className="py-2 px-4 bg-brand-500/10 border-b border-brand-500/20 text-center text-xs text-brand-400 font-mono animate-pulse">
                Cargando renglones aprobados de la OAB desde Notion...
              </div>
            )}

            {errorMessage && (
              <div className="m-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400 flex items-center gap-2">
                <AlertOctagon className="w-4 h-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Buscador de Insumos para Ingreso Directo en Rampa */}
            <div className="px-4 py-2.5 bg-surfaceHigh/40 border-b border-borderSubtle">
              <div className="relative">
                <div className="flex items-center gap-2 bg-surface border border-borderSubtle focus-within:border-brand-500 rounded-lg px-3 py-2 text-xs transition">
                  <Search className="w-4 h-4 text-slate-400 shrink-0" />
                  <input
                    type="text"
                    value={searchItemQuery}
                    onChange={(e) => setSearchItemQuery(e.target.value)}
                    placeholder="Buscar insumo por código o nombre para agregar a rampa..."
                    className="w-full bg-transparent text-slate-100 placeholder-slate-500 focus:outline-none font-sans"
                  />
                  {searchItemQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchItemQuery('')}
                      className="text-slate-400 hover:text-white p-0.5"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Dropdown flotante de resultados */}
                {filteredInventory.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-surfaceHigh border border-borderSubtle rounded-lg shadow-2xl z-30 max-h-60 overflow-y-auto">
                    {filteredInventory.map(item => (
                      <div
                        key={item.id}
                        onClick={() => handleAddItem(item)}
                        className="px-3 py-2 hover:bg-surfaceHighest cursor-pointer flex items-center justify-between border-b border-borderSubtle/50 last:border-0 text-xs transition"
                      >
                        <div>
                          <div className="font-semibold text-slate-100 flex items-center gap-2">
                            <span>{item.nombre}</span>
                            {item.codigo && (
                              <span className="font-mono text-[10px] text-brand-400 bg-brand-500/10 px-1.5 py-0.5 rounded border border-brand-500/20">
                                {item.codigo}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {item.categoriaMaterial || 'Insumo'} · Stock actual: {item.stockBase} {item.unidad || 'und'}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 text-right">
                          <div className="text-[10px] font-mono text-emerald-400">
                            ${(item.costoUnitarioUSD || 0).toFixed(2)} USD
                          </div>
                          <button
                            type="button"
                            className="p-1 rounded bg-brand-500/20 text-brand-400 hover:bg-brand-500/30 transition"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Listado de Materiales a Recibir */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span>Materiales a verificar ({itemsToReceive.length}):</span>
                <span className="text-[11px] text-slate-500 font-mono">
                  {itemsToReceive.length > 0 ? 'Toca "Todo" si el bulto llegó íntegro o ajusta cantidades ante faltantes' : 'Terminal lista para ingreso'}
                </span>
              </div>

              {itemsToReceive.length === 0 ? (
                <div className="text-center py-12 px-4 border border-dashed border-borderSubtle rounded-xl bg-page/40 my-4">
                  <div className="w-12 h-12 rounded-full bg-slate-800/80 border border-slate-700 flex items-center justify-center mx-auto mb-3 text-slate-400">
                    <Search className="w-6 h-6" />
                  </div>
                  <h4 className="text-sm font-semibold text-slate-200">
                    {selectedFolio ? 'Orden sin renglones pendientes' : 'Rampa limpia: Sin materiales cargados'}
                  </h4>
                  <p className="text-xs text-slate-400 max-w-md mx-auto mt-1">
                    {selectedFolio
                      ? 'Esta orden no tiene renglones pendientes por recibir.'
                      : 'Usa el buscador superior para agregar los insumos físicos que están ingresando directamente a la planta sin OAB.'}
                  </p>
                </div>
              ) : (
                itemsToReceive.map((item, idx) => {
                  const isFromOAB = Boolean(item.cantidadAprobada && item.cantidadAprobada > 0);
                  const approvedQty = isFromOAB ? (item.cantidadAprobada || 0) : 0;
                  const receivedQty = item.cantidadRecibida ?? (isFromOAB ? approvedQty : 1);
                  const hasDiscrepancy = (item.cantidadRechazada || 0) > 0 || (item.backorderPendiente || 0) > 0;

                  return (
                    <div
                      key={item.id || idx}
                      className={`p-3 rounded-lg border transition-all ${
                        hasDiscrepancy
                          ? 'bg-amber-950/20 border-amber-500/40'
                          : 'bg-page/70 border-borderSubtle hover:border-slate-600'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                        <div>
                          <span className="font-semibold text-sm text-slate-100">{item.nombre}</span>
                          <span className="text-xs text-slate-400 ml-2">
                            {isFromOAB ? (
                              <>
                                Aprobado en OAB:{' '}
                                <strong className="text-slate-200 font-mono">
                                  {approvedQty} und @ ${(item.costoAprobadoUSD || item.costoUnitarioUSD || 0).toFixed(2)} USD
                                </strong>
                              </>
                            ) : (
                              <>
                                Ingreso Directo · Stock actual en planta:{' '}
                                <strong className="text-slate-200 font-mono">
                                  {item.cantidadStock ?? 0} und
                                </strong>
                              </>
                            )}
                          </span>
                          {item.proyectoNombre && (
                            <span className="text-[10px] text-brand-400 font-mono ml-2">
                              [{item.proyectoNombre}]
                            </span>
                          )}
                        </div>

                        {/* Botones táctiles de acción rápida y eliminación */}
                        <div className="flex items-center gap-1.5 self-end sm:self-auto">
                          {isFromOAB && (
                            <button
                              type="button"
                              onClick={() => handleSetFull(idx)}
                              className="px-2 py-1 text-[11px] font-semibold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/40 rounded transition active:scale-95"
                            >
                              Todo ({approvedQty})
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleSetZero(idx)}
                            className="px-2 py-1 text-[11px] font-semibold bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/40 rounded transition active:scale-95"
                          >
                            0
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(idx)}
                            title="Quitar este material de la rampa"
                            className="p-1 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded transition"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                    {/* Inputs de Conteo Físico y Valuación */}
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                      <div>
                        <label className="block text-[10px] text-emerald-400 uppercase font-semibold mb-1">
                          Conforme:
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={item.cantidadRecibida}
                          onChange={(e) => handleQuantityChange(idx, 'cantidadRecibida', Number(e.target.value))}
                          className="w-full px-2.5 py-1 text-center font-mono font-bold text-sm bg-surface border border-emerald-500/40 rounded text-emerald-400"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-red-400 uppercase font-semibold mb-1">
                          Rechazo:
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={item.cantidadRechazada}
                          onChange={(e) => handleQuantityChange(idx, 'cantidadRechazada', Number(e.target.value))}
                          className="w-full px-2.5 py-1 text-center font-mono font-bold text-sm bg-surface border border-red-500/40 rounded text-red-400"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-slate-300 uppercase font-semibold mb-1 flex items-center justify-between">
                          <span>Costo Unit. Real</span>
                          {item.costoAprobadoUSD && item.costoUnitarioUSD > item.costoAprobadoUSD * 1.05 && (
                            <span className="text-[9px] text-amber-400 font-bold font-mono">
                              +{(((item.costoUnitarioUSD - item.costoAprobadoUSD) / item.costoAprobadoUSD) * 100).toFixed(0)}%
                            </span>
                          )}
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={item.costoUnitarioUSD}
                          onChange={(e) => handleQuantityChange(idx, 'costoUnitarioUSD', Number(e.target.value))}
                          className={`w-full px-2 py-1 text-center font-mono font-bold text-sm bg-surface border rounded ${
                            item.costoAprobadoUSD && item.costoUnitarioUSD > item.costoAprobadoUSD * 1.05
                              ? 'border-amber-500 text-amber-300'
                              : 'border-borderSubtle text-slate-100'
                          }`}
                        />
                        <div className="text-[10px] text-slate-500 font-mono text-center mt-0.5">
                          ≈ Bs {(item.costoUnitarioUSD * (tasaBCV || 1)).toFixed(2)}
                        </div>
                      </div>

                      <div className="col-span-2">
                        <label className="block text-[10px] text-slate-400 uppercase font-semibold mb-1 flex items-center justify-between">
                          <span>Motivo / Discrepancia</span>
                          <label className="flex items-center gap-1 cursor-pointer font-normal text-[10px] text-slate-400">
                            <input
                              type="checkbox"
                              checked={item.toleranciaExcedente || false}
                              onChange={() => handleToggleTolerance(idx)}
                              className="rounded border-borderSubtle text-brand-500 focus:ring-0"
                            />
                            <span>Tolerancia Perfil/Rollo</span>
                          </label>
                        </label>
                        <input
                          type="text"
                          placeholder="Ej: 2 unidades rotas, abolladura en caja..."
                          value={item.notasDiscrepancia || ''}
                          onChange={(e) => handleNotesChange(idx, e.target.value)}
                          className="w-full px-2 py-1 text-xs bg-surface border border-borderSubtle rounded text-slate-200 placeholder-slate-600"
                        />
                      </div>
                    </div>
                  </div>
                );
              }))}
            </div>

            {/* Terminal Footer */}
            <div className="p-3 bg-surfaceHigh border-t border-borderSubtle flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-4 font-mono">
                <div>
                  <span className="text-slate-400">Total a Asentar: </span>
                  <span className="text-emerald-400 font-bold">
                    {itemsToReceive.reduce((acc, i) => acc + (i.cantidadRecibida || 0), 0)} und
                  </span>
                  <span className="text-slate-400 font-mono ml-2">
                    (${itemsToReceive.reduce((acc, i) => acc + (i.cantidadRecibida || 0) * (i.costoUnitarioUSD || 0), 0).toFixed(2)} USD · Bs {(itemsToReceive.reduce((acc, i) => acc + (i.cantidadRecibida || 0) * (i.costoUnitarioUSD || 0), 0) * (tasaBCV || 1)).toFixed(2)})
                  </span>
                </div>
                <div>
                  <span className="text-slate-400">Rechazos: </span>
                  <span className="text-red-400 font-bold">
                    {itemsToReceive.reduce((acc, i) => acc + (i.cantidadRechazada || 0), 0)} und
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  className="px-3.5 py-2 text-xs text-slate-400 hover:text-slate-200 transition rounded"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleConfirmReception}
                  disabled={isProcessing || itemsToReceive.length === 0}
                  className="flex items-center gap-2 px-5 py-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold rounded-lg text-xs transition shadow active:scale-95 disabled:opacity-50"
                >
                  {isProcessing ? (
                    <span>Procesando entrada...</span>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Confirmar Recepción y Asentar en Kardex</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
