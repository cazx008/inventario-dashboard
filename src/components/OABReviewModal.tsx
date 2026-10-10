import React, { useState, useEffect, useRef } from 'react';
import {
  ClipboardCheck,
  X,
  Search,
  CheckCircle2,
  AlertTriangle,
  Building2,
  Calendar,
  FileText,
  ArrowRight,
  DollarSign,
  Camera,
  Image as ImageIcon,
  Trash2,
  Ban,
  FolderKanban
} from 'lucide-react';
import {
  OABReviewDetails,
  OABReviewLine,
  fetchPendingOABs,
  fetchOABDetails,
  submitOABReview,
  cancelOAB,
  uploadEvidenceToR2
} from '../services/oabService';
import { OrderSearchModal } from './OrderSearchModal';
import { OrderReference } from '../types/oab';


interface OABReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  bcvRate: number;
  initialFolio?: string;
  onReviewSuccess?: () => void;
}

export const OABReviewModal: React.FC<OABReviewModalProps> = ({
  isOpen,
  onClose,
  bcvRate,
  initialFolio,
  onReviewSuccess
}) => {
  const [pendingOrders, setPendingOrders] = useState<any[]>([]);
  const [selectedFolio, setSelectedFolio] = useState(initialFolio || '');
  const [manualFolioInput, setManualFolioInput] = useState(initialFolio || '');
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [details, setDetails] = useState<OABReviewDetails | null>(null);

  // Form Fields
  const [proveedorNombre, setProveedorNombre] = useState('');
  const [numeroCotizacion, setNumeroCotizacion] = useState('');
  const [fechaEstimadaEntrega, setFechaEstimadaEntrega] = useState('');
  const [notasCompras, setNotasCompras] = useState('');
  const [lines, setLines] = useState<OABReviewLine[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState<any | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Comprobante firmado de Magaly (Hoja Viajera Carta)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Modal y estado de Anulación
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  // Selector de Obra / Pedido MTO (Fase 11.3)
  const [activeLineForOrder, setActiveLineForOrder] = useState<string | null>(null);
  const [isOrderSearchOpen, setIsOrderSearchOpen] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const [cancelSuccess, setCancelSuccess] = useState<string | null>(null);

  // Token de control para mitigar carreras asíncronas
  const activeRequestRef = useRef<string>('');

  // Cargar lista de órdenes pendientes al abrir
  useEffect(() => {
    if (!isOpen) return;
    setSubmitSuccess(null);
    setCancelSuccess(null);
    setErrorMessage(null);
    setDetails(null);
    setPhotoPreview(null);
    setShowCancelModal(false);
    setCancelReason('');
    const targetFolio = (initialFolio || '').trim();
    setSelectedFolio(targetFolio);
    setManualFolioInput(targetFolio);

    setLoadingOrders(true);
    fetchPendingOABs().then(orders => {
      setPendingOrders(orders);
      if (targetFolio) {
        handleSelectFolio(targetFolio);
      } else if (orders.length > 0) {
        handleSelectFolio(orders[0].folio);
      }
    }).finally(() => setLoadingOrders(false));
  }, [isOpen, initialFolio]);

  const handleSelectFolio = async (folioToLoad: string) => {
    if (!folioToLoad) return;
    const cleanFolio = folioToLoad.trim();
    setSelectedFolio(cleanFolio);
    setManualFolioInput(cleanFolio);
    setLoadingDetails(true);
    setErrorMessage(null);
    activeRequestRef.current = cleanFolio;

    try {
      const data = await fetchOABDetails(cleanFolio);
      // Descartar si el usuario seleccionó otra orden mientras respondía Notion
      if (activeRequestRef.current !== cleanFolio) {
        return;
      }
      if (data) {
        setDetails(data);
        setProveedorNombre(data.oab.proveedor || '');
        setNumeroCotizacion(data.oab.cotizacion || '');
        setFechaEstimadaEntrega(data.oab.fechaEstimadaEntrega || '');
        setNotasCompras(data.oab.notasCompras || '');
        setLines(data.lines);
      }
    } catch (err: any) {
      if (activeRequestRef.current === cleanFolio) {
        setErrorMessage(err.message || 'Error cargando detalles de la OAB');
        setDetails(null);
      }
    } finally {
      if (activeRequestRef.current === cleanFolio) {
        setLoadingDetails(false);
      }
    }
  };

  const handleLineQtyChange = (solicitudId: string, newQty: number) => {
    setLines(prev => prev.map(l => {
      if (l.solicitudId !== solicitudId) return l;
      const validQty = Math.max(0, newQty);
      return {
        ...l,
        cantidadAprobada: validQty,
        subtotalUSD: validQty * (l.costoUnitarioUSD || 0)
      };
    }));
  };

  const handleLineCostChange = (solicitudId: string, newCost: number) => {
    setLines(prev => prev.map(l => {
      if (l.solicitudId !== solicitudId) return l;
      const validCost = Math.max(0, newCost);
      return {
        ...l,
        costoUnitarioUSD: validCost,
        subtotalUSD: (l.cantidadAprobada || 0) * validCost
      };
    }));
  };

  const handleApproveAll = () => {
    setLines(prev => prev.map(l => ({
      ...l,
      cantidadAprobada: l.cantidadSolicitada,
      subtotalUSD: l.cantidadSolicitada * (l.costoUnitarioUSD || 0)
    })));
  };

  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        setPhotoPreview(base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCancelOAB = async () => {
    if (!details) return;
    if (!cancelReason.trim() || cancelReason.trim().length < 5) {
      alert('Debe especificar un motivo justificativo de al menos 5 caracteres.');
      return;
    }

    setIsCanceling(true);
    try {
      await cancelOAB({
        folioOAB: details.oab.folio,
        oabId: details.oab.id,
        motivoCancelacion: cancelReason.trim()
      });
      setCancelSuccess(`La orden ${details.oab.folio} fue anulada formalmente.`);
      setShowCancelModal(false);
      if (onReviewSuccess) onReviewSuccess();
    } catch (err: any) {
      alert(`Error anulando OAB: ${err.message}`);
    } finally {
      setIsCanceling(false);
    }
  };

  const allLinesZero = lines.length > 0 && lines.every(l => (l.cantidadAprobada || 0) === 0);
  const totalAprobadoUSD = lines.reduce((acc, l) => acc + (l.subtotalUSD || 0), 0);
  const totalAprobadoBs = totalAprobadoUSD * (bcvRate || 36.50);

  const handleSubmit = async () => {
    if (!details) return;

    if (allLinesZero) {
      setErrorMessage('No puede pasar a "En Compra" una orden con todas las líneas en cero. Si la gerencia rechazó la requisición, anule la OAB formalmente.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      let r2Url: string | undefined = undefined;
      if (photoPreview) {
        try {
          r2Url = await uploadEvidenceToR2(details.oab.folio, 'HOJA-MAGALY', photoPreview);
        } catch (uploadErr) {
          console.warn('Subida de foto a R2 no completada, continuando con revisión:', uploadErr);
        }
      }

      const payload = {
        oabId: details.oab.id,
        folioOAB: details.oab.folio,
        proveedorNombre,
        numeroCotizacion,
        fechaEstimadaEntrega,
        notasCompras,
        comprobanteUrl: r2Url,
        lineas: lines.map(l => ({
          solicitudId: l.solicitudId,
          dashboardId: l.dashboardId,
          insumoId: l.insumoId,
          nombre: l.nombre,
          pedidoId: l.pedidoId,
          proyectoId: l.proyectoId,
          proyectoNombre: l.proyectoNombre,
          cantidadAprobada: l.cantidadAprobada,
          costoUnitarioUSD: l.costoUnitarioUSD
        }))
      };

      const res = await submitOABReview(payload);
      setSubmitSuccess(res);
      if (onReviewSuccess) onReviewSuccess();
    } catch (err: any) {
      setErrorMessage(err.message || 'Error guardando transcripción de OAB');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-4 no-print">
      <div className="bg-surface border border-borderSubtle rounded-xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
        
        {/* Header */}
        <div className="px-5 py-3 bg-surfaceHigh border-b border-borderSubtle flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/40">
              <ClipboardCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100 tracking-tight flex items-center gap-2">
                <span>Puente Papel-Digital: Revisión & Transcripción OAB</span>
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  GERENCIA & COMPRAS
                </span>
              </h2>
              <p className="text-[11px] text-slate-400">
                Digitalización de vistos buenos de Magaly y registro de cotizaciones antes de la descarga en rampa
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

        {cancelSuccess ? (
          // Vista de Anulación Exitosa
          <div className="p-8 text-center space-y-4 max-w-lg mx-auto my-auto">
            <div className="w-16 h-16 rounded-full bg-red-500/20 text-red-400 border border-red-500/40 flex items-center justify-center mx-auto">
              <Ban className="w-10 h-10" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-100">
                Orden Anulada con Éxito
              </h3>
              <p className="text-xs text-slate-300 mt-1 font-mono">
                {cancelSuccess}
              </p>
              <p className="text-xs text-slate-500 mt-2">
                La orden y sus renglones quedaron cancelados en Notion, se liberó el inventario y se emitió la alerta a Telegram.
              </p>
            </div>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-surfaceHigh hover:bg-surfaceHighest text-slate-200 font-bold rounded-lg text-xs"
            >
              Cerrar y Volver al Dashboard
            </button>
          </div>
        ) : submitSuccess ? (
          // Vista de Éxito
          <div className="p-8 text-center space-y-4 max-w-lg mx-auto my-auto">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-100">
                ¡Orden Transcrita y Puesta 'En Compra'!
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Folio <span className="font-mono text-brand-400 font-bold">{submitSuccess.folioOAB}</span> actualizado en Notion. Total aprobado: ${submitSuccess.totalAprobadoUSD.toFixed(2)} USD.
              </p>
              <p className="text-xs text-slate-500 mt-2">
                La orden está lista para ser recibida en rampa por Almacén en cuanto llegue el transporte.
              </p>
            </div>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-brand-500 hover:bg-brand-400 text-slate-950 font-bold rounded-lg text-xs"
            >
              Cerrar y Volver al Dashboard
            </button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Barra de Selección de OAB */}
            <div className="p-3 bg-page rounded-lg border border-borderSubtle flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-1 min-w-[280px]">
                <label className="text-xs text-slate-400 font-semibold whitespace-nowrap">
                  Seleccionar OAB Pendiente:
                </label>
                <select
                  value={selectedFolio}
                  onChange={(e) => handleSelectFolio(e.target.value)}
                  className="flex-1 bg-surface border border-borderSubtle text-brand-400 font-mono text-xs px-2.5 py-1.5 rounded"
                  disabled={loadingOrders || loadingDetails}
                >
                  {pendingOrders.length === 0 ? (
                    <option value="">No hay órdenes pendientes en Notion</option>
                  ) : (
                    pendingOrders.map(o => (
                      <option key={o.id} value={o.folio}>
                        {o.folio} — {o.estadoGeneral} ({o.fechaEmision}) · ${Number(o.totalUSD || 0).toFixed(2)} USD
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Digitar folio o escanear QR..."
                  value={manualFolioInput}
                  onChange={(e) => setManualFolioInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !loadingDetails && handleSelectFolio(manualFolioInput)}
                  disabled={loadingOrders || loadingDetails}
                  className="bg-surface border border-borderSubtle text-xs px-2.5 py-1.5 rounded font-mono text-slate-200 w-48 disabled:opacity-50"
                />
                <button
                  onClick={() => handleSelectFolio(manualFolioInput)}
                  disabled={loadingOrders || loadingDetails}
                  className="px-3 py-1.5 bg-surfaceHigh hover:bg-surfaceHighest disabled:opacity-50 text-slate-300 text-xs rounded border border-borderSubtle flex items-center gap-1"
                >
                  <Search className="w-3.5 h-3.5" />
                  Buscar
                </button>
              </div>
            </div>

            {loadingDetails && (
              <div className="space-y-4 p-2 animate-pulse">
                {/* Skeleton Header Form */}
                <div className="p-4 bg-surfaceHigh/40 rounded-xl border border-borderSubtle/60 grid grid-cols-1 sm:grid-cols-4 gap-3">
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} className="space-y-2">
                      <div className="h-2.5 bg-slate-700/50 rounded w-24"></div>
                      <div className="h-8 bg-slate-800/80 rounded-lg border border-slate-700/30"></div>
                    </div>
                  ))}
                </div>

                {/* Skeleton Table Lines */}
                <div className="border border-borderSubtle/60 rounded-xl overflow-hidden bg-surface">
                  <div className="h-10 bg-surfaceHigh/60 border-b border-borderSubtle/60 flex items-center justify-between px-4">
                    <div className="h-3 bg-slate-700/60 rounded w-32"></div>
                    <div className="h-3 bg-slate-700/60 rounded w-48"></div>
                  </div>
                  <div className="divide-y divide-borderSubtle/30 p-2 space-y-2">
                    {[1, 2, 3, 4].map(i => (
                      <div key={i} className="flex items-center justify-between gap-4 py-2.5 px-3">
                        <div className="space-y-1.5 flex-1">
                          <div className="h-4 bg-slate-700/60 rounded w-2/5"></div>
                          <div className="h-2.5 bg-slate-800/80 rounded w-1/4"></div>
                        </div>
                        <div className="h-4 bg-slate-700/40 rounded w-16"></div>
                        <div className="h-7 bg-slate-800/90 rounded w-24 border border-slate-700/30"></div>
                        <div className="h-7 bg-slate-800/90 rounded w-20 border border-slate-700/30"></div>
                        <div className="h-4 bg-slate-700/60 rounded w-16"></div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="text-center text-[11px] text-slate-500 font-mono">
                  Sincronizando líneas de la orden desde Notion ERP...
                </div>
              </div>
            )}

            {errorMessage && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {details && !loadingDetails && (
              <>
                {/* Adjuntar Foto de Hoja Viajera Carta Firmada */}
                <div className="p-3 bg-surfaceHigh/60 rounded-lg border border-borderSubtle flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded bg-surface text-amber-400 border border-borderSubtle">
                      <Camera className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-slate-200 font-semibold flex items-center gap-2">
                        <span>Hoja Viajera Carta Firmada (Magaly)</span>
                        {photoPreview && (
                          <span className="text-[10px] text-emerald-400 font-mono bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/30">
                            ✓ Documento Listo
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Sube o fotografía la hoja física Carta con los vistos buenos manuscritos para auditoría
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {photoPreview ? (
                      <div className="flex items-center gap-2">
                        <img
                          src={photoPreview}
                          alt="Comprobante Magaly"
                          className="w-9 h-9 rounded object-cover border border-amber-500/40 shadow"
                        />
                        <button
                          type="button"
                          onClick={() => setPhotoPreview(null)}
                          className="p-1.5 rounded bg-red-950/40 hover:bg-red-900/50 text-red-400 border border-red-500/40"
                          title="Eliminar foto"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="px-3 py-1.5 bg-surface hover:bg-surfaceHighest text-slate-200 text-xs rounded border border-borderSubtle flex items-center gap-1.5 transition"
                      >
                        <Camera className="w-3.5 h-3.5 text-amber-400" />
                        <span>Subir Hoja Firmada</span>
                      </button>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      ref={fileInputRef}
                      onChange={handlePhotoCapture}
                      className="hidden"
                    />
                  </div>
                </div>

                {/* Formulario de Compras */}
                <div className="p-3 bg-surfaceHigh/60 rounded-lg border border-borderSubtle grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <label className="block text-[10px] uppercase text-slate-400 font-semibold mb-1">
                      Proveedor Adjudicado
                    </label>
                    <input
                      type="text"
                      placeholder="Ej: Distribuidora Hierros C.A."
                      value={proveedorNombre}
                      onChange={(e) => setProveedorNombre(e.target.value)}
                      className="w-full bg-surface border border-borderSubtle rounded px-2.5 py-1.5 text-xs text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase text-slate-400 font-semibold mb-1">
                      N° Cotización / Pre-Factura
                    </label>
                    <input
                      type="text"
                      placeholder="Ej: COT-2026-904"
                      value={numeroCotizacion}
                      onChange={(e) => setNumeroCotizacion(e.target.value)}
                      className="w-full bg-surface border border-borderSubtle rounded px-2.5 py-1.5 text-xs font-mono text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase text-slate-400 font-semibold mb-1">
                      Fecha Estimada de Entrega
                    </label>
                    <input
                      type="date"
                      value={fechaEstimadaEntrega}
                      onChange={(e) => setFechaEstimadaEntrega(e.target.value)}
                      className="w-full bg-surface border border-borderSubtle rounded px-2.5 py-1.5 text-xs font-mono text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase text-slate-400 font-semibold mb-1">
                      Notas Comerciales
                    </label>
                    <input
                      type="text"
                      placeholder="Condiciones de pago, flete..."
                      value={notasCompras}
                      onChange={(e) => setNotasCompras(e.target.value)}
                      className="w-full bg-surface border border-borderSubtle rounded px-2.5 py-1.5 text-xs text-slate-200"
                    />
                  </div>
                </div>

                {/* Acciones Rápidas de Aprobación */}
                <div className="flex items-center justify-between text-xs pt-1">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">Renglones a transcribir:</span>
                    <span className="font-mono font-bold text-slate-200">{lines.length}</span>
                  </div>
                  <button
                    onClick={handleApproveAll}
                    className="text-xs text-brand-400 hover:text-brand-300 underline font-medium"
                  >
                    ✓ Aprobar todo tal como se solicitó
                  </button>
                </div>

                {/* Tabla de Renglones para Transcripción */}
                <div className="border border-borderSubtle rounded-lg overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-surfaceHigh text-slate-400 border-b border-borderSubtle font-mono text-[11px]">
                      <tr>
                        <th className="py-2 px-3">Insumo</th>
                        <th className="py-2 px-3 text-center">Destino MTO / Obra</th>
                        <th className="py-2 px-3 text-right">Cant. Solicitada</th>
                        <th className="py-2 px-3 text-center">V°B° Magaly (Cant. Aprobada)</th>
                        <th className="py-2 px-3 text-right">P. Unit ($)</th>
                        <th className="py-2 px-3 text-right">Subtotal ($)</th>
                        <th className="py-2 px-3 text-center">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-borderSubtle/40 bg-surface">
                      {lines.map((line, idx) => {
                        const isAdjusted = line.cantidadAprobada !== line.cantidadSolicitada;
                        const isRejected = line.cantidadAprobada === 0;

                        return (
                          <tr key={line.solicitudId} className="hover:bg-surfaceHighest/40">
                            <td className="py-2.5 px-3">
                              <div className="font-medium text-slate-200">{line.nombre}</div>
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              {line.proyectoNombre ? (
                                <div className="inline-flex items-center gap-1.5 bg-brand-500/10 border border-brand-500/30 px-2 py-0.5 rounded text-left">
                                  <span className="text-[10px] text-brand-300 font-mono font-bold max-w-[150px] truncate" title={line.proyectoNombre}>
                                    {line.proyectoNombre}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActiveLineForOrder(line.solicitudId);
                                      setIsOrderSearchOpen(true);
                                    }}
                                    className="p-0.5 text-slate-400 hover:text-white rounded hover:bg-surfaceHighest transition"
                                    title="Cambiar obra o pedido"
                                  >
                                    <FolderKanban className="w-3.5 h-3.5 text-brand-400" />
                                  </button>
                                </div>
                              ) : (
                                <div className="inline-flex items-center gap-1.5 bg-slate-800/80 border border-slate-700 px-2 py-0.5 rounded">
                                  <span className="text-[10px] text-slate-400 font-mono">
                                    📦 Stock Fábrica
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActiveLineForOrder(line.solicitudId);
                                      setIsOrderSearchOpen(true);
                                    }}
                                    className="px-1.5 py-0.5 text-[9px] text-brand-400 hover:text-brand-300 rounded border border-brand-500/30 bg-brand-500/10 transition"
                                    title="Asignar a un pedido o tienda"
                                  >
                                    + Asignar
                                  </button>
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-slate-400">
                              {line.cantidadSolicitada}
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="flex items-center justify-center gap-1.5">
                                <input
                                  type="number"
                                  min="0"
                                  value={line.cantidadAprobada}
                                  onChange={(e) => handleLineQtyChange(line.solicitudId, Number(e.target.value))}
                                  className={`w-20 px-2 py-1 text-center font-mono font-bold text-xs rounded border ${
                                    isRejected
                                      ? 'bg-red-950/40 border-red-500/50 text-red-300'
                                      : isAdjusted
                                      ? 'bg-amber-950/40 border-amber-500/50 text-amber-300'
                                      : 'bg-page border-borderSubtle text-emerald-400'
                                  }`}
                                />
                                <button
                                  type="button"
                                  onClick={() => handleLineQtyChange(line.solicitudId, line.cantidadSolicitada)}
                                  title="Aprobar todo"
                                  className="px-1.5 py-0.5 text-[10px] bg-surfaceHigh hover:bg-surfaceHighest rounded text-slate-300"
                                >
                                  Todo
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleLineQtyChange(line.solicitudId, 0)}
                                  title="Tachar / Rechazar"
                                  className="px-1.5 py-0.5 text-[10px] bg-red-900/30 hover:bg-red-800/40 rounded text-red-300"
                                >
                                  0
                                </button>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={line.costoUnitarioUSD}
                                onChange={(e) => handleLineCostChange(line.solicitudId, Number(e.target.value))}
                                className="w-16 px-2 py-1 text-right font-mono text-xs bg-page border border-borderSubtle rounded text-slate-200"
                              />
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-200">
                              ${line.subtotalUSD.toFixed(2)}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              {isRejected ? (
                                <span className="inline-block px-2 py-0.5 rounded text-[10px] bg-red-500/20 text-red-400 border border-red-500/30 font-medium">
                                  Tachado
                                </span>
                              ) : isAdjusted ? (
                                <span className="inline-block px-2 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30 font-medium">
                                  Ajustado
                                </span>
                              ) : (
                                <span className="inline-block px-2 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-medium">
                                  Aprobado
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Advertencia preventiva si todas las líneas están en cero */}
                {allLinesZero && (
                  <div className="p-3 bg-red-500/10 border border-red-500/40 rounded-lg text-xs text-red-300 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                      <span>Todos los renglones están tachados / en 0. Si la gerencia rechazó la requisición, anule la OAB formalmente.</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowCancelModal(true)}
                      className="px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white font-bold rounded text-[11px] flex items-center gap-1 shadow"
                    >
                      <Ban className="w-3.5 h-3.5" />
                      <span>Anular OAB Ahora</span>
                    </button>
                  </div>
                )}

                {/* Resumen de Totales */}
                <div className="p-3 bg-page rounded-lg border border-borderSubtle flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="space-y-0.5">
                    <div className="text-slate-400">
                      Total Aprobado por Magaly:
                    </div>
                    <div className="text-base font-bold text-emerald-400 font-mono">
                      ${totalAprobadoUSD.toFixed(2)} USD
                      <span className="text-xs text-amber-300 font-normal ml-2">
                        (Bs {totalAprobadoBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} BCV)
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowCancelModal(true)}
                      className="px-3 py-2 text-xs text-red-400 hover:text-red-300 hover:bg-red-950/40 border border-red-500/30 rounded flex items-center gap-1.5 transition"
                    >
                      <Ban className="w-3.5 h-3.5" />
                      <span>Anular OAB</span>
                    </button>
                    <button
                      onClick={onClose}
                      className="px-3.5 py-2 text-xs text-slate-400 hover:text-slate-200 rounded"
                    >
                      Cerrar
                    </button>
                    <button
                      onClick={handleSubmit}
                      disabled={isSubmitting || lines.length === 0 || allLinesZero}
                      className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs flex items-center gap-1.5 transition disabled:opacity-50"
                    >
                      {isSubmitting ? (
                        <span>Guardando en Notion...</span>
                      ) : (
                        <>
                          <ClipboardCheck className="w-4 h-4" />
                          <span>Asentar Transcripción y Pasar a 'En Compra'</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Modal Interactivo de Anulación Soberana */}
        {showCancelModal && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
            <div className="bg-surface border border-red-500/60 rounded-xl p-5 max-w-md w-full space-y-4 shadow-2xl animate-in fade-in">
              <div className="flex items-center gap-2 text-red-400 font-bold text-sm">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <span>Anulación Soberana de Orden de Abastecimiento</span>
              </div>
              <p className="text-xs text-slate-300">
                ¿Estás seguro de que deseas anular la orden <strong className="font-mono text-amber-400">{details?.oab.folio}</strong>?
                Esta acción marcará como cancelada la cabecera y todas sus líneas en Notion, emitirá una alerta a Telegram y garantizará tránsito cero.
              </p>
              <div>
                <label className="block text-[11px] uppercase text-slate-400 font-semibold mb-1">
                  Motivo Obligatorio de Anulación:
                </label>
                <textarea
                  rows={3}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Ej: Rechazada por Gerencia Magaly por falta de presupuesto o cambio de diseño..."
                  className="w-full bg-page border border-borderSubtle text-xs p-2.5 rounded text-slate-200 focus:border-red-500 focus:outline-none"
                />
                <div className="text-[10px] text-slate-500 mt-1">Mínimo 5 caracteres requeridos para trazabilidad forense.</div>
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCancelModal(false)}
                  className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200"
                  disabled={isCanceling}
                >
                  Regresar
                </button>
                <button
                  type="button"
                  onClick={handleCancelOAB}
                  disabled={isCanceling || cancelReason.trim().length < 5}
                  className="px-4 py-1.5 bg-red-600 hover:bg-red-500 text-white font-bold text-xs rounded transition disabled:opacity-50 flex items-center gap-1.5"
                >
                  {isCanceling ? 'Anulando en Notion...' : 'Confirmar Anulación'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal de Búsqueda y Asignación de Pedido / Obra MTO (Fase 11.3) */}
        {isOrderSearchOpen && (
          <OrderSearchModal
            isOpen={isOrderSearchOpen}
            onClose={() => {
              setIsOrderSearchOpen(false);
              setActiveLineForOrder(null);
            }}
            onSelectOrder={(order: OrderReference) => {
              if (activeLineForOrder) {
                setLines(prev => prev.map(l => {
                  if (l.solicitudId === activeLineForOrder) {
                    return {
                      ...l,
                      pedidoId: order.id,
                      proyectoId: order.proyectoId || order.id,
                      proyectoNombre: `${order.codigo} - ${order.proyecto}`
                    };
                  }
                  return l;
                }));
              }
              setIsOrderSearchOpen(false);
              setActiveLineForOrder(null);
            }}
          />
        )}

      </div>
    </div>
  );
};

