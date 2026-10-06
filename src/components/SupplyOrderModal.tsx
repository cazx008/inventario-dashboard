import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ShoppingCart, X, Plus, Trash2, Printer, CheckCircle, AlertTriangle, Link2, DollarSign, Search } from 'lucide-react';
import { InventoryItem } from '../types/inventory';
import { OABLineItem, OABHeader, OrderReference, computePackagingSuggestion } from '../types/oab';
import { generateFolioOAB, createOABSheet } from '../services/oabService';
import { OrderSearchModal } from './OrderSearchModal';
import { PrintSheetOAB } from './PrintSheetOAB';

interface SupplyOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  inventoryItems: InventoryItem[];
  bcvRate: number;
  initialDraftItems?: InventoryItem[];
  onOrderCreated?: (createdLines: OABLineItem[]) => void;
}

export const SupplyOrderModal: React.FC<SupplyOrderModalProps> = ({
  isOpen,
  onClose,
  inventoryItems,
  bcvRate,
  initialDraftItems = [],
  onOrderCreated
}) => {
  const [folio, setFolio] = useState('');
  const [fechaEmision, setFechaEmision] = useState('');
  const [tasa, setTasa] = useState(Number((bcvRate || 36.50).toFixed(2)));
  const [notas, setNotas] = useState('');
  const [lines, setLines] = useState<OABLineItem[]>([]);
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [activeLineIndexForOrder, setActiveLineIndexForOrder] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedHeader, setSubmittedHeader] = useState<OABHeader | null>(null);
  const [showPrintSheet, setShowPrintSheet] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Estados para el Buscador Reactivo (Flujo Rápido de Taller)
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearchDropdownOpen, setIsSearchDropdownOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const searchResults = useMemo(() => {
    if (!searchTerm.trim()) return [];
    const term = searchTerm.toLowerCase().trim();
    return inventoryItems
      .filter(item => !lines.some(l => l.dashboardId === item.id))
      .filter(item =>
        item.nombre.toLowerCase().includes(term) ||
        (item.codigo && item.codigo.toLowerCase().includes(term)) ||
        (item.marca && item.marca.toLowerCase().includes(term))
      )
      .slice(0, 8);
  }, [searchTerm, inventoryItems, lines]);

  // Initialize draft on open
  useEffect(() => {
    if (!isOpen) return;

    setFolio(generateFolioOAB());
    setFechaEmision(new Date().toISOString().split('T')[0]);
    setTasa(Number((bcvRate || 36.50).toFixed(2)));
    setSubmittedHeader(null);
    setStatusMessage(null);

    // Initial lines: items with deficit or passed items
    const sourceItems = initialDraftItems.length > 0
      ? initialDraftItems
      : inventoryItems.filter(i => (i.deficit || 0) > 0);

    const generatedLines: OABLineItem[] = sourceItems.map(item => {
      const rawDef = Math.max(0, (item.stockMinimo || 0) - (item.stockBase || 0));
      const def = (item.deficit && item.deficit > 0) ? item.deficit : (rawDef > 0 ? rawDef : 1);
      const pack = computePackagingSuggestion(item.nombre, item.categoriaMaterial, def);
      const cost = item.costoUnitarioUSD || 1.0;
      return {
        nombre: item.nombre,
        insumoId: item.insumoId || item.id,
        dashboardId: item.id,
        cantidadStock: item.stockBase || 0,
        stockMinimo: item.stockMinimo || 0,
        deficit: item.deficit || 0,
        cantidadSugerida: def,
        cantidadSolicitada: pack.cantidadComercialSugerida,
        empaqueComercial: pack.empaqueComercial,
        factorEmpaque: pack.factorEmpaque,
        paquetesSugeridos: pack.paquetesSugeridos,
        cantidadComercialSugerida: pack.cantidadComercialSugerida,
        costoUnitarioUSD: cost,
        subtotalUSD: pack.cantidadComercialSugerida * cost,
        prioridad: item.prioridad || 'Alta',
      };
    });

    setLines(generatedLines);
  }, [isOpen, inventoryItems, initialDraftItems, bcvRate]);

  if (!isOpen) return null;

  const handleQuantityChange = (idx: number, qty: number) => {
    setLines(prev => {
      const copy = [...prev];
      const validQty = Math.max(0, qty);
      copy[idx] = {
        ...copy[idx],
        cantidadSolicitada: validQty,
        subtotalUSD: validQty * (copy[idx].costoUnitarioUSD || 0)
      };
      return copy;
    });
  };

  const handleCostChange = (idx: number, cost: number) => {
    setLines(prev => {
      const copy = [...prev];
      const validCost = Math.max(0, cost);
      copy[idx] = {
        ...copy[idx],
        costoUnitarioUSD: validCost,
        subtotalUSD: (copy[idx].cantidadSolicitada || 0) * validCost
      };
      return copy;
    });
  };

  const handlePriorityChange = (idx: number, prio: string) => {
    setLines(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], prioridad: prio };
      return copy;
    });
  };

  const handleRemoveLine = (idx: number) => {
    setLines(prev => prev.filter((_, i) => i !== idx));
  };

  const handleAddManualItem = (item: InventoryItem) => {
    if (lines.some(l => l.dashboardId === item.id || l.nombre === item.nombre)) return;
    const rawDef = Math.max(0, (item.stockMinimo || 0) - (item.stockBase || 0));
    const def = (item.deficit && item.deficit > 0) ? item.deficit : (rawDef > 0 ? rawDef : 1);
    const pack = computePackagingSuggestion(item.nombre, item.categoriaMaterial, def);
    const cost = item.costoUnitarioUSD || 1.0;
    setLines(prev => [
      ...prev,
      {
        nombre: item.nombre,
        insumoId: item.insumoId || item.id,
        dashboardId: item.id,
        cantidadStock: item.stockBase || 0,
        stockMinimo: item.stockMinimo || 0,
        deficit: item.deficit || 0,
        cantidadSugerida: def,
        cantidadSolicitada: pack.cantidadComercialSugerida,
        empaqueComercial: pack.empaqueComercial,
        factorEmpaque: pack.factorEmpaque,
        paquetesSugeridos: pack.paquetesSugeridos,
        cantidadComercialSugerida: pack.cantidadComercialSugerida,
        costoUnitarioUSD: cost,
        subtotalUSD: pack.cantidadComercialSugerida * cost,
        prioridad: item.prioridad || 'Media',
      }
    ]);
  };

  const handleSelectOrderForLine = (order: OrderReference) => {
    if (activeLineIndexForOrder !== null) {
      setLines(prev => {
        const copy = [...prev];
        copy[activeLineIndexForOrder] = {
          ...copy[activeLineIndexForOrder],
          proyectoId: order.id,
          proyectoNombre: `${order.codigo} - ${order.proyecto}`
        };
        return copy;
      });
      setActiveLineIndexForOrder(null);
    }
  };

  // Calculations
  const totalUSD = lines.reduce((acc, l) => acc + (l.subtotalUSD || 0), 0);
  const totalBs = totalUSD * tasa;

  const handleSaveToNotion = async () => {
    if (lines.length === 0) {
      alert('Debe haber al menos un insumo en la orden.');
      return;
    }

    setIsSubmitting(true);
    setStatusMessage('Emitiendo Orden de Abastecimiento en Notion ERP...');

    try {
      const payload = {
        folio,
        fechaEmision,
        tasaBCV: tasa,
        totalUSD,
        totalBs,
        notas,
        lineas: lines
      };

      const result = await createOABSheet(payload);

      const headerObj: OABHeader = {
        id: result.oabId,
        folio,
        fechaEmision,
        totalUSD,
        totalBs,
        tasaBCV: tasa,
        estadoGeneral: 'Solicitado',
        notas
      };

      setSubmittedHeader(headerObj);
      setShowPrintSheet(true); // Vista previa inmediata de la Hoja Viajera Carta
      setStatusMessage('¡OAB emitida exitosamente en Notion!');
      if (onOrderCreated) {
        onOrderCreated(lines);
      }
    } catch (err: any) {
      console.error('Error al emitir OAB:', err);
      setStatusMessage(`Error: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-4 no-print">
        <div className="bg-surface border border-borderSubtle rounded-xl w-full max-w-5xl max-h-[92dvh] sm:max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
          
          {/* Modal Header */}
          <div className="px-5 py-3 bg-surfaceHigh border-b border-borderSubtle flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-brand-500/20 text-brand-400 border border-brand-500/40">
                <ShoppingCart className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-100 tracking-tight flex items-center gap-2">
                  <span>Modo Sugerencias de Abastecimiento</span>
                  <span className="font-mono text-xs text-brand-400 bg-page px-2 py-0.5 rounded border border-borderSubtle">
                    {folio}
                  </span>
                </h2>
                <p className="text-[11px] text-slate-400">
                  Cálculo automático de déficit y consolidación de la Hoja Viajera para Gerencia y Compras
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1 rounded-md hover:bg-surfaceHighest transition min-w-[36px] min-h-[36px] flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Form Meta Bar */}
          <div className="p-3 bg-page border-b border-borderSubtle grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <label className="block text-[10px] uppercase text-slate-500 font-semibold mb-1">
                Folio OAB
              </label>
              <input
                type="text"
                value={folio}
                onChange={(e) => setFolio(e.target.value)}
                className="w-full px-2.5 py-1 text-xs font-mono font-bold bg-surface border border-borderSubtle rounded text-brand-400"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase text-slate-500 font-semibold mb-1">
                Fecha de Emisión
              </label>
              <input
                type="date"
                value={fechaEmision}
                onChange={(e) => setFechaEmision(e.target.value)}
                className="w-full px-2.5 py-1 text-xs font-mono bg-surface border border-borderSubtle rounded text-slate-200"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase text-slate-500 font-semibold mb-1">
                Tasa Oficial BCV (Bs/USD)
              </label>
              <input
                type="number"
                step="0.01"
                value={tasa}
                onChange={(e) => setTasa(Number(e.target.value) || 36.50)}
                className="w-full px-2.5 py-1 text-xs font-mono bg-surface border border-borderSubtle rounded text-amber-300 font-bold"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase text-slate-500 font-semibold mb-1">
                Notas / Propósito
              </label>
              <input
                type="text"
                placeholder="Ej: Reposición urgente obras..."
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                className="w-full px-2.5 py-1 text-xs bg-surface border border-borderSubtle rounded text-slate-200 placeholder-slate-500"
              />
            </div>
          </div>

          {/* Lines Table */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-3 sm:p-4 space-y-2">
            <div className="flex items-center justify-between pb-1">
              <span className="text-xs uppercase font-semibold text-slate-400 tracking-wider">
                Ítems Seleccionados ({lines.length})
              </span>
              {/* Buscador Reactivo de Insumos (Flujo Rápido de Taller) */}
              <div className="relative w-72 sm:w-80">
                <div className="relative flex items-center">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 text-slate-400 pointer-events-none" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="🔍 Buscar para agregar (Enter rápido)..."
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value);
                      setIsSearchDropdownOpen(true);
                    }}
                    onFocus={() => setIsSearchDropdownOpen(true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && searchResults.length > 0) {
                        e.preventDefault();
                        handleAddManualItem(searchResults[0]);
                        setSearchTerm('');
                        setIsSearchDropdownOpen(false);
                        searchInputRef.current?.focus();
                      } else if (e.key === 'Escape') {
                        setIsSearchDropdownOpen(false);
                      }
                    }}
                    className="w-full pl-8 pr-7 py-1 text-xs bg-surface border border-borderSubtle rounded-md text-slate-200 placeholder-slate-400 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 transition shadow-inner"
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchTerm('');
                        setIsSearchDropdownOpen(false);
                        searchInputRef.current?.focus();
                      }}
                      className="absolute right-2 text-slate-400 hover:text-white p-0.5 rounded"
                      title="Limpiar búsqueda"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Dropdown flotante predictivo */}
                {isSearchDropdownOpen && searchResults.length > 0 && (
                  <div className="absolute right-0 top-full mt-1.5 w-80 sm:w-96 bg-surfaceHigh border border-borderSubtle rounded-lg shadow-2xl z-30 max-h-60 overflow-y-auto custom-scrollbar divide-y divide-borderSubtle/50">
                    <div className="px-3 py-1 bg-surface text-[10px] uppercase font-mono text-slate-400 flex items-center justify-between">
                      <span>Resultados ({searchResults.length})</span>
                      <span className="text-brand-400 font-bold">↵ Enter para añadir</span>
                    </div>
                    {searchResults.map((item, idx) => (
                      <button
                        key={item.id}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleAddManualItem(item);
                          setSearchTerm('');
                          setIsSearchDropdownOpen(false);
                          searchInputRef.current?.focus();
                        }}
                        onClick={() => {
                          handleAddManualItem(item);
                          setSearchTerm('');
                          setIsSearchDropdownOpen(false);
                          searchInputRef.current?.focus();
                        }}
                        className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-brand-500/20 transition ${
                          idx === 0 ? 'bg-brand-500/10' : ''
                        }`}
                      >
                        <div className="pr-2">
                          <p className="text-xs font-semibold text-slate-200 leading-tight">
                            {item.nombre}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-400">
                            {item.codigo && <span className="font-mono text-cyan-400">[{item.codigo}]</span>}
                            {item.marca && <span>{item.marca}</span>}
                            {item.unidad && (
                              <span className="text-amber-400 font-mono">📦 {item.unidad}</span>
                            )}
                          </div>
                        </div>
                        <div className="text-right whitespace-nowrap">
                          <span className={`font-mono text-xs ${item.stockBase === 0 ? 'text-red-400 font-bold' : 'text-slate-300'}`}>
                            Stock: {item.stockBase}
                          </span>
                          {item.deficit > 0 && (
                            <span className="block text-[10px] text-orange-400 font-mono font-bold">-{item.deficit}</span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {lines.length === 0 ? (
              <div className="py-16 text-center text-slate-500 text-xs">
                No hay ítems con déficit ni seleccionados en el borrador.
              </div>
            ) : (
              <div className="border border-borderSubtle rounded-lg overflow-x-auto custom-scrollbar">
                <table className="w-full text-xs text-left min-w-[760px]">
                  <thead className="bg-surfaceHigh text-slate-400 uppercase text-[10px] border-b border-borderSubtle sticky top-0 z-10 shadow-sm">
                    <tr>
                      <th className="p-2 w-8 text-center">#</th>
                      <th className="p-2">Insumo</th>
                      <th className="p-2 w-16 text-right">Stock</th>
                      <th className="p-2 w-16 text-right">Déficit</th>
                      <th className="p-2 w-28 text-right">Cant. Sol.</th>
                      <th className="p-2 w-20 text-right">P. Unit ($)</th>
                      <th className="p-2 w-20 text-right">Subtotal</th>
                      <th className="p-2 w-28">Prioridad</th>
                      <th className="p-2 w-32">Obra / Pedido</th>
                      <th className="p-2 w-8 text-center"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-borderSubtle/50">
                    {lines.map((line, idx) => (
                      <tr key={idx} className="hover:bg-surfaceHigh/30 transition">
                        <td className="p-2 text-center text-slate-500 font-mono">{idx + 1}</td>
                        <td className="p-2">
                          <span className="font-semibold text-slate-200 block">{line.nombre}</span>
                          {line.empaqueComercial && (
                            <span className="text-[10px] text-amber-400 font-mono flex items-center gap-1 mt-0.5">
                              <span>📦 {line.empaqueComercial}</span>
                              {line.paquetesSugeridos && line.factorEmpaque && line.factorEmpaque > 1 && (
                                <span className="text-slate-400">
                                  ({line.paquetesSugeridos} {line.paquetesSugeridos === 1 ? 'paquete' : 'paquetes'})
                                </span>
                              )}
                            </span>
                          )}
                        </td>
                        <td className="p-2 text-right font-mono text-slate-400">{line.cantidadStock}</td>
                        <td className="p-2 text-right font-mono text-orange-400 font-bold">
                          {line.deficit > 0 ? `-${line.deficit}` : '0'}
                        </td>
                        <td className="p-2 text-right">
                          <div className="flex flex-col items-end gap-1">
                            {line.deficit <= 0 && (
                              <span className="text-[8px] font-mono text-amber-400 bg-amber-500/10 px-1 py-0.5 rounded border border-amber-500/30 font-semibold whitespace-nowrap">
                                ⚠️ Definir cant.
                              </span>
                            )}
                            <input
                              type="number"
                              min="1"
                              value={line.cantidadSolicitada}
                              onChange={(e) => handleQuantityChange(idx, Number(e.target.value))}
                              className={`w-24 px-2 py-1 text-right font-mono font-bold bg-page border rounded text-brand-400 focus:border-brand-400 focus:outline-none ${
                                line.deficit <= 0
                                  ? 'border-amber-500/60 ring-1 ring-amber-500/30'
                                  : 'border-borderSubtle'
                              }`}
                            />
                            {line.cantidadComercialSugerida && line.cantidadSugerida && line.cantidadComercialSugerida !== line.cantidadSugerida && (
                              <div className="flex items-center gap-1 text-[9px] font-mono">
                                <button
                                  type="button"
                                  onClick={() => handleQuantityChange(idx, line.cantidadComercialSugerida!)}
                                  title="Redondear al empaque cerrado sugerido"
                                  className={`px-1 py-0.5 rounded transition ${
                                    line.cantidadSolicitada === line.cantidadComercialSugerida
                                      ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40'
                                      : 'text-slate-400 hover:text-slate-200 bg-surfaceHigh'
                                  }`}
                                >
                                  Empaque ({line.cantidadComercialSugerida})
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleQuantityChange(idx, line.cantidadSugerida)}
                                  title="Cantidad neta calculada exacta"
                                  className={`px-1 py-0.5 rounded transition ${
                                    line.cantidadSolicitada === line.cantidadSugerida
                                      ? 'bg-blue-500/20 text-blue-300 font-bold border border-blue-500/40'
                                      : 'text-slate-400 hover:text-slate-200 bg-surfaceHigh'
                                  }`}
                                >
                                  Neto ({line.cantidadSugerida})
                                </button>
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="p-2 text-right">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={line.costoUnitarioUSD}
                            onChange={(e) => handleCostChange(idx, Number(e.target.value))}
                            className="w-16 px-1.5 py-1 text-right font-mono bg-page border border-borderSubtle rounded text-slate-200"
                          />
                        </td>
                        <td className="p-2 text-right font-mono font-bold text-slate-100">
                          ${line.subtotalUSD.toFixed(2)}
                        </td>
                        <td className="p-2">
                          <select
                            value={line.prioridad}
                            onChange={(e) => handlePriorityChange(idx, e.target.value)}
                            className="text-[11px] bg-page border border-borderSubtle rounded px-1.5 py-1 text-slate-300"
                          >
                            <option value="Urgente">🔴 Urgente</option>
                            <option value="Alta">🟠 Alta</option>
                            <option value="Media">🟡 Media</option>
                            <option value="Baja">🟢 Baja</option>
                            <option value="Por Pedido">🔵 Por Pedido</option>
                          </select>
                        </td>
                        <td className="p-2">
                          {line.proyectoNombre ? (
                            <div className="flex items-center gap-1 text-[11px] text-brand-400 font-mono truncate max-w-[130px]">
                              <span className="truncate">{line.proyectoNombre}</span>
                              <button
                                onClick={() => {
                                  setActiveLineIndexForOrder(idx);
                                  setOrderModalOpen(true);
                                }}
                                className="text-slate-400 hover:text-white"
                              >
                                ✎
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                setActiveLineIndexForOrder(idx);
                                setOrderModalOpen(true);
                              }}
                              className="text-[10px] text-slate-400 hover:text-brand-400 flex items-center gap-1 underline"
                            >
                              <Link2 className="w-3 h-3" />
                              <span>Vincular ERP</span>
                            </button>
                          )}
                        </td>
                        <td className="p-2 text-center">
                          <button
                            onClick={() => handleRemoveLine(idx)}
                            className="text-red-400 hover:text-red-300 transition p-1"
                            title="Eliminar línea"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Modal Footer with Totals & Actions */}
          <div className="p-3 sm:p-4 bg-surfaceHigh border-t border-borderSubtle flex flex-wrap items-center justify-between gap-3 sm:gap-4">
            {/* Totals */}
            <div className="flex items-center gap-4 sm:gap-6">
              <div>
                <span className="text-[10px] uppercase text-slate-400 block font-semibold">Total Estimado ($ USD)</span>
                <span className="text-lg sm:text-xl font-bold font-mono text-emerald-400">${totalUSD.toFixed(2)}</span>
              </div>
              <div className="border-l border-borderSubtle pl-4 sm:pl-6">
                <span className="text-[10px] uppercase text-slate-400 block font-semibold">Total Estimado (Bs BCV)</span>
                <span className="text-lg sm:text-xl font-bold font-mono text-amber-300">Bs {totalBs.toFixed(2)}</span>
              </div>
              {statusMessage && (
                <div className="hidden md:flex items-center gap-1.5 text-xs text-brand-400 bg-page px-3 py-1 rounded border border-brand-500/30">
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>{statusMessage}</span>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-2 text-xs text-slate-400 hover:text-white min-h-[36px]"
              >
                Cerrar
              </button>

              <button
                type="button"
                onClick={() => {
                  const headerObj: OABHeader = {
                    folio,
                    fechaEmision,
                    totalUSD,
                    totalBs,
                    tasaBCV: tasa,
                    estadoGeneral: 'Solicitado',
                    notas
                  };
                  setSubmittedHeader(headerObj);
                  setShowPrintSheet(true);
                }}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-surfaceHighest hover:bg-slate-700 text-slate-200 border border-borderSubtle transition min-h-[36px] active:scale-95"
                title="Generar vista de impresión física para Magaly y Compras"
              >
                <Printer className="w-4 h-4 text-brand-400" />
                <span>Imprimir Hoja Viajera</span>
              </button>

              <button
                type="button"
                onClick={handleSaveToNotion}
                disabled={isSubmitting || lines.length === 0}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-brand-500 hover:bg-brand-600 text-slate-950 transition disabled:opacity-50 active:scale-95 min-h-[36px] shadow-sm shadow-brand-500/20"
              >
                {isSubmitting ? (
                  <div className="w-3.5 h-3.5 border-2 border-slate-900 border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <CheckCircle className="w-4 h-4" />
                )}
                <span>Emitir en Notion ERP</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Modal de Búsqueda de Pedidos ERP */}
      {orderModalOpen && (
        <OrderSearchModal
          isOpen={orderModalOpen}
          onClose={() => {
            setOrderModalOpen(false);
            setActiveLineIndexForOrder(null);
          }}
          onSelectOrder={handleSelectOrderForLine}
        />
      )}

      {/* Hoja Viajera Física de Impresión */}
      {showPrintSheet && submittedHeader && (
        <PrintSheetOAB
          header={submittedHeader}
          lineas={lines}
          onClose={() => setShowPrintSheet(false)}
        />
      )}
    </>
  );
};
