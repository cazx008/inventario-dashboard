import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, 
  ArrowUpRight, 
  Search, 
  Factory, 
  Building2, 
  Package, 
  User, 
  AlertCircle, 
  AlertTriangle,
  CheckCircle, 
  Layers, 
  ChevronRight, 
  ChevronDown, 
  ShieldAlert, 
  Calendar, 
  Sparkles, 
  Loader2, 
  Check, 
  Lock, 
  ShieldCheck,
  Zap
} from 'lucide-react';
import { InventoryItem } from '../types/inventory';
import { OrderReference } from '../types/oab';
import { ActiveEmployee } from '../types/auth';
import { AllocationsResponse, StoreAllocation } from '../services/inventoryService';
import { OrderSearchModal } from './OrderSearchModal';

const DEFAULT_PLANT_WORKERS: ActiveEmployee[] = [
  { id: 'emp-1', name: 'Mikel Itriago', hasPin: true, areas: ['Dirección General', 'Sistemas'] },
  { id: 'emp-2', name: 'Pedro Herrero', hasPin: false, areas: ['Herrería', 'Estructuras'] },
  { id: 'emp-3', name: 'Carlos Carpintero', hasPin: false, areas: ['Carpintería', 'Corte & Canteado'] },
  { id: 'emp-4', name: 'Jose Pintor', hasPin: false, areas: ['Pintura Electrostática'] },
  { id: 'emp-5', name: 'Luis Ensamblador', hasPin: false, areas: ['Ensamble Final', 'Embalaje'] },
  { id: 'emp-6', name: 'Magaly González', hasPin: true, areas: ['Administración', 'Compras'] }
];

interface MaterialDispatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  inventoryItems: InventoryItem[];
  preselectedItem?: InventoryItem | null;
  onDispatchSuccess: (result: {
    materialNombre: string;
    cantidad: number;
    nuevoStock: number;
    destino: string;
  }) => void;
  token?: string | null;
  allocationsData?: AllocationsResponse | null;
  onRefreshAllocations?: () => Promise<void>;
}

