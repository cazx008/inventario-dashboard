import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Scale,
  Search,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  DollarSign,
  Coins,
  Lock,
  ShieldCheck,
  Loader2,
  ArrowRight,
  ClipboardCheck,
  Eye,
  EyeOff,
  Info
} from 'lucide-react';
import { InventoryItem } from '../types/inventory';
import {
  STOCK_ADJUSTMENT_REASONS,
  StockAdjustmentReason,
  StockAdjustmentResult
} from '../types/adjustment';
import { submitStockAdjustment } from '../services/kardexService';
import { saveOfflineAdjustment } from '../services/offlineStorageService';

interface StockAdjustmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  inventoryItems: InventoryItem[];
  preselectedItem?: InventoryItem | null;
  onAdjustmentSuccess: (result: StockAdjustmentResult) => void;
  bcvRate: number;
  currentUser?: {
    name?: string;
    permissions?: string[];
    puestos?: string[];
  } | null;
}

export const StockAdjustmentModal: React.FC<StockAdjustmentModalProps> = ({
  isOpen,
  onClose,
  inventoryItems,
  preselectedItem = null,
  onAdjustmentSuccess,
  bcvRate,
  currentUser = null
}) => {
  // 1. Estado de Selección de Material
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(preselectedItem);
  const [materialSearch, setMaterialSearch] = useState('');
  const [isSearchingMaterial, setIsSearchingMaterial] = useState(false);

  // 2. Modo Conteo Ciego (Blind Audit Mode)
  const [blindMode, setBlindMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('sanesca_count_blind_mode') === 'true';
    }
    return false;
  });
  const [blindRevealed, setBlindRevealed] = useState<boolean>(false);

  const toggleBlindMode = () => {
    setBlindMode(prev => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem('sanesca_count_blind_mode', next ? 'true' : 'false');
      }
      return next;
    });
    setBlindRevealed(false);
  };

  // 3. Conteo Físico Real
  const [conteoFisico, setConteoFisico] = useState<number | string>('');

  // 4. Costo Referencial Estimado (para insumos con costo catalogado <= 0)
  const [costoReferencial, setCostoReferencial] = useState<number | string>('');

  // 5. Motivo y Justificación
  const [motivo, setMotivo] = useState<StockAdjustmentReason>('Diferencia de Conteo Cíclico');
  const [justificacion, setJustificacion] = useState('');

  // 6. Seguridad y PIN de Supervisor
  const [supervisorPin, setSupervisorPin] = useState('');

  // 7. Estado Transaccional
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Sincronizar preselectedItem cuando cambia o se abre el modal
  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      if (preselectedItem) {
        setSelectedItem(preselectedItem);
        setConteoFisico(blindMode ? '' : (preselectedItem.stockBase ?? 0));
        setBlindRevealed(!blindMode);
        setCostoReferencial(preselectedItem.costoUnitarioUSD && preselectedItem.costoUnitarioUSD > 0 ? preselectedItem.costoUnitarioUSD : '');
        setIsSearchingMaterial(false);
      } else {
        setSelectedItem(null);
        setConteoFisico('');
        setBlindRevealed(false);
        setCostoReferencial('');
        setIsSearchingMaterial(true);
      }
      setMotivo('Diferencia de Conteo Cíclico');
      setJustificacion('');
      setSupervisorPin('');
    }
  }, [isOpen, preselectedItem, blindMode]);

  // Si cambia el ítem seleccionado
  const handleSelectItem = (item: InventoryItem) => {
    setSelectedItem(item);
    setConteoFisico(blindMode ? '' : (item.stockBase ?? 0));
    setBlindRevealed(!blindMode);
    setCostoReferencial(item.costoUnitarioUSD && item.costoUnitarioUSD > 0 ? item.costoUnitarioUSD : '');
    setIsSearchingMaterial(false);
    setMaterialSearch('');
    setErrorMessage(null);
  };

  // Filtrado de materiales para el buscador predictivo
  const filteredItems = useMemo(() => {
    if (!materialSearch.trim()) return inventoryItems.slice(0, 15);
    const query = materialSearch.toLowerCase().trim();
    return inventoryItems
      .filter(item =>
        item.nombre?.toLowerCase().includes(query) ||
        item.codigo?.toLowerCase().includes(query) ||
        item.marca?.toLowerCase().includes(query) ||
        item.categoriaMaterial?.toLowerCase().includes(query)
      )
      .slice(0, 20);
  }, [inventoryItems, materialSearch]);

  // Cálculos Reactivos del Ajuste
  const currentStock = selectedItem?.stockBase ?? 0;
  const numConteo = typeof conteoFisico === 'number' ? conteoFisico : (conteoFisico === '' ? 0 : Number(conteoFisico));
  const isValidCount = !isNaN(numConteo) && numConteo >= 0 && conteoFisico !== '';

  const delta = isValidCount && selectedItem ? Math.round((numConteo - currentStock) * 100) / 100 : 0;
  const catalogCostUSD = selectedItem?.costoUnitarioUSD || 0;
  const parsedRefCost = Number(costoReferencial) || 0;
  const effectiveUnitCostUSD = parsedRefCost > 0 ? parsedRefCost : catalogCostUSD;
  const impactoUSD = Math.round(Math.abs(delta) * effectiveUnitCostUSD * 100) / 100;
  const effectiveBcvRate = bcvRate > 0 ? bcvRate : 36.50;
  const impactoBs = Math.round(impactoUSD * effectiveBcvRate * 100) / 100;

  // Detección de Rol de Supervisión en Sesión
  const isSupervisorSession = useMemo(() => {
    if (!currentUser) return false;
    const perms = currentUser.permissions || [];
    if (perms.includes('Superadmin')) return true;
    const puestos = currentUser.puestos || [];
    return puestos.some(p => p.toLowerCase().includes('supervisor') || p.toLowerCase().includes('gerente'));
  }, [currentUser]);

  // Umbral Crítico: > 5 und de descalce o > $5.00 USD de impacto financiero
  const isCriticalThreshold = Math.abs(delta) > 5 || impactoUSD > 5.00;
  const requiresPinInput = isCriticalThreshold && !isSupervisorSession;

  // Validación del Formulario
  const isBlindReady = !blindMode || blindRevealed;
  const requiresCostEntry = catalogCostUSD <= 0 && delta !== 0;
  const isCostValid = !requiresCostEntry || parsedRefCost > 0;
  const isJustificationValid = justificacion.trim().length >= 10;
  const isPinValid = !requiresPinInput || supervisorPin.trim().length === 4;
  const canSubmit = selectedItem && isValidCount && isJustificationValid && isPinValid && isBlindReady && isCostValid && !isSubmitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !selectedItem) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    // 1. Detección Proactiva de Estado Offline
    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    if (isOffline) {
      try {
        await saveOfflineAdjustment({
          dashboardItemId: selectedItem.id,
          insumoId: selectedItem.insumoId,
          itemNombre: selectedItem.nombre,
          unidad: selectedItem.unidad || 'Und',
          conteoFisicoReal: numConteo,
          stockSistemaAlCapturar: currentStock,
          costoReferencialUSD: parsedRefCost > 0 ? parsedRefCost : undefined,
          motivo,
          justificacion: justificacion.trim(),
          supervisorPin: requiresPinInput ? supervisorPin.trim() : undefined,
          deltaOriginal: delta,
        });

        onAdjustmentSuccess({
          status: 'success',
          message: `📦 Conteo de "${selectedItem.nombre}" guardado localmente (Offline). Se sincronizará automáticamente al volver la señal.`,
          newStock: numConteo,
          previousStock: currentStock,
          delta,
          nuevoEstadoStock: numConteo === 0 ? '🔴 Sin Stock' : numConteo < selectedItem.stockMinimo ? '🟠 Bajo Mínimo' : '🟢 En Stock'
        });
        onClose();
        return;
      } catch (offlineErr: any) {
        console.error('Error guardando ajuste offline:', offlineErr);
        setErrorMessage('Fallo al guardar en la base local del dispositivo: ' + offlineErr.message);
        setIsSubmitting(false);
        return;
      }
    }

    // 2. Envío en Línea con Resguardo Automático si la red cae durante la petición
    try {
      const payload = {
        dashboardId: selectedItem.id,
        insumoId: selectedItem.insumoId,
        nombre: selectedItem.nombre,
        conteoFisico: numConteo,
        stockActual: currentStock,
        motivo,
        justificacion: justificacion.trim(),
        costoUnitarioUSD: effectiveUnitCostUSD,
        costoReferencialUSD: parsedRefCost > 0 ? parsedRefCost : undefined,
        tasaBCV: effectiveBcvRate,
        unidad: selectedItem.unidad || 'Und',
        supervisorPin: requiresPinInput ? supervisorPin.trim() : undefined
      };

      const result = await submitStockAdjustment(payload);

      // Callback al padre para feedback y refresco reactivo
      onAdjustmentSuccess(result);
      onClose();
    } catch (err: any) {
      console.warn('Error enviando ajuste de stock:', err);

      // Resguardo de contingencia si falló por corte abrupto de red
      const isNetworkFail = !navigator.onLine || err?.message?.includes('fetch') || err?.message?.includes('NetworkError') || err?.name === 'TypeError';
      if (isNetworkFail) {
        try {
          await saveOfflineAdjustment({
            dashboardItemId: selectedItem.id,
            insumoId: selectedItem.insumoId,
            itemNombre: selectedItem.nombre,
            unidad: selectedItem.unidad || 'Und',
            conteoFisicoReal: numConteo,
            stockSistemaAlCapturar: currentStock,
            costoReferencialUSD: parsedRefCost > 0 ? parsedRefCost : undefined,
            motivo,
            justificacion: justificacion.trim(),
            supervisorPin: requiresPinInput ? supervisorPin.trim() : undefined,
            deltaOriginal: delta,
          });

          onAdjustmentSuccess({
            status: 'success',
            message: `📦 Conexión interrumpida: El conteo se resguardó en la cola local offline.`,
            newStock: numConteo,
            previousStock: currentStock,
            delta,
            nuevoEstadoStock: numConteo === 0 ? '🔴 Sin Stock' : numConteo < selectedItem.stockMinimo ? '🟠 Bajo Mínimo' : '🟢 En Stock'
          });
          onClose();
          return;
        } catch (storageErr) {
          console.error('Error en resguardo offline de contingencia:', storageErr);
        }
      }

      setErrorMessage(err.message || 'Error registrando el ajuste en el servidor.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div 
        className="relative w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden my-8"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stock-adjustment-title"
      >
        {/* Cabecera Industrial */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="stock-adjustment-title" className="text-lg font-bold text-zinc-100 tracking-tight">
                  Conteo Cíclico y Ajustes de Kardex
                </h2>
                <span className="px-2 py-0.5 text-[10px] font-mono font-semibold uppercase rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  Odoo 18 Quant
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                Auditoría física de existencias en planta con doble partida y valuación bimonetaria
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleBlindMode}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all flex items-center gap-1.5 ${
                blindMode
                  ? 'bg-purple-500/20 text-purple-300 border-purple-500/40 shadow-sm shadow-purple-500/20'
                  : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200'
              }`}
              title={blindMode ? 'Modo Ciego Activo: Stock del sistema oculto para evitar sesgo' : 'Activar Modo Ciego'}
            >
              {blindMode ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              <span>{blindMode ? 'Modo Ciego' : 'Normal'}</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 text-zinc-400 hover:text-zinc-100 rounded-lg hover:bg-zinc-800 transition-colors"
              title="Cerrar ventana"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Formulario Principal */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Alerta de Error si ocurre */}
          {errorMessage && (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm flex items-start gap-3 animate-in fade-in">
              <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-rose-200">No se pudo asentar el ajuste</p>
                <p className="text-xs text-rose-300/90 mt-0.5 leading-relaxed">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* 1. Selección / Búsqueda de Insumo */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Material a Auditar
              </label>
              {selectedItem && (
                <button
                  type="button"
                  onClick={() => setIsSearchingMaterial(true)}
                  className="text-xs text-amber-400 hover:text-amber-300 font-medium hover:underline flex items-center gap-1"
                >
                  <Search className="w-3.5 h-3.5" /> Cambiar material
                </button>
              )}
            </div>

            {(!selectedItem || isSearchingMaterial) ? (
              <div className="space-y-2 border border-zinc-800 rounded-xl p-3 bg-zinc-950/40">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-3 text-zinc-500" />
                  <input
                    type="text"
                    value={materialSearch}
                    onChange={e => setMaterialSearch(e.target.value)}
                    placeholder="Buscar por nombre, código o marca..."
                    className="w-full pl-9 pr-4 py-2 bg-zinc-900 border border-zinc-750 rounded-lg text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                    autoFocus
                  />
                </div>
                <div className="max-h-48 overflow-y-auto divide-y divide-zinc-800/60 rounded-lg border border-zinc-800/80">
                  {filteredItems.length === 0 ? (
                    <div className="p-4 text-center text-xs text-zinc-500">
                      No se encontraron materiales que coincidan con la búsqueda.
                    </div>
                  ) : (
                    filteredItems.map(item => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleSelectItem(item)}
                        className="w-full p-2.5 text-left hover:bg-zinc-800/60 transition-colors flex items-center justify-between group"
                      >
                        <div>
                          <p className="text-sm font-medium text-zinc-200 group-hover:text-amber-400 transition-colors">
                            {item.nombre}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-zinc-500 mt-0.5">
                            {item.codigo && <span className="font-mono">[{item.codigo}]</span>}
                            {item.marca && <span>{item.marca}</span>}
                            <span>· {item.categoriaMaterial || 'Insumo'}</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-semibold font-mono text-zinc-300">
                            {item.stockBase} {item.unidad || 'und'}
                          </span>
                          <p className="text-[10px] text-zinc-500">Stock Sistema</p>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-zinc-950/80 border border-zinc-800 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                    {selectedItem.nombre}
                    {selectedItem.codigo && (
                      <span className="text-xs font-mono font-normal text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-800">
                        {selectedItem.codigo}
                      </span>
                    )}
                  </h3>
                  <div className="flex items-center gap-3 text-xs text-zinc-400 mt-1">
                    <span>{selectedItem.marca || 'Genérico'}</span>
                    <span>·</span>
                    <span>{selectedItem.categoriaMaterial || 'Insumo'}</span>
                    <span>·</span>
                    <span className="text-emerald-400 font-mono font-medium">
                      Costo: ${effectiveUnitCostUSD.toFixed(2)} USD / {selectedItem.unidad || 'und'}
                      {catalogCostUSD <= 0 && parsedRefCost > 0 ? ' (Referencial)' : ''}
                    </span>
                  </div>
                </div>
                <div className="text-right pl-4 border-l border-zinc-800">
                  <span className="text-xs text-zinc-500 block">Stock Actual</span>
                  <span className="text-lg font-mono font-bold text-zinc-200">
                    {blindMode && !blindRevealed ? '••••' : `${currentStock} ${selectedItem.unidad || 'und'}`}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* 2. Cuadrícula Comparativa: Stock Teórico vs Conteo Físico Real */}
          {selectedItem && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Columna 1: Teórico en Sistema */}
                <div className="p-4 rounded-xl bg-zinc-950/40 border border-zinc-800 flex flex-col justify-between">
                  <div>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 block">
                      1. Stock en Sistema
                    </span>
                    {blindMode && !blindRevealed ? (
                      <div className="flex items-center gap-2 mt-2">
                        <EyeOff className="w-5 h-5 text-purple-400" />
                        <span className="text-base font-mono font-bold text-purple-300">•••• Oculto</span>
                      </div>
                    ) : (
                      <p className="text-2xl font-mono font-bold text-zinc-300 mt-2">
                        {currentStock}
                      </p>
                    )}
                  </div>
                  <div className="mt-3 pt-2 border-t border-zinc-850 flex items-center justify-between text-xs text-zinc-400">
                    <span>Mínimo: {selectedItem.stockMinimo || 0}</span>
                    <span className="font-mono">{selectedItem.unidad || 'und'}</span>
                  </div>
                </div>

                {/* Columna 2: Conteo Físico Real (Input) */}
                <div className="p-4 rounded-xl bg-zinc-900 border-2 border-amber-500/40 focus-within:border-amber-400 transition-colors flex flex-col justify-between shadow-lg shadow-amber-500/5">
                  <div>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-400 block">
                      2. Conteo Físico Real *
                    </span>
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={conteoFisico}
                        onChange={e => setConteoFisico(e.target.value === '' ? '' : Number(e.target.value))}
                        placeholder="0"
                        className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-2xl font-mono font-bold text-amber-300 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 text-center"
                        required
                      />
                    </div>
                  </div>
                  <div className="mt-3 pt-2 border-t border-zinc-800 flex items-center justify-between text-xs text-zinc-400">
                    <span>Gaveta / Pasillo</span>
                    <span className="font-mono">{selectedItem.unidad || 'und'}</span>
                  </div>
                </div>

                {/* Columna 3: Discrepancia Reactiva */}
                <div className={`p-4 rounded-xl border flex flex-col justify-between transition-colors ${
                  blindMode && !blindRevealed
                    ? 'bg-zinc-950/40 border-zinc-800 text-zinc-400'
                    : delta === 0 
                      ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300'
                      : delta < 0
                        ? 'bg-rose-950/20 border-rose-500/30 text-rose-300'
                        : 'bg-cyan-950/20 border-cyan-500/30 text-cyan-300'
                }`}>
                  <div>
                    <span className="text-[11px] font-semibold uppercase tracking-wider opacity-80 block">
                      3. Discrepancia (Δ)
                    </span>
                    {blindMode && !blindRevealed ? (
                      <div className="flex items-center gap-2 mt-2">
                        <Lock className="w-5 h-5 text-zinc-500" />
                        <span className="text-sm font-mono text-zinc-400">•••• Pendiente</span>
                      </div>
                    ) : (
                      <div className="flex items-baseline gap-2 mt-2">
                        <span className="text-2xl font-mono font-bold">
                          {delta > 0 ? `+${delta}` : delta}
                        </span>
                        <span className="text-xs font-mono opacity-80">{selectedItem.unidad || 'und'}</span>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 pt-2 border-t border-current/15 text-xs font-medium flex items-center justify-between">
                    {blindMode && !blindRevealed ? (
                      <span className="flex items-center gap-1 text-purple-400">
                        <EyeOff className="w-3.5 h-3.5" /> Modo Ciego
                      </span>
                    ) : delta === 0 ? (
                      <span className="flex items-center gap-1 text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Stock Cuadrado
                      </span>
                    ) : delta < 0 ? (
                      <span className="flex items-center gap-1 text-rose-400">
                        <AlertTriangle className="w-3.5 h-3.5" /> Faltante / Merma
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-cyan-400">
                        <ArrowRight className="w-3.5 h-3.5" /> Sobrante Físico
                      </span>
                    )}
                    <span className="text-[11px] opacity-75">
                      {blindMode && !blindRevealed ? 'Conteo Oculto' : delta === 0 ? 'Conforme' : 'Asiento Kardex'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Botón Revelar en Modo Ciego */}
              {blindMode && !blindRevealed && (
                <div className="p-3.5 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-between animate-in fade-in">
                  <div className="flex items-center gap-2.5 text-xs text-purple-300">
                    <Info className="w-4 h-4 text-purple-400 flex-shrink-0" />
                    <span>Modo Ciego activo: Ingresa el conteo físico y pulsa revelar para comparar contra el saldo del sistema.</span>
                  </div>
                  <button
                    type="button"
                    disabled={conteoFisico === '' || !isValidCount}
                    onClick={() => setBlindRevealed(true)}
                    className="px-4 py-2 rounded-lg text-xs font-bold bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed text-white flex items-center gap-1.5 transition-all shadow-md shadow-purple-600/20 flex-shrink-0 ml-3"
                  >
                    <Eye className="w-4 h-4" />
                    <span>Revelar Balance</span>
                  </button>
                </div>
              )}

              {/* Alerta y Entrada de Costo Referencial si costo en catálogo es <= 0 */}
              {(!blindMode || blindRevealed) && delta !== 0 && catalogCostUSD <= 0 && (
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 flex items-center justify-between gap-3 animate-in fade-in">
                  <div className="flex items-center gap-2.5">
                    <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
                    <div>
                      <span className="text-xs font-bold text-amber-200 block">
                        Material sin costo base en catálogo ($0.00 USD)
                      </span>
                      <p className="text-[11px] text-amber-400/80 mt-0.5">
                        Ingrese el costo unitario referencial estimado para calcular el impacto y enriquecer la ficha técnica.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="font-mono font-bold text-amber-400 text-sm">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={costoReferencial}
                      onChange={e => setCostoReferencial(e.target.value)}
                      placeholder="0.00"
                      className="w-24 bg-zinc-950 border border-amber-500/40 rounded-lg px-2.5 py-1.5 text-right font-mono text-sm font-bold text-amber-200 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
                      required
                    />
                    <span className="text-xs font-mono text-zinc-400">USD</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 3. Panel de Impacto Financiero Bimonetario */}
          {selectedItem && (!blindMode || blindRevealed) && delta !== 0 && (
            <div className="p-3.5 rounded-xl bg-zinc-950/80 border border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                  <DollarSign className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-xs text-zinc-400 block">Impacto Financiero del Ajuste</span>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-sm font-bold font-mono text-zinc-100">
                      ${impactoUSD.toFixed(2)} USD
                    </span>
                    {impactoBs > 0 && (
                      <span className="text-xs font-mono text-zinc-400">
                        (Bs {impactoBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })})
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-zinc-500 block">Tasa BCV Referencial</span>
                <span className="text-xs font-mono font-medium text-zinc-400">
                  {effectiveBcvRate.toFixed(2)} Bs/$
                </span>
              </div>
            </div>
          )}

          {/* 4. Selector de Motivo Estandarizado */}
          {selectedItem && (!blindMode || blindRevealed) && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Motivo Estandarizado de Ajuste *
              </label>
              <select
                value={motivo}
                onChange={e => setMotivo(e.target.value as StockAdjustmentReason)}
                className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-750 rounded-xl text-sm text-zinc-200 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 cursor-pointer"
              >
                {STOCK_ADJUSTMENT_REASONS.map(reason => (
                  <option key={reason} value={reason}>
                    {reason}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 5. Justificación Técnica Obligatoria */}
          {selectedItem && (!blindMode || blindRevealed) && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Justificación Técnica del Hallazgo *
                </label>
                <span className={`text-[11px] font-mono ${
                  isJustificationValid ? 'text-emerald-400 font-semibold' : 'text-zinc-500'
                }`}>
                  {justificacion.trim().length}/10 caracteres mín.
                </span>
              </div>
              <textarea
                rows={2}
                value={justificacion}
                onChange={e => setJustificacion(e.target.value)}
                placeholder="Explique la causa física del descalce (ej: Daño en estante superior por humedad, hallazgo de caja traspapelada...)"
                className={`w-full px-3.5 py-2 bg-zinc-950 border rounded-xl text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none transition-colors ${
                  justificacion.trim().length > 0 && !isJustificationValid
                    ? 'border-amber-500/60 focus:border-amber-400'
                    : isJustificationValid
                      ? 'border-emerald-500/50 focus:border-emerald-400'
                      : 'border-zinc-750 focus:border-zinc-500'
                }`}
                required
              />
            </div>
          )}

          {/* 6. Barrera de Seguridad: PIN de Supervisor si supera Umbral Crítico */}
          {selectedItem && (!blindMode || blindRevealed) && isCriticalThreshold && (
            <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20 space-y-3">
              <div className="flex items-start gap-2.5 text-xs text-amber-300">
                <Lock className="w-4 h-4 flex-shrink-0 text-amber-400 mt-0.5" />
                <div>
                  <p className="font-semibold text-amber-200">
                    Ajuste Crítico: Requiere Autorización de Supervisión
                  </p>
                  <p className="text-amber-400/80 mt-0.5 leading-relaxed">
                    La discrepancia supera el umbral operativo (&gt; 5 unidades o &gt; $5.00 USD).
                    {isSupervisorSession
                      ? ' Tu perfil cuenta con rango de mando para autorizar directamente.'
                      : ' Debe ingresar el PIN de 4 dígitos del supervisor de planta.'}
                  </p>
                </div>
              </div>

              {isSupervisorSession ? (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Autorización concedida por sesión de mando: <b>{currentUser?.name || 'Supervisor'}</b></span>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="relative w-40">
                    <input
                      type="password"
                      maxLength={4}
                      value={supervisorPin}
                      onChange={e => setSupervisorPin(e.target.value.replace(/\D/g, ''))}
                      placeholder="PIN (••••)"
                      className="w-full bg-zinc-950 border border-amber-500/40 rounded-lg px-3 py-1.5 text-center font-mono font-bold tracking-widest text-amber-300 placeholder-zinc-600 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
                      required
                    />
                  </div>
                  <span className="text-xs text-zinc-400">
                    PIN supervisor (ej. 1234)
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Botones de Acción */}
          <div className="pt-2 border-t border-zinc-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 rounded-xl hover:bg-zinc-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className={`px-5 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 transition-all shadow-lg ${
                canSubmit
                  ? delta === 0
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20'
                    : 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-600/20'
                  : 'bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-750'
              }`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Asentando en Kardex...</span>
                </>
              ) : delta === 0 ? (
                <>
                  <ClipboardCheck className="w-4 h-4" />
                  <span>Ratificar Conforme (Δ = 0)</span>
                </>
              ) : (
                <>
                  <Scale className="w-4 h-4" />
                  <span>Asentar Ajuste ({delta > 0 ? `+${delta}` : delta} {selectedItem?.unidad || 'und'})</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
