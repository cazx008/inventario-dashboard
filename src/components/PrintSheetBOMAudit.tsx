import React from 'react';
import { Printer, X, Boxes, Building2, AlertTriangle, CheckCircle2 } from 'lucide-react';

export interface BalanceItemPrint {
  mat: string;
  codigo: string;
  nombre: string;
  unidad: string;
  teorico: number;
  real: number;
  diferencia: number;
  varianzaPct: number;
  costoUnitarioUSD: number;
  costoVariacionUSD: number;
  estado: 'NORMAL' | 'MERMA_EXCESIVA' | 'AHORRO' | 'EXACTO' | 'NO_PRESUPUESTADO';
}

export interface MuebleSinBOMPrint {
  id: string;
  codigo: string;
  nombre: string;
  cantidad: number;
  motivo?: string;
}

interface PrintSheetBOMAuditProps {
  orderCode: string;
  orderName: string;
  balanceItems: BalanceItemPrint[];
  mueblesSinBOM: MuebleSinBOMPrint[];
  kpis: {
    totalTeoricoUSD: number;
    totalRealUSD: number;
    diferenciaNetaUSD: number;
    varianzaGlobalPct: number;
    mueblesConBOMCount: number;
    mueblesSinBOMCount: number;
    salidasKardexCount: number;
  };
  retazosDeclarados: Record<string, number>;
  totalRetazosUSD: number;
  varianzaAjustadaUSD: number;
  onClose: () => void;
}

