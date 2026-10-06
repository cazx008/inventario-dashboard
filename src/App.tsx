import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { InventoryItem, KpiSummary, ColumnDef, SortLevel } from './types/inventory';
import { OABLineItem } from './types/oab';
import { loadInventoryData, fetchBCVRate, revalidateInventoryLive } from './services/inventoryService';
import { Header } from './components/Header';
import { KpiCards } from './components/KpiCards';
import { FilterBar } from './components/FilterBar';
import { InventoryTable } from './components/InventoryTable';
import { GlossaryModal } from './components/GlossaryModal';
import { SupplyOrderModal } from './components/SupplyOrderModal';
import { ReceptionTerminalModal } from './components/ReceptionTerminalModal';
import { OABReviewModal } from './components/OABReviewModal';
import { KardexViewerModal } from './components/KardexViewerModal';
import { PinLoginModal } from './components/PinLoginModal';
import { AccessDeniedModal } from './components/AccessDeniedModal';
import { ChangePinModal } from './components/ChangePinModal';
import { AccessAuditModal } from './components/AccessAuditModal';
import { MaterialDispatchModal } from './components/MaterialDispatchModal';
import { OrderBOMAuditModal } from './components/OrderBOMAuditModal';
import { StockAdjustmentModal } from './components/StockAdjustmentModal';
import { StockAdjustmentResult } from './types/adjustment';
import { Trash2 } from 'lucide-react';
import { useTelegramAuth } from './hooks/useTelegramAuth';
import { PermissionKey } from './types/auth';

export const allColumnsDef: ColumnDef[] = [
  { key: 'nombre', label: 'Nombre', sortable: true, groupable: false, align: 'left' },
  { key: 'codigo', label: 'Código', sortable: true, groupable: false, align: 'left' },
  { key: 'marca', label: 'Marca', sortable: true, groupable: true, align: 'left' },
  { key: 'stockBase', label: 'Stock', sortable: true, groupable: false, align: 'right' },
  { key: 'stockMinimo', label: 'Stock Mín.', sortable: true, groupable: false, align: 'right' },
  { key: 'deficit', label: 'Déficit', sortable: true, groupable: false, align: 'right' },
  { key: 'enTransitoOAB', label: 'En Tránsito (OAB)', sortable: true, groupable: false, align: 'right' },
  { key: 'stockProyectado', label: 'Stock Proy.', sortable: true, groupable: false, align: 'right' },
  { key: 'estadoStock', label: 'Estado', sortable: true, groupable: true, align: 'left' },
  { key: 'prioridad', label: 'Prioridad', sortable: true, groupable: true, align: 'left' },
  { key: 'categoriaMaterial', label: 'Categoría', sortable: true, groupable: true, align: 'left' },
  { key: 'rolMaterial', label: 'Rol Material', sortable: true, groupable: true, align: 'left' },
  { key: 'origenConsumo', label: 'Origen Consumo', sortable: true, groupable: true, align: 'left' },
  { key: 'unidad', label: 'Unidad', sortable: true, groupable: true, align: 'left' },
  { key: 'color', label: 'Color', sortable: true, groupable: false, align: 'left' },
  { key: 'dimensiones', label: 'Dimensiones', sortable: false, groupable: false, align: 'left' },
  { key: 'grupoProceso', label: 'Grupo Proceso', sortable: true, groupable: true, align: 'left' },
  { key: 'proceso', label: 'Proceso', sortable: true, groupable: true, align: 'left' },
  { key: 'departamento', label: 'Departamento', sortable: true, groupable: true, align: 'left' },
  { key: 'seReconto3D', label: 'Reconteo 3D', sortable: true, groupable: false, align: 'left' },
  { key: 'diasDesdeReconteo', label: 'Días Reconteo', sortable: true, groupable: false, align: 'right' },
];

export const compactColumnKeys = [
  'nombre',
  'stockBase',
  'stockMinimo',
  'deficit',
  'enTransitoOAB',
  'stockProyectado',
  'estadoStock',
  'prioridad'
];

