/**
 * Modal Centrado Flotante: Modo Pistola de Código de Barras 'Zero-Mouse' (Fase 9J)
 * Archivo: src/components/BarcodeCollectorModal.tsx
 * Sanesca PRO — Inventario Industrial
 * 
 * Diseñado para pasillo de almacén: alta concentración visual con backdrop oscuro,
 * flujo de escaneo continuo con salto automático y teclado numérico sin ratón,
 * alerta no bloqueante ante códigos no encontrados, y bandeja de firma en lote con PIN.
 */

import React, { useState, useEffect, useRef } from 'react';
import { InventoryItem } from '../types/inventory';
import {
  ScannerQueueItem,
  enqueueScannedItem,
  approveSupervisorBatch,
  removeQueueItem,
  subscribeQueue,
  CRITICAL_DELTA_THRESHOLD,
  CRITICAL_IMPACT_THRESHOLD_USD
} from '../services/scannerQueueService';
import { playScanBeep, playWarningTone } from '../services/audioFeedback';

interface BarcodeCollectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: InventoryItem[];
  tasaBCV: number;
}

export const BarcodeCollectorModal: React.FC<BarcodeCollectorModalProps> = ({
  isOpen,
  onClose,
  items,
  tasaBCV
}) => {
  // Estados de escaneo activo
  const [barcodeInput, setBarcodeInput] = useState('');
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [countedQty, setCountedQty] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);

  // Estados de la cola y supervisor
  const [queue, setQueue] = useState<ScannerQueueItem[]>([]);
  const [activeTab, setActiveTab] = useState<'scan' | 'pending' | 'queue'>('scan');
  const [supervisorPin, setSupervisorPin] = useState('');
  const [batchJustificacion, setBatchJustificacion] = useState('Aprobación en lote por cierre de pasillo');
  const [selectedPendingIds, setSelectedPendingIds] = useState<string[]>([]);
  const [isApprovingBatch, setIsApprovingBatch] = useState(false);
  const [batchSuccessMsg, setBatchSuccessMsg] = useState<string | null>(null);

  // Referencias a inputs para flujo Zero-Mouse
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const countInputRef = useRef<HTMLInputElement>(null);
  const errorTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Suscripción reactiva a la cola FIFO
  useEffect(() => {
    const unsubscribe = subscribeQueue((newQueue) => {
      setQueue(newQueue);
    });
    return unsubscribe;
  }, []);

  // Foco automático al abrir modal
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        barcodeInputRef.current?.focus();
      }, 100);
    } else {
      setSelectedItem(null);
      setBarcodeInput('');
      setCountedQty('');
      setInputError(null);
    }
  }, [isOpen]);

  // Limpieza de timeouts al desmontar
  useEffect(() => {
    return () => {
      if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
    };
  }, []);

  // Separación de estados de la cola
  const pendingItems = queue.filter(q => q.status === 'PENDIENTE_FIRMA');
  const activeQueueItems = queue.filter(q => q.status === 'ENCOLADO' || q.status === 'PROCESANDO');
  const errorItems = queue.filter(q => q.status === 'ERROR');

  // Mantener IDs de pendientes seleccionados por defecto
  useEffect(() => {
    setSelectedPendingIds(pendingItems.map(p => p.id));
  }, [pendingItems.length]);

  if (!isOpen) return null;

  // Resolución unívoca de insumo
  function findItemByCode(code: string): InventoryItem | undefined {
    const clean = code.trim().toLowerCase();
    if (!clean) return undefined;

    // 1. Por código explícito
    let found = items.find(i => i.codigo && i.codigo.trim().toLowerCase() === clean);
    if (found) return found;

    // 2. Por ID de insumo o ID de dashboard
    found = items.find(i => i.id.toLowerCase() === clean || (i.insumoId && i.insumoId.toLowerCase() === clean));
    if (found) return found;

    // 3. Por código entre corchetes en el nombre (ej: [DIS-007])
    found = items.find(i => {
      const match = i.nombre.match(/\[(.*?)\]/);
      return match && match[1].trim().toLowerCase() === clean;
    });
    if (found) return found;

    // 4. Por prefijo entre corchetes
    found = items.find(i => i.nombre.toLowerCase().startsWith(`[${clean}]`));
    if (found) return found;

    // 5. Coincidencia directa en texto
    found = items.find(i => i.nombre.toLowerCase().includes(clean));
    return found;
  }

  // Manejo de lectura de pistola (Enter al final del código de barras)
  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcodeInput.trim()) return;

    const matched = findItemByCode(barcodeInput);

    if (!matched) {
      // Alerta acústica 220Hz + destello visual rojo
      playWarningTone();
      setInputError(`Código "${barcodeInput}" no encontrado en catálogo`);
      setBarcodeInput('');

      // Auto-limpiar error tras 1.5s sin bloquear el foco
      if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
      errorTimeoutRef.current = setTimeout(() => {
        setInputError(null);
        barcodeInputRef.current?.focus();
      }, 1500);
      return;
    }

    // Material encontrado con éxito: sonido agudo 880Hz y auto-foco en cantidad
    playScanBeep();
    setSelectedItem(matched);
    setInputError(null);
    setCountedQty('');

    // Salto automático de foco al input de cantidad física
    setTimeout(() => {
      countInputRef.current?.focus();
    }, 50);
  };

  // Encolado tras ingresar cantidad física ('Enter' en teclado numérico)
  const handleCountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem || countedQty === '') return;

    const qty = parseFloat(countedQty);
    if (isNaN(qty) || qty < 0) {
      playWarningTone();
      setInputError('Ingrese una cantidad válida');
      return;
    }

    // Encolar al buffer FIFO
    await enqueueScannedItem({
      dashboardId: selectedItem.id,
      insumoId: selectedItem.insumoId,
      nombre: selectedItem.nombre,
      unidad: selectedItem.unidad || 'UND',
      conteoFisico: qty,
      stockActual: selectedItem.stockBase || 0,
      costoUnitarioUSD: selectedItem.costoUnitarioUSD || 0,
      tasaBCV,
      motivo: 'Diferencia de Conteo Cíclico',
      justificacion: 'Conteo en ráfaga vía Pistola Zero-Mouse',
    });

    // Resetear inmediatamente para el siguiente escaneo (Zero-Mouse)
    setSelectedItem(null);
    setBarcodeInput('');
    setCountedQty('');
    setInputError(null);

    // Regresar el foco al lector
    setTimeout(() => {
      barcodeInputRef.current?.focus();
    }, 50);
  };

  // Cancelar selección actual y volver al lector
  const handleCancelSelection = () => {
    setSelectedItem(null);
    setBarcodeInput('');
    setCountedQty('');
    setInputError(null);
    barcodeInputRef.current?.focus();
  };

  // Aprobación en bloque por supervisor con PIN
  const handleApproveBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supervisorPin || supervisorPin.length < 4) {
      playWarningTone();
      return;
    }

    setIsApprovingBatch(true);
    setBatchSuccessMsg(null);

    try {
      const count = await approveSupervisorBatch(
        supervisorPin,
        batchJustificacion,
        selectedPendingIds
      );
      setBatchSuccessMsg(`¡${count} ajustes autorizados y despachados al buffer FIFO!`);
      setSupervisorPin('');
      setTimeout(() => {
        setBatchSuccessMsg(null);
        if (pendingItems.length <= count) {
          setActiveTab('scan');
          barcodeInputRef.current?.focus();
        }
      }, 2000);
    } finally {
      setIsApprovingBatch(false);
    }
  };

  // Cálculos dinámicos del ítem seleccionado
  const parsedQty = parseFloat(countedQty);
  const currentDelta = !isNaN(parsedQty) && selectedItem ? parsedQty - (selectedItem.stockBase || 0) : 0;
  const unitCost = selectedItem?.costoUnitarioUSD || 0;
  const currentImpactUSD = currentDelta * unitCost;
  const isCriticalSelected =
    Math.abs(currentDelta) > CRITICAL_DELTA_THRESHOLD ||
    Math.abs(currentImpactUSD) > CRITICAL_IMPACT_THRESHOLD_USD;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-4xl bg-slate-900 border-2 border-emerald-500/50 rounded-2xl shadow-2xl shadow-emerald-950/50 flex flex-col max-h-[92vh] overflow-hidden text-slate-100">
        
        {/* Cabecera Industrial */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-950 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <span className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl text-xl">
              📟
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold tracking-wide text-white">
                  Modo Pistola 'Zero-Mouse'
                </h2>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 animate-pulse">
                  <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                  Lector HID Activo
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Escaneo continuo por ráfaga · Buffer FIFO a 500ms anti-rate limit de Notion
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Navegación por pestañas */}
            <div className="flex bg-slate-800/80 p-1 rounded-xl border border-slate-700/60 text-xs">
              <button
                type="button"
                onClick={() => { setActiveTab('scan'); barcodeInputRef.current?.focus(); }}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                  activeTab === 'scan'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Captura Directa
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('pending')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
                  activeTab === 'pending'
                    ? 'bg-amber-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <span>Firma Supervisor</span>
                {pendingItems.length > 0 && (
                  <span className="px-1.5 py-0.2 bg-amber-400 text-slate-950 font-bold rounded-full text-[10px]">
                    {pendingItems.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('queue')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
                  activeTab === 'queue'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <span>Buffer FIFO</span>
                {activeQueueItems.length > 0 && (
                  <span className="px-1.5 py-0.2 bg-blue-400 text-slate-950 font-bold rounded-full text-[10px]">
                    {activeQueueItems.length}
                  </span>
                )}
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
              title="Cerrar modal (Esc)"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Cuerpo del Modal */}
        <div className="flex-1 overflow-y-auto p-6">
          
          {/* TAB 1: CAPTURA DIRECTA 'ZERO-MOUSE' */}
          {activeTab === 'scan' && (
            <div className="space-y-6">
              
              {/* Bloque Superior: Entrada de Código de Barras */}
              <div className="bg-slate-950/70 p-5 rounded-2xl border border-slate-800">
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  1. Disparo de Pistola / Lectura de Código de Barras
                </label>
                <form onSubmit={handleBarcodeSubmit} className="relative">
                  <input
                    ref={barcodeInputRef}
                    type="text"
                    value={barcodeInput}
                    onChange={(e) => setBarcodeInput(e.target.value)}
                    placeholder="Apunte la pistola a la etiqueta o digite código (ej: DIS-007)..."
                    disabled={selectedItem !== null}
                    className={`w-full px-4 py-3.5 pl-11 bg-slate-900 border text-base font-mono rounded-xl focus:outline-none transition-all ${
                      inputError
                        ? 'border-red-500 ring-2 ring-red-500/30 bg-red-950/20 text-red-200'
                        : selectedItem
                        ? 'border-slate-700 bg-slate-900/50 text-slate-400'
                        : 'border-emerald-500/60 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20 text-emerald-300'
                    }`}
                  />
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                    </svg>
                  </div>
                  <button
                    type="submit"
                    disabled={!barcodeInput.trim() || selectedItem !== null}
                    className="absolute inset-y-1.5 right-1.5 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600 text-white font-medium text-xs rounded-lg transition-colors"
                  >
                    Buscar (Enter)
                  </button>
                </form>

                {/* Notificación de Error Sónico/Visual No Bloqueante */}
                {inputError && (
                  <div className="mt-2.5 flex items-center gap-2 text-xs font-semibold text-red-400 animate-headShake">
                    <span className="p-1 bg-red-500/20 rounded">⚠️</span>
                    <span>{inputError} (reintento automático listo)</span>
                  </div>
                )}
              </div>

              {/* Bloque Central: Insumo Resuelto y Captura de Conteo */}
              {selectedItem ? (
                <div className="bg-slate-950 p-6 rounded-2xl border-2 border-emerald-500/70 shadow-lg shadow-emerald-950/40 animate-slideDown">
                  <div className="flex items-start justify-between pb-4 border-b border-slate-800">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-400 font-mono text-xs rounded-md font-bold">
                          {selectedItem.codigo || selectedItem.id}
                        </span>
                        <span className="text-xs text-slate-400 uppercase font-semibold">
                          {selectedItem.categoriaMaterial || 'Insumo de Planta'}
                        </span>
                      </div>
                      <h3 className="text-lg font-bold text-white mt-1">
                        {selectedItem.nombre}
                      </h3>
                    </div>

                    <button
                      type="button"
                      onClick={handleCancelSelection}
                      className="text-xs px-2.5 py-1 text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
                    >
                      Cancelar (Esc)
                    </button>
                  </div>

                  {/* Ficha Rápida de Stock y Costo */}
                  <div className="grid grid-cols-3 gap-4 my-5">
                    <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
                      <span className="text-[11px] text-slate-400 uppercase font-medium">Stock en Sistema</span>
                      <p className="text-xl font-black text-slate-200 mt-0.5">
                        {selectedItem.stockBase} <span className="text-xs font-normal text-slate-400">{selectedItem.unidad || 'UND'}</span>
                      </p>
                    </div>

                    <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
                      <span className="text-[11px] text-slate-400 uppercase font-medium">Costo Maestro</span>
                      <p className="text-xl font-black text-emerald-400 mt-0.5">
                        ${(selectedItem.costoUnitarioUSD || 0).toFixed(2)} <span className="text-xs font-normal text-slate-400">USD</span>
                      </p>
                    </div>

                    <div className={`p-3 rounded-xl border transition-all ${
                      isCriticalSelected
                        ? 'bg-amber-950/40 border-amber-500/50 text-amber-300'
                        : 'bg-slate-900/80 border-slate-800 text-slate-200'
                    }`}>
                      <span className="text-[11px] uppercase font-medium">
                        {isCriticalSelected ? '⚠️ Desvío a Firma' : 'Delta Proyectado'}
                      </span>
                      <p className="text-xl font-black mt-0.5">
                        {currentDelta > 0 ? `+${currentDelta}` : currentDelta} <span className="text-xs font-normal">und</span>
                      </p>
                    </div>
                  </div>

                  {/* Formulario de Cantidad Contada */}
                  <form onSubmit={handleCountSubmit} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                        2. Cantidad Física Contada (Digitar en Numpad + Enter)
                      </label>
                      <div className="flex gap-3">
                        <input
                          ref={countInputRef}
                          type="number"
                          step="any"
                          min="0"
                          value={countedQty}
                          onChange={(e) => setCountedQty(e.target.value)}
                          placeholder="0.00"
                          autoFocus
                          className="flex-1 px-5 py-4 bg-slate-900 border-2 border-emerald-500 text-2xl font-mono font-bold text-emerald-300 rounded-xl focus:outline-none focus:ring-4 focus:ring-emerald-500/30"
                        />
                        <button
                          type="submit"
                          disabled={countedQty === ''}
                          className="px-8 py-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold text-sm rounded-xl transition-all shadow-lg shadow-emerald-950/40 flex items-center gap-2"
                        >
                          <span>Encolar</span>
                          <kbd className="px-2 py-0.5 text-xs bg-emerald-800 rounded font-mono">↵ Enter</kbd>
                        </button>
                      </div>
                    </div>

                    {/* Alerta de Desvío a Firma si es Crítico */}
                    {isCriticalSelected && (
                      <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center justify-between text-xs text-amber-300">
                        <div className="flex items-center gap-2">
                          <span className="text-base">⚠️</span>
                          <span>
                            Discrepancia crítica ($|Δ| &gt; 5$ o $|\$| &gt; $5.00). Se apartará a la bandeja de <strong>Firma de Supervisor</strong>.
                          </span>
                        </div>
                        <span className="font-mono font-bold">Impacto: ${Math.abs(currentImpactUSD).toFixed(2)} USD</span>
                      </div>
                    )}
                  </form>
                </div>
              ) : (
                /* Estado Vacío: Esperando Lector */
                <div className="py-12 flex flex-col items-center justify-center text-center border-2 border-dashed border-slate-800 rounded-2xl bg-slate-950/40">
                  <div className="w-16 h-16 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-3xl mb-3 text-slate-500">
                    🔍
                  </div>
                  <h4 className="text-base font-semibold text-slate-300">
                    Esperando lectura de código de barras
                  </h4>
                  <p className="text-xs text-slate-500 max-w-sm mt-1">
                    Escanee cualquier material de pasillo. La interfaz resolverá la ficha y saltará directamente a la cantidad contada.
                  </p>
                </div>
              )}

              {/* Resumen Inferior del Buffer FIFO */}
              <div className="flex items-center justify-between px-4 py-3 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-400">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span>
                    Buffer FIFO: <strong>{activeQueueItems.length} en cola</strong>
                  </span>
                  <span>·</span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                    Pendientes Firma: <strong>{pendingItems.length}</strong>
                  </span>
                </div>
                <div className="text-slate-500">
                  Atajo: <kbd className="px-1.5 py-0.5 bg-slate-800 rounded font-mono text-[11px]">F2</kbd> o <kbd className="px-1.5 py-0.5 bg-slate-800 rounded font-mono text-[11px]">Alt+B</kbd>
                </div>
              </div>

            </div>
          )}

          {/* TAB 2: BANDEJA DE FIRMA DE SUPERVISOR EN LOTE */}
          {activeTab === 'pending' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <span>✍️ Bandeja de Aprobación en Lote</span>
                    <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 text-xs rounded-full border border-amber-500/30">
                      {pendingItems.length} pendientes
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Discrepancias que superan el umbral de riesgo (|Δ| &gt; 5 o $|\$| &gt; $5.00 USD).
                  </p>
                </div>

                {pendingItems.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedPendingIds.length === pendingItems.length) {
                        setSelectedPendingIds([]);
                      } else {
                        setSelectedPendingIds(pendingItems.map(p => p.id));
                      }
                    }}
                    className="text-xs text-slate-400 hover:text-white underline"
                  >
                    {selectedPendingIds.length === pendingItems.length ? 'Desmarcar todos' : 'Seleccionar todos'}
                  </button>
                )}
              </div>

              {pendingItems.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center text-center bg-slate-950/40 rounded-2xl border border-slate-800">
                  <span className="text-3xl mb-2">🎉</span>
                  <p className="text-sm font-semibold text-slate-300">No hay discrepancias críticas pendientes</p>
                  <p className="text-xs text-slate-500 mt-1">Todos los conteos del pasillo están en conformidad o ya fueron procesados.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Lista de Ítems Críticos */}
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {pendingItems.map((item) => (
                      <div
                        key={item.id}
                        className={`p-3.5 rounded-xl border flex items-center justify-between transition-all ${
                          selectedPendingIds.includes(item.id)
                            ? 'bg-slate-950 border-amber-500/50'
                            : 'bg-slate-950/40 border-slate-800 opacity-60'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={selectedPendingIds.includes(item.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedPendingIds([...selectedPendingIds, item.id]);
                              } else {
                                setSelectedPendingIds(selectedPendingIds.filter(id => id !== item.id));
                              }
                            }}
                            className="w-4 h-4 rounded border-slate-700 text-amber-500 focus:ring-amber-500/30"
                          />
                          <div>
                            <p className="text-sm font-semibold text-white">{item.nombre}</p>
                            <p className="text-xs text-slate-400">
                              Stock Sistema: <strong>{item.stockActual}</strong> · Conteo Físico: <strong className="text-amber-300">{item.conteoFisico}</strong> {item.unidad}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-4 text-right">
                          <div>
                            <span className={`text-sm font-black font-mono ${item.delta > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {item.delta > 0 ? `+${item.delta}` : item.delta} {item.unidad}
                            </span>
                            <p className="text-[11px] text-slate-400">
                              ${Math.abs(item.impactoUSD).toFixed(2)} USD ({(Math.abs(item.impactoUSD) * item.tasaBCV).toFixed(1)} Bs)
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={() => removeQueueItem(item.id)}
                            className="text-slate-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-slate-900"
                            title="Descartar conteo"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Panel de Firma con PIN */}
                  <form onSubmit={handleApproveBatch} className="bg-slate-950 p-5 rounded-2xl border border-amber-500/40 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                          Justificación Técnica de Ajuste en Bloque
                        </label>
                        <input
                          type="text"
                          value={batchJustificacion}
                          onChange={(e) => setBatchJustificacion(e.target.value)}
                          placeholder="Motivo de la aprobación en lote..."
                          className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 text-xs rounded-xl focus:outline-none focus:border-amber-400 text-slate-200"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-amber-300 uppercase tracking-wider mb-1.5">
                          PIN de Supervisor (4 Dígitos) *
                        </label>
                        <input
                          type="password"
                          maxLength={4}
                          value={supervisorPin}
                          onChange={(e) => setSupervisorPin(e.target.value.replace(/\D/g, ''))}
                          placeholder="••••"
                          className="w-full px-3.5 py-2.5 bg-slate-900 border-2 border-amber-500 text-sm font-mono tracking-widest text-center rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/30 text-amber-300"
                        />
                      </div>
                    </div>

                    {batchSuccessMsg && (
                      <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs rounded-xl font-semibold flex items-center gap-2">
                        <span>✅</span>
                        <span>{batchSuccessMsg}</span>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={isApprovingBatch || supervisorPin.length < 4 || selectedPendingIds.length === 0}
                      className="w-full py-3 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-slate-950 font-bold text-sm rounded-xl transition-all shadow-lg shadow-amber-950/40 flex items-center justify-center gap-2"
                    >
                      {isApprovingBatch ? (
                        <span>Autorizando lote...</span>
                      ) : (
                        <span>✍️ Firmar y Despachar {selectedPendingIds.length} Ítems a la Cola FIFO</span>
                      )}
                    </button>
                  </form>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: BUFFER FIFO EN TIEMPO REAL */}
          {activeTab === 'queue' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <span>⚡ Buffer FIFO Anti-Rate Limit (500ms)</span>
                    <span className="px-2 py-0.5 bg-blue-500/20 text-blue-300 text-xs rounded-full border border-blue-500/30">
                      {activeQueueItems.length} en despacho
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Drenado secuencial a 2 req/s (65% del límite oficial de 3 req/s de Notion ERP).
                  </p>
                </div>
              </div>

              {activeQueueItems.length === 0 && errorItems.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center text-center bg-slate-950/40 rounded-2xl border border-slate-800">
                  <span className="text-3xl mb-2">⚡</span>
                  <p className="text-sm font-semibold text-slate-300">Buffer FIFO libre y sincronizado</p>
                  <p className="text-xs text-slate-500 mt-1">Todos los escaneos han sido confirmados y asentados en Notion.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Ítems en tránsito */}
                  {activeQueueItems.map((item, idx) => (
                    <div
                      key={item.id}
                      className="p-3 bg-slate-950 rounded-xl border border-blue-500/30 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono font-bold text-slate-500">#{idx + 1}</span>
                        {item.status === 'PROCESANDO' ? (
                          <span className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></span>
                        ) : (
                          <span className="w-2.5 h-2.5 rounded-full bg-blue-400"></span>
                        )}
                        <div>
                          <p className="text-sm font-semibold text-white">{item.nombre}</p>
                          <p className="text-xs text-slate-400">
                            Conteo: <strong>{item.conteoFisico}</strong> {item.unidad} (Δ {item.delta > 0 ? `+${item.delta}` : item.delta})
                          </p>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${
                          item.status === 'PROCESANDO' ? 'bg-blue-500/20 text-blue-300' : 'bg-slate-800 text-slate-300'
                        }`}>
                          {item.status}
                        </span>
                        {item.retryCount > 0 && (
                          <p className="text-[10px] text-amber-400 mt-0.5">Reintento #{item.retryCount}</p>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Ítems en Error */}
                  {errorItems.map((item) => (
                    <div
                      key={item.id}
                      className="p-3 bg-red-950/30 rounded-xl border border-red-500/40 flex items-center justify-between"
                    >
                      <div>
                        <p className="text-sm font-semibold text-red-200">{item.nombre}</p>
                        <p className="text-xs text-red-400">{item.errorMessage || 'Error asentando ajuste'}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeQueueItem(item.id)}
                        className="text-xs px-2.5 py-1 bg-red-800 hover:bg-red-700 text-white rounded-lg"
                      >
                        Descartar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>

        {/* Footer Informativo */}
        <div className="px-6 py-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs text-slate-500">
          <span>Sanesca PRO · Suite Industrial v1.0.0</span>
          <span>Presione <kbd className="px-1.5 py-0.5 bg-slate-900 rounded border border-slate-700 font-mono text-slate-300">Esc</kbd> para cerrar</span>
        </div>

      </div>
    </div>
  );
};
