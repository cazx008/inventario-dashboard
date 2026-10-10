import React, { useState, useMemo } from 'react';
import { 
  Building2, 
  Search, 
  X, 
  ArrowRightLeft, 
  Plus, 
  ShieldCheck, 
  RefreshCw, 
  PackageCheck, 
  Truck, 
  Layers, 
  DollarSign, 
  AlertCircle,
  Unlock,
  CheckCircle2,
  SlidersHorizontal,
  Zap,
  Flag,
  Check
} from 'lucide-react';
import { 
  StoreAllocation, 
  ProjectSummary, 
  InsumoSummary, 
  AllocationsResponse,
  reserveStockDirect,
  reassignStoreStock,
  releaseStoreStock,
  liquidateStoreAllocations
} from '../services/inventoryService';
import { InventoryItem } from '../types/inventory';
import { OrderSearchModal } from './OrderSearchModal';
import { OrderReference } from '../types/oab';

interface StoreAllocationModalProps {
  isOpen: boolean;
  onClose: () => void;
  allItems: InventoryItem[];
  allocationsData: AllocationsResponse | null;
  onRefreshAllocations: () => Promise<void>;
  initialSelectedItem?: InventoryItem | null;
  initialSelectedAllocation?: StoreAllocation | null;
  userRole?: string;
  hasPermission?: (permission: string) => boolean;
  triggerHaptic?: (type: 'success' | 'error' | 'warning' | 'light' | 'medium') => void;
}

