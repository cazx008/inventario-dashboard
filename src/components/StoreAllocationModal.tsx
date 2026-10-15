import React, { useState, useMemo, useEffect } from 'react';
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
  Check,
  Printer,
  ArrowUpRight,
  LayoutGrid,
  List,
  Maximize2,
  QrCode,
  Boxes,
  ExternalLink,
  Eye
} from 'lucide-react';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
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
import { ProjectLabelItem } from './PrintSheetProjectLabels';

export interface DirectoryBultoItem {
  id: string;
  allocId: string;
  dashboardId: string;
  insumoId?: string;
  insumoNombre: string;
  codigo?: string;
  categoria?: string;
  proyectoId: string;
  proyectoNombre: string;
  pedidoId?: string;
  pedidoCodigo?: string;
  folioOAB: string;
  bultoIndex: number;
  totalBultos: number;
  cantBulto: number;
  unidadMedida: string;
  isPico: boolean;
  pkgId: string;
  qrPayload: string;
  rawAlloc: StoreAllocation;
  matchingItem?: InventoryItem;
}

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
  onReprintLabel?: (item: ProjectLabelItem) => void;
  onDispatchAlloc?: (alloc: StoreAllocation, item?: InventoryItem) => void;
  onOpenBultoModal?: (bultoData: any) => void;
}

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

