import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { InsumoSummary, StoreAllocation } from '../services/inventoryService';
import { 
  Building2, 
  ArrowRightLeft, 
  Plus, 
  ExternalLink, 
  X, 
  ShieldCheck, 
  Printer, 
  ArrowUpRight, 
  Truck 
} from 'lucide-react';

interface AllocationsPopoverProps {
  materialNombre: string;
  codigo?: string;
  stockBase: number;
  summary?: InsumoSummary;
  anchorRect?: DOMRect | null;
  onOpenPanoramic?: (proyectoId?: string) => void;
  onDirectAllocate?: () => void;
  onDispatchAlloc?: (alloc: StoreAllocation) => void;
  onOpenRampaForAlloc?: (alloc: StoreAllocation) => void;
  onReassign?: (alloc: StoreAllocation) => void;
  onReprintLabel?: (alloc: StoreAllocation) => void;
  onClose: () => void;
}

export const AllocationsPopover: React.FC<AllocationsPopoverProps> = ({
  materialNombre,
  codigo,
  stockBase,
  summary,
  anchorRect,
  onOpenPanoramic,
  onDirectAllocate,
  onDispatchAlloc,
  onOpenRampaForAlloc,
  onReassign,
  onReprintLabel,
  onClose,
}) => {
  const desglose = summary?.desglose || [];
  const totalApartado = summary?.totalApartado || 0;
  const totalTransito = summary?.totalTransito || 0;
  const disponibleLibre = Math.max(0, stockBase - totalApartado);

  // Detección reactiva de modo móvil (<640px)
  const [isMobile, setIsMobile] = useState<boolean>(() => 
    typeof window !== 'undefined' ? window.innerWidth < 640 : false
  );

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 640);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Cierre con tecla Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Cálculo de coordenadas en Desktop para evitar colisiones y clipping
  const popoverWidth = 440;
  const popoverEstHeight = 360;

  let desktopStyle: React.CSSProperties = {
    width: `${popoverWidth}px`,
  };

  if (anchorRect && !isMobile) {
    const spaceBelow = window.innerHeight - anchorRect.bottom;
    const placeTop = spaceBelow < popoverEstHeight && anchorRect.top > popoverEstHeight;

    const top = placeTop 
      ? Math.max(12, anchorRect.top - popoverEstHeight - 6) 
      : Math.min(window.innerHeight - popoverEstHeight - 12, anchorRect.bottom + 6);

    let left = anchorRect.left + (anchorRect.width / 2) - (popoverWidth / 2);
    if (left < 16) left = 16;
    if (left + popoverWidth > window.innerWidth - 16) {
      left = window.innerWidth - popoverWidth - 16;
    }

    desktopStyle = {
      position: 'fixed',
      top: `${top}px`,
      left: `${left}px`,
      width: `${popoverWidth}px`,
      zIndex: 9999,
    };
  }

  const content = (
    <div 
      className="flex flex-col text-slate-200"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Encabezado */}
      <div className="flex items-start justify-between border-b border-slate-800 pb-2.5 mb-2.5">
        <div className="min-w-0 pr-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400">
            <Building2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>Stock Comprometido por Obra</span>
          </div>
          <div className="text-xs sm:text-[13px] font-semibold text-slate-100 truncate mt-0.5" title={materialNombre}>
            {materialNombre}
          </div>
          {codigo && <div className="text-[10px] font-mono text-slate-400">{codigo}</div>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800 transition shrink-0"
          title="Cerrar"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Métricas Resumidas */}
      <div className="grid grid-cols-3 gap-1.5 bg-slate-950/70 p-2.5 rounded-xl border border-slate-800 mb-3 text-center">
        <div>
          <span className="block text-[9px] text-slate-400 uppercase font-semibold">Total Físico</span>
          <span className="text-xs sm:text-sm font-mono font-bold text-slate-200">{stockBase}</span>
        </div>
        <div>
          <span className="block text-[9px] text-amber-400 uppercase font-semibold">Apartado</span>
          <span className="text-xs sm:text-sm font-mono font-bold text-amber-400">
            {totalApartado}
            {totalTransito > 0 && <span className="text-[9px] text-cyan-300 font-normal"> (+{totalTransito} camión)</span>}
          </span>
        </div>
        <div>
          <span className="block text-[9px] text-emerald-400 uppercase font-semibold">Libre Común</span>
          <span className={`text-xs sm:text-sm font-mono font-bold ${disponibleLibre === 0 ? 'text-red-400' : 'text-emerald-400'}`}>
            {disponibleLibre}
          </span>
        </div>
      </div>

      {/* Lista de Reservas por Obra en 2 Niveles */}
      <div className="space-y-2 max-h-56 sm:max-h-60 overflow-y-auto pr-1 scrollbar-thin">
        {desglose.length === 0 ? (
          <div className="text-center py-4 text-xs text-slate-400 bg-slate-800/20 rounded-xl border border-dashed border-slate-800">
            <ShieldCheck className="w-5 h-5 mx-auto mb-1.5 text-emerald-400/80" />
            Sin reservas para obras particulares.
            <span className="block text-[10px] text-slate-500 mt-0.5">100% disponible para consumo libre</span>
          </div>
        ) : (
          desglose.map((alloc) => (
            <div 
              key={alloc.id || `${alloc.dashboardId}-${alloc.proyectoId}`}
              className="bg-slate-800/40 hover:bg-slate-800/70 border border-slate-700/60 rounded-xl p-2.5 transition flex flex-col gap-1.5"
            >
              {/* Nivel 1: Obra y Pedido en ancho completo sin truncamiento */}
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold text-xs text-slate-100 flex items-center gap-1.5 min-w-0">
                  <span className="truncate" title={alloc.proyectoNombre}>{alloc.proyectoNombre}</span>
                  {alloc.pedidoCodigo && (
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-cyan-300 shrink-0 font-bold">
                      {alloc.pedidoCodigo}
                    </span>
                  )}
                </div>
                <span className="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 shrink-0">
                  MTO
                </span>
              </div>

              {/* Nivel 2: Métricas a la izquierda, botones táctiles a la derecha */}
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-700/40">
                <div className="flex items-center gap-2 text-[10px] font-mono">
                  <span className="text-emerald-300 flex items-center gap-1 font-semibold">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                    {alloc.cantidadApartada} {alloc.unidad || 'un.'} en galpón
                  </span>
                  {(alloc.cantidadTransito || 0) > 0 && (
                    <span className="text-cyan-300 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 inline-block" />
                      +{alloc.cantidadTransito} tránsito
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {alloc.cantidadApartada > 0 ? (
                    onDispatchAlloc && (
                      <button
                        type="button"
                        onClick={() => onDispatchAlloc(alloc)}
                        className="px-2 py-1 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-sky-300 hover:text-sky-200 text-[10px] font-semibold flex items-center gap-1 active:scale-95 transition"
                        title={`Despachar ${alloc.insumoNombre} a taller para ${alloc.proyectoNombre}`}
                      >
                        <ArrowUpRight className="w-2.5 h-2.5" />
                        <span>Despachar</span>
                      </button>
                    )
                  ) : (alloc.cantidadTransito || 0) > 0 && onOpenRampaForAlloc ? (
                    <button
                      type="button"
                      onClick={() => onOpenRampaForAlloc(alloc)}
                      className="px-2 py-1 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 hover:text-cyan-200 text-[10px] font-semibold flex items-center gap-1 active:scale-95 transition"
                      title={`Ver unidades en tránsito para ${alloc.proyectoNombre} en Recepción en Rampa`}
                    >
                      <Truck className="w-2.5 h-2.5" />
                      <span>En Tránsito</span>
                    </button>
                  ) : null}

                  {onReprintLabel && (
                    <button
                      type="button"
                      onClick={() => onReprintLabel(alloc)}
                      className="px-2 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 hover:text-emerald-200 text-[10px] font-semibold flex items-center gap-1 active:scale-95 transition"
                      title={`Reimprimir etiqueta MTO para ${alloc.proyectoNombre}`}
                    >
                      <Printer className="w-2.5 h-2.5" />
                      <span>Rótulo</span>
                    </button>
                  )}

                  {onReassign && (
                    <button
                      type="button"
                      onClick={() => onReassign(alloc)}
                      className="px-2 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 hover:text-amber-200 text-[10px] font-semibold flex items-center gap-1 active:scale-95 transition"
                      title={`Reasignar ${alloc.insumoNombre} de ${alloc.proyectoNombre} a otra obra`}
                    >
                      <ArrowRightLeft className="w-2.5 h-2.5" />
                      <span>Reasignar</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Acciones al pie */}
      <div className="mt-3 pt-2.5 border-t border-slate-800 flex items-center gap-2">
        {onDirectAllocate && (
          <button
            type="button"
            onClick={onDirectAllocate}
            disabled={disponibleLibre <= 0}
            className={`flex-1 py-2 px-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition ${
              disponibleLibre > 0
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm active:scale-95 cursor-pointer'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Apartar Libre</span>
          </button>
        )}

        {onOpenPanoramic && (
          <button
            type="button"
            onClick={() => onOpenPanoramic()}
            className="flex-1 py-2 px-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5 text-cyan-400" />
            <span>Ver Tablero</span>
          </button>
        )}
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;

  // Renderizado Bimodal
  if (isMobile) {
    // Modo Móvil: Bottom Sheet táctil deslizable con Backdrop
    return createPortal(
      <div 
        className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex flex-col justify-end animate-in fade-in duration-150"
        onClick={onClose}
      >
        <div 
          className="bg-slate-900 border-t border-slate-700 rounded-t-2xl shadow-2xl p-4 max-h-[85vh] flex flex-col animate-in slide-in-from-bottom duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Barra de agarre táctil */}
          <div className="w-12 h-1 bg-slate-700 rounded-full mx-auto mb-3 shrink-0" />
          {content}
        </div>
      </div>,
      document.body
    );
  }

  // Modo Desktop: Portal Flotante con auto-posicionamiento inteligente anti-clipping
  return createPortal(
    <>
      {/* Backdrop transparente para capturar clics fuera del popover */}
      <div 
        className="fixed inset-0 z-[9998]"
        onClick={onClose}
      />
      <div 
        style={desktopStyle}
        className="bg-slate-900/95 border border-slate-700 rounded-2xl shadow-2xl p-4 text-slate-200 animate-in fade-in zoom-in-95 duration-150 backdrop-blur-md"
      >
        {content}
      </div>
    </>,
    document.body
  );
};