export default function App() {
  // Data State
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [baseKpis, setBaseKpis] = useState<KpiSummary>({
    total: 0,
    estado: { sinStock: 0, bajoMinimo: 0, enStock: 0, enReconteo: 0, descontinuado: 0 },
    prioridad: { urgente: 0, alta: 0, media: 0, baja: 0, porPedido: 0 },
    auditados3D: 0,
    auditados3DPct: 0,
  });
  const [selectOrders, setSelectOrders] = useState<Record<string, string[]>>({});
  const [lastSyncDisplay, setLastSyncDisplay] = useState('—');
  const [bcvRate, setBcvRate] = useState(36.50);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filter & View State
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'compact' | 'expanded' | 'custom'>('compact');
  const [visibleColumns, setVisibleColumns] = useState<string[]>(compactColumnKeys);
  const [sortLevels, setSortLevels] = useState<SortLevel[]>([
    { key: 'prioridad', dir: 'asc' },
    { key: 'deficit', dir: 'desc' }
  ]);
  const [groupByKey, setGroupByKey] = useState<string | null>(null);
  const [quickFilters, setQuickFilters] = useState<{ estadoStock: string[]; prioridad: string[] }>({
    estadoStock: [],
    prioridad: []
  });
  const [onlyDeficit, setOnlyDeficit] = useState(false);
  const [onlyPendingRecount, setOnlyPendingRecount] = useState(false);

  // Auth & RBAC State
  const auth = useTelegramAuth();
  const [deniedModalOpen, setDeniedModalOpen] = useState(false);
  const [deniedTargetModule, setDeniedTargetModule] = useState('Módulo Protegido');

  // Modals
  const [supplyModalOpen, setSupplyModalOpen] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [receptionModalOpen, setReceptionModalOpen] = useState(false);
  const [kardexModalOpen, setKardexModalOpen] = useState(false);
  const [kardexTargetMaterial, setKardexTargetMaterial] = useState<{ id: string; nombre: string; stock: number } | null>(null);
  const [draftItemsForModal, setDraftItemsForModal] = useState<InventoryItem[]>([]);
  const [draftBasket, setDraftBasket] = useState<InventoryItem[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [deepLinkFolio, setDeepLinkFolio] = useState<string | null>(null);
  const [changePinModalOpen, setChangePinModalOpen] = useState(false);
  const [auditModalOpen, setAuditModalOpen] = useState(false);
  const [dispatchModalOpen, setDispatchModalOpen] = useState(false);
  const [dispatchPreselectedItem, setDispatchPreselectedItem] = useState<InventoryItem | null>(null);
  const [bomAuditModalOpen, setBomAuditModalOpen] = useState(false);
  const [bomAuditPreselectedOrder, setBomAuditPreselectedOrder] = useState<{ id?: string; codigo?: string; nombre?: string } | null>(null);
  const [adjustmentModalOpen, setAdjustmentModalOpen] = useState(false);
  const [adjustmentPreselectedItem, setAdjustmentPreselectedItem] = useState<InventoryItem | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(curr => (curr === msg ? null : curr));
    }, 3500);
  }, []);

  // Auto-apertura por Deep-Links sincronizada con perfil y permisos
  useEffect(() => {
    if (auth.loading) return;

    try {
      const params = new URLSearchParams(window.location.search);
      const folioParam = params.get('folio');
      const kardexParam = params.get('kardex');

      if (folioParam) {
        setDeepLinkFolio(folioParam);
        if (kardexParam === 'true') {
          if (auth.hasPermission('Auditoria_Kardex')) {
            setKardexModalOpen(true);
          } else {
            setDeniedTargetModule('Libro Mayor de Almacén (Kardex)');
            setDeniedModalOpen(true);
            auth.triggerHaptic('error');
          }
        } else {
          // Enrutamiento Inteligente por Rol acordado en Grill-Me:
          if (auth.hasPermission('Revisar_OAB')) {
            setReviewModalOpen(true);
          } else if (auth.hasPermission('Recepcion_Rampa')) {
            setReceptionModalOpen(true);
          } else {
            setDeniedTargetModule('Gestión Digital OAB (Revisión / Rampa)');
            setDeniedModalOpen(true);
            auth.triggerHaptic('error');
          }
        }
      } else if (kardexParam === 'true') {
        if (auth.hasPermission('Auditoria_Kardex')) {
          setKardexModalOpen(true);
        } else {
          setDeniedTargetModule('Libro Mayor de Almacén (Kardex)');
          setDeniedModalOpen(true);
          auth.triggerHaptic('error');
        }
      }
    } catch (e) {
      console.warn('Error interpretando deep-links:', e);
    }
  }, [auth.loading, auth.profile]);

  // Load Initial Data
  const fetchData = useCallback(async () => {
    try {
      setLoadError(false);
      const data = await loadInventoryData();
      setItems(data.items);
      setBaseKpis(data.kpis);
      setSelectOrders(data.selectOrders);
      setLastSyncDisplay(data.lastSyncDisplay);

      const bcv = await fetchBCVRate();
      setBcvRate(bcv.rate);

      // SWR: Revalidación en segundo plano contra Notion API vía Cloudflare Functions
      revalidateInventoryLive(data.items).then(result => {
        if (result.synced) {
          setItems(result.updatedItems);
        }
      }).catch(swrErr => console.warn('Background SWR:', swrErr));

    } catch (err) {
      console.error('Error fetching inventory:', err);
      setLoadError(true);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchData();
  };

  // Handler cuando se emite una OAB:
  // NOTA ARQUITECTÓNICA (Odoo-Sanesca): La requisición 'Solicitado' NO suma a tránsito hasta ser aprobada y comprada.
  const handleOrderCreated = useCallback((createdLines: OABLineItem[]) => {
    // Vaciar la bandeja acumulativa de requisición
    setDraftBasket([]);

    setItems(prevItems => {
      return prevItems.map(item => {
        const line = createdLines.find(
          l => (l.dashboardId && l.dashboardId === item.id) ||
               (l.insumoId && l.insumoId === item.insumoId) ||
               (l.nombre && item.nombre && l.nombre.toLowerCase().trim() === item.nombre.toLowerCase().trim())
        );
        if (!line) return item;
        return {
          ...item,
          isOptimisticSync: true,
          syncNote: `Requisición registrada (Tránsito 0 hasta compra)`
        };
      });
    });

    // Reconciliar con Notion en segundo plano tras 2 segundos
    setTimeout(() => {
      setItems(current => {
        revalidateInventoryLive(current).then(res => {
          if (res.synced) setItems(res.updatedItems);
        });
        return current;
      });
    }, 2000);
  }, []);

  // Optimistic handler: cuando se asienta una recepción en rampa
  const handleReceptionSuccess = useCallback((receivedLines?: OABLineItem[]) => {
    if (receivedLines && receivedLines.length > 0) {
      setItems(prevItems => {
        return prevItems.map(item => {
          const line = receivedLines.find(
            l => (l.dashboardId && l.dashboardId === item.id) ||
                 (l.insumoId && l.insumoId === item.insumoId) ||
                 (l.nombre && item.nombre && l.nombre.toLowerCase().trim() === item.nombre.toLowerCase().trim())
          );
          if (!line) return item;
          const receivedQty = Number(line.cantidadRecibida) || 0;
          if (receivedQty <= 0) return item;
          const newStock = (item.stockBase || 0) + receivedQty;
          const newTransit = Math.max(0, (item.enTransitoOAB || 0) - receivedQty);
          const newProyectado = newStock + newTransit;
          const newDeficit = Math.max(0, (item.stockMinimo || 0) - newStock);
          return {
            ...item,
            stockBase: newStock,
            enTransitoOAB: newTransit,
            stockProyectado: newProyectado,
            deficit: newDeficit,
            isOptimisticSync: true,
            syncNote: `+${receivedQty} ingresado a existencias`
          };
        });
      });
    }

    // Reconciliar con Notion en segundo plano tras 2 segundos
    setTimeout(() => {
      setItems(current => {
        revalidateInventoryLive(current).then(res => {
          if (res.synced) setItems(res.updatedItems);
        });
        return current;
      });
    }, 2000);
  }, []);

  // Handler para Conteo Cíclico y Ajustes de Kardex (Fase 9F - Decisión /grill-me)
  const handleOpenAdjustmentModal = useCallback((preselected: InventoryItem | null = null) => {
    if (!auth.hasPermission('Auditoria_Kardex') && !auth.hasPermission('Superadmin')) {
      setDeniedTargetModule('Conteo Cíclico y Ajustes de Kardex');
      setDeniedModalOpen(true);
      auth.triggerHaptic('error');
      return;
    }
    setAdjustmentPreselectedItem(preselected);
    setAdjustmentModalOpen(true);
  }, [auth]);

  const handleAdjustmentSuccess = useCallback((result: StockAdjustmentResult) => {
    showToast(result.message);
    auth.triggerHaptic('success');

    if (result.newStock !== undefined) {
      setItems(prevItems => prevItems.map(item => {
        const isTarget = (adjustmentPreselectedItem && item.id === adjustmentPreselectedItem.id) ||
                         (result.kardexId && adjustmentPreselectedItem && item.nombre === adjustmentPreselectedItem.nombre);
        if (isTarget) {
          const newStock = result.newStock!;
          const newDeficit = Math.max(0, item.stockMinimo - newStock);
          let newEstado = '🟢 En Stock';
          if (newStock === 0) newEstado = '🔴 Sin Stock';
          else if (newStock < item.stockMinimo) newEstado = '🟠 Bajo Mínimo';

          return {
            ...item,
            stockBase: newStock,
            deficit: newDeficit,
            estadoStock: result.nuevoEstadoStock || newEstado,
            stockProyectado: newStock + (item.enTransitoOAB || 0),
            seReconto3D: true,
            seRecontoHoy: true,
            diasDesdeReconteo: 0,
            ultimaFechaReconteo: new Date().toISOString().split('T')[0],
            necesitaReconteo: false
          };
        }
        return item;
      }));
    }

    // Reconciliar con Notion en segundo plano tras 2.5 segundos (SWR anti-flicker Fase 9G)
    setTimeout(() => {
      setItems(current => {
        revalidateInventoryLive(current).then(res => {
          if (res.synced) setItems(res.updatedItems);
        }).catch(err => console.warn('Background SWR post-ajuste:', err));
        return current;
      });
    }, 2500);
  }, [adjustmentPreselectedItem, auth, showToast]);

  // View Mode changes
  const handleSetViewMode = (mode: 'compact' | 'expanded') => {
    setViewMode(mode);
    if (mode === 'compact') {
      setVisibleColumns(compactColumnKeys);
    } else {
      setVisibleColumns(allColumnsDef.map(c => c.key));
    }
  };

  const handleToggleColumn = (key: string) => {
    setVisibleColumns(prev => {
      const idx = prev.indexOf(key);
      if (idx >= 0) {
        return prev.filter(k => k !== key);
      } else {
        const order = allColumnsDef.map(c => c.key);
        const next = [...prev, key];
        next.sort((a, b) => order.indexOf(a) - order.indexOf(b));
        return next;
      }
    });
    setViewMode('custom');
  };

  // Sorting
  const handleToggleSort = (key: string) => {
    setSortLevels(prev => {
      if (prev.length > 0 && prev[0].key === key) {
        if (prev[0].dir === 'asc') return [{ key, dir: 'desc' as const }, ...prev.slice(1)];
        return prev.slice(1);
      }
      return [{ key, dir: 'asc' as const }, ...prev.filter(l => l.key !== key)].slice(0, 3);
    });
  };

  const handleAddSortLevel = (key: string, dir: 'asc' | 'desc') => {
    setSortLevels(prev => [...prev.filter(l => l.key !== key), { key, dir }].slice(0, 3));
  };

  const handleRemoveSortLevel = (idx: number) => {
    setSortLevels(prev => prev.filter((_, i) => i !== idx));
  };

  // Quick Filters
  const handleToggleQuickFilter = (group: 'estadoStock' | 'prioridad', value: string) => {
    setQuickFilters(prev => {
      const arr = prev[group];
      const nextArr = arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value];
      return { ...prev, [group]: nextArr };
    });
  };

  const handleFilterByStatusFromKpi = (status: string) => {
    handleToggleQuickFilter('estadoStock', status);
  };

  // Reset
  const handleResetAll = () => {
    setSearchQuery('');
    setSortLevels([
      { key: 'prioridad', dir: 'asc' },
      { key: 'deficit', dir: 'desc' }
    ]);
    setQuickFilters({ estadoStock: [], prioridad: [] });
    setGroupByKey(null);
    setOnlyDeficit(false);
    setOnlyPendingRecount(false);
    handleSetViewMode('compact');
  };

  // Active filters check
  const hasActiveFilters = useMemo(() => {
    return (
      searchQuery.trim() !== '' ||
      quickFilters.estadoStock.length > 0 ||
      quickFilters.prioridad.length > 0 ||
      onlyDeficit ||
      onlyPendingRecount ||
      groupByKey !== null ||
      viewMode !== 'compact'
    );
  }, [searchQuery, quickFilters, onlyDeficit, onlyPendingRecount, groupByKey, viewMode]);

  // Contador de artículos pendientes de reconteo físico (>3 días sin auditar o nunca contados)
  const pendingRecountCount = useMemo(() => {
    return items.filter(i => !i.seReconto3D || i.diasDesdeReconteo == null || i.diasDesdeReconteo > 3).length;
  }, [items]);

  // Filtering & Sorting Process
  const filteredAndSortedItems = useMemo(() => {
    let result = [...items];

    // 1. Text search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(i =>
        (i.nombre && i.nombre.toLowerCase().includes(q)) ||
        (i.codigo && i.codigo.toLowerCase().includes(q)) ||
        (i.marca && i.marca.toLowerCase().includes(q)) ||
        (i.categoriaMaterial && i.categoriaMaterial.toLowerCase().includes(q))
      );
    }

    // 2. Quick filters
    if (quickFilters.estadoStock.length > 0) {
      result = result.filter(i => quickFilters.estadoStock.includes(i.estadoStock));
    }
    if (quickFilters.prioridad.length > 0) {
      result = result.filter(i => quickFilters.prioridad.includes(i.prioridad));
    }

    // 3. Only deficit
    if (onlyDeficit) {
      result = result.filter(i => (i.deficit || 0) > 0);
    }

    // 3.5 Only pending recount (>3D)
    if (onlyPendingRecount) {
      result = result.filter(i => !i.seReconto3D || i.diasDesdeReconteo == null || i.diasDesdeReconteo > 3);
    }

    // 4. Sorting
    if (sortLevels.length > 0) {
      result.sort((a, b) => {
        for (const lvl of sortLevels) {
          const valA = (a as any)[lvl.key];
          const valB = (b as any)[lvl.key];

          const order = selectOrders[lvl.key];
          if (order) {
            const ai = order.indexOf(valA);
            const bi = order.indexOf(valB);
            const cmp = (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
            if (cmp !== 0) return lvl.dir === 'asc' ? cmp : -cmp;
          } else {
            if (valA == null && valB == null) continue;
            if (valA == null) return 1;
            if (valB == null) return -1;

            if (typeof valA === 'number' && typeof valB === 'number') {
              const diff = valA - valB;
              if (diff !== 0) return lvl.dir === 'asc' ? diff : -diff;
            } else if (typeof valA === 'boolean' && typeof valB === 'boolean') {
              const diff = valA === valB ? 0 : valA ? -1 : 1;
              if (diff !== 0) return lvl.dir === 'asc' ? diff : -diff;
            } else {
              const cmp = String(valA).localeCompare(String(valB), 'es');
              if (cmp !== 0) return lvl.dir === 'asc' ? cmp : -cmp;
            }
          }
        }
        return 0;
      });
    }

    return result;
  }, [items, searchQuery, quickFilters, onlyDeficit, onlyPendingRecount, sortLevels, selectOrders]);

  // Dynamic KPIs from filtered items
  const activeKpis = useMemo(() => {
    if (!hasActiveFilters) return baseKpis;

    const fk: KpiSummary = {
      total: filteredAndSortedItems.length,
      estado: { sinStock: 0, bajoMinimo: 0, enStock: 0, enReconteo: 0, descontinuado: 0 },
      prioridad: { urgente: 0, alta: 0, media: 0, baja: 0, porPedido: 0 },
      auditados3D: 0,
      auditados3DPct: 0,
    };

    for (const item of filteredAndSortedItems) {
      if (item.estadoStock === 'Sin Stock') fk.estado.sinStock++;
      else if (item.estadoStock === 'Bajo Mínimo') fk.estado.bajoMinimo++;
      else if (item.estadoStock === 'En Stock') fk.estado.enStock++;
      else if (item.estadoStock === 'En Reconteo') fk.estado.enReconteo++;
      else if (item.estadoStock === 'Descontinuado') fk.estado.descontinuado++;

      if (item.seReconto3D) fk.auditados3D++;
    }

    fk.auditados3DPct =
      filteredAndSortedItems.length > 0
        ? Math.round((fk.auditados3D / filteredAndSortedItems.length) * 100)
        : 0;

    return fk;
  }, [filteredAndSortedItems, hasActiveFilters, baseKpis]);

  // Agregar insumo a la Bandeja Flotante de Requisición (acordado en Grill-Me)
  const handleAddToDraft = (item: InventoryItem) => {
    if (!auth.hasPermission('Emitir_OAB')) {
      setDeniedTargetModule('Emisión de Órdenes de Abastecimiento (OAB)');
      setDeniedModalOpen(true);
      auth.triggerHaptic('error');
      return;
    }

    setDraftBasket(prev => {
      const alreadyExists = prev.some(i => i.id === item.id);
      if (alreadyExists) {
        showToast(`"${item.nombre}" ya está seleccionado en la bandeja.`);
        auth.triggerHaptic('warning');
        return prev;
      }
      showToast(`✓ "${item.nombre}" agregado a la bandeja (${prev.length + 1})`);
      auth.triggerHaptic('success');
      return [...prev, item];
    });
  };

  return (
    <div className="bg-page text-slate-100 min-h-screen flex flex-col antialiased">
      {/* Header */}
      <Header
        lastSyncDisplay={lastSyncDisplay}
        bcvRate={bcvRate}
        onOpenSupplyModal={() => {
          if (auth.hasPermission('Emitir_OAB')) {
            setDraftItemsForModal(draftBasket);
            setSupplyModalOpen(true);
          } else {
            setDeniedTargetModule('Emisión de Órdenes de Abastecimiento (OAB)');
            setDeniedModalOpen(true);
            auth.triggerHaptic('error');
          }
        }}
        onOpenReviewModal={() => {
          if (auth.hasPermission('Revisar_OAB')) {
            setReviewModalOpen(true);
          } else {
            setDeniedTargetModule('Revisión y Transcripción de Compras');
            setDeniedModalOpen(true);
            auth.triggerHaptic('error');
          }
        }}
        onOpenReceptionModal={() => {
          if (auth.hasPermission('Recepcion_Rampa')) {
            setReceptionModalOpen(true);
          } else {
            setDeniedTargetModule('Terminal de Recepción en Rampa');
            setDeniedModalOpen(true);
            auth.triggerHaptic('error');
          }
        }}
        onOpenDispatchModal={() => {
          if (auth.hasPermission('Despacho_Taller') || auth.hasPermission('Superadmin')) {
            setDispatchPreselectedItem(null);
            setDispatchModalOpen(true);
          } else {
            setDeniedTargetModule('Terminal de Despacho a Taller');
            setDeniedModalOpen(true);
            auth.triggerHaptic('error');
          }
        }}
        onOpenBOMAuditModal={() => {
          if (auth.hasPermission('Auditoria_Kardex') || auth.hasPermission('Superadmin') || auth.hasPermission('Emitir_OAB')) {
            setBomAuditPreselectedOrder(null);
            setBomAuditModalOpen(true);
          } else {
            setDeniedTargetModule('Auditoría BOM y Balance de Tienda');
            setDeniedModalOpen(true);
            auth.triggerHaptic('error');
          }
        }}
        onOpenAdjustmentModal={() => handleOpenAdjustmentModal(null)}
        onOpenKardexModal={() => {
          if (auth.hasPermission('Auditoria_Kardex')) {
            setKardexTargetMaterial(null);
            setKardexModalOpen(true);
          } else {
            setDeniedTargetModule('Libro Mayor de Almacén (Kardex)');
            setDeniedModalOpen(true);
            auth.triggerHaptic('error');
          }
        }}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        profile={auth.profile}
        onOpenAuditModal={() => setAuditModalOpen(true)}
        onRefreshPermissions={auth.refreshPermissions}
        onChangePin={() => setChangePinModalOpen(true)}
        onLogout={auth.logout}
        isTelegram={auth.isTelegramWebApp}
      />

      {/* Main Container (1600px North Star) */}
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-4 sm:px-6 py-4 space-y-4">
        {/* KPI Cards */}
        <KpiCards
          kpis={activeKpis}
          isFiltered={hasActiveFilters}
          onFilterByStatus={handleFilterByStatusFromKpi}
          selectedStatus={quickFilters.estadoStock}
        />

        {/* Toolbar & FilterBar */}
        <FilterBar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          viewMode={viewMode}
          onSetViewMode={handleSetViewMode}
          allColumns={allColumnsDef}
          visibleColumns={visibleColumns}
          onToggleColumn={handleToggleColumn}
          sortLevels={sortLevels}
          onAddSortLevel={handleAddSortLevel}
          onRemoveSortLevel={handleRemoveSortLevel}
          groupByKey={groupByKey}
          onSetGroupBy={setGroupByKey}
          quickFilters={quickFilters}
          onToggleQuickFilter={handleToggleQuickFilter}
          onResetAll={handleResetAll}
          hasActiveFilters={hasActiveFilters}
          filteredCount={filteredAndSortedItems.length}
          totalCount={items.length}
          onlyDeficit={onlyDeficit}
          onToggleOnlyDeficit={() => setOnlyDeficit(!onlyDeficit)}
          onlyPendingRecount={onlyPendingRecount}
          onToggleOnlyPendingRecount={() => setOnlyPendingRecount(!onlyPendingRecount)}
          pendingRecountCount={pendingRecountCount}
        />

        {/* Inventory Data Table */}
        <InventoryTable
          items={filteredAndSortedItems}
          allColumns={allColumnsDef}
          visibleColumns={visibleColumns}
          sortLevels={sortLevels}
          onToggleSort={handleToggleSort}
          groupByKey={groupByKey}
          selectOrders={selectOrders}
          onAddToDraft={handleAddToDraft}
          onOpenKardexItem={(item) => {
            if (auth.hasPermission('Auditoria_Kardex')) {
              setKardexTargetMaterial({ id: item.id, nombre: item.nombre, stock: item.stockBase });
              setKardexModalOpen(true);
            } else {
              setDeniedTargetModule('Libro Mayor de Almacén (Kardex)');
              setDeniedModalOpen(true);
              auth.triggerHaptic('error');
            }
          }}
          onOpenDispatchItem={(item) => {
            if (auth.hasPermission('Despacho_Taller') || auth.hasPermission('Superadmin')) {
              setDispatchPreselectedItem(item);
              setDispatchModalOpen(true);
            } else {
              setDeniedTargetModule('Terminal de Despacho a Taller');
              setDeniedModalOpen(true);
              auth.triggerHaptic('error');
            }
          }}
          onOpenAdjustmentItem={(item) => handleOpenAdjustmentModal(item)}
          loading={loading}
          loadError={loadError}
          onRetry={handleRefresh}
          onResetFilters={handleResetAll}
        />

        {/* Glossary & Reference */}
        <GlossaryModal lastSyncDisplay={lastSyncDisplay} />
      </main>

      {/* Bandeja Flotante de Requisición OAB (Flujo Acumulativo B2B) */}
      {draftBasket.length > 0 && !supplyModalOpen && (
        <div className="fixed bottom-6 right-6 z-40 no-print">
          <div className="bg-slate-900/95 border border-brand-500/50 backdrop-blur-md rounded-2xl shadow-2xl p-2.5 sm:px-4 sm:py-2.5 flex items-center gap-3 ring-1 ring-brand-500/20">
            <div className="flex items-center gap-2">
              <span className="flex h-3 w-3 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-brand-500"></span>
              </span>
              <span className="text-xs font-semibold text-slate-100">
                🛒 <span className="font-mono text-brand-400 font-bold">{draftBasket.length}</span> {draftBasket.length === 1 ? 'material en solicitud' : 'materiales en solicitud'}
              </span>
            </div>

            <div className="h-4 w-px bg-slate-700"></div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => {
                  setDraftItemsForModal(draftBasket);
                  setSupplyModalOpen(true);
                }}
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-brand-500 hover:bg-brand-400 text-slate-950 transition active:scale-95 shadow-md flex items-center gap-1"
              >
                <span>Crear Requisición (OAB)</span>
                <span className="font-mono text-[10px]">➔</span>
              </button>

              <button
                onClick={() => {
                  setDraftBasket([]);
                  showToast('Bandeja de solicitud vaciada');
                }}
                className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-950/30 rounded-lg transition"
                title="Vaciar bandeja"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notifier Flotante */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-50 no-print">
          <div className="bg-surfaceHigh border border-brand-500/40 text-slate-100 text-xs px-3.5 py-2 rounded-lg shadow-2xl flex items-center gap-2 ring-1 ring-brand-500/20">
            <span className="inline-block w-2 h-2 rounded-full bg-brand-400 animate-pulse"></span>
            <span>{toastMessage}</span>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-borderSubtle py-3 px-4 no-print mt-auto">
        <div className="max-w-[1600px] mx-auto flex flex-wrap items-center justify-between text-xs text-slate-500 gap-2">
          <span>Sanesca Exhibidores C.A. © 2026 · Todos los derechos reservados</span>
          <span className="font-mono">v2.0.0 PRO · Vite + React + Cloudflare Pages Functions</span>
        </div>
      </footer>

      {/* Supply Order Modal (OAB) */}
      {supplyModalOpen && (
        <SupplyOrderModal
          isOpen={supplyModalOpen}
          onClose={() => setSupplyModalOpen(false)}
          inventoryItems={items}
          bcvRate={bcvRate}
          initialDraftItems={draftItemsForModal}
          onOrderCreated={handleOrderCreated}
        />
      )}

      {/* Review & Transcription Modal (Magaly & Compras) */}
      {reviewModalOpen && (
        <OABReviewModal
          isOpen={reviewModalOpen}
          onClose={() => {
            setReviewModalOpen(false);
            setDeepLinkFolio(null);
            if (typeof window !== 'undefined' && window.history?.replaceState) {
              window.history.replaceState({}, '', window.location.pathname);
            }
          }}
          bcvRate={bcvRate}
          initialFolio={deepLinkFolio || undefined}
          onReviewSuccess={handleRefresh}
        />
      )}

      {/* Reception Terminal Modal (Rampa) */}
      {receptionModalOpen && (
        <ReceptionTerminalModal
          isOpen={receptionModalOpen}
          onClose={() => setReceptionModalOpen(false)}
          inventoryItems={items}
          onReceptionSuccess={handleReceptionSuccess}
        />
      )}

      {/* Material Dispatch Modal (Terminal de Despacho a Taller - Fase 9A) */}
      {dispatchModalOpen && (
        <MaterialDispatchModal
          isOpen={dispatchModalOpen}
          onClose={() => {
            setDispatchModalOpen(false);
            setDispatchPreselectedItem(null);
          }}
          inventoryItems={items}
          preselectedItem={dispatchPreselectedItem}
          token={auth.token}
          onDispatchSuccess={(res) => {
            showToast(`📤 Despacho registrado: ${res.cantidad} und de ${res.materialNombre} a ${res.destino}`);
            setItems(prev => prev.map(item => {
              if (item.nombre === res.materialNombre) {
                const updatedStock = res.nuevoStock;
                const updatedDeficit = Math.max(0, item.stockMinimo - updatedStock);
                return {
                  ...item,
                  stockBase: updatedStock,
                  deficit: updatedDeficit,
                  estadoStock: updatedStock === 0 ? 'Sin Stock' : updatedStock < item.stockMinimo ? 'Bajo Mínimo' : 'En Stock'
                };
              }
              return item;
            }));
            handleRefresh();
          }}
        />
      )}

      {/* Kardex Viewer Modal (Libro Mayor Inmutable) */}
      {kardexModalOpen && (
        <KardexViewerModal
          isOpen={kardexModalOpen}
          onClose={() => {
            setKardexModalOpen(false);
            setDeepLinkFolio(null);
            if (typeof window !== 'undefined' && window.history?.replaceState) {
              window.history.replaceState({}, '', window.location.pathname);
            }
          }}
          initialDashboardId={kardexTargetMaterial?.id}
          initialMaterialName={kardexTargetMaterial?.nombre}
          initialSearchTerm={deepLinkFolio || undefined}
          currentStock={kardexTargetMaterial?.stock}
        />
      )}

      {/* Order BOM Audit Modal (Auditoría Ex-Post de Mermas - Fase 9B) */}
      {bomAuditModalOpen && (
        <OrderBOMAuditModal
          isOpen={bomAuditModalOpen}
          onClose={() => {
            setBomAuditModalOpen(false);
            setBomAuditPreselectedOrder(null);
          }}
          initialOrderId={bomAuditPreselectedOrder?.id}
          initialOrderCode={bomAuditPreselectedOrder?.codigo}
          initialOrderName={bomAuditPreselectedOrder?.nombre}
          token={auth.token}
        />
      )}

      {/* PIN Login Modal (Navegador PC) */}
      <PinLoginModal
        isOpen={auth.showPinModal}
        onLogin={auth.loginWithPin}
        onDirectLogin={auth.loginWithCustomSession}
      />

      {/* Access Denied Modal (Zero Trust RBAC Guard) */}
      {(auth.authError || deniedModalOpen) && (
        <AccessDeniedModal
          error={auth.authError || {
            code: 'PERMISSION_REQUIRED',
            message: `Tu puesto de trabajo actual no cuenta con autorización para operar el módulo de ${deniedTargetModule}.`,
            employeeName: auth.profile?.name,
            puestos: auth.profile?.puestos,
            telegramId: typeof auth.profile?.id === 'number' ? auth.profile.id : undefined,
            telegramUsername: auth.profile?.username || undefined
          }}
          targetModule={deniedTargetModule}
          onClose={() => setDeniedModalOpen(false)}
        />
      )}

      {/* Modal de Modificación de PIN */}
      {changePinModalOpen && (
        <ChangePinModal
          isOpen={changePinModalOpen}
          onClose={() => setChangePinModalOpen(false)}
          userName={auth.profile?.name || 'Operador'}
          employeeId={auth.profile?.id}
          isSuperadmin={auth.profile?.permissions.includes('Superadmin')}
        />
      )}

      {/* Visor Forense de Auditoría & Accesos (Superadmin) */}
      {auditModalOpen && (
        <AccessAuditModal
          isOpen={auditModalOpen}
          onClose={() => setAuditModalOpen(false)}
          token={auth.token}
        />
      )}

      {/* Stock Adjustment Modal (Conteo Cíclico & Ajustes - Fase 9F) */}
      {adjustmentModalOpen && (
        <StockAdjustmentModal
          isOpen={adjustmentModalOpen}
          onClose={() => {
            setAdjustmentModalOpen(false);
            setAdjustmentPreselectedItem(null);
          }}
          inventoryItems={items}
          preselectedItem={adjustmentPreselectedItem}
          onAdjustmentSuccess={handleAdjustmentSuccess}
          bcvRate={bcvRate}
          currentUser={auth.profile}
        />
      )}
    </div>
  );
}
