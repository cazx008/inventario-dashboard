import React, { useState, useMemo } from 'react';
import { 
  X, 
  Printer, 
  EyeOff, 
  FileCheck, 
  Layers, 
  Calendar, 
  Building2, 
  Check, 
  Clock, 
  FileText 
} from 'lucide-react';
import { InventoryItem } from '../types/inventory';

interface PrintCountingSheetModalProps {
  isOpen: boolean;
  onClose: () => void;
  allItems: InventoryItem[];
  filteredItems: InventoryItem[];
}

export const PrintCountingSheetModal: React.FC<PrintCountingSheetModalProps> = ({
  isOpen,
  onClose,
  allItems,
  filteredItems,
}) => {
  // Presets de alcance
  const [scopePreset, setScopePreset] = useState<'pending' | 'filtered' | 'all'>('pending');
  // Modo de formato: ciego (operarios) vs auditoría (supervisores)
  const [formatMode, setFormatMode] = useState<'blind' | 'audit'>('blind');
  // Agrupación
  const [groupByCategory, setGroupByCategory] = useState(true);

  // Ítems pendientes de reconteo (>3D)
  const pendingItems = useMemo(() => {
    return allItems.filter(i => !i.seReconto3D || i.diasDesdeReconteo === null || (i.diasDesdeReconteo !== undefined && i.diasDesdeReconteo > 3));
  }, [allItems]);

  // Artículos seleccionados según el preset
  const targetItems = useMemo(() => {
    if (scopePreset === 'pending') return pendingItems;
    if (scopePreset === 'filtered') return filteredItems;
    return allItems;
  }, [scopePreset, pendingItems, filteredItems, allItems]);

  // Ítems agrupados por categoría si aplica
  const groupedItems = useMemo(() => {
    if (!groupByCategory) {
      return [{ category: 'Todos los Materiales', items: targetItems }];
    }

    const groups: Record<string, InventoryItem[]> = {};
    for (const item of targetItems) {
      const cat = item.categoriaMaterial || 'Sin Categoría';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    }

    return Object.entries(groups).map(([category, items]) => ({
      category,
      items: items.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    }));
  }, [targetItems, groupByCategory]);

  const folioCorrelativo = useMemo(() => {
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `TOMA-${today}-${rand}`;
  }, []);

  const handlePrint = () => {
    window.print();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* MODAL CONFIGURADOR EN PANTALLA (no-print) */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm overflow-y-auto no-print">
        <div 
          className="relative w-full max-w-xl bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden my-8"
          role="dialog"
          aria-modal="true"
          aria-labelledby="print-counting-title"
        >
          {/* Cabecera */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-950/60">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                <Printer className="w-5 h-5" />
              </div>
              <div>
                <h2 id="print-counting-title" className="text-lg font-bold text-zinc-100 tracking-tight">
                  Planilla de Toma Física de Inventario
                </h2>
                <p className="text-xs text-zinc-400">
                  Formato Tipo Carta (Letter) con soporte para conteo ciego y auditoría
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-zinc-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Formulario de Configuración */}
          <div className="p-6 space-y-5">
            {/* 1. Alcance / Preset */}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 block mb-2">
                1. Alcance de Artículos a Imprimir
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setScopePreset('pending')}
                  className={`p-3 rounded-xl border text-left transition flex flex-col justify-between ${
                    scopePreset === 'pending'
                      ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                      : 'bg-zinc-950/50 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold">Pendientes &gt;3D</span>
                    <Clock className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-lg font-mono font-bold mt-2 text-amber-400">
                    {pendingItems.length} <span className="text-xs font-normal">ítems</span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setScopePreset('filtered')}
                  className={`p-3 rounded-xl border text-left transition flex flex-col justify-between ${
                    scopePreset === 'filtered'
                      ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-300'
                      : 'bg-zinc-950/50 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold">Vista Actual</span>
                    <FileText className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-lg font-mono font-bold mt-2 text-cyan-400">
                    {filteredItems.length} <span className="text-xs font-normal">ítems</span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setScopePreset('all')}
                  className={`p-3 rounded-xl border text-left transition flex flex-col justify-between ${
                    scopePreset === 'all'
                      ? 'bg-purple-500/15 border-purple-500/50 text-purple-300'
                      : 'bg-zinc-950/50 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold">Catálogo Total</span>
                    <Layers className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-lg font-mono font-bold mt-2 text-purple-400">
                    {allItems.length} <span className="text-xs font-normal">ítems</span>
                  </span>
                </button>
              </div>
            </div>

            {/* 2. Formato: Ciego vs Auditoría */}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 block mb-2">
                2. Formato de Conteo en Papel
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setFormatMode('blind')}
                  className={`p-3 rounded-xl border text-left transition flex items-start gap-2.5 ${
                    formatMode === 'blind'
                      ? 'bg-purple-500/15 border-purple-500/50 text-purple-300 shadow-sm'
                      : 'bg-zinc-950/50 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                  }`}
                >
                  <EyeOff className="w-4 h-4 text-purple-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="text-xs font-bold block text-zinc-200">Planilla Ciega (Operarios)</span>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Oculta el stock teórico para que el operario cuente de forma imparcial.
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setFormatMode('audit')}
                  className={`p-3 rounded-xl border text-left transition flex items-start gap-2.5 ${
                    formatMode === 'audit'
                      ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300 shadow-sm'
                      : 'bg-zinc-950/50 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                  }`}
                >
                  <FileCheck className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="text-xs font-bold block text-zinc-200">Auditoría (Supervisores)</span>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Incluye columna de stock teórico y verificación para cotejo de mando.
                    </p>
                  </div>
                </button>
              </div>
            </div>

            {/* 3. Agrupación */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-950/40 border border-zinc-800">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-zinc-400" />
                <span className="text-xs text-zinc-300 font-medium">Agrupar por Categoría de Material</span>
              </div>
              <button
                type="button"
                onClick={() => setGroupByCategory(!groupByCategory)}
                className={`w-9 h-5 rounded-full transition-colors relative flex items-center p-0.5 ${
                  groupByCategory ? 'bg-amber-500' : 'bg-zinc-700'
                }`}
              >
                <div className={`w-4 h-4 rounded-full bg-white transition-transform ${
                  groupByCategory ? 'translate-x-4' : 'translate-x-0'
                }`} />
              </button>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-800 bg-zinc-950/80">
            <span className="text-xs text-zinc-400 font-mono">
              Total a imprimir: <strong className="text-white">{targetItems.length}</strong> ítems
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-zinc-800 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={targetItems.length === 0}
                onClick={handlePrint}
                className="px-5 py-2 text-xs font-bold bg-cyan-600 hover:bg-cyan-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white rounded-lg transition shadow-md shadow-cyan-600/20 flex items-center gap-1.5"
              >
                <Printer className="w-4 h-4" />
                <span>Imprimir Planilla (Carta)</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* DOCUMENTO IMPRIMIBLE (SOLO VISIBLE EN @media print) */}
      <div className="hidden print:block print:w-full print:bg-white print:text-black print:p-0">
        {/* CABECERA FORMAL SANESCA PRO */}
        <div className="border-b-2 border-slate-900 pb-3 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-black tracking-tight text-slate-900 uppercase">
                  SANESCA INDUSTRIAL PRO
                </span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 bg-slate-900 text-white rounded font-mono">
                  ERP
                </span>
              </div>
              <h1 className="text-sm font-bold text-slate-700 uppercase tracking-wide mt-0.5">
                Planilla de Toma Física de Inventario {formatMode === 'blind' ? '(Conteo Ciego)' : '(Auditoría)'}
              </h1>
            </div>

            <div className="text-right text-[11px] font-mono">
              <div><strong>FOLIO:</strong> {folioCorrelativo}</div>
              <div><strong>FECHA:</strong> {new Date().toLocaleDateString('es-VE')}</div>
              <div><strong>HORA:</strong> {new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-slate-300 text-[11px]">
            <div><strong>ALMACÉN:</strong> Planta Principal / General</div>
            <div><strong>MODALIDAD:</strong> {formatMode === 'blind' ? 'Conteo Ciego (Sin Sesgo)' : 'Auditoría Supervisada'}</div>
            <div><strong>TOTAL ÍTEMS:</strong> {targetItems.length} renglones</div>
          </div>
        </div>

        {/* TABLA PRINCIPAL */}
        {groupedItems.map((group, gIdx) => (
          <div key={gIdx} className="mb-4">
            {groupByCategory && (
              <div className="bg-slate-100 text-slate-800 px-2 py-1 text-xs font-bold uppercase tracking-wider border-l-4 border-slate-800 mb-1">
                {group.category} ({group.items.length})
              </div>
            )}

            <table className="w-full text-left border-collapse text-[11px]">
              <thead>
                <tr className="border-b-2 border-slate-800 bg-slate-50 text-slate-700 font-bold uppercase text-[10px]">
                  <th className="py-1 px-1.5 w-8 text-center">N°</th>
                  <th className="py-1 px-1.5 w-20">Código</th>
                  <th className="py-1 px-1.5">Material / Insumo</th>
                  <th className="py-1 px-1.5 w-16 text-center">Unidad</th>
                  {formatMode === 'audit' && (
                    <th className="py-1 px-1.5 w-20 text-right">Stock Sis.</th>
                  )}
                  <th className="py-1 px-2 w-28 text-center border-l border-r border-slate-400 bg-slate-100">
                    Conteo Físico
                  </th>
                  <th className="py-1 px-2 w-36">Observaciones / Ubic.</th>
                </tr>
              </thead>
              <tbody>
                {group.items.map((item, idx) => (
                  <tr 
                    key={item.id} 
                    className="border-b border-slate-300 hover:bg-slate-50 h-7"
                    style={{ pageBreakInside: 'avoid' }}
                  >
                    <td className="py-1 px-1.5 text-center font-mono text-slate-500">{idx + 1}</td>
                    <td className="py-1 px-1.5 font-mono font-medium">{item.codigo || '—'}</td>
                    <td className="py-1 px-1.5 font-medium text-slate-900">
                      {item.nombre}
                      {item.marca && item.marca !== 'Genérico' && (
                        <span className="text-[10px] text-slate-500 ml-1">({item.marca})</span>
                      )}
                    </td>
                    <td className="py-1 px-1.5 text-center font-mono text-slate-600">{item.unidad || 'Und'}</td>
                    {formatMode === 'audit' && (
                      <td className="py-1 px-1.5 text-right font-mono font-bold text-slate-800">
                        {item.stockBase}
                      </td>
                    )}
                    <td className="py-1 px-2 text-center border-l border-r border-slate-400 bg-slate-50/50 font-mono font-bold">
                      {/* Casilla limpia para escribir a mano */}
                      <span className="inline-block w-full border-b border-dotted border-slate-400 text-transparent">___</span>
                    </td>
                    <td className="py-1 px-2 border-b border-dotted border-slate-300">
                      <span className="text-[10px] text-slate-400">{item.dimensiones || ''}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {/* PIE DE PÁGINA: BLOQUE DE FIRMAS Y CONFORMIDAD */}
        <div 
          className="mt-8 pt-4 border-t-2 border-slate-900 grid grid-cols-3 gap-6 text-[10px] text-center"
          style={{ pageBreakInside: 'avoid' }}
        >
          <div className="border-t border-slate-400 pt-2">
            <p className="font-bold uppercase text-slate-800">Auditor de Toma Física</p>
            <p className="text-slate-500 mt-1">Firma, Cédula y Huella</p>
          </div>
          <div className="border-t border-slate-400 pt-2">
            <p className="font-bold uppercase text-slate-800">Supervisor de Almacén</p>
            <p className="text-slate-500 mt-1">V°B° y Validación de Discrepancias</p>
          </div>
          <div className="border-t border-slate-400 pt-2">
            <p className="font-bold uppercase text-slate-800">Gerencia de Operaciones</p>
            <p className="text-slate-500 mt-1">Conforme y Asiento de Kardex</p>
          </div>
        </div>
      </div>
    </>
  );
};