export const StoreAllocationModal: React.FC<StoreAllocationModalProps> = ({
  isOpen,
  onClose,
  allItems,
  allocationsData,
  onRefreshAllocations,
  initialSelectedItem,
  initialSelectedAllocation,
  triggerHaptic,
  onReprintLabel,
  onDispatchAlloc,
  onOpenBultoModal
}) => {
  // Pestaña activa: 'projects' | 'matrix' | 'bultos' (PLAN-009)
  const [activeTab, setActiveTab] = useState<'projects' | 'matrix' | 'bultos'>('projects');
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Estados de la Pestaña Bultos & QR (PLAN-009)
  const [bultosViewMode, setBultosViewMode] = useState<'grid' | 'table'>('grid');
  const [bultosProjectFilter, setBultosProjectFilter] = useState<string>('all');
  const [selectedBultoForDetail, setSelectedBultoForDetail] = useState<DirectoryBultoItem | null>(null);
  const [bultoQrMap, setBultoQrMap] = useState<Record<string, string>>({});
  const [detailQrDataUrl, setDetailQrDataUrl] = useState<string | null>(null);
  const [detailBarcodeDataUrl, setDetailBarcodeDataUrl] = useState<string | null>(null);

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

  // -------------------------------------------------------------
  // PLAN-009: DERIVACIÓN REACTIVA DE BULTOS FÍSICOS EN GALPÓN
  // -------------------------------------------------------------
  const allDirectoryBultos = useMemo<DirectoryBultoItem[]>(() => {
    const origin = 'https://sanesca-inventario.pages.dev';
    const list: DirectoryBultoItem[] = [];

    // Solo asignaciones activas con stock físico apartado en galpón (> 0)
    const activeAllocations = allAllocations.filter(a => 
      (a.cantidadApartada || 0) > 0 && a.estado !== 'CONCLUIDA'
    );

    activeAllocations.forEach(alloc => {
      const matchingItem = allItems.find(it => 
        it.id === alloc.dashboardId || 
        it.insumoId === alloc.insumoId || 
        (it.codigo && alloc.codigo && it.codigo.toLowerCase() === alloc.codigo.toLowerCase())
      );

      const totalQty = alloc.cantidadApartada || 0;
      const stdCantBulto = Math.max(1, alloc.cantEnBulto || matchingItem?.cant_en_bulto || 1);
      const uom = alloc.unidad || matchingItem?.unidadMedida || matchingItem?.unidad || 'und';
      const folioOAB = alloc.folioOAB || alloc.pedidoCodigo || 'MTO-TALLER';

      let bundlesList: { cant: number; isPico: boolean }[] = [];

      if (alloc.desgloseBultos && alloc.desgloseBultos.length > 0) {
        bundlesList = alloc.desgloseBultos.map(c => ({ cant: c, isPico: false }));
      } else if (totalQty > stdCantBulto && stdCantBulto > 0) {
        const fullBultos = Math.floor(totalQty / stdCantBulto);
        const rem = totalQty % stdCantBulto;
        for (let b = 0; b < fullBultos; b++) {
          bundlesList.push({ cant: stdCantBulto, isPico: false });
        }
        if (rem > 0) {
          bundlesList.push({ cant: rem, isPico: true });
        }
      } else {
        bundlesList = [{ cant: totalQty, isPico: false }];
      }

      const totalB = bundlesList.length;
      const abbrev = getProjectAbbrev(alloc.proyectoNombre);
      const dateCode = getFormattedDate(alloc.updatedAt ? new Date(alloc.updatedAt).toISOString() : undefined);

      bundlesList.forEach((bInfo, idx) => {
        const bIndex = idx + 1;
        const pkgId = `PKG-${abbrev}-${dateCode}-${String(bIndex).padStart(2, '0')}`;
        const qrPayload = `${origin}/?folio=${encodeURIComponent(folioOAB)}&material=${encodeURIComponent(alloc.codigo || alloc.insumoNombre)}&tienda=${encodeURIComponent(alloc.proyectoNombre)}&bulto=${bIndex}_${totalB}&pkg_id=${encodeURIComponent(pkgId)}&cant_bulto=${bInfo.cant}`;

        list.push({
          id: `${alloc.id}-pkg-${bIndex}`,
          allocId: alloc.id,
          dashboardId: alloc.dashboardId,
          insumoId: alloc.insumoId,
          insumoNombre: alloc.insumoNombre,
          codigo: alloc.codigo,
          categoria: matchingItem?.categoriaMaterial,
          proyectoId: alloc.proyectoId,
          proyectoNombre: alloc.proyectoNombre,
          pedidoId: alloc.pedidoId,
          pedidoCodigo: alloc.pedidoCodigo,
          folioOAB,
          bultoIndex: bIndex,
          totalBultos: totalB,
          cantBulto: bInfo.cant,
          unidadMedida: uom,
          isPico: bInfo.isPico,
          pkgId,
          qrPayload,
          rawAlloc: alloc,
          matchingItem
        });
      });
    });

    return list;
  }, [allAllocations, allItems]);

  // Lista única de proyectos presentes en los bultos (para filtro dropdown)
  const bultoProjectNames = useMemo(() => {
    const set = new Set<string>();
    allDirectoryBultos.forEach(b => {
      if (b.proyectoNombre) set.add(b.proyectoNombre);
    });
    return Array.from(set).sort();
  }, [allDirectoryBultos]);

  // Filtrado reactivo de bultos por proyecto y texto de búsqueda
  const filteredBultos = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return allDirectoryBultos.filter(b => {
      // Filtro de proyecto
      if (bultosProjectFilter !== 'all') {
        const matchProj = b.proyectoNombre.toLowerCase() === bultosProjectFilter.toLowerCase() ||
                          b.proyectoId === bultosProjectFilter;
        if (!matchProj) return false;
      }
      // Filtro de texto
      if (!q) return true;
      return (
        b.insumoNombre.toLowerCase().includes(q) ||
        (b.codigo && b.codigo.toLowerCase().includes(q)) ||
        b.proyectoNombre.toLowerCase().includes(q) ||
        b.pkgId.toLowerCase().includes(q) ||
        b.folioOAB.toLowerCase().includes(q)
      );
    });
  }, [allDirectoryBultos, bultosProjectFilter, searchQuery]);

  // Generar mini-QRs para la cuadrícula
  useEffect(() => {
    let isMounted = true;
    const generateQrs = async () => {
      const targets = filteredBultos.slice(0, 100);
      const updates: Record<string, string> = {};
      for (const b of targets) {
        if (!bultoQrMap[b.id]) {
          try {
            const url = await QRCode.toDataURL(b.qrPayload, {
              width: 100,
              margin: 1,
              color: { dark: '#000000', light: '#ffffff' },
              errorCorrectionLevel: 'M'
            });
            updates[b.id] = url;
          } catch (e) {
            console.warn('Fallo generando mini QR:', b.pkgId, e);
          }
        }
      }
      if (isMounted && Object.keys(updates).length > 0) {
        setBultoQrMap(prev => ({ ...prev, ...updates }));
      }
    };
    generateQrs();
    return () => { isMounted = false; };
  }, [filteredBultos, bultoQrMap]);

  // Generar QR de alta resolución (220px) y Barcode Code128 para la Cédula Pericial Ampliada
  useEffect(() => {
    if (!selectedBultoForDetail) {
      setDetailQrDataUrl(null);
      setDetailBarcodeDataUrl(null);
      return;
    }

    let isMounted = true;
    QRCode.toDataURL(selectedBultoForDetail.qrPayload, {
      width: 240,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'H'
    }).then(url => {
      if (isMounted) setDetailQrDataUrl(url);
    }).catch(err => console.error('Error generando QR pericial 220px:', err));

    try {
      const canvas = document.createElement('canvas');
      JsBarcode(canvas, selectedBultoForDetail.pkgId, {
        format: 'CODE128',
        displayValue: true,
        fontSize: 14,
        margin: 4,
        height: 44,
        background: '#ffffff',
        lineColor: '#000000'
      });
      if (isMounted) setDetailBarcodeDataUrl(canvas.toDataURL('image/png'));
    } catch (err) {
      console.warn('Error generando Code128:', selectedBultoForDetail.pkgId, err);
    }

    return () => { isMounted = false; };
  }, [selectedBultoForDetail]);

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

  const handleTriggerReprint = (alloc: StoreAllocation) => {
    if (!onReprintLabel) return;
    const matchingItem = allItems.find(it => 
      (alloc.insumoId && it.id === alloc.insumoId) || 
      (alloc.dashboardId && (it.id === alloc.dashboardId || it.dashboardId === alloc.dashboardId)) || 
      it.nombre.toLowerCase() === alloc.insumoNombre.toLowerCase()
    );
    const cant = alloc.cantidadApartada > 0 ? alloc.cantidadApartada : (alloc.cantidadTransito || 1);
    onReprintLabel({
      id: `reprint_${alloc.id}`,
      insumoId: alloc.insumoId,
      dashboardId: alloc.dashboardId,
      nombre: alloc.insumoNombre,
      codigo: alloc.codigo || matchingItem?.codigo,
      categoria: matchingItem?.categoriaMaterial || 'MTO',
      folioOAB: alloc.folioOAB || 'MTO-ASIG',
      fechaRecepcion: new Date().toISOString().split('T')[0],
      proyectoNombre: alloc.proyectoNombre,
      cantidadRecibidaHoy: cant,
      bultos: alloc.bultos || 1,
      cantEnBulto: alloc.cantEnBulto || cant,
      desgloseBultos: alloc.desgloseBultos,
      unidadMedida: alloc.unidad || matchingItem?.unidadMedida || matchingItem?.unidad || 'und'
    });
    if (triggerHaptic) triggerHaptic('light');
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
            <button
              onClick={() => setActiveTab('bultos')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                activeTab === 'bultos'
                  ? 'bg-amber-500 text-slate-950 shadow-md font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Boxes className="w-3.5 h-3.5" />
              <span>📦 Bultos y QR en Galpón ({allDirectoryBultos.length})</span>
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
                                  {onDispatchAlloc && alloc.cantidadApartada > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        onClose();
                                        const matchingItem = allItems.find(it => it.id === alloc.dashboardId || (it.insumoId && it.insumoId === alloc.insumoId));
                                        onDispatchAlloc(alloc, matchingItem);
                                      }}
                                      className="p-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/30 text-[10px] font-semibold flex items-center gap-1 transition active:scale-95"
                                      title={`Despachar ${alloc.insumoNombre} a taller para ${project.proyectoNombre}`}
                                    >
                                      <ArrowUpRight className="w-3 h-3" />
                                      <span className="hidden sm:inline">Despachar</span>
                                    </button>
                                  )}

                                  {onReprintLabel && (
                                    <button
                                      type="button"
                                      onClick={() => handleTriggerReprint(alloc)}
                                      className="p-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-semibold flex items-center gap-1 transition active:scale-95"
                                      title={`Reimprimir etiquetas físicas MTO para ${alloc.insumoNombre}`}
                                    >
                                      <Printer className="w-3 h-3" />
                                      <span className="hidden sm:inline">Rótulo</span>
                                    </button>
                                  )}

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

          {/* ========================================================= */}
          {/* PESTAÑA 3: VISTA DE BULTOS Y VISOR QR EN PC (PLAN-009) */}
          {/* ========================================================= */}
          {activeTab === 'bultos' && (
            <div className="space-y-4">
              {/* Barra Superior de Filtros y Conmutador de Vista */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-950/70 p-3 rounded-2xl border border-slate-800">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-slate-400">Filtrar por Obra:</span>
                    <select
                      value={bultosProjectFilter}
                      onChange={(e) => setBultosProjectFilter(e.target.value)}
                      className="bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1 text-xs text-slate-200 outline-none focus:border-amber-500 font-medium"
                    >
                      <option value="all">Todas las Obras ({allDirectoryBultos.length} bultos)</option>
                      {bultoProjectNames.map(pName => {
                        const cnt = allDirectoryBultos.filter(b => b.proyectoNombre === pName).length;
                        return (
                          <option key={pName} value={pName}>{pName} ({cnt})</option>
                        );
                      })}
                    </select>
                  </div>

                  <span className="text-slate-500 text-xs hidden sm:inline">•</span>

                  <span className="text-slate-400 text-xs font-mono">
                    Mostrando <strong className="text-amber-400">{filteredBultos.length}</strong> de {allDirectoryBultos.length} bultos físicos
                  </span>
                </div>

                <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 self-end sm:self-auto">
                  <button
                    type="button"
                    onClick={() => setBultosViewMode('grid')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1 transition ${
                      bultosViewMode === 'grid'
                        ? 'bg-amber-500 text-slate-950 font-bold shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                    title="Vista Cuadrícula de Tarjetas con Mini-QR"
                  >
                    <LayoutGrid className="w-3.5 h-3.5" />
                    <span>Tarjetas QR</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setBultosViewMode('table')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1 transition ${
                      bultosViewMode === 'table'
                        ? 'bg-amber-500 text-slate-950 font-bold shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                    title="Vista Tabla ERP de Auditoría Masiva"
                  >
                    <List className="w-3.5 h-3.5" />
                    <span>Tabla ERP</span>
                  </button>
                </div>
              </div>

              {/* MODO 1: CUADRÍCULA DE TARJETAS PERICIALES CON MINI QR */}
              {bultosViewMode === 'grid' && (
                <>
                  {filteredBultos.length === 0 ? (
                    <div className="text-center py-12 bg-slate-950/40 rounded-2xl border border-dashed border-slate-800">
                      <Boxes className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                      <p className="text-slate-400 text-sm font-semibold">No se encontraron bultos registrados para los criterios actuales</p>
                      <p className="text-slate-500 text-xs mt-1">Los bultos se generan automáticamente al apartar materiales o recibir en rampa</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                      {filteredBultos.map(bulto => {
                        const qrImg = bultoQrMap[bulto.id];
                        return (
                          <div
                            key={bulto.id}
                            className="bg-slate-950/70 border border-slate-800/90 hover:border-amber-500/50 rounded-2xl p-4 flex flex-col justify-between transition-all duration-200 shadow-lg hover:shadow-amber-500/5 group"
                          >
                            <div>
                              {/* Header de Tarjeta */}
                              <div className="flex items-start justify-between gap-2 mb-3">
                                <span className="font-mono text-[11px] font-bold text-amber-400 bg-amber-400/10 border border-amber-400/20 px-2 py-0.5 rounded-lg">
                                  {bulto.pkgId}
                                </span>
                                <span className="text-[10px] font-semibold text-slate-300 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded-lg truncate max-w-[150px]" title={bulto.proyectoNombre}>
                                  {bulto.proyectoNombre}
                                </span>
                              </div>

                              {/* Cuerpo de Tarjeta: QR + Ficha */}
                              <div className="flex items-center gap-3.5 mb-3.5">
                                {/* Mini QR Clickeable */}
                                <button
                                  type="button"
                                  onClick={() => setSelectedBultoForDetail(bulto)}
                                  className="shrink-0 w-20 h-20 bg-white p-1 rounded-xl flex items-center justify-center border border-slate-300 hover:border-amber-500 shadow-sm relative group/qr cursor-zoom-in transition"
                                  title="Click para ampliar QR en Cédula Pericial"
                                >
                                  {qrImg ? (
                                    <img src={qrImg} alt={`QR ${bulto.pkgId}`} className="w-full h-full object-contain" />
                                  ) : (
                                    <div className="w-full h-full flex flex-col items-center justify-center text-slate-400">
                                      <QrCode className="w-6 h-6 animate-pulse text-slate-500" />
                                      <span className="text-[8px] text-slate-500 font-mono mt-0.5">QR...</span>
                                    </div>
                                  )}
                                  <div className="absolute inset-0 bg-slate-900/60 opacity-0 group-hover/qr:opacity-100 flex items-center justify-center rounded-xl transition text-white">
                                    <Maximize2 className="w-5 h-5 text-amber-300" />
                                  </div>
                                </button>

                                {/* Info del Insumo */}
                                <div className="min-w-0 flex-1">
                                  <h4 className="text-xs font-bold text-slate-100 line-clamp-2 leading-snug group-hover:text-amber-300 transition" title={bulto.insumoNombre}>
                                    {bulto.insumoNombre}
                                  </h4>
                                  <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400 font-mono">
                                    <span>{bulto.codigo || 'S/C'}</span>
                                    <span>•</span>
                                    <span className="text-slate-500 truncate">{bulto.folioOAB}</span>
                                  </div>

                                  <div className="flex items-center gap-2 mt-2">
                                    <span className="font-mono text-xs font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-2 py-0.5 rounded-lg">
                                      {bulto.cantBulto} {bulto.unidadMedida}
                                    </span>
                                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-lg border ${
                                      bulto.isPico 
                                        ? 'bg-amber-950/60 text-amber-300 border-amber-500/30' 
                                        : 'bg-slate-900 text-slate-400 border-slate-800'
                                    }`}>
                                      Bulto {bulto.bultoIndex}/{bulto.totalBultos} {bulto.isPico && '(Pico)'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Botones de Acción de Tarjeta */}
                            <div className="flex items-center gap-1.5 pt-3 border-t border-slate-900">
                              <button
                                type="button"
                                onClick={() => setSelectedBultoForDetail(bulto)}
                                className="flex-1 py-1.5 px-2 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white rounded-xl text-[11px] font-semibold flex items-center justify-center gap-1 transition border border-slate-800"
                              >
                                <Eye className="w-3.5 h-3.5 text-amber-400" />
                                <span>Ver Cédula QR</span>
                              </button>

                              {onDispatchAlloc && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onClose();
                                    onDispatchAlloc(bulto.rawAlloc, bulto.matchingItem);
                                  }}
                                  className="py-1.5 px-2.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 rounded-xl text-[11px] font-semibold flex items-center justify-center gap-1 transition active:scale-95"
                                  title="Despachar a taller inmediatamente"
                                >
                                  <Truck className="w-3.5 h-3.5" />
                                  <span className="hidden sm:inline">Despachar</span>
                                </button>
                              )}

                              {onReprintLabel && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onReprintLabel({
                                      id: bulto.id,
                                      folioOAB: bulto.folioOAB,
                                      nombre: bulto.insumoNombre,
                                      codigo: bulto.codigo,
                                      categoria: bulto.categoria || 'Insumos',
                                      proyectoNombre: bulto.proyectoNombre,
                                      cantidadRecibidaHoy: bulto.cantBulto,
                                      bultos: 1,
                                      cantEnBulto: bulto.cantBulto,
                                      desgloseBultos: [bulto.cantBulto],
                                      unidadMedida: bulto.unidadMedida,
                                      customPkgId: bulto.pkgId,
                                      fechaRecepcion: new Date().toISOString().split('T')[0]
                                    });
                                  }}
                                  className="p-1.5 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-xl transition border border-slate-800"
                                  title="Reimprimir Rótulo Físico"
                                >
                                  <Printer className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {/* MODO 2: TABLA ERP DE AUDITORÍA MASIVA */}
              {bultosViewMode === 'table' && (
                <>
                  {filteredBultos.length === 0 ? (
                    <div className="text-center py-12 bg-slate-950/40 rounded-2xl border border-dashed border-slate-800">
                      <Boxes className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                      <p className="text-slate-400 text-sm font-semibold">No se encontraron bultos para los filtros seleccionados</p>
                    </div>
                  ) : (
                    <div className="bg-slate-950/70 border border-slate-800/90 rounded-2xl overflow-hidden shadow-xl">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="bg-slate-900/80 border-b border-slate-800 text-slate-400 text-[10px] font-bold uppercase tracking-wider">
                              <th className="p-3 w-14 text-center">QR</th>
                              <th className="p-3">Serial PKG-ID</th>
                              <th className="p-3">Insumo / Material</th>
                              <th className="p-3">Obra / Destino</th>
                              <th className="p-3 text-center">Bulto</th>
                              <th className="p-3 text-right">Cant. en Piso</th>
                              <th className="p-3">Folio OAB</th>
                              <th className="p-3 text-center">Acciones</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/60">
                            {filteredBultos.map(bulto => {
                              const qrImg = bultoQrMap[bulto.id];
                              return (
                                <tr key={bulto.id} className="hover:bg-slate-900/50 transition">
                                  <td className="p-2 text-center">
                                    <button
                                      type="button"
                                      onClick={() => setSelectedBultoForDetail(bulto)}
                                      className="w-9 h-9 bg-white p-0.5 rounded-lg inline-flex items-center justify-center border border-slate-300 hover:border-amber-500 shadow-sm cursor-zoom-in"
                                      title="Ampliar QR en pantalla"
                                    >
                                      {qrImg ? (
                                        <img src={qrImg} alt="QR" className="w-full h-full object-contain" />
                                      ) : (
                                        <QrCode className="w-4 h-4 text-slate-600" />
                                      )}
                                    </button>
                                  </td>
                                  <td className="p-3 font-mono font-bold text-amber-400 text-[11px] whitespace-nowrap">
                                    {bulto.pkgId}
                                  </td>
                                  <td className="p-3">
                                    <span className="font-semibold text-slate-100 block text-[11px]">{bulto.insumoNombre}</span>
                                    <span className="font-mono text-slate-500 text-[9px]">{bulto.codigo || '—'}</span>
                                  </td>
                                  <td className="p-3 font-medium text-slate-300 whitespace-nowrap">
                                    {bulto.proyectoNombre}
                                  </td>
                                  <td className="p-3 text-center">
                                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold ${
                                      bulto.isPico 
                                        ? 'bg-amber-950/80 text-amber-300 border border-amber-500/30' 
                                        : 'bg-slate-900 text-slate-300 border border-slate-800'
                                    }`}>
                                      {bulto.bultoIndex}/{bulto.totalBultos} {bulto.isPico ? 'Pico' : ''}
                                    </span>
                                  </td>
                                  <td className="p-3 text-right font-mono font-bold text-emerald-400">
                                    {bulto.cantBulto} {bulto.unidadMedida}
                                  </td>
                                  <td className="p-3 font-mono text-[10px] text-slate-400 whitespace-nowrap">
                                    {bulto.folioOAB}
                                  </td>
                                  <td className="p-3 text-center whitespace-nowrap">
                                    <div className="inline-flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => setSelectedBultoForDetail(bulto)}
                                        className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition"
                                        title="Ver Cédula Pericial"
                                      >
                                        <Eye className="w-3.5 h-3.5 text-amber-400" />
                                      </button>
                                      {onDispatchAlloc && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            onClose();
                                            onDispatchAlloc(bulto.rawAlloc, bulto.matchingItem);
                                          }}
                                          className="p-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-lg transition"
                                          title="Despachar a Taller"
                                        >
                                          <Truck className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                      {onReprintLabel && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            onReprintLabel({
                                              id: bulto.id,
                                              folioOAB: bulto.folioOAB,
                                              nombre: bulto.insumoNombre,
                                              codigo: bulto.codigo,
                                              categoria: bulto.categoria || 'Insumos',
                                              proyectoNombre: bulto.proyectoNombre,
                                              cantidadRecibidaHoy: bulto.cantBulto,
                                              bultos: 1,
                                              cantEnBulto: bulto.cantBulto,
                                              desgloseBultos: [bulto.cantBulto],
                                              unidadMedida: bulto.unidadMedida,
                                              customPkgId: bulto.pkgId,
                                              fechaRecepcion: new Date().toISOString().split('T')[0]
                                            });
                                          }}
                                          className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-lg transition"
                                          title="Reimprimir Rótulo"
                                        >
                                          <Printer className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
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

        {/* ========================================================= */}
        {/* SUBMODAL 5: CÉDULA PERICIAL AMPLIADA (ZOOM-IN QR PC) */}
        {/* ========================================================= */}
        {selectedBultoForDetail && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md">
            <div className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-xl p-5 sm:p-6 shadow-2xl animate-in zoom-in-95 overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-400">
                    <QrCode className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                      <span>Cédula Digital del Bulto</span>
                      <span className="font-mono text-xs text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-lg border border-amber-400/20">
                        {selectedBultoForDetail.pkgId}
                      </span>
                    </h3>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Inspección pericial en pantalla y escaneo directo con cámara móvil
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedBultoForDetail(null)}
                  className="p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Grid de Contenido */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
                {/* Columna Izquierda: QR de Alto Contraste y Barcode 1D */}
                <div className="flex flex-col items-center justify-center bg-slate-950 p-4 rounded-2xl border border-slate-800">
                  <div className="bg-white p-2 rounded-2xl shadow-lg border border-slate-200 mb-3 flex items-center justify-center w-52 h-52">
                    {detailQrDataUrl ? (
                      <img
                        src={detailQrDataUrl}
                        alt={`QR ${selectedBultoForDetail.pkgId}`}
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center text-slate-500">
                        <QrCode className="w-8 h-8 animate-pulse mb-1 text-slate-400" />
                        <span className="text-[10px] font-mono">Generando QR...</span>
                      </div>
                    )}
                  </div>

                  <span className="text-[10px] text-slate-400 font-mono text-center block mb-3">
                    🔍 Escaneable directamente desde la pantalla
                  </span>

                  {detailBarcodeDataUrl && (
                    <div className="bg-white p-1.5 rounded-xl border border-slate-200 w-full flex items-center justify-center shadow-sm">
                      <img
                        src={detailBarcodeDataUrl}
                        alt={`Code128 ${selectedBultoForDetail.pkgId}`}
                        className="max-h-12 w-auto object-contain"
                      />
                    </div>
                  )}
                </div>

                {/* Columna Derecha: Ficha Técnica Pericial */}
                <div className="flex flex-col justify-between space-y-3">
                  <div className="bg-slate-950/80 p-3.5 rounded-2xl border border-slate-800 space-y-2 text-xs">
                    <div>
                      <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">
                        Material / Insumo
                      </span>
                      <span className="font-bold text-slate-100 text-sm block mt-0.5">
                        {selectedBultoForDetail.insumoNombre}
                      </span>
                      <div className="flex items-center gap-2 mt-1 text-[11px] font-mono text-slate-400">
                        <span>SKU: {selectedBultoForDetail.codigo || 'S/C'}</span>
                        {selectedBultoForDetail.categoria && (
                          <>
                            <span>•</span>
                            <span className="text-slate-500">{selectedBultoForDetail.categoria}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-800/80">
                      <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">
                        Obra / Destino ERP
                      </span>
                      <span className="font-bold text-amber-400 text-xs block mt-0.5">
                        {selectedBultoForDetail.proyectoNombre}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400 block">
                        Folio: {selectedBultoForDetail.folioOAB}
                      </span>
                    </div>

                    <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                      <div>
                        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">
                          Contenido Bulto
                        </span>
                        <span className="font-mono font-bold text-emerald-400 text-sm">
                          {selectedBultoForDetail.cantBulto} {selectedBultoForDetail.unidadMedida}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">
                          Secuencia
                        </span>
                        <span className="font-mono text-xs text-slate-300 font-semibold">
                          Bulto {selectedBultoForDetail.bultoIndex} de {selectedBultoForDetail.totalBultos}
                        </span>
                      </div>
                    </div>

                    {selectedBultoForDetail.isPico && (
                      <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-300 text-[10px]">
                        ⚠️ <strong>Bulto Pico / Saldo Abierto:</strong> Paquete asimétrico fraccionado para cubrir exactamente la cuota del pedido.
                      </div>
                    )}
                  </div>

                  {/* Acciones Rápidas */}
                  <div className="space-y-2 pt-1">
                    {onDispatchAlloc && (
                      <button
                        type="button"
                        onClick={() => {
                          const alloc = selectedBultoForDetail.rawAlloc;
                          const it = selectedBultoForDetail.matchingItem;
                          setSelectedBultoForDetail(null);
                          onClose();
                          onDispatchAlloc(alloc, it);
                        }}
                        className="w-full py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg active:scale-95 transition"
                      >
                        <Truck className="w-4 h-4" />
                        <span>Despachar a Taller / Producción</span>
                      </button>
                    )}

                    {onOpenBultoModal && (
                      <button
                        type="button"
                        onClick={() => {
                          const bData = {
                            folio: selectedBultoForDetail.folioOAB,
                            material: selectedBultoForDetail.codigo || selectedBultoForDetail.insumoNombre,
                            tienda: selectedBultoForDetail.proyectoNombre,
                            bulto: `${selectedBultoForDetail.bultoIndex}_${selectedBultoForDetail.totalBultos}`,
                            cantBulto: selectedBultoForDetail.cantBulto,
                            pkgId: selectedBultoForDetail.pkgId,
                            unidadMedida: selectedBultoForDetail.unidadMedida
                          };
                          setSelectedBultoForDetail(null);
                          onClose();
                          onOpenBultoModal(bData);
                        }}
                        className="w-full py-2 px-3 rounded-xl bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 font-semibold text-xs flex items-center justify-center gap-2 transition"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Cédula Móvil (Simular Escaneo)</span>
                      </button>
                    )}

                    {onReprintLabel && (
                      <button
                        type="button"
                        onClick={() => {
                          onReprintLabel({
                            id: selectedBultoForDetail.id,
                            folioOAB: selectedBultoForDetail.folioOAB,
                            nombre: selectedBultoForDetail.insumoNombre,
                            codigo: selectedBultoForDetail.codigo,
                            categoria: selectedBultoForDetail.categoria || 'Insumos',
                            proyectoNombre: selectedBultoForDetail.proyectoNombre,
                            cantidadRecibidaHoy: selectedBultoForDetail.cantBulto,
                            bultos: 1,
                            cantEnBulto: selectedBultoForDetail.cantBulto,
                            desgloseBultos: [selectedBultoForDetail.cantBulto],
                            unidadMedida: selectedBultoForDetail.unidadMedida,
                            customPkgId: selectedBultoForDetail.pkgId,
                            fechaRecepcion: new Date().toISOString().split('T')[0]
                          });
                        }}
                        className="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300 font-semibold text-xs flex items-center justify-center gap-2 border border-slate-700 transition"
                      >
                        <Printer className="w-3.5 h-3.5 text-slate-400" />
                        <span>Reimprimir Rótulo Físico</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
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
