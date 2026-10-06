import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X, ExternalLink, FileText } from 'lucide-react';
import QRCode from 'qrcode';
import { OABLineItem, OABHeader } from '../types/oab';

interface PrintSheetOABProps {
  header: OABHeader;
  lineas: OABLineItem[];
  onClose: () => void;
}

export const PrintSheetOAB: React.FC<PrintSheetOABProps> = ({
  header,
  lineas,
  onClose
}) => {
  const [qrUrl, setQrUrl] = useState<string>('');
  const printSheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // URL profunda canónica con deep link al folio específico
    const deepLinkUrl = `https://sanesca-inventario.pages.dev/?folio=${encodeURIComponent(header.folio)}`;
    QRCode.toDataURL(deepLinkUrl, { width: 140, margin: 1 })
      .then(url => setQrUrl(url))
      .catch(err => console.error('Error generating QR:', err));
  }, [header.folio]);

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
              margin: 8mm;
            }
            body {
              background: #ffffff !important;
              color: #000000 !important;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
              margin: 0;
              padding: 10px;
            }
            .avoid-break {
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
          <div className="flex items-start justify-between border-b-2 border-slate-900 pb-3 mb-4 avoid-break">
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

          {/* Table of Items */}
          <table className="w-full text-[10px] border-collapse border border-slate-400 mb-4">
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
              {lineas.map((linea, idx) => (
                <tr key={idx} className="border-b border-slate-300 hover:bg-slate-50">
                  <td className="border border-slate-300 p-1 text-center font-mono text-slate-500">{idx + 1}</td>
                  <td className="border border-slate-300 p-1">
                    <p className="font-semibold text-slate-900 leading-tight">{linea.nombre}</p>
                    {linea.empaqueComercial && (
                      <p className="text-[8px] text-amber-800 font-mono">
                        📦 {linea.empaqueComercial}
                        {linea.paquetesSugeridos && linea.factorEmpaque && linea.factorEmpaque > 1 ? ` (${linea.paquetesSugeridos} pqt)` : ''}
                      </p>
                    )}
                    {linea.proyectoNombre && (
                      <p className="text-[8px] text-blue-700 font-medium">Obra: {linea.proyectoNombre}</p>
                    )}
                  </td>
                  <td className="border border-slate-300 p-1 text-center font-mono">{linea.cantidadStock}</td>
                  <td className="border border-slate-300 p-1 text-center font-mono text-red-600 font-bold">
                    {linea.deficit > 0 ? `-${linea.deficit}` : '0'}
                  </td>
                  <td className="border border-slate-300 p-1 text-center font-mono font-black text-slate-900 bg-amber-50/50">
                    {linea.cantidadSolicitada}
                  </td>
                  <td className="border border-slate-300 p-1 text-right font-mono">
                    ${linea.costoUnitarioUSD.toFixed(2)}
                  </td>
                  <td className="border border-slate-300 p-1 text-right font-mono font-semibold">
                    ${linea.subtotalUSD.toFixed(2)}
                  </td>
                  
                  {/* Casilla Manuscrita Magaly */}
                  <td className="border border-slate-300 p-1 text-center bg-blue-50/20">
                    <div className="flex items-center justify-center gap-1">
                      <div className="w-3 h-3 border border-slate-600 rounded-sm"></div>
                      <span className="text-slate-400 text-[9px]">_______</span>
                    </div>
                  </td>

                  {/* Casilla Manuscrita Compras */}
                  <td className="border border-slate-300 p-1 text-center bg-emerald-50/20 text-[8px] text-slate-400">
                    <div className="h-3.5 border-b border-dotted border-slate-400 mb-0.5"></div>
                  </td>

                  {/* Casilla Manuscrita Rampa */}
                  <td className="border border-slate-300 p-1 text-center bg-purple-50/20 text-[8px] text-slate-400">
                    <div className="h-3.5 border-b border-dotted border-slate-400 mb-0.5"></div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Resumen Bimonetario */}
          <div className="flex items-start justify-between border border-slate-400 rounded p-2 mb-4 bg-slate-50 avoid-break">
            <div>
              <p className="text-[9px] uppercase font-bold text-slate-600">Notas / Instrucciones de Operaciones:</p>
              <p className="text-[10px] text-slate-800 italic mt-0.5">
                {header.notas || 'Sin notas especiales. Entregar factura original y nota de entrega en rampa.'}
              </p>
            </div>
            <div className="text-right space-y-0.5">
              <div className="flex items-center justify-end gap-3">
                <span className="text-[11px] font-semibold text-slate-700">Total Estimado ($ USD):</span>
                <span className="font-mono text-xs font-black text-slate-950">${header.totalUSD.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-end gap-3">
                <span className="text-[11px] font-semibold text-slate-700">Total Estimado (Bs BCV):</span>
                <span className="font-mono text-xs font-black text-slate-950">Bs {header.totalBs.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Cuadrantes de Firmas Operativas */}
          <div className="grid grid-cols-4 gap-3 text-center mt-4 pt-3 border-t border-slate-300 text-[9px] avoid-break">
            <div className="space-y-6">
              <div className="h-8 border-b border-slate-500"></div>
              <div>
                <p className="font-bold text-slate-900 uppercase">1. Encargado Inventario</p>
                <p className="text-slate-500 text-[8px]">Emisión & Solicitud</p>
              </div>
            </div>

            <div className="space-y-6">
              <div className="h-8 border-b border-slate-500"></div>
              <div>
                <p className="font-bold text-slate-900 uppercase">2. Gerencia Magaly</p>
                <p className="text-slate-500 text-[8px]">Aprobación Presupuesto</p>
              </div>
            </div>

            <div className="space-y-6">
              <div className="h-8 border-b border-slate-500"></div>
              <div>
                <p className="font-bold text-slate-900 uppercase">3. Encargada Compras</p>
                <p className="text-slate-500 text-[8px]">Cotización & Factura</p>
              </div>
            </div>

            <div className="space-y-6">
              <div className="h-8 border-b border-slate-500"></div>
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
