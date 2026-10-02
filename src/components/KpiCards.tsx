import React from 'react';
import { KpiSummary } from '../types/inventory';

interface KpiCardsProps {
  kpis: KpiSummary;
  isFiltered: boolean;
  onFilterByStatus?: (status: string) => void;
  selectedStatus?: string[];
}

export const KpiCards: React.FC<KpiCardsProps> = ({
  kpis,
  isFiltered,
  onFilterByStatus,
  selectedStatus = []
}) => {
  return (
    <div className="space-y-2 no-print">
      {isFiltered && (
        <div className="flex items-center gap-2 text-[10px] text-brand-400 font-medium uppercase tracking-wider">
          <span className="px-1.5 py-0.5 rounded bg-brand-500/15 border border-brand-500/30">
            Filtrado
          </span>
          <span className="text-slate-500">Mostrando KPIs del subconjunto filtrado</span>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {/* Sin Stock */}
        <div
          onClick={() => onFilterByStatus && onFilterByStatus('Sin Stock')}
          className={`bg-surface border border-borderSubtle rounded-lg p-3 border-l-4 border-l-red-500 cursor-pointer hover:bg-surfaceHigh transition ${
            selectedStatus.includes('Sin Stock') ? 'ring-1 ring-red-400 bg-red-950/20' : ''
          }`}
          title="Filtrar por Sin Stock"
        >
          <p className="text-xs text-slate-400 font-medium">🔴 Sin Stock</p>
          <p className="text-2xl font-bold font-mono text-red-400 mt-1">{kpis.estado.sinStock}</p>
        </div>

        {/* Bajo Mínimo */}
        <div
          onClick={() => onFilterByStatus && onFilterByStatus('Bajo Mínimo')}
          className={`bg-surface border border-borderSubtle rounded-lg p-3 border-l-4 border-l-orange-500 cursor-pointer hover:bg-surfaceHigh transition ${
            selectedStatus.includes('Bajo Mínimo') ? 'ring-1 ring-orange-400 bg-orange-950/20' : ''
          }`}
          title="Filtrar por Bajo Mínimo"
        >
          <p className="text-xs text-slate-400 font-medium">🟠 Bajo Mínimo</p>
          <p className="text-2xl font-bold font-mono text-orange-400 mt-1">{kpis.estado.bajoMinimo}</p>
        </div>

        {/* En Stock */}
        <div
          onClick={() => onFilterByStatus && onFilterByStatus('En Stock')}
          className={`bg-surface border border-borderSubtle rounded-lg p-3 border-l-4 border-l-emerald-500 cursor-pointer hover:bg-surfaceHigh transition ${
            selectedStatus.includes('En Stock') ? 'ring-1 ring-emerald-400 bg-emerald-950/20' : ''
          }`}
          title="Filtrar por En Stock"
        >
          <p className="text-xs text-slate-400 font-medium">🟢 En Stock</p>
          <p className="text-2xl font-bold font-mono text-emerald-400 mt-1">{kpis.estado.enStock}</p>
        </div>

        {/* En Reconteo */}
        <div
          onClick={() => onFilterByStatus && onFilterByStatus('En Reconteo')}
          className={`bg-surface border border-borderSubtle rounded-lg p-3 border-l-4 border-l-blue-500 cursor-pointer hover:bg-surfaceHigh transition ${
            selectedStatus.includes('En Reconteo') ? 'ring-1 ring-blue-400 bg-blue-950/20' : ''
          }`}
          title="Filtrar por En Reconteo"
        >
          <p className="text-xs text-slate-400 font-medium">🔵 En Reconteo</p>
          <p className="text-2xl font-bold font-mono text-blue-400 mt-1">{kpis.estado.enReconteo}</p>
        </div>

        {/* Auditados 3D */}
        <div className="bg-surface border border-borderSubtle rounded-lg p-3 border-l-4 border-l-purple-500 col-span-2 sm:col-span-1">
          <p className="text-xs text-slate-400 font-medium">📋 Auditados 3D</p>
          <p className="text-2xl font-bold font-mono text-purple-400 mt-1">
            {kpis.auditados3DPct}%
            <span className="text-xs text-slate-500 font-normal ml-1.5">
              ({kpis.auditados3D} ítems)
            </span>
          </p>
        </div>
      </div>
    </div>
  );
};
