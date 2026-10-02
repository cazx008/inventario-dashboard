import React, { useState, useRef, useEffect } from 'react';
import { Search, SlidersHorizontal, ArrowUpDown, Layers, RotateCcw, Check, ChevronDown, ChevronUp, Eye } from 'lucide-react';
import { ColumnDef, SortLevel } from '../types/inventory';

interface FilterBarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  viewMode: 'compact' | 'expanded' | 'custom';
  onSetViewMode: (mode: 'compact' | 'expanded') => void;
  allColumns: ColumnDef[];
  visibleColumns: string[];
  onToggleColumn: (key: string) => void;
  sortLevels: SortLevel[];
  onAddSortLevel: (key: string, dir: 'asc' | 'desc') => void;
  onRemoveSortLevel: (idx: number) => void;
  groupByKey: string | null;
  onSetGroupBy: (key: string | null) => void;
  quickFilters: {
    estadoStock: string[];
    prioridad: string[];
  };
  onToggleQuickFilter: (group: 'estadoStock' | 'prioridad', value: string) => void;
  onResetAll: () => void;
  hasActiveFilters: boolean;
  filteredCount: number;
  totalCount: number;
  onlyDeficit: boolean;
  onToggleOnlyDeficit: () => void;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  searchQuery,
  onSearchChange,
  viewMode,
  onSetViewMode,
  allColumns,
  visibleColumns,
  onToggleColumn,
  sortLevels,
  onAddSortLevel,
  onRemoveSortLevel,
  groupByKey,
  onSetGroupBy,
  quickFilters,
  onToggleQuickFilter,
  onResetAll,
  hasActiveFilters,
  filteredCount,
  totalCount,
  onlyDeficit,
  onToggleOnlyDeficit
}) => {
  const [viewOpen, setViewOpen] = useState(false);
  const [colsOpen, setColsOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);

  // Close dropdowns on click outside
  const toolbarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setViewOpen(false);
        setColsOpen(false);
        setSortOpen(false);
        setGroupOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const estadoBadges = [
    { value: 'Sin Stock', label: '🔴 Sin Stock', activeClass: 'badge-active-red' },
    { value: 'Bajo Mínimo', label: '🟠 Bajo Mín.', activeClass: 'badge-active-orange' },
    { value: 'En Stock', label: '🟢 En Stock', activeClass: 'badge-active-green' },
    { value: 'En Reconteo', label: '🔵 En Reconteo', activeClass: 'badge-active-blue' },
    { value: 'Descontinuado', label: '⚫ Descont.', activeClass: 'badge-active-gray' },
  ];

  const prioridadBadges = [
    { value: 'Urgente', label: '🔴 Urgente', activeClass: 'badge-active-red' },
    { value: 'Alta', label: '🟠 Alta', activeClass: 'badge-active-orange' },
    { value: 'Media', label: '🟡 Media', activeClass: 'badge-active-yellow' },
    { value: 'Baja', label: '🟢 Baja', activeClass: 'badge-active-green' },
    { value: 'Por Pedido', label: '🔵 Por Pedido', activeClass: 'badge-active-blue' },
  ];

  return (
    <div ref={toolbarRef} className="bg-surface border border-borderSubtle rounded-lg p-3 space-y-2.5 no-print">
      {/* Row 1: Search + Tool Buttons */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar por nombre, código, marca..."
            className="w-full pl-9 pr-3 py-1.5 text-xs sm:text-sm bg-page border border-borderSubtle rounded-md text-slate-200 placeholder-slate-500 focus:outline-none focus:border-brand-400 transition"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white"
            >
              ✕
            </button>
          )}
        </div>

        {/* Solo Déficit Switch */}
        <button
          onClick={onToggleOnlyDeficit}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border transition ${
            onlyDeficit
              ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
              : 'bg-page border-borderSubtle text-slate-400 hover:text-slate-200 hover:border-slate-500'
          }`}
          title="Filtrar solo artículos con déficit de stock"
        >
          <span>⚠️ Solo Déficit</span>
          {onlyDeficit && <Check className="w-3 h-3 text-amber-400" />}
        </button>

        {/* Mobile toolbar toggle */}
        <button
          onClick={() => setMobileToolsOpen(!mobileToolsOpen)}
          className={`sm:hidden flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-page border border-borderSubtle rounded-md text-slate-300 transition ${
            hasActiveFilters ? 'border-brand-500 text-brand-400' : ''
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span>Herramientas</span>
          {mobileToolsOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>

        {/* Tools Menu (sm+ desktop or expanded on mobile) */}
        <div className={`flex flex-wrap items-center gap-2 ${mobileToolsOpen ? 'w-full mt-2' : 'hidden sm:flex'}`}>
          {/* Vista Selector */}
          <div className="relative">
            <button
              onClick={() => { setViewOpen(!viewOpen); setColsOpen(false); setSortOpen(false); setGroupOpen(false); }}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-page border border-borderSubtle rounded-md text-slate-300 hover:text-white hover:border-slate-500 transition"
            >
              <Eye className="w-3.5 h-3.5 text-slate-400" />
              <span>Vista: </span>
              <span className="text-brand-400 font-semibold">
                {viewMode === 'compact' ? 'Compacta' : viewMode === 'expanded' ? 'Ampliada' : 'Custom'}
              </span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>
            {viewOpen && (
              <div className="absolute top-full mt-1 left-0 panel-dropdown p-1 min-w-[150px] z-30">
                <button
                  onClick={() => { onSetViewMode('compact'); setViewOpen(false); }}
                  className={`w-full text-left px-3 py-1.5 text-xs rounded hover:bg-surfaceHigh text-slate-300 ${
                    viewMode === 'compact' ? 'text-brand-400 font-semibold' : ''
                  }`}
                >
                  Compacta (6 col)
                </button>
                <button
                  onClick={() => { onSetViewMode('expanded'); setViewOpen(false); }}
                  className={`w-full text-left px-3 py-1.5 text-xs rounded hover:bg-surfaceHigh text-slate-300 ${
                    viewMode === 'expanded' ? 'text-brand-400 font-semibold' : ''
                  }`}
                >
                  Ampliada (todas)
                </button>
              </div>
            )}
          </div>

          {/* Column Selector */}
          <div className="relative">
            <button
              onClick={() => { setColsOpen(!colsOpen); setViewOpen(false); setSortOpen(false); setGroupOpen(false); }}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-page border border-borderSubtle rounded-md text-slate-300 hover:text-white hover:border-slate-500 transition"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
              <span>Columnas</span>
            </button>
            {colsOpen && (
              <div className="absolute top-full mt-1 left-0 panel-dropdown p-2 min-w-[220px] max-h-[300px] overflow-y-auto custom-scrollbar z-30">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1 px-1">
                  Columnas Visibles
                </p>
                {allColumns.map(col => (
                  <label key={col.key} className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-surfaceHigh rounded cursor-pointer">
                    <input
                      type="checkbox"
                      checked={visibleColumns.includes(col.key)}
                      onChange={() => onToggleColumn(col.key)}
                      className="rounded bg-page border-borderSubtle text-brand-500 focus:ring-0"
                    />
                    <span>{col.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Sort Selector */}
          <div className="relative">
            <button
              onClick={() => { setSortOpen(!sortOpen); setViewOpen(false); setColsOpen(false); setGroupOpen(false); }}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-page border border-borderSubtle rounded-md text-slate-300 hover:text-white hover:border-slate-500 transition ${
                sortLevels.length > 0 ? 'border-brand-500 text-brand-400' : ''
              }`}
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              <span>Ordenar</span>
              {sortLevels.length > 0 && (
                <span className="bg-brand-500/20 text-brand-400 px-1 rounded text-[10px]">
                  {sortLevels.length}
                </span>
              )}
            </button>
            {sortOpen && (
              <div className="absolute top-full mt-1 left-0 panel-dropdown p-3 min-w-[280px] z-30 space-y-2">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                  Ordenar por (hasta 3 niveles)
                </p>
                {sortLevels.map((lvl, idx) => (
                  <div key={idx} className="flex items-center gap-1.5 text-xs">
                    <span className="text-slate-400 font-mono w-4">{idx + 1}.</span>
                    <span className="text-slate-200 flex-1 font-medium">
                      {allColumns.find(c => c.key === lvl.key)?.label || lvl.key}
                    </span>
                    <span className="text-brand-400 text-[11px] font-mono uppercase">
                      {lvl.dir === 'asc' ? '↑ Asc' : '↓ Desc'}
                    </span>
                    <button
                      onClick={() => onRemoveSortLevel(idx)}
                      className="text-red-400 hover:text-red-300 px-1 ml-1"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {sortLevels.length < 3 && (
                  <div className="pt-2 border-t border-borderSubtle flex items-center gap-1">
                    <select
                      onChange={(e) => {
                        if (e.target.value) {
                          onAddSortLevel(e.target.value, 'asc');
                          e.target.value = '';
                        }
                      }}
                      className="text-xs bg-page border border-borderSubtle rounded px-2 py-1 text-slate-300 w-full"
                      defaultValue=""
                    >
                      <option value="" disabled>+ Agregar criterio...</option>
                      {allColumns.filter(c => c.sortable && !sortLevels.some(l => l.key === c.key)).map(c => (
                        <option key={c.key} value={c.key}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Group Selector */}
          <div className="relative">
            <button
              onClick={() => { setGroupOpen(!groupOpen); setViewOpen(false); setColsOpen(false); setSortOpen(false); }}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-page border border-borderSubtle rounded-md text-slate-300 hover:text-white hover:border-slate-500 transition ${
                groupByKey ? 'border-brand-500 text-brand-400' : ''
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Agrupar</span>
              {groupByKey && <span className="text-[10px] text-brand-400">●</span>}
            </button>
            {groupOpen && (
              <div className="absolute top-full mt-1 left-0 panel-dropdown p-2 min-w-[200px] z-30 space-y-1">
                <button
                  onClick={() => { onSetGroupBy(null); setGroupOpen(false); }}
                  className={`w-full text-left px-2.5 py-1.5 text-xs rounded hover:bg-surfaceHigh ${
                    !groupByKey ? 'text-brand-400 font-semibold' : 'text-slate-300'
                  }`}
                >
                  Sin agrupar
                </button>
                {allColumns.filter(c => c.groupable).map(col => (
                  <button
                    key={col.key}
                    onClick={() => { onSetGroupBy(col.key); setGroupOpen(false); }}
                    className={`w-full text-left px-2.5 py-1.5 text-xs rounded hover:bg-surfaceHigh ${
                      groupByKey === col.key ? 'text-brand-400 font-semibold' : 'text-slate-300'
                    }`}
                  >
                    {col.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Reset All */}
          <button
            onClick={onResetAll}
            disabled={!hasActiveFilters}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-page border border-borderSubtle rounded-md transition ${
              hasActiveFilters
                ? 'text-red-400 border-red-500/40 hover:bg-red-500/10 cursor-pointer'
                : 'text-slate-500 cursor-not-allowed opacity-50'
            }`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {/* Row 2: Quick Filter Badges */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 overflow-x-auto custom-scrollbar pb-0.5">
        {/* Estado badges */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mr-1">
            Estado:
          </span>
          {estadoBadges.map(b => {
            const isActive = quickFilters.estadoStock.includes(b.value);
            return (
              <button
                key={b.value}
                onClick={() => onToggleQuickFilter('estadoStock', b.value)}
                className={`px-2 py-0.5 text-[11px] font-medium rounded-md transition ${
                  isActive ? b.activeClass : 'badge-inactive'
                }`}
              >
                {b.label}
              </button>
            );
          })}
        </div>

        {/* Prioridad badges */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mr-1">
            Prioridad:
          </span>
          {prioridadBadges.map(b => {
            const isActive = quickFilters.prioridad.includes(b.value);
            return (
              <button
                key={b.value}
                onClick={() => onToggleQuickFilter('prioridad', b.value)}
                className={`px-2 py-0.5 text-[11px] font-medium rounded-md transition ${
                  isActive ? b.activeClass : 'badge-inactive'
                }`}
              >
                {b.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Row 3: Conteo */}
      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-0.5">
        <span>
          Mostrando <span className="text-slate-200 font-medium font-mono">{filteredCount}</span> de{' '}
          <span className="font-mono">{totalCount}</span> ítems
        </span>
        {groupByKey && (
          <span className="text-brand-400">
            Agrupado por: {allColumns.find(c => c.key === groupByKey)?.label || groupByKey}
          </span>
        )}
      </div>
    </div>
  );
};
