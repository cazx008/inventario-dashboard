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
  Loader2
} from 'lucide-react';

export interface BultoData {
  folio: string;
  material: string;
  tienda: string;
  bulto: string; // formato "1_2" o "1"
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

  if (!isOpen || !bultoData) return null;

  const isMTO = bultoData.tienda && !bultoData.tienda.toLowerCase().includes('stock general');
  const cantApartada = allocationInfo?.cantidadApartada ?? null;
  const cantTransito = allocationInfo?.cantidadTransito ?? null;
  const cantRechazada = allocationInfo?.cantidadRechazada ?? 0;

  // Manejo de acciones con requerimiento de autenticación / PIN (D1-10B.1)
  const handleActionClick = (actionType: 'dispatch' | 'reprint' | 'oab') => {
    if (!isAuthenticated) {
      setPendingAction(actionType);
      setAuthPromptOpen(true);
      if (triggerHaptic) triggerHaptic('warning');
      return;
    }

    executeAction(actionType);
  };

  const executeAction = (actionType: 'dispatch' | 'reprint' | 'oab') => {
    if (actionType === 'dispatch') {
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

          {/* Tríada Operativa de Planta (D5-10B.1) */}
          <div className="pt-2 space-y-2">
            <button
              onClick={() => handleActionClick('dispatch')}
              className="w-full py-3 px-4 rounded-xl font-bold text-sm bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-950/30 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
            >
              <Send className="w-4 h-4" />
              <span>Despachar a Taller / Producción</span>
            </button>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleActionClick('reprint')}
                className="py-2.5 px-3 rounded-xl font-semibold text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center justify-center gap-1.5 transition-colors"
              >
                <Printer className="w-3.5 h-3.5 text-slate-400" />
                <span>Reimprimir Etiqueta</span>
              </button>

              {hasPermission('Revisar_OAB') && (
                <button
                  onClick={() => handleActionClick('oab')}
                  className="py-2.5 px-3 rounded-xl font-semibold text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center justify-center gap-1.5 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                  <span>Ver Expediente OAB</span>
                </button>
              )}
            </div>
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
