import React, { useState, useEffect } from 'react';
import { 
  X, 
  Layers, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  AlertTriangle, 
  Sparkles, 
  ArrowRight,
  Minus,
  Scale
} from 'lucide-react';

export interface BultoBreakdownDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  materialNombre: string;
  sku?: string;
  cantidadTotal: number;
  unidadMedida?: string;
  initialDesglose?: number[];
  onApplyDesglose: (desglose: number[]) => void;
}

export const BultoBreakdownDrawer: React.FC<BultoBreakdownDrawerProps> = ({
  isOpen,
  onClose,
  materialNombre,
  sku,
  cantidadTotal,
  unidadMedida = 'und',
  initialDesglose,
  onApplyDesglose
}) => {
  const [bultos, setBultos] = useState<number[]>([]);

  // Inicializar estado cada vez que se abre el drawer
  useEffect(() => {
    if (!isOpen) return;

    if (initialDesglose && initialDesglose.length > 0) {
      setBultos([...initialDesglose]);
    } else {
      // Default: dividir en 2 bultos iniciales o 1 si la cantidad es 1
      if (cantidadTotal > 1) {
        const half = Math.floor(cantidadTotal / 2);
        const rest = cantidadTotal - half;
        setBultos([half, rest]);
      } else {
        setBultos([1]);
      }
    }
  }, [isOpen, initialDesglose, cantidadTotal]);

  if (!isOpen) return null;

  const currentSum = bultos.reduce((acc, val) => acc + (Number(val) || 0), 0);
  const diff = cantidadTotal - currentSum;
  const isBalanced = diff === 0 && bultos.every(v => v > 0);

  // Manejo de valores por bulto
  const handleUpdateValue = (idx: number, val: number) => {
    const safe = Math.max(0, val);
    setBultos(prev => {
      const copy = [...prev];
      copy[idx] = safe;
      return copy;
    });
  };

  const handleAdjustValue = (idx: number, delta: number) => {
    setBultos(prev => {
      const copy = [...prev];
      copy[idx] = Math.max(1, (copy[idx] || 0) + delta);
      return copy;
    });
  };

  const handleAddBulto = () => {
    const defaultVal = diff > 0 ? diff : 1;
    setBultos(prev => [...prev, defaultVal]);
  };

  const handleRemoveBulto = (idx: number) => {
    if (bultos.length <= 1) return;
    setBultos(prev => prev.filter((_, i) => i !== idx));
  };

  const handleAutoCompleteRemainder = () => {
    if (diff === 0 || bultos.length === 0) return;
    setBultos(prev => {
      const copy = [...prev];
      const lastIdx = copy.length - 1;
      const target = (copy[lastIdx] || 0) + diff;
      if (target > 0) {
        copy[lastIdx] = target;
      } else {
        copy[lastIdx] = 1;
      }
      return copy;
    });
  };

  const handleSplitUniform = (n: number) => {
    const count = Math.max(1, n);
    const quotient = Math.floor(cantidadTotal / count);
    const rem = cantidadTotal % count;
    const list: number[] = [];
    for (let i = 0; i < count; i++) {
      list.push(quotient + (i < rem ? 1 : 0));
    }
    setBultos(list);
  };

  const handleConfirm = () => {
    if (!isBalanced) return;
    onApplyDesglose(bultos.filter(v => v > 0));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border-l border-slate-700 w-full max-w-lg h-full flex flex-col shadow-2xl text-slate-100">
        
        {/* Header Táctil */}
        <div className="bg-slate-950 p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-brand-500/20 border border-brand-500/40 rounded-lg text-brand-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>Desglose Asimétrico de Bultos</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  D14
                </span>
              </h3>
              <p className="text-xs text-slate-400 line-clamp-1">
                {materialNombre} {sku ? `(SKU: ${sku})` : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
            title="Cerrar panel"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Semáforo de Balance Matemático */}
        <div className={`p-4 border-b transition-colors flex items-center justify-between ${
          isBalanced
            ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
            : diff > 0
            ? 'bg-amber-950/40 border-amber-800/60 text-amber-300'
            : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
        }`}>
          <div className="flex items-center gap-2.5">
            {isBalanced ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-5 h-5 shrink-0" />
            )}
            <div>
              <div className="text-xs font-bold uppercase tracking-wider">
                {isBalanced
                  ? 'Balance Exacto Confirmado'
                  : diff > 0
                  ? `Faltan ${diff} ${unidadMedida} por asignar`
                  : `Exceso de ${Math.abs(diff)} ${unidadMedida}`}
              </div>
              <div className="text-[11px] font-mono opacity-80">
                Suma actual: <b>{currentSum}</b> / Total requerido: <b>{cantidadTotal} {unidadMedida}</b>
              </div>
            </div>
          </div>

          {!isBalanced && diff > 0 && (
            <button
              type="button"
              onClick={handleAutoCompleteRemainder}
              className="px-2.5 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 rounded-lg text-xs font-bold transition flex items-center gap-1 active:scale-95 shrink-0"
              title="Ajustar el residuo faltante en el último bulto automáticamente"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Auto-Completar</span>
            </button>
          )}
        </div>

        {/* Barra de Atajos Rápidos */}
        <div className="p-3 bg-slate-950/60 border-b border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
          <span className="text-[11px] font-semibold text-slate-400">Atajos de División:</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => handleSplitUniform(2)}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] font-mono transition"
            >
              1/2 y 1/2
            </button>
            <button
              type="button"
              onClick={() => handleSplitUniform(3)}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] font-mono transition"
            >
              En 3 partes
            </button>
            <button
              type="button"
              onClick={() => handleSplitUniform(4)}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] font-mono transition"
            >
              En 4 partes
            </button>
          </div>
        </div>

        {/* Lista Dinámica de Bultos */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
          {bultos.map((cant, idx) => (
            <div
              key={`bulto_row_${idx}`}
              className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-3 shadow-sm hover:border-slate-700 transition"
            >
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-brand-500/20 border border-brand-500/40 text-brand-300 flex items-center justify-center font-mono font-bold text-xs">
                  {idx + 1}
                </span>
                <div>
                  <div className="text-xs font-bold text-slate-200">
                    Bulto {idx + 1}
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono">
                    PKG-ID: ...-B{String(idx + 1).padStart(2, '0')}
                  </div>
                </div>
              </div>

              {/* Controles Táctiles de Cantidad */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleAdjustValue(idx, -1)}
                  className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 flex items-center justify-center transition border border-slate-700"
                  title="Disminuir en 1"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <input
                  type="number"
                  min="1"
                  value={cant || ''}
                  onChange={(e) => handleUpdateValue(idx, parseInt(e.target.value, 10) || 0)}
                  className="w-16 px-2 py-1.5 text-center font-mono font-bold text-sm bg-surface border border-slate-700 rounded-lg text-emerald-400 focus:outline-none focus:border-brand-500"
                />
                <span className="text-xs font-mono text-slate-400 w-7">
                  {unidadMedida}
                </span>
                <button
                  type="button"
                  onClick={() => handleAdjustValue(idx, 1)}
                  className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 flex items-center justify-center transition border border-slate-700"
                  title="Aumentar en 1"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>

                {bultos.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveBulto(idx)}
                    className="p-2 text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 rounded-lg transition ml-1"
                    title="Eliminar este bulto"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* Botón para agregar bulto */}
          <button
            type="button"
            onClick={handleAddBulto}
            className="w-full py-2.5 px-4 rounded-xl border border-dashed border-slate-700 hover:border-brand-500/50 bg-slate-950/40 hover:bg-slate-800/40 text-slate-400 hover:text-brand-300 text-xs font-semibold flex items-center justify-center gap-2 transition"
          >
            <Plus className="w-4 h-4" />
            <span>Agregar Bulto Adicional</span>
          </button>
        </div>

        {/* Footer con Confirmación */}
        <div className="bg-slate-950 p-4 border-t border-slate-800 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium transition"
          >
            Cancelar
          </button>

          <button
            type="button"
            onClick={handleConfirm}
            disabled={!isBalanced}
            className="flex-1 py-2.5 px-4 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 disabled:pointer-events-none active:scale-[0.98] text-slate-950 font-bold rounded-xl text-xs transition shadow-lg shadow-emerald-950/40 flex items-center justify-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Aplicar Desglose ({bultos.length} Bultos)</span>
          </button>
        </div>

      </div>
    </div>
  );
};
