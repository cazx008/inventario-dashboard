import React, { useState, useEffect, useMemo } from 'react';
import { PrintSheetBOMAudit } from './PrintSheetBOMAudit';
import { 
  X, 
  Search, 
  AlertTriangle, 
  CheckCircle2, 
  TrendingUp, 
  TrendingDown, 
  Printer, 
  FileSpreadsheet, 
  RotateCcw, 
  Boxes, 
  ArrowRight,
  HelpCircle,
  Building2,
  Calendar,
  Layers,
  Sparkles
} from 'lucide-react';

interface BalanceItem {
  mat: string;
  codigo: string;
  dashboardId: string | null;
  nombre: string;
  unidad: string;
  teorico: number;
  real: number;
  diferencia: number;
  varianzaPct: number;
  costoUnitarioUSD: number;
  costoVariacionUSD: number;
  estado: 'NORMAL' | 'MERMA_EXCESIVA' | 'AHORRO' | 'EXACTO' | 'NO_PRESUPUESTADO';
  salidasCount: number;
}

interface MuebleBOM {
  id: string;
  codigo: string;
  nombre: string;
  cantidad: number;
  partesCount?: number;
  motivo?: string;
}

interface OrderReference {
  id: string;
  codigo: string;
  proyecto: string;
  cliente: string;
  estado?: string;
}

interface OrderBOMAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialOrderId?: string;
  initialOrderCode?: string;
  initialOrderName?: string;
  token?: string | null;
}

