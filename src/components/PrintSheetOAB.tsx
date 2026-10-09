import React, { useEffect, useState, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X, ExternalLink, ArrowUpDown } from 'lucide-react';
import QRCode from 'qrcode';
import { OABLineItem, OABHeader } from '../types/oab';

interface PrintSheetOABProps {
  header: OABHeader;
  lineas: OABLineItem[];
  onClose: () => void;
}

type PriorityType = 'Urgente' | 'Alta' | 'Media' | 'Baja' | 'Por Pedido';
type SortCriterion = 'nombre' | 'costo' | 'subtotal';
type SortDirection = 'asc' | 'desc';

function normalizePriority(p?: string): PriorityType {
  if (!p) return 'Media';
  const lower = p.toLowerCase().trim();
  if (lower.includes('urgente')) return 'Urgente';
  if (lower.includes('alta')) return 'Alta';
  if (lower.includes('baja')) return 'Baja';
  if (lower.includes('pedido')) return 'Por Pedido';
  return 'Media';
}

const PRIORITY_ORDER: PriorityType[] = ['Urgente', 'Alta', 'Media', 'Baja', 'Por Pedido'];

const PRIORITY_META: Record<PriorityType, {
  label: string;
  icon: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  rowBg: string;
}> = {
  Urgente: {
    label: 'URGENTE',
    icon: '🔴',
    badgeBg: 'bg-rose-100',
    badgeText: 'text-rose-900',
    badgeBorder: 'border-rose-400',
    rowBg: 'bg-rose-50/80',
  },
  Alta: {
    label: 'ALTA',
    icon: '🟠',
    badgeBg: 'bg-amber-100',
    badgeText: 'text-amber-900',
    badgeBorder: 'border-amber-400',
    rowBg: 'bg-amber-50/80',
  },
  Media: {
    label: 'MEDIA',
    icon: '🟡',
    badgeBg: 'bg-blue-100',
    badgeText: 'text-blue-900',
    badgeBorder: 'border-blue-300',
    rowBg: 'bg-blue-50/60',
  },
  Baja: {
    label: 'BAJA',
    icon: '🟢',
    badgeBg: 'bg-slate-100',
    badgeText: 'text-slate-800',
    badgeBorder: 'border-slate-300',
    rowBg: 'bg-slate-50/60',
  },
  'Por Pedido': {
    label: 'POR PEDIDO',
    icon: '🔵',
    badgeBg: 'bg-indigo-100',
    badgeText: 'text-indigo-900',
    badgeBorder: 'border-indigo-400',
    rowBg: 'bg-indigo-50/60',
  },
};

