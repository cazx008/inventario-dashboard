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
  Plus,
  Tag
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
import { PrintSheetProjectLabels, ProjectLabelItem } from './PrintSheetProjectLabels';

interface ReceptionTerminalModalProps {
  isOpen: boolean;
  onClose: () => void;
  inventoryItems: InventoryItem[];
  initialSearchTerm?: string;
  onReceptionSuccess?: (receivedLines?: OABLineItem[]) => void;
}

export const ReceptionTerminalModal: React.FC<ReceptionTerminalModalProps> = ({
  isOpen,
  onClose,
  inventoryItems,
  initialSearchTerm,
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
  const [validationError, setValidationError] = useState<string | null>(null);
  const [completedLines, setCompletedLines] = useState<OABLineItem[]>([]);
  const [showCompletedAccordion, setShowCompletedAccordion] = useState<boolean>(false);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [searchItemQuery, setSearchItemQuery] = useState('');

  // Estados de Facturación Fiscal SENIAT y Resiliencia R2 (Fase 9C / 9D)
  const [numeroFacturaFiscal, setNumeroFacturaFiscal] = useState('');
  const [numeroControlFiscal, setNumeroControlFiscal] = useState('');
  const [showFiscalInputs, setShowFiscalInputs] = useState(false);
  const [pendingPhotosCount, setPendingPhotosCount] = useState<number>(0);

  // Estados de Rotulado Físico MTO y Etiquetas Duales (Fase 10B)
  const [labelsToPrint, setLabelsToPrint] = useState<ProjectLabelItem[]>([]);
  const [showLabelModal, setShowLabelModal] = useState<boolean>(false);

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
    setValidationError(null);
    setCompletedLines([]);
    setShowCompletedAccordion(false);
    setSearchItemQuery(initialSearchTerm || '');
    setItemsToReceive([]);
    setLabelsToPrint([]);
    setShowLabelModal(false);

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
        prioridad: item.prioridad || 'Media',
        codigo: item.codigo,
        categoriaMaterial: item.categoriaMaterial,
        rotularEtiqueta: false,
        bultos: 1,
        cantEnBulto: 1
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
    setValidationError(null);

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

        const pendingList: OABLineItem[] = [];
        const finishedList: OABLineItem[] = [];

        data.lines.forEach(line => {
          const approved = line.cantidadAprobada ?? line.cantidadSolicitada ?? 0;
          const prevReceived = line.cantidadRecibidaPrevia ?? 0;
          const pendingBalance = line.backorderPendiente !== undefined
            ? line.backorderPendiente
            : Math.max(0, approved - prevReceived);

          const itemObj: OABLineItem = {
            id: line.solicitudId,
            nombre: line.nombre,
            insumoId: line.insumoId,
            dashboardId: line.dashboardId,
            cantidadStock: 0,
            stockMinimo: 0,
            deficit: 0,
            cantidadSugerida: line.cantidadSolicitada,
            cantidadSolicitada: line.cantidadSolicitada,
            cantidadAprobada: approved,
            cantidadRecibidaPrevia: prevReceived,
            cantidadRecibida: pendingBalance,
            cantidadRecibidaHoy: pendingBalance,
            cantidadRechazada: 0,
            backorderPendiente: 0,
            costoUnitarioUSD: line.costoUnitarioUSD,
            costoAprobadoUSD: line.costoUnitarioUSD,
            subtotalUSD: line.subtotalUSD,
            prioridad: line.prioridad || 'Alta',
            proyectoNombre: line.proyectoNombre,
            rotularEtiqueta: Boolean(line.proyectoNombre),
            bultos: 1,
            cantEnBulto: pendingBalance > 0 ? pendingBalance : 1
          };

          if (pendingBalance > 0) {
            pendingList.push(itemObj);
          } else {
            finishedList.push(itemObj);
          }
        });

        setItemsToReceive(pendingList.length > 0 ? pendingList : finishedList);
        setCompletedLines(pendingList.length > 0 ? finishedList : []);
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
      const prevRec = copy[idx].cantidadRecibidaPrevia || 0;
      const pending = Math.max(0, approved - prevRec);
      const bultos = copy[idx].bultos || 1;
      copy[idx] = {
        ...copy[idx],
        cantidadRecibida: pending,
        cantidadRecibidaHoy: pending,
        cantidadRechazada: 0,
        backorderPendiente: 0,
        cantEnBulto: Math.max(1, Math.ceil(pending / bultos))
      };
      return copy;
    });
  };

  const handleSetNextFreight = (idx: number) => {
    setItemsToReceive(prev => {
      const copy = [...prev];
      const approved = copy[idx].cantidadAprobada || copy[idx].cantidadSolicitada || 0;
      const prevRec = copy[idx].cantidadRecibidaPrevia || 0;
      const pending = Math.max(0, approved - prevRec);
      copy[idx] = {
        ...copy[idx],
        cantidadRecibida: 0,
        cantidadRecibidaHoy: 0,
        cantidadRechazada: 0,
        backorderPendiente: pending
      };
      return copy;
    });
  };

  const handleSetAllRemainingAsNextFreight = () => {
    setItemsToReceive(prev => {
      return prev.map(item => {
        const approved = item.cantidadAprobada || item.cantidadSolicitada || 0;
        const prevRec = item.cantidadRecibidaPrevia || 0;
        const pending = Math.max(0, approved - prevRec);
        return {
          ...item,
          cantidadRecibida: 0,
          cantidadRecibidaHoy: 0,
          cantidadRechazada: 0,
          backorderPendiente: pending
        };
      });
    });
  };

  const handleSetZero = (idx: number) => {
    setItemsToReceive(prev => {
      const copy = [...prev];
      const approved = copy[idx].cantidadAprobada || copy[idx].cantidadSolicitada || 0;
      const prevRec = copy[idx].cantidadRecibidaPrevia || 0;
      const pending = Math.max(0, approved - prevRec);
      copy[idx] = {
        ...copy[idx],
        cantidadRecibida: 0,
        cantidadRecibidaHoy: 0,
        cantidadRechazada: pending,
        backorderPendiente: pending
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

      if (field === 'cantidadRecibida') {
        copy[idx].cantidadRecibidaHoy = val;
        const approved = copy[idx].cantidadAprobada || copy[idx].cantidadSolicitada || 0;
        const prevRec = copy[idx].cantidadRecibidaPrevia || 0;
        const pending = Math.max(0, approved - prevRec);
        copy[idx].backorderPendiente = Math.max(0, pending - val);
        const bultos = copy[idx].bultos || 1;
        copy[idx].cantEnBulto = Math.max(1, Math.ceil(val / bultos));
      }

      return copy;
    });
  };

  // Handlers ergonómicos de rotulado y bultos (Micro-Fase 10B)
  const handleToggleRotulado = (idx: number) => {
    setItemsToReceive(prev => {
      const copy = [...prev];
      const current = copy[idx].rotularEtiqueta ?? Boolean(copy[idx].proyectoNombre);
      copy[idx] = { ...copy[idx], rotularEtiqueta: !current };
      return copy;
    });
  };

  const handleBultosChange = (idx: number, bultosVal: number) => {
    setItemsToReceive(prev => {
      const copy = [...prev];
      const item = copy[idx];
      const received = item.cantidadRecibidaHoy ?? item.cantidadRecibida ?? 1;
      const safeBultos = Math.max(1, bultosVal);
      copy[idx] = {
        ...item,
        bultos: safeBultos,
        cantEnBulto: Math.max(1, Math.ceil(received / safeBultos))
      };
      return copy;
    });
  };

  const handleCantEnBultoChange = (idx: number, cantVal: number) => {
    setItemsToReceive(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], cantEnBulto: Math.max(1, cantVal) };
      return copy;
    });
  };

  const handleResetLoteCompleto = (idx: number) => {
    setItemsToReceive(prev => {
      const copy = [...prev];
      const item = copy[idx];
      const received = item.cantidadRecibidaHoy ?? item.cantidadRecibida ?? 1;
      copy[idx] = {
        ...item,
        bultos: 1,
        cantEnBulto: Math.max(1, received)
      };
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
      setValidationError('Por favor indica el Número de Nota de Entrega física o pulsa el botón [Sin Guía (S/N)].');
      return;
    }

    if (itemsToReceive.length === 0) {
      setValidationError('Debe haber al menos un material activo para asentar la recepción.');
      return;
    }
    setValidationError(null);

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
        cantidadRecibida: l.cantidadRecibidaHoy ?? l.cantidadRecibida ?? 0,
        cantidadRecibidaHoy: l.cantidadRecibidaHoy ?? l.cantidadRecibida ?? 0,
        cantidadRecibidaPrevia: l.cantidadRecibidaPrevia || 0,
        backorderPendiente: l.backorderPendiente ?? 0,
        cantidadRechazada: l.cantidadRechazada || 0,
        costoUnitarioUSD: l.costoUnitarioUSD || 0,
        costoAprobadoUSD: l.costoAprobadoUSD || l.costoUnitarioUSD || 0,
        toleranciaExcedente: l.toleranciaExcedente,
        notasDiscrepancia: l.notasDiscrepancia,
        proyectoId: l.proyectoId,
        proyectoNombre: l.proyectoNombre
      }))
    };

    // Preparar etiquetas físicas para impresión (Micro-Fase 10B)
    const generatedLabels: ProjectLabelItem[] = [];
    itemsToReceive.forEach(l => {
      const isRotular = l.rotularEtiqueta ?? Boolean(l.proyectoNombre);
      const receivedToday = l.cantidadRecibidaHoy ?? l.cantidadRecibida ?? 0;
      if (isRotular && receivedToday > 0) {
        const approved = l.cantidadAprobada || l.cantidadSolicitada || receivedToday;
        const prev = l.cantidadRecibidaPrevia || 0;
        const totalCum = prev + receivedToday;
        const isParcial = totalCum < approved;
        const pending = Math.max(0, approved - totalCum);
        const bultos = Math.max(1, l.bultos || 1);
        const cantEnBulto = l.cantEnBulto || Math.ceil(receivedToday / bultos);

        generatedLabels.push({
          id: l.id || `lbl_${l.dashboardId || l.nombre}`,
          insumoId: l.insumoId,
          dashboardId: l.dashboardId,
          nombre: l.nombre,
          codigo: l.codigo,
          categoria: l.categoriaMaterial,
          folioOAB: activeFolio,
          fechaRecepcion,
          proyectoNombre: l.proyectoNombre || 'Stock Fábrica',
          cantidadRecibidaHoy: receivedToday,
          cantidadTotalAprobada: approved,
          backorderPendiente: pending,
          isParcial,
          bultos,
          cantEnBulto
        });
      }
    });
    setLabelsToPrint(generatedLabels);

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
            <div className="pt-2 flex flex-wrap justify-center gap-3">
              {labelsToPrint.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowLabelModal(true)}
                  className="flex items-center gap-2 px-5 py-2 text-xs font-bold rounded-lg bg-emerald-500 hover:bg-emerald-600 text-slate-950 transition shadow active:scale-95"
                >
                  <Tag className="w-4 h-4" />
                  <span>Imprimir Etiquetas de Proyecto ({labelsToPrint.reduce((acc, l) => acc + l.bultos, 0)} bultos)</span>
                </button>
              )}
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
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[10px] uppercase text-slate-400 font-semibold">
                    N° Nota de Entrega / Guía *
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setNotaEntrega('S/N');
                      setValidationError(null);
                    }}
                    className="text-[10px] font-mono font-bold text-cyan-400 hover:text-cyan-300 underline"
                  >
                    Sin Guía (S/N)
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="Ej: NE-9941 / FAC-8201 o S/N"
                  value={notaEntrega}
                  onChange={(e) => {
                    setNotaEntrega(e.target.value);
                    if (validationError) setValidationError(null);
                  }}
                  className={`w-full px-2.5 py-1.5 text-xs font-mono font-bold bg-surface border rounded text-slate-100 placeholder-slate-500 transition ${
                    validationError && !notaEntrega.trim() ? 'border-red-500 ring-1 ring-red-500' : 'border-borderSubtle'
                  }`}
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

            {validationError && (
              <div className="m-3 p-3 bg-red-500/15 border border-red-500/40 rounded-lg text-xs text-red-300 flex items-center justify-between animate-pulse">
                <div className="flex items-center gap-2">
                  <AlertOctagon className="w-4 h-4 text-red-400 shrink-0" />
                  <span>{validationError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setValidationError(null)}
                  className="p-1 text-red-400 hover:text-white rounded"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
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
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 mb-1">
                <span>Materiales a verificar ({itemsToReceive.length}):</span>
                <div className="flex items-center gap-2">
                  {selectedFolio && itemsToReceive.length > 0 && (
                    <button
                      type="button"
                      onClick={handleSetAllRemainingAsNextFreight}
                      className="px-2.5 py-1 text-[11px] font-semibold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded transition active:scale-95"
                      title="Marca todos los ítems en 0 recibidos (quedan pendientes para el próximo flete)"
                    >
                      ⏳ Marcar todos como Próximo Flete
                    </button>
                  )}
                  <span className="text-[11px] text-slate-500 font-mono hidden sm:inline">
                    {itemsToReceive.length > 0 ? 'Indica las unidades físicas que están bajando del camión hoy' : 'Terminal lista para ingreso'}
                  </span>
                </div>
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
                      ? 'Esta orden no tiene renglones pendientes por recibir en este momento.'
                      : 'Usa el buscador superior para agregar los insumos físicos que están ingresando directamente a la planta sin OAB.'}
                  </p>
                </div>
              ) : (
                itemsToReceive.map((item, idx) => {
                  const isFromOAB = Boolean(item.id || (item.cantidadAprobada && item.cantidadAprobada > 0));
                  const approvedQty = isFromOAB ? (item.cantidadAprobada || 0) : 0;
                  const prevRecQty = item.cantidadRecibidaPrevia || 0;
                  const pendingBalance = Math.max(0, approvedQty - prevRecQty);
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
                          {isFromOAB ? (
                            <div className="flex flex-wrap items-center gap-1.5 mt-1 text-xs text-slate-400">
                              <span className="bg-surfaceHigh px-1.5 py-0.5 rounded border border-borderSubtle">
                                Aprobado: <strong className="text-slate-200 font-mono">{approvedQty}</strong>
                              </span>
                              <span className="bg-blue-950/40 px-1.5 py-0.5 rounded border border-blue-500/30 text-blue-300">
                                Recibido Previo: <strong className="font-mono">{prevRecQty}</strong>
                              </span>
                              <span className="bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-500/30 text-amber-300">
                                Saldo Pendiente: <strong className="font-mono">{pendingBalance}</strong>
                              </span>
                              <span className="text-slate-400 font-mono text-[11px] ml-1">
                                @ ${(item.costoAprobadoUSD || item.costoUnitarioUSD || 0).toFixed(2)} USD
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400 ml-2">
                              Ingreso Directo · Stock actual en planta: <strong className="text-slate-200 font-mono">{item.cantidadStock ?? 0} und</strong>
                            </span>
                          )}
                          {item.proyectoNombre && (
                            <span className="text-[10px] text-brand-400 font-mono ml-2">
                              [{item.proyectoNombre}]
                            </span>
                          )}
                        </div>

                        {/* Botones táctiles de acción rápida y eliminación (papelera SOLO para ingreso manual) */}
                        <div className="flex items-center gap-1.5 self-end sm:self-auto">
                          {isFromOAB ? (
                            <>
                              <button
                                type="button"
                                onClick={() => handleSetFull(idx)}
                                className="px-2 py-1 text-[11px] font-semibold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/40 rounded transition active:scale-95"
                                title="Marcar todo el saldo pendiente como recibido"
                              >
                                Todo ({pendingBalance})
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSetNextFreight(idx)}
                                className="px-2 py-1 text-[11px] font-semibold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded transition active:scale-95"
                                title="Marcar como Próximo Flete (0 recibidos hoy, se mantiene el saldo pendiente)"
                              >
                                ⏳ Próx. Flete
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleRemoveItem(idx)}
                              title="Quitar este material de la rampa"
                              className="p-1 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded transition"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleSetZero(idx)}
                            className="px-2 py-1 text-[11px] font-semibold bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/40 rounded transition active:scale-95"
                            title="Registrar como rechazo / 0 recibidos"
                          >
                            0
                          </button>
                        </div>
                      </div>

                    {/* Inputs de Conteo Físico y Valuación */}
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                      <div>
                        <label className="block text-[10px] text-emerald-400 uppercase font-semibold mb-1">
                          Conforme Hoy:
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={item.cantidadRecibidaHoy !== undefined ? item.cantidadRecibidaHoy : item.cantidadRecibida}
                          onChange={(e) => handleQuantityChange(idx, 'cantidadRecibida', Number(e.target.value))}
                          className="w-full px-2.5 py-1 text-center font-mono font-bold text-sm bg-surface border border-emerald-500/40 rounded text-emerald-400"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-red-400 uppercase font-semibold mb-1">
                          Rechazo Hoy:
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

                    {/* Barra Ergonómica de Rotulado de Proyecto / Bultos (Micro-Fase 10B) */}
                    <div className="mt-2.5 pt-2 border-t border-borderSubtle/60 flex flex-wrap items-center justify-between gap-2 bg-surface/50 p-2 rounded">
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-slate-200">
                          <input
                            type="checkbox"
                            checked={item.rotularEtiqueta ?? Boolean(item.proyectoNombre)}
                            onChange={() => handleToggleRotulado(idx)}
                            className="rounded border-borderSubtle text-brand-500 focus:ring-0"
                          />
                          <Tag className="w-3.5 h-3.5 text-brand-400" />
                          <span>Rotular Etiqueta</span>
                        </label>
                        {item.proyectoNombre ? (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-brand-500/20 text-brand-300 border border-brand-500/30 font-bold">
                            Obra: {item.proyectoNombre}
                          </span>
                        ) : (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                            📦 Stock Fábrica
                          </span>
                        )}
                      </div>

                      {(item.rotularEtiqueta ?? Boolean(item.proyectoNombre)) && (
                        <div className="flex items-center gap-2 text-xs">
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-slate-400 uppercase font-semibold">Bultos:</span>
                            <input
                              type="number"
                              min="1"
                              max="99"
                              value={item.bultos || 1}
                              onChange={(e) => handleBultosChange(idx, Math.max(1, parseInt(e.target.value) || 1))}
                              className="w-12 px-1.5 py-0.5 text-center font-mono font-bold text-xs bg-surface border border-borderSubtle rounded text-slate-100"
                            />
                          </div>

                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-slate-400 uppercase font-semibold">Cant/Bulto:</span>
                            <input
                              type="number"
                              min="1"
                              value={item.cantEnBulto || Math.ceil((item.cantidadRecibidaHoy ?? item.cantidadRecibida ?? 1) / (item.bultos || 1))}
                              onChange={(e) => handleCantEnBultoChange(idx, Math.max(1, parseInt(e.target.value) || 1))}
                              className="w-16 px-1.5 py-0.5 text-center font-mono font-bold text-xs bg-surface border border-borderSubtle rounded text-emerald-400"
                            />
                            <span className="text-[10px] text-slate-500 font-mono">und</span>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleResetLoteCompleto(idx)}
                            className="px-2 py-0.5 text-[10px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded transition active:scale-95"
                            title="1 Etiqueta por el lote total recibido"
                          >
                            1 Lote Completo
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              }))}

              {/* Acordeón informativo de insumos completados en fletes previos */}
              {completedLines.length > 0 && (
                <div className="mt-4 border border-emerald-500/30 rounded-lg overflow-hidden bg-emerald-950/10">
                  <button
                    type="button"
                    onClick={() => setShowCompletedAccordion(prev => !prev)}
                    className="w-full px-4 py-2 flex items-center justify-between text-xs font-semibold text-emerald-400 hover:bg-emerald-950/20 transition"
                  >
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span>{completedLines.length} insumo(s) completados al 100% en fletes anteriores</span>
                    </div>
                    <span className="text-[11px] underline">
                      {showCompletedAccordion ? 'Ocultar' : 'Ver detalle'}
                    </span>
                  </button>
                  {showCompletedAccordion && (
                    <div className="p-3 border-t border-emerald-500/20 space-y-1.5 bg-surface/50">
                      {completedLines.map((cItem, cIdx) => (
                        <div key={cItem.id || cIdx} className="flex items-center justify-between text-xs py-1 px-2 rounded bg-surface border border-borderSubtle">
                          <span className="text-slate-200 font-medium">{cItem.nombre}</span>
                          <span className="font-mono text-emerald-400 font-bold">
                            {cItem.cantidadAprobada} und recibidas ✓
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
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

      {showLabelModal && (
        <PrintSheetProjectLabels
          items={labelsToPrint}
          onClose={() => setShowLabelModal(false)}
        />
      )}
    </div>
  );
};
