import React, { useState } from 'react';
import { ChevronRight, ChevronDown, PlusCircle, BookOpen, ArrowUpRight, Scale } from 'lucide-react';
import { InventoryItem, ColumnDef, SortLevel } from '../types/inventory';

interface InventoryTableProps {
  items: InventoryItem[];
  allColumns: ColumnDef[];
  visibleColumns: string[];
  sortLevels: SortLevel[];
  onToggleSort: (key: string) => void;
  groupByKey: string | null;
  selectOrders?: Record<string, string[]>;
  onAddToDraft?: (item: InventoryItem) => void;
  onOpenKardexItem?: (item: InventoryItem) => void;
  onOpenDispatchItem?: (item: InventoryItem) => void;
  onOpenAdjustmentItem?: (item: InventoryItem) => void;
  loading?: boolean;
  loadError?: boolean;
  onRetry?: () => void;
  onResetFilters?: () => void;
}

export const InventoryTable: React.FC<InventoryTableProps> = ({
  items,
  allColumns,
  visibleColumns,
  sortLevels,
  onToggleSort,
  groupByKey,
  selectOrders = {},
  onAddToDraft,
  onOpenKardexItem,
  onOpenDispatchItem,
  onOpenAdjustmentItem,
  loading = false,
  loadError = false,
  onRetry,
  onResetFilters
}) => {
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);

  const toggleGroupCollapse = (label: string) => {
    setCollapsedGroups(prev =>
      prev.includes(label) ? prev.filter(g => g !== label) : [...prev, label]
    );
  };

  const activeCols = allColumns.filter(c => visibleColumns.includes(c.key));

  const renderBadge = (name?: string, color?: string) => {
    if (!name) return <span className="text-slate-500">—</span>;
    const colorMap: Record<string, string> = {
      red: 'bg-red-500/15 text-red-400 border border-red-500/30',
      orange: 'bg-orange-500/15 text-orange-400 border border-orange-500/30',
      yellow: 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30',
      green: 'bg-green-500/15 text-green-400 border border-green-500/30',
      blue: 'bg-blue-500/15 text-blue-400 border border-blue-500/30',
      gray: 'bg-slate-500/15 text-slate-400 border border-slate-500/30',
    };
    const cls = color ? colorMap[color] || 'bg-slate-500/15 text-slate-400' : 'bg-slate-500/15 text-slate-400';
    return (
      <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${cls}`}>
        {name}
      </span>
    );
  };

  const renderCellValue = (row: InventoryItem, key: string) => {
    switch (key) {
      case 'nombre':
        return (
          <div className="flex items-center gap-2">
            <span className="text-slate-100 font-medium">{row.nombre}</span>
            {row.codigo && (
              <span className="text-[10px] text-slate-500 font-mono">
                [{row.codigo}]
              </span>
            )}
            <div className="flex items-center gap-1 ml-auto opacity-0 group-hover:opacity-100 transition">
              {onOpenDispatchItem && (row.stockBase || 0) > 0 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenDispatchItem(row);
                  }}
                  className="text-rose-400 hover:text-rose-300 transition text-[11px] p-0.5 rounded hover:bg-surfaceHigh"
                  title={`Despachar ${row.nombre} a taller`}
                >
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              )}
              {onOpenAdjustmentItem && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenAdjustmentItem(row);
                  }}
                  className="text-amber-400 hover:text-amber-300 transition text-[11px] p-0.5 rounded hover:bg-surfaceHigh"
                  title={`Conteo Cíclico / Ajustar existencias de ${row.nombre}`}
                >
                  <Scale className="w-3.5 h-3.5" />
                </button>
              )}
              {onOpenKardexItem && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenKardexItem(row);
                  }}
                  className="text-emerald-400 hover:text-emerald-300 transition text-[11px] p-0.5 rounded hover:bg-surfaceHigh"
                  title={`Ver historial Kardex de ${row.nombre}`}
                >
                  <BookOpen className="w-3.5 h-3.5" />
                </button>
              )}
              {onAddToDraft && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddToDraft(row);
                  }}
                  className="text-brand-400 hover:text-brand-300 transition text-[11px] p-0.5 rounded hover:bg-surfaceHigh"
                  title="Agregar a solicitud de compra"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        );
      case 'codigo':
        return <span className="font-mono text-slate-400 text-xs">{row.codigo || '—'}</span>;
      case 'marca':
        return <span className="text-slate-300">{row.marca || '—'}</span>;
      case 'stockBase': {
        const isZero = row.stockBase === 0;
        return (
          <div className="flex items-center justify-end gap-1.5">
            {row.isOptimisticSync && (
              <span
                className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse"
                title={row.syncNote || 'Sincronizando existencias con Notion ERP...'}
              />
            )}
            <span className={`font-mono ${isZero ? 'text-red-400 font-bold' : 'text-slate-200'}`}>
              {row.stockBase}
            </span>
          </div>
        );
      }
      case 'stockMinimo':
        return <span className="font-mono text-slate-400">{row.stockMinimo}</span>;
      case 'deficit':
        return row.deficit > 0 ? (
          <span className="font-mono text-orange-400 font-semibold">-{row.deficit}</span>
        ) : (
          <span className="font-mono text-slate-500">—</span>
        );
      case 'enTransitoOAB':
        return (
          <div className="flex items-center justify-end gap-1.5">
            {row.isOptimisticSync && (
              <span
                className="inline-block w-2 h-2 rounded-full bg-cyan-400 animate-pulse"
                title={row.syncNote || 'Sincronizando orden con Notion ERP...'}
              />
            )}
            {(row.enTransitoOAB || 0) > 0 ? (
              <span className="font-mono text-signal-blue font-semibold">+{row.enTransitoOAB}</span>
            ) : (
              <span className="font-mono text-slate-600">0</span>
            )}
          </div>
        );
      case 'stockProyectado':
        return (
          <span className="font-mono text-slate-300 font-medium">
            {row.stockProyectado ?? row.stockBase}
          </span>
        );
      case 'estadoStock':
        return renderBadge(row.estadoStock, row.estadoStockColor);
      case 'prioridad':
        return renderBadge(row.prioridad, row.prioridadColor);
      case 'categoriaMaterial':
      case 'rolMaterial':
      case 'origenConsumo':
      case 'grupoProceso':
      case 'proceso':
      case 'departamento':
        return <span className="text-slate-300 text-xs">{(row as any)[key] || '—'}</span>;
      case 'unidad':
      case 'color':
        return <span className="text-slate-400 text-xs">{(row as any)[key] || '—'}</span>;
      case 'dimensiones':
        return <span className="text-slate-400 text-xs font-mono">{row.dimensiones || '—'}</span>;
      case 'seReconto3D':
        return row.seReconto3D ? (
          <span className="text-emerald-400 font-medium">✓ Sí</span>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenAdjustmentItem?.(row);
            }}
            className="text-amber-400 hover:text-amber-300 font-mono text-[11px] hover:underline"
            title="Pendiente de conteo físico - Clic para auditar"
          >
            Recontar
          </button>
        );
      case 'diasDesdeReconteo':
        return row.diasDesdeReconteo !== null && row.diasDesdeReconteo !== undefined ? (
          <span className={`font-mono text-xs ${row.diasDesdeReconteo > 7 ? 'text-amber-400 font-bold' : 'text-slate-400'}`}>
            {row.diasDesdeReconteo}d
          </span>
        ) : (
          <span className="text-slate-500">—</span>
        );
      default:
        return <span>{(row as any)[key] ?? '—'}</span>;
    }
  };

  // Grouping logic
  const groupedData: { label: string; count: number; items: InventoryItem[] }[] = [];
  if (groupByKey) {
    const map = new Map<string, InventoryItem[]>();
    for (const item of items) {
      const val = (item as any)[groupByKey] || '(Sin valor)';
      if (!map.has(val)) map.set(val, []);
      map.get(val)!.push(item);
    }
    const order = selectOrders[groupByKey];
    const entries = [...map.entries()];
    if (order) {
      entries.sort((a, b) => {
        const ai = order.indexOf(a[0]);
        const bi = order.indexOf(b[0]);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      });
    }
    for (const [label, grpItems] of entries) {
      groupedData.push({ label, count: grpItems.length, items: grpItems });
    }
  }

  if (loading) {
    return (
      <div className="bg-surface border border-borderSubtle rounded-lg py-16 flex flex-col items-center justify-center text-slate-400">
        <div className="w-6 h-6 border-2 border-brand-400 border-t-transparent rounded-full animate-spin mb-3"></div>
        <p className="text-sm">Cargando inventario de planta...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="bg-surface border border-borderSubtle rounded-lg py-16 flex flex-col items-center justify-center text-slate-300">
        <p className="text-lg font-bold text-red-400 mb-1">⚠️ Error al cargar inventario</p>
        <p className="text-xs text-slate-500 mb-4">No se pudo sincronizar la data de planta.</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="px-4 py-2 text-xs font-semibold rounded-md bg-page border border-borderSubtle text-brand-400 hover:text-white hover:border-brand-400 transition"
          >
            Reintentar
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="bg-surface border border-borderSubtle rounded-lg overflow-hidden shadow-sm">
      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full text-sm border-collapse">
          {/* Table Header */}
          <thead className="table-header-sticky bg-surface border-b border-borderSubtle">
            <tr>
              {activeCols.map(col => {
                const primarySort = sortLevels[0];
                const isSorted = primarySort && primarySort.key === col.key;
                return (
                  <th
                    key={col.key}
                    onClick={() => col.sortable && onToggleSort(col.key)}
                    className={`px-3 py-2.5 text-left text-[11px] uppercase tracking-wider font-semibold select-none whitespace-nowrap border-r border-borderSubtle/60 last:border-r-0 transition ${
                      col.sortable ? 'cursor-pointer hover:text-slate-100 hover:bg-surfaceHigh/40' : ''
                    } ${isSorted ? 'text-brand-400' : 'text-slate-400'}`}
                  >
                    <div className={`flex items-center gap-1.5 ${col.align === 'right' ? 'justify-end' : ''}`}>
                      <span>{col.label}</span>
                      {isSorted && (
                        <span className="font-mono text-xs">
                          {primarySort.dir === 'asc' ? '↑' : '↓'}
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          {/* Table Body */}
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={activeCols.length} className="px-4 py-16 text-center text-slate-500">
                  <p className="text-lg mb-1">🔍 Sin resultados coincidentes</p>
                  <p className="text-xs">Ajusta los filtros o la búsqueda para encontrar ítems.</p>
                  {onResetFilters && (
                    <button
                      onClick={onResetFilters}
                      className="mt-3 text-xs text-brand-400 hover:text-brand-300 underline font-medium"
                    >
                      Resetear filtros
                    </button>
                  )}
                </td>
              </tr>
            ) : groupByKey ? (
              // Grouped Rows
              groupedData.map(group => {
                const isCollapsed = collapsedGroups.includes(group.label);
                return (
                  <React.Fragment key={group.label}>
                    {/* Group Header Row */}
                    <tr
                      onClick={() => toggleGroupCollapse(group.label)}
                      className="bg-surfaceHigh border-b border-borderSubtle/80 cursor-pointer hover:bg-surfaceHighest transition"
                    >
                      <td colSpan={activeCols.length} className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          {isCollapsed ? (
                            <ChevronRight className="w-4 h-4 text-slate-400" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-brand-400" />
                          )}
                          <span className="font-semibold text-sm text-slate-200">
                            {group.label}
                          </span>
                          <span className="text-xs text-slate-400 font-mono">
                            ({group.count})
                          </span>
                        </div>
                      </td>
                    </tr>
                    {/* Group Items */}
                    {!isCollapsed &&
                      group.items.map((row, idx) => {
                        const isDanger = row.stockBase === 0;
                        const isWarning = row.deficit > 0;
                        const zebraClass = idx % 2 === 0 ? 'row-even' : 'row-odd';
                        const rowClass = row.isOptimisticSync
                          ? 'bg-cyan-950/20 ring-1 ring-inset ring-cyan-500/30'
                          : isDanger
                          ? 'row-danger'
                          : isWarning
                          ? 'row-warning'
                          : zebraClass;

                        return (
                          <tr
                            key={row.id}
                            className={`group border-b border-borderSubtle/40 hover:bg-surfaceHighest/40 transition-colors ${rowClass}`}
                          >
                            {activeCols.map(col => (
                              <td
                                key={col.key}
                                className={`px-3 py-2 whitespace-nowrap border-r border-borderSubtle/30 last:border-r-0 ${
                                  col.align === 'right' ? 'text-right' : ''
                                }`}
                              >
                                {renderCellValue(row, col.key)}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                  </React.Fragment>
                );
              })
            ) : (
              // Flat Rows
              items.map((row, idx) => {
                const isDanger = row.stockBase === 0;
                const isWarning = row.deficit > 0;
                const zebraClass = idx % 2 === 0 ? 'row-even' : 'row-odd';
                const rowClass = row.isOptimisticSync
                  ? 'bg-cyan-950/20 ring-1 ring-inset ring-cyan-500/30'
                  : isDanger
                  ? 'row-danger'
                  : isWarning
                  ? 'row-warning'
                  : zebraClass;

                return (
                  <tr
                    key={row.id}
                    className={`group border-b border-borderSubtle/40 hover:bg-surfaceHighest/40 transition-colors ${rowClass}`}
                  >
                    {activeCols.map(col => (
                      <td
                        key={col.key}
                        className={`px-3 py-2 whitespace-nowrap border-r border-borderSubtle/30 last:border-r-0 ${
                          col.align === 'right' ? 'text-right' : ''
                        }`}
                      >
                        {renderCellValue(row, col.key)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
