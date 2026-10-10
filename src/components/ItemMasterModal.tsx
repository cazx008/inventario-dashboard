import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  Search,
  Plus,
  BookOpen,
  Activity,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  ShieldCheck,
  Lock,
  Printer,
  Sparkles,
  RefreshCw,
  Loader2,
  FileText,
  Tag,
  Sliders,
  DollarSign,
  Layers,
  Archive,
  ArrowRight,
  Info,
  Building2,
  Package,
  Wrench,
  SlidersHorizontal,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Check,
  RotateCcw,
  LayoutGrid
} from 'lucide-react';
import QRCode from 'qrcode';
import {
  ConceptRoot,
  CatalogItem,
  CatalogUpsertPayload,
  CatalogAuditReport,
  CatalogAuditIssue
} from '../types/catalog';
import {
  getConcepts,
  getCatalogItems,
  upsertCatalogItem,
  checkDuplicateCode,
  getCatalogAudit,
  healOrphans,
  bulkUpdateCosts
} from '../services/catalogService';

interface ItemMasterModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'directory' | 'form' | 'health';
  initialItem?: CatalogItem | null;
  onItemUpdated?: (item: CatalogItem) => void;
  currentUser?: {
    name?: string;
    permissions?: string[];
    puestos?: string[];
  } | null;
  bcvRate: number;
}

const CATEGORIAS_INSUMO = [
  'Maderas y Tableros',
  'Herrajes y Tornillería',
  'Químicos y Pegamentos',
  'Vidrios y Espejos',
  'Metales y Perfilería',
  'Empaque y Embalaje',
  'Herramientas y Consumibles',
  'General'
];

const ROLES_MATERIAL = [
  'Materia Prima',
  'Insumo Operativo',
  'Herramienta de Consumo',
  'Empaque y Embalaje'
];

const UOM_OPTIONS = [
  { value: 'UND', label: 'Unidad (UND)' },
  { value: 'ML', label: 'Metro Lineal (ML)' },
  { value: 'PLANCHA', label: 'Plancha / Lámina' },
  { value: 'KG', label: 'Kilogramo (KG)' },
  { value: 'L', label: 'Litro (L)' },
  { value: 'PAR', label: 'Par (PAR)' },
  { value: 'CJ', label: 'Caja (CJ)' },
  { value: 'PAQ', label: 'Paquete (PAQ)' }
];

export interface CatalogColumnDef {
  key: string;
  label: string;
  defaultVisible: boolean;
  sortable: boolean;
  align?: 'left' | 'center' | 'right';
}

export const CATALOG_COLUMNS: CatalogColumnDef[] = [
  { key: 'codigo', label: 'Código / SKU', defaultVisible: true, sortable: true, align: 'left' },
  { key: 'nombre', label: 'Descripción / Nombre', defaultVisible: true, sortable: true, align: 'left' },
  { key: 'codigoValery', label: 'Código Valery', defaultVisible: false, sortable: true, align: 'left' },
  { key: 'marca', label: 'Marca', defaultVisible: false, sortable: true, align: 'left' },
  { key: 'categoria', label: 'Categoría', defaultVisible: true, sortable: true, align: 'left' },
  { key: 'rolMaterial', label: 'Rol de Material', defaultVisible: false, sortable: true, align: 'left' },
  { key: 'dimensiones', label: 'Dimensiones', defaultVisible: true, sortable: false, align: 'left' },
  { key: 'color', label: 'Color / Acabado', defaultVisible: false, sortable: true, align: 'left' },
  { key: 'unidad', label: 'UoM', defaultVisible: true, sortable: true, align: 'center' },
  { key: 'stockBase', label: 'Existencia Fís.', defaultVisible: true, sortable: true, align: 'right' },
  { key: 'stockMinimo', label: 'Stock Mín.', defaultVisible: false, sortable: true, align: 'right' },
  { key: 'costoUSD', label: 'Costo USD', defaultVisible: true, sortable: true, align: 'right' },
  { key: 'costoBS', label: 'Costo Bs.', defaultVisible: false, sortable: true, align: 'right' },
  { key: 'ubicacion', label: 'Ubicación', defaultVisible: false, sortable: true, align: 'left' },
  { key: 'estado', label: 'Estado', defaultVisible: true, sortable: true, align: 'center' }
];

