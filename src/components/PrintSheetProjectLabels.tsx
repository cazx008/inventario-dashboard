import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X, Layers, Tag, Check, AlertTriangle } from 'lucide-react';
import QRCode from 'qrcode';

export interface ProjectLabelItem {
  id: string;
  insumoId?: string;
  dashboardId?: string;
  nombre: string;
  codigo?: string;
  categoria?: string;
  folioOAB: string;
  fechaRecepcion: string;
  proyectoNombre: string;
  cantidadRecibidaHoy: number;
  cantidadTotalAprobada?: number;
  backorderPendiente?: number;
  isParcial?: boolean;
  bultos: number;
  cantEnBulto: number;
}

interface PrintSheetProjectLabelsProps {
  items: ProjectLabelItem[];
  onClose: () => void;
}

interface ExpandedLabel {
  key: string;
  item: ProjectLabelItem;
  bultoIndex: number;
  totalBultos: number;
  cantEnBulto: number;
  qrDataUrl: string;
}

type PrintFormat = '4up' | 'rollo4x6';

export const PrintSheetProjectLabels: React.FC<PrintSheetProjectLabelsProps> = ({
  items,
  onClose
}) => {
  const [format, setFormat] = useState<PrintFormat>('4up');
  const [expandedLabels, setExpandedLabels] = useState<ExpandedLabel[]>([]);
  const [isGeneratingQr, setIsGeneratingQr] = useState<boolean>(true);
  const printContainerRef = useRef<HTMLDivElement>(null);

  // Generar etiquetas expandidas y códigos QR reactivos
  useEffect(() => {
    let isMounted = true;
    setIsGeneratingQr(true);

    const generateAllLabels = async () => {
      const list: ExpandedLabel[] = [];
      const origin = typeof window !== 'undefined' ? window.location.origin : 'https://sanesca-inventario.pages.dev';

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const numBultos = Math.max(1, item.bultos || 1);

        for (let b = 1; b <= numBultos; b++) {
          const qrPayload = `${origin}/?folio=${encodeURIComponent(item.folioOAB)}&material=${encodeURIComponent(item.codigo || item.nombre)}&tienda=${encodeURIComponent(item.proyectoNombre)}&bulto=${b}_${numBultos}`;
          
          let qrDataUrl = '';
          try {
            qrDataUrl = await QRCode.toDataURL(qrPayload, {
              width: 130,
              margin: 1,
              color: { dark: '#000000', light: '#ffffff' }
            });
          } catch (qrErr) {
            console.warn('Error generando QR para etiqueta:', qrErr);
          }

          list.push({
            key: `${item.id || i}_bulto_${b}`,
            item,
            bultoIndex: b,
            totalBultos: numBultos,
            cantEnBulto: item.cantEnBulto || Math.ceil(item.cantidadRecibidaHoy / numBultos),
            qrDataUrl
          });
        }
      }

      if (isMounted) {
        setExpandedLabels(list);
        setIsGeneratingQr(false);
      }
    };

    generateAllLabels();

    return () => {
      isMounted = false;
    };
  }, [items]);

  // Agrupar en páginas de 4 para el formato 4-UP Carta
  const pages4UP = useMemo(() => {
    const pages: ExpandedLabel[][] = [];
    for (let i = 0; i < expandedLabels.length; i += 4) {
      pages.push(expandedLabels.slice(i, i + 4));
    }
    return pages;
  }, [expandedLabels]);

  // Manejo de disparo de impresión con popup aislado para máxima fidelidad de corte
  const handlePrint = () => {
    const printWindow = window.open('', '_blank', 'width=950,height=900');
    if (!printWindow) {
      // Fallback a window.print() directo
      window.print();
      return;
    }

    const is4UP = format === '4up';
    const pageStyles = is4UP
      ? `
        @page {
          size: letter portrait;
          margin: 6mm 6mm;
        }
        .page-container {
          display: grid;
          grid-template-columns: 1fr 1fr;
          grid-template-rows: 1fr 1fr;
          gap: 6mm;
          height: 260mm;
          page-break-after: always;
          break-after: page;
          box-sizing: border-box;
          padding: 2mm;
        }
        .label-card {
          border: 2px solid #000000;
          border-radius: 4px;
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          background: #ffffff;
          page-break-inside: avoid;
          box-sizing: border-box;
          overflow: hidden;
        }
      `
      : `
        @page {
          size: 100mm 150mm;
          margin: 3mm;
        }
        .page-container {
          width: 94mm;
          height: 144mm;
          page-break-after: always;
          break-after: page;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 4px;
        }
        .label-card {
          border: 2.5px solid #000000;
          border-radius: 6px;
          padding: 10px 12px;
          height: 100%;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          background: #ffffff;
          page-break-inside: avoid;
          box-sizing: border-box;
        }
      `;

    let bodyHtml = '';

    if (is4UP) {
      pages4UP.forEach((page, pIdx) => {
        bodyHtml += `<div class="page-container">`;
        page.forEach(lbl => {
          bodyHtml += renderLabelHtml(lbl, '4up');
        });
        // Rellenar cuadrícula si la página final tiene menos de 4
        const remainder = 4 - page.length;
        for (let r = 0; r < remainder; r++) {
          bodyHtml += `<div style="border: 1px dashed #cccccc; border-radius: 4px; opacity: 0.3;"></div>`;
        }
        bodyHtml += `</div>`;
      });
    } else {
      expandedLabels.forEach(lbl => {
        bodyHtml += `<div class="page-container">`;
        bodyHtml += renderLabelHtml(lbl, 'rollo4x6');
        bodyHtml += `</div>`;
      });
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Etiquetas_Proyecto_${items[0]?.folioOAB || 'MTO'}</title>
          <meta charset="utf-8" />
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body {
              background: #ffffff !important;
              color: #000000 !important;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            ${pageStyles}
            @media print {
              .no-print-bar { display: none !important; }
            }
          </style>
        </head>
        <body>
          <div class="no-print-bar" style="background: #0f172a; color: white; padding: 10px 16px; display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #38bdf8;">
            <div style="font-weight: bold; font-family: monospace;">
              SANESCA PRO — ETIQUETAS MTO (${expandedLabels.length} etiquetas · Formato: ${is4UP ? '4-UP Carta' : 'Rollo 4x6"'})
            </div>
            <button onclick="window.print()" style="background: #10b981; color: #022c22; font-weight: bold; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer;">
              🖨️ Mandar a Imprimir Ahora
            </button>
          </div>
          <div style="padding: 10px 0;">
            ${bodyHtml}
          </div>
        </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();
  };

  const renderLabelHtml = (lbl: ExpandedLabel, fmt: PrintFormat) => {
    const is4up = fmt === '4up';
    const isMTO = Boolean(lbl.item.proyectoNombre && !lbl.item.proyectoNombre.toLowerCase().includes('stock general'));
    const isParcial = Boolean(lbl.item.isParcial);

    return `
      <div class="label-card">
        <!-- Header de Etiqueta -->
        <div style="border-bottom: 2px solid #000000; padding-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-size: ${is4up ? '10px' : '11px'}; font-weight: 900; letter-spacing: 0.5px; text-transform: uppercase;">
              SANESCA PRO · CONTROL FÍSICO
            </div>
            <div style="font-size: 8px; font-weight: bold; color: #333333;">
              RAMPA RECEPCIÓN · ENTRADA A PLANTA
            </div>
          </div>
          <div style="text-align: right; font-family: monospace; font-size: 9px; font-weight: bold;">
            ${lbl.item.folioOAB}
          </div>
        </div>

        <!-- Banner Gigante de Tienda / Proyecto (24pt feel) -->
        <div style="margin: 6px 0; background: #000000; color: #ffffff; padding: ${is4up ? '6px 8px' : '8px 10px'}; border-radius: 3px; text-align: center;">
          <div style="font-size: 8px; font-weight: bold; letter-spacing: 1px; color: #94a3b8; text-transform: uppercase;">
            ${isMTO ? 'DESTINO EXCLUSIVO — OBRA / TIENDA' : 'IDENTIFICACIÓN DE ALMACÉN'}
          </div>
          <div style="font-size: ${is4up ? '16px' : '20px'}; font-weight: 900; text-transform: uppercase; line-height: 1.1; letter-spacing: 0.5px; word-break: break-word;">
            ${lbl.item.proyectoNombre || '📦 STOCK GENERAL / FÁBRICA'}
          </div>
        </div>

        <!-- Insumo y Código SKU -->
        <div style="margin: 4px 0; flex-grow: 1;">
          <div style="font-size: ${is4up ? '13px' : '15px'}; font-weight: 800; line-height: 1.2; color: #000000;">
            ${lbl.item.nombre}
          </div>
          <div style="display: flex; gap: 8px; font-size: 9px; font-family: monospace; color: #444444; margin-top: 2px;">
            <span>SKU: <b>${lbl.item.codigo || 'S/C'}</b></span>
            ${lbl.item.categoria ? `<span>· CAT: <b>${lbl.item.categoria}</b></span>` : ''}
          </div>

          ${isParcial ? `
            <div style="margin-top: 4px; background: #fef08a; border: 1.5px solid #ca8a04; color: #854d0e; padding: 2px 4px; border-radius: 3px; font-size: 8.5px; font-weight: 800; display: flex; align-items: center; gap: 4px;">
              ⚠️ RECEPCIÓN PARCIAL (${lbl.item.cantidadRecibidaHoy} / ${lbl.item.cantidadTotalAprobada || lbl.item.cantidadRecibidaHoy} und) — Pendiente: ${lbl.item.backorderPendiente || 0} und
            </div>
          ` : ''}
        </div>

        <!-- Desglose de Bulto y Cantidad Destacada -->
        <div style="border-top: 2px dashed #000000; border-bottom: 2px dashed #000000; padding: 6px 0; margin: 4px 0; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-size: 8px; font-weight: bold; text-transform: uppercase; color: #444444;">
              Identificador de Bulto
            </div>
            <div style="font-size: ${is4up ? '14px' : '16px'}; font-weight: 900; font-family: monospace;">
              ${lbl.totalBultos > 1 ? `BULTO ${lbl.bultoIndex} DE ${lbl.totalBultos}` : 'LOTE COMPLETO (1/1)'}
            </div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 8px; font-weight: bold; text-transform: uppercase; color: #444444;">
              Cant. en Bulto
            </div>
            <div style="font-size: ${is4up ? '18px' : '22px'}; font-weight: 900; font-family: monospace; color: #000000;">
              ${lbl.cantEnBulto} <span style="font-size: 11px; font-weight: normal;">und</span>
            </div>
          </div>
        </div>

        <!-- Footer con QR Dinámico y Validación -->
        <div style="display: flex; justify-content: space-between; align-items: flex-end; padding-top: 4px;">
          <div style="font-size: 7.5px; color: #555555; line-height: 1.2;">
            <div>Fec: <b>${lbl.item.fechaRecepcion || new Date().toISOString().split('T')[0]}</b></div>
            <div>MTO Reservado · No reasignar sin PIN</div>
            <div style="font-weight: bold; color: #000000; margin-top: 2px;">SANESCA INDUSTRIAL</div>
          </div>
          ${lbl.qrDataUrl ? `
            <div style="text-align: center;">
              <img src="${lbl.qrDataUrl}" style="width: ${is4up ? '48px' : '56px'}; height: ${is4up ? '48px' : '56px'}; display: block;" />
              <span style="font-size: 6.5px; font-family: monospace; color: #666666;">SCAN VERIFY</span>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  };

  const portalTarget = typeof document !== 'undefined'
    ? (document.getElementById('print-portal') || document.body)
    : null;

  if (!portalTarget) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/85 backdrop-blur-sm p-2 sm:p-4 overflow-y-auto custom-scrollbar">
      {/* Contenedor Principal */}
      <div className="bg-slate-900 border border-slate-700 w-full max-w-5xl rounded-xl shadow-2xl overflow-hidden my-4 text-slate-100 flex flex-col">
        
        {/* Topbar de Control */}
        <div className="bg-slate-950 px-4 sm:px-6 py-3.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400">
              <Tag className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white">Rotulado de Proyecto MTO</span>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-brand-500/20 text-brand-300 border border-brand-500/30">
                  {items[0]?.folioOAB || 'OAB'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                {expandedLabels.length} etiqueta(s) generadas para {items.length} insumo(s)
              </p>
            </div>
          </div>

          {/* Selector de Formato Interactivo */}
          <div className="flex items-center gap-1.5 bg-slate-900 p-1 rounded-lg border border-slate-700">
            <button
              onClick={() => setFormat('4up')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition ${
                format === '4up'
                  ? 'bg-brand-500 text-slate-950 font-bold shadow'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>📄 4-UP Carta (2x2)</span>
            </button>
            <button
              onClick={() => setFormat('rollo4x6')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition ${
                format === 'rollo4x6'
                  ? 'bg-brand-500 text-slate-950 font-bold shadow'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Tag className="w-3.5 h-3.5" />
              <span>🏷️ Rollo 4x6" (100x150mm)</span>
            </button>
          </div>

          {/* Acciones */}
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              disabled={isGeneratingQr || expandedLabels.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-slate-950 font-bold rounded-lg text-xs transition shadow disabled:opacity-50"
            >
              <Printer className="w-4 h-4" />
              <span>Imprimir {expandedLabels.length} Etiquetas</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
              title="Cerrar Previsualización"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Banner de Info del Formato Activo */}
        <div className="bg-slate-950/60 px-6 py-2 border-b border-slate-800/80 flex items-center justify-between text-xs text-slate-300 font-mono">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>
              {format === '4up'
                ? `Formato Hoja Carta 8.5" x 11" · 4 etiquetas por página (${pages4UP.length} hoja${pages4UP.length === 1 ? '' : 's'})`
                : `Formato Rollo Térmico Continuo 100x150mm · Salto automático por etiqueta`}
            </span>
          </div>
          <div className="text-slate-400">
            Escala 1:1 lista para corte y etiquetado
          </div>
        </div>

        {/* Área de Previsualización Interactiva (Visual WYSWYG) */}
        <div className="p-6 bg-slate-950/40 overflow-y-auto max-h-[72vh] flex flex-col items-center gap-6 custom-scrollbar">
          {isGeneratingQr ? (
            <div className="py-16 text-center text-slate-400 text-sm">
              <div className="inline-block w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mb-3"></div>
              <p>Generando códigos QR y desglosando bultos...</p>
            </div>
          ) : format === '4up' ? (
            // Visualización 4-UP Carta
            pages4UP.map((page, pIdx) => (
              <div
                key={`page_${pIdx}`}
                className="bg-white text-slate-900 shadow-xl rounded p-4 w-full max-w-3xl aspect-[8.5/11] flex flex-col justify-between border border-slate-300"
              >
                <div className="text-[10px] font-mono text-slate-400 border-b border-slate-200 pb-1 mb-2 flex justify-between">
                  <span>Hoja {pIdx + 1} de {pages4UP.length} (Carta Troquelada 4-UP)</span>
                  <span>SANESCA INDUSTRIAL PRINT SYSTEM</span>
                </div>
                <div className="grid grid-cols-2 grid-rows-2 gap-3 flex-grow">
                  {page.map(lbl => (
                    <div
                      key={lbl.key}
                      dangerouslySetInnerHTML={{ __html: renderLabelHtml(lbl, '4up') }}
                      className="h-full"
                    />
                  ))}
                  {Array.from({ length: 4 - page.length }).map((_, rIdx) => (
                    <div
                      key={`empty_${rIdx}`}
                      className="border-2 border-dashed border-slate-200 rounded flex items-center justify-center text-slate-300 text-xs font-mono"
                    >
                      (Etiqueta Libre)
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            // Visualización Rollo Continuo 4x6"
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-3xl">
              {expandedLabels.map((lbl, idx) => (
                <div
                  key={lbl.key}
                  className="bg-white text-slate-900 shadow-xl rounded p-4 aspect-[4/6] border border-slate-300 flex flex-col justify-between"
                  dangerouslySetInnerHTML={{ __html: renderLabelHtml(lbl, 'rollo4x6') }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer Informativo */}
        <div className="bg-slate-950 px-6 py-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div>
            <span>💡 <b>Recomendación de Rampa:</b> Imprime en Rollo Térmico 4x6" para pegar directamente en bultos pesados, o 4-UP para sobres y cajas de accesorios.</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs font-medium transition"
          >
            Volver a Rampa
          </button>
        </div>

      </div>
    </div>,
    portalTarget
  );
};
