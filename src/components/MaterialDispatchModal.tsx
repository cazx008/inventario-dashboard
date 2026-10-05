import React, { useState, useEffect } from 'react';
import { 
  X, 
  ArrowUpRight, 
  Search, 
  Factory, 
  Building2, 
  Package, 
  User, 
  AlertCircle, 
  CheckCircle, 
  Layers, 
  ChevronRight,
  ShieldAlert,
  Calendar,
  Sparkles
} from 'lucide-react';
import { InventoryItem } from '../types/inventory';
import { OrderReference } from '../types/oab';
import { OrderSearchModal } from './OrderSearchModal';

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
}

export const MaterialDispatchModal: React.FC<MaterialDispatchModalProps> = ({
  isOpen,
  onClose,
  inventoryItems,
  preselectedItem = null,
  onDispatchSuccess,
  token
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
  const [operarioReceptor, setOperarioReceptor] = useState('');
  const [motivoSalida, setMotivoSalida] = useState('Fabricación');
  const [notas, setNotas] = useState('');

  // 5. Estado de Envío
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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

    const mobiliarioFinal = selectedFurniture?.nombre || manualFurnitureName.trim();
    if (nivelImputacion === 'MOBILIARIO' && !mobiliarioFinal) {
      setErrorMsg('Debes seleccionar o escribir el mueble específico dentro del pedido.');
      return;
    }

    setIsSubmitting(true);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const payload = {
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
        mobiliarioId: selectedFurniture?.id,
        mobiliarioNombre: mobiliarioFinal || undefined,
        operarioReceptor: operarioReceptor.trim(),
        areaDestino,
        motivoSalida,
        notas: notas.trim(),
        fechaDespacho: new Date().toISOString().split('T')[0]
      };

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

          {/* 4. Receptor en Taller & Motivo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300 block">
                Operario Receptor en Planta: <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                placeholder="Nombre del operario que recibe..."
                value={operarioReceptor}
                onChange={(e) => setOperarioReceptor(e.target.value)}
                className="w-full px-3.5 py-2 text-xs bg-surfaceHigh border border-borderSubtle rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-brand-400"
                required
              />
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

          {/* 5. Observaciones Opcionales */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400 block">
              Notas Adicionales (Opcional):
            </label>
            <input
              type="text"
              placeholder="Detalle técnico, lote o instrucción especial..."
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              className="w-full px-3.5 py-2 text-xs bg-surfaceHigh border border-borderSubtle rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-brand-400"
            />
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
              disabled={isSubmitting || !selectedItem || isStockInsufficient || !operarioReceptor.trim()}
              className="flex items-center gap-2 px-6 py-2.5 text-xs font-bold rounded-xl bg-rose-500 hover:bg-rose-600 text-white transition disabled:opacity-50 shadow-lg active:scale-95"
            >
              {isSubmitting ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <ArrowUpRight className="w-4 h-4" />
              )}
              <span>Confirmar Salida Física (Asentar en Kardex)</span>
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
