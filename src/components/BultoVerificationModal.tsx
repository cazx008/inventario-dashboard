import React, { useState, useEffect } from 'react';
import { 
  Package, 
  CheckCircle2, 
  AlertTriangle, 
  Printer, 
  ExternalLink, 
  X, 
  Building2, 
  Clock, 
  ShieldCheck, 
  Send,
  Boxes,
  Loader2,
  Scissors,
  Minus,
  Plus,
  ArrowLeft,
  Check
} from 'lucide-react';

export interface BultoData {
  folio: string;
  material: string;
  tienda: string;
  bulto: string; // formato "1_2" o "1"
  cantBulto?: number;
  pkgId?: string;
  unidadMedida?: string;
}

interface BultoVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  bultoData: BultoData | null;
  isAuthenticated: boolean;
  userRole?: string;
  hasPermission: (perm: string) => boolean;
  onDispatchToTaller?: (data: { material: string; tienda: string; folio: string; cantEstimada: number }) => void;
  onReprintLabel?: (bultoData: BultoData, labelInfo?: any) => void;
  onOpenOAB?: (folio: string) => void;
  triggerHaptic?: (type: 'success' | 'warning' | 'error') => void;
}

export const BultoVerificationModal: React.FC<BultoVerificationModalProps> = ({
  isOpen,
  onClose,
  bultoData,
  isAuthenticated,
  userRole,
  hasPermission,
  onDispatchToTaller,
  onReprintLabel,
  onOpenOAB,
  triggerHaptic
}) => {
  const [loading, setLoading] = useState(true);
  const [allocationInfo, setAllocationInfo] = useState<any | null>(null);
  const [authPromptOpen, setAuthPromptOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [showFraccionar, setShowFraccionar] = useState(false);
  const [bundleQty, setBundleQty] = useState<number>(10);
  const [consumoQty, setConsumoQty] = useState<number>(1);

  // Parsear formato bulto "1_2" -> Bulto 1 de 2
  const bultoRaw = bultoData?.bulto || '1_1';
  const [bultoIdx, totalBultos] = bultoRaw.includes('_') 
    ? bultoRaw.split('_').map(n => parseInt(n, 10) || 1) 
    : [parseInt(bultoRaw, 10) || 1, 1];

  useEffect(() => {
    if (!isOpen || !bultoData) return;

    let isMounted = true;
    setLoading(true);

    // Consulta en vivo a Edge KV para verificar el estado de la reserva del bulto
    fetch('/api/inventory/allocations')
      .then(res => res.json())
      .then(data => {
        if (!isMounted) return;
        const allocations = Array.isArray(data.allocations) ? data.allocations : [];
        const cleanMat = (bultoData.material || '').trim().toLowerCase();
        const cleanTienda = (bultoData.tienda || '').trim().toLowerCase();

        // Buscar coincidencia por material y tienda
        const match = allocations.find((a: any) => {
          const aMat = (a.insumoNombre || '').toLowerCase();
          const aId = (a.insumoId || '').toLowerCase();
          const aDash = (a.dashboardId || '').toLowerCase();
          const aTienda = (a.proyectoNombre || '').toLowerCase();

          const matchesMat = aMat.includes(cleanMat) || cleanMat.includes(aMat) || aId === cleanMat || aDash === cleanMat;
          const matchesTienda = aTienda.includes(cleanTienda) || cleanTienda.includes(aTienda);
          return matchesMat && matchesTienda;
        });

        setAllocationInfo(match || null);
        if (triggerHaptic) triggerHaptic('success');
      })
      .catch(err => {
        console.warn('Error verificando asignación de bulto en Edge KV:', err);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, bultoData]);

  // Inicializar cantidad de bulto y consumo cuando se abre el modal o carga la reserva
  useEffect(() => {
    if (!isOpen || !bultoData) return;
    const initialQty = bultoData.cantBulto && bultoData.cantBulto > 0 
      ? bultoData.cantBulto 
      : (allocationInfo?.cantidadApartada ? Math.max(1, Math.ceil(allocationInfo.cantidadApartada / (totalBultos || 1))) : 10);
    setBundleQty(initialQty);
    setConsumoQty(Math.min(1, initialQty));
    setShowFraccionar(false);
  }, [isOpen, bultoData, allocationInfo, totalBultos]);

  if (!isOpen || !bultoData) return null;

  const isMTO = bultoData.tienda && !bultoData.tienda.toLowerCase().includes('stock general');
  const cantApartada = allocationInfo?.cantidadApartada ?? null;
  const cantTransito = allocationInfo?.cantidadTransito ?? null;
  const cantRechazada = allocationInfo?.cantidadRechazada ?? 0;

  // Manejo de acciones con requerimiento de autenticación / PIN (D1-10B.1)
  const handleActionClick = (actionType: 'dispatch' | 'reprint' | 'oab' | 'fractionate') => {
    if (!isAuthenticated) {
      setPendingAction(actionType);
      setAuthPromptOpen(true);
      if (triggerHaptic) triggerHaptic('warning');
      return;
    }

    executeAction(actionType);
  };

  const executeAction = (actionType: 'dispatch' | 'reprint' | 'oab' | 'fractionate') => {
    if (actionType === 'fractionate') {
      setShowFraccionar(true);
    } else if (actionType === 'dispatch') {
      if (onDispatchToTaller) {
        onDispatchToTaller({
          material: bultoData.material,
          tienda: bultoData.tienda,
          folio: bultoData.folio,
          cantEstimada: cantApartada ? Math.ceil(cantApartada / (totalBultos || 1)) : 1
        });
      }
      onClose();
    } else if (actionType === 'reprint') {
      if (onReprintLabel) {
        onReprintLabel(bultoData, allocationInfo);
      }
    } else if (actionType === 'oab') {
      if (onOpenOAB) {
        onOpenOAB(bultoData.folio);
      }
      onClose();
    }
  };

  const handleConfirmFraccionamiento = () => {
    const saldo = Math.max(0, bundleQty - consumoQty);
    if (saldo === 0) {
      // Consumo total (D16)
      if (onDispatchToTaller) {
        onDispatchToTaller({
          material: bultoData.material,
          tienda: bultoData.tienda,
          folio: bultoData.folio,
          cantEstimada: bundleQty
        });
      }
      if (triggerHaptic) triggerHaptic('success');
      onClose();
    } else {
      // Saldo parcial con sustitución física y serial derivado dinámico -S{N} (D16 / D4)
      let derivedPkgId: string | undefined = undefined;
      if (bultoData.pkgId) {
        const baseWithoutSuffix = bultoData.pkgId.replace(/-S\d+$/i, '');
        let nextSuffix = '-S1';
        const match = bultoData.pkgId.match(/-S(\d+)$/i);
        if (match) {
          const currentNum = parseInt(match[1], 10) || 1;
          nextSuffix = `-S${currentNum + 1}`;
        }
        derivedPkgId = `${baseWithoutSuffix}${nextSuffix}`;
      }

      if (onReprintLabel) {
        onReprintLabel(bultoData, {
          isBultoAbierto: true,
          saldoRemanente: saldo,
          cantEnBulto: saldo,
          cantidadRecibidaHoy: saldo,
          bultos: 1,
          desgloseBultos: [saldo],
          customPkgId: derivedPkgId,
          pkgIdPrefix: bultoData.pkgId ? bultoData.pkgId.replace(/-\d{2}$/, '') : undefined,
          unidadMedida: bultoData.unidadMedida || 'und'
        });
      }
      if (onDispatchToTaller) {
        onDispatchToTaller({
          material: bultoData.material,
          tienda: bultoData.tienda,
          folio: bultoData.folio,
          cantEstimada: consumoQty
        });
      }
      if (triggerHaptic) triggerHaptic('success');
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto no-print">
      <div className="bg-slate-900 border border-slate-700 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden text-slate-100 flex flex-col animate-in fade-in zoom-in-95 duration-200">
        
        {/* Topbar Industrial */}
        <div className="bg-slate-950 px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-black tracking-wider uppercase text-emerald-400">
                  SANESCA PRO · CONTROL FÍSICO
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-medium">
                Cédula Digital del Bulto Verificada en Planta
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Cuerpo de la Cédula */}
        <div className="p-5 space-y-4">
          
          {/* Banner de Estado Físico */}
          <div className={`p-3.5 rounded-xl border flex items-center gap-3 ${
            loading 
              ? 'bg-slate-800/40 border-slate-700 text-slate-300' 
              : allocationInfo 
                ? 'bg-emerald-950/40 border-emerald-700/50 text-emerald-300' 
                : 'bg-amber-950/40 border-amber-700/50 text-amber-300'
          }`}>
            {loading ? (
              <Loader2 className="w-6 h-6 animate-spin text-slate-400 shrink-0" />
            ) : allocationInfo ? (
              <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold uppercase tracking-wider">
                {loading 
                  ? 'Verificando con Almacén...' 
                  : allocationInfo 
                    ? 'Bulto Verificado · Reserva Activa' 
                    : 'Sin Registro de Reserva Activa'}
              </div>
              <div className="text-[11px] opacity-80 truncate">
                {loading 
                  ? 'Consultando Edge KV sub-5ms' 
                  : allocationInfo 
                    ? `Apartado: ${cantApartada ?? 0} und en galpón${cantTransito ? ` · ${cantTransito} und en camino` : ''}`
                    : 'Es posible que el material ya haya sido consumido o reasignado'}
              </div>
            </div>
          </div>

          {/* Bloque Destacado de Obra / Tienda */}
          <div className="bg-black/60 border border-slate-800 rounded-xl p-4 text-center space-y-1">
            <div className="flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <Building2 className="w-3.5 h-3.5 text-brand-400" />
              <span>{isMTO ? 'Destino Exclusivo — Obra / Tienda' : 'Destino de Almacén'}</span>
            </div>
            <div className="text-xl sm:text-2xl font-black text-white uppercase tracking-tight break-words">
              {bultoData.tienda || 'Stock General / Fábrica'}
            </div>
          </div>

          {/* Ficha Técnica del Insumo */}
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 space-y-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Material / Insumo
              </div>
              <div className="text-base font-bold text-white mt-0.5">
                {allocationInfo?.insumoNombre || bultoData.material}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800/80">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Identificador Bulto
                </div>
                <div className="text-sm font-mono font-bold text-emerald-400 mt-0.5">
                  {totalBultos > 1 ? `BULTO ${bultoIdx} DE ${totalBultos}` : 'LOTE COMPLETO (1/1)'}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Folio OAB
                </div>
                <div className="text-sm font-mono font-bold text-brand-400 mt-0.5">
                  {bultoData.folio || 'S/F'}
                </div>
              </div>
            </div>

            {cantRechazada > 0 && (
              <div className="p-2.5 rounded-lg bg-red-950/40 border border-red-800/50 text-red-300 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                <span>
                  <b>Atención:</b> Este renglón tiene {cantRechazada} und rechazadas por calidad en rampa (en reclamo).
                </span>
              </div>
            )}
          </div>

          {/* Alerta de Autenticación Requerida */}
          {authPromptOpen && !isAuthenticated && (
            <div className="p-3 bg-brand-950/40 border border-brand-700/60 rounded-xl text-xs text-brand-200 flex items-center justify-between gap-2 animate-in fade-in">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-brand-400 shrink-0" />
                <span>Inicie sesión en el dashboard para ejecutar acciones operativas.</span>
              </div>
              <button
                onClick={() => {
                  window.location.href = window.location.pathname;
                }}
                className="px-2.5 py-1 bg-brand-600 hover:bg-brand-500 text-white rounded text-[11px] font-bold shrink-0"
              >
                Ingresar
              </button>
            </div>
          )}

          {/* Tríada Operativa de Planta & Fraccionamiento en Taller (D16) */}
          <div className="pt-2 space-y-2">
            {showFraccionar ? (
              <div className="bg-slate-950/90 border border-amber-500/40 rounded-xl p-4 space-y-3.5 animate-in fade-in slide-in-from-bottom-2">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                  <div className="flex items-center gap-2 text-amber-400 font-bold text-xs uppercase tracking-wider">
                    <Scissors className="w-4 h-4" />
                    <span>Fraccionar Bulto · Saldo en Taller</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowFraccionar(false)}
                    className="text-xs text-slate-400 hover:text-white flex items-center gap-1 transition"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Volver</span>
                  </button>
                </div>

                {/* Cantidad Total del Bulto y Consumo */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-2.5">
                    <span className="text-[10px] text-slate-400 font-medium uppercase block">Total en Bulto</span>
                    <div className="flex items-center gap-1.5 mt-1">
                      <input
                        type="number"
                        min="1"
                        value={bundleQty}
                        onChange={(e) => {
                          const val = Math.max(1, parseInt(e.target.value, 10) || 1);
                          setBundleQty(val);
                          if (consumoQty > val) setConsumoQty(val);
                        }}
                        className="w-16 bg-slate-950 border border-slate-700 rounded px-2 py-0.5 text-sm font-mono font-bold text-white text-center focus:border-amber-500 outline-none"
                      />
                      <span className="text-slate-400 text-xs font-mono">und</span>
                    </div>
                  </div>

                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-2.5">
                    <span className="text-[10px] text-slate-400 font-medium uppercase block">Consumo en Corte</span>
                    <div className="flex items-center gap-1 mt-1">
                      <button
                        type="button"
                        onClick={() => setConsumoQty(prev => Math.max(1, prev - 1))}
                        className="w-7 h-7 bg-slate-800 hover:bg-slate-700 rounded flex items-center justify-center text-slate-200 active:scale-95"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <input
                        type="number"
                        min="1"
                        max={bundleQty}
                        value={consumoQty}
                        onChange={(e) => {
                          const val = Math.min(bundleQty, Math.max(1, parseInt(e.target.value, 10) || 1));
                          setConsumoQty(val);
                        }}
                        className="w-14 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-sm font-mono font-bold text-amber-300 text-center focus:border-amber-500 outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setConsumoQty(prev => Math.min(bundleQty, prev + 1))}
                        className="w-7 h-7 bg-slate-800 hover:bg-slate-700 rounded flex items-center justify-center text-slate-200 active:scale-95"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Botones de Selección Rápida */}
                <div className="flex items-center gap-1.5 pt-0.5">
                  <span className="text-[10px] text-slate-500 font-bold uppercase mr-1">Atajos:</span>
                  <button
                    type="button"
                    onClick={() => setConsumoQty(Math.max(1, Math.round(bundleQty * 0.25)))}
                    className="px-2 py-0.5 text-[10px] font-mono font-bold bg-slate-900 border border-slate-700 hover:border-slate-500 rounded text-slate-300 transition"
                  >
                    25%
                  </button>
                  <button
                    type="button"
                    onClick={() => setConsumoQty(Math.max(1, Math.round(bundleQty * 0.5)))}
                    className="px-2 py-0.5 text-[10px] font-mono font-bold bg-slate-900 border border-slate-700 hover:border-slate-500 rounded text-slate-300 transition"
                  >
                    50%
                  </button>
                  <button
                    type="button"
                    onClick={() => setConsumoQty(bundleQty)}
                    className="px-2 py-0.5 text-[10px] font-mono font-bold bg-slate-900 border border-slate-700 hover:border-slate-500 rounded text-slate-300 transition"
                  >
                    100% (Total)
                  </button>
                </div>

                {/* Banner Reactivo de Saldo */}
                {bundleQty - consumoQty > 0 ? (() => {
                  let expectedSuffix = '-S1';
                  if (bultoData.pkgId) {
                    const match = bultoData.pkgId.match(/-S(\d+)$/i);
                    if (match) {
                      const currentNum = parseInt(match[1], 10) || 1;
                      expectedSuffix = `-S${currentNum + 1}`;
                    }
                  }
                  return (
                    <div className="p-3 bg-amber-950/40 border border-amber-600/50 rounded-xl space-y-1">
                      <div className="flex items-center gap-2 text-amber-300 font-bold text-xs uppercase tracking-wide">
                        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                        <span>⚠️ BULTO ABIERTO · SALDO: {bundleQty - consumoQty} und</span>
                      </div>
                      <p className="text-[11px] text-amber-200/80 leading-relaxed">
                        Se emitirá un nuevo rótulo de advertencia con sufijo <b>{expectedSuffix}</b> para sustituir el rótulo físico en el paquete.
                      </p>
                    </div>
                  );
                })() : (
                  <div className="p-3 bg-emerald-950/40 border border-emerald-600/50 rounded-xl space-y-1">
                    <div className="flex items-center gap-2 text-emerald-300 font-bold text-xs uppercase tracking-wide">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>CONSUMO TOTAL (100%)</span>
                    </div>
                    <p className="text-[11px] text-emerald-200/80 leading-relaxed">
                      El bulto ha sido consumido por completo en taller. No se requiere nuevo rótulo físico.
                    </p>
                  </div>
                )}

                {/* Botón de Confirmación */}
                <button
                  type="button"
                  onClick={handleConfirmFraccionamiento}
                  className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition active:scale-[0.98] ${
                    bundleQty - consumoQty > 0
                      ? 'bg-amber-600 hover:bg-amber-500 text-slate-950 font-black'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  }`}
                >
                  {bundleQty - consumoQty > 0 ? (
                    <>
                      <Printer className="w-4 h-4" />
                      <span>Confirmar y Emitir Rótulo de Saldo ({bundleQty - consumoQty} und)</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Confirmar Consumo Total en Taller</span>
                    </>
                  )}
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={() => handleActionClick('dispatch')}
                  className="w-full py-3 px-4 rounded-xl font-bold text-sm bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-950/30 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                >
                  <Send className="w-4 h-4" />
                  <span>Despachar a Taller / Producción</span>
                </button>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleActionClick('fractionate')}
                    className="py-2.5 px-3 rounded-xl font-semibold text-xs bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center justify-center gap-1.5 transition-colors"
                    title="Registrar consumo parcial en corte y emitir rótulo de saldo remanente"
                  >
                    <Scissors className="w-3.5 h-3.5 text-amber-400" />
                    <span>Fraccionar / Saldo Taller</span>
                  </button>

                  <button
                    onClick={() => handleActionClick('reprint')}
                    className="py-2.5 px-3 rounded-xl font-semibold text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Printer className="w-3.5 h-3.5 text-slate-400" />
                    <span>Reimprimir Etiqueta</span>
                  </button>
                </div>

                {hasPermission('Revisar_OAB') && (
                  <button
                    onClick={() => handleActionClick('oab')}
                    className="w-full py-2 px-3 rounded-xl font-medium text-xs bg-slate-900/60 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                    <span>Ver Expediente OAB</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-slate-950 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            <span>Verificación en tiempo real</span>
          </div>
          <span>Sanesca Suite Industrial v2.0</span>
        </div>
      </div>
    </div>
  );
};
