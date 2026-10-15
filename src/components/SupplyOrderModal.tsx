import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ShoppingCart, X, Plus, Trash2, Printer, CheckCircle, AlertTriangle, Link2, DollarSign, Search, ArrowUpDown, Loader2, Sparkles, BookOpen, ShieldCheck, RotateCcw, Save } from 'lucide-react';
import { InventoryItem } from '../types/inventory';
import { OABLineItem, OABHeader, OrderReference, computePackagingSuggestion } from '../types/oab';
import { generateFolioOAB, fetchNextFolioOAB, createOABSheet } from '../services/oabService';
import { getConcepts, upsertCatalogItem } from '../services/catalogService';
import { ConceptRoot } from '../types/catalog';
import { OrderSearchModal } from './OrderSearchModal';
import { PrintSheetOAB } from './PrintSheetOAB';

interface SupplyOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  inventoryItems: InventoryItem[];
  bcvRate: number;
  initialDraftItems?: InventoryItem[];
  onOrderCreated?: (createdLines: OABLineItem[]) => void;
  onItemCreated?: (item: InventoryItem) => void;
  currentUser?: {
    name?: string;
    permissions?: string[];
    puestos?: string[];
  } | null;
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

const PRIORITY_THEME: Record<PriorityType, {
  label: string;
  icon: string;
  badgeClass: string;
  borderClass: string;
  headerBg: string;
}> = {
  Urgente: {
    label: 'URGENTE',
    icon: '🔴',
    badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    borderClass: 'border-rose-500/30',
    headerBg: 'bg-rose-950/30',
  },
  Alta: {
    label: 'ALTA',
    icon: '🟠',
    badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    borderClass: 'border-amber-500/30',
    headerBg: 'bg-amber-950/30',
  },
  Media: {
    label: 'MEDIA',
    icon: '🟡',
    badgeClass: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
    borderClass: 'border-yellow-500/30',
    headerBg: 'bg-yellow-950/20',
  },
  Baja: {
    label: 'BAJA',
    icon: '🟢',
    badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    borderClass: 'border-emerald-500/30',
    headerBg: 'bg-emerald-950/20',
  },
  'Por Pedido': {
    label: 'POR PEDIDO',
    icon: '🔵',
    badgeClass: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
    borderClass: 'border-sky-500/30',
    headerBg: 'bg-sky-950/30',
  },
};

const DRAFT_STORAGE_KEY = 'sanesca_oab_draft_v1';

export interface OABDraftPayload {
  folio: string;
  fechaEmision: string;
  tasaBCV: number;
  notas: string;
  lines: OABLineItem[];
  savedAt: string;
}

