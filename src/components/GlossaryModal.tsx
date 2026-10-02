import React, { useState } from 'react';
import { BookOpen, ChevronDown, ChevronUp } from 'lucide-react';

interface GlossaryModalProps {
  lastSyncDisplay: string;
}

export const GlossaryModal: React.FC<GlossaryModalProps> = ({ lastSyncDisplay }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <section className="mt-4 mb-2 no-print">
      <div className="bg-surface border border-borderSubtle rounded-lg overflow-hidden">
        {/* Toggle header */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center justify-between px-5 py-3 text-sm text-slate-300 hover:text-white bg-surfaceHigh/40 hover:bg-surfaceHigh transition border-b border-borderSubtle/30"
        >
          <span className="flex items-center gap-2 font-semibold">
            <BookOpen className="w-4 h-4 text-brand-400" />
            <span>Glosario y Referencia Operativa</span>
            <span className="text-[10px] text-slate-500 font-normal ml-1 hidden sm:inline">
              Columnas · Leyenda · Guía de uso de almacén
            </span>
          </span>
          <span className="text-xs text-slate-400 flex items-center gap-1 font-mono">
            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </span>
        </button>

        {/* Collapsible Content */}
        {isOpen && (
          <div className="p-5 space-y-6 text-xs text-slate-300">
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              {/* Bloque 1: Columnas (3/5 width) */}
              <div className="lg:col-span-3 space-y-3">
                <h3 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">
                  Definición de Columnas de Almacén
                </h3>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
                  <div>
                    <dt className="font-semibold text-slate-200">Stock (base)</dt>
                    <dd className="text-slate-400">Existencia física verificada en almacén.</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-200">Stock Mínimo</dt>
                    <dd className="text-slate-400">Nivel de reorden por debajo del cual se detiene producción.</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-200">Déficit</dt>
                    <dd className="text-slate-400">Faltante cuantitativo (Stock Mínimo - Stock Base).</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-200">En Tránsito (OAB)</dt>
                    <dd className="text-slate-400">Unidades con Orden de Abastecimiento emitida en proceso de compra/entrega.</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-200">Stock Proyectado</dt>
                    <dd className="text-slate-400">Stock Base actual + En Tránsito confirmado.</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-200">Reconteo 3D</dt>
                    <dd className="text-slate-400">Auditoría física realizada en los últimos 3 días mediante escáner.</dd>
                  </div>
                </dl>
              </div>

              {/* Bloque 2: Leyenda (2/5 width) */}
              <div className="lg:col-span-2 space-y-4">
                <div>
                  <h3 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">
                    Estados de Stock
                  </h3>
                  <div className="space-y-1.5 text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 font-medium">🔴 Sin Stock</span>
                      <span className="text-slate-400">— 0 unidades en almacén</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400 font-medium">🟠 Bajo Mínimo</span>
                      <span className="text-slate-400">— Por debajo del mínimo requerido</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-medium">🟢 En Stock</span>
                      <span className="text-slate-400">— Igual o superior al mínimo</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 font-medium">🔵 En Reconteo</span>
                      <span className="text-slate-400">— En auditoría física de pasillo</span>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">
                    Prioridades Operativas
                  </h3>
                  <div className="space-y-1.5 text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 font-medium">🔴 Urgente</span>
                      <span className="text-slate-400">— Detiene líneas de ensamblaje</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400 font-medium">🟠 Alta</span>
                      <span className="text-slate-400">— Reposición en menos de 48h</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400 font-medium">🟡 Media</span>
                      <span className="text-slate-400">— Planificación semanal</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-medium">🟢 Baja</span>
                      <span className="text-slate-400">— Reposición ordinaria</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer con Sync Info */}
            <div className="flex flex-wrap items-center justify-between pt-3 border-t border-borderSubtle text-[10px] text-slate-500">
              <span>📡 Fuente de Datos: Notion ERP Transaccional — Planta Sanesca Exhibidores.</span>
              <span>Última Sincronización: <span className="text-slate-300 font-mono">{lastSyncDisplay}</span></span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