export const ItemMasterModal: React.FC<ItemMasterModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'directory',
  initialItem = null,
  onItemUpdated,
  currentUser = null,
  bcvRate
}) => {
  // Pestaña Activa
  const [activeTab, setActiveTab] = useState<'directory' | 'form' | 'health'>(initialTab);

  // --------------------------------------------------------------------------
  // ESTADO GLOBAL / DATOS
  // --------------------------------------------------------------------------
  const [concepts, setConcepts] = useState<ConceptRoot[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);

  // --------------------------------------------------------------------------
  // ESTADO PESTAÑA 1: DIRECTORIO MAESTRO (FILTROS, VISIBILIDAD, SORTING & DENSIDAD)
  // --------------------------------------------------------------------------
  const [dirSearch, setDirSearch] = useState('');
  const [dirCategory, setDirCategory] = useState<string>('todos');
  const [dirStatus, setDirStatus] = useState<'todos' | 'activos' | 'descontinuados' | 'huerfanos'>('todos');

  // Visibilidad de columnas con persistencia
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('sanesca_catalog_visible_cols_v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    return CATALOG_COLUMNS.filter(c => c.defaultVisible).map(c => c.key);
  });

  // Densidad de tabla (Cómoda vs Compacta)
  const [density, setDensity] = useState<'comfortable' | 'compact'>(() => {
    try {
      const saved = localStorage.getItem('sanesca_catalog_density_v1');
      if (saved === 'compact' || saved === 'comfortable') return saved;
    } catch (e) {}
    return 'comfortable';
  });

  // Ordenamiento interactivo
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [isColsMenuOpen, setIsColsMenuOpen] = useState(false);
  const colsMenuRef = useRef<HTMLDivElement>(null);

  // --------------------------------------------------------------------------
  // ESTADO PESTAÑA 2: FICHA TÉCNICA (CREAR / EDITAR)
  // --------------------------------------------------------------------------
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [editingItem, setEditingItem] = useState<CatalogItem | null>(null);

  // Campos del formulario
  const [selectedConceptId, setSelectedConceptId] = useState<string>('');
  const [inputModifiers, setInputModifiers] = useState<Record<string, string>>({});
  const [nombre, setNombre] = useState('');
  const [codigo, setCodigo] = useState('');
  const [codigoValery, setCodigoValery] = useState('');
  const [marca, setMarca] = useState('');
  const [categoria, setCategoria] = useState('Maderas y Tableros');
  const [rolMaterial, setRolMaterial] = useState('Materia Prima');
  const [unidad, setUnidad] = useState('UND');
  const [costoUSD, setCostoUSD] = useState<string>('0');
  const [largo, setLargo] = useState<string>('');
  const [ancho, setAncho] = useState<string>('');
  const [espesor, setEspesor] = useState<string>('');
  const [color, setColor] = useState('');
  const [ubicacion, setUbicacion] = useState('');
  const [stockMinimo, setStockMinimo] = useState<string>('0');
  const [activo, setActivo] = useState(true);

  // Validación y guardado
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccessMessage, setFormSuccessMessage] = useState<string | null>(null);
  const [codeDuplicateWarning, setCodeDuplicateWarning] = useState<string | null>(null);
  const [lastSavedItem, setLastSavedItem] = useState<CatalogItem | null>(null);

  // --------------------------------------------------------------------------
  // ESTADO PESTAÑA 3: HEALTH CHECKER & BULK EDIT
  // --------------------------------------------------------------------------
  const [auditReport, setAuditReport] = useState<CatalogAuditReport | null>(null);
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [healthSubTab, setHealthSubTab] = useState<'issues' | 'bulk_costs'>('issues');
  const [bulkCostValues, setBulkCostValues] = useState<Record<string, string>>({});
  const [isHealingOrphans, setIsHealingOrphans] = useState(false);
  const [isSavingBulkCosts, setIsSavingBulkCosts] = useState(false);
  const [bulkSuccessMsg, setBulkSuccessMsg] = useState<string | null>(null);

  // --------------------------------------------------------------------------
  // ESTADO ETIQUETA DE ANAQUEL / GAVETA (MODAL DE IMPRESIÓN)
  // --------------------------------------------------------------------------
  const [labelItem, setLabelItem] = useState<CatalogItem | null>(null);
  const [labelQrUrl, setLabelQrUrl] = useState<string>('');

  // --------------------------------------------------------------------------
  // EFECTOS INICIALES
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      loadConceptsList();
      loadItemsList();
      if (initialTab === 'health') {
        loadAuditData(false);
      }
      if (initialItem) {
        openEditForm(initialItem);
      } else if (initialTab === 'form') {
        resetFormToCreate();
      }
    }
  }, [isOpen, initialTab, initialItem]);

  const loadConceptsList = async () => {
    try {
      const data = await getConcepts(false);
      setConcepts(data);
    } catch (e) {
      console.warn('Error cargando conceptos ontológicos:', e);
    }
  };

  const loadItemsList = async () => {
    setIsLoadingItems(true);
    setItemsError(null);
    try {
      const { items } = await getCatalogItems();
      setCatalogItems(items);
    } catch (err: any) {
      setItemsError(err.message || 'Error al cargar ítems del catálogo');
    } finally {
      setIsLoadingItems(false);
    }
  };

  const loadAuditData = async (refresh = false) => {
    setIsLoadingAudit(true);
    setAuditError(null);
    try {
      const rep = await getCatalogAudit(refresh);
      setAuditReport(rep);

      // Precargar valores iniciales para bulk costs
      const initialMap: Record<string, string> = {};
      rep.zeroCostCandidates.forEach(c => {
        initialMap[c.id] = '';
      });
      setBulkCostValues(initialMap);
    } catch (err: any) {
      setAuditError(err.message || 'Error consultando auditoría de catálogo');
    } finally {
      setIsLoadingAudit(false);
    }
  };

  // --------------------------------------------------------------------------
  // LOGICA FORMULARIO: CONCEPTOS & AUTO-CONSTRUCCIÓN SINTÁCTICA ISO
  // --------------------------------------------------------------------------
  const currentConcept = useMemo(() => {
    return concepts.find(c => c.id === selectedConceptId) || null;
  }, [concepts, selectedConceptId]);

  const handleConceptSelect = (cId: string) => {
    setSelectedConceptId(cId);
    const found = concepts.find(c => c.id === cId);
    if (!found) return;

    // Precargar UoM si no ha sido cambiada manualmente
    if (found.defaultUoM) {
      const matchedUom = UOM_OPTIONS.find(u => 
        u.value.toLowerCase() === found.defaultUoM.toLowerCase() ||
        u.label.toLowerCase().includes(found.defaultUoM.toLowerCase())
      );
      if (matchedUom) {
        setUnidad(matchedUom.value);
      }
    }

    // Si el código está vacío o en creación, sugerir prefijo
    if (formMode === 'create' && (!codigo || codigo.length < 3)) {
      setCodigo(`${found.codePrefix}-`);
    }

    // Limpiar modificadores anteriores
    setInputModifiers({});
  };

  // Autoconstruir Nombre de Insumo con Patrón ISO
  const applyIsoNamingPattern = () => {
    if (!currentConcept || !currentConcept.namingPattern) return;
    let builtName = currentConcept.namingPattern;

    // Reemplazar modificadores obligatorios
    for (const [modKey, modVal] of Object.entries(inputModifiers)) {
      const token = `{${modKey}}`;
      builtName = builtName.replace(new RegExp(token, 'gi'), modVal.trim());
    }

    // Limpiar placeholders no completados
    builtName = builtName.replace(/\{[^}]+\}/g, '').replace(/,\s*,/g, ',').trim();
    builtName = builtName.replace(/,\s*$/, '').trim();

    if (builtName) {
      setNombre(builtName);
    }
  };

  // Generador inteligente de SKU
  const handleGenerateSku = () => {
    const prefix = currentConcept?.codePrefix || categoria.substring(0, 3).toUpperCase() || 'INS';
    const randomHex = Math.random().toString(36).substring(2, 6).toUpperCase();
    const suggested = `${prefix}-${randomHex}`;
    setCodigo(suggested);
    checkDuplicateCode(suggested).then(res => {
      if (res.isDuplicate) {
        setCodeDuplicateWarning(`El código generado ${suggested} ya existe.`);
      } else {
        setCodeDuplicateWarning(null);
      }
    });
  };

  // Comprobar código en blur
  const handleCodeBlur = async () => {
    if (!codigo.trim()) return;
    const excludeId = formMode === 'edit' ? editingItem?.insumoId : undefined;
    const res = await checkDuplicateCode(codigo, excludeId);
    if (res.isDuplicate) {
      setCodeDuplicateWarning(`Atención: "${codigo.toUpperCase()}" ya está registrado en ${res.existingItem?.nombre || 'otro insumo'}.`);
    } else {
      setCodeDuplicateWarning(null);
    }
  };

  const resetFormToCreate = () => {
    setFormMode('create');
    setEditingItem(null);
    setSelectedConceptId('');
    setInputModifiers({});
    setNombre('');
    setCodigo('');
    setCodigoValery('');
    setMarca('');
    setCategoria('Maderas y Tableros');
    setRolMaterial('Materia Prima');
    setUnidad('UND');
    setCostoUSD('0');
    setLargo('');
    setAncho('');
    setEspesor('');
    setColor('');
    setUbicacion('');
    setStockMinimo('0');
    setActivo(true);
    setFormError(null);
    setFormSuccessMessage(null);
    setCodeDuplicateWarning(null);
    setLastSavedItem(null);
  };

  const openEditForm = (item: CatalogItem) => {
    setFormMode('edit');
    setEditingItem(item);
    setSelectedConceptId(item.conceptoId || '');
    setInputModifiers({});
    setNombre(item.nombre || '');
    setCodigo(item.codigo || '');
    setCodigoValery(item.codigoValery || '');
    setMarca(item.marca || '');
    setCategoria(item.categoria || 'General');
    setRolMaterial(item.rolMaterial || 'Materia Prima');
    setUnidad(item.unidad || 'UND');
    setCostoUSD(String(item.costoUnitarioUSD || 0));
    setLargo(item.largo ? String(item.largo) : '');
    setAncho(item.ancho ? String(item.ancho) : '');
    setEspesor(item.espesor ? String(item.espesor) : '');
    setColor(item.color || '');
    setUbicacion(item.ubicacion || '');
    setStockMinimo(String(item.stockMinimo || 0));
    setActivo(item.activo !== false);
    setFormError(null);
    setFormSuccessMessage(null);
    setCodeDuplicateWarning(null);
    setLastSavedItem(null);
    setActiveTab('form');
  };

  // Guardar Ficha Técnica (Crear o Actualizar)
  const handleSaveForm = async () => {
    setFormError(null);
    setFormSuccessMessage(null);

    // Validaciones
    if (!nombre.trim()) {
      setFormError('El nombre del insumo es obligatorio.');
      return;
    }
    if (!codigo.trim()) {
      setFormError('El código (SKU) es obligatorio.');
      return;
    }
    if (codeDuplicateWarning) {
      setFormError('Debe resolver el código duplicado antes de guardar.');
      return;
    }

    const costNum = parseFloat(costoUSD) || 0;
    const stockMinNum = parseFloat(stockMinimo) || 0;
    const largoNum = largo ? parseFloat(largo) : undefined;
    const anchoNum = ancho ? parseFloat(ancho) : undefined;
    const espesorNum = espesor ? parseFloat(espesor) : undefined;

    // Candado de descontinuación defensivo (D6-11)
    if (formMode === 'edit' && editingItem && !activo && editingItem.stockBase > 0) {
      setFormError(`Bloqueo de Descontinuación (D6-11): Este insumo posee ${editingItem.stockBase} ${editingItem.unidad} en saldo físico activo. No puede descontinuarse hasta liquidar o ajustar su inventario a cero en Kardex.`);
      return;
    }

    setIsSaving(true);
    try {
      const payload: CatalogUpsertPayload = {
        action: formMode === 'create' ? 'create' : 'update',
        insumoId: formMode === 'edit' ? editingItem?.insumoId : undefined,
        dashboardId: formMode === 'edit' ? editingItem?.dashboardId || undefined : undefined,
        nombre: nombre.trim(),
        codigo: codigo.trim().toUpperCase(),
        codigoValery: codigoValery.trim().toUpperCase() || undefined,
        marca: marca.trim() || undefined,
        categoria,
        rolMaterial,
        conceptoId: selectedConceptId || undefined,
        unidad,
        costoUnitarioUSD: costNum,
        largo: largoNum,
        ancho: anchoNum,
        espesor: espesorNum,
        color: color.trim() || undefined,
        ubicacion: ubicacion.trim() || undefined,
        stockMinimo: stockMinNum,
        activo
      };

      const result = await upsertCatalogItem(payload);

      if (!result.ok) {
        throw new Error(result.error || 'Error al guardar ficha en Notion');
      }

      setFormSuccessMessage(
        formMode === 'create'
          ? `Insumo "${payload.nombre}" creado exitosamente con alta dual atómica.`
          : `Insumo "${payload.nombre}" actualizado con éxito.`
      );

      // Re-consultar la lista de ítems
      const updatedListPromise = loadItemsList();

      const savedItemData: CatalogItem = {
        id: result.insumoId || editingItem?.id || '',
        insumoId: result.insumoId || editingItem?.insumoId || '',
        dashboardId: result.dashboardId || editingItem?.dashboardId || null,
        nombre: payload.nombre,
        codigo: payload.codigo,
        codigoValery: payload.codigoValery,
        marca: payload.marca,
        categoria: payload.categoria || 'General',
        rolMaterial: payload.rolMaterial,
        conceptoId: payload.conceptoId || null,
        unidad: payload.unidad,
        costoUnitarioUSD: payload.costoUnitarioUSD || 0,
        largo: payload.largo || null,
        ancho: payload.ancho || null,
        espesor: payload.espesor || null,
        color: payload.color,
        ubicacion: payload.ubicacion,
        stockBase: editingItem?.stockBase || 0,
        stockMinimo: payload.stockMinimo || 0,
        estadoStock: editingItem?.estadoStock || (payload.activo ? 'Sin Stock' : 'Descontinuado'),
        contando: true,
        activo: payload.activo !== false
      };

      setLastSavedItem(savedItemData);

      if (onItemUpdated) {
        onItemUpdated(savedItemData);
      }

      await updatedListPromise;

    } catch (err: any) {
      setFormError(err.message || 'Error al persistir cambios.');
    } finally {
      setIsSaving(false);
    }
  };

  // --------------------------------------------------------------------------
  // LOGICA ETIQUETA DE ANAQUEL / GAVETA
  // --------------------------------------------------------------------------
  const openLabelPrint = async (item: CatalogItem) => {
    setLabelItem(item);
    try {
      const qrData = `SANESCA-INSUMO|${item.codigo}|${item.id}|${item.nombre}`;
      const url = await QRCode.toDataURL(qrData, {
        width: 180,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' }
      });
      setLabelQrUrl(url);
    } catch (e) {
      console.warn('Error generando QR para etiqueta:', e);
    }
  };

  const handlePrintLabel = () => {
    window.print();
  };

  // Cerrar menú de columnas al hacer clic afuera
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (colsMenuRef.current && !colsMenuRef.current.contains(e.target as Node)) {
        setIsColsMenuOpen(false);
      }
    };
    if (isColsMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isColsMenuOpen]);

  const handleToggleColumn = (key: string) => {
    setVisibleColumns(prev => {
      let next: string[];
      if (prev.includes(key)) {
        if (prev.length <= 1) return prev; // Mantener al menos una columna
        next = prev.filter(k => k !== key);
      } else {
        next = [...prev, key];
      }
      try {
        localStorage.setItem('sanesca_catalog_visible_cols_v1', JSON.stringify(next));
      } catch (e) {}
      return next;
    });
  };

  const handleResetColumns = () => {
    const defaults = CATALOG_COLUMNS.filter(c => c.defaultVisible).map(c => c.key);
    setVisibleColumns(defaults);
    try {
      localStorage.setItem('sanesca_catalog_visible_cols_v1', JSON.stringify(defaults));
    } catch (e) {}
  };

  const handleToggleDensity = () => {
    const next = density === 'comfortable' ? 'compact' : 'comfortable';
    setDensity(next);
    try {
      localStorage.setItem('sanesca_catalog_density_v1', next);
    } catch (e) {}
  };

  const handleSort = (key: string) => {
    const colDef = CATALOG_COLUMNS.find(c => c.key === key);
    if (!colDef || !colDef.sortable) return;

    setSortConfig(prev => {
      if (!prev || prev.key !== key) {
        return { key, direction: 'asc' };
      }
      if (prev.direction === 'asc') {
        return { key, direction: 'desc' };
      }
      return null;
    });
  };

  // --------------------------------------------------------------------------
  // FILTRADO PESTAÑA 1: DIRECTORIO
  // --------------------------------------------------------------------------
  const filteredCatalogItems = useMemo(() => {
    return catalogItems.filter(item => {
      // Filtro de texto
      if (dirSearch.trim()) {
        const q = dirSearch.toLowerCase().trim();
        const matchesName = item.nombre.toLowerCase().includes(q);
        const matchesCode = item.codigo?.toLowerCase().includes(q);
        const matchesValery = item.codigoValery?.toLowerCase().includes(q);
        const matchesBrand = item.marca?.toLowerCase().includes(q);
        if (!matchesName && !matchesCode && !matchesValery && !matchesBrand) return false;
      }
      // Filtro de categoría
      if (dirCategory !== 'todos' && item.categoria.toLowerCase() !== dirCategory.toLowerCase()) {
        return false;
      }
      // Filtro de estado
      if (dirStatus === 'activos' && !item.activo) return false;
      if (dirStatus === 'descontinuados' && item.activo) return false;
      if (dirStatus === 'huerfanos' && !item.isHuerfano) return false;

      return true;
    });
  }, [catalogItems, dirSearch, dirCategory, dirStatus]);

  // --------------------------------------------------------------------------
  // ORDENAMIENTO PESTAÑA 1: DIRECTORIO
  // --------------------------------------------------------------------------
  const sortedCatalogItems = useMemo(() => {
    let list = [...filteredCatalogItems];
    if (!sortConfig) return list;
    const { key, direction } = sortConfig;
    const multiplier = direction === 'asc' ? 1 : -1;

    return list.sort((a, b) => {
      let valA: any = (a as any)[key];
      let valB: any = (b as any)[key];

      if (key === 'costoUSD') {
        valA = a.costoUnitarioUSD ?? 0;
        valB = b.costoUnitarioUSD ?? 0;
      } else if (key === 'costoBS') {
        valA = (a.costoUnitarioUSD ?? 0) * (bcvRate || 1);
        valB = (b.costoUnitarioUSD ?? 0) * (bcvRate || 1);
      } else if (key === 'estado') {
        valA = a.activo ? 1 : 0;
        valB = b.activo ? 1 : 0;
      }

      if (valA === undefined || valA === null) valA = '';
      if (valB === undefined || valB === null) valB = '';

      if (typeof valA === 'number' && typeof valB === 'number') {
        return (valA - valB) * multiplier;
      }
      return String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: 'base' }) * multiplier;
    });
  }, [filteredCatalogItems, sortConfig, bcvRate]);

  // Resumen métricas del directorio
  const dirMetrics = useMemo(() => {
    const total = catalogItems.length;
    const activosCount = catalogItems.filter(i => i.activo).length;
    const descontinuadosCount = catalogItems.filter(i => !i.activo).length;
    const huerfanosCount = catalogItems.filter(i => i.isHuerfano).length;
    return { total, activosCount, descontinuadosCount, huerfanosCount };
  }, [catalogItems]);

  // --------------------------------------------------------------------------
  // ACCIONES HEALTH CHECKER: SANACIÓN Y BULK COSTS
  // --------------------------------------------------------------------------
  const handleHealAllOrphans = async () => {
    if (!auditReport?.orphanCandidates || auditReport.orphanCandidates.length === 0) return;
    const ids = auditReport.orphanCandidates.map(c => c.id);
    const confirmHeal = window.confirm(
      `¿Desea crear automáticamente las fichas en BD_Control_Stock_Existencias para los ${ids.length} insumos huérfanos detectados?`
    );
    if (!confirmHeal) return;

    setIsHealingOrphans(true);
    setAuditError(null);
    try {
      const res = await healOrphans(ids);
      alert(res.message);
      await loadAuditData(true);
      await loadItemsList();
    } catch (e: any) {
      setAuditError(e.message || 'Error durante la auto-sanación.');
    } finally {
      setIsHealingOrphans(false);
    }
  };

  const handleSaveBulkCosts = async () => {
    const updates: Array<{ insumoId: string; costUSD: number }> = [];
    for (const [id, valStr] of Object.entries(bulkCostValues)) {
      const parsed = parseFloat(valStr);
      if (!isNaN(parsed) && parsed > 0) {
        updates.push({ insumoId: id, costUSD: parsed });
      }
    }

    if (updates.length === 0) {
      alert('No ha ingresado ningún costo mayor a $0.00 USD para actualizar.');
      return;
    }

    setIsSavingBulkCosts(true);
    setBulkSuccessMsg(null);
    try {
      const res = await bulkUpdateCosts(updates);
      setBulkSuccessMsg(res.message);
      await loadAuditData(true);
      await loadItemsList();
    } catch (e: any) {
      alert(`Error al guardar costos masivos: ${e.message}`);
    } finally {
      setIsSavingBulkCosts(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-6xl max-h-[92vh] flex flex-col bg-[#0F172A] border border-slate-700/80 rounded-2xl shadow-2xl text-slate-100 overflow-hidden">
        
        {/* ------------------------------------------------------------------ */}
        {/* CABECERA PRINCIPAL MODAL */}
        {/* ------------------------------------------------------------------ */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#131E35]">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-xl font-bold tracking-tight text-white">
                  Catálogo Maestro de Insumos & Auditoría
                </h2>
                <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/30">
                  Ontología ISO
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Ficha Técnica, Mutación Dual Atómica, Integridad Referencial y Monitoreo de Salud
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <div className="hidden sm:flex items-center space-x-1 bg-slate-800/80 border border-slate-700 rounded-lg p-1">
              <button
                onClick={() => setActiveTab('directory')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center space-x-1.5 ${
                  activeTab === 'directory'
                    ? 'bg-blue-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Directorio ({dirMetrics.total})</span>
              </button>
              <button
                onClick={() => {
                  if (activeTab !== 'form') resetFormToCreate();
                  setActiveTab('form');
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center space-x-1.5 ${
                  activeTab === 'form'
                    ? 'bg-blue-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>{formMode === 'create' ? '+ Nuevo Insumo' : 'Editar Ficha'}</span>
              </button>
              <button
                onClick={() => {
                  setActiveTab('health');
                  if (!auditReport) loadAuditData(false);
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center space-x-1.5 ${
                  activeTab === 'health'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span>Health Checker</span>
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Barra de pestañas móvil */}
        <div className="sm:hidden flex border-b border-slate-800 bg-slate-900 px-4 py-2 space-x-2">
          <button
            onClick={() => setActiveTab('directory')}
            className={`flex-1 py-1.5 text-xs rounded-md ${activeTab === 'directory' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}
          >
            Directorio
          </button>
          <button
            onClick={() => {
              if (activeTab !== 'form') resetFormToCreate();
              setActiveTab('form');
            }}
            className={`flex-1 py-1.5 text-xs rounded-md ${activeTab === 'form' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}
          >
            Ficha Técnica
          </button>
          <button
            onClick={() => {
              setActiveTab('health');
              if (!auditReport) loadAuditData(false);
            }}
            className={`flex-1 py-1.5 text-xs rounded-md ${activeTab === 'health' ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}
          >
            Salud
          </button>
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* CUERPO DEL MODAL SEGÚN PESTAÑA */}
        {/* ------------------------------------------------------------------ */}
        <div className={`flex-1 ${activeTab === 'directory' ? 'flex flex-col min-h-0 overflow-hidden p-6 gap-3' : 'overflow-y-auto p-6 space-y-6'}`}>

          {/* ================================================================ */}
          {/* PESTAÑA 1: DIRECTORIO MAESTRO DE INSUMOS */}
          {/* ================================================================ */}
          {activeTab === 'directory' && (
            <div className="flex flex-col h-full min-h-0 space-y-3">
              {/* Filtros superiores */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 flex-shrink-0">
                <div className="relative md:col-span-2">
                  <Search className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
                  <input
                    type="text"
                    value={dirSearch}
                    onChange={e => setDirSearch(e.target.value)}
                    placeholder="Buscar por código, nombre, marca o Valery (M*)..."
                    className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <select
                    value={dirCategory}
                    onChange={e => setDirCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                  >
                    <option value="todos">Todas las Categorías</option>
                    {CATEGORIAS_INSUMO.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center space-x-2">
                  <select
                    value={dirStatus}
                    onChange={e => setDirStatus(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                  >
                    <option value="todos">Todos los Estados</option>
                    <option value="activos">Solo Activos</option>
                    <option value="descontinuados">Descontinuados</option>
                    <option value="huerfanos">Huérfanos (Sin Stock)</option>
                  </select>
                  <button
                    onClick={() => {
                      resetFormToCreate();
                      setActiveTab('form');
                    }}
                    className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg flex items-center space-x-1 whitespace-nowrap shadow"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Nuevo</span>
                  </button>
                </div>
              </div>

              {/* Barra de métricas y herramientas ergonómicas */}
              <div className="flex-shrink-0 flex flex-wrap items-center justify-between gap-2">
                {/* Resumen métricas del directorio */}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <div className="px-2.5 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 flex items-center space-x-2">
                    <span className="text-slate-400">Total:</span>
                    <span className="font-bold text-white font-mono">{dirMetrics.total}</span>
                  </div>
                  <div className="px-2.5 py-1.5 rounded-lg bg-emerald-950/40 border border-emerald-800/60 flex items-center space-x-2">
                    <span className="text-emerald-400">Activos:</span>
                    <span className="font-bold text-emerald-300 font-mono">{dirMetrics.activosCount}</span>
                  </div>
                  <div className="px-2.5 py-1.5 rounded-lg bg-rose-950/40 border border-rose-800/60 flex items-center space-x-2">
                    <span className="text-rose-400">Descontinuados:</span>
                    <span className="font-bold text-rose-300 font-mono">{dirMetrics.descontinuadosCount}</span>
                  </div>
                  {dirMetrics.huerfanosCount > 0 && (
                    <div className="px-2.5 py-1.5 rounded-lg bg-amber-950/40 border border-amber-800/60 flex items-center space-x-2">
                      <span className="text-amber-400">Huérfanos:</span>
                      <span className="font-bold text-amber-300 font-mono">{dirMetrics.huerfanosCount}</span>
                    </div>
                  )}
                </div>

                {/* Acciones: Selector de Densidad y Columnas */}
                <div className="flex items-center space-x-2 relative">
                  {/* Selector de Densidad */}
                  <button
                    type="button"
                    onClick={handleToggleDensity}
                    className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs text-slate-300 hover:text-white transition shadow-sm"
                    title={`Cambiar a densidad ${density === 'comfortable' ? 'compacta' : 'cómoda'}`}
                  >
                    <Sliders className="w-3.5 h-3.5 text-slate-400" />
                    <span>{density === 'comfortable' ? 'Vista Cómoda' : 'Vista Compacta'}</span>
                  </button>

                  {/* Selector de Columnas Popover */}
                  <div className="relative" ref={colsMenuRef}>
                    <button
                      type="button"
                      onClick={() => setIsColsMenuOpen(!isColsMenuOpen)}
                      className={`flex items-center space-x-1.5 px-3 py-1.5 border rounded-lg text-xs transition shadow-sm ${
                        isColsMenuOpen
                          ? 'bg-blue-600 border-blue-500 text-white'
                          : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300 hover:text-white'
                      }`}
                      title="Configurar visibilidad de columnas"
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                      <span>Columnas</span>
                      <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-slate-900/80 text-blue-300 border border-slate-700">
                        {visibleColumns.length}/{CATALOG_COLUMNS.length}
                      </span>
                    </button>

                    {isColsMenuOpen && (
                      <div className="absolute right-0 top-full mt-2 w-72 bg-[#111827] border border-slate-700 rounded-xl shadow-2xl p-3 z-50 text-xs space-y-2 backdrop-blur-xl">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                          <div className="flex items-center space-x-1.5 font-semibold text-white">
                            <SlidersHorizontal className="w-4 h-4 text-blue-400" />
                            <span>Columnas Visibles</span>
                          </div>
                          <button
                            type="button"
                            onClick={handleResetColumns}
                            className="flex items-center space-x-1 text-[11px] text-blue-400 hover:text-blue-300 transition"
                            title="Restablecer predeterminadas"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Restablecer</span>
                          </button>
                        </div>

                        <div className="max-h-64 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                          {CATALOG_COLUMNS.map(col => {
                            const isChecked = visibleColumns.includes(col.key);
                            return (
                              <label
                                key={col.key}
                                className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-slate-800/80 cursor-pointer text-slate-300 hover:text-white transition"
                              >
                                <span className="flex items-center space-x-2">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => handleToggleColumn(col.key)}
                                    className="rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-0 focus:ring-offset-0"
                                  />
                                  <span>{col.label}</span>
                                </span>
                                {col.sortable && (
                                  <span className="text-[10px] text-slate-500 font-mono">Ord.</span>
                                )}
                              </label>
                            );
                          })}
                        </div>

                        <div className="pt-2 border-t border-slate-800 text-[10px] text-slate-500 text-center">
                          Preferencias guardadas automáticamente
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Mensajes de carga o error */}
              {isLoadingItems && (
                <div className="py-12 flex flex-col items-center justify-center text-slate-400 flex-1">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-2" />
                  <p className="text-sm">Cargando directorio maestro desde Notion & KV...</p>
                </div>
              )}

              {itemsError && (
                <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 flex items-center space-x-3 flex-shrink-0">
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  <p className="text-sm">{itemsError}</p>
                </div>
              )}

              {/* Tabla Directorio Unificada y Ergonómica (Cero Doble Scroll) */}
              {!isLoadingItems && !itemsError && (
                <div className="flex-1 min-h-0 border border-slate-800 rounded-xl overflow-auto bg-slate-900/60 custom-scrollbar relative shadow-inner">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#111827] text-slate-300 uppercase tracking-wider sticky top-0 z-10 border-b border-slate-800 shadow-sm">
                      <tr>
                        {CATALOG_COLUMNS.filter(col => visibleColumns.includes(col.key)).map(col => {
                          const isSorted = sortConfig?.key === col.key;
                          const cellPy = density === 'compact' ? 'py-2' : 'py-3';
                          return (
                            <th
                              key={col.key}
                              onClick={() => col.sortable && handleSort(col.key)}
                              className={`px-3 ${cellPy} font-semibold select-none ${
                                col.sortable ? 'cursor-pointer hover:bg-slate-800/80 hover:text-white transition-colors' : ''
                              } ${col.align === 'center' ? 'text-center' : col.align === 'right' ? 'text-right' : 'text-left'}`}
                            >
                              <div className={`inline-flex items-center gap-1.5 ${
                                col.align === 'center' ? 'justify-center' : col.align === 'right' ? 'justify-end' : 'justify-start'
                              }`}>
                                <span>{col.label}</span>
                                {col.sortable && (
                                  <span>
                                    {isSorted ? (
                                      sortConfig.direction === 'asc' ? (
                                        <ArrowUp className="w-3.5 h-3.5 text-blue-400" />
                                      ) : (
                                        <ArrowDown className="w-3.5 h-3.5 text-blue-400" />
                                      )
                                    ) : (
                                      <ArrowUpDown className="w-3 h-3 text-slate-600 opacity-60 hover:opacity-100" />
                                    )}
                                  </span>
                                )}
                              </div>
                            </th>
                          );
                        })}
                        <th className={`px-3 ${density === 'compact' ? 'py-2' : 'py-3'} text-right font-semibold text-slate-300 uppercase tracking-wider`}>
                          Acciones
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80">
                      {sortedCatalogItems.length === 0 ? (
                        <tr>
                          <td colSpan={visibleColumns.length + 1} className="text-center py-12 text-slate-500">
                            No se encontraron insumos con los filtros seleccionados.
                          </td>
                        </tr>
                      ) : (
                        sortedCatalogItems.map(item => {
                          const cellPad = density === 'compact' ? 'py-1.5' : 'py-2.5';
                          return (
                            <tr key={item.id} className="hover:bg-slate-800/40 transition-colors">
                              {visibleColumns.includes('codigo') && (
                                <td className={`px-3 ${cellPad} font-mono font-medium text-blue-400 whitespace-nowrap`}>
                                  <div>{item.codigo}</div>
                                  {!visibleColumns.includes('codigoValery') && item.codigoValery && (
                                    <span className="text-[10px] text-amber-400 font-normal">
                                      V: {item.codigoValery}
                                    </span>
                                  )}
                                </td>
                              )}

                              {visibleColumns.includes('nombre') && (
                                <td className={`px-3 ${cellPad}`}>
                                  <div className="font-semibold text-slate-100">{item.nombre || 'Insumo sin Nombre'}</div>
                                  {!visibleColumns.includes('marca') && item.marca && (
                                    <span className="text-[10px] text-slate-400">Marca: {item.marca}</span>
                                  )}
                                </td>
                              )}

                              {visibleColumns.includes('codigoValery') && (
                                <td className={`px-3 ${cellPad} font-mono text-amber-300 whitespace-nowrap text-xs`}>
                                  {item.codigoValery || <span className="text-slate-600">—</span>}
                                </td>
                              )}

                              {visibleColumns.includes('marca') && (
                                <td className={`px-3 ${cellPad} text-slate-300 whitespace-nowrap text-xs`}>
                                  {item.marca || <span className="text-slate-600">—</span>}
                                </td>
                              )}

                              {visibleColumns.includes('categoria') && (
                                <td className={`px-3 ${cellPad} whitespace-nowrap`}>
                                  <span className="inline-block px-1.5 py-0.5 rounded bg-slate-800 text-[11px] text-slate-300">
                                    {item.categoria}
                                  </span>
                                  {!visibleColumns.includes('dimensiones') && item.dimensiones && (
                                    <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                      {item.dimensiones}
                                    </div>
                                  )}
                                </td>
                              )}

                              {visibleColumns.includes('rolMaterial') && (
                                <td className={`px-3 ${cellPad} text-slate-400 whitespace-nowrap text-xs`}>
                                  {item.rolMaterial || <span className="text-slate-600">—</span>}
                                </td>
                              )}

                              {visibleColumns.includes('dimensiones') && (
                                <td className={`px-3 ${cellPad} font-mono text-xs text-slate-300 whitespace-nowrap`}>
                                  {item.dimensiones || <span className="text-slate-600">—</span>}
                                </td>
                              )}

                              {visibleColumns.includes('color') && (
                                <td className={`px-3 ${cellPad} text-xs text-slate-300 whitespace-nowrap`}>
                                  {item.color || <span className="text-slate-600">—</span>}
                                </td>
                              )}

                              {visibleColumns.includes('unidad') && (
                                <td className={`px-3 ${cellPad} text-center font-semibold text-slate-300 whitespace-nowrap`}>
                                  {item.unidad}
                                </td>
                              )}

                              {visibleColumns.includes('stockBase') && (
                                <td className={`px-3 ${cellPad} text-right font-mono whitespace-nowrap`}>
                                  <div className={item.stockBase <= item.stockMinimo ? 'text-amber-400 font-bold' : 'text-slate-200'}>
                                    {item.stockBase}
                                  </div>
                                  {!visibleColumns.includes('stockMinimo') && (
                                    <div className="text-[10px] text-slate-500">
                                      Mín: {item.stockMinimo}
                                    </div>
                                  )}
                                </td>
                              )}

                              {visibleColumns.includes('stockMinimo') && (
                                <td className={`px-3 ${cellPad} text-right font-mono text-slate-400 whitespace-nowrap text-xs`}>
                                  {item.stockMinimo}
                                </td>
                              )}

                              {visibleColumns.includes('costoUSD') && (
                                <td className={`px-3 ${cellPad} text-right font-mono whitespace-nowrap`}>
                                  <div className="text-slate-100 font-medium">
                                    ${(item.costoUnitarioUSD || 0).toFixed(2)}
                                  </div>
                                  {!visibleColumns.includes('costoBS') && bcvRate > 0 && (
                                    <div className="text-[10px] text-slate-400">
                                      Bs. {((item.costoUnitarioUSD || 0) * bcvRate).toFixed(2)}
                                    </div>
                                  )}
                                </td>
                              )}

                              {visibleColumns.includes('costoBS') && (
                                <td className={`px-3 ${cellPad} text-right font-mono text-xs text-slate-300 whitespace-nowrap`}>
                                  {bcvRate > 0 ? `Bs. ${((item.costoUnitarioUSD || 0) * bcvRate).toFixed(2)}` : '—'}
                                </td>
                              )}

                              {visibleColumns.includes('ubicacion') && (
                                <td className={`px-3 ${cellPad} text-xs text-slate-300 whitespace-nowrap`}>
                                  {item.ubicacion || <span className="text-slate-600">—</span>}
                                </td>
                              )}

                              {visibleColumns.includes('estado') && (
                                <td className={`px-3 ${cellPad} text-center whitespace-nowrap`}>
                                  {item.activo ? (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                      Activo
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
                                      Descontinuado
                                    </span>
                                  )}
                                </td>
                              )}

                              <td className={`px-3 ${cellPad} text-right space-x-1 whitespace-nowrap`}>
                                <button
                                  onClick={() => openEditForm(item)}
                                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs transition"
                                  title="Editar Ficha Técnica"
                                >
                                  Editar
                                </button>
                                <button
                                  onClick={() => openLabelPrint(item)}
                                  className="p-1 bg-slate-800 hover:bg-slate-700 text-blue-400 rounded transition inline-block align-middle"
                                  title="Imprimir Rótulo de Gaveta"
                                >
                                  <Printer className="w-3.5 h-3.5" />
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
          )}

          {/* ================================================================ */}
          {/* PESTAÑA 2: FICHA TÉCNICA (CREAR / EDITAR) */}
          {/* ================================================================ */}
          {activeTab === 'form' && (
            <div className="space-y-6 max-w-4xl mx-auto">
              {/* Encabezado del Formulario */}
              <div className="flex items-center justify-between bg-slate-900 p-4 rounded-xl border border-slate-800">
                <div className="flex items-center space-x-3">
                  <div className={`p-2 rounded-lg ${formMode === 'create' ? 'bg-blue-600/20 text-blue-400' : 'bg-amber-600/20 text-amber-400'}`}>
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-base">
                      {formMode === 'create' ? 'Alta de Nuevo Insumo (Mutación Dual Atómica)' : `Editar Ficha Técnica: ${editingItem?.nombre}`}
                    </h3>
                    <p className="text-xs text-slate-400">
                      {formMode === 'create'
                        ? 'Crea simultáneamente en BD_Catalogo_Insumos y BD_Control_Stock_Existencias con compensación automática.'
                        : `SKU: ${editingItem?.codigo} | Notion ID: ${editingItem?.insumoId}`}
                    </p>
                  </div>
                </div>

                {formMode === 'edit' && (
                  <button
                    onClick={resetFormToCreate}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-lg flex items-center space-x-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Crear Otro</span>
                  </button>
                )}
              </div>

              {/* Banner de mensajes de éxito / error */}
              {formSuccessMessage && (
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-300 flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-semibold">{formSuccessMessage}</p>
                      <p className="text-xs text-emerald-400/80">Sincronizado en Edge KV y disponible inmediatamente en el inventario.</p>
                    </div>
                  </div>
                  {lastSavedItem && (
                    <button
                      onClick={() => openLabelPrint(lastSavedItem)}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 shadow"
                    >
                      <Printer className="w-4 h-4" />
                      <span>Rótulo Gaveta</span>
                    </button>
                  )}
                </div>
              )}

              {formError && (
                <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 flex items-center space-x-3">
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  <p className="text-sm">{formError}</p>
                </div>
              )}

              {/* SECCIÓN 1: ONTOLOGÍA DE CONCEPTOS ISO */}
              <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-xl space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2 text-blue-400">
                    <Sparkles className="w-4 h-4" />
                    <h4 className="text-xs font-bold uppercase tracking-wider">
                      1. Asistente Ontológico ISO (Diccionario de Conceptos)
                    </h4>
                  </div>
                  <span className="text-[11px] text-slate-400">
                    Hereda prefijo SKU y patrón sintáctico
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Concepto Raíz ISO
                    </label>
                    <select
                      value={selectedConceptId}
                      onChange={e => handleConceptSelect(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                    >
                      <option value="">-- Seleccionar Concepto ISO --</option>
                      {concepts.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.codePrefix})
                        </option>
                      ))}
                    </select>
                  </div>

                  {currentConcept && (
                    <div className="bg-slate-800/60 p-3 rounded-lg border border-slate-700 text-xs space-y-1">
                      <div className="text-slate-400">
                        Patrón ISO: <span className="font-mono text-blue-300">{currentConcept.namingPattern || 'Sin patrón'}</span>
                      </div>
                      <div className="text-slate-400">
                        UoM sugerida: <span className="font-semibold text-emerald-400">{currentConcept.defaultUoM}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Modificadores dinámicos del concepto si existen */}
                {currentConcept && currentConcept.requiredModifiers && currentConcept.requiredModifiers.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-800 space-y-2">
                    <label className="block text-xs font-medium text-slate-300">
                      Modificadores Requeridos para Nombre ISO:
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {currentConcept.requiredModifiers.map(mod => (
                        <div key={mod}>
                          <input
                            type="text"
                            placeholder={mod}
                            value={inputModifiers[mod] || ''}
                            onChange={e => setInputModifiers({ ...inputModifiers, [mod]: e.target.value })}
                            className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-slate-100 placeholder-slate-500 focus:border-blue-500"
                          />
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={applyIsoNamingPattern}
                      className="text-xs px-2.5 py-1 bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 border border-blue-500/30 rounded flex items-center space-x-1"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>Construir Nombre con Modificadores</span>
                    </button>
                  </div>
                )}
              </div>

              {/* SECCIÓN 2: IDENTIFICACIÓN PRINCIPAL */}
              <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-xl space-y-4">
                <div className="flex items-center space-x-2 text-slate-200">
                  <Tag className="w-4 h-4 text-blue-400" />
                  <h4 className="text-xs font-bold uppercase tracking-wider">
                    2. Identificación & Clasificación
                  </h4>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Nombre Oficial del Insumo / Material *
                    </label>
                    <input
                      type="text"
                      value={nombre}
                      onChange={e => setNombre(e.target.value)}
                      placeholder="Ej: TUERCA, HEXAGONAL, 1/4 PULG, ZINCADA"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 font-semibold focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-medium text-slate-300">
                          Código (SKU) *
                        </label>
                        <button
                          type="button"
                          onClick={handleGenerateSku}
                          className="text-[10px] text-blue-400 hover:underline flex items-center space-x-0.5"
                        >
                          <Sparkles className="w-3 h-3" />
                          <span>Generar</span>
                        </button>
                      </div>
                      <input
                        type="text"
                        value={codigo}
                        onChange={e => setCodigo(e.target.value.toUpperCase())}
                        onBlur={handleCodeBlur}
                        placeholder="Ej: TUE-0012"
                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm font-mono text-blue-300 uppercase focus:outline-none focus:border-blue-500"
                      />
                      {codeDuplicateWarning && (
                        <p className="text-[11px] text-amber-400 mt-1 flex items-center space-x-1">
                          <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                          <span>{codeDuplicateWarning}</span>
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        Código Valery (BOM)
                      </label>
                      <input
                        type="text"
                        value={codigoValery}
                        onChange={e => setCodigoValery(e.target.value.toUpperCase())}
                        placeholder="Ej: M01-0045"
                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm font-mono text-slate-200 uppercase focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        Marca / Proveedor Frecuente
                      </label>
                      <input
                        type="text"
                        value={marca}
                        onChange={e => setMarca(e.target.value)}
                        placeholder="Ej: Stanley, Masisa, Henkel..."
                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        Categoría de Material
                      </label>
                      <select
                        value={categoria}
                        onChange={e => setCategoria(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                      >
                        {CATEGORIAS_INSUMO.map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        Rol del Material
                      </label>
                      <select
                        value={rolMaterial}
                        onChange={e => setRolMaterial(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                      >
                        {ROLES_MATERIAL.map(r => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-medium text-slate-300">
                          Unidad de Medida (UoM) *
                        </label>
                        {editingItem?.hasKardexMovements && (
                          <span className="text-[10px] text-amber-400 flex items-center space-x-0.5">
                            <Lock className="w-2.5 h-2.5" />
                            <span>Bloqueada</span>
                          </span>
                        )}
                      </div>
                      <select
                        value={unidad}
                        disabled={editingItem?.hasKardexMovements}
                        onChange={e => setUnidad(e.target.value)}
                        className={`w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-blue-500 ${
                          editingItem?.hasKardexMovements ? 'opacity-60 cursor-not-allowed bg-slate-900' : ''
                        }`}
                      >
                        {UOM_OPTIONS.map(u => (
                          <option key={u.value} value={u.value}>{u.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* SECCIÓN 3: DIMENSIONES FÍSICAS */}
              <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-xl space-y-4">
                <div className="flex items-center space-x-2 text-slate-200">
                  <Sliders className="w-4 h-4 text-blue-400" />
                  <h4 className="text-xs font-bold uppercase tracking-wider">
                    3. Dimensiones Físicas & Acabado
                  </h4>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Largo (mm)
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={largo}
                      onChange={e => setLargo(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm font-mono text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Ancho (mm)
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={ancho}
                      onChange={e => setAncho(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm font-mono text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Espesor (mm)
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={espesor}
                      onChange={e => setEspesor(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm font-mono text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Color / Tono
                    </label>
                    <input
                      type="text"
                      value={color}
                      onChange={e => setColor(e.target.value)}
                      placeholder="Ej: Roble, Blanco, Zinc"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200"
                    />
                  </div>
                </div>
              </div>

              {/* SECCIÓN 4: PARÁMETROS DE ALMACÉN & COSTEO */}
              <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-xl space-y-4">
                <div className="flex items-center space-x-2 text-slate-200">
                  <DollarSign className="w-4 h-4 text-emerald-400" />
                  <h4 className="text-xs font-bold uppercase tracking-wider">
                    4. Costo Base & Parámetros de Almacén
                  </h4>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Costo Base ($ USD) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={costoUSD}
                      onChange={e => setCostoUSD(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm font-mono font-bold text-emerald-400 focus:outline-none focus:border-emerald-500"
                    />
                    {bcvRate > 0 && (
                      <p className="text-[11px] text-slate-400 mt-1">
                        ≈ Bs. {((parseFloat(costoUSD) || 0) * bcvRate).toFixed(2)} (Tasa: {bcvRate})
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Ubicación (Pasillo / Gaveta)
                    </label>
                    <input
                      type="text"
                      value={ubicacion}
                      onChange={e => setUbicacion(e.target.value)}
                      placeholder="Ej: Pasillo B - Gaveta 14"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Stock Mínimo (Punto de Reorden)
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={stockMinimo}
                      onChange={e => setStockMinimo(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm font-mono text-slate-200"
                    />
                  </div>
                </div>

                {/* Switch de Estado Activo / Descontinuado */}
                <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-slate-200">
                      Estado Operativo del Insumo
                    </span>
                    <p className="text-[11px] text-slate-400">
                      Si se descontinúa, no podrá agregarse a nuevas Órdenes de Abastecimiento (OAB).
                    </p>
                  </div>
                  <div className="flex items-center space-x-3">
                    {formMode === 'edit' && editingItem && editingItem.stockBase > 0 && (
                      <span className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded flex items-center space-x-1">
                        <Lock className="w-3 h-3" />
                        <span>Saldo físico activo: {editingItem.stockBase} {editingItem.unidad}</span>
                      </span>
                    )}
                    <label className={`relative inline-flex items-center ${formMode === 'edit' && editingItem && editingItem.stockBase > 0 ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                      <input
                        type="checkbox"
                        checked={activo}
                        disabled={Boolean(formMode === 'edit' && editingItem && (editingItem.stockBase ?? 0) > 0)}
                        onChange={e => setActivo(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                      <span className="ml-3 text-xs font-medium text-slate-300">
                        {activo ? 'Activo' : 'Descontinuado'}
                      </span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Botones de acción */}
              <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setActiveTab('directory')}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition"
                >
                  Volver al Directorio
                </button>
                <button
                  type="button"
                  onClick={handleSaveForm}
                  disabled={isSaving}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white text-xs font-bold rounded-lg shadow-lg flex items-center space-x-2 transition"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Guardando en Notion...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4" />
                      <span>{formMode === 'create' ? 'Crear Insumo Dual' : 'Guardar Ficha Técnica'}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ================================================================ */}
          {/* PESTAÑA 3: CATALOG HEALTH CHECKER & BULK COSTS */}
          {/* ================================================================ */}
          {activeTab === 'health' && (
            <div className="space-y-6">
              {/* Tarjetas KPI de Diagnóstico */}
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center space-x-2">
                    <Activity className="w-5 h-5 text-emerald-400" />
                    <span>Catalog Health Checker (Diagnóstico & Auto-Sanación)</span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    Inspección continua de integridad referencial entre Catálogo, Control de Stock y Ontología ISO.
                  </p>
                </div>
                <button
                  onClick={() => loadAuditData(true)}
                  disabled={isLoadingAudit}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg flex items-center space-x-1.5 border border-slate-700 transition"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingAudit ? 'animate-spin' : ''}`} />
                  <span>Re-auditar Ahora</span>
                </button>
              </div>

              {isLoadingAudit && (
                <div className="py-12 flex flex-col items-center justify-center text-slate-400">
                  <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mb-2" />
                  <p className="text-sm">Analizando integridad referencial y códigos duplicados...</p>
                </div>
              )}

              {auditError && (
                <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 flex items-center space-x-3">
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  <p className="text-sm">{auditError}</p>
                </div>
              )}

              {bulkSuccessMsg && (
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-300 flex items-center space-x-3">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                  <p className="text-sm font-semibold">{bulkSuccessMsg}</p>
                </div>
              )}

              {!isLoadingAudit && auditReport && (
                <>
                  {/* Tarjetas Semáforo */}
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
                      <div>
                        <span className="text-xs text-slate-400">Health Score</span>
                        <div className="text-2xl font-black text-white mt-1">
                          {auditReport.score}%
                        </div>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          auditReport.healthStatus === 'EXCELENTE' ? 'bg-emerald-500/10 text-emerald-400' :
                          auditReport.healthStatus === 'BUENO' ? 'bg-blue-500/10 text-blue-400' :
                          auditReport.healthStatus === 'ATENCION' ? 'bg-amber-500/10 text-amber-400' : 'bg-rose-500/10 text-rose-400'
                        }`}>
                          {auditReport.healthStatus}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-800 rounded-xl text-slate-400">
                        <ShieldCheck className="w-6 h-6" />
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-800/40 flex items-center justify-between">
                      <div>
                        <span className="text-xs text-amber-300">Insumos Huérfanos</span>
                        <div className="text-2xl font-black text-amber-400 mt-1">
                          {auditReport.kpis.countOrphans}
                        </div>
                        <p className="text-[10px] text-slate-400">Sin ficha en Control Stock</p>
                      </div>
                      {auditReport.kpis.countOrphans > 0 && (
                        <button
                          onClick={handleHealAllOrphans}
                          disabled={isHealingOrphans}
                          className="px-2.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-bold flex items-center space-x-1 shadow"
                        >
                          {isHealingOrphans ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wrench className="w-3 h-3" />}
                          <span>Sanar</span>
                        </button>
                      )}
                    </div>

                    <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
                      <div>
                        <span className="text-xs text-slate-400">Sin Costo ($0.00 USD)</span>
                        <div className="text-2xl font-black text-slate-200 mt-1">
                          {auditReport.kpis.countZeroCost}
                        </div>
                        <p className="text-[10px] text-slate-400">Candidatos a Quick-Fix</p>
                      </div>
                      <div className="p-3 bg-slate-800 rounded-xl text-emerald-400">
                        <DollarSign className="w-6 h-6" />
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-rose-950/20 border border-rose-800/40 flex items-center justify-between">
                      <div>
                        <span className="text-xs text-rose-300">Códigos Duplicados</span>
                        <div className="text-2xl font-black text-rose-400 mt-1">
                          {auditReport.kpis.countDuplicateCode}
                        </div>
                        <p className="text-[10px] text-slate-400">Riesgo de colisión SKU</p>
                      </div>
                      <div className="p-3 bg-slate-800 rounded-xl text-rose-400">
                        <AlertTriangle className="w-6 h-6" />
                      </div>
                    </div>
                  </div>

                  {/* Selector de Sub-pestañas: Incidencias vs Bulk Quick-Fix */}
                  <div className="flex items-center space-x-2 border-b border-slate-800 pt-2">
                    <button
                      onClick={() => setHealthSubTab('issues')}
                      className={`pb-2 text-xs font-bold flex items-center space-x-1.5 border-b-2 transition ${
                        healthSubTab === 'issues'
                          ? 'border-blue-500 text-blue-400'
                          : 'border-transparent text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <AlertCircle className="w-4 h-4" />
                      <span>Incidencias de Integridad ({auditReport.issues.length})</span>
                    </button>
                    <button
                      onClick={() => setHealthSubTab('bulk_costs')}
                      className={`pb-2 text-xs font-bold flex items-center space-x-1.5 border-b-2 transition ${
                        healthSubTab === 'bulk_costs'
                          ? 'border-emerald-500 text-emerald-400'
                          : 'border-transparent text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <DollarSign className="w-4 h-4" />
                      <span>Edición Rápida de Costos en Lote ({auditReport.zeroCostCandidates.length})</span>
                    </button>
                  </div>

                  {/* SUB-VISTA A: LISTA DE INCIDENCIAS */}
                  {healthSubTab === 'issues' && (
                    <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-900/60">
                      <div className="overflow-x-auto max-h-[45vh]">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-[#111827] text-slate-300 uppercase tracking-wider sticky top-0 z-10 border-b border-slate-800">
                            <tr>
                              <th className="px-3 py-2.5">Severidad</th>
                              <th className="px-3 py-2.5">Tipo</th>
                              <th className="px-3 py-2.5">Insumo Afectado</th>
                              <th className="px-3 py-2.5">Diagnóstico Forense</th>
                              <th className="px-3 py-2.5 text-right">Acción</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/80">
                            {auditReport.issues.length === 0 ? (
                              <tr>
                                <td colSpan={5} className="text-center py-8 text-emerald-400 font-semibold">
                                  ¡Excelente! No se detectaron anomalías en el catálogo de insumos.
                                </td>
                              </tr>
                            ) : (
                              auditReport.issues.map(iss => (
                                <tr key={iss.id} className="hover:bg-slate-800/40 transition-colors">
                                  <td className="px-3 py-2.5 whitespace-nowrap">
                                    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                                      iss.severity === 'CRITICAL' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30' :
                                      iss.severity === 'WARNING' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30' :
                                      'bg-blue-500/10 text-blue-400 border border-blue-500/30'
                                    }`}>
                                      {iss.severity}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2.5 font-mono text-slate-300">
                                    {iss.tipo}
                                  </td>
                                  <td className="px-3 py-2.5">
                                    <div className="font-semibold text-slate-100">{iss.nombre}</div>
                                    <span className="text-[10px] text-slate-400 font-mono">
                                      {iss.codigo || 'SIN CÓDIGO'}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2.5 text-slate-300">
                                    {iss.mensaje}
                                  </td>
                                  <td className="px-3 py-2.5 text-right">
                                    <button
                                      onClick={() => {
                                        const match = catalogItems.find(i => i.id === iss.insumoId || i.insumoId === iss.insumoId);
                                        if (match) openEditForm(match);
                                        else alert(`Insumo ID ${iss.insumoId} no encontrado en caché local.`);
                                      }}
                                      className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs transition"
                                    >
                                      Corregir
                                    </button>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* SUB-VISTA B: BULK COSTS EDIT */}
                  {healthSubTab === 'bulk_costs' && (
                    <div className="space-y-4">
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl flex items-center justify-between text-xs">
                        <span className="text-slate-300">
                          Ingrese los costos base para los insumos con costo $0.00 USD y presione guardar lote.
                        </span>
                        <button
                          onClick={handleSaveBulkCosts}
                          disabled={isSavingBulkCosts || auditReport.zeroCostCandidates.length === 0}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 text-white font-bold rounded-lg flex items-center space-x-1.5 shadow"
                        >
                          {isSavingBulkCosts ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                          <span>Guardar Costos Masivos</span>
                        </button>
                      </div>

                      <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-900/60 max-h-[45vh] overflow-y-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-[#111827] text-slate-300 uppercase tracking-wider sticky top-0 z-10 border-b border-slate-800">
                            <tr>
                              <th className="px-3 py-2.5">Código</th>
                              <th className="px-3 py-2.5">Nombre Insumo</th>
                              <th className="px-3 py-2.5">Categoría</th>
                              <th className="px-3 py-2.5 text-center">UoM</th>
                              <th className="px-3 py-2.5 text-right">Nuevo Costo USD ($)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/80">
                            {auditReport.zeroCostCandidates.length === 0 ? (
                              <tr>
                                <td colSpan={5} className="text-center py-8 text-emerald-400 font-semibold">
                                  Todos los insumos del catálogo se encuentran debidamente costados.
                                </td>
                              </tr>
                            ) : (
                              auditReport.zeroCostCandidates.map(cand => (
                                <tr key={cand.id} className="hover:bg-slate-800/30">
                                  <td className="px-3 py-2 font-mono text-blue-400">{cand.codigo || '—'}</td>
                                  <td className="px-3 py-2 font-medium text-slate-100">{cand.nombre}</td>
                                  <td className="px-3 py-2 text-slate-400">{cand.categoria}</td>
                                  <td className="px-3 py-2 text-center font-semibold text-slate-300">{cand.uom}</td>
                                  <td className="px-3 py-2 text-right">
                                    <div className="inline-flex items-center space-x-1">
                                      <span className="text-slate-500">$</span>
                                      <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        placeholder="0.00"
                                        value={bulkCostValues[cand.id] || ''}
                                        onChange={e => setBulkCostValues({ ...bulkCostValues, [cand.id]: e.target.value })}
                                        className="w-24 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-right font-mono text-emerald-400 focus:outline-none focus:border-emerald-500"
                                      />
                                    </div>
                                  </td>
                                </tr>
                              ))
                            )}
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

        {/* ------------------------------------------------------------------ */}
        {/* PIE DEL MODAL */}
        {/* ------------------------------------------------------------------ */}
        <div className="px-6 py-3 border-t border-slate-800 bg-[#131E35] flex items-center justify-between text-xs text-slate-400">
          <div>
            Sesión: <span className="font-semibold text-slate-200">{currentUser?.name || 'Operador Sanesca'}</span> | Tasa BCV: <span className="font-mono text-slate-200">{bcvRate.toFixed(2)} Bs/$</span>
          </div>
          <div>
            Sanesca PRO • Módulo de Gestión Maestra v2.0
          </div>
        </div>

      </div>

      {/* -------------------------------------------------------------------- */}
      {/* SUB-MODAL: RÓTULO TÉRMICO DE GAVETA / ANAQUEL */}
      {/* -------------------------------------------------------------------- */}
      {labelItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-md w-full shadow-2xl text-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2 text-blue-400">
                <Printer className="w-5 h-5" />
                <h3 className="font-bold text-base text-white">Rótulo de Gaveta / Anaquel</h3>
              </div>
              <button
                onClick={() => setLabelItem(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Vista previa de etiqueta física */}
            <div className="p-4 bg-white text-black rounded-lg border-2 border-black font-sans space-y-2 select-all">
              <div className="flex justify-between items-start border-b border-black pb-1">
                <div>
                  <div className="font-black text-sm tracking-tighter">SANESCA PRO</div>
                  <div className="text-[9px] uppercase font-bold text-neutral-700">Rótulo Maestro Almacén</div>
                </div>
                <div className="text-right">
                  <div className="font-mono font-black text-base">{labelItem.codigo}</div>
                  {labelItem.codigoValery && (
                    <div className="text-[9px] font-mono font-bold">VALERY: {labelItem.codigoValery}</div>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-3 pt-1">
                {labelQrUrl && (
                  <img src={labelQrUrl} alt="QR Insumo" className="w-20 h-20 border border-black p-0.5 flex-shrink-0" />
                )}
                <div className="flex-1 text-xs">
                  <div className="font-bold text-[11px] leading-tight line-clamp-2 uppercase">
                    {labelItem.nombre}
                  </div>
                  <div className="mt-1 text-[10px] text-neutral-800 font-semibold">
                    Categoría: {labelItem.categoria}
                  </div>
                  <div className="text-[10px] text-neutral-800">
                    Ubicación: <span className="font-bold">{labelItem.ubicacion || 'PASILLO GRAL'}</span>
                  </div>
                  <div className="text-[10px] text-neutral-800">
                    UoM: <span className="font-bold">{labelItem.unidad}</span> | Mín: <span className="font-bold">{labelItem.stockMinimo}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                onClick={() => setLabelItem(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg"
              >
                Cerrar
              </button>
              <button
                onClick={handlePrintLabel}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg flex items-center space-x-1.5 shadow"
              >
                <Printer className="w-4 h-4" />
                <span>Imprimir Rótulo</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