export const SupplyOrderModal: React.FC<SupplyOrderModalProps> = ({
  isOpen,
  onClose,
  inventoryItems,
  bcvRate,
  initialDraftItems = [],
  onOrderCreated,
  onItemCreated,
  currentUser = null
}) => {
  const [folio, setFolio] = useState('');
  const [fechaEmision, setFechaEmision] = useState('');
  const [tasa, setTasa] = useState(Number((bcvRate || 36.50).toFixed(2)));
  const [notas, setNotas] = useState('');
  const [lines, setLines] = useState<OABLineItem[]>([]);
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [activeLineIdForOrder, setActiveLineIdForOrder] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedHeader, setSubmittedHeader] = useState<OABHeader | null>(null);
  const [showPrintSheet, setShowPrintSheet] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Estados Anti-Reset y Borrador Persistente (PLAN-015 - Ruta A)
  const [pendingDraft, setPendingDraft] = useState<OABDraftPayload | null>(null);
  const [showDraftWelcomeModal, setShowDraftWelcomeModal] = useState(false);
  const [showExitConfirmModal, setShowExitConfirmModal] = useState(false);
  const isInitializedRef = useRef(false);

  // Criterios de ordenamiento dentro de cada grupo
  const [sortCriterion, setSortCriterion] = useState<SortCriterion>('subtotal');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Estados para el Buscador Reactivo (Flujo Rápido de Taller)
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearchDropdownOpen, setIsSearchDropdownOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Estados para Alta Rápida de Insumo al Vuelo (Micro-Fase 11D)
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [conceptsList, setConceptsList] = useState<ConceptRoot[]>([]);
  const [quickConceptId, setQuickConceptId] = useState('');
  const [quickName, setQuickName] = useState('');
  const [quickCode, setQuickCode] = useState('');
  const [quickCategory, setQuickCategory] = useState('Herrajes y Tornillería');
  const [quickUom, setQuickUom] = useState('UND');
  const [quickCostUSD, setQuickCostUSD] = useState('1.00');
  const [isSavingQuick, setIsSavingQuick] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);

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

  // Función de Inicialización Limpia de Requisición
  const initializeFreshDraft = (customItems?: InventoryItem[]) => {
    setFolio(generateFolioOAB());
    fetchNextFolioOAB(true).then(nextFolio => {
      if (nextFolio) setFolio(nextFolio);
    }).catch(err => {
      console.warn('Error obteniendo folio atómico previo:', err);
    });
    setFechaEmision(new Date().toISOString().split('T')[0]);
    setTasa(Number((bcvRate || 36.50).toFixed(2)));
    setSubmittedHeader(null);
    setStatusMessage(null);
    setNotas('');

    const sourceItems = (customItems && customItems.length > 0)
      ? customItems
      : (initialDraftItems.length > 0
          ? initialDraftItems
          : inventoryItems.filter(i => (i.deficit || 0) > 0));

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
    isInitializedRef.current = true;
  };

  // Manejador de Apertura y Detección de Borrador en sessionStorage
  useEffect(() => {
    if (!isOpen) {
      isInitializedRef.current = false;
      setPendingDraft(null);
      setShowDraftWelcomeModal(false);
      setShowExitConfirmModal(false);
      return;
    }

    if (isInitializedRef.current) return;

    try {
      const saved = sessionStorage.getItem(DRAFT_STORAGE_KEY);
      if (saved) {
        const parsed: OABDraftPayload = JSON.parse(saved);
        if (parsed && Array.isArray(parsed.lines) && parsed.lines.length > 0) {
          setPendingDraft(parsed);
          setShowDraftWelcomeModal(true);
          return;
        }
      }
    } catch (e) {
      console.warn('Error leyendo borrador OAB de sessionStorage:', e);
    }

    initializeFreshDraft();
  }, [isOpen]);

  // Restaurar borrador seleccionado por el usuario
  const handleRestoreDraft = () => {
    if (!pendingDraft) return;
    setFolio(pendingDraft.folio || generateFolioOAB());
    setFechaEmision(pendingDraft.fechaEmision || new Date().toISOString().split('T')[0]);
    setTasa(pendingDraft.tasaBCV || Number((bcvRate || 36.50).toFixed(2)));
    setNotas(pendingDraft.notas || '');
    setLines(pendingDraft.lines || []);
    setShowDraftWelcomeModal(false);
    setPendingDraft(null);
    isInitializedRef.current = true;
  };

  // Descartar borrador e iniciar nueva orden limpia
  const handleDiscardDraftAndStartFresh = () => {
    try {
      sessionStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch (e) {}
    setShowDraftWelcomeModal(false);
    setPendingDraft(null);
    initializeFreshDraft();
  };

  // Auto-guardado en sessionStorage ante cada edición del usuario
  useEffect(() => {
    if (!isOpen || !isInitializedRef.current) return;
    if (lines.length === 0) return;

    const draftData: OABDraftPayload = {
      folio,
      fechaEmision,
      tasaBCV: tasa,
      notas,
      lines,
      savedAt: new Date().toISOString()
    };

    try {
      sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draftData));
    } catch (e) {
      console.warn('Error guardando borrador en sessionStorage:', e);
    }
  }, [lines, notas, tasa, folio, isOpen]);

  // Cierre seguro con diálogo de confirmación si hay modificaciones
  const handleAttemptClose = () => {
    if (lines.length > 0) {
      setShowExitConfirmModal(true);
    } else {
      onClose();
    }
  };

  const handleSaveDraftAndExit = () => {
    if (lines.length > 0) {
      const draftData: OABDraftPayload = {
        folio,
        fechaEmision,
        tasaBCV: tasa,
        notas,
        lines,
        savedAt: new Date().toISOString()
      };
      try {
        sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draftData));
      } catch (e) {}
    }
    setShowExitConfirmModal(false);
    onClose();
  };

  const handleDiscardAndExit = () => {
    try {
      sessionStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch (e) {}
    setShowExitConfirmModal(false);
    onClose();
  };

  // Agrupación reactiva por Prioridad Operativa con numeración global correlativa
  const groupedLines = useMemo(() => {
    let globalCounter = 1;
    const groups: {
      priority: PriorityType;
      subtotal: number;
      items: { line: OABLineItem; globalIndex: number }[];
    }[] = [];

    const sortFn = (items: OABLineItem[]) => {
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

    for (const prio of PRIORITY_ORDER) {
      const matching = lines.filter(l => normalizePriority(l.prioridad) === prio);
      if (matching.length > 0) {
        const sorted = sortFn(matching);
        const itemsWithIndex = sorted.map(line => ({
          line,
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

    return groups;
  }, [lines, sortCriterion, sortDirection]);

  if (!isOpen) return null;

  const getLineKey = (line: OABLineItem): string => line.dashboardId || line.insumoId || line.nombre;

  const handleQuantityChange = (lineId: string, qty: number) => {
    setLines(prev => prev.map(line => {
      if (getLineKey(line) !== lineId) return line;
      const validQty = Math.max(0, qty);
      return {
        ...line,
        cantidadSolicitada: validQty,
        subtotalUSD: validQty * (line.costoUnitarioUSD || 0)
      };
    }));
  };

  const handleCostChange = (lineId: string, cost: number) => {
    setLines(prev => prev.map(line => {
      if (getLineKey(line) !== lineId) return line;
      const validCost = Math.max(0, cost);
      return {
        ...line,
        costoUnitarioUSD: validCost,
        subtotalUSD: (line.cantidadSolicitada || 0) * validCost
      };
    }));
  };

  const handlePriorityChange = (lineId: string, prio: string) => {
    setLines(prev => prev.map(line => {
      if (getLineKey(line) !== lineId) return line;
      return { ...line, prioridad: prio };
    }));
  };

  const handleRemoveLine = (lineId: string) => {
    setLines(prev => prev.filter(line => getLineKey(line) !== lineId));
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
    if (activeLineIdForOrder !== null) {
      setLines(prev => prev.map(line => {
        if (getLineKey(line) !== activeLineIdForOrder) return line;
        const isStk = !order.id || order.codigo === 'STK' || (order.proyecto && order.proyecto.toLowerCase().includes('stock general'));
        if (isStk) {
          return {
            ...line,
            pedidoId: undefined,
            proyectoId: undefined,
            proyectoNombre: undefined
          };
        }
        return {
          ...line,
          pedidoId: order.id,
          proyectoId: order.proyectoId || order.id,
          proyectoNombre: `${order.codigo} - ${order.proyecto}`
        };
      }));
      setActiveLineIdForOrder(null);
    }
  };

  const handleOpenQuickAdd = async () => {
    const hasPerm = !currentUser || 
                    currentUser?.permissions?.includes('Emitir_OAB') || 
                    currentUser?.permissions?.includes('Superadmin') ||
                    currentUser?.puestos?.some(p => p.toLowerCase().includes('compra') || p.toLowerCase().includes('gerenc'));
    if (!hasPerm) {
      alert('Se requiere permiso de Emisión de OAB, Compras o Superadmin para registrar nuevos insumos al vuelo.');
      return;
    }

    setQuickName(searchTerm.trim() || '');
    setQuickCode('');
    setQuickCostUSD('1.00');
    setQuickError(null);
    setIsQuickAddOpen(true);

    if (conceptsList.length === 0) {
      try {
        const c = await getConcepts(false);
        setConceptsList(c);
      } catch (e) {}
    }
  };

  const handleQuickConceptChange = (conceptId: string) => {
    setQuickConceptId(conceptId);
    const found = conceptsList.find(c => c.id === conceptId);
    if (found) {
      if (found.codePrefix && !quickCode) {
        setQuickCode(`${found.codePrefix}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`);
      }
      if (found.defaultUoM) {
        setQuickUom(found.defaultUoM.toUpperCase().includes('METRO') ? 'ML' : 'UND');
      }
    }
  };

  const handleSaveQuickAdd = async () => {
    if (!quickName.trim()) {
      setQuickError('El nombre del insumo es obligatorio.');
      return;
    }
    if (!quickCode.trim()) {
      setQuickError('El código (SKU) es obligatorio.');
      return;
    }

    setIsSavingQuick(true);
    setQuickError(null);
    try {
      const res = await upsertCatalogItem({
        action: 'create',
        nombre: quickName.trim(),
        codigo: quickCode.trim().toUpperCase(),
        categoria: quickCategory,
        conceptoId: quickConceptId || undefined,
        unidad: quickUom,
        costoUnitarioUSD: parseFloat(quickCostUSD) || 1.0,
        stockMinimo: 0,
        activo: true
      });

      if (!res.ok) {
        throw new Error(res.error || 'Error al registrar insumo en Notion');
      }

      const costVal = parseFloat(quickCostUSD) || 1.0;
      const newInvItem: InventoryItem = {
        id: res.dashboardId || res.insumoId || quickCode.trim().toUpperCase(),
        insumoId: res.insumoId,
        nombre: quickName.trim(),
        codigo: quickCode.trim().toUpperCase(),
        stockBase: 0,
        stockMinimo: 0,
        deficit: 1,
        estadoStock: 'Sin Stock',
        prioridad: 'Alta',
        categoriaMaterial: quickCategory,
        unidad: quickUom,
        costoUnitarioUSD: costVal
      };

      handleAddManualItem(newInvItem);

      if (onItemCreated) {
        onItemCreated(newInvItem);
      }

      setIsQuickAddOpen(false);
      setSearchTerm('');
      setIsSearchDropdownOpen(false);
    } catch (e: any) {
      setQuickError(e.message || 'Error al guardar insumo');
    } finally {
      setIsSavingQuick(false);
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
      try {
        sessionStorage.removeItem(DRAFT_STORAGE_KEY);
      } catch (e) {}
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
              onClick={handleAttemptClose}
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
            <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs uppercase font-semibold text-slate-400 tracking-wider">
                  Ítems Seleccionados ({lines.length})
                </span>

                {/* Control de Ordenamiento Multi-Criterio */}
                <div className="flex items-center gap-1.5 text-[11px] bg-surface border border-borderSubtle rounded-md px-2 py-0.5">
                  <span className="text-slate-500 font-semibold text-[10px]">Ordenar por:</span>
                  <select
                    value={sortCriterion}
                    onChange={(e) => setSortCriterion(e.target.value as SortCriterion)}
                    className="bg-transparent text-slate-200 font-medium focus:outline-none cursor-pointer"
                  >
                    <option value="subtotal" className="bg-surface">Subtotal ($)</option>
                    <option value="costo" className="bg-surface">Costo Unitario ($)</option>
                    <option value="nombre" className="bg-surface">Nombre (A-Z)</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')}
                    className="p-1 text-slate-400 hover:text-white rounded hover:bg-surfaceHigh transition"
                    title={sortDirection === 'asc' ? 'Ascendente (menor a mayor)' : 'Descendente (mayor a menor)'}
                  >
                    <ArrowUpDown className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Buscador Reactivo de Insumos (Flujo Rápido de Taller) */}
              <div className="relative w-80 sm:w-96">
                <div className="relative flex items-center gap-1.5">
                  <div className="relative flex-1 flex items-center">
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
                  <button
                    type="button"
                    onClick={handleOpenQuickAdd}
                    className="px-2 py-1 bg-blue-600/20 hover:bg-blue-600/40 text-blue-300 border border-blue-500/30 rounded text-xs font-semibold whitespace-nowrap flex items-center gap-1 shadow-sm active:scale-95"
                    title="Registrar nuevo insumo al vuelo (Alta Dual)"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">+ Insumo al Vuelo</span>
                  </button>
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
                    <div className="p-1.5 bg-slate-900 border-t border-borderSubtle/50 text-center">
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleOpenQuickAdd();
                        }}
                        className="w-full py-1 text-xs text-blue-400 hover:text-blue-300 font-semibold flex items-center justify-center gap-1 hover:bg-slate-800 rounded"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>+ Registrar Nuevo Insumo al Vuelo</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Dropdown cuando no hay resultados */}
                {isSearchDropdownOpen && searchResults.length === 0 && searchTerm.trim() && (
                  <div className="absolute right-0 top-full mt-1.5 w-80 sm:w-96 bg-surfaceHigh border border-borderSubtle rounded-lg shadow-2xl z-30 p-3 text-center space-y-2">
                    <p className="text-xs text-slate-400">
                      No se encontró "<span className="text-slate-200 font-semibold">{searchTerm}</span>" en el catálogo.
                    </p>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleOpenQuickAdd();
                      }}
                      className="w-full py-1.5 px-3 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 shadow"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Registrar "{searchTerm}" al Vuelo</span>
                    </button>
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
                    {groupedLines.map(group => {
                      const theme = PRIORITY_THEME[group.priority];
                      return (
                        <React.Fragment key={group.priority}>
                          {/* Fila Encabezado de Prioridad con Subtotal en Pantalla */}
                          <tr className={`${theme.headerBg} border-t-2 border-b ${theme.borderClass}`}>
                            <td colSpan={10} className="py-1.5 px-3">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-bold border ${theme.badgeClass}`}>
                                    <span>{theme.icon}</span>
                                    <span>{theme.label}</span>
                                  </span>
                                  <span className="text-[11px] text-slate-400 font-mono">
                                    ({group.items.length} {group.items.length === 1 ? 'insumo' : 'insumos'})
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 font-mono text-[11px]">
                                  <span className="text-slate-400 uppercase text-[10px] font-semibold">Subtotal Prioridad:</span>
                                  <span className="font-bold text-emerald-400">${group.subtotal.toFixed(2)} USD</span>
                                </div>
                              </div>
                            </td>
                          </tr>

                          {/* Renglones de la Prioridad */}
                          {group.items.map(({ line, globalIndex }) => {
                            const lineKey = getLineKey(line);
                            return (
                              <tr key={lineKey} className="hover:bg-surfaceHigh/30 transition">
                                <td className="p-2 text-center text-slate-500 font-mono">{globalIndex}</td>
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
                                      onChange={(e) => handleQuantityChange(lineKey, Number(e.target.value))}
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
                                          onClick={() => handleQuantityChange(lineKey, line.cantidadComercialSugerida!)}
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
                                          onClick={() => handleQuantityChange(lineKey, line.cantidadSugerida)}
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
                                    onChange={(e) => handleCostChange(lineKey, Number(e.target.value))}
                                    className="w-16 px-1.5 py-1 text-right font-mono bg-page border border-borderSubtle rounded text-slate-200"
                                  />
                                </td>
                                <td className="p-2 text-right font-mono font-bold text-slate-100">
                                  ${line.subtotalUSD.toFixed(2)}
                                </td>
                                <td className="p-2">
                                  <select
                                    value={line.prioridad}
                                    onChange={(e) => handlePriorityChange(lineKey, e.target.value)}
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
                                    <div className="flex items-center gap-1 text-[11px] text-brand-400 font-mono truncate max-w-[140px]">
                                      <span className="truncate" title={line.proyectoNombre}>{line.proyectoNombre}</span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setActiveLineIdForOrder(lineKey);
                                          setOrderModalOpen(true);
                                        }}
                                        className="text-slate-400 hover:text-white p-0.5 rounded hover:bg-surfaceHigh transition shrink-0"
                                        title="Cambiar obra o pedido"
                                      >
                                        ✎
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setLines(prev => prev.map(l => getLineKey(l) === lineKey ? { ...l, pedidoId: undefined, proyectoId: undefined, proyectoNombre: undefined } : l));
                                        }}
                                        className="text-slate-500 hover:text-rose-400 p-0.5 rounded hover:bg-rose-500/10 transition shrink-0 text-xs font-bold"
                                        title="Desvincular obra (pasar a Stock Común MTS)"
                                      >
                                        ✕
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1.5">
                                      <span className="inline-flex items-center gap-1 text-[10px] text-amber-300 font-mono bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded shrink-0">
                                        <span>📦 Stock Común</span>
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setActiveLineIdForOrder(lineKey);
                                          setOrderModalOpen(true);
                                        }}
                                        className="text-[10px] text-slate-400 hover:text-brand-400 flex items-center gap-0.5 underline shrink-0 transition"
                                        title="Asignar a una obra o pedido específico"
                                      >
                                        <Link2 className="w-2.5 h-2.5" />
                                        <span>Vincular</span>
                                      </button>
                                    </div>
                                  )}
                                </td>
                                <td className="p-2 text-center">
                                  <button
                                    onClick={() => handleRemoveLine(lineKey)}
                                    className="text-red-400 hover:text-red-300 transition p-1"
                                    title="Eliminar línea"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </React.Fragment>
                      );
                    })}
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
                onClick={handleAttemptClose}
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
            setActiveLineIdForOrder(null);
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

      {/* Sub-modal: Alta Rápida de Insumo al Vuelo (Micro-Fase 11D) */}
      {isQuickAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-lg w-full shadow-2xl text-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2 text-blue-400">
                <Sparkles className="w-5 h-5" />
                <h3 className="font-bold text-base text-white">Alta Rápida de Insumo al Vuelo</h3>
              </div>
              <button
                onClick={() => setIsQuickAddOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Registra el nuevo insumo en Notion ERP con Alta Dual Atómica y lo agrega inmediatamente a la lista de compra.
            </p>

            {quickError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-300 text-xs flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{quickError}</span>
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Concepto Raíz ISO (Opcional)
                </label>
                <select
                  value={quickConceptId}
                  onChange={e => handleQuickConceptChange(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-blue-500"
                >
                  <option value="">-- Sin Concepto ISO --</option>
                  {conceptsList.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.codePrefix})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Nombre del Insumo *
                </label>
                <input
                  type="text"
                  value={quickName}
                  onChange={e => setQuickName(e.target.value)}
                  placeholder="Ej: TORNILLO GYPSUM 6X1..."
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 font-semibold focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Código (SKU) *
                  </label>
                  <input
                    type="text"
                    value={quickCode}
                    onChange={e => setQuickCode(e.target.value.toUpperCase())}
                    placeholder="Ej: TOR-9901"
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg font-mono text-blue-300 uppercase focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Unidad de Medida
                  </label>
                  <select
                    value={quickUom}
                    onChange={e => setQuickUom(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-blue-500"
                  >
                    <option value="UND">Unidad (UND)</option>
                    <option value="ML">Metro Lineal (ML)</option>
                    <option value="PLANCHA">Plancha / Lámina</option>
                    <option value="KG">Kilogramo (KG)</option>
                    <option value="L">Litro (L)</option>
                    <option value="PAR">Par (PAR)</option>
                    <option value="CJ">Caja (CJ)</option>
                    <option value="PAQ">Paquete (PAQ)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Categoría
                  </label>
                  <select
                    value={quickCategory}
                    onChange={e => setQuickCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-blue-500"
                  >
                    <option value="Herrajes y Accesorios">Herrajes y Accesorios</option>
                    <option value="Adhesivos y Químicos">Adhesivos y Químicos</option>
                    <option value="Tableros">Tableros</option>
                    <option value="Fijaciones (Tornillería)">Fijaciones (Tornillería)</option>
                    <option value="Laminados Decorativos">Laminados Decorativos</option>
                    <option value="Tapacantos">Tapacantos</option>
                    <option value="Tubería (Redonda)">Tubería (Redonda)</option>
                    <option value="Láminas">Láminas</option>
                    <option value="Platinas">Platinas</option>
                    <option value="Mallas">Mallas</option>
                    <option value="Tubería (Cuadrada/Rectangular)">Tubería (Cuadrada/Rectangular)</option>
                    <option value="Barras y Varillas">Barras y Varillas</option>
                    <option value="Tubería (Especializada)">Tubería (Especializada)</option>
                    <option value="Herramientas y Abrasivos">Herramientas y Abrasivos</option>
                    <option value="Suministros Neumáticos">Suministros Neumáticos</option>
                    <option value="Equipo de Protección Personal (EPP)">Equipo de Protección Personal (EPP)</option>
                    <option value="Indumentaria y Seguridad">Indumentaria y Seguridad</option>
                    <option value="Equipos y Maquinaria">Equipos y Maquinaria</option>
                    <option value="Suministros de Limpieza">Suministros de Limpieza</option>
                    <option value="Perfiles y Tubos">Perfiles y Tubos</option>
                    <option value="Abrasivos">Abrasivos</option>
                    <option value="Maderas y Tableros">Maderas y Tableros</option>
                    <option value="Herrajes y Tornillería">Herrajes y Tornillería</option>
                    <option value="Químicos y Pegamentos">Químicos y Pegamentos</option>
                    <option value="Vidrios y Espejos">Vidrios y Espejos</option>
                    <option value="Metales y Perfilería">Metales y Perfilería</option>
                    <option value="Empaque y Embalaje">Empaque y Embalaje</option>
                    <option value="General">General</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Costo Base ($ USD)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={quickCostUSD}
                    onChange={e => setQuickCostUSD(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg font-mono text-emerald-400 font-bold focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsQuickAddOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveQuickAdd}
                disabled={isSavingQuick}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white text-xs font-bold rounded-lg flex items-center space-x-1.5 shadow"
              >
                {isSavingQuick ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Guardando...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Crear e Insertar en OAB</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Modal de Bienvenida: Borrador de Solicitud Detectado */}
      {showDraftWelcomeModal && pendingDraft && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-fade-in no-print">
          <div className="bg-surface border border-brand-500/50 rounded-2xl w-full max-w-md p-5 sm:p-6 shadow-2xl flex flex-col items-center text-center space-y-4 ring-1 ring-brand-500/30">
            <div className="w-12 h-12 rounded-2xl bg-brand-500/20 text-brand-400 border border-brand-500/40 flex items-center justify-center shadow-inner">
              <Sparkles className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100 tracking-tight">
                Borrador de Solicitud Detectado
              </h3>
              <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">
                Se encontró una orden en curso con <strong className="text-brand-400">{pendingDraft.lines.length} material(es)</strong> guardada localmente ({pendingDraft.savedAt ? new Date(pendingDraft.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'reciente'}).
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                ¿Deseas restaurar tus cantidades y prioridades personalizadas o empezar una requisición nueva?
              </p>
            </div>

            <div className="w-full flex flex-col sm:flex-row gap-2 pt-2">
              <button
                type="button"
                onClick={handleRestoreDraft}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 bg-brand-500 hover:bg-brand-600 text-slate-950 font-bold rounded-xl text-xs transition shadow-lg shadow-brand-500/20 active:scale-95"
              >
                <Sparkles className="w-4 h-4" />
                <span>Restaurar Borrador</span>
              </button>
              <button
                type="button"
                onClick={handleDiscardDraftAndStartFresh}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-4 bg-surfaceHigh hover:bg-surfaceHighest text-slate-300 border border-borderSubtle rounded-xl text-xs font-semibold transition active:scale-95"
              >
                <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
                <span>Empezar Nuevo</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Salida Segura: Diálogo Tripartito */}
      {showExitConfirmModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-fade-in no-print">
          <div className="bg-surface border border-borderSubtle rounded-2xl w-full max-w-md p-5 sm:p-6 shadow-2xl flex flex-col space-y-4">
            <div className="flex items-center gap-3 border-b border-borderSubtle pb-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-100">
                  ¿Deseas salir de la solicitud?
                </h3>
                <p className="text-xs text-slate-400">
                  Tienes <strong className="text-amber-300">{lines.length} material(es)</strong> configurados en esta requisición.
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Puedes conservar tu borrador para continuar luego sin perder tus cambios, o descartarlo si ya no requieres emitir esta orden.
            </p>

            <div className="flex flex-col gap-2 pt-2">
              <button
                type="button"
                onClick={handleSaveDraftAndExit}
                className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-brand-500 hover:bg-brand-600 text-slate-950 font-bold rounded-xl text-xs transition shadow active:scale-95"
              >
                <Save className="w-4 h-4" />
                <span>Guardar borrador y salir</span>
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleDiscardAndExit}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-xl text-xs font-semibold transition active:scale-95"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Descartar borrador</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowExitConfirmModal(false)}
                  className="flex items-center justify-center py-2 px-3 bg-surfaceHigh hover:bg-surfaceHighest text-slate-200 border border-borderSubtle rounded-xl text-xs font-semibold transition active:scale-95"
                >
                  <span>Seguir editando</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
