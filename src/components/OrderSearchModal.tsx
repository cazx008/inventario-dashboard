import React, { useState, useEffect } from 'react';
import { Search, X, FolderKanban, Check, Building2, Calendar, FileText, RefreshCw } from 'lucide-react';
import { OrderReference } from '../types/oab';

interface OrderSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectOrder: (order: OrderReference) => void;
  selectedOrderId?: string;
}

export const OrderSearchModal: React.FC<OrderSearchModalProps> = ({
  isOpen,
  onClose,
  onSelectOrder,
  selectedOrderId
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'TODOS' | 'PED' | 'PRS' | 'FAC'>('TODOS');
  const [orders, setOrders] = useState<OrderReference[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPreview, setSelectedPreview] = useState<OrderReference | null>(null);

  // Cargar pedidos activos desde endpoint hidratado /api/orders/active o fallback
  const fetchOrders = async () => {
    setLoading(true);
    try {
      // 1. Prioridad: Endpoint serverless de órdenes hidratadas (Cloudflare Pages)
      const res = await fetch('/api/orders/active');
      if (res.ok) {
        const data = await res.json();
        if (data.orders && Array.isArray(data.orders) && data.orders.length > 0) {
          setOrders(data.orders);
          setSelectedPreview((prev) => 
            prev ? (data.orders.find((o: OrderReference) => o.id === prev.id) || data.orders[0]) : data.orders[0]
          );
          setLoading(false);
          return;
        }
      }

      // 2. Fallback secundario: Consulta a Notion a través del proxy local
      const fallbackRes = await fetch('/api/notion/databases/3d086805-4e27-814b-9ff4-e694d56a58bb/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_size: 50 })
      });

      if (fallbackRes.ok) {
        const data = await fallbackRes.json();
        const mapped: OrderReference[] = (data.results || []).map((page: any) => {
          const props = page.properties;
          // Propiedad título oficial en BD_Pedidos es "Número de Documento"
          const codigo = props['Número de Documento']?.title?.[0]?.plain_text || 
                         props['Código']?.title?.[0]?.plain_text || 
                         props['Codigo']?.title?.[0]?.plain_text || 
                         props['Nombre']?.title?.[0]?.plain_text || 'ORD-S/N';
          const cliente = props['Cliente']?.rollup?.array?.[0]?.title?.[0]?.plain_text || 
                          props['Cliente']?.rich_text?.[0]?.plain_text || 
                          (props['BD_Clientes']?.relation?.length > 0 ? 'Cliente Registrado' : 'Cliente General');
          const proyecto = props['Proyecto']?.rich_text?.[0]?.plain_text || 
                           props['Obra']?.rich_text?.[0]?.plain_text || 
                           codigo;
          const fecha = props['Fecha del Documento']?.date?.start || page.created_time?.split('T')[0];
          let tipo = 'PED';
          if (codigo.startsWith('PRS') || props['Tipo de Documento']?.select?.name?.includes('PRS')) tipo = 'PRS';
          else if (codigo.startsWith('FAC') || props['Tipo de Documento']?.select?.name?.includes('FAC')) tipo = 'FAC';

          const proyectoId = props['BD_Proyectos']?.relation?.[0]?.id || null;
          return {
            id: page.id,
            codigo,
            cliente,
            proyecto,
            proyectoId,
            tipo,
            fecha
          };
        });

        if (mapped.length > 0) {
          setOrders(mapped);
          setSelectedPreview(mapped[0]);
          setLoading(false);
          return;
        }
      }
    } catch (err) {
      console.warn('Fallo consultando pedidos en Notion, usando catálogo canónico:', err);
    }

    // 3. Fallback canónico si no hay conexión o no hay credenciales
    const fallbackOrders: OrderReference[] = [
      { id: 'ped-42', codigo: 'PED-42', cliente: 'Farmatodo C.A.', proyecto: 'Exhibidores Murales FT Las Mercedes', tipo: 'PED', fecha: '2026-09-28' },
      { id: 'ped-43', codigo: 'PED-43', cliente: 'Automercados Plaza', proyecto: 'Góndolas Centrales Plaza Los Naranjos', tipo: 'PED', fecha: '2026-09-29' },
      { id: 'prs-108', codigo: 'PRS-108', cliente: 'Traki Venezuela', proyecto: 'Remodelación Nivel Tiendas Valencia', tipo: 'PRS', fecha: '2026-09-25' },
      { id: 'ped-44', codigo: 'PED-44', cliente: 'Daka Electrodomésticos', proyecto: 'Mostradores Tecnológicos Daka Bello Monte', tipo: 'PED', fecha: '2026-09-30' },
      { id: 'fac-902', codigo: 'FAC-902', cliente: 'Mundo Total', proyecto: 'Racks Pesados Almacén Charallave', tipo: 'FAC', fecha: '2026-09-20' },
    ];
    setOrders(fallbackOrders);
    setSelectedPreview(fallbackOrders[0]);
    setLoading(false);
  };

  useEffect(() => {
    if (isOpen) {
      fetchOrders();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const filteredOrders = orders.filter(o => {
    const matchesSearch =
      o.codigo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      o.cliente.toLowerCase().includes(searchTerm.toLowerCase()) ||
      o.proyecto.toLowerCase().includes(searchTerm.toLowerCase());

    if (!matchesSearch) return false;
    if (filterType === 'TODOS') return true;
    return o.tipo === filterType;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fade-in no-print">
      <div className="bg-surface border border-borderSubtle rounded-xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Modal Header */}
        <div className="px-5 py-3.5 bg-surfaceHigh border-b border-borderSubtle flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-brand-500/20 text-brand-400 border border-brand-500/40">
              <FolderKanban className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100 tracking-tight">
                Vincular Orden / Proyecto a la Solicitud (ERP D42)
              </h2>
              <p className="text-[11px] text-slate-400">
                Selecciona la orden industrial a la que se cargarán los insumos solicitados
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-md hover:bg-surfaceHighest transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search & Type filter */}
        <div className="p-3 bg-page border-b border-borderSubtle flex flex-col sm:flex-row gap-2.5 items-center justify-between">
          <div className="flex items-center gap-2 w-full sm:w-80">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-3.5 h-3.5" />
              <input
                type="text"
                placeholder="Buscar por código, cliente u obra..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-surface border border-borderSubtle rounded-md text-slate-200 placeholder-slate-500 focus:outline-none focus:border-brand-400"
                autoFocus
              />
            </div>
            <button
              onClick={fetchOrders}
              disabled={loading}
              title="Recargar órdenes desde Notion ERP"
              className="p-1.5 text-slate-400 hover:text-brand-400 hover:bg-surfaceHigh rounded-md border border-borderSubtle transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-brand-400' : ''}`} />
            </button>
          </div>

          <div className="flex gap-1 overflow-x-auto w-full sm:w-auto">
            {(['TODOS', 'PED', 'PRS', 'FAC'] as const).map(type => (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={`px-2.5 py-1 text-xs rounded font-medium transition ${
                  filterType === type
                    ? 'bg-brand-500/20 text-brand-400 border border-brand-500/50'
                    : 'bg-surface text-slate-400 hover:text-slate-200 border border-borderSubtle'
                }`}
              >
                {type === 'TODOS' ? 'Todos' : type}
              </button>
            ))}
          </div>
        </div>

        {/* Content Body: Two columns */}
        <div className="grid grid-cols-1 md:grid-cols-12 flex-1 overflow-hidden">
          {/* Left Column: Order List */}
          <div className="md:col-span-7 border-r border-borderSubtle overflow-y-auto custom-scrollbar p-3 space-y-1.5 max-h-[50vh]">
            {loading ? (
              <div className="py-12 text-center text-slate-400 text-xs">Cargando órdenes de Notion...</div>
            ) : filteredOrders.length === 0 ? (
              <div className="py-12 text-center text-slate-500 text-xs">No se encontraron órdenes.</div>
            ) : (
              filteredOrders.map(order => {
                const isSelected = selectedPreview?.id === order.id;
                return (
                  <div
                    key={order.id}
                    onClick={() => setSelectedPreview(order)}
                    className={`p-2.5 rounded-lg border cursor-pointer transition ${
                      isSelected
                        ? 'bg-surfaceHigh border-brand-500/70 shadow-sm'
                        : 'bg-surface/50 border-borderSubtle/60 hover:bg-surfaceHigh/40'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono font-bold text-xs text-brand-400">
                        {order.codigo}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {order.fecha || ''}
                      </span>
                    </div>
                    <div className="text-xs text-slate-200 font-medium truncate">
                      {order.proyecto}
                    </div>
                    <div className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                      <Building2 className="w-3 h-3 text-slate-500" />
                      <span className="truncate">{order.cliente}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Right Column: Preview & Confirm */}
          <div className="md:col-span-5 p-4 bg-page/50 flex flex-col justify-between">
            {selectedPreview ? (
              <div className="space-y-4">
                <div className="border-b border-borderSubtle pb-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-brand-500/20 text-brand-400 border border-brand-500/30">
                      {selectedPreview.tipo}
                    </span>
                    <span className="text-xs text-slate-400 font-mono">{selectedPreview.fecha}</span>
                  </div>
                  <h3 className="text-base font-bold font-mono text-slate-100 mt-2">
                    {selectedPreview.codigo}
                  </h3>
                  <p className="text-xs text-slate-300 font-medium mt-1">
                    {selectedPreview.proyecto}
                  </p>
                </div>

                <div className="space-y-2 text-xs">
                  <div>
                    <span className="text-slate-500 block text-[10px] uppercase">Cliente:</span>
                    <span className="text-slate-200 font-semibold">{selectedPreview.cliente}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px] uppercase">ID Transaccional:</span>
                    <span className="text-slate-400 font-mono text-[10px]">{selectedPreview.id}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-12 text-center text-slate-500 text-xs">
                Selecciona una orden de la lista para ver sus detalles.
              </div>
            )}

            <div className="pt-4 border-t border-borderSubtle flex items-center justify-end gap-2 mt-4">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-white"
              >
                Cancelar
              </button>
              <button
                disabled={!selectedPreview}
                onClick={() => {
                  if (selectedPreview) {
                    onSelectOrder(selectedPreview);
                    onClose();
                  }
                }}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-brand-500 hover:bg-brand-600 text-slate-950 transition disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Confirmar Selección</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