export const OrderBOMAuditModal: React.FC<OrderBOMAuditModalProps> = ({
  isOpen,
  onClose,
  initialOrderId,
  initialOrderCode,
  initialOrderName,
  token
}) => {
  // Estado de Selección de Pedido
  const [selectedOrderId, setSelectedOrderId] = useState<string>(initialOrderId || '');
  const [selectedOrderCode, setSelectedOrderCode] = useState<string>(initialOrderCode || '');
  const [selectedOrderName, setSelectedOrderName] = useState<string>(initialOrderName || '');
  const [activeOrders, setActiveOrders] = useState<OrderReference[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  // Estado del Balance
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [balanceItems, setBalanceItems] = useState<BalanceItem[]>([]);
  const [mueblesConBOM, setMueblesConBOM] = useState<MuebleBOM[]>([]);
  const [mueblesSinBOM, setMueblesSinBOM] = useState<MuebleBOM[]>([]);
  const [kpis, setKpis] = useState({
    totalTeoricoUSD: 0,
    totalRealUSD: 0,
    diferenciaNetaUSD: 0,
    varianzaGlobalPct: 0,
    itemsAuditadosCount: 0,
    mermasCriticasCount: 0,
    mueblesConBOMCount: 0,
    mueblesSinBOMCount: 0,
    salidasKardexCount: 0
  });

  // Filtros de UI
  const [searchTerm, setSearchTerm] = useState('');
  const [filterTab, setFilterTab] = useState<'ALL' | 'DISCREPANCIAS' | 'MERMAS' | 'AHORROS' | 'SIN_RECETA'>('ALL');
  
  // Retazos Físicos Devueltos (Ajuste manual de taller)
  const [retazosDeclarados, setRetazosDeclarados] = useState<Record<string, number>>({});
  const [retazoInputMat, setRetazoInputMat] = useState('');
  const [retazoInputQty, setRetazoInputQty] = useState('');

  // Vista Previa de Impresión Formal
  const [showPrintSheet, setShowPrintSheet] = useState(false);

  // 1. Cargar lista de órdenes disponibles al abrir
  useEffect(() => {
    if (isOpen) {
      setLoadingOrders(true);
      fetch('/api/orders/active')
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data.orders)) {
            setActiveOrders(data.orders);
            // Si no hay orden inicial preseleccionada, tomar la primera
            if (!selectedOrderId && data.orders.length > 0) {
              setSelectedOrderId(data.orders[0].id);
              setSelectedOrderCode(data.orders[0].codigo);
              setSelectedOrderName(data.orders[0].proyecto);
            }
          }
          setLoadingOrders(false);
        })
        .catch(err => {
          console.warn('Error cargando órdenes para balance BOM:', err);
          setLoadingOrders(false);
        });
    }
  }, [isOpen]);

  // Si cambian las props iniciales, sincronizar
  useEffect(() => {
    if (initialOrderId) {
      setSelectedOrderId(initialOrderId);
      if (initialOrderCode) setSelectedOrderCode(initialOrderCode);
      if (initialOrderName) setSelectedOrderName(initialOrderName);
    }
  }, [initialOrderId, initialOrderCode, initialOrderName]);

  // 2. Consultar Balance cuando hay orden seleccionada
  const fetchBalance = () => {
    if (!selectedOrderId) return;

    setIsLoading(true);
    setErrorMsg(null);

    const q = new URLSearchParams({
      orderId: selectedOrderId,
      pedidoCodigo: selectedOrderCode || ''
    });

    fetch(`/api/bom/order-balance?${q.toString()}`)
      .then(async res => {
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then(data => {
        setBalanceItems(data.balance || []);
        setMueblesConBOM(data.mueblesConBOM || []);
        setMueblesSinBOM(data.mueblesSinBOM || []);
        if (data.kpis) setKpis(data.kpis);
        setIsLoading(false);
      })
      .catch(err => {
        setErrorMsg(`Fallo en el cálculo de balance: ${err.message}`);
        setIsLoading(false);
      });
  };

  useEffect(() => {
    if (isOpen && selectedOrderId) {
      fetchBalance();
    }
  }, [isOpen, selectedOrderId]);

  // Manejo de Retazos Devueltos
  const handleAddRetazo = () => {
    const qty = parseFloat(retazoInputQty);
    if (!retazoInputMat || isNaN(qty) || qty <= 0) return;

    setRetazosDeclarados(prev => ({
      ...prev,
      [retazoInputMat]: (prev[retazoInputMat] || 0) + qty
    }));

    setRetazoInputMat('');
    setRetazoInputQty('');
  };

  const handleRemoveRetazo = (mat: string) => {
    setRetazosDeclarados(prev => {
      const copy = { ...prev };
      delete copy[mat];
      return copy;
    });
  };

  // Cálculo ajustado con retazos
  const totalRetazosUSD = useMemo(() => {
    let sum = 0;
    for (const [mat, qty] of Object.entries(retazosDeclarados)) {
      const item = balanceItems.find(b => b.mat === mat);
      if (item && item.costoUnitarioUSD) {
        sum += qty * item.costoUnitarioUSD;
      }
    }
    return sum;
  }, [retazosDeclarados, balanceItems]);

  const varianzaAjustadaUSD = useMemo(() => {
    return Math.max(0, kpis.diferenciaNetaUSD - totalRetazosUSD);
  }, [kpis.diferenciaNetaUSD, totalRetazosUSD]);

  // Filtrado de la tabla
  const filteredItems = useMemo(() => {
    return balanceItems.filter(item => {
      // Filtro de texto
      if (searchTerm.trim()) {
        const s = searchTerm.toLowerCase();
        const matchesText = 
          item.nombre.toLowerCase().includes(s) ||
          item.codigo.toLowerCase().includes(s) ||
          item.mat.toLowerCase().includes(s);
        if (!matchesText) return false;
      }

      // Filtro por Tab
      if (filterTab === 'DISCREPANCIAS') return item.diferencia !== 0;
      if (filterTab === 'MERMAS') return item.estado === 'MERMA_EXCESIVA' || item.estado === 'NO_PRESUPUESTADO';
      if (filterTab === 'AHORROS') return item.estado === 'AHORRO';

      return true;
    });
  }, [balanceItems, searchTerm, filterTab]);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-5 overflow-y-auto no-print">
      <div className="relative w-full max-w-6xl max-h-[94vh] flex flex-col bg-surface border border-borderSubtle rounded-2xl shadow-2xl overflow-hidden">
        
        {/* CABECERA INDUSTRIAL */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5 border-b border-borderSubtle bg-surfaceHigh/80">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-brand-500/10 border border-brand-500/30 text-brand-400">
              <Boxes className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-white">
                  Auditoría de Cierre BOM — Balance de Mermas
                </h2>
                <span className="px-2 py-0.5 text-[10px] font-mono font-bold uppercase rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Ex-Post
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Comparativa cuantitativa: Demanda teórica de muebles vs Salidas reales de Kardex
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Selector de Pedidos */}
            <select
              value={selectedOrderId}
              onChange={(e) => {
                const o = activeOrders.find(ord => ord.id === e.target.value);
                if (o) {
                  setSelectedOrderId(o.id);
                  setSelectedOrderCode(o.codigo);
                  setSelectedOrderName(o.proyecto);
                }
              }}
              className="px-3 py-1.5 text-xs font-mono font-semibold bg-surface border border-borderSubtle rounded-xl text-white focus:outline-none focus:border-brand-400 max-w-[260px]"
            >
              {loadingOrders ? (
                <option value="">Cargando pedidos...</option>
              ) : activeOrders.length === 0 ? (
                <option value="">Sin pedidos disponibles</option>
              ) : (
                activeOrders.map(o => (
                  <option key={o.id} value={o.id}>
                    {o.codigo} — {o.proyecto || o.cliente}
                  </option>
                ))
              )}
            </select>

            <button
              type="button"
              onClick={fetchBalance}
              disabled={isLoading}
              title="Recalcular balance"
              className="p-1.5 rounded-lg bg-surfaceHigh hover:bg-surfaceHighest text-slate-300 border border-borderSubtle transition"
            >
              <RotateCcw className={`w-4 h-4 ${isLoading ? 'animate-spin text-brand-400' : ''}`} />
            </button>

            <button
              type="button"
              onClick={() => setShowPrintSheet(true)}
              title="Imprimir informe formal"
              className="px-2.5 py-1.5 rounded-lg bg-surfaceHigh hover:bg-surfaceHighest text-slate-300 border border-borderSubtle text-xs font-semibold flex items-center gap-1.5 transition"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Imprimir</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg bg-surfaceHigh hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 border border-borderSubtle transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* CONTENIDO SCROLLABLE */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
          
          {/* BANNER DE IDENTIFICACIÓN DE OBRA */}
          <div className="p-3.5 bg-surfaceHigh/40 border border-borderSubtle rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs print:bg-slate-50 print:border-slate-300">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-brand-400 print:text-slate-800" />
              <span className="font-semibold text-slate-300 print:text-slate-700">Orden Auditada:</span>
              <span className="font-mono font-bold text-white print:text-slate-900 bg-surface px-2 py-0.5 rounded border border-borderSubtle">
                {selectedOrderCode || 'ORD-N/A'}
              </span>
              <span className="text-slate-400 print:text-slate-600 font-medium">
                {selectedOrderName ? `— ${selectedOrderName}` : ''}
              </span>
            </div>

            <div className="flex items-center gap-4 text-slate-400 text-[11px]">
              <span>Muebles con receta: <strong className="text-white print:text-slate-900 font-mono">{kpis.mueblesConBOMCount}</strong></span>
              <span>Especiales sin BOM: <strong className="text-amber-400 font-mono">{kpis.mueblesSinBOMCount}</strong></span>
              <span>Salidas en Kardex: <strong className="text-white print:text-slate-900 font-mono">{kpis.salidasKardexCount}</strong></span>
            </div>
          </div>

          {/* MENSAJES DE ERROR */}
          {errorMsg && (
            <div className="p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-center gap-2.5 text-xs text-rose-300">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* BANNER DE KPIS MONETARIOS Y VARIANZA */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 bg-surfaceHigh/60 border border-borderSubtle rounded-xl">
              <span className="text-[10px] text-slate-500 uppercase font-semibold block">Demanda Teórica (BOM)</span>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="text-lg font-bold font-mono text-white print:text-slate-900">
                  ${kpis.totalTeoricoUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="text-[10px] text-slate-400">USD</span>
              </div>
              <span className="text-[10px] text-slate-500 block mt-1">Costo estándar calculado</span>
            </div>

            <div className="p-3 bg-surfaceHigh/60 border border-borderSubtle rounded-xl">
              <span className="text-[10px] text-slate-500 uppercase font-semibold block">Despachado Real (Kardex)</span>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="text-lg font-bold font-mono text-white print:text-slate-900">
                  ${kpis.totalRealUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="text-[10px] text-slate-400">USD</span>
              </div>
              <span className="text-[10px] text-slate-500 block mt-1">Salidas físicas a taller</span>
            </div>

            <div className={`p-3 border rounded-xl ${
              kpis.diferenciaNetaUSD > 0 
                ? 'bg-rose-500/10 border-rose-500/30' 
                : kpis.diferenciaNetaUSD < 0
                ? 'bg-emerald-500/10 border-emerald-500/30'
                : 'bg-surfaceHigh/60 border-borderSubtle'
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500 uppercase font-semibold block">Varianza de Merma</span>
                {kpis.diferenciaNetaUSD > 0 ? (
                  <TrendingUp className="w-3.5 h-3.5 text-rose-400" />
                ) : (
                  <TrendingDown className="w-3.5 h-3.5 text-emerald-400" />
                )}
              </div>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className={`text-lg font-bold font-mono ${
                  kpis.diferenciaNetaUSD > 0 ? 'text-rose-400' : kpis.diferenciaNetaUSD < 0 ? 'text-emerald-400' : 'text-slate-300'
                }`}>
                  {kpis.diferenciaNetaUSD > 0 ? '+' : ''}${kpis.diferenciaNetaUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
                <span className={`text-xs font-mono font-bold ${
                  kpis.varianzaGlobalPct > 0 ? 'text-rose-400' : kpis.varianzaGlobalPct < 0 ? 'text-emerald-400' : 'text-slate-400'
                }`}>
                  ({kpis.varianzaGlobalPct > 0 ? '+' : ''}{kpis.varianzaGlobalPct}%)
                </span>
              </div>
              <span className="text-[10px] text-slate-500 block mt-1">
                {kpis.diferenciaNetaUSD > 0 ? 'Sobreconsumo neto de obra' : 'Eficiencia de materiales'}
              </span>
            </div>

            <div className="p-3 bg-surfaceHigh/60 border border-borderSubtle rounded-xl">
              <span className="text-[10px] text-slate-500 uppercase font-semibold block">Mermas Críticas (&gt;5%)</span>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className={`text-lg font-bold font-mono ${kpis.mermasCriticasCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {kpis.mermasCriticasCount}
                </span>
                <span className="text-[10px] text-slate-400">/ {kpis.itemsAuditadosCount} insumos</span>
              </div>
              <span className="text-[10px] text-slate-500 block mt-1">
                {kpis.mermasCriticasCount > 0 ? 'Requiere justificación técnica' : 'Dentro de tolerancia'}
              </span>
            </div>
          </div>

          {/* BARRA DE HERRAMIENTAS Y PESTAÑAS */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 print:hidden">
            <div className="flex items-center gap-1 bg-surfaceHigh/60 p-1 rounded-xl border border-borderSubtle text-xs">
              <button
                type="button"
                onClick={() => setFilterTab('ALL')}
                className={`px-3 py-1 rounded-lg font-medium transition ${
                  filterTab === 'ALL' ? 'bg-brand-500 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Todos ({balanceItems.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab('DISCREPANCIAS')}
                className={`px-3 py-1 rounded-lg font-medium transition ${
                  filterTab === 'DISCREPANCIAS' ? 'bg-brand-500 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Discrepancias
              </button>
              <button
                type="button"
                onClick={() => setFilterTab('MERMAS')}
                className={`px-3 py-1 rounded-lg font-medium transition flex items-center gap-1 ${
                  filterTab === 'MERMAS' ? 'bg-rose-500 text-white' : 'text-rose-400 hover:text-white'
                }`}
              >
                Mermas &gt;5% ({kpis.mermasCriticasCount})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab('AHORROS')}
                className={`px-3 py-1 rounded-lg font-medium transition ${
                  filterTab === 'AHORROS' ? 'bg-emerald-500 text-white' : 'text-emerald-400 hover:text-white'
                }`}
              >
                Ahorros
              </button>
              {mueblesSinBOM.length > 0 && (
                <button
                  type="button"
                  onClick={() => setFilterTab('SIN_RECETA')}
                  className={`px-3 py-1 rounded-lg font-medium transition flex items-center gap-1 ${
                    filterTab === 'SIN_RECETA' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-amber-400 hover:text-white'
                  }`}
                >
                  <AlertTriangle className="w-3 h-3" />
                  <span>Sin BOM ({mueblesSinBOM.length})</span>
                </button>
              )}
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar insumo o código..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-surfaceHigh/60 border border-borderSubtle rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-brand-400 font-mono"
              />
            </div>
          </div>

          {/* VISTA 1: TABLA DENSA DE VARIANZA */}
          {filterTab !== 'SIN_RECETA' && (
            <div className="border border-borderSubtle rounded-xl overflow-hidden bg-surfaceHigh/20">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono border-collapse">
                  <thead>
                    <tr className="bg-surfaceHigh/80 text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-borderSubtle">
                      <th className="py-2.5 px-3">Insumo / Material</th>
                      <th className="py-2.5 px-2 text-center">Código</th>
                      <th className="py-2.5 px-2 text-center">U.M.</th>
                      <th className="py-2.5 px-3 text-right">Teórico</th>
                      <th className="py-2.5 px-3 text-right">Real</th>
                      <th className="py-2.5 px-3 text-right">Varianza</th>
                      <th className="py-2.5 px-3 text-right">%</th>
                      <th className="py-2.5 px-3 text-right">Costo USD</th>
                      <th className="py-2.5 px-3 text-center">Diagnóstico</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-borderSubtle">
                    {isLoading ? (
                      <tr>
                        <td colSpan={9} className="py-8 text-center text-slate-400">
                          <RotateCcw className="w-5 h-5 animate-spin mx-auto mb-2 text-brand-400" />
                          <span>Calculando explosión de materiales y contrastando Kardex...</span>
                        </td>
                      </tr>
                    ) : filteredItems.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-8 text-center text-slate-500">
                          No se encontraron insumos bajo los criterios de filtrado seleccionados.
                        </td>
                      </tr>
                    ) : (
                      filteredItems.map(item => {
                        const isMerma = item.estado === 'MERMA_EXCESIVA' || item.estado === 'NO_PRESUPUESTADO';
                        const isAhorro = item.estado === 'AHORRO';
                        const retazoDeclarado = retazosDeclarados[item.mat] || 0;

                        return (
                          <tr key={item.mat} className="hover:bg-surfaceHigh/40 transition">
                            <td className="py-2 px-3">
                              <span className="font-semibold text-slate-200 block text-xs truncate max-w-[280px]">
                                {item.nombre}
                              </span>
                              <span className="text-[10px] text-slate-500">
                                Ref Valery: {item.mat}
                              </span>
                            </td>
                            <td className="py-2 px-2 text-center text-slate-400">
                              <span className="px-1.5 py-0.5 rounded bg-surface border border-borderSubtle text-[10px]">
                                {item.codigo}
                              </span>
                            </td>
                            <td className="py-2 px-2 text-center text-slate-400">
                              {item.unidad}
                            </td>
                            <td className="py-2 px-3 text-right text-slate-300 font-bold">
                              {item.teorico}
                            </td>
                            <td className="py-2 px-3 text-right text-white font-bold">
                              {item.real}
                            </td>
                            <td className={`py-2 px-3 text-right font-bold ${
                              item.diferencia > 0 ? 'text-rose-400' : item.diferencia < 0 ? 'text-emerald-400' : 'text-slate-400'
                            }`}>
                              {item.diferencia > 0 ? `+${item.diferencia}` : item.diferencia}
                              {retazoDeclarado > 0 && (
                                <span className="text-[10px] text-amber-300 block">
                                  (-{retazoDeclarado} retazo)
                                </span>
                              )}
                            </td>
                            <td className={`py-2 px-3 text-right font-bold ${
                              item.varianzaPct > 5 ? 'text-rose-400' : item.varianzaPct < 0 ? 'text-emerald-400' : 'text-slate-400'
                            }`}>
                              {item.varianzaPct > 0 ? `+${item.varianzaPct}%` : `${item.varianzaPct}%`}
                            </td>
                            <td className={`py-2 px-3 text-right font-bold ${
                              item.costoVariacionUSD > 0 ? 'text-rose-400' : item.costoVariacionUSD < 0 ? 'text-emerald-400' : 'text-slate-400'
                            }`}>
                              {item.costoVariacionUSD > 0 ? `+$${item.costoVariacionUSD.toFixed(2)}` : `$${item.costoVariacionUSD.toFixed(2)}`}
                            </td>
                            <td className="py-2 px-3 text-center">
                              {item.estado === 'MERMA_EXCESIVA' && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px] font-bold border border-rose-500/30">
                                  <AlertTriangle className="w-2.5 h-2.5" />
                                  <span>Merma &gt;5%</span>
                                </span>
                              )}
                              {item.estado === 'NO_PRESUPUESTADO' && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 text-[10px] font-bold border border-purple-500/30">
                                  <span>No en BOM</span>
                                </span>
                              )}
                              {item.estado === 'AHORRO' && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold border border-emerald-500/30">
                                  <CheckCircle2 className="w-2.5 h-2.5" />
                                  <span>Eficiente</span>
                                </span>
                              )}
                              {item.estado === 'EXACTO' && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded bg-surface border border-borderSubtle text-slate-400 text-[10px]">
                                  Exacto
                                </span>
                              )}
                              {item.estado === 'NORMAL' && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20 text-[10px]">
                                  Tolerable
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* VISTA 2: SECCIÓN DE PRODUCTOS ESPECIALES SIN RECETA */}
          {filterTab === 'SIN_RECETA' && (
            <div className="space-y-3">
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-200">
                <span className="font-bold text-amber-400 block mb-0.5">⚠️ Transparencia de Ingeniería:</span>
                Los siguientes muebles pertenecen a esta tienda pero fueron ingresados como fabricaciones especiales o sin código estándar de Valery. Para estos muebles, los consumos de taller no se contrastan contra receta automática para no generar falsas mermas.
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {mueblesSinBOM.map(m => (
                  <div key={m.id} className="p-3 bg-surfaceHigh/50 border border-borderSubtle rounded-xl flex items-center justify-between text-xs">
                    <div>
                      <span className="font-semibold text-white block">{m.nombre}</span>
                      <span className="text-[10px] text-slate-400 font-mono">Código: {m.codigo} • {m.motivo}</span>
                    </div>
                    <span className="px-2 py-1 rounded bg-surface border border-borderSubtle font-mono font-bold text-slate-300">
                      Cant: {m.cantidad}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* DECLARACIÓN DE RETAZOS / REMANENTES DEVUELTOS */}
          <div className="p-4 bg-surfaceHigh/40 border border-borderSubtle rounded-xl space-y-3 print:hidden">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-slate-200 uppercase tracking-wider block">
                  Declaración de Retazos / Remanentes Devueltos
                </span>
                <span className="text-[11px] text-slate-400">
                  Si el taller devolvió barras de corte o sobrantes útiles a almacén, regístralos aquí para deducirlos de la merma.
                </span>
              </div>
              {totalRetazosUSD > 0 && (
                <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 rounded-lg">
                  Retazos: -${totalRetazosUSD.toFixed(2)} USD (Merma Ajustada: ${varianzaAjustadaUSD.toFixed(2)} USD)
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={retazoInputMat}
                onChange={(e) => setRetazoInputMat(e.target.value)}
                className="px-3 py-1.5 text-xs bg-surface border border-borderSubtle rounded-xl text-white font-mono flex-1 min-w-[200px]"
              >
                <option value="">Seleccionar material con retazo...</option>
                {balanceItems.filter(b => b.diferencia > 0).map(b => (
                  <option key={b.mat} value={b.mat}>
                    {b.nombre} ({b.codigo}) — Sobrante máx: {b.diferencia} {b.unidad}
                  </option>
                ))}
              </select>

              <input
                type="number"
                min={0.1}
                step="any"
                value={retazoInputQty}
                onChange={(e) => setRetazoInputQty(e.target.value)}
                placeholder="Cantidad devuelta"
                className="w-36 px-3 py-1.5 text-xs bg-surface border border-borderSubtle rounded-xl text-white font-mono"
              />

              <button
                type="button"
                onClick={handleAddRetazo}
                className="px-3 py-1.5 bg-brand-500 hover:bg-brand-600 text-white rounded-xl text-xs font-semibold transition"
              >
                + Declarar Retazo
              </button>
            </div>

            {Object.keys(retazosDeclarados).length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {Object.entries(retazosDeclarados).map(([mat, qty]) => {
                  const it = balanceItems.find(b => b.mat === mat);
                  return (
                    <div key={mat} className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-surface border border-borderSubtle text-xs font-mono text-slate-300">
                      <span>{it?.nombre || mat}: <strong>{qty} {it?.unidad}</strong></span>
                      <button
                        type="button"
                        onClick={() => handleRemoveRetazo(mat)}
                        className="text-slate-500 hover:text-rose-400"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* PIE DE PÁGINA */}
        <div className="p-4 border-t border-borderSubtle bg-surfaceHigh/80 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div className="text-xs text-slate-400">
            <span>Fuente: Catálogo Valery SSOT • Libro Mayor Kardex • BD_Pedidos_Lineas</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold rounded-xl bg-surface hover:bg-surfaceHighest text-slate-300 border border-borderSubtle transition"
            >
              Cerrar
            </button>

            <button
              type="button"
              onClick={() => {
                alert(`Balance de Obra ${selectedOrderCode} consolidado exitosamente. Retazos computados: $${totalRetazosUSD.toFixed(2)} USD. Varianza final: $${varianzaAjustadaUSD.toFixed(2)} USD.`);
                onClose();
              }}
              className="px-4 py-2 text-xs font-semibold rounded-xl bg-brand-500 hover:bg-brand-600 text-white shadow-lg shadow-brand-500/20 transition flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Concluir Auditoría de Cierre</span>
            </button>
          </div>
        </div>

      </div>
    </div>

    {/* Hoja Formal Imprimible Carta de Auditoría */}
    {showPrintSheet && (
      <PrintSheetBOMAudit
        orderCode={selectedOrderCode}
        orderName={selectedOrderName}
        balanceItems={balanceItems}
        mueblesSinBOM={mueblesSinBOM}
        kpis={kpis}
        retazosDeclarados={retazosDeclarados}
        totalRetazosUSD={totalRetazosUSD}
        varianzaAjustadaUSD={varianzaAjustadaUSD}
        onClose={() => setShowPrintSheet(false)}
      />
    )}
  </>
  );
};
