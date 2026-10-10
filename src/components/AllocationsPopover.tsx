import React from 'react';
import { InsumoSummary, StoreAllocation } from '../services/inventoryService';
import { Building2, ArrowRightLeft, Plus, ExternalLink, X, ShieldCheck } from 'lucide-react';

interface AllocationsPopoverProps {
  materialNombre: string;
  codigo?: string;
  stockBase: number;
  summary?: InsumoSummary;
  onOpenPanoramic?: (proyectoId?: string) => void;
  onDirectAllocate?: () => void;
  onReassign?: (alloc: StoreAllocation) => void;
  onClose: () => void;
}

export const AllocationsPopover: React.FC<AllocationsPopoverProps> = ({
  materialNombre,
  codigo,
  stockBase,
  summary,
  onOpenPanoramic,
  onDirectAllocate,
  onReassign,
  onClose,
}) => {
  const desglose = summary?.desglose || [];
  const totalApartado = summary?.totalApartado || 0;
  const totalTransito = summary?.totalTransito || 0;
  const disponibleLibre = Math.max(0, stockBase - totalApartado);

  return (
    <div 
      className="absolute z-50 mt-1 right-0 sm:right-auto sm:left-1/2 sm:-translate-x-1/2 w-80 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-3.5 text-slate-200 animate-in fade-in zoom-in-95 duration-150 backdrop-blur-md"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Encabezado */}
      <div className="flex items-start justify-between border-b border-slate-800 pb-2 mb-2.5">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400">
            <Building2 className="w-3.5 h-3.5 text-amber-400" />
            <span>Stock Comprometido por Obra</span>
          </div>
          <div className="text-[11px] font-semibold text-slate-100 truncate max-w-[200px]" title={materialNombre}>
            {materialNombre}
          </div>
          {codigo && <div className="text-[9px] font-mono text-slate-400">{codigo}</div>}
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-200 p-0.5 rounded hover:bg-slate-800 transition"
          title="Cerrar"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Métricas Resumidas */}
      <div className="grid grid-cols-3 gap-1.5 bg-slate-950/60 p-2 rounded-lg border border-slate-800/80 mb-3 text-center">
        <div>
          <span className="block text-[9px] text-slate-400 uppercase font-semibold">Total Físico</span>
          <span className="text-xs font-mono font-bold text-slate-200">{stockBase}</span>
        </div>
        <div>
          <span className="block text-[9px] text-amber-400 uppercase font-semibold">Apartado</span>
          <span className="text-xs font-mono font-bold text-amber-400">
            {totalApartado}
            {totalTransito > 0 && <span className="text-[9px] text-cyan-300 font-normal"> (+{totalTransito} camión)</span>}
          </span>
        </div>
        <div>
          <span className="block text-[9px] text-emerald-400 uppercase font-semibold">Libre</span>
          <span className={`text-xs font-mono font-bold ${disponibleLibre === 0 ? 'text-red-400' : 'text-emerald-400'}`}>
            {disponibleLibre}
          </span>
        </div>
      </div>

      {/* Lista de Tiendas con Reserva */}
      <div className="space-y-1.5 max-h-44 overflow-y-auto pr-0.5 scrollbar-thin">
        {desglose.length === 0 ? (
          <div className="text-center py-3 text-[11px] text-slate-400 bg-slate-800/20 rounded-md border border-dashed border-slate-800">
            <ShieldCheck className="w-4 h-4 mx-auto mb-1 text-emerald-400/80" />
            Sin reservas para obras particulares.
            <span className="block text-[9px] text-slate-500 mt-0.5">100% disponible para consumo libre</span>
          </div>
        ) : (
          desglose.map((alloc) => (
            <div 
              key={alloc.id || `${alloc.dashboardId}-${alloc.proyectoId}`}
              className="bg-slate-800/40 hover:bg-slate-800/70 border border-slate-700/60 rounded-lg p-2 transition flex items-center justify-between"
            >
              <div className="min-w-0 pr-2">
                <div className="text-[11px] font-semibold text-slate-200 truncate" title={alloc.proyectoNombre}>
                  {alloc.proyectoNombre}
                </div>
                <div className="flex items-center gap-2 text-[10px] font-mono mt-0.5">
                  <span className="text-emerald-300 flex items-center gap-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                    {alloc.cantidadApartada} {alloc.unidad || 'un.'} en galpón
                  </span>
                  {(alloc.cantidadTransito || 0) > 0 && (
                    <span className="text-cyan-300 flex items-center gap-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 inline-block" />
                      +{alloc.cantidadTransito} tránsito
                    </span>
                  )}
                </div>
              </div>

              {onReassign && (
                <button
                  type="button"
                  onClick={() => onReassign(alloc)}
                  className="px-2 py-1 rounded bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 hover:text-amber-200 text-[10px] font-semibold flex items-center gap-1 active:scale-95 transition shrink-0"
                  title={`Reasignar ${alloc.insumoNombre} de ${alloc.proyectoNombre} a otra obra`}
                >
                  <ArrowRightLeft className="w-2.5 h-2.5" />
                  <span>Reasignar</span>
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Acciones al pie */}
      <div className="mt-3 pt-2 border-t border-slate-800 flex items-center gap-2">
        {onDirectAllocate && (
          <button
            type="button"
            onClick={onDirectAllocate}
            disabled={disponibleLibre <= 0}
            className={`flex-1 py-1.5 px-2 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1 transition ${
              disponibleLibre > 0
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm active:scale-95'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50'
            }`}
          >
            <Plus className="w-3 h-3" />
            <span>Apartar Libre</span>
          </button>
        )}

        {onOpenPanoramic && (
          <button
            type="button"
            onClick={() => onOpenPanoramic()}
            className="flex-1 py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[10px] font-semibold flex items-center justify-center gap-1 transition active:scale-95"
          >
            <ExternalLink className="w-3 h-3 text-cyan-400" />
            <span>Ver Tablero</span>
          </button>
        )}
      </div>
    </div>
  );
};
