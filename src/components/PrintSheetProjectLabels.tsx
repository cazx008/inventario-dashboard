import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X, Layers, Tag, Check, AlertTriangle, CheckSquare, Square, Filter } from 'lucide-react';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';

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
  cantidadRechazadaHoy?: number;
  cantidadRechazada?: number;
  cantidadTotalAprobada?: number;
  backorderPendiente?: number;
  isParcial?: boolean;
  bultos: number;
  cantEnBulto: number;
  bultoPico?: number;
  desgloseBultos?: number[];
  pkgIdPrefix?: string;
  customPkgId?: string;
  unidadMedida?: string;
  isBultoAbierto?: boolean;
  saldoRemanente?: number;
}

// Origen canónico de producción obligatorio para todos los códigos QR físicos (HP Laser / Rampa)
const CANONICAL_ORIGIN = 'https://sanesca-inventario.pages.dev';

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
  pkgId: string;
  unidadMedida: string;
  isPico: boolean;
  isBultoAbierto?: boolean;
  saldoRemanente?: number;
  qrDataUrl: string;
  barcodeDataUrl?: string;
}

type PrintFormat = '8up' | '10up' | '4up' | 'rollo4x6';

// Helper determinista para abreviatura de proyecto / tienda (D15)
function getProjectAbbrev(proyectoNombre: string): string {
  if (!proyectoNombre) return 'STK';
  const clean = proyectoNombre
    .replace(/proyecto\s*[-—:]\s*/gi, '')
    .trim();
  const words = clean.split(/[\s·—\-_]+/);
  if (words.length > 0 && words[0].length >= 2) {
    return words[0].toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  }
  return clean.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'MTO';
}