export const PrintSheetOAB: React.FC<PrintSheetOABProps> = ({
  header,
  lineas,
  onClose
}) => {
  const [qrUrl, setQrUrl] = useState<string>('');
  const printSheetRef = useRef<HTMLDivElement>(null);

  // Criterios de ordenamiento dentro de cada grupo de prioridad
  const [sortCriterion, setSortCriterion] = useState<SortCriterion>('subtotal');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  useEffect(() => {
    // URL profunda canónica con deep link al folio específico
    const deepLinkUrl = `https://sanesca-inventario.pages.dev/?folio=${encodeURIComponent(header.folio)}`;
    QRCode.toDataURL(deepLinkUrl, { width: 140, margin: 1 })
      .then(url => setQrUrl(url))
      .catch(err => console.error('Error generating QR:', err));
  }, [header.folio]);

  // Función de ordenamiento interno
  const sortItems = (items: OABLineItem[]) => {
    return [...items].sort((a, b) => {
      if (sortCriterion === 'nombre') {
        const cmp = a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' });
        return sortDirection === 'asc' ? cmp : -cmp;
      }
      if (sortCriterion === 'costo') {
        const diff = (a.costoUnitarioUSD || 0) - (b.costoUnitarioUSD || 0);
        return sortDirection === 'asc' ? diff : -diff;
      }
      if (sortCriterion === 'subtotal') {
        const diff = (a.subtotalUSD || 0) - (b.subtotalUSD || 0);
        return sortDirection === 'asc' ? diff : -diff;
      }
      return 0;
    });
  };

  // Agrupación reactiva por Prioridad Operativa con numeración global correlativa
  const groupedLines = useMemo(() => {
    let globalCounter = 1;
    const groups: {
      priority: PriorityType;
      subtotal: number;
      items: { linea: OABLineItem; globalIndex: number }[];
    }[] = [];

    for (const prio of PRIORITY_ORDER) {
      const matching = lineas.filter(l => normalizePriority(l.prioridad) === prio);
      if (matching.length > 0) {
        const sorted = sortItems(matching);
        const itemsWithIndex = sorted.map(linea => ({
          linea,
          globalIndex: globalCounter++
        }));
        const subtotal = matching.reduce((sum, l) => sum + (l.subtotalUSD || 0), 0);
        groups.push({
          priority: prio,
          subtotal,
          items: itemsWithIndex
        });
      }
    }

    // Ítems no clasificados en caso de inconsistencia de datos
    const unclassified = lineas.filter(l => !PRIORITY_ORDER.includes(normalizePriority(l.prioridad)));
    if (unclassified.length > 0) {
      const sorted = sortItems(unclassified);
      const itemsWithIndex = sorted.map(linea => ({
        linea,
        globalIndex: globalCounter++
      }));
      const subtotal = unclassified.reduce((sum, l) => sum + (l.subtotalUSD || 0), 0);
      groups.push({
        priority: 'Media',
        subtotal,
        items: itemsWithIndex
      });
    }

    return groups;
  }, [lineas, sortCriterion, sortDirection]);

  // Fallback para Android / Tablets: Abrir documento limpio en ventana independiente
  const handleOpenCleanWindow = () => {
    if (!printSheetRef.current) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Por favor permita las ventanas emergentes (pop-ups) para abrir la hoja viajera.');
      return;
    }

    const sheetHtml = printSheetRef.current.innerHTML;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html lang="es">
        <head>
          <meta charset="UTF-8" />
          <title>Hoja Viajera OAB - ${header.folio}</title>
          <script src="https://cdn.tailwindcss.com"></script>
          <style>
            @page {
              size: letter portrait;
              margin: 6mm 8mm;
            }
            body {
              background: #ffffff !important;
              color: #000000 !important;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
              margin: 0;
              padding: 8px;
            }
            .avoid-break {
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }
            tr {
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }
            @media print {
              .no-print-btn { display: none !important; }
            }
          </style>
        </head>
        <body>
          <div class="no-print-btn" style="padding: 10px 0; text-align: right; border-bottom: 1px solid #ccc; margin-bottom: 12px;">
            <button onclick="window.print()" style="background: #0284c7; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-weight: bold; cursor: pointer;">
              🖨️ Imprimir / Guardar como PDF
            </button>
          </div>
          <div style="width: 215.9mm; max-width: 100%; margin: 0 auto;">
            ${sheetHtml}
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
  };

  const portalTarget = typeof document !== 'undefined'
    ? (document.getElementById('print-portal') || document.body)
    : null;

  if (!portalTarget) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/80 backdrop-blur-sm p-2 sm:p-4 overflow-y-auto custom-scrollbar print:static print:p-0 print:m-0 print:bg-white print:overflow-visible">
      {/* Container: Screen Preview vs Print Carta */}
      <div className="bg-white text-slate-900 w-full max-w-4xl rounded-xl shadow-2xl overflow-hidden print:w-full print:max-w-none print:shadow-none print:rounded-none">
        
        {/* Floating Screen Action Bar (hidden in print) */}
        <div className="bg-slate-900 text-white px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3 no-print border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold font-mono text-brand-400">{header.folio}</span>
            <span className="text-xs text-slate-400 hidden sm:inline">— Hoja Viajera Carta (Letter 8.5" x 11")</span>
          </div>

          {/* Selector de orden dinámico */}
          <div className="flex items-center gap-2 bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700">
            <span className="text-[11px] text-slate-300 font-semibold flex items-center gap-1">
              <ArrowUpDown className="w-3 h-3 text-brand-400" />
              <span>Orden:</span>
            </span>
            <select
              value={`${sortCriterion}-${sortDirection}`}
              onChange={(e) => {
                const [crit, dir] = e.target.value.split('-') as [SortCriterion, SortDirection];
                setSortCriterion(crit);
                setSortDirection(dir);
              }}
              className="bg-slate-900 text-slate-100 text-xs font-medium rounded border border-slate-700 px-2 py-1 focus:border-brand-400 focus:outline-none cursor-pointer hover:bg-slate-950 transition"
            >
              <option value="subtotal-desc">💰 Subtotal ($ Mayor a Menor)</option>
              <option value="subtotal-asc">💰 Subtotal ($ Menor a Mayor)</option>
              <option value="costo-desc">💲 P. Unitario (Mayor a Menor)</option>
              <option value="costo-asc">💲 P. Unitario (Menor a Mayor)</option>
              <option value="nombre-asc">🔤 Nombre (A - Z)</option>
              <option value="nombre-desc">🔤 Nombre (Z - A)</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleOpenCleanWindow}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition active:scale-95"
              title="Abre la hoja en una pestaña limpia sin barras del dashboard"
            >
              <ExternalLink className="w-3.5 h-3.5 text-cyan-400" />
              <span>Ventana Limpia</span>
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg bg-brand-500 hover:bg-brand-600 text-slate-950 transition active:scale-95 shadow-md shadow-brand-500/20"
            >
              <Printer className="w-4 h-4" />
              <span>Imprimir / Guardar PDF</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition min-w-[36px] min-h-[36px] flex items-center justify-center"
              title="Cerrar vista previa"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ============================================================= */}
        {/* PRINTABLE SHEET CONTENT (FORMATO TIPO CARTA ESTRICTO)         */}
        {/* ============================================================= */}
        <div ref={printSheetRef} className="p-6 sm:p-8 print:p-0 text-xs font-sans w-full max-w-[215.9mm] mx-auto">
          
          {/* Header Formal */}
          <div className="flex items-start justify-between border-b-2 border-slate-900 pb-3 mb-3 avoid-break">
            <div>
              <div className="flex items-center gap-3">
                <span className="text-xl font-black tracking-widest text-slate-950">SANESCA EXHIBIDORES</span>
                <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-slate-700 font-bold">
                  PLANTA INDUSTRIAL
                </span>
              </div>
              <h1 className="text-sm font-extrabold text-slate-800 uppercase tracking-tight mt-1">
                Hoja Viajera de Abastecimiento & Compras (OAB)
              </h1>
              <p className="text-[10px] text-slate-600 mt-0.5">
                Flujo Operativo Integrado: Inventario ➔ Gerencia ➔ Compras ➔ Rampa de Recepción
              </p>
            </div>

            {/* QR & Folio Block */}
            <div className="flex items-center gap-3 text-right">
              <div>
                <p className="text-[9px] uppercase font-bold text-slate-500">Folio Transaccional</p>
                <p className="text-base font-black font-mono text-slate-950 tracking-wider">{header.folio}</p>
                <p className="text-[10px] font-mono text-slate-600 mt-0.5">Fecha: {header.fechaEmision}</p>
                <p className="text-[10px] font-mono text-slate-600">Tasa BCV: Bs {header.tasaBCV.toFixed(2)}</p>
              </div>
              {qrUrl && (
                <div className="flex flex-col items-center">
                  <img src={qrUrl} alt="QR Folio Deep-Link" className="w-16 h-16 border border-slate-300 p-0.5 rounded bg-white" />
                  <span className="text-[7px] font-mono text-slate-500 uppercase mt-0.5">Escaneo Digital</span>
                </div>
              )}
            </div>
          </div>

          {/* Subcintillo de Auditoría y Metadatos de Ordenamiento */}
          <div className="flex items-center justify-between text-[8px] text-slate-600 font-mono mb-2 pb-1 border-b border-slate-200 avoid-break">
            <span>Agrupación: Prioridad Operativa (Urgente ➔ Alta ➔ Media ➔ Baja)</span>
            <span>
              Orden interno:{' '}
              {sortCriterion === 'nombre' ? 'Alfabético' : sortCriterion === 'costo' ? 'Precio Unitario' : 'Subtotal'}{' '}
              ({sortDirection === 'asc' ? 'Ascendente' : 'Descendente'})
            </span>
          </div>

          {/* Table of Items con Agrupación por Prioridad */}
          <table className="w-full text-[9px] border-collapse border border-slate-400 mb-3">
            <thead>
              <tr className="bg-slate-100 text-slate-800 font-bold uppercase text-[8px] tracking-wider border-b border-slate-400">
                <th className="border border-slate-400 p-1 text-center w-6">#</th>
                <th className="border border-slate-400 p-1 text-left">Insumo / Descripción</th>
                <th className="border border-slate-400 p-1 text-center w-12">Stock</th>
                <th className="border border-slate-400 p-1 text-center w-12">Déficit</th>
                <th className="border border-slate-400 p-1 text-center w-14 bg-amber-50">Cant. Sol.</th>
                <th className="border border-slate-400 p-1 text-right w-14">P. Unit ($)</th>
                <th className="border border-slate-400 p-1 text-right w-14">Subtotal ($)</th>
                <th className="border border-slate-400 p-1 text-center w-24 bg-blue-50">
                  Gerencia Magaly<br/><span className="text-[7px] font-normal">[ ] Aprobado / Cant</span>
                </th>
                <th className="border border-slate-400 p-1 text-center w-28 bg-emerald-50">
                  Gestión Compras<br/><span className="text-[7px] font-normal">Proveedor / Factura</span>
                </th>
                <th className="border border-slate-400 p-1 text-center w-24 bg-purple-50">
                  Rampa Almacén<br/><span className="text-[7px] font-normal">Cant. Recibida</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {groupedLines.map(group => {
                const meta = PRIORITY_META[group.priority];
                return (
                  <React.Fragment key={group.priority}>
                    {/* Header de Bloque por Prioridad */}
                    <tr className={`${meta.rowBg} border-t-2 border-b border-slate-400 avoid-break`}>
                      <td colSpan={10} className="p-1 px-2">
                        <div className="flex items-center justify-between text-[9px]">
                          <span className="flex items-center gap-1.5 font-black uppercase tracking-wider text-slate-900">
                            <span className="text-xs">{meta.icon}</span>
                            <span>Prioridad {meta.label}</span>
                            <span className="font-normal text-slate-600 font-mono text-[8px]">
                              ({group.items.length} {group.items.length === 1 ? 'insumo' : 'insumos'})
                            </span>
                          </span>
                          <span className="font-mono font-bold text-slate-800 text-[9px]">
                            Subtotal Prioridad: ${group.subtotal.toFixed(2)} USD
                          </span>
                        </div>
                      </td>
                    </tr>

                    {/* Renglones de Insumos */}
                    {group.items.map(({ linea, globalIndex }) => (
                      <tr key={globalIndex} className="border-b border-slate-300 hover:bg-slate-50 avoid-break">
                        <td className="border border-slate-300 p-0.5 sm:p-1 text-center font-mono text-slate-600 font-bold text-[9px]">
                          {globalIndex}
                        </td>
                        <td className="border border-slate-300 p-0.5 sm:p-1">
                          <p className="font-semibold text-slate-900 leading-tight text-[9.5px]">{linea.nombre}</p>
                          {linea.empaqueComercial && (
                            <p className="text-[7.5px] text-amber-900 font-mono leading-none mt-0.5">
                              📦 {linea.empaqueComercial}
                              {linea.paquetesSugeridos && linea.factorEmpaque && linea.factorEmpaque > 1 ? ` (${linea.paquetesSugeridos} pqt)` : ''}
                            </p>
                          )}
                          {linea.proyectoNombre && (
                            <p className="text-[7.5px] text-blue-700 font-medium leading-none mt-0.5">Obra: {linea.proyectoNombre}</p>
                          )}
                        </td>
                        <td className="border border-slate-300 p-0.5 sm:p-1 text-center font-mono text-[9px]">{linea.cantidadStock}</td>
                        <td className="border border-slate-300 p-0.5 sm:p-1 text-center font-mono text-red-600 font-bold text-[9px]">
                          {linea.deficit > 0 ? `-${linea.deficit}` : '0'}
                        </td>
                        <td className="border border-slate-300 p-0.5 sm:p-1 text-center font-mono font-black text-slate-900 bg-amber-50/50 text-[9px]">
                          {linea.cantidadSolicitada}
                        </td>
                        <td className="border border-slate-300 p-0.5 sm:p-1 text-right font-mono text-[9px]">
                          ${linea.costoUnitarioUSD.toFixed(2)}
                        </td>
                        <td className="border border-slate-300 p-0.5 sm:p-1 text-right font-mono font-semibold text-[9px]">
                          ${linea.subtotalUSD.toFixed(2)}
                        </td>
                        
                        {/* Casilla Manuscrita Magaly */}
                        <td className="border border-slate-300 p-0.5 sm:p-1 text-center bg-blue-50/20">
                          <div className="flex items-center justify-center gap-1">
                            <div className="w-2.5 h-2.5 border border-slate-600 rounded-sm"></div>
                            <span className="text-slate-400 text-[8px]">_______</span>
                          </div>
                        </td>

                        {/* Casilla Manuscrita Compras */}
                        <td className="border border-slate-300 p-0.5 sm:p-1 text-center bg-emerald-50/20 text-[8px] text-slate-400">
                          <div className="h-3 border-b border-dotted border-slate-400"></div>
                        </td>

                        {/* Casilla Manuscrita Rampa */}
                        <td className="border border-slate-300 p-0.5 sm:p-1 text-center bg-purple-50/20 text-[8px] text-slate-400">
                          <div className="h-3 border-b border-dotted border-slate-400"></div>
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>

          {/* Resumen Bimonetario */}
          <div className="flex items-start justify-between border border-slate-400 rounded p-2 mb-3 bg-slate-50 avoid-break">
            <div>
              <p className="text-[9px] uppercase font-bold text-slate-600">Notas / Instrucciones de Operaciones:</p>
              <p className="text-[9.5px] text-slate-800 italic mt-0.5">
                {header.notas || 'Sin notas especiales. Entregar factura original y nota de entrega en rampa.'}
              </p>
            </div>
            <div className="text-right space-y-0.5">
              <div className="flex items-center justify-end gap-3">
                <span className="text-[10px] font-semibold text-slate-700">Total Estimado ($ USD):</span>
                <span className="font-mono text-xs font-black text-slate-950">${header.totalUSD.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-end gap-3">
                <span className="text-[10px] font-semibold text-slate-700">Total Estimado (Bs BCV):</span>
                <span className="font-mono text-xs font-black text-slate-950">Bs {header.totalBs.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Cuadrantes de Firmas Operativas */}
          <div className="grid grid-cols-4 gap-3 text-center mt-3 pt-2 border-t border-slate-300 text-[9px] avoid-break">
            <div className="space-y-4">
              <div className="h-7 border-b border-slate-500"></div>
              <div>
                <p className="font-bold text-slate-900 uppercase">1. Encargado Inventario</p>
                <p className="text-slate-500 text-[8px]">Emisión & Solicitud</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="h-7 border-b border-slate-500"></div>
              <div>
                <p className="font-bold text-slate-900 uppercase">2. Gerencia Magaly</p>
                <p className="text-slate-500 text-[8px]">Aprobación Presupuesto</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="h-7 border-b border-slate-500"></div>
              <div>
                <p className="font-bold text-slate-900 uppercase">3. Encargada Compras</p>
                <p className="text-slate-500 text-[8px]">Cotización & Factura</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="h-7 border-b border-slate-500"></div>
              <div>
                <p className="font-bold text-slate-900 uppercase">4. Rampa de Recepción</p>
                <p className="text-slate-500 text-[8px]">Conteo Físico & Entrada</p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>,
    portalTarget
  );
};