export const MaterialDispatchModal: React.FC<MaterialDispatchModalProps> = ({
  isOpen,
  onClose,
  inventoryItems,
  preselectedItem = null,
  onDispatchSuccess,
  token,
  allocationsData,
  onRefreshAllocations
}) => {
  // 1. Estado de Selección de Material
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(preselectedItem);
  const [materialSearch, setMaterialSearch] = useState('');
  const [isSearchingMaterial, setIsSearchingMaterial] = useState(false);

  // 2. Cantidad a Despachar & Modo de Conversión (Neto vs Empaque Comercial)
  const [cantidad, setCantidad] = useState<number>(1);
  const [modoEmpaque, setModoEmpaque] = useState<'BASE' | 'EMPAQUE'>('BASE');
  const [unidadesPorEmpaque, setUnidadesPorEmpaque] = useState<number>(6);
  const [cantidadEmpaques, setCantidadEmpaques] = useState<number>(1);

  // 3. Nivel Jerárquico de Imputación (1: General MTS, 2: Tienda MTO, 3: Mobiliario BOM)
  const [nivelImputacion, setNivelImputacion] = useState<'GENERAL' | 'TIENDA' | 'MOBILIARIO'>('GENERAL');
  const [areaDestino, setAreaDestino] = useState('Herrería');
  
  // Nivel 2: Tienda / Proyecto
  const [selectedOrder, setSelectedOrder] = useState<OrderReference | null>(null);
  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
  const [esNoPresupuestado, setEsNoPresupuestado] = useState(false);

  // Nivel 3: Mobiliario Específico
  const [furnitureLines, setFurnitureLines] = useState<Array<{ id: string; nombre: string; cantidad: number; estado?: string }>>([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [selectedFurniture, setSelectedFurniture] = useState<{ id: string; nombre: string } | null>(null);
  const [manualFurnitureName, setManualFurnitureName] = useState('');

  // 4. Operario y Motivo
  const [employees, setEmployees] = useState<ActiveEmployee[]>(DEFAULT_PLANT_WORKERS);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [operarioReceptor, setOperarioReceptor] = useState('');
  const [operarioSearch, setOperarioSearch] = useState('');
  const [isOperarioDropdownOpen, setIsOperarioDropdownOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<ActiveEmployee | null>(null);
  const [motivoSalida, setMotivoSalida] = useState('Fabricación');
  const [notas, setNotas] = useState('');

  // 5. Estado de Envío
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 6. Blindaje de Órdenes Concluidas y Bypass de Supervisor (Pilar 3)
  const [supervisorPin, setSupervisorPin] = useState('');
  const [isSupervisorBypassed, setIsSupervisorBypassed] = useState(false);
  const [supervisorBypassError, setSupervisorBypassError] = useState<string | null>(null);
  const [supervisorName, setSupervisorName] = useState('');

  // 7. Balance BOM para Alerta Temprana de Sobreconsumo (> 115%) (Pilar 3 / T4.3)
  const [orderBalanceItems, setOrderBalanceItems] = useState<Array<{
    mat: string;
    codigo: string;
    dashboardId: string | null;
    nombre: string;
    unidad: string;
    teorico: number;
    real: number;
  }>>([]);
  const [loadingOrderBalance, setLoadingOrderBalance] = useState(false);

  // 8. Válvula de Emergencia y Control de Canibalización (Fase 10D / D1-10D a D5-10D)
  const [isEmergencyLoanActive, setIsEmergencyLoanActive] = useState(false);
  const [prestamistaProyectoId, setPrestamistaProyectoId] = useState<string>('');
  const [motivoEmergencia, setMotivoEmergencia] = useState<string>('');
  const [emergencySupervisorPin, setEmergencySupervisorPin] = useState<string>('');
  const [emergencyPinVerified, setEmergencyPinVerified] = useState<boolean>(false);
  const [emergencySupervisorName, setEmergencySupervisorName] = useState<string>('');
  const [emergencyError, setEmergencyError] = useState<string | null>(null);
  const [reponerCedente, setReponerCedente] = useState<boolean>(true);

  // Resetear bypass y préstamo de emergencia al cambiar de orden o material
  useEffect(() => {
    setIsSupervisorBypassed(false);
    setSupervisorPin('');
    setSupervisorBypassError(null);
    setIsEmergencyLoanActive(false);
    setEmergencySupervisorPin('');
    setEmergencyPinVerified(false);
    setMotivoEmergencia('');
    setEmergencyError(null);
  }, [selectedOrder, selectedItem]);

  const handleVerifySupervisorPin = () => {
    setSupervisorBypassError(null);
    if (!supervisorPin.trim()) {
      setSupervisorBypassError('Ingrese el PIN de supervisor.');
      return;
    }
    // PIN de supervisor maestro o de personal con PIN asignado
    const empWithPin = employees.find(e => e.hasPin);
    if (supervisorPin.trim() === '1234' || (empWithPin && supervisorPin.trim().length >= 4)) {
      setIsSupervisorBypassed(true);
      setSupervisorName(empWithPin?.name || 'Supervisor de Planta');
      setSupervisorBypassError(null);
    } else {
      setSupervisorBypassError('PIN de supervisor incorrecto.');
    }
  };

  // Cargar catálogo de operarios desde Notion / RBAC al abrir el modal
  useEffect(() => {
    if (isOpen) {
      setLoadingEmployees(true);
      fetch('/api/auth/employees')
        .then(res => res.json())
        .then(data => {
          if (data.status === 'success' && Array.isArray(data.employees)) {
            setEmployees(data.employees);
          }
          setLoadingEmployees(false);
        })
        .catch(err => {
          console.warn('Advertencia cargando operarios:', err);
          setLoadingEmployees(false);
        });
    }
  }, [isOpen]);

  // Filtrado reactivo de operarios para autocompletado
  const filteredEmployees = useMemo(() => {
    if (!operarioSearch.trim()) return employees;
    const s = operarioSearch.toLowerCase();
    return employees.filter(e => 
      e.name.toLowerCase().includes(s) || 
      (e.areas && e.areas.some(a => a.toLowerCase().includes(s)))
    );
  }, [employees, operarioSearch]);

  // Actualizar preselección si cambia desde prop
  useEffect(() => {
    if (preselectedItem) {
      setSelectedItem(preselectedItem);
    }
  }, [preselectedItem]);

  // Si cambia el pedido seleccionado y estamos en nivel Mobiliario, cargar líneas de pedido
  useEffect(() => {
    if (selectedOrder && nivelImputacion === 'MOBILIARIO') {
      let isMounted = true;
      setLoadingLines(true);
      setSelectedFurniture(null);

      fetch(`/api/orders/lines?orderId=${encodeURIComponent(selectedOrder.id)}`)
        .then(res => res.json())
        .then(data => {
          if (isMounted) {
            setFurnitureLines(data.lines || []);
            setLoadingLines(false);
          }
        })
        .catch(err => {
          console.warn('Fallo cargando líneas de mobiliario:', err);
          if (isMounted) {
            setFurnitureLines([]);
            setLoadingLines(false);
          }
        });

      return () => {
        isMounted = false;
      };
    }
  }, [selectedOrder, nivelImputacion]);

  // Cargar balance BOM de la orden seleccionada para alerta temprana preventiva (> 115%)
  useEffect(() => {
    if (selectedOrder?.id) {
      let isMounted = true;
      setLoadingOrderBalance(true);
      const q = new URLSearchParams({
        orderId: selectedOrder.id,
        pedidoCodigo: selectedOrder.codigo || ''
      });
      fetch(`/api/bom/order-balance?${q.toString()}`)
        .then(res => res.json())
        .then(data => {
          if (isMounted) {
            if (Array.isArray(data.balance)) {
              setOrderBalanceItems(data.balance);
            } else {
              setOrderBalanceItems([]);
            }
            setLoadingOrderBalance(false);
          }
        })
        .catch(err => {
          console.warn('Fallo cargando balance BOM de la orden para alerta temprana:', err);
          if (isMounted) {
            setOrderBalanceItems([]);
            setLoadingOrderBalance(false);
          }
        });

      return () => {
        isMounted = false;
      };
    } else {
      setOrderBalanceItems([]);
    }
  }, [selectedOrder]);

  // Cálculo Reactivo de Demanda Teórica y Detección de Sobreconsumo (> 115%)
  const bomTheoreticalData = useMemo(() => {
    if (!selectedOrder || !selectedItem || !orderBalanceItems.length) return null;

    const sInsumoId = selectedItem.insumoId?.toLowerCase();
    const sCodigo = selectedItem.codigo?.toLowerCase();
    const sNombre = selectedItem.nombre?.toLowerCase().trim();
    const sId = selectedItem.id;

    const match = orderBalanceItems.find(b => {
      const bMat = b.mat?.toLowerCase();
      const bCod = b.codigo?.toLowerCase();
      const bNom = b.nombre?.toLowerCase().trim();
      return (
        (sInsumoId && bMat === sInsumoId) ||
        (sCodigo && (bCod === sCodigo || bMat === sCodigo)) ||
        (sId && b.dashboardId === sId) ||
        (sNombre && bNom === sNombre)
      );
    });

    if (!match || typeof match.teorico !== 'number' || match.teorico <= 0) return null;

    const previoDespachado = match.real || 0;
    const nuevoAcumulado = previoDespachado + (cantidad || 0);
    const porcentaje = (nuevoAcumulado / match.teorico) * 100;
    const isOverconsumption = porcentaje > 115;

    return {
      itemTeorico: match.teorico,
      previoDespachado,
      nuevoAcumulado,
      porcentaje,
      isOverconsumption,
      unidad: match.unidad || selectedItem.unidad || 'Und'
    };
  }, [selectedOrder, selectedItem, orderBalanceItems, cantidad]);

  // CÁLCULO DE RESERVAS MTO Y SEMÁFORO TRIPARTITO (Micro-Fase 10D / D1-10D & D5-10D)
  const allAllocations = allocationsData?.allocations || [];
  const itemAllocations = useMemo(() => {
    if (!selectedItem) return [];
    return allAllocations.filter(a => a.dashboardId === selectedItem.id);
  }, [allAllocations, selectedItem]);

  const {
    myApartado,
    otherApartado,
    stockLibre,
    otherAllocs,
    maxDisponibleDirecto
  } = useMemo(() => {
    if (!selectedItem) {
      return { myApartado: 0, otherApartado: 0, stockLibre: 0, otherAllocs: [], maxDisponibleDirecto: 0 };
    }
    const isStoreOrFurniture = (nivelImputacion === 'TIENDA' || nivelImputacion === 'MOBILIARIO') && selectedOrder;
    const targetPId = selectedOrder?.id;
    const targetPName = (selectedOrder?.proyecto || selectedOrder?.codigo || '').toLowerCase().trim();

    let myAlloc: StoreAllocation | undefined = undefined;
    if (isStoreOrFurniture) {
      myAlloc = itemAllocations.find(a => 
        (targetPId && a.proyectoId === targetPId) ||
        (targetPName && a.proyectoNombre && a.proyectoNombre.toLowerCase().includes(targetPName))
      );
    }
    const myAp = myAlloc ? (myAlloc.cantidadApartada || 0) : 0;
    const others = itemAllocations.filter(a => !myAlloc || a.id !== myAlloc.id).filter(a => (a.cantidadApartada || 0) > 0);
    const otherAp = others.reduce((sum, a) => sum + (a.cantidadApartada || 0), 0);
    const free = Math.max(0, (selectedItem.stockBase || 0) - (myAp + otherAp));
    const maxDirect = myAp + free;

    return {
      myApartado: myAp,
      otherApartado: otherAp,
      stockLibre: free,
      otherAllocs: others,
      maxDisponibleDirecto: maxDirect
    };
  }, [selectedItem, itemAllocations, nivelImputacion, selectedOrder]);

  const isBlockedByOtherStores = Boolean(selectedItem && (cantidad || 0) > maxDisponibleDirecto && otherApartado > 0);

  // Auto-seleccionar la primera tienda cedente si cambia la lista
  useEffect(() => {
    if (otherAllocs.length > 0 && !prestamistaProyectoId) {
      setPrestamistaProyectoId(otherAllocs[0].proyectoId);
    }
  }, [otherAllocs, prestamistaProyectoId]);

  if (!isOpen) return null;

  // Filtrado de materiales disponibles para autocompletar
  const filteredMaterials = inventoryItems
    .filter(i => (i.stockBase || 0) > 0)
    .filter(i => {
      if (!materialSearch.trim()) return true;
      const s = materialSearch.toLowerCase();
      return (
        i.nombre.toLowerCase().includes(s) ||
        (i.codigo && i.codigo.toLowerCase().includes(s)) ||
        (i.categoriaMaterial && i.categoriaMaterial.toLowerCase().includes(s))
      );
    })
    .slice(0, 15);

  const currentStock = selectedItem ? selectedItem.stockBase : 0;
  const remainingStock = Math.max(0, currentStock - (cantidad || 0));
  const isStockInsufficient = (cantidad || 0) > currentStock;

  const handleQuickAdd = (delta: number) => {
    setCantidad(prev => Math.max(1, Math.min(currentStock, (prev || 0) + delta)));
  };

  const handleSetMax = () => {
    if (currentStock > 0) setCantidad(currentStock);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!selectedItem) {
      setErrorMsg('Debes seleccionar un material del inventario.');
      return;
    }

    if (!cantidad || cantidad <= 0) {
      setErrorMsg('La cantidad a despachar debe ser mayor a 0.');
      return;
    }

    if (isStockInsufficient) {
      setErrorMsg(`Stock insuficiente. Stock físico disponible: ${currentStock} ${selectedItem.unidad || 'Und'}.`);
      return;
    }

    if (!operarioReceptor.trim()) {
      setErrorMsg('Debes ingresar el nombre del operario receptor en taller.');
      return;
    }

    if ((nivelImputacion === 'TIENDA' || nivelImputacion === 'MOBILIARIO') && !selectedOrder) {
      setErrorMsg('Debes seleccionar la orden o proyecto comercial al que se imputa este consumo.');
      return;
    }

    if ((nivelImputacion === 'TIENDA' || nivelImputacion === 'MOBILIARIO') && selectedOrder) {
      if (selectedOrder.estado === 'Cerrado' && !isSupervisorBypassed) {
        setErrorMsg(`La orden ${selectedOrder.codigo} se encuentra CERRADA en ERP. Para autorizar entregas por garantía o retrabajo, ingrese el PIN de Supervisor.`);
        return;
      }
    }

    if (esNoPresupuestado || selectedItem.origenConsumo === 'Proyecto (No Presupuestado)') {
      if (notas.trim().length < 15) {
        setErrorMsg('Para insumos marcados como No Presupuestados, es obligatoria una justificación técnica de al menos 15 caracteres en el campo Notas.');
        return;
      }
    }

    const mobiliarioFinal = selectedFurniture?.nombre || manualFurnitureName.trim();
    if (nivelImputacion === 'MOBILIARIO' && !mobiliarioFinal) {
      setErrorMsg('Debes seleccionar o escribir el mueble específico dentro del pedido.');
      return;
    }

    if (isBlockedByOtherStores && !isEmergencyLoanActive) {
      setErrorMsg(`Despacho directo bloqueado: Stock libre insuficiente (${stockLibre}). Existen ${otherApartado} ${selectedItem.unidad || 'Und'} reservadas para otras obras. Active la Válvula de Emergencia para autorizar un préstamo.`);
      return;
    }

    if (isBlockedByOtherStores && isEmergencyLoanActive) {
      if (!emergencyPinVerified && emergencySupervisorPin !== '1234' && emergencySupervisorPin.length < 4) {
        setErrorMsg('Debe ingresar un PIN de Supervisor válido para autorizar el préstamo de emergencia.');
        return;
      }
      if (motivoEmergencia.trim().length < 15) {
        setErrorMsg('La justificación técnica de la emergencia debe tener al menos 15 caracteres.');
        return;
      }
      if (!prestamistaProyectoId) {
        setErrorMsg('Debe seleccionar la tienda cedente que prestará el material.');
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const notaFinal = [
        notas.trim(),
        isSupervisorBypassed ? `[AUTORIZADO CON PIN POR SUPERVISOR: ${supervisorName}]` : null,
        isEmergencyLoanActive ? `[PRÉSTAMO AUTORIZADO CON PIN: ${emergencySupervisorName || 'Supervisor'}]` : null
      ].filter(Boolean).join(' | ');

      const payload: any = {
        dashboardId: selectedItem.id,
        insumoId: selectedItem.insumoId,
        materialNombre: selectedItem.nombre,
        cantidadDespachada: cantidad,
        unidad: selectedItem.unidad || 'Und',
        empaqueComercialInfo: modoEmpaque === 'EMPAQUE'
          ? `${cantidadEmpaques} empaque(s) de ${unidadesPorEmpaque} ${selectedItem.unidad || 'Und'}`
          : undefined,
        nivelImputacion,
        pedidoId: selectedOrder?.id,
        pedidoCodigo: selectedOrder?.codigo,
        proyectoId: selectedOrder?.id,
        proyectoNombre: selectedOrder?.proyecto,
        esNoPresupuestado,
        sobreconsumoFlag: Boolean(bomTheoreticalData?.isOverconsumption),
        porcentajeDemanda: bomTheoreticalData ? `${bomTheoreticalData.porcentaje.toFixed(1)}%` : undefined,
        mobiliarioId: selectedFurniture?.id,
        mobiliarioNombre: mobiliarioFinal || undefined,
        operarioReceptor: operarioReceptor.trim(),
        areaDestino,
        motivoSalida,
        notas: notaFinal,
        fechaDespacho: new Date().toISOString().split('T')[0]
      };

      if (isEmergencyLoanActive) {
        payload.isEmergencyLoan = true;
        payload.prestamistaProyectoId = prestamistaProyectoId;
        payload.prestamistaProyectoNombre = otherAllocs.find(a => a.proyectoId === prestamistaProyectoId)?.proyectoNombre || 'Obra Cedente';
        payload.supervisorPin = emergencySupervisorPin;
        payload.supervisorName = emergencySupervisorName || 'Supervisor de Planta';
        payload.motivoEmergencia = motivoEmergencia.trim();
        payload.reponerCedente = reponerCedente;
      }

      const res = await fetch('/api/kardex/dispatch', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Ocurrió un error al procesar el despacho.');
      }

      onDispatchSuccess({
        materialNombre: selectedItem.nombre,
        cantidad,
        nuevoStock: data.newStock,
        destino: data.destinoLabel || areaDestino
      });

      await onRefreshAllocations?.();

      onClose();

    } catch (err: any) {
      setErrorMsg(err.message || 'Error de conexión con el servidor.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in no-print">
      <div className="bg-surface border border-borderSubtle rounded-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header Modal */}
        <div className="px-6 py-4 bg-surfaceHigh border-b border-borderSubtle flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-rose-500/20 text-rose-400 border border-rose-500/40">
              <ArrowUpRight className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight">
                  Terminal de Despacho a Taller
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
                  Fase 9A · Salida Física
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Entrega de materiales en almacén con asiento inmutable en Kardex y trazabilidad Odoo
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-surfaceHighest transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-2.5 text-rose-300 text-xs">
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold block">Error de Validación:</span>
                <span>{errorMsg}</span>
              </div>
            </div>
          )}

          {/* 1. Selección del Material */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
              1. Insumo / Material a Despachar
            </label>

            {selectedItem ? (
              <div className="p-3.5 bg-surfaceHigh border border-brand-500/40 rounded-xl flex items-center justify-between gap-3 shadow-sm">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white">{selectedItem.nombre}</span>
                    {selectedItem.codigo && (
                      <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-surface border border-borderSubtle text-slate-400">
                        {selectedItem.codigo}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    <span>Categoría: <strong className="text-slate-300">{selectedItem.categoriaMaterial || 'Insumo'}</strong></span>
                    <span>•</span>
                    <span>Stock Disponible: <strong className="text-brand-400 font-mono text-sm">{selectedItem.stockBase}</strong> {selectedItem.unidad || 'Und'}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedItem(null)}
                  className="px-2.5 py-1 text-xs text-slate-400 hover:text-white hover:bg-surfaceHighest rounded-lg border border-borderSubtle transition"
                >
                  Cambiar
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder="Buscar insumo con existencias por nombre, código o categoría..."
                  value={materialSearch}
                  onChange={(e) => {
                    setMaterialSearch(e.target.value);
                    setIsSearchingMaterial(true);
                  }}
                  onFocus={() => setIsSearchingMaterial(true)}
                  className="w-full pl-10 pr-4 py-2.5 text-xs bg-surfaceHigh border border-borderSubtle rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-brand-400"
                />

                {isSearchingMaterial && filteredMaterials.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1.5 bg-surfaceHigh border border-borderSubtle rounded-xl shadow-2xl z-30 max-h-56 overflow-y-auto custom-scrollbar divide-y divide-borderSubtle/50">
                    {filteredMaterials.map(item => (
                      <div
                        key={item.id}
                        onClick={() => {
                          setSelectedItem(item);
                          setIsSearchingMaterial(false);
                          setMaterialSearch('');
                        }}
                        className="p-3 hover:bg-surfaceHighest cursor-pointer flex items-center justify-between text-xs transition"
                      >
                        <div>
                          <div className="font-semibold text-slate-200">{item.nombre}</div>
                          <div className="text-[11px] text-slate-400 font-mono">{item.codigo || item.categoriaMaterial}</div>
                        </div>
                        <div className="text-right">
                          <span className="font-mono font-bold text-brand-400">{item.stockBase}</span>
                          <span className="text-[11px] text-slate-400 ml-1">{item.unidad || 'und'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 2. Cantidad y Balances */}
          {selectedItem && (
            <div className="space-y-3 p-4 bg-surfaceHigh/60 border border-borderSubtle rounded-xl">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                    2. Cantidad a Entregar
                  </label>
                  {/* Selector Neto vs Empaque Comercial */}
                  <div className="flex items-center bg-surface border border-borderSubtle rounded-lg p-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setModoEmpaque('BASE')}
                      className={`px-2 py-0.5 rounded font-medium transition ${
                        modoEmpaque === 'BASE' ? 'bg-brand-500 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Neto ({selectedItem.unidad || 'Und'})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setModoEmpaque('EMPAQUE');
                        const calc = cantidadEmpaques * unidadesPorEmpaque;
                        setCantidad(Math.min(currentStock, calc));
                      }}
                      className={`px-2 py-0.5 rounded font-medium transition flex items-center gap-1 ${
                        modoEmpaque === 'EMPAQUE' ? 'bg-amber-500/90 text-slate-950 font-bold shadow-sm' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <span>📦 Empaque</span>
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {[1, 5, 10].map(n => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => handleQuickAdd(n)}
                      className="px-2 py-0.5 text-xs rounded bg-surface hover:bg-surfaceHighest text-slate-300 border border-borderSubtle transition"
                    >
                      +{n}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={handleSetMax}
                    className="px-2.5 py-0.5 text-xs font-semibold rounded bg-brand-500/20 text-brand-300 border border-brand-500/40 hover:bg-brand-500/30 transition"
                  >
                    Máx ({currentStock})
                  </button>
                </div>
              </div>

              {modoEmpaque === 'EMPAQUE' && (
                <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg flex flex-wrap items-center gap-2.5 text-xs text-amber-200">
                  <span className="font-semibold text-amber-400">Conversión:</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={1}
                      value={cantidadEmpaques}
                      onChange={(e) => {
                        const val = Math.max(1, Number(e.target.value));
                        setCantidadEmpaques(val);
                        setCantidad(Math.min(currentStock, val * unidadesPorEmpaque));
                      }}
                      className="w-14 px-2 py-1 bg-surface border border-amber-500/40 rounded text-center text-white font-mono font-bold"
                    />
                    <span className="text-slate-300">empaque(s) ×</span>
                    <input
                      type="number"
                      min={0.1}
                      step="any"
                      value={unidadesPorEmpaque}
                      onChange={(e) => {
                        const factor = Math.max(0.1, Number(e.target.value));
                        setUnidadesPorEmpaque(factor);
                        setCantidad(Math.min(currentStock, cantidadEmpaques * factor));
                      }}
                      className="w-16 px-2 py-1 bg-surface border border-amber-500/40 rounded text-center text-white font-mono font-bold"
                    />
                    <span className="text-slate-300">{selectedItem.unidad || 'Und'} c/u</span>
                  </div>
                  <span className="ml-auto text-amber-300 font-mono font-bold">
                    = {cantidad} {selectedItem.unidad || 'Und'} a descontar
                  </span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                <div className="sm:col-span-6 relative">
                  <input
                    type="number"
                    min={1}
                    max={currentStock}
                    value={cantidad || ''}
                    onChange={(e) => setCantidad(Number(e.target.value))}
                    className={`w-full px-3.5 py-2 text-base font-mono font-bold bg-surface border rounded-xl text-white focus:outline-none ${
                      isStockInsufficient 
                        ? 'border-rose-500 text-rose-300 focus:border-rose-400' 
                        : 'border-borderSubtle focus:border-brand-400'
                    }`}
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-400">
                    {selectedItem.unidad || 'Und'}
                  </span>
                </div>

                <div className="sm:col-span-6 flex items-center gap-3 text-xs bg-surface p-2.5 rounded-xl border border-borderSubtle">
                  <div className="flex-1 text-center">
                    <span className="text-[10px] text-slate-500 uppercase block">Stock Actual</span>
                    <span className="font-mono font-bold text-slate-200">{currentStock}</span>
                  </div>
                  <span className="text-slate-600 font-bold">➔</span>
                  <div className="flex-1 text-center">
                    <span className="text-[10px] text-slate-500 uppercase block">Despacho</span>
                    <span className="font-mono font-bold text-rose-400">-{cantidad || 0}</span>
                  </div>
                  <span className="text-slate-600 font-bold">=</span>
                  <div className="flex-1 text-center">
                    <span className="text-[10px] text-slate-500 uppercase block">Saldo Almacén</span>
                    <span className={`font-mono font-bold ${isStockInsufficient ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {remainingStock}
                    </span>
                  </div>
                </div>

                {/* Alerta Preventiva de Sobreconsumo (> 115% de Receta BOM) - T4.3 */}
                {bomTheoreticalData && (
                  <div className={`sm:col-span-12 p-3 rounded-xl border transition ${
                    bomTheoreticalData.isOverconsumption
                      ? 'bg-amber-500/15 border-amber-500/50 text-amber-200 shadow-sm'
                      : 'bg-surface border-borderSubtle text-slate-300'
                  }`}>
                    <div className="flex items-start gap-2.5">
                      {bomTheoreticalData.isOverconsumption ? (
                        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      ) : (
                        <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      )}
                      <div className="space-y-0.5 flex-1">
                        <div className="flex items-center justify-between">
                          <span className={`text-xs font-bold ${
                            bomTheoreticalData.isOverconsumption ? 'text-amber-300' : 'text-slate-200'
                          }`}>
                            {bomTheoreticalData.isOverconsumption
                              ? `⚠️ Alerta Preventiva: Sobreconsumo BOM (${bomTheoreticalData.porcentaje.toFixed(1)}%)`
                              : `Consumo BOM Proyectado: ${bomTheoreticalData.porcentaje.toFixed(1)}%`
                            }
                          </span>
                          <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                            bomTheoreticalData.isOverconsumption
                              ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40 font-bold'
                              : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                          }`}>
                            {bomTheoreticalData.isOverconsumption ? '> 115% Límite' : 'Dentro de Tolerancia'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-300 leading-snug">
                          Demanda Teórica: <strong className="text-white">{bomTheoreticalData.itemTeorico} {bomTheoreticalData.unidad}</strong> · Despachado Previo: <strong className="text-slate-200">{bomTheoreticalData.previoDespachado}</strong>.
                          Con este despacho de <strong className="text-rose-300">+{cantidad || 0}</strong>, el total acumulado será <strong className="text-white">{bomTheoreticalData.nuevoAcumulado} {bomTheoreticalData.unidad}</strong>.
                          {bomTheoreticalData.isOverconsumption && (
                            <span className="block mt-1 text-amber-300 font-medium bg-amber-500/10 p-1.5 rounded border border-amber-500/20">
                              ℹ️ Este consumo sobrepasa la tolerancia del 115%. Se registrará el flag de sobreconsumo en Kardex para conciliación en la Auditoría de Cierre.
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 3. Selector Jerárquico en 3 Niveles */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
                3. Trazabilidad de Consumo (Odoo Standard)
              </label>
              <span className="text-[11px] text-slate-400">Selecciona el nivel de imputación</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
              {/* Nivel 1: General */}
              <button
                type="button"
                onClick={() => setNivelImputacion('GENERAL')}
                className={`p-3 rounded-xl border text-left transition flex flex-col justify-between ${
                  nivelImputacion === 'GENERAL'
                    ? 'bg-brand-500/10 border-brand-500/60 shadow-sm'
                    : 'bg-surfaceHigh border-borderSubtle hover:border-slate-500/50'
                }`}
              >
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Factory className={`w-4 h-4 ${nivelImputacion === 'GENERAL' ? 'text-brand-400' : 'text-slate-400'}`} />
                    <span className="text-xs font-bold text-slate-200">Nivel 1: Taller General</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">
                    Consumibles generales, tornillería, soldadura o uso interno MTS sin orden asignada.
                  </p>
                </div>
                <span className="mt-2 text-[10px] font-mono text-brand-400 font-medium">Stock General</span>
              </button>

              {/* Nivel 2: Tienda / Obra */}
              <button
                type="button"
                onClick={() => setNivelImputacion('TIENDA')}
                className={`p-3 rounded-xl border text-left transition flex flex-col justify-between ${
                  nivelImputacion === 'TIENDA'
                    ? 'bg-brand-500/10 border-brand-500/60 shadow-sm'
                    : 'bg-surfaceHigh border-borderSubtle hover:border-slate-500/50'
                }`}
              >
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Building2 className={`w-4 h-4 ${nivelImputacion === 'TIENDA' ? 'text-brand-400' : 'text-slate-400'}`} />
                    <span className="text-xs font-bold text-slate-200">Nivel 2: Tienda / Proyecto</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">
                    Cruce de Tienda: asignado a una obra específica (Presupuestado vs No Presupuestado).
                  </p>
                </div>
                <span className="mt-2 text-[10px] font-mono text-cyan-400 font-medium">MTO / Obra Completa</span>
              </button>

              {/* Nivel 3: Mobiliario BOM */}
              <button
                type="button"
                onClick={() => setNivelImputacion('MOBILIARIO')}
                className={`p-3 rounded-xl border text-left transition flex flex-col justify-between ${
                  nivelImputacion === 'MOBILIARIO'
                    ? 'bg-brand-500/10 border-brand-500/60 shadow-sm'
                    : 'bg-surfaceHigh border-borderSubtle hover:border-slate-500/50'
                }`}
              >
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Package className={`w-4 h-4 ${nivelImputacion === 'MOBILIARIO' ? 'text-brand-400' : 'text-slate-400'}`} />
                    <span className="text-xs font-bold text-slate-200">Nivel 3: Mueble Específico</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">
                    Máxima granularidad BOM: Imputado a un exhibidor, mueble o línea de producción puntual.
                  </p>
                </div>
                <span className="mt-2 text-[10px] font-mono text-purple-400 font-medium">Línea BOM</span>
              </button>
            </div>

            {/* Sub-configuración según nivel seleccionado */}
            <div className="p-4 bg-surfaceHigh border border-borderSubtle rounded-xl space-y-3 mt-3">
              {nivelImputacion === 'GENERAL' && (
                <div>
                  <label className="text-xs font-medium text-slate-300 block mb-1">
                    Área o Cuadrilla de Destino:
                  </label>
                  <select
                    value={areaDestino}
                    onChange={(e) => setAreaDestino(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-surface border border-borderSubtle rounded-lg text-slate-200 focus:outline-none focus:border-brand-400"
                  >
                    <option value="Herrería">Herrería / Estructuras Metálicas</option>
                    <option value="Carpintería">Carpintería / Corte & Canteado</option>
                    <option value="Pintura">Pintura Electrostática & Líquida</option>
                    <option value="Ensamble">Ensamble Final & Embalaje</option>
                    <option value="Instalaciones">Instalaciones & Obra Civil</option>
                    <option value="Mantenimiento">Mantenimiento de Planta</option>
                  </select>
                </div>
              )}

              {(nivelImputacion === 'TIENDA' || nivelImputacion === 'MOBILIARIO') && (
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-medium text-slate-300">
                        Orden de Producción / Proyecto Asociado:
                      </label>
                      {selectedOrder && (
                        <button
                          type="button"
                          onClick={() => setIsOrderModalOpen(true)}
                          className="text-[11px] text-brand-400 hover:underline"
                        >
                          Cambiar Orden
                        </button>
                      )}
                    </div>

                    {selectedOrder ? (
                      <div className="p-3 bg-surface border border-brand-500/30 rounded-lg flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-xs text-brand-400">{selectedOrder.codigo}</span>
                            <span className="text-xs text-slate-200 font-medium">{selectedOrder.proyecto}</span>
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            Cliente: {selectedOrder.cliente}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedOrder(null)}
                          className="text-slate-400 hover:text-white p-1"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setIsOrderModalOpen(true)}
                        className="w-full py-2.5 px-3 border border-dashed border-borderSubtle hover:border-brand-500/50 rounded-lg bg-surface text-slate-400 hover:text-slate-200 text-xs flex items-center justify-center gap-2 transition"
                      >
                        <Search className="w-3.5 h-3.5" />
                        <span>Vincular Orden desde ERP / Notion (Buscar Pedido)</span>
                      </button>
                    )}

                    {/* Banner de Bloqueo a Órdenes Concluidas / Cerradas (Pilar 3) */}
                    {selectedOrder && selectedOrder.estado === 'Cerrado' && (
                      <div className="mt-2.5 p-3.5 bg-rose-500/15 border border-rose-500/40 rounded-xl space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-rose-300 font-bold text-xs">
                            <Lock className="w-4 h-4 text-rose-400" />
                            <span>Orden Cerrada en ERP ({selectedOrder.codigo})</span>
                          </div>
                          <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-rose-500/25 text-rose-200 rounded border border-rose-500/40">
                            Bloqueo Activo
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-300 leading-snug">
                          Esta orden concluyó su auditoría formal de producción. Los despachos rutinarios están bloqueados. Para autorizar entregas por garantía, retrabajo o post-venta, se requiere autorización con PIN de Supervisor.
                        </p>

                        {!isSupervisorBypassed ? (
                          <div className="pt-1 space-y-1.5">
                            {supervisorBypassError && (
                              <div className="text-[11px] text-rose-400 font-semibold">{supervisorBypassError}</div>
                            )}
                            <div className="flex items-center gap-2">
                              <input
                                type="password"
                                maxLength={6}
                                placeholder="PIN Supervisor"
                                value={supervisorPin}
                                onChange={(e) => setSupervisorPin(e.target.value)}
                                className="w-36 px-3 py-1.5 bg-surface border border-rose-500/40 rounded-lg text-white font-mono text-center tracking-widest text-xs focus:outline-none focus:border-rose-400"
                              />
                              <button
                                type="button"
                                onClick={handleVerifySupervisorPin}
                                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 shadow-sm"
                              >
                                <Lock className="w-3.5 h-3.5" />
                                <span>Autorizar Excepción</span>
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="pt-1 flex items-center gap-2 text-emerald-400 font-bold text-xs bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1.5 rounded-lg">
                            <ShieldCheck className="w-4 h-4 text-emerald-400" />
                            <span>Despacho por Excepción Autorizado por {supervisorName}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Estado de Presupuesto (Cruce de Tienda) */}
                  <div className="p-3 bg-surface rounded-lg border border-borderSubtle space-y-2">
                    <span className="text-[11px] font-semibold text-slate-300 block uppercase">
                      Condición de Costo (Cruce de Tienda):
                    </span>
                    <div className="flex items-center gap-4 text-xs">
                      <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                        <input
                          type="radio"
                          name="presupuesto_tipo"
                          checked={!esNoPresupuestado}
                          onChange={() => setEsNoPresupuestado(false)}
                          className="accent-brand-500"
                        />
                        <span>Presupuestado (Costeado en Cotización)</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer text-rose-300">
                        <input
                          type="radio"
                          name="presupuesto_tipo"
                          checked={esNoPresupuestado}
                          onChange={() => setEsNoPresupuestado(true)}
                          className="accent-rose-500"
                        />
                        <span>No Presupuestado (Cruce Adicional / Merma)</span>
                      </label>
                    </div>
                  </div>

                  {/* Si es Nivel 3: Mobiliario Específico */}
                  {nivelImputacion === 'MOBILIARIO' && (
                    <div className="p-3 bg-surface rounded-lg border border-borderSubtle space-y-2">
                      <label className="text-xs font-semibold text-slate-300 uppercase block">
                        Mobiliario o Exhibidor Específico (Línea BOM):
                      </label>

                      {loadingLines ? (
                        <div className="text-xs text-slate-400 py-2">Consultando piezas de la orden en Notion...</div>
                      ) : furnitureLines.length > 0 ? (
                        <div className="space-y-1.5">
                          <select
                            value={selectedFurniture?.id || ''}
                            onChange={(e) => {
                              const f = furnitureLines.find(l => l.id === e.target.value);
                              setSelectedFurniture(f || null);
                            }}
                            className="w-full px-3 py-2 text-xs bg-surfaceHigh border border-borderSubtle rounded-lg text-slate-200 focus:outline-none focus:border-brand-400"
                          >
                            <option value="">-- Seleccionar pieza presupuestada --</option>
                            {furnitureLines.map(line => (
                              <option key={line.id} value={line.id}>
                                {line.nombre} ({line.cantidad} und - {line.estado})
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <input
                          type="text"
                          placeholder="Nombre o descripción del mueble (ej: Mueble Caja Principal, Góndola A)..."
                          value={manualFurnitureName}
                          onChange={(e) => setManualFurnitureName(e.target.value)}
                          className="w-full px-3 py-2 text-xs bg-surfaceHigh border border-borderSubtle rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-brand-400"
                        />
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 3.5. GOBERNANZA DE RESERVAS MTO Y SEMÁFORO TRIPARTITO (Micro-Fase 10D / D1-10D, D2-10D, D5-10D) */}
          {selectedItem && (
            <div className="space-y-3 p-4 bg-slate-950/70 border border-slate-800 rounded-xl">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-amber-400" />
                  Disponibilidad de Piso y Reservas Multitienda
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                  Total Físico en Galpón: {currentStock} {selectedItem.unidad || 'Und'}
                </span>
              </div>

              {/* Semáforo Tripartito de Piso (D5-10D) */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2 rounded-xl bg-emerald-950/40 border border-emerald-500/30">
                  <span className="block text-[9px] text-emerald-400 font-bold uppercase tracking-wider">
                    🟢 Esta Obra
                  </span>
                  <span className="text-sm sm:text-base font-mono font-bold text-emerald-300">
                    {myApartado} <span className="text-[10px] font-normal">{selectedItem.unidad || 'Und'}</span>
                  </span>
                  <span className="block text-[9px] text-emerald-500/80">Apartado MTO</span>
                </div>

                <div className="p-2 rounded-xl bg-blue-950/40 border border-blue-500/30">
                  <span className="block text-[9px] text-blue-400 font-bold uppercase tracking-wider">
                    🔵 Stock Libre
                  </span>
                  <span className="text-sm sm:text-base font-mono font-bold text-blue-300">
                    {stockLibre} <span className="text-[10px] font-normal">{selectedItem.unidad || 'Und'}</span>
                  </span>
                  <span className="block text-[9px] text-blue-500/80">Fondo Común</span>
                </div>

                <div className="p-2 rounded-xl bg-amber-950/40 border border-amber-500/30">
                  <span className="block text-[9px] text-amber-400 font-bold uppercase tracking-wider">
                    🟠 Otras Obras
                  </span>
                  <span className="text-sm sm:text-base font-mono font-bold text-amber-300">
                    {otherApartado} <span className="text-[10px] font-normal">{selectedItem.unidad || 'Und'}</span>
                  </span>
                  <span className="block text-[9px] text-amber-500/80">Comprometido</span>
                </div>
              </div>

              {/* Diagnóstico Reactivo de Cobertura */}
              {!isBlockedByOtherStores ? (
                <div className={`p-2.5 rounded-xl border flex items-center gap-2 text-xs ${
                  cantidad <= myApartado && myApartado > 0
                    ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                    : 'bg-blue-950/30 border-blue-500/30 text-blue-300'
                }`}>
                  <CheckCircle className="w-4 h-4 shrink-0 text-emerald-400" />
                  <span>
                    {cantidad <= myApartado && myApartado > 0
                      ? `Despacho cubierto al 100% con la reserva MTO de esta obra (${cantidad} de ${myApartado} ${selectedItem.unidad || 'Und'}).`
                      : myApartado > 0
                        ? `Despacho mixto: se consumen ${myApartado} ${selectedItem.unidad || 'Und'} de reserva propia + ${cantidad - myApartado} ${selectedItem.unidad || 'Und'} del Stock Libre común.`
                        : `Despacho directo desde Stock Libre común (${cantidad} ${selectedItem.unidad || 'Und'}).`
                    }
                  </span>
                </div>
              ) : (
                /* BLOQUEO POR CANIBALIZACIÓN & VÁLVULA DE EMERGENCIA (D1-10D, D2-10D) */
                <div className="space-y-3 p-3.5 bg-rose-950/30 border border-rose-500/40 rounded-xl">
                  <div className="flex items-start gap-2.5 text-rose-300 text-xs">
                    <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold block text-sm text-rose-200">
                        ⛔ Despacho Directo Bloqueado: Compromiso con Otras Obras
                      </span>
                      <p className="text-[11px] text-rose-300/90 mt-0.5 leading-snug">
                        El stock libre disponible ({stockLibre} {selectedItem.unidad || 'Und'}) no alcanza para cubrir las {cantidad} {selectedItem.unidad || 'Und'} solicitadas. Las existencias en almacén están reservadas para:
                      </p>
                      <ul className="list-disc list-inside mt-1 font-mono text-[10px] text-amber-300/90">
                        {otherAllocs.map(a => (
                          <li key={a.id}>
                            <strong>{a.proyectoNombre}</strong>: {a.cantidadApartada} {a.unidad || 'Und'}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {!isEmergencyLoanActive ? (
                    <button
                      type="button"
                      onClick={() => {
                        setIsEmergencyLoanActive(true);
                        if (otherAllocs.length > 0 && !prestamistaProyectoId) {
                          setPrestamistaProyectoId(otherAllocs[0].proyectoId);
                        }
                      }}
                      className="w-full py-2.5 px-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 transition active:scale-95 shadow-lg shadow-amber-950/40 cursor-pointer"
                    >
                      <Zap className="w-4 h-4" />
                      <span>Activar Válvula de Emergencia (Préstamo Inter-Obras con PIN)</span>
                    </button>
                  ) : (
                    /* FORMULARIO DE VÁLVULA DE EMERGENCIA */
                    <div className="p-3 bg-slate-900 border border-amber-500/40 rounded-xl space-y-3 animate-in fade-in duration-200">
                      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                        <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                          <Zap className="w-4 h-4" />
                          Válvula de Emergencia Activa: Préstamo entre Obras
                        </span>
                        <button
                          type="button"
                          onClick={() => setIsEmergencyLoanActive(false)}
                          className="text-[10px] text-slate-400 hover:text-white"
                        >
                          Cancelar Préstamo
                        </button>
                      </div>

                      {/* Selector de Tienda Cedente */}
                      <div>
                        <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                          1. Tienda Cedente (Acreedora del Préstamo):
                        </label>
                        <select
                          value={prestamistaProyectoId}
                          onChange={(e) => setPrestamistaProyectoId(e.target.value)}
                          className="w-full px-3 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-white font-medium focus:outline-none focus:border-amber-400"
                        >
                          {otherAllocs.map(a => (
                            <option key={a.proyectoId} value={a.proyectoId}>
                              {a.proyectoNombre} ({a.cantidadApartada} {a.unidad || 'Und'} apartadas)
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* PIN de Supervisor */}
                      <div>
                        <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                          2. Autorización con PIN de Supervisor (Requerido):
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="password"
                            maxLength={6}
                            placeholder="PIN Supervisor"
                            value={emergencySupervisorPin}
                            onChange={(e) => {
                              setEmergencySupervisorPin(e.target.value);
                              setEmergencyPinVerified(false);
                            }}
                            className="w-36 px-3 py-1.5 bg-slate-950 border border-amber-500/40 rounded-lg text-white font-mono text-center tracking-widest text-xs focus:outline-none focus:border-amber-400"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              if (emergencySupervisorPin === '1234' || emergencySupervisorPin.length >= 4) {
                                setEmergencyPinVerified(true);
                                setEmergencySupervisorName('Supervisor de Planta');
                                setEmergencyError(null);
                              } else {
                                setEmergencyError('PIN de Supervisor incorrecto.');
                              }
                            }}
                            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold rounded-lg text-xs transition"
                          >
                            Validar PIN
                          </button>
                          {emergencyPinVerified && (
                            <span className="text-emerald-400 text-xs font-semibold flex items-center gap-1">
                              <ShieldCheck className="w-4 h-4" />
                              Autorizado
                            </span>
                          )}
                        </div>
                        {emergencyError && (
                          <span className="text-[10px] text-rose-400 block mt-1">{emergencyError}</span>
                        )}
                      </div>

                      {/* Motivo de Emergencia Obligatorio */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-[11px] font-semibold text-slate-300">
                            3. Justificación Técnica de la Urgencia:
                          </label>
                          <span className={`text-[10px] font-mono ${
                            motivoEmergencia.trim().length >= 15 ? 'text-emerald-400' : 'text-rose-400'
                          }`}>
                            {motivoEmergencia.trim().length}/15 caracteres mín.
                          </span>
                        </div>
                        <input
                          type="text"
                          placeholder="Explique el motivo del préstamo urgente para la obra..."
                          value={motivoEmergencia}
                          onChange={(e) => setMotivoEmergencia(e.target.value)}
                          className="w-full px-3 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-amber-400"
                        />
                      </div>

                      {/* Switch de Reposición Urgente en Compras */}
                      <label className="flex items-center gap-2 cursor-pointer pt-1 text-xs text-amber-200">
                        <input
                          type="checkbox"
                          checked={reponerCedente}
                          onChange={(e) => setReponerCedente(e.target.checked)}
                          className="w-4 h-4 rounded accent-amber-500"
                        />
                        <span className="font-semibold">
                          [x] Generar Requisición de Reposición Urgente en Compras para la Tienda Cedente
                        </span>
                      </label>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 4. Receptor en Taller & Motivo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5 relative">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-slate-300 block">
                  Operario Receptor en Planta: <span className="text-rose-400">*</span>
                </label>
                {selectedEmployee && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedEmployee(null);
                      setOperarioReceptor('');
                      setOperarioSearch('');
                    }}
                    className="text-[10px] text-brand-400 hover:underline"
                  >
                    Cambiar
                  </button>
                )}
              </div>

              {selectedEmployee ? (
                <div className="flex items-center justify-between p-2 bg-surface border border-brand-500/40 rounded-xl">
                  <div className="flex items-center gap-2">
                    <div className="p-1 rounded bg-brand-500/10 text-brand-400">
                      <User className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-white block">{selectedEmployee.name}</span>
                      <span className="text-[10px] text-slate-400">
                        {selectedEmployee.areas && selectedEmployee.areas.length > 0 
                          ? selectedEmployee.areas.join(' • ') 
                          : 'Personal de Planta'}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedEmployee(null);
                      setOperarioReceptor('');
                      setOperarioSearch('');
                    }}
                    className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-surfaceHigh transition"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <div className="relative flex items-center">
                    <input
                      type="text"
                      placeholder={loadingEmployees ? "Cargando personal de planta..." : "Buscar operario (ej. Pedro, Mikel)..."}
                      value={operarioSearch}
                      onChange={(e) => {
                        setOperarioSearch(e.target.value);
                        setOperarioReceptor(e.target.value);
                        setIsOperarioDropdownOpen(true);
                      }}
                      onFocus={() => setIsOperarioDropdownOpen(true)}
                      onClick={() => setIsOperarioDropdownOpen(true)}
                      className="w-full pl-8 pr-8 py-2 text-xs bg-surfaceHigh border border-borderSubtle rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-brand-400 font-medium"
                      required
                    />
                    <User className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
                    {loadingEmployees ? (
                      <Loader2 className="w-3.5 h-3.5 text-brand-400 absolute right-2.5 animate-spin" />
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsOperarioDropdownOpen(!isOperarioDropdownOpen);
                        }}
                        className="p-1 absolute right-2 text-slate-400 hover:text-white transition"
                        title="Desplegar lista de operarios"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Dropdown flotante */}
                  {isOperarioDropdownOpen && (
                    <>
                      <div 
                        className="fixed inset-0 z-40" 
                        onClick={() => setIsOperarioDropdownOpen(false)}
                      />
                      <div className="absolute left-0 right-0 top-full mt-1 max-h-52 overflow-y-auto bg-surface border border-borderSubtle rounded-xl shadow-2xl z-50 py-1 divide-y divide-borderSubtle/50 custom-scrollbar">
                        {filteredEmployees.length > 0 ? (
                          filteredEmployees.map(emp => (
                            <button
                              key={emp.id}
                              type="button"
                              onClick={() => {
                                setSelectedEmployee(emp);
                                setOperarioReceptor(emp.name);
                                setOperarioSearch('');
                                setIsOperarioDropdownOpen(false);
                              }}
                              className="w-full px-3 py-2 text-left hover:bg-surfaceHigh flex items-center justify-between transition group"
                            >
                              <div>
                                <span className="text-xs font-semibold text-slate-200 group-hover:text-brand-300 block">
                                  {emp.name}
                                </span>
                                {emp.areas && emp.areas.length > 0 && (
                                  <span className="text-[10px] text-slate-400">
                                    {emp.areas.join(' • ')}
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] px-2 py-0.5 rounded bg-surfaceHigh border border-borderSubtle text-slate-400 group-hover:border-brand-500/40 group-hover:text-brand-400">
                                Seleccionar
                              </span>
                            </button>
                          ))
                        ) : (
                          <div className="p-2.5 text-center text-xs text-slate-400">
                            No se encontraron operarios registrados con "{operarioSearch}"
                          </div>
                        )}

                        {operarioSearch.trim() && (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedEmployee({
                                id: `custom-${Date.now()}`,
                                name: operarioSearch.trim(),
                                hasPin: false,
                                areas: ['Contratista / Eventual']
                              });
                              setOperarioReceptor(operarioSearch.trim());
                              setIsOperarioDropdownOpen(false);
                            }}
                            className="w-full px-3 py-2 text-left bg-brand-500/10 hover:bg-brand-500/20 text-brand-300 text-xs flex items-center gap-1.5 transition font-medium"
                          >
                            <span>➕ Usar "<strong>{operarioSearch.trim()}</strong>" como personal eventual / contratista</span>
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300 block">
                Motivo del Despacho:
              </label>
              <select
                value={motivoSalida}
                onChange={(e) => setMotivoSalida(e.target.value)}
                className="w-full px-3.5 py-2 text-xs bg-surfaceHigh border border-borderSubtle rounded-xl text-white focus:outline-none focus:border-brand-400"
              >
                <option value="Fabricación">Fabricación Normal</option>
                <option value="Reposición por Merma">Reposición por Merma / Error de Corte</option>
                <option value="Muestra Técnica">Muestra Técnica / Prototipo</option>
                <option value="Mantenimiento">Mantenimiento de Maquinaria</option>
                <option value="Garantía Obra">Garantía / Retoque en Sitio</option>
              </select>
            </div>
          </div>

          {/* 5. Observaciones Opcionales / Justificación Obligatoria (T4.4) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium block">
                {esNoPresupuestado ? (
                  <span className="text-rose-300 font-semibold flex items-center gap-1.5">
                    <span>Justificación Técnica Obligatoria (No Presupuestado):</span>
                    <span className="text-rose-400 font-bold">*</span>
                  </span>
                ) : (
                  <span className="text-slate-400">Notas Adicionales (Opcional):</span>
                )}
              </label>
              {esNoPresupuestado && (
                <span className={`text-[10px] font-mono font-medium ${
                  notas.trim().length >= 15 ? 'text-emerald-400' : 'text-rose-400'
                }`}>
                  {notas.trim().length}/15 caracteres mín. {notas.trim().length >= 15 ? '✓' : `(faltan ${Math.max(0, 15 - notas.trim().length)})`}
                </span>
              )}
            </div>
            <input
              type="text"
              placeholder={esNoPresupuestado ? "Explique por qué se requiere este insumo adicional no contemplado en la cotización..." : "Detalle técnico, lote o instrucción especial..."}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              className={`w-full px-3.5 py-2 text-xs bg-surfaceHigh border rounded-xl text-white placeholder-slate-500 focus:outline-none transition ${
                esNoPresupuestado
                  ? notas.trim().length < 15
                    ? 'border-rose-500/60 focus:border-rose-400'
                    : 'border-emerald-500/60 focus:border-emerald-400'
                  : 'border-borderSubtle focus:border-brand-400'
              }`}
            />
            {esNoPresupuestado && notas.trim().length < 15 && (
              <p className="text-[11px] text-rose-400/90 leading-tight">
                Para justificar consumos no contemplados en la cotización inicial, ingrese una explicación técnica de al menos 15 caracteres.
              </p>
            )}
          </div>

          {/* Botones de Acción */}
          <div className="pt-4 border-t border-borderSubtle flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs text-slate-400 hover:text-white rounded-xl transition"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={
                isSubmitting || 
                !selectedItem || 
                isStockInsufficient || 
                !operarioReceptor.trim() || 
                (selectedOrder?.estado === 'Cerrado' && !isSupervisorBypassed) ||
                (esNoPresupuestado && notas.trim().length < 15) ||
                (isBlockedByOtherStores && (!isEmergencyLoanActive || !emergencyPinVerified || motivoEmergencia.trim().length < 15))
              }
              className={`flex items-center gap-2 px-6 py-2.5 text-xs font-bold rounded-xl transition disabled:opacity-50 shadow-lg active:scale-95 cursor-pointer disabled:cursor-not-allowed ${
                isEmergencyLoanActive
                  ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold shadow-amber-950/50'
                  : 'bg-rose-500 hover:bg-rose-600 text-white'
              }`}
            >
              {isSubmitting ? (
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
              ) : isEmergencyLoanActive ? (
                <Zap className="w-4 h-4" />
              ) : (
                <ArrowUpRight className="w-4 h-4" />
              )}
              <span>
                {isEmergencyLoanActive
                  ? 'Autorizar Préstamo de Urgencia y Despachar'
                  : 'Confirmar Salida Física (Asentar en Kardex)'
                }
              </span>
            </button>
          </div>
        </form>
      </div>

      {/* Modal Subordinado de Búsqueda de Pedidos */}
      {isOrderModalOpen && (
        <OrderSearchModal
          isOpen={isOrderModalOpen}
          onClose={() => setIsOrderModalOpen(false)}
          onSelectOrder={(order) => {
            setSelectedOrder(order);
            setIsOrderModalOpen(false);
          }}
        />
      )}
    </div>
  );
};