export const StoreAllocationModal: React.FC<StoreAllocationModalProps> = ({
  isOpen,
  onClose,
  allItems,
  allocationsData,
  onRefreshAllocations,
  initialSelectedItem,
  initialSelectedAllocation,
  triggerHaptic
}) => {
  // Pestaña activa: 'projects' | 'matrix'
  const [activeTab, setActiveTab] = useState<'projects' | 'matrix'>('projects');
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Estados de submodales
  const [directAllocModalOpen, setDirectAllocModalOpen] = useState(false);
  const [targetItemForDirectAlloc, setTargetItemForDirectAlloc] = useState<InventoryItem | null>(initialSelectedItem || null);
  const [targetProjectForDirectAlloc, setTargetProjectForDirectAlloc] = useState<string>('');
  const [targetProjectIdForDirectAlloc, setTargetProjectIdForDirectAlloc] = useState<string>('');
  const [directAllocQty, setDirectAllocQty] = useState<number>(1);
  const [directAllocNotas, setDirectAllocNotas] = useState<string>('');
  const [itemSearchQuery, setItemSearchQuery] = useState('');
  const [isItemDropdownOpen, setIsItemDropdownOpen] = useState(false);

  const [reassignModalOpen, setReassignModalOpen] = useState(false);
  const [targetAllocForReassign, setTargetAllocForReassign] = useState<StoreAllocation | null>(initialSelectedAllocation || null);
  const [reassignDestinoNombre, setReassignDestinoNombre] = useState<string>('');
  const [reassignDestinoId, setReassignDestinoId] = useState<string>('');
  const [reassignQty, setReassignQty] = useState<number>(1);
  const [reassignMotivo, setReassignMotivo] = useState<string>('');
  const [reassignReponerCedente, setReassignReponerCedente] = useState<boolean>(true);

  // Selector Asistido de Obra ERP (OrderSearchModal)
  const [isOrderSearchOpen, setIsOrderSearchOpen] = useState(false);
  const [orderSearchTarget, setOrderSearchTarget] = useState<'direct' | 'reassign'>('direct');

  const [releaseModalOpen, setReleaseModalOpen] = useState(false);
  const [targetAllocForRelease, setTargetAllocForRelease] = useState<StoreAllocation | null>(null);
  const [releaseQty, setReleaseQty] = useState<number>(1);
  const [releaseMotivo, setReleaseMotivo] = useState<string>('Desreserva voluntaria a stock común');

  // Submodal 4: Liquidación Asistida de Obra (Fase 10D / D4-10D, D7-10D)
  const [liquidationModalOpen, setLiquidationModalOpen] = useState(false);
  const [targetProjectForLiquidation, setTargetProjectForLiquidation] = useState<ProjectSummary | null>(null);
  const [liquidationItems, setLiquidationItems] = useState<Array<{
    dashboardId: string;
    insumoNombre: string;
    codigo?: string;
    cantidadApartada: number;
    cantidadLiberar: number;
    unidad?: string;
    selected: boolean;
  }>>([]);
  const [marcarProyectoConcluido, setMarcarProyectoConcluido] = useState(false);
  const [motivoLiquidacion, setMotivoLiquidacion] = useState('Cierre de fabricación de obra y retorno de sobrantes a stock común');

  // Mapas y métricas
  const summaryByProject = allocationsData?.summaryByProyectoId || {};
  const summaryByInsumo = allocationsData?.summaryByDashboardId || {};
  const allAllocations = allocationsData?.allocations || [];
  const allDebts = allocationsData?.debts || [];

  // Lista única de nombres de proyectos conocidos
  const knownProjectNames = useMemo(() => {
    const set = new Set<string>();
    Object.values(summaryByProject).forEach(p => {
      if (p.proyectoNombre && p.proyectoNombre.trim()) {
        set.add(p.proyectoNombre.trim());
      }
    });
    return Array.from(set).sort();
  }, [summaryByProject]);

  // Totales globales
  const globalMetrics = useMemo(() => {
    let totalApartadoGalpon = 0;
    let totalEnTransito = 0;
    let totalUSD = 0;
    const projectSet = new Set<string>();

    allAllocations.forEach(a => {
      totalApartadoGalpon += (a.cantidadApartada || 0);
      totalEnTransito += (a.cantidadTransito || 0);
      totalUSD += ((a.cantidadApartada || 0) * (a.costoUnitarioUSD || 0));
      if (a.proyectoNombre && ((a.cantidadApartada || 0) > 0 || (a.cantidadTransito || 0) > 0)) projectSet.add(a.proyectoNombre);
    });

    return {
      totalObras: projectSet.size,
      totalApartadoGalpon,
      totalEnTransito,
      totalUSD: Math.round(totalUSD * 100) / 100
    };
  }, [allAllocations]);

  // Proyectos filtrados
  const filteredProjects = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const projects = Object.values(summaryByProject);
    if (!q) return projects;

    return projects.filter(p => {
      const matchName = p.proyectoNombre.toLowerCase().includes(q);
      const matchItem = p.items.some(it => 
        it.insumoNombre.toLowerCase().includes(q) || 
        it.codigo?.toLowerCase().includes(q)
      );
      return matchName || matchItem;
    });
  }, [summaryByProject, searchQuery]);

  // Insumos filtrados para la Matriz
  const filteredMatrixItems = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return allItems.filter(item => {
      const sum = summaryByInsumo[item.id];
      const hasAlloc = sum && (sum.totalApartado > 0 || sum.totalTransito > 0);
      if (!hasAlloc && !q) return false; // Por defecto solo insumos con compromisos o los que coincidan con la búsqueda
      
      const matchText = item.nombre.toLowerCase().includes(q) || (item.codigo || '').toLowerCase().includes(q);
      return matchText;
    });
  }, [allItems, summaryByInsumo, searchQuery]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setErrorMessage(null);
    try {
      await onRefreshAllocations();
      triggerHaptic?.('light');
    } catch (e: any) {
      setErrorMessage(e.message || 'Error al actualizar asignaciones');
      triggerHaptic?.('error');
    } finally {
      setRefreshing(false);
    }
  };

  // Insumos filtrados para el Combobox Predictivo de Asignación Directa
  const filteredDirectAllocItems = useMemo(() => {
    const q = itemSearchQuery.toLowerCase().trim();
    if (!q) return allItems.slice(0, 30);
    return allItems.filter(it =>
      it.nombre.toLowerCase().includes(q) ||
      (it.codigo && it.codigo.toLowerCase().includes(q)) ||
      (it.categoriaMaterial && it.categoriaMaterial.toLowerCase().includes(q))
    ).slice(0, 40);
  }, [allItems, itemSearchQuery]);

  const handleSelectOrder = (order: OrderReference) => {
    const displayName = order.proyecto ? `${order.codigo ? order.codigo + ' - ' : ''}${order.proyecto}` : order.codigo;
    if (orderSearchTarget === 'direct') {
      setTargetProjectForDirectAlloc(displayName);
      setTargetProjectIdForDirectAlloc(order.id);
    } else {
      setReassignDestinoNombre(displayName);
      setReassignDestinoId(order.id);
    }
    setIsOrderSearchOpen(false);
    triggerHaptic?.('light');
  };

  // -------------------------------------------------------------
  // HANDLERS DE ACCIÓN
  // -------------------------------------------------------------
  const handleOpenDirectAlloc = (item?: InventoryItem, projNombre?: string, projId?: string) => {
    setTargetItemForDirectAlloc(item || allItems[0] || null);
    setTargetProjectForDirectAlloc(projNombre || '');
    setTargetProjectIdForDirectAlloc(projId || '');
    setItemSearchQuery('');
    setIsItemDropdownOpen(false);
    setDirectAllocQty(1);
    setDirectAllocNotas('');
    setErrorMessage(null);
    setDirectAllocModalOpen(true);
  };

  const handleConfirmDirectAlloc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetItemForDirectAlloc || !targetProjectForDirectAlloc.trim() || directAllocQty <= 0) {
      setErrorMessage('Por favor especifica un material, un proyecto y una cantidad válida.');
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    try {
      await reserveStockDirect({
        dashboardId: targetItemForDirectAlloc.id,
        insumoId: targetItemForDirectAlloc.insumoId || '',
        materialNombre: targetItemForDirectAlloc.nombre,
        codigo: targetItemForDirectAlloc.codigo || '',
        proyectoId: targetProjectIdForDirectAlloc || `proj-${targetProjectForDirectAlloc.toLowerCase().replace(/\s+/g, '-')}`,
        proyectoNombre: targetProjectForDirectAlloc.trim(),
        cantidad: directAllocQty,
        unidad: targetItemForDirectAlloc.unidad || 'Unid.',
        costoUnitarioUSD: targetItemForDirectAlloc.costoUnitarioUSD || 0,
        notas: directAllocNotas
      });

      triggerHaptic?.('success');
      setSuccessMessage(`¡Material apartado con éxito para '${targetProjectForDirectAlloc}'!`);
      setTimeout(() => setSuccessMessage(null), 3500);
      setDirectAllocModalOpen(false);
      await onRefreshAllocations();
    } catch (err: any) {
      setErrorMessage(err.message || 'Error apartando material');
      triggerHaptic?.('error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenReassign = (alloc: StoreAllocation) => {
    setTargetAllocForReassign(alloc);
    setReassignDestinoNombre('');
    setReassignDestinoId('');
    setReassignQty(alloc.cantidadApartada || 1);
    setReassignMotivo('');
    setReassignReponerCedente(true);
    setErrorMessage(null);
    setReassignModalOpen(true);
  };

  const handleConfirmReassign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetAllocForReassign || !reassignDestinoNombre.trim() || reassignQty <= 0 || !reassignMotivo.trim()) {
      setErrorMessage('Especifica la obra destino, cantidad mayor a 0 y un motivo obligatorio de transferencia.');
      return;
    }

    if (reassignQty > (targetAllocForReassign.cantidadApartada || 0)) {
      setErrorMessage(`No puedes reasignar más de ${targetAllocForReassign.cantidadApartada} unidades disponibles en ${targetAllocForReassign.proyectoNombre}.`);
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    try {
      await reassignStoreStock({
        dashboardId: targetAllocForReassign.dashboardId,
        insumoId: targetAllocForReassign.insumoId,
        materialNombre: targetAllocForReassign.insumoNombre,
        origenProyectoId: targetAllocForReassign.proyectoId,
        origenProyectoNombre: targetAllocForReassign.proyectoNombre,
        destinoProyectoId: reassignDestinoId || `proj-${reassignDestinoNombre.toLowerCase().replace(/\s+/g, '-')}`,
        destinoProyectoNombre: reassignDestinoNombre.trim(),
        cantidad: reassignQty,
        motivo: reassignMotivo.trim(),
        reponerCedente: reassignReponerCedente,
        unidad: targetAllocForReassign.unidad || 'Unid.'
      });

      triggerHaptic?.('success');
      setSuccessMessage(`¡Reasignadas ${reassignQty} unds de '${targetAllocForReassign.proyectoNombre}' a '${reassignDestinoNombre}'!`);
      setTimeout(() => setSuccessMessage(null), 3500);
      setReassignModalOpen(false);
      await onRefreshAllocations();
    } catch (err: any) {
      setErrorMessage(err.message || 'Error reasignando existencias');
      triggerHaptic?.('error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenRelease = (alloc: StoreAllocation) => {
    setTargetAllocForRelease(alloc);
    setReleaseQty(alloc.cantidadApartada || 1);
    setReleaseMotivo('Desreserva voluntaria a stock común');
    setErrorMessage(null);
    setReleaseModalOpen(true);
  };

  const handleConfirmRelease = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetAllocForRelease || releaseQty <= 0) return;

    setSubmitting(true);
    setErrorMessage(null);
    try {
      await releaseStoreStock({
        dashboardId: targetAllocForRelease.dashboardId,
        materialNombre: targetAllocForRelease.insumoNombre,
        proyectoId: targetAllocForRelease.proyectoId,
        proyectoNombre: targetAllocForRelease.proyectoNombre,
        cantidad: releaseQty,
        motivo: releaseMotivo,
        unidad: targetAllocForRelease.unidad || 'Unid.'
      });

      triggerHaptic?.('success');
      setSuccessMessage(`¡Liberadas ${releaseQty} unds de '${targetAllocForRelease.proyectoNombre}' a Stock Libre!`);
      setTimeout(() => setSuccessMessage(null), 3500);
      setReleaseModalOpen(false);
      await onRefreshAllocations();
    } catch (err: any) {
      setErrorMessage(err.message || 'Error liberando existencias');
      triggerHaptic?.('error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenLiquidation = (project: ProjectSummary) => {
    setTargetProjectForLiquidation(project);
    const mapped = (project.items || [])
      .filter(it => (it.cantidadApartada || 0) > 0)
      .map(it => ({
        dashboardId: it.dashboardId,
        insumoNombre: it.insumoNombre,
        codigo: it.codigo,
        cantidadApartada: it.cantidadApartada,
        cantidadLiberar: it.cantidadApartada,
        unidad: it.unidad || 'Unid.',
        selected: true
      }));
    setLiquidationItems(mapped);
    setMarcarProyectoConcluido(false);
    setMotivoLiquidacion(`Liquidación de ${project.proyectoNombre} y retorno de sobrantes a stock común`);
    setLiquidationModalOpen(true);
  };

  const handleConfirmLiquidation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetProjectForLiquidation) return;
    const itemsToRelease = liquidationItems
      .filter(it => it.selected && it.cantidadLiberar > 0)
      .map(it => ({
        dashboardId: it.dashboardId,
        materialNombre: it.insumoNombre,
        cantidadLiberar: it.cantidadLiberar
      }));

    if (itemsToRelease.length === 0 && !marcarProyectoConcluido) {
      setErrorMessage('Seleccione al menos un insumo para liberar o marque concluir proyecto.');
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    try {
      await liquidateStoreAllocations({
        proyectoId: targetProjectForLiquidation.proyectoId,
        proyectoNombre: targetProjectForLiquidation.proyectoNombre,
        motivo: motivoLiquidacion,
        itemsToRelease,
        marcarProyectoConcluido
      });

      triggerHaptic?.('success');
      setSuccessMessage(`¡Obra '${targetProjectForLiquidation.proyectoNombre}' liquidada! Sobrantes retornados a Stock Libre.`);
      setTimeout(() => setSuccessMessage(null), 3500);
      setLiquidationModalOpen(false);
      await onRefreshAllocations();
    } catch (err: any) {
      setErrorMessage(err.message || 'Error liquidando obra');
      triggerHaptic?.('error');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-6xl max-h-[95vh] flex flex-col shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ENCABEZADO SUPERIOR */}
        <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-950/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-slate-100">
                  Tablero Panorámico de Asignaciones
                </h2>
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  Edge KV SWR
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Consolidación multitienda, gobernanza de reservas y prevención de quiebres de obra
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white transition disabled:opacity-50"
              title="Refrescar asignaciones en tiempo real"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-amber-400' : ''}`} />
            </button>
            <button
              onClick={() => handleOpenDirectAlloc()}
              className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center gap-1.5 transition active:scale-95 shadow-lg shadow-emerald-950/50"
            >
              <Plus className="w-4 h-4" />
              <span>Apartar Stock Libre</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 hover:text-slate-200 transition"
              title="Cerrar tablero"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* BARRA DE MÉTRICAS GLOBALES */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 sm:px-6 bg-slate-950/60 border-b border-slate-800 text-center text-xs">
          <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800">
            <span className="block text-[10px] text-slate-400 uppercase font-bold flex items-center justify-center gap-1">
              <Building2 className="w-3 h-3 text-amber-400" />
              Obras con Reservas
            </span>
            <span className="text-sm sm:text-base font-mono font-bold text-slate-100">
              {globalMetrics.totalObras} proyectos
            </span>
          </div>

          <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800">
            <span className="block text-[10px] text-amber-400 uppercase font-bold flex items-center justify-center gap-1">
              <PackageCheck className="w-3 h-3 text-emerald-400" />
              Apartado en Galpón
            </span>
            <span className="text-sm sm:text-base font-mono font-bold text-emerald-400">
              {globalMetrics.totalApartadoGalpon} unidades
            </span>
          </div>

          <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800">
            <span className="block text-[10px] text-cyan-400 uppercase font-bold flex items-center justify-center gap-1">
              <Truck className="w-3 h-3 text-cyan-400" />
              En Tránsito (Camión)
            </span>
            <span className="text-sm sm:text-base font-mono font-bold text-cyan-400">
              +{globalMetrics.totalEnTransito} unidades
            </span>
          </div>

          <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800">
            <span className="block text-[10px] text-slate-400 uppercase font-bold flex items-center justify-center gap-1">
              <DollarSign className="w-3 h-3 text-slate-300" />
              Valor Comprometido
            </span>
            <span className="text-sm sm:text-base font-mono font-bold text-slate-200">
              ${globalMetrics.totalUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD
            </span>
          </div>
        </div>

        {/* ALERTAS TEMPORALES */}
        {errorMessage && (
          <div className="mx-4 mt-3 p-3 bg-red-950/70 border border-red-500/40 rounded-xl text-red-200 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}
        {successMessage && (
          <div className="mx-4 mt-3 p-3 bg-emerald-950/70 border border-emerald-500/40 rounded-xl text-emerald-200 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* NAVEGACIÓN DE PESTAÑAS Y BUSCADOR */}
        <div className="px-4 sm:px-6 pt-3 pb-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-b border-slate-800">
          <div className="flex items-center gap-1 bg-slate-950/80 p-1 rounded-xl border border-slate-800 shrink-0">
            <button
              onClick={() => setActiveTab('projects')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                activeTab === 'projects'
                  ? 'bg-amber-500 text-slate-950 shadow-md font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>Por Proyectos / Tiendas ({Object.keys(summaryByProject).length})</span>
            </button>
            <button
              onClick={() => setActiveTab('matrix')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                activeTab === 'matrix'
                  ? 'bg-amber-500 text-slate-950 shadow-md font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Matriz Consolidada de Insumos</span>
            </button>
          </div>

          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por obra, tienda, insumo o código..."
              className="w-full pl-9 pr-3 py-1.5 bg-slate-950/60 border border-slate-800 focus:border-amber-500/60 rounded-xl text-xs text-slate-200 placeholder-slate-500 outline-none transition"
            />
          </div>
        </div>

        {/* CONTENIDO INTERNO */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 scrollbar-thin">
          {/* ========================================================= */}
          {/* PESTAÑA 1: VISTA POR PROYECTOS / TIENDAS (CARDS) */}
          {/* ========================================================= */}
          {activeTab === 'projects' && (
            <div className="space-y-4">
              {filteredProjects.length === 0 ? (
                <div className="text-center py-12 bg-slate-950/40 rounded-2xl border border-dashed border-slate-800">
                  <Building2 className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                  <p className="text-slate-400 text-sm font-semibold">No se encontraron proyectos con asignaciones activas</p>
                  <p className="text-slate-500 text-xs mt-1">Puedes apartar existencias libres usando el botón '+ Apartar Stock Libre'</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {filteredProjects.map((project) => {
                    const totalGalpon = project.items.reduce((acc, it) => acc + (it.cantidadApartada || 0), 0);
                    const totalTransito = project.items.reduce((acc, it) => acc + (it.cantidadTransito || 0), 0);

                    // Deudas operativas y préstamos activos (D6-10D)
                    const debtsAsCedente = allDebts.filter((d: any) => 
                      (d.acreedorProyectoNombre?.toLowerCase() === project.proyectoNombre?.toLowerCase() || 
                       d.acreedorProyectoId === project.proyectoId) && 
                      d.estado !== 'Saldada'
                    );
                    const debtsAsDeudor = allDebts.filter((d: any) => 
                      (d.deudorProyectoNombre?.toLowerCase() === project.proyectoNombre?.toLowerCase() || 
                       d.deudorProyectoId === project.proyectoId) && 
                      d.estado !== 'Saldada'
                    );
                    const totalCedido = debtsAsCedente.reduce((acc: number, d: any) => acc + (Number(d.cantidadDeuda) || 0), 0);
                    const totalRecibido = debtsAsDeudor.reduce((acc: number, d: any) => acc + (Number(d.cantidadDeuda) || 0), 0);

                    return (
                      <div 
                        key={project.proyectoId}
                        className="bg-slate-950/60 border border-slate-800/90 rounded-2xl p-4 flex flex-col justify-between hover:border-slate-700 transition shadow-lg"
                      >
                        <div>
                          {/* Encabezado Tarjeta de Obra */}
                          <div className="flex items-start justify-between gap-2 border-b border-slate-800/80 pb-3 mb-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-slate-100 text-sm sm:text-base">
                                  {project.proyectoNombre}
                                </span>
                              </div>
                              <span className="text-[10px] font-mono text-slate-500">
                                {project.items.length} materiales comprometidos
                              </span>
                            </div>

                            <div className="text-right">
                              <span className="text-xs font-mono font-bold text-slate-200 block">
                                ${project.totalUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                              </span>
                              <span className="text-[9px] text-slate-500 uppercase font-semibold">Comprometido</span>
                            </div>
                          </div>

                          {/* Insignias de Préstamo / Emergencia (D6-10D) */}
                          {totalCedido > 0 && (
                            <div className="mb-2.5 px-2.5 py-1.5 rounded-xl bg-amber-950/50 border border-amber-500/40 flex items-center justify-between text-[11px] text-amber-200 shadow-sm animate-in fade-in">
                              <span className="flex items-center gap-1.5 font-semibold">
                                <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                <span>⚠️ Stock Cedido por Emergencia: <strong className="font-mono text-amber-300">{totalCedido} un.</strong></span>
                              </span>
                              <span className="text-[9px] bg-amber-500/20 text-amber-300 font-mono px-1.5 py-0.5 rounded border border-amber-500/30">
                                Reposición OAB en curso
                              </span>
                            </div>
                          )}

                          {totalRecibido > 0 && (
                            <div className="mb-2.5 px-2.5 py-1.5 rounded-xl bg-blue-950/50 border border-blue-500/40 flex items-center justify-between text-[11px] text-blue-200 shadow-sm animate-in fade-in">
                              <span className="flex items-center gap-1.5 font-semibold">
                                <Zap className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                                <span>⚡ Stock Recibido en Préstamo: <strong className="font-mono text-blue-300">{totalRecibido} un.</strong></span>
                              </span>
                              <span className="text-[9px] bg-blue-500/20 text-blue-300 font-mono px-1.5 py-0.5 rounded border border-blue-500/30">
                                Deuda Operativa
                              </span>
                            </div>
                          )}

                          {/* Balances de la Obra */}
                          <div className="grid grid-cols-2 gap-2 mb-3 bg-slate-900/60 p-2 rounded-xl text-center text-xs border border-slate-800/60">
                            <div>
                              <span className="block text-[9px] text-emerald-400 font-bold uppercase">En Galpón</span>
                              <span className="font-mono font-bold text-emerald-400 text-sm">{totalGalpon} un.</span>
                            </div>
                            <div>
                              <span className="block text-[9px] text-cyan-400 font-bold uppercase">En Tránsito</span>
                              <span className="font-mono font-bold text-cyan-400 text-sm">+{totalTransito} un.</span>
                            </div>
                          </div>

                          {/* Tabla compacta de materiales */}
                          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 scrollbar-thin mb-3">
                            {project.items.map((alloc) => (
                              <div
                                key={alloc.id}
                                className="bg-slate-900/40 border border-slate-800 rounded-lg p-2 flex items-center justify-between text-xs hover:bg-slate-900/80 transition"
                              >
                                <div className="min-w-0 pr-2">
                                  <div className="font-semibold text-slate-200 truncate text-[11px]" title={alloc.insumoNombre}>
                                    {alloc.insumoNombre}
                                  </div>
                                  <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400">
                                    {alloc.codigo && <span>[{alloc.codigo}]</span>}
                                    <span className="text-emerald-400 font-semibold">{alloc.cantidadApartada} {alloc.unidad || 'un.'} en piso</span>
                                    {(alloc.cantidadTransito || 0) > 0 && (
                                      <span className="text-cyan-400 font-semibold">+{alloc.cantidadTransito} camión</span>
                                    )}
                                  </div>
                                </div>

                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    onClick={() => handleOpenReassign(alloc)}
                                    className="p-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[10px] font-semibold flex items-center gap-1 transition active:scale-95"
                                    title={`Reasignar ${alloc.insumoNombre} a otra tienda`}
                                  >
                                    <ArrowRightLeft className="w-3 h-3" />
                                    <span className="hidden sm:inline">Reasignar</span>
                                  </button>

                                  <button
                                    onClick={() => handleOpenRelease(alloc)}
                                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700 text-[10px] font-semibold transition active:scale-95"
                                    title="Liberar a stock común libre"
                                  >
                                    <Unlock className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Footer Tarjeta: Acciones Rápidas */}
                        <div className="pt-2 border-t border-slate-800/80 flex items-center gap-2">
                          <button
                            onClick={() => handleOpenDirectAlloc(undefined, project.proyectoNombre)}
                            className="flex-1 py-2 px-3 rounded-xl bg-slate-900 hover:bg-slate-850 border border-slate-700/80 text-amber-400 hover:text-amber-300 font-semibold text-xs flex items-center justify-center gap-1.5 transition active:scale-95"
                            title={`Apartar existencias libres de almacén para ${project.proyectoNombre}`}
                          >
                            <Plus className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">Apartar Stock Libre</span>
                          </button>

                          <button
                            onClick={() => handleOpenLiquidation(project)}
                            disabled={totalGalpon <= 0}
                            className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition active:scale-95 shrink-0 ${
                              totalGalpon > 0
                                ? 'bg-red-950/40 hover:bg-red-900/60 border-red-500/40 text-red-300 hover:text-red-200'
                                : 'bg-slate-900/40 border-slate-800 text-slate-500 cursor-not-allowed opacity-60'
                            }`}
                            title={totalGalpon > 0 ? `Liquidar obra ${project.proyectoNombre} y retornar sobrantes a stock libre` : 'Sin material apartado en galpón para liquidar'}
                          >
                            <Flag className="w-3.5 h-3.5 shrink-0" />
                            <span>Liquidar Obra</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ========================================================= */}
          {/* PESTAÑA 2: MATRIZ CONSOLIDADA DE INSUMOS */}
          {/* ========================================================= */}
          {activeTab === 'matrix' && (
            <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-950/60 shadow-xl">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-900/90 border-b border-slate-800 text-[10px] text-slate-400 uppercase font-bold tracking-wider">
                    <th className="p-3">Material / Código</th>
                    <th className="p-3 text-right">Físico en Galpón</th>
                    <th className="p-3 text-right text-amber-400">Apartado Obras</th>
                    <th className="p-3 text-right text-emerald-400">Disponible Libre</th>
                    <th className="p-3 text-right text-cyan-400">En Tránsito</th>
                    <th className="p-3">Obras Asignadas</th>
                    <th className="p-3 text-center">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {filteredMatrixItems.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-slate-500 font-semibold">
                        No se encontraron insumos coincidentes.
                      </td>
                    </tr>
                  ) : (
                    filteredMatrixItems.map(item => {
                      const sum = summaryByInsumo[item.id];
                      const totalApartado = sum?.totalApartado || 0;
                      const totalTransito = sum?.totalTransito || 0;
                      const libre = Math.max(0, (item.stockBase || 0) - totalApartado);
                      const desglose = sum?.desglose || [];

                      return (
                        <tr key={item.id} className="hover:bg-slate-900/40 transition">
                          <td className="p-3">
                            <span className="font-semibold text-slate-100 block text-[11px]">{item.nombre}</span>
                            <span className="font-mono text-slate-500 text-[9px]">{item.codigo || '—'}</span>
                          </td>
                          <td className="p-3 text-right font-mono font-bold text-slate-200">
                            {item.stockBase}
                          </td>
                          <td className="p-3 text-right font-mono font-bold text-amber-400">
                            {totalApartado}
                          </td>
                          <td className="p-3 text-right font-mono font-bold">
                            <span className={libre === 0 ? 'text-red-400' : 'text-emerald-400'}>
                              {libre}
                            </span>
                          </td>
                          <td className="p-3 text-right font-mono font-bold text-cyan-400">
                            {totalTransito > 0 ? `+${totalTransito}` : '0'}
                          </td>
                          <td className="p-3">
                            {desglose.length === 0 ? (
                              <span className="text-slate-600 font-mono text-[10px]">Sin reservas</span>
                            ) : (
                              <div className="flex flex-wrap gap-1 max-w-xs">
                                {desglose.map(alloc => (
                                  <span 
                                    key={alloc.id} 
                                    className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700/60 text-[9px] font-mono text-slate-300"
                                    title={`${alloc.cantidadApartada} en galpón (+${alloc.cantidadTransito || 0} tránsito)`}
                                  >
                                    <strong className="text-amber-400">{alloc.cantidadApartada}</strong> → {alloc.proyectoNombre}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="p-3 text-center">
                            <button
                              onClick={() => handleOpenDirectAlloc(item)}
                              disabled={libre <= 0}
                              className={`px-2 py-1 rounded-lg text-[10px] font-semibold flex items-center gap-1 mx-auto transition ${
                                libre > 0
                                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm active:scale-95'
                                  : 'bg-slate-800 text-slate-600 cursor-not-allowed border border-slate-700/40'
                              }`}
                              title={libre > 0 ? 'Apartar material disponible libre' : 'Sin stock libre para apartar'}
                            >
                              <Plus className="w-3 h-3" />
                              <span>Apartar</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ========================================================= */}
        {/* SUBMODAL 1: ASIGNACIÓN DIRECTA DESDE STOCK LIBRE */}
        {/* ========================================================= */}
        {directAllocModalOpen && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-3 bg-slate-950/80 backdrop-blur-md">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-5 shadow-2xl animate-in zoom-in-95">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
                <div className="flex items-center gap-2 text-emerald-400">
                  <PackageCheck className="w-5 h-5" />
                  <h3 className="font-bold text-sm text-slate-100">Asignar Stock Libre a Obra (MTO)</h3>
                </div>
                <button 
                  onClick={() => setDirectAllocModalOpen(false)}
                  className="text-slate-400 hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleConfirmDirectAlloc} className="space-y-4 text-xs">
                {/* Selector de Insumo con Combobox Predictivo Reactivo */}
                <div className="relative">
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Material / Insumo
                  </label>

                  {/* Chip de Insumo Seleccionado Actual */}
                  {targetItemForDirectAlloc && (
                    <div className="mb-2 p-2.5 bg-slate-950 border border-emerald-500/40 rounded-xl flex items-center justify-between shadow-sm">
                      <div className="min-w-0 pr-2">
                        <div className="font-semibold text-slate-100 text-xs truncate">
                          {targetItemForDirectAlloc.nombre}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-400 font-mono">
                          <span>{targetItemForDirectAlloc.codigo || 'S/C'}</span>
                          <span>•</span>
                          <span>{targetItemForDirectAlloc.categoriaMaterial || 'Insumo'}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          {Math.max(0, (targetItemForDirectAlloc.stockBase || 0) - (summaryByInsumo[targetItemForDirectAlloc.id]?.totalApartado || 0))} {targetItemForDirectAlloc.unidad || 'un.'} libres
                        </span>
                        <div className="text-[9px] text-slate-500 font-mono mt-0.5">
                          Físico: {targetItemForDirectAlloc.stockBase || 0}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Buscador Reactivo con Dropdown */}
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="🔍 Buscar material por nombre, SKU o categoría..."
                      value={itemSearchQuery}
                      onChange={(e) => {
                        setItemSearchQuery(e.target.value);
                        setIsItemDropdownOpen(true);
                      }}
                      onFocus={() => setIsItemDropdownOpen(true)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && filteredDirectAllocItems.length > 0) {
                          e.preventDefault();
                          setTargetItemForDirectAlloc(filteredDirectAllocItems[0]);
                          setItemSearchQuery('');
                          setIsItemDropdownOpen(false);
                        } else if (e.key === 'Escape') {
                          setIsItemDropdownOpen(false);
                        }
                      }}
                      className="w-full pl-8 pr-7 py-2 bg-slate-950 border border-slate-700 rounded-xl text-slate-200 placeholder-slate-500 text-xs outline-none focus:border-emerald-500"
                    />
                    {itemSearchQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setItemSearchQuery('');
                          setIsItemDropdownOpen(false);
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-0.5"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {/* Dropdown Predictivo Flotante */}
                  {isItemDropdownOpen && (
                    <div className="absolute left-0 right-0 top-full mt-1.5 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-40 max-h-52 overflow-y-auto divide-y divide-slate-800">
                      <div className="px-3 py-1 bg-slate-950 text-[10px] uppercase font-mono text-slate-400 flex items-center justify-between">
                        <span>Coincidencias ({filteredDirectAllocItems.length})</span>
                        <span className="text-emerald-400 font-bold">↵ Enter para seleccionar</span>
                      </div>
                      {filteredDirectAllocItems.length === 0 ? (
                        <div className="p-3 text-center text-slate-500 text-xs">
                          No se encontraron insumos coincidentes
                        </div>
                      ) : (
                        filteredDirectAllocItems.map((it) => {
                          const totalApartado = summaryByInsumo[it.id]?.totalApartado || 0;
                          const libre = Math.max(0, (it.stockBase || 0) - totalApartado);
                          const isSelected = targetItemForDirectAlloc?.id === it.id;

                          return (
                            <button
                              key={it.id}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                setTargetItemForDirectAlloc(it);
                                setItemSearchQuery('');
                                setIsItemDropdownOpen(false);
                              }}
                              className={`w-full text-left p-2 flex items-center justify-between hover:bg-slate-800 transition ${
                                isSelected ? 'bg-emerald-950/40 border-l-2 border-emerald-500' : ''
                              }`}
                            >
                              <div className="min-w-0 pr-2">
                                <div className="font-semibold text-slate-200 text-xs truncate">
                                  {it.nombre}
                                </div>
                                <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono">
                                  <span>{it.codigo || 'S/C'}</span>
                                  <span>•</span>
                                  <span>{it.categoriaMaterial || 'Insumo'}</span>
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                                  libre > 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                                }`}>
                                  {libre} libres
                                </span>
                                <div className="text-[9px] text-slate-500 font-mono mt-0.5">
                                  Físico: {it.stockBase}
                                </div>
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>

                {/* Proyecto Destino */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-semibold text-slate-300">
                      Obra / Tienda Destino
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setOrderSearchTarget('direct');
                        setIsOrderSearchOpen(true);
                      }}
                      className="text-[10px] text-emerald-400 hover:text-emerald-300 font-semibold flex items-center gap-1 hover:underline"
                    >
                      <Building2 className="w-3 h-3" />
                      Buscar en ERP
                    </button>
                  </div>
                  <input
                    type="text"
                    list="known-projects-list"
                    value={targetProjectForDirectAlloc}
                    onChange={(e) => {
                      setTargetProjectForDirectAlloc(e.target.value);
                      setTargetProjectIdForDirectAlloc('');
                    }}
                    placeholder="Ej: Tienda Las Mercedes, SHOE BOX..."
                    required
                    className="w-full p-2 bg-slate-950 border border-slate-700 rounded-xl text-slate-200 outline-none focus:border-emerald-500"
                  />
                  <datalist id="known-projects-list">
                    {knownProjectNames.map(name => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </div>

                {/* Cantidad */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Cantidad a Apartar
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={(() => {
                        if (!targetItemForDirectAlloc) return 1;
                        const ap = summaryByInsumo[targetItemForDirectAlloc.id]?.totalApartado || 0;
                        return Math.max(1, (targetItemForDirectAlloc.stockBase || 0) - ap);
                      })()}
                      value={directAllocQty}
                      onChange={(e) => setDirectAllocQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      required
                      className="w-28 p-2 font-mono font-bold bg-slate-950 border border-slate-700 rounded-xl text-slate-100 outline-none focus:border-emerald-500 text-center"
                    />
                    <span className="text-slate-400 font-mono">
                      {targetItemForDirectAlloc?.unidad || 'Unid.'}
                    </span>
                  </div>
                </div>

                {/* Justificación / Notas */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Propósito / Observaciones
                  </label>
                  <input
                    type="text"
                    value={directAllocNotas}
                    onChange={(e) => setDirectAllocNotas(e.target.value)}
                    placeholder="Motivo de la reserva o etapa de ensamblaje..."
                    className="w-full p-2 bg-slate-950 border border-slate-700 rounded-xl text-slate-200 outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setDirectAllocModalOpen(false)}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-1.5 shadow-lg active:scale-95 disabled:opacity-50"
                  >
                    {submitting ? 'Reservando...' : 'Confirmar Reserva'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* SUBMODAL 2: REASIGNACIÓN FORMAL (TIENDA A -> TIENDA B) */}
        {/* ========================================================= */}
        {reassignModalOpen && targetAllocForReassign && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-3 bg-slate-950/80 backdrop-blur-md">
            <div className="bg-slate-900 border border-amber-500/40 rounded-2xl w-full max-w-md p-5 shadow-2xl animate-in zoom-in-95">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
                <div className="flex items-center gap-2 text-amber-400">
                  <ArrowRightLeft className="w-5 h-5" />
                  <h3 className="font-bold text-sm text-slate-100">Reasignar Material entre Obras</h3>
                </div>
                <button 
                  onClick={() => setReassignModalOpen(false)}
                  className="text-slate-400 hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleConfirmReassign} className="space-y-4 text-xs">
                {/* Resumen Insumo y Origen */}
                <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 space-y-1">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Insumo a Transferir</span>
                  <div className="font-bold text-slate-100">{targetAllocForReassign.insumoNombre}</div>
                  <div className="flex items-center justify-between text-[11px] text-amber-300 pt-1">
                    <span>Obra Cedente: <strong>{targetAllocForReassign.proyectoNombre}</strong></span>
                    <span className="font-mono">Disponible: {targetAllocForReassign.cantidadApartada} {targetAllocForReassign.unidad || 'un.'}</span>
                  </div>
                </div>

                {/* Obra Destino */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-semibold text-slate-300">
                      Obra / Tienda Receptora (Destino)
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setOrderSearchTarget('reassign');
                        setIsOrderSearchOpen(true);
                      }}
                      className="text-[10px] text-amber-400 hover:text-amber-300 font-semibold flex items-center gap-1 hover:underline"
                    >
                      <Building2 className="w-3 h-3" />
                      Buscar en ERP
                    </button>
                  </div>
                  <input
                    type="text"
                    list="known-projects-reassign"
                    value={reassignDestinoNombre}
                    onChange={(e) => {
                      setReassignDestinoNombre(e.target.value);
                      setReassignDestinoId('');
                    }}
                    placeholder="Selecciona o escribe el proyecto destino..."
                    required
                    className="w-full p-2 bg-slate-950 border border-slate-700 rounded-xl text-slate-200 outline-none focus:border-amber-500"
                  />
                  <datalist id="known-projects-reassign">
                    {knownProjectNames
                      .filter(n => n.toLowerCase() !== targetAllocForReassign.proyectoNombre.toLowerCase())
                      .map(name => (
                        <option key={name} value={name} />
                      ))}
                  </datalist>
                </div>

                {/* Cantidad a Reasignar */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Cantidad a Transferir
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={targetAllocForReassign.cantidadApartada}
                      value={reassignQty}
                      onChange={(e) => setReassignQty(Math.min(targetAllocForReassign.cantidadApartada, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                      required
                      className="w-28 p-2 font-mono font-bold bg-slate-950 border border-slate-700 rounded-xl text-slate-100 outline-none focus:border-amber-500 text-center"
                    />
                    <span className="text-slate-400 font-mono">
                      de {targetAllocForReassign.cantidadApartada} {targetAllocForReassign.unidad || 'un.'}
                    </span>
                  </div>
                </div>

                {/* Motivo Obligatorio */}
                <div>
                  <label className="block text-[11px] font-semibold text-amber-300 mb-1">
                    Motivo Obligatorio de Reasignación *
                  </label>
                  <input
                    type="text"
                    value={reassignMotivo}
                    onChange={(e) => setReassignMotivo(e.target.value)}
                    placeholder="Ej: Entrega urgente de Tienda B adelantada por cliente..."
                    required
                    className="w-full p-2 bg-slate-950 border border-amber-500/40 rounded-xl text-slate-200 outline-none focus:border-amber-500"
                  />
                </div>

                {/* Switch de Reposición Urgente para la tienda cedente (Decisión D3-10C) */}
                <div className="bg-amber-950/30 border border-amber-500/30 p-3 rounded-xl flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    id="reponer-switch"
                    checked={reassignReponerCedente}
                    onChange={(e) => setReassignReponerCedente(e.target.checked)}
                    className="mt-0.5 rounded text-amber-500 focus:ring-amber-500"
                  />
                  <label htmlFor="reponer-switch" className="cursor-pointer select-none">
                    <span className="font-bold text-amber-300 block text-[11px]">
                      Generar Solicitud de Reposición Urgente para {targetAllocForReassign.proyectoNombre}
                    </span>
                    <span className="text-[10px] text-slate-400 block mt-0.5">
                      Crea automáticamente un requerimiento en Compras (OAB) para reponer estas {reassignQty} unidades y evitar desabastecimiento.
                    </span>
                  </label>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setReassignModalOpen(false)}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold flex items-center gap-1.5 shadow-lg active:scale-95 disabled:opacity-50"
                  >
                    {submitting ? 'Reasignando...' : 'Confirmar Transferencia'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* SUBMODAL 3: LIBERACIÓN DE MATERIAL A STOCK LIBRE */}
        {/* ========================================================= */}
        {releaseModalOpen && targetAllocForRelease && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-3 bg-slate-950/80 backdrop-blur-md">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm p-5 shadow-2xl animate-in zoom-in-95">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
                <div className="flex items-center gap-2 text-slate-300">
                  <Unlock className="w-5 h-5 text-amber-400" />
                  <h3 className="font-bold text-sm text-slate-100">Liberar a Stock Libre</h3>
                </div>
                <button 
                  onClick={() => setReleaseModalOpen(false)}
                  className="text-slate-400 hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleConfirmRelease} className="space-y-4 text-xs">
                <p className="text-slate-300">
                  ¿Deseas desreservar existencias de <strong>{targetAllocForRelease.proyectoNombre}</strong> y devolverlas al inventario general libre?
                </p>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                    Cantidad a Liberar
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={targetAllocForRelease.cantidadApartada}
                    value={releaseQty}
                    onChange={(e) => setReleaseQty(Math.min(targetAllocForRelease.cantidadApartada, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                    required
                    className="w-28 p-2 font-mono font-bold bg-slate-950 border border-slate-700 rounded-xl text-slate-100 outline-none text-center"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                    Motivo
                  </label>
                  <input
                    type="text"
                    value={releaseMotivo}
                    onChange={(e) => setReleaseMotivo(e.target.value)}
                    className="w-full p-2 bg-slate-950 border border-slate-700 rounded-xl text-slate-200 outline-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setReleaseModalOpen(false)}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
                  >
                    {submitting ? 'Liberando...' : 'Liberar a Libre'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* SUBMODAL 4: LIQUIDACIÓN ASISTIDA DE OBRA Y SOBRANTES (D4-10D, D7-10D) */}
        {/* ========================================================= */}
        {liquidationModalOpen && targetProjectForLiquidation && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-3 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-150">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg p-5 shadow-2xl animate-in zoom-in-95 flex flex-col max-h-[90vh]">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4 shrink-0">
                <div className="flex items-center gap-2.5 text-red-400">
                  <div className="p-2 rounded-xl bg-red-950/60 border border-red-500/40">
                    <Flag className="w-5 h-5 text-red-400" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                      <span>Liquidar Obra & Liberar Sobrantes</span>
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Obra: <strong className="text-amber-400">{targetProjectForLiquidation.proyectoNombre}</strong>
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => setLiquidationModalOpen(false)}
                  className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800 transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Form Content */}
              <form onSubmit={handleConfirmLiquidation} className="space-y-4 text-xs flex-1 overflow-y-auto pr-1 scrollbar-thin">
                <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl text-slate-300 space-y-1">
                  <p className="font-semibold text-slate-200">
                    Desreserva asistida de insumos remanentes:
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Selecciona los materiales que no fueron consumidos en taller para devolverlos al inventario libre con asiento formal en Kardex.
                  </p>
                </div>

                {/* Lista de insumos con checklist y cantidades editables */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 px-1">
                    <span>Materiales apartados en galpón</span>
                    <span>A devolver al Stock Libre</span>
                  </div>

                  {liquidationItems.length === 0 ? (
                    <div className="p-4 text-center text-slate-500 border border-dashed border-slate-800 rounded-xl">
                      Esta obra no tiene insumos físicos apartados actualmente.
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-56 overflow-y-auto pr-1 scrollbar-thin">
                      {liquidationItems.map((item, idx) => (
                        <div 
                          key={item.dashboardId}
                          className={`p-2.5 rounded-xl border transition flex items-center justify-between gap-3 ${
                            item.selected 
                              ? 'bg-slate-950/80 border-slate-700' 
                              : 'bg-slate-950/30 border-slate-850 opacity-60'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <input
                              type="checkbox"
                              checked={item.selected}
                              onChange={(e) => {
                                const updated = [...liquidationItems];
                                updated[idx].selected = e.target.checked;
                                setLiquidationItems(updated);
                              }}
                              className="rounded text-amber-500 focus:ring-amber-500 shrink-0"
                            />
                            <div className="min-w-0">
                              <span className="font-semibold text-slate-200 block truncate text-[11px]">
                                {item.insumoNombre}
                              </span>
                              <span className="text-[10px] text-slate-500 font-mono">
                                {item.codigo ? `[${item.codigo}] · ` : ''}
                                Apartado: <strong className="text-amber-400">{item.cantidadApartada} {item.unidad}</strong>
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <input
                              type="number"
                              min={0}
                              max={item.cantidadApartada}
                              disabled={!item.selected}
                              value={item.cantidadLiberar}
                              onChange={(e) => {
                                const val = Math.min(item.cantidadApartada, Math.max(0, parseInt(e.target.value, 10) || 0));
                                const updated = [...liquidationItems];
                                updated[idx].cantidadLiberar = val;
                                setLiquidationItems(updated);
                              }}
                              className="w-18 p-1.5 font-mono font-bold bg-slate-900 border border-slate-700 rounded-lg text-slate-100 text-center outline-none focus:border-amber-500 disabled:opacity-40"
                            />
                            <span className="text-[11px] text-slate-400 font-mono">{item.unidad}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Motivo de Liquidación */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Glosa / Motivo de Liquidación *
                  </label>
                  <input
                    type="text"
                    value={motivoLiquidacion}
                    onChange={(e) => setMotivoLiquidacion(e.target.value)}
                    required
                    placeholder="Ej: Cierre de obra y retorno de sobrantes..."
                    className="w-full p-2 bg-slate-950 border border-slate-700 rounded-xl text-slate-200 outline-none focus:border-amber-500 text-xs"
                  />
                </div>

                {/* Switch Cierre de Obra ERP (Decisión D7-10D) */}
                <div className="bg-slate-950/70 border border-slate-800 p-3 rounded-xl flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    id="concluir-obra-switch"
                    checked={marcarProyectoConcluido}
                    onChange={(e) => setMarcarProyectoConcluido(e.target.checked)}
                    className="mt-0.5 rounded text-amber-500 focus:ring-amber-500 shrink-0"
                  />
                  <label htmlFor="concluir-obra-switch" className="cursor-pointer select-none">
                    <span className="font-bold text-slate-200 block text-[11px]">
                      Actualizar estado de obra a 'Concluido' en BD_Proyectos de Notion
                    </span>
                    <span className="text-[10px] text-slate-400 block mt-0.5">
                      Cambia el estado de la obra a Concluido en el ERP para cerrar formalmente la cuenta analítica y la orden de fabricación.
                    </span>
                  </label>
                </div>

                {/* Acciones */}
                <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800 shrink-0">
                  <button
                    type="button"
                    onClick={() => setLiquidationModalOpen(false)}
                    className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300 font-semibold"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold flex items-center gap-1.5 shadow-lg active:scale-95 disabled:opacity-50 transition"
                  >
                    {submitting ? 'Liquidando...' : 'Confirmar Liquidación'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal de Búsqueda Asistida de Órdenes y Obras ERP */}
        {isOrderSearchOpen && (
          <OrderSearchModal
            isOpen={isOrderSearchOpen}
            onClose={() => setIsOrderSearchOpen(false)}
            onSelectOrder={handleSelectOrder}
            selectedOrderId={orderSearchTarget === 'direct' ? targetProjectIdForDirectAlloc : reassignDestinoId}
          />
        )}

      </div>
    </div>
  );
};