// Helper determinista para fecha en serial PKG-ID
function getFormattedDate(dateStr?: string): string {
  if (dateStr) {
    const clean = dateStr.replace(/[^0-9]/g, '');
    if (clean.length === 8) return clean;
  }
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

export const PrintSheetProjectLabels: React.FC<PrintSheetProjectLabelsProps> = ({
  items,
  onClose
}) => {
  const [format, setFormat] = useState<PrintFormat>('8up');
  const [expandedLabels, setExpandedLabels] = useState<ExpandedLabel[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [isGeneratingQr, setIsGeneratingQr] = useState<boolean>(true);
  const printContainerRef = useRef<HTMLDivElement>(null);

  // Generar etiquetas expandidas, PKG-IDs deterministas y códigos de barra 1D/2D
  useEffect(() => {
    let isMounted = true;
    setIsGeneratingQr(true);

    const generateAllLabels = async () => {
      const list: ExpandedLabel[] = [];
      const origin = CANONICAL_ORIGIN;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const totalQty = Math.max(1, item.cantidadRecibidaHoy || 1);
        const uom = item.unidadMedida || 'und';
        const isBultoAbierto = Boolean(item.isBultoAbierto);
        const saldoRem = item.saldoRemanente;

        // Desglose de bultos: Asimétrico explícito vs Pico vs Auto-cálculo
        let bundlesList: { cant: number; isPico: boolean }[] = [];

        if (item.desgloseBultos && item.desgloseBultos.length > 0) {
          bundlesList = item.desgloseBultos.map(c => ({ cant: c, isPico: false }));
        } else if (item.bultoPico !== undefined && item.bultoPico > 0) {
          const fullCount = Math.max(0, (item.bultos || 1) - 1);
          for (let b = 0; b < fullCount; b++) {
            bundlesList.push({ cant: item.cantEnBulto, isPico: false });
          }
          bundlesList.push({ cant: item.bultoPico, isPico: true });
        } else {
          // Auto-cálculo de bulto pico (D14)
          const std = Math.max(1, item.cantEnBulto || 1);
          if (item.bultos > 1 && totalQty > std) {
            const fullBultos = Math.floor(totalQty / std);
            const rem = totalQty % std;
            for (let b = 0; b < fullBultos; b++) {
              bundlesList.push({ cant: std, isPico: false });
            }
            if (rem > 0) {
              bundlesList.push({ cant: rem, isPico: true });
            }
          } else {
            const numB = Math.max(1, item.bultos || 1);
            const cB = item.cantEnBulto || Math.ceil(totalQty / numB);
            for (let b = 0; b < numB; b++) {
              bundlesList.push({ cant: cB, isPico: false });
            }
          }
        }

        const totalB = bundlesList.length;
        const abbrev = (item.pkgIdPrefix || getProjectAbbrev(item.proyectoNombre)).replace(/^PKG-/i, '');
        const dateCode = getFormattedDate(item.fechaRecepcion);

        for (let b = 0; b < totalB; b++) {
          const bIndex = b + 1;
          const bInfo = bundlesList[b];
          const pkgId = (totalB === 1 && item.customPkgId)
            ? item.customPkgId
            : `PKG-${abbrev}-${dateCode}-${String(bIndex).padStart(2, '0')}${isBultoAbierto ? '-S1' : ''}`;
          
          const qrPayload = `${origin}/?folio=${encodeURIComponent(item.folioOAB)}&material=${encodeURIComponent(item.codigo || item.nombre)}&tienda=${encodeURIComponent(item.proyectoNombre)}&bulto=${bIndex}_${totalB}&pkg_id=${encodeURIComponent(pkgId)}&cant_bulto=${bInfo.cant}`;
          
          let qrDataUrl = '';
          try {
            qrDataUrl = await QRCode.toDataURL(qrPayload, {
              width: 200,
              margin: 1,
              color: { dark: '#000000', light: '#ffffff' }
            });
          } catch (qrErr) {
            console.warn('Error generando QR para etiqueta:', qrErr);
          }

          let barcodeDataUrl = '';
          try {
            const canvas = document.createElement('canvas');
            JsBarcode(canvas, pkgId, {
              format: 'CODE128',
              width: 1.5,
              height: 38,
              displayValue: false,
              margin: 0
            });
            barcodeDataUrl = canvas.toDataURL('image/png');
          } catch (bcErr) {
            console.warn('Error generando código de barras 1D:', bcErr);
          }

          list.push({
            key: `${item.id || i}_bulto_${bIndex}`,
            item,
            bultoIndex: bIndex,
            totalBultos: totalB,
            cantEnBulto: bInfo.cant,
            pkgId,
            unidadMedida: uom,
            isPico: bInfo.isPico,
            isBultoAbierto,
            saldoRemanente: saldoRem,
            qrDataUrl,
            barcodeDataUrl
          });
        }
      }

      if (isMounted) {
        setExpandedLabels(list);
        setSelectedKeys(new Set(list.map(l => l.key)));
        setIsGeneratingQr(false);
      }
    };

    generateAllLabels();

    return () => {
      isMounted = false;
    };
  }, [items]);

  // Etiquetas activas seleccionadas quirúrgicamente (D17)
  const printableLabels = useMemo(() => {
    return expandedLabels.filter(lbl => selectedKeys.has(lbl.key));
  }, [expandedLabels, selectedKeys]);

  // Capacidad de etiquetas por página Carta según el formato activo
  const itemsPerPage = useMemo(() => {
    if (format === '10up') return 10;
    if (format === '8up') return 8;
    return 4;
  }, [format]);

  // Agrupar en páginas para el formato activo de Hoja Carta
  const pagesGrid = useMemo(() => {
    const pages: ExpandedLabel[][] = [];
    for (let i = 0; i < printableLabels.length; i += itemsPerPage) {
      pages.push(printableLabels.slice(i, i + itemsPerPage));
    }
    return pages;
  }, [printableLabels, itemsPerPage]);

  // Toggle de selección quirúrgica
  const toggleSelectKey = (key: string) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const selectSingleKey = (key: string) => {
    setSelectedKeys(new Set([key]));
  };

  const selectAllKeys = () => {
    if (selectedKeys.size === expandedLabels.length) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(expandedLabels.map(l => l.key)));
    }
  };

  // Disparo de impresión con popup aislado
  const handlePrint = () => {
    if (printableLabels.length === 0) return;

    const printWindow = window.open('', '_blank', 'width=950,height=900');
    if (!printWindow) {
      window.print();
      return;
    }

    const isRollo = format === 'rollo4x6';
    const is10UP = format === '10up';
    const is8UP = format === '8up';
    const is4UP = format === '4up';

    let pageStyles = '';
    if (isRollo) {
      pageStyles = `
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
    } else if (is10UP) {
      pageStyles = `
        @page {
          size: letter portrait;
          margin: 4mm 4mm;
        }
        .page-container {
          display: grid;
          grid-template-columns: 1fr 1fr;
          grid-template-rows: repeat(5, 1fr);
          gap: 2.5mm;
          height: 254mm;
          page-break-after: always;
          break-after: page;
          box-sizing: border-box;
          padding: 0;
        }
        .label-card {
          border: 1.5px solid #000000;
          border-radius: 3px;
          padding: 3.5px 5.5px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          background: #ffffff;
          page-break-inside: avoid;
          box-sizing: border-box;
          overflow: hidden;
          height: 100%;
        }
      `;
    } else if (is8UP) {
      pageStyles = `
        @page {
          size: letter portrait;
          margin: 4mm 4mm;
        }
        .page-container {
          display: grid;
          grid-template-columns: 1fr 1fr;
          grid-template-rows: repeat(4, 1fr);
          gap: 3mm;
          height: 254mm;
          page-break-after: always;
          break-after: page;
          box-sizing: border-box;
          padding: 0;
        }
        .label-card {
          border: 2px solid #000000;
          border-radius: 3px;
          padding: 4.5px 6.5px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          background: #ffffff;
          page-break-inside: avoid;
          box-sizing: border-box;
          overflow: hidden;
          height: 100%;
        }
      `;
    } else {
      // 4-UP Carta
      pageStyles = `
        @page {
          size: letter portrait;
          margin: 4mm 4mm;
        }
        .page-container {
          display: grid;
          grid-template-columns: 1fr 1fr;
          grid-template-rows: 1fr 1fr;
          gap: 4mm;
          height: 254mm;
          page-break-after: always;
          break-after: page;
          box-sizing: border-box;
          padding: 0;
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
      `;
    }

    let bodyHtml = '';

    if (isRollo) {
      printableLabels.forEach(lbl => {
        bodyHtml += `<div class="page-container">`;
        bodyHtml += renderLabelHtml(lbl, 'rollo4x6');
        bodyHtml += `</div>`;
      });
    } else {
      pagesGrid.forEach(page => {
        bodyHtml += `<div class="page-container">`;
        page.forEach(lbl => {
          bodyHtml += renderLabelHtml(lbl, format);
        });
        const remainder = itemsPerPage - page.length;
        for (let r = 0; r < remainder; r++) {
          bodyHtml += `<div style="border: 1px dashed #cccccc; border-radius: 3px; opacity: 0.3;"></div>`;
        }
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
              SANESCA PRO — ETIQUETAS MTO (${printableLabels.length} seleccionadas de ${expandedLabels.length} · Formato: ${is4UP ? '4-UP Carta' : 'Rollo 4x6"'})
            </div>
            <button onclick="window.print()" style="background: #10b981; color: #022c22; font-weight: bold; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer;">
              🖨️ Mandar a Imprimir Ahora (${printableLabels.length})
            </button>
          </div>
          <div class="print-wrapper" style="padding: 0; margin: 0;">
            ${bodyHtml}
          </div>
        </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();
  };

  const renderLabelHtml = (lbl: ExpandedLabel, fmt: PrintFormat) => {
    const isCompact = fmt === '8up' || fmt === '10up';
    const is4up = fmt === '4up';
    const rawDestino = (lbl.item.proyectoNombre || '').trim();
    const isStockFabrica = !rawDestino || 
      rawDestino.toLowerCase().includes('stock general') || 
      rawDestino.toLowerCase().includes('stock fábrica') || 
      rawDestino.toLowerCase().includes('stock fabrica');
    const isMTO = !isStockFabrica;
    const isParcial = Boolean(lbl.item.isParcial);

    // Sanitización inteligente de SKU (evita duplicar el nombre si no hay código corto)
    const rawSku = (lbl.item.codigo || '').trim();
    const rawName = (lbl.item.nombre || '').trim();
    const isSkuDuplicateOrTooLong = !rawSku || 
      rawSku.toLowerCase() === rawName.toLowerCase() ||
      rawSku.length > 25;
    const displaySku = isSkuDuplicateOrTooLong ? 'S/C' : rawSku;

    // Formatear banner MTO inteligentemente: [CÓDIGO] · [OBRA]
    let displayDestino = '📦 STOCK GENERAL / FÁBRICA';
    if (isMTO) {
      let cleaned = rawDestino
        .replace(/proyecto\s*[-—:]\s*/gi, '')
        .replace(/\s*[-—]\s+/g, ' · ')
        .trim();
      if (cleaned.length > (isCompact ? 34 : 60)) {
        cleaned = cleaned.substring(0, isCompact ? 31 : 57).trim() + '...';
      }
      displayDestino = cleaned || rawDestino;
    }

    // --- MODO COMPACTO LOGÍSTICO (8-UP y 10-UP) ---
    if (isCompact) {
      const is10up = fmt === '10up';
      const nameLen = rawName.length;

      // Regla Adaptativa Híbrida de Tipografía aprobada:
      // Si el insumo es extenso (>45 chars), reduce a escala 14px (8-UP) / 12px (10-UP) para evitar truncamiento
      const isLongName = nameLen > 45;
      const nameFontSize = is10up
        ? (isLongName ? '12px' : '14px')
        : (isLongName ? '14px' : '16.5px');

      const qtyFontSize = is10up ? '18px' : '21px';
      const uomFontSize = is10up ? '9px' : '11px';
      const headerDestinoFontSize = is10up ? '11px' : '14px';
      const headerBultoFontSize = is10up ? '8.5px' : '10.5px';
      const qrColWidth = is10up ? '36%' : '40%';

      return `
        <div class="label-card" style="border: ${is10up ? '1.5px' : '2px'} solid #000000; border-radius: 3px; padding: ${is10up ? '3px 5px' : '4.5px 6.5px'}; display: flex; flex-direction: column; justify-content: space-between; background: #ffffff; box-sizing: border-box; overflow: hidden; height: 100%; width: 100%;">
          
          <!-- Banda 1: Header a Ancho Completo (100%) -->
          <div style="background: #000000; color: #ffffff; padding: ${is10up ? '1.5px 4px' : '2.5px 6px'}; border-radius: 2px; display: flex; align-items: center; justify-content: space-between; width: 100%; box-sizing: border-box;">
            <div style="display: flex; align-items: center; gap: 5px; min-width: 0; overflow: hidden;">
              <span style="font-size: ${headerDestinoFontSize}; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${isMTO ? `🏷️ ${displayDestino}` : '📦 STOCK GENERAL / FÁBRICA'}
              </span>
              <span style="font-size: 7px; color: #cbd5e1; font-family: monospace; white-space: nowrap; shrink-0;">
                OAB: <b>${lbl.item.folioOAB}</b>
              </span>
            </div>
            <div style="background: #ffffff; color: #000000; font-weight: 900; font-size: ${headerBultoFontSize}; padding: 1px 4px; border-radius: 2px; font-family: monospace; white-space: nowrap; shrink-0; margin-left: 4px;">
              ${lbl.totalBultos > 1 ? `BULTO ${lbl.bultoIndex}/${lbl.totalBultos}` : 'LOTE (1/1)'}
              ${lbl.isPico ? '<span style="background: #0284c7; color: #ffffff; padding: 0.5px 2px; border-radius: 1px; font-size: 6px; margin-left: 2px;">PICO</span>' : ''}
            </div>
          </div>

          <!-- Bloque Principal Bipartito: Columna Izquierda vs Columna Derecha (Mega QR 45mm) -->
          <div style="display: flex; align-items: stretch; gap: 6px; margin: 3px 0 1px 0; flex: 1; min-height: 0; width: 100%; box-sizing: border-box;">
            
            <!-- Columna Izquierda (~60% ancho): Insumo arriba + Zócalo Cantidad abajo -->
            <div style="flex: 1; display: flex; flex-direction: column; justify-content: space-between; min-width: 0; padding-right: 2px;">
              
              <!-- Arriba: Insumo y Códigos -->
              <div>
                <div style="font-size: ${nameFontSize}; font-weight: 900; line-height: 1.15; color: #000000; display: -webkit-box; -webkit-line-clamp: ${isLongName ? 3 : 2}; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; word-break: break-word;">
                  ${lbl.item.nombre}
                </div>
                <div style="display: flex; flex-wrap: wrap; gap: 5px; font-size: ${is10up ? '7.5px' : '8.5px'}; font-family: monospace; color: #475569; margin-top: 2px;">
                  <span>SKU: <b style="color: #0f172a;">${displaySku}</b></span>
                  ${lbl.item.categoria ? `<span>· CAT: <b style="color: #334155;">${lbl.item.categoria}</b></span>` : ''}
                </div>
                ${lbl.isBultoAbierto ? `
                  <div style="background: #fef3c7; border: 1px solid #f59e0b; color: #92400e; padding: 1px 3px; border-radius: 2px; font-size: 7.5px; font-weight: 900; margin-top: 2px;">
                    ⚠️ SALDO ABIERTO: ${lbl.cantEnBulto} ${lbl.unidadMedida}
                  </div>
                ` : ''}
              </div>

              <!-- Abajo: Caja de Cantidad y Serial PKG -->
              <div style="background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 3px; padding: 2px 4px; margin-top: auto; display: flex; align-items: center; justify-content: space-between;">
                <div style="display: flex; align-items: baseline; gap: 3px;">
                  <span style="font-size: 7.5px; font-weight: 900; color: #64748b; text-transform: uppercase;">CANT:</span>
                  <span style="font-size: ${qtyFontSize}; font-weight: 900; font-family: monospace; line-height: 1; color: #000000;">
                    ${lbl.cantEnBulto} <span style="font-size: ${uomFontSize}; font-weight: 700; color: #475569;">${lbl.unidadMedida}</span>
                  </span>
                </div>
                <div style="font-size: 6.5px; font-family: monospace; color: #475569; text-align: right; line-height: 1.1;">
                  <div style="font-weight: 800; color: #0f172a;">${lbl.pkgId}</div>
                  <div>${lbl.item.fechaRecepcion || new Date().toISOString().split('T')[0]}</div>
                </div>
              </div>
            </div>

            <!-- Columna Derecha (~40% ancho): Mega QR Colosal 45mm con leyenda -->
            <div style="width: ${qrColWidth}; shrink: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; border-left: 1.5px dashed #000000; padding-left: 5px; box-sizing: border-box;">
              ${lbl.qrDataUrl ? `
                <div style="background: #000000; border-radius: 2px; padding: 1.5px; display: flex; align-items: center; justify-content: center; width: 100%; max-width: 140px;">
                  <img src="${lbl.qrDataUrl}" style="width: 100%; aspect-ratio: 1/1; display: block; background: #ffffff; object-fit: contain;" />
                </div>
                <span style="font-size: 5.5px; font-family: monospace; color: #475569; margin-top: 2px; letter-spacing: 0.5px; font-weight: 800; text-transform: uppercase;">SCAN VERIFY</span>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    }

    // --- MODO GRANDE 4-UP Y ROLLO 4x6" ---
    const bannerFontSize = is4up
      ? (displayDestino.length > 32 ? '13px' : '15px')
      : (displayDestino.length > 32 ? '17px' : '20px');

    const isNameLong = (lbl.item.nombre || '').length > 42;
    const nameFontSize = is4up
      ? (isNameLong ? '10.5px' : '12px')
      : (isNameLong ? '12.5px' : '14.5px');

    return `
      <div class="label-card">
        <!-- Header de Etiqueta con PKG-ID visible -->
        <div style="border-bottom: 2px solid #000000; padding-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-size: ${is4up ? '9.5px' : '11px'}; font-weight: 900; letter-spacing: 0.5px; text-transform: uppercase;">
              SANESCA PRO · CONTROL FÍSICO
            </div>
            <div style="font-size: 8px; font-weight: bold; color: #333333;">
              RAMPA RECEPCIÓN · ENTRADA A PLANTA
            </div>
          </div>
          <div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end;">
            <div style="font-family: monospace; font-size: ${is4up ? '9px' : '10.5px'}; font-weight: 900; background: #000000; color: #ffffff; padding: 1.5px 5px; border-radius: 2px; letter-spacing: 0.5px;">
              ${lbl.pkgId}
            </div>
            <div style="font-family: monospace; font-size: 8px; color: #555555; margin-top: 1px;">
              Folio: <b>${lbl.item.folioOAB}</b>
            </div>
          </div>
        </div>

        ${lbl.isBultoAbierto ? `
          <!-- Banner de Bulto Abierto / Saldo Taller (D16) -->
          <div style="background: #fef08a; border: 2px solid #ca8a04; color: #854d0e; padding: 3px 6px; border-radius: 3px; text-align: center; font-size: ${is4up ? '10px' : '12px'}; font-weight: 900; margin: 4px 0;">
            ⚠️ BULTO ABIERTO · SALDO: ${lbl.cantEnBulto} ${lbl.unidadMedida}
          </div>
        ` : ''}

        <!-- Banner Gigante de Tienda / Proyecto (24pt feel) -->
        <div style="margin: 5px 0; background: #000000; color: #ffffff; padding: ${is4up ? '5px 7px' : '7px 9px'}; border-radius: 3px; text-align: center;">
          <div style="font-size: 7.5px; font-weight: bold; letter-spacing: 1px; color: #94a3b8; text-transform: uppercase;">
            ${isMTO ? 'DESTINO EXCLUSIVO — OBRA / TIENDA' : 'IDENTIFICACIÓN DE ALMACÉN'}
          </div>
          <div style="font-size: ${bannerFontSize}; font-weight: 900; text-transform: uppercase; line-height: 1.15; letter-spacing: 0.5px; word-break: break-word;">
            ${displayDestino}
          </div>
        </div>

        <!-- Insumo y Código SKU con Micro-Tipografía Adaptativa -->
        <div style="margin: 3px 0; flex-grow: 1;">
          <div style="font-size: ${nameFontSize}; font-weight: 800; line-height: 1.15; color: #000000; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; word-break: break-word;">
            ${lbl.item.nombre}
          </div>
          <div style="display: flex; gap: 8px; font-size: 8px; font-family: monospace; color: #444444; margin-top: 2px;">
            <span>SKU: <b>${displaySku}</b></span>
            ${lbl.item.categoria ? `<span>· CAT: <b>${lbl.item.categoria}</b></span>` : ''}
          </div>

          ${isParcial ? `
            <div style="margin-top: 3px; background: #fef08a; border: 1.5px solid #ca8a04; color: #854d0e; padding: 2px 4px; border-radius: 3px; font-size: 8px; font-weight: 800; display: flex; align-items: center; gap: 4px;">
              ⚠️ RECEPCIÓN PARCIAL (${lbl.item.cantidadRecibidaHoy} / ${lbl.item.cantidadTotalAprobada || lbl.item.cantidadRecibidaHoy} ${lbl.unidadMedida}) — Pendiente: ${lbl.item.backorderPendiente || 0}
            </div>
          ` : ''}

          ${(lbl.item.cantidadRechazadaHoy || lbl.item.cantidadRechazada || 0) > 0 ? `
            <div style="margin-top: 3px; background: #fee2e2; border: 1.5px solid #ef4444; color: #991b1b; padding: 2px 4px; border-radius: 3px; font-size: 8px; font-weight: 800; display: flex; align-items: center; gap: 4px;">
              ⚠️ RECHAZO DE CALIDAD (${lbl.item.cantidadRechazadaHoy || lbl.item.cantidadRechazada} no conformes en rampa)
            </div>
          ` : ''}
        </div>

        <!-- Desglose de Bulto y Cantidad Destacada con UoM dinámica (D14 & D15) -->
        <div style="border-top: 2px dashed #000000; border-bottom: 2px dashed #000000; padding: 5px 0; margin: 3px 0; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-size: 7.5px; font-weight: bold; text-transform: uppercase; color: #444444;">
              Identificador de Bulto
            </div>
            <div style="font-size: ${is4up ? '13px' : '15px'}; font-weight: 900; font-family: monospace;">
              ${lbl.totalBultos > 1 ? `BULTO ${lbl.bultoIndex} DE ${lbl.totalBultos}` : 'LOTE COMPLETO (1/1)'}
              ${lbl.isPico ? '<span style="font-size: 8.5px; background: #e0f2fe; color: #0369a1; padding: 1px 3px; border-radius: 2px; margin-left: 3px; font-weight: 800;">PICO</span>' : ''}
            </div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 7.5px; font-weight: bold; text-transform: uppercase; color: #444444;">
              Cant. en Bulto
            </div>
            <div style="font-size: ${is4up ? '17px' : '21px'}; font-weight: 900; font-family: monospace; color: #000000;">
              ${lbl.cantEnBulto} <span style="font-size: 11px; font-weight: bold; color: #222;">${lbl.unidadMedida}</span>
            </div>
          </div>
        </div>

        <!-- Simbología de Barras 1D (Code 128) exclusivo para Rollo 4x6" (D19) -->
        ${!is4up && lbl.barcodeDataUrl ? `
          <div style="text-align: center; margin: 3px 0; padding: 2px 0; border-bottom: 1px solid #e2e8f0;">
            <img src="${lbl.barcodeDataUrl}" style="height: 32px; max-width: 170px; margin: 0 auto; display: block;" />
            <span style="font-size: 7.5px; font-family: monospace; font-weight: bold; letter-spacing: 1px; color: #333333;">${lbl.pkgId}</span>
          </div>
        ` : ''}

        <!-- Footer con QR Dinámico y Validación -->
        <div style="display: flex; justify-content: space-between; align-items: flex-end; padding-top: 3px;">
          <div style="font-size: 7px; color: #555555; line-height: 1.2;">
            <div>Fec: <b>${lbl.item.fechaRecepcion || new Date().toISOString().split('T')[0]}</b></div>
            <div>MTO Reservado · No reasignar sin PIN</div>
            <div style="font-weight: bold; color: #000000; margin-top: 1px;">SANESCA INDUSTRIAL</div>
          </div>
          ${lbl.qrDataUrl ? `
            <div style="text-align: center;">
              <img src="${lbl.qrDataUrl}" style="width: ${is4up ? '46px' : '52px'}; height: ${is4up ? '46px' : '52px'}; display: block;" />
              <span style="font-size: 6px; font-family: monospace; color: #666666;">SCAN VERIFY</span>
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
    <>
      <style>{`
        @media print {
          body, html {
            background: #ffffff !important;
            color: #000000 !important;
            margin: 0 !important;
            padding: 0 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .no-print, header, nav, footer, [data-portal-root] {
            display: none !important;
          }
        }
      `}</style>
      <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/85 backdrop-blur-sm p-2 sm:p-4 overflow-y-auto custom-scrollbar no-print">
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
                {printableLabels.length} de {expandedLabels.length} etiqueta(s) seleccionadas para impresión
              </p>
            </div>
          </div>

          {/* Selector de Formato Interactivo */}
          <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-700">
            <button
              onClick={() => setFormat('8up')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition ${
                format === '8up'
                  ? 'bg-brand-500 text-slate-950 font-bold shadow'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
              title="8 etiquetas por hoja Carta (2x4) · Formato compacto optimizado para taller"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>📄 8-UP (Compacto)</span>
            </button>
            <button
              onClick={() => setFormat('10up')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition ${
                format === '10up'
                  ? 'bg-brand-500 text-slate-950 font-bold shadow'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
              title="10 etiquetas por hoja Carta (2x5) · Compatible con Avery 5163 / 8163"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>📋 10-UP (Avery)</span>
            </button>
            <button
              onClick={() => setFormat('4up')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition ${
                format === '4up'
                  ? 'bg-brand-500 text-slate-950 font-bold shadow'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
              title="4 etiquetas por hoja Carta (2x2) · Formato grande para sobres o paquetes voluminosos"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>📦 4-UP (Grande)</span>
            </button>
            <button
              onClick={() => setFormat('rollo4x6')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition ${
                format === 'rollo4x6'
                  ? 'bg-brand-500 text-slate-950 font-bold shadow'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
              title="Rollo térmico continuo 100x150mm con código de barras 1D Code 128"
            >
              <Tag className="w-3.5 h-3.5" />
              <span>🏷️ Rollo 4x6"</span>
            </button>
          </div>

          {/* Acciones */}
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              disabled={isGeneratingQr || printableLabels.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-slate-950 font-bold rounded-lg text-xs transition shadow disabled:opacity-50"
            >
              <Printer className="w-4 h-4" />
              <span>Imprimir {printableLabels.length} Etiquetas</span>
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

        {/* Barra de Selección Quirúrgica de Bultos (D17) */}
        <div className="bg-slate-950/90 px-4 sm:px-6 py-2.5 border-b border-slate-800 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 font-semibold mr-2">
            <Filter className="w-3.5 h-3.5 text-brand-400" />
            <span>Filtro Quirúrgico:</span>
          </div>

          <button
            type="button"
            onClick={selectAllKeys}
            className={`px-2.5 py-1 rounded text-xs font-bold transition flex items-center gap-1 border ${
              selectedKeys.size === expandedLabels.length
                ? 'bg-brand-500/20 text-brand-300 border-brand-500/40'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
            }`}
          >
            {selectedKeys.size === expandedLabels.length ? (
              <CheckSquare className="w-3.5 h-3.5 text-brand-400" />
            ) : (
              <Square className="w-3.5 h-3.5" />
            )}
            <span>Todos ({expandedLabels.length})</span>
          </button>

          <div className="h-4 w-[1px] bg-slate-800 mx-1 hidden sm:block"></div>

          {/* Chips individuales de bulto */}
          <div className="flex items-center gap-1.5 overflow-x-auto max-w-full custom-scrollbar py-0.5">
            {expandedLabels.map(lbl => {
              const isSelected = selectedKeys.has(lbl.key);
              return (
                <div
                  key={`chip_${lbl.key}`}
                  className="flex items-center rounded border overflow-hidden shrink-0"
                >
                  <button
                    type="button"
                    onClick={() => toggleSelectKey(lbl.key)}
                    className={`px-2 py-1 text-xs font-mono font-medium transition flex items-center gap-1 ${
                      isSelected
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        : 'bg-slate-900 text-slate-500 border-slate-800 hover:text-slate-300'
                    }`}
                    title="Alternar inclusión de este bulto"
                  >
                    <span>{isSelected ? '✓' : '○'}</span>
                    <span>B{lbl.bultoIndex}: <b>{lbl.cantEnBulto}</b> {lbl.unidadMedida}</span>
                    {lbl.isPico && <span className="text-[9px] text-sky-400 uppercase font-bold">(Pico)</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => selectSingleKey(lbl.key)}
                    className="px-1.5 py-1 text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border-l border-slate-700"
                    title="Imprimir solo este bulto exclusivamente"
                  >
                    Solo
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Banner Ergonómico de Tolerancia HP Laser & Guía Chrome */}
        <div className="bg-slate-900/90 px-4 sm:px-6 py-2 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-slate-300">
            <span className="px-2 py-0.5 rounded bg-brand-500/20 text-brand-300 border border-brand-500/30 text-[10px] font-mono font-bold tracking-wide">
              HP LASER / CHROME
            </span>
            <span className="text-[11.5px]">
              Para calce exacto en troquel 4-UP: Configura <b>Márgenes: Ninguno</b> y <b>Gráficos de fondo: Activado</b> en el diálogo de impresión.
            </span>
          </div>
          <div className="text-[11px] text-emerald-400 font-mono flex items-center gap-1.5 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            <span>Tolerancia mecánica 254mm calibrada</span>
          </div>
        </div>

        {/* Banner de Info del Formato Activo */}
        <div className="bg-slate-950/60 px-6 py-2 border-b border-slate-800/80 flex items-center justify-between text-xs text-slate-300 font-mono">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>
              {format === '8up'
                ? `Formato Hoja Carta 8.5" x 11" · 8 etiquetas por página (${pagesGrid.length} hoja${pagesGrid.length === 1 ? '' : 's'}) · Compacto apaisado`
                : format === '10up'
                ? `Formato Hoja Carta 8.5" x 11" · 10 etiquetas por página (${pagesGrid.length} hoja${pagesGrid.length === 1 ? '' : 's'}) · Troquel comercial Avery 5163`
                : format === '4up'
                ? `Formato Hoja Carta 8.5" x 11" · 4 etiquetas por página (${pagesGrid.length} hoja${pagesGrid.length === 1 ? '' : 's'}) · Formato grande`
                : `Formato Rollo Térmico Continuo 100x150mm · Código 1D Code 128 activado`}
            </span>
          </div>
          <div className="text-slate-400 text-[11px]">
            {printableLabels.length === 0 ? (
              <span className="text-amber-400 font-semibold">⚠️ Ningún bulto seleccionado para impresión</span>
            ) : (
              <span>Escala 1:1 lista para corte y escaneo en planta</span>
            )}
          </div>
        </div>

        {/* Área de Previsualización Interactiva (Visual WYSWYG) */}
        <div className="p-6 bg-slate-950/40 overflow-y-auto max-h-[68vh] flex flex-col items-center gap-6 custom-scrollbar">
          {isGeneratingQr ? (
            <div className="py-16 text-center text-slate-400 text-sm">
              <div className="inline-block w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mb-3"></div>
              <p>Generando códigos QR, Code 128 y desglosando bultos...</p>
            </div>
          ) : printableLabels.length === 0 ? (
            <div className="py-16 text-center text-slate-400 space-y-3">
              <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto" />
              <p className="text-base font-bold text-white">No hay etiquetas seleccionadas</p>
              <p className="text-xs text-slate-400 max-w-md">
                Has desmarcado todos los bultos en el filtro quirúrgico. Pulsa <b>[Todos]</b> en la barra superior o haz clic en cualquier bulto individual para incluirlo.
              </p>
              <button
                type="button"
                onClick={selectAllKeys}
                className="px-4 py-2 bg-brand-500 text-slate-950 font-bold rounded-lg text-xs"
              >
                Seleccionar Todos los Bultos
              </button>
            </div>
          ) : format === '8up' ? (
            // Visualización 8-UP Carta (Compacto Apaisado)
            pagesGrid.map((page, pIdx) => (
              <div
                key={`page_${pIdx}`}
                className="bg-white text-slate-900 shadow-xl rounded p-3.5 w-full max-w-3xl aspect-[8.5/11] flex flex-col justify-between border border-slate-300"
              >
                <div className="text-[10px] font-mono text-slate-400 border-b border-slate-200 pb-1 mb-2 flex justify-between">
                  <span>Hoja {pIdx + 1} de {pagesGrid.length} (Carta Compacta 8-UP · 2x4)</span>
                  <span>SANESCA INDUSTRIAL PRINT SYSTEM</span>
                </div>
                <div className="grid grid-cols-2 grid-rows-4 gap-2 flex-grow">
                  {page.map(lbl => (
                    <div
                      key={lbl.key}
                      dangerouslySetInnerHTML={{ __html: renderLabelHtml(lbl, '8up') }}
                      className="h-full relative group cursor-pointer"
                      onClick={() => toggleSelectKey(lbl.key)}
                      title="Haz clic para alternar la selección de este bulto"
                    />
                  ))}
                  {Array.from({ length: 8 - page.length }).map((_, rIdx) => (
                    <div
                      key={`empty_${rIdx}`}
                      className="border-2 border-dashed border-slate-200 rounded flex items-center justify-center text-slate-300 text-xs font-mono"
                    >
                      (Etiqueta Libre / En Blanco)
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : format === '10up' ? (
            // Visualización 10-UP Carta (Avery 5163 / Troquel Comercial)
            pagesGrid.map((page, pIdx) => (
              <div
                key={`page_${pIdx}`}
                className="bg-white text-slate-900 shadow-xl rounded p-3 w-full max-w-3xl aspect-[8.5/11] flex flex-col justify-between border border-slate-300"
              >
                <div className="text-[10px] font-mono text-slate-400 border-b border-slate-200 pb-1 mb-1.5 flex justify-between">
                  <span>Hoja {pIdx + 1} de {pagesGrid.length} (Carta 10-UP · 2x5 Avery 5163)</span>
                  <span>SANESCA INDUSTRIAL PRINT SYSTEM</span>
                </div>
                <div className="grid grid-cols-2 grid-rows-5 gap-1.5 flex-grow">
                  {page.map(lbl => (
                    <div
                      key={lbl.key}
                      dangerouslySetInnerHTML={{ __html: renderLabelHtml(lbl, '10up') }}
                      className="h-full relative group cursor-pointer"
                      onClick={() => toggleSelectKey(lbl.key)}
                      title="Haz clic para alternar la selección de este bulto"
                    />
                  ))}
                  {Array.from({ length: 10 - page.length }).map((_, rIdx) => (
                    <div
                      key={`empty_${rIdx}`}
                      className="border-2 border-dashed border-slate-200 rounded flex items-center justify-center text-slate-300 text-[10px] font-mono"
                    >
                      (Libre)
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : format === '4up' ? (
            // Visualización 4-UP Carta (Grande)
            pagesGrid.map((page, pIdx) => (
              <div
                key={`page_${pIdx}`}
                className="bg-white text-slate-900 shadow-xl rounded p-4 w-full max-w-3xl aspect-[8.5/11] flex flex-col justify-between border border-slate-300"
              >
                <div className="text-[10px] font-mono text-slate-400 border-b border-slate-200 pb-1 mb-2 flex justify-between">
                  <span>Hoja {pIdx + 1} de {pagesGrid.length} (Carta Troquelada 4-UP · 2x2)</span>
                  <span>SANESCA INDUSTRIAL PRINT SYSTEM</span>
                </div>
                <div className="grid grid-cols-2 grid-rows-2 gap-3 flex-grow">
                  {page.map(lbl => (
                    <div
                      key={lbl.key}
                      dangerouslySetInnerHTML={{ __html: renderLabelHtml(lbl, '4up') }}
                      className="h-full relative group cursor-pointer"
                      onClick={() => toggleSelectKey(lbl.key)}
                      title="Haz clic para alternar la selección de este bulto"
                    />
                  ))}
                  {Array.from({ length: 4 - page.length }).map((_, rIdx) => (
                    <div
                      key={`empty_${rIdx}`}
                      className="border-2 border-dashed border-slate-200 rounded flex items-center justify-center text-slate-300 text-xs font-mono"
                    >
                      (Etiqueta Libre / En Blanco)
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            // Visualización Rollo Continuo 4x6"
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-3xl">
              {printableLabels.map(lbl => (
                <div
                  key={lbl.key}
                  className="bg-white text-slate-900 shadow-xl rounded p-4 aspect-[4/6] border border-slate-300 flex flex-col justify-between relative group cursor-pointer"
                  onClick={() => toggleSelectKey(lbl.key)}
                  title="Haz clic para alternar la selección de este bulto"
                  dangerouslySetInnerHTML={{ __html: renderLabelHtml(lbl, 'rollo4x6') }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer Informativo */}
        <div className="bg-slate-950 px-6 py-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div>
            <span>💡 <b>Recomendación de Rampa:</b> Usa <b>[Solo]</b> en el filtro para reimprimir exclusivamente el bulto dañado sin gastar papel térmico extra.</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs font-medium transition"
          >
            Volver
          </button>
        </div>

      </div>
    </div>
    </>,
    portalTarget
  );
};