export const PrintSheetBOMAudit: React.FC<PrintSheetBOMAuditProps> = ({
  orderCode,
  orderName,
  balanceItems,
  mueblesSinBOM,
  kpis,
  retazosDeclarados,
  totalRetazosUSD,
  varianzaAjustadaUSD,
  onClose
}) => {
  const currentDate = new Date().toLocaleDateString('es-VE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });

  return (
    <>
      <style>{`
        @media print {
          @page {
            size: letter portrait;
            margin: 10mm;
          }
          body {
            background: #ffffff !important;
            color: #000000 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .no-print {
            display: none !important;
          }
          .print-bom-root {
            position: static !important;
            background: transparent !important;
            padding: 0 !important;
            margin: 0 !important;
            overflow: visible !important;
          }
          .print-bom-card {
            width: 100% !important;
            max-width: 100% !important;
            border: none !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            background: #ffffff !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          .avoid-break {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
        }
      `}</style>

      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 overflow-y-auto custom-scrollbar print-bom-root print:p-0 print:m-0 print:bg-white">
        {/* Contenedor: Screen Preview vs Print Carta */}
        <div className="bg-white text-slate-900 w-full max-w-5xl rounded-2xl shadow-2xl overflow-hidden print-bom-card print:w-full print:max-w-none print:shadow-none print:rounded-none">
          
          {/* Barra Flotante de Acciones en Pantalla (Oculta en Impresión) */}
          <div className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between no-print border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold font-mono text-brand-400">{orderCode || 'ORD-N/A'}</span>
              <span className="text-xs text-slate-400">— Vista Previa de Auditoría de Cierre BOM (Carta 8.5" x 11")</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-brand-500 hover:bg-brand-600 text-slate-950 transition active:scale-95 shadow-md"
              >
                <Printer className="w-4 h-4" />
                <span>Imprimir / Guardar PDF</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
                title="Cerrar vista previa"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* ============================================================= */}
          {/* HOJA DE AUDITORÍA FORMAL EN FORMATO CARTA (PRINTABLE SHEET)     */}
          {/* ============================================================= */}
          <div className="p-8 print:p-0 text-xs font-sans">
            
            {/* Header Formal Industrial */}
            <div className="flex items-start justify-between border-b-2 border-slate-900 pb-3 mb-4 avoid-break">
              <div>
                <div className="flex items-center gap-3">
                  <span className="text-xl font-black tracking-widest text-slate-950">SANESCA EXHIBIDORES</span>
                  <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-slate-700 font-bold bg-slate-100">
                    PLANTA INDUSTRIAL
                  </span>
                </div>
                <h1 className="text-sm font-extrabold text-slate-800 uppercase tracking-tight mt-1">
                  Informe de Auditoría Ex-Post — Balance de Cierre BOM & Mermas
                </h1>
                <p className="text-[10px] text-slate-600 mt-0.5">
                  Control Industrial: Demanda Teórica Receta vs Despachos Reales Kardex (BD_Pedidos_Lineas & BD_Kardex)
                </p>
              </div>

              {/* Bloque de Identificación de Orden */}
              <div className="text-right">
                <p className="text-[9px] uppercase font-bold text-slate-500">Orden de Fabricación</p>
                <p className="text-base font-black font-mono text-slate-950 tracking-wider">{orderCode || 'ORD-N/A'}</p>
                <p className="text-[10px] font-bold text-slate-700 mt-0.5 truncate max-w-[240px]">{orderName || 'Sin Nombre de Proyecto'}</p>
                <p className="text-[10px] font-mono text-slate-600">Fecha de Emisión: {currentDate}</p>
              </div>
            </div>

            {/* Ficha Resumen de KPIs de Auditoría */}
            <div className="grid grid-cols-4 gap-3 p-3 bg-slate-50 border border-slate-300 rounded-lg mb-4 avoid-break">
              <div className="border-r border-slate-200 pr-2">
                <span className="text-[9px] uppercase font-bold text-slate-500 block">Demanda Teórica BOM</span>
                <span className="text-sm font-black font-mono text-slate-900 block">
                  {kpis.totalTeoricoUSD > 0 ? `$${kpis.totalTeoricoUSD.toFixed(2)} USD` : 'Control Cuantitativo'}
                </span>
                <span className="text-[9px] text-slate-600">
                  {kpis.mueblesConBOMCount} muebles con receta
                </span>
              </div>

              <div className="border-r border-slate-200 pr-2">
                <span className="text-[9px] uppercase font-bold text-slate-500 block">Despachado Real Kardex</span>
                <span className="text-sm font-black font-mono text-slate-900 block">
                  {kpis.totalRealUSD > 0 ? `$${kpis.totalRealUSD.toFixed(2)} USD` : `${kpis.salidasKardexCount} salidas`}
                </span>
                <span className="text-[9px] text-slate-600">
                  {kpis.salidasKardexCount} movs. en Libro Mayor
                </span>
              </div>

              <div className="border-r border-slate-200 pr-2">
                <span className="text-[9px] uppercase font-bold text-slate-500 block">Varianza Bruta</span>
                <span className={`text-sm font-black font-mono block ${kpis.diferenciaNetaUSD > 0 ? 'text-amber-800' : 'text-slate-900'}`}>
                  {kpis.diferenciaNetaUSD > 0 ? `+$${kpis.diferenciaNetaUSD.toFixed(2)}` : `$${kpis.diferenciaNetaUSD.toFixed(2)}`}
                </span>
                <span className="text-[9px] font-mono font-bold text-slate-600">
                  {kpis.varianzaGlobalPct > 0 ? `+${kpis.varianzaGlobalPct.toFixed(1)}% desv.` : `${kpis.varianzaGlobalPct.toFixed(1)}%`}
                </span>
              </div>

              <div>
                <span className="text-[9px] uppercase font-bold text-slate-500 block">Merma Neta Liquidada</span>
                <span className="text-sm font-black font-mono text-slate-950 block">
                  ${varianzaAjustadaUSD.toFixed(2)} USD
                </span>
                <span className="text-[9px] text-emerald-700 font-bold block">
                  {totalRetazosUSD > 0 ? `Retazos: -$${totalRetazosUSD.toFixed(2)} USD` : 'Sin retazos devueltos'}
                </span>
              </div>
            </div>

            {/* TABLA PRINCIPAL DE INSUMOS & DESVIACIONES */}
            <div className="mb-4">
              <h2 className="text-[10px] font-black uppercase text-slate-900 mb-1 tracking-wider">
                1. Matriz Cuantitativa de Conciliación de Insumos
              </h2>
              <table className="w-full text-[9px] border-collapse border border-slate-400 mb-2">
                <thead>
                  <tr className="bg-slate-100 text-slate-800 font-bold uppercase text-[8px] tracking-wider border-b border-slate-400">
                    <th className="border border-slate-400 p-1 text-center w-6">#</th>
                    <th className="border border-slate-400 p-1 text-left">Insumo / Descripción Técnica</th>
                    <th className="border border-slate-400 p-1 text-center w-12">Código</th>
                    <th className="border border-slate-400 p-1 text-center w-10">Und</th>
                    <th className="border border-slate-400 p-1 text-right w-14 bg-blue-50/50">Teórico BOM</th>
                    <th className="border border-slate-400 p-1 text-right w-14 bg-amber-50/50">Real Kardex</th>
                    <th className="border border-slate-400 p-1 text-right w-14">Diferencia</th>
                    <th className="border border-slate-400 p-1 text-right w-12">% Var</th>
                    <th className="border border-slate-400 p-1 text-right w-14">P. Unit ($)</th>
                    <th className="border border-slate-400 p-1 text-right w-16">Impacto ($)</th>
                    <th className="border border-slate-400 p-1 text-center w-24">Diagnóstico</th>
                  </tr>
                </thead>
                <tbody>
                  {balanceItems.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="p-3 text-center text-slate-500 font-mono italic">
                        No se registraron movimientos ni demanda para esta orden.
                      </td>
                    </tr>
                  ) : (
                    balanceItems.map((item, idx) => {
                      const isExcess = item.diferencia > 0;
                      const isSaving = item.diferencia < 0;
                      return (
                        <tr key={idx} className="border-b border-slate-300 hover:bg-slate-50 avoid-break">
                          <td className="border border-slate-300 p-1 text-center font-mono text-slate-500">{idx + 1}</td>
                          <td className="border border-slate-300 p-1 font-semibold text-slate-900 leading-tight">
                            {item.nombre}
                          </td>
                          <td className="border border-slate-300 p-1 text-center font-mono text-slate-600">{item.codigo}</td>
                          <td className="border border-slate-300 p-1 text-center font-mono text-slate-500">{item.unidad}</td>
                          <td className="border border-slate-300 p-1 text-right font-mono text-blue-900 font-bold bg-blue-50/20">
                            {item.teorico}
                          </td>
                          <td className="border border-slate-300 p-1 text-right font-mono text-amber-900 font-bold bg-amber-50/20">
                            {item.real}
                          </td>
                          <td className={`border border-slate-300 p-1 text-right font-mono font-bold ${
                            isExcess ? 'text-amber-800' : isSaving ? 'text-emerald-700' : 'text-slate-600'
                          }`}>
                            {item.diferencia > 0 ? `+${item.diferencia}` : item.diferencia}
                          </td>
                          <td className="border border-slate-300 p-1 text-right font-mono text-slate-700">
                            {item.varianzaPct > 0 ? `+${item.varianzaPct}%` : `${item.varianzaPct}%`}
                          </td>
                          <td className="border border-slate-300 p-1 text-right font-mono text-slate-600">
                            {item.costoUnitarioUSD > 0 ? `$${item.costoUnitarioUSD.toFixed(2)}` : '—'}
                          </td>
                          <td className="border border-slate-300 p-1 text-right font-mono font-bold text-slate-900">
                            {item.costoVariacionUSD !== 0 ? `$${item.costoVariacionUSD.toFixed(2)}` : '—'}
                          </td>
                          <td className="border border-slate-300 p-1 text-center">
                            {item.estado === 'NORMAL' && (
                              <span className="text-[8px] font-bold text-emerald-800 bg-emerald-100 px-1 rounded">DENTRO DE RANGO</span>
                            )}
                            {item.estado === 'MERMA_EXCESIVA' && (
                              <span className="text-[8px] font-bold text-amber-900 bg-amber-100 px-1 rounded">MERMA EXCESIVA</span>
                            )}
                            {item.estado === 'AHORRO' && (
                              <span className="text-[8px] font-bold text-blue-900 bg-blue-100 px-1 rounded">AHORRO TALLER</span>
                            )}
                            {item.estado === 'EXACTO' && (
                              <span className="text-[8px] font-bold text-slate-800 bg-slate-100 px-1 rounded">EXACTO</span>
                            )}
                            {item.estado === 'NO_PRESUPUESTADO' && (
                              <span className="text-[8px] font-bold text-rose-900 bg-rose-100 px-1 rounded">NO PRESUPUESTADO</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* SECCIÓN 2: RETAZOS DECLARADOS & MUEBLES ESPECIALES */}
            <div className="grid grid-cols-2 gap-3 mb-4 avoid-break">
              {/* Retazos Devueltos */}
              <div className="p-2.5 border border-slate-300 rounded bg-slate-50">
                <span className="text-[9px] font-bold uppercase text-slate-800 block mb-1">
                  2. Remanentes / Retazos Reintegrados al Almacén
                </span>
                {Object.keys(retazosDeclarados).length === 0 ? (
                  <p className="text-[9px] text-slate-500 italic">No se declararon retazos o sobrantes devueltos.</p>
                ) : (
                  <ul className="text-[9px] space-y-1">
                    {Object.entries(retazosDeclarados).map(([mat, qty]) => {
                      const it = balanceItems.find(b => b.mat === mat);
                      return (
                        <li key={mat} className="flex justify-between border-b border-slate-200 pb-0.5">
                          <span className="text-slate-700">{it?.nombre || mat}:</span>
                          <span className="font-mono font-bold text-slate-900">{qty} {it?.unidad || 'Und'}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* Muebles Especiales sin Receta */}
              <div className="p-2.5 border border-slate-300 rounded bg-slate-50">
                <span className="text-[9px] font-bold uppercase text-slate-800 block mb-1">
                  3. Fabricaciones Especiales (Sin Receta Valery)
                </span>
                {mueblesSinBOM.length === 0 ? (
                  <p className="text-[9px] text-slate-500 italic">Todos los muebles de la orden poseen receta estándar.</p>
                ) : (
                  <ul className="text-[9px] space-y-1">
                    {mueblesSinBOM.slice(0, 4).map(m => (
                      <li key={m.id} className="flex justify-between border-b border-slate-200 pb-0.5">
                        <span className="text-slate-700 truncate max-w-[180px]">{m.nombre}:</span>
                        <span className="font-mono font-bold text-slate-900">{m.cantidad} und ({m.codigo})</span>
                      </li>
                    ))}
                    {mueblesSinBOM.length > 4 && (
                      <li className="text-[8px] text-slate-500 italic">+ {mueblesSinBOM.length - 4} muebles adicionales...</li>
                    )}
                  </ul>
                )}
              </div>
            </div>

            {/* SECCIÓN 3: CUADRÍCULA DE FIRMAS FORMALES DE CIERRE */}
            <div className="border border-slate-400 rounded-lg p-3 bg-white avoid-break">
              <span className="text-[9px] font-bold uppercase text-slate-900 block mb-3 text-center tracking-wider">
                Certificación y Cierre Formal de Tienda
              </span>
              <div className="grid grid-cols-4 gap-4 text-center">
                <div>
                  <div className="border-b border-slate-800 h-10 mb-1"></div>
                  <span className="text-[9px] font-bold text-slate-900 block">Almacenista Receptor</span>
                  <span className="text-[8px] text-slate-500 block">Control de Entregas</span>
                </div>
                <div>
                  <div className="border-b border-slate-800 h-10 mb-1"></div>
                  <span className="text-[9px] font-bold text-slate-900 block">Supervisor de Taller</span>
                  <span className="text-[8px] text-slate-500 block">Herrería / Carpintería</span>
                </div>
                <div>
                  <div className="border-b border-slate-800 h-10 mb-1"></div>
                  <span className="text-[9px] font-bold text-slate-900 block">Auditor de Calidad</span>
                  <span className="text-[8px] text-slate-500 block">Auditoría de Procesos</span>
                </div>
                <div>
                  <div className="border-b border-slate-800 h-10 mb-1"></div>
                  <span className="text-[9px] font-bold text-slate-900 block">Gerencia de Operaciones</span>
                  <span className="text-[8px] text-slate-500 block">Liquidación & Cierre</span>
                </div>
              </div>
            </div>

            {/* Pie de Página */}
            <div className="mt-3 pt-2 border-t border-slate-300 flex justify-between text-[8px] text-slate-500 font-mono avoid-break">
              <span>Sanesca Exhibidores C.A. · Sistema de Gestión Industrial SSOT</span>
              <span>Documento Oficial de Liquidación · Hoja 1 de 1</span>
            </div>

          </div>
        </div>
      </div>
    </>
  );
};
