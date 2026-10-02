import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  X, 
  BookOpen, 
  Search, 
  RefreshCw, 
  ExternalLink, 
  Filter, 
  ArrowDownRight, 
  ArrowUpRight, 
  AlertCircle,
  FileText,
  Loader2,
  Calendar,
  Layers
} from 'lucide-react';
import { 
  KardexMovement, 
  fetchKardexMovements, 
  computeRunningBalances 
} from '../services/kardexService';

interface KardexViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialDashboardId?: string | null;
  initialMaterialName?: string | null;
  initialSearchTerm?: string | null;
  currentStock?: number | null;
}

export const KardexViewerModal: React.FC<KardexViewerModalProps> = ({
  isOpen,
  onClose,
  initialDashboardId = null,
  initialMaterialName = null,
  initialSearchTerm = null,
  currentStock = null,
}) => {
  const [movements, setMovements] = useState<KardexMovement[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // Filtros locales
  const [selectedDashboardId, setSelectedDashboardId] = useState<string | null>(initialDashboardId);
  const [selectedMaterialName, setSelectedMaterialName] = useState<string | null>(initialMaterialName);
  const [selectedTipo, setSelectedTipo] = useState<string>('TODOS');
  const [searchTerm, setSearchTerm] = useState<string>(initialSearchTerm || '');
  const [activePhotoUrl, setActivePhotoUrl] = useState<string | null>(null);

  // Sincronizar props cuando cambia el material preseleccionado o el término de búsqueda inicial
  useEffect(() => {
    setSelectedDashboardId(initialDashboardId);
    setSelectedMaterialName(initialMaterialName);
    if (initialSearchTerm !== undefined && initialSearchTerm !== null) {
      setSearchTerm(initialSearchTerm);
    }
  }, [initialDashboardId, initialMaterialName, initialSearchTerm]);

  const loadMovements = useCallback(async (reset = true) => {
    if (reset) {
      setLoading(true);
      setError(null);
    } else {
      setLoadingMore(true);
    }

    try {
      const response = await fetchKardexMovements({
        cursor: reset ? null : nextCursor,
        pageSize: 50,
        dashboardId: selectedDashboardId || undefined,
        tipo: selectedTipo !== 'TODOS' ? selectedTipo : undefined,
      });

      if (response.status === 'error') {
        throw new Error('No se pudo conectar con el Libro Mayor en Notion.');
      }

      setMovements(prev => reset ? response.results : [...prev, ...response.results]);
      setNextCursor(response.nextCursor);
      setHasMore(response.hasMore);
    } catch (err: any) {
      setError(err.message || 'Error desconocido al cargar movimientos de Kardex.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [nextCursor, selectedDashboardId, selectedTipo]);

  // Cargar al abrir o al cambiar filtros de backend
  useEffect(() => {
    if (isOpen) {
      loadMovements(true);
    } else {
      setMovements([]);
      setNextCursor(null);
      setHasMore(false);
      setError(null);
    }
  }, [isOpen, selectedDashboardId, selectedTipo]);

  // Reconstrucción matemática de saldos en memoria
  const computedMovements = useMemo(() => {
    // Si estamos auditando un material específico con stock físico conocido
    if (currentStock !== null && currentStock !== undefined) {
      return computeRunningBalances(movements, currentStock);
    }
    return movements;
  }, [movements, currentStock]);

  // Filtrado local reactivo por texto
  const filteredMovements = useMemo(() => {
    if (!searchTerm.trim()) return computedMovements;
    const term = searchTerm.toLowerCase().trim();
    return computedMovements.filter(m => 
      m.descripcion.toLowerCase().includes(term) ||
      m.folioOAB.toLowerCase().includes(term) ||
      m.numeroNotaEntrega.toLowerCase().includes(term)
    );
  }, [computedMovements, searchTerm]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div 
        className="relative w-full max-w-6xl max-h-[92vh] flex flex-col rounded-xl bg-slate-900 border border-slate-700 shadow-2xl text-slate-100 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* HEADER */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold tracking-tight text-white">
                  Libro Mayor de Almacén (Kardex Inmutable)
                </h2>
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                  Partida Doble
                </span>
              </div>
              <p className="text-xs text-slate-400">
                {selectedMaterialName ? (
                  <span className="flex items-center gap-2 mt-0.5">
                    <span>Auditando insumo:</span>
                    <strong className="text-emerald-400 font-semibold">{selectedMaterialName}</strong>
                    {(() => {
                      const displayStock = (computedMovements.length > 0 && computedMovements[0].saldoCalculado !== undefined)
                        ? computedMovements[0].saldoCalculado
                        : currentStock;
                      return displayStock !== null && displayStock !== undefined ? (
                        <span className="font-mono text-slate-300">
                          (Stock Actual: <strong className="text-white">{displayStock}</strong>)
                        </span>
                      ) : null;
                    })()}
                    <button
                      onClick={() => {
                        setSelectedDashboardId(null);
                        setSelectedMaterialName(null);
                      }}
                      className="ml-2 text-[11px] text-blue-400 hover:text-blue-300 underline"
                    >
                      Ver todos los insumos
                    </button>
                  </span>
                ) : (
                  'Auditoría consolidada de entradas por compra, recepciones y variaciones físicas de planta'
                )}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Cerrar modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* BARRA DE FILTROS & BÚSQUEDA */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-2 flex-1 min-w-[240px] max-w-md">
            <div className="relative w-full">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Buscar por OAB, N° Guía o descripción..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full bg-slate-800/80 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-emerald-500 font-mono"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Selector de Tipo de Movimiento */}
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <Filter className="w-3.5 h-3.5" />
              <select
                value={selectedTipo}
                onChange={e => setSelectedTipo(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
              >
                <option value="TODOS">Todos los tipos</option>
                <option value="🟢 Entrada por Compra">🟢 Entrada por Compra</option>
                <option value="🔴 Salida a Producción">🔴 Salida a Producción</option>
                <option value="🟡 Ajuste / Merma">🟡 Ajuste / Merma</option>
                <option value="📦 Devolución">📦 Devolución</option>
                <option value="⚪ Inventario Inicial">⚪ Inventario Inicial</option>
              </select>
            </div>

            {/* Botón Refrescar */}
            <button
              onClick={() => loadMovements(true)}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 text-xs text-slate-200 transition-colors disabled:opacity-50"
              title="Recargar desde Notion"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
              <span>Actualizar</span>
            </button>
          </div>
        </div>

        {/* TABLA DE MOVIMIENTOS */}
        <div className="flex-1 overflow-auto p-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
              <p className="text-sm font-medium">Consultando libro mayor en Notion...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 text-rose-400 gap-3">
              <AlertCircle className="w-10 h-10" />
              <p className="text-sm font-semibold">{error}</p>
              <button
                onClick={() => loadMovements(true)}
                className="px-4 py-1.5 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 text-xs text-slate-200"
              >
                Reintentar consulta
              </button>
            </div>
          ) : filteredMovements.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-500 gap-2">
              <Layers className="w-10 h-10 stroke-[1.5]" />
              <p className="text-sm font-medium">No se encontraron movimientos registrados con estos filtros.</p>
              <p className="text-xs text-slate-600">Las recepciones confirmadas en Rampa aparecerán aquí automáticamente.</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] font-semibold text-slate-400 uppercase tracking-wider bg-slate-950/40">
                  <th className="py-2.5 px-3">Fecha</th>
                  <th className="py-2.5 px-3">Tipo de Operación</th>
                  <th className="py-2.5 px-3">Descripción / Insumo</th>
                  <th className="py-2.5 px-3 text-right">Cantidad</th>
                  {currentStock !== null && (
                    <th className="py-2.5 px-3 text-right text-emerald-400">Saldo Resultante</th>
                  )}
                  <th className="py-2.5 px-3">Documento Ref.</th>
                  <th className="py-2.5 px-3 text-right">Costo Unit. / Total</th>
                  <th className="py-2.5 px-3 text-center">Evidencia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs font-normal">
                {filteredMovements.map((mov) => {
                  const isEntry = mov.movimiento.toLowerCase().includes('entrada') || 
                                  mov.movimiento.toLowerCase().includes('inicial');
                  const isExit = mov.movimiento.toLowerCase().includes('salida') || 
                                 mov.movimiento.toLowerCase().includes('merma');

                  return (
                    <tr key={mov.id} className="hover:bg-slate-800/40 transition-colors">
                      {/* Fecha */}
                      <td className="py-2.5 px-3 font-mono text-slate-400 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-slate-500" />
                          <span>{mov.fecha}</span>
                        </div>
                      </td>

                      {/* Tipo */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border ${
                          isEntry 
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                            : isExit 
                            ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' 
                            : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                        }`}>
                          {isEntry ? <ArrowDownRight className="w-3 h-3" /> : isExit ? <ArrowUpRight className="w-3 h-3" /> : null}
                          {mov.movimiento}
                        </span>
                      </td>

                      {/* Descripción */}
                      <td className="py-2.5 px-3 text-slate-200 font-medium">
                        {mov.descripcion}
                      </td>

                      {/* Cantidad Delta */}
                      <td className={`py-2.5 px-3 text-right font-mono font-bold whitespace-nowrap ${
                        isEntry ? 'text-emerald-400' : isExit ? 'text-rose-400' : 'text-slate-200'
                      }`}>
                        {isEntry ? `+${mov.cantidad}` : isExit ? `-${mov.cantidad}` : mov.cantidad}
                      </td>

                      {/* Saldo Resultante (si aplica) */}
                      {currentStock !== null && (
                        <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-100 whitespace-nowrap bg-emerald-950/10">
                          {mov.saldoCalculado !== undefined ? mov.saldoCalculado : '—'}
                        </td>
                      )}

                      {/* Documento Ref */}
                      <td className="py-2.5 px-3 text-slate-400 font-mono text-[11px] whitespace-nowrap">
                        <div>
                          <span className="text-slate-300">{mov.folioOAB}</span>
                          {mov.numeroNotaEntrega && mov.numeroNotaEntrega !== '—' && (
                            <span className="text-slate-500 ml-1.5">({mov.numeroNotaEntrega})</span>
                          )}
                        </div>
                      </td>

                      {/* Costos */}
                      <td className="py-2.5 px-3 text-right font-mono text-slate-300 whitespace-nowrap">
                        {mov.costoUnitarioUSD > 0 ? (
                          <div>
                            <div>${mov.costoTotalUSD.toFixed(2)}</div>
                            <div className="text-[10px] text-slate-500">${mov.costoUnitarioUSD.toFixed(2)}/u</div>
                          </div>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>

                      {/* Comprobante */}
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        {mov.comprobanteUrl ? (
                          <button
                            onClick={() => setActivePhotoUrl(mov.comprobanteUrl!)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 text-[11px] transition-colors"
                            title="Ver fotografía de la Nota de Entrega"
                          >
                            <FileText className="w-3 h-3" />
                            <span>Ver Foto</span>
                          </button>
                        ) : (
                          <span className="text-slate-600 text-[11px]">Sin adjunto</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* FOOTER */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-800 bg-slate-900/90 text-xs text-slate-400">
          <div>
            Mostrando <strong className="text-slate-200">{filteredMovements.length}</strong> movimientos
            {hasMore && ' (hay más registros en el libro mayor)'}
          </div>

          <div className="flex items-center gap-3">
            {hasMore && (
              <button
                onClick={() => loadMovements(false)}
                disabled={loadingMore}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs transition-colors disabled:opacity-50"
              >
                {loadingMore ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                <span>Cargar más movimientos</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
            >
              Cerrar
            </button>
          </div>
        </div>

        {/* LIGHTBOX DE FOTOGRAFÍA DE NOTA DE ENTREGA */}
        {activePhotoUrl && (
          <div 
            className="fixed inset-0 z-60 flex items-center justify-center bg-black/90 p-4"
            onClick={() => setActivePhotoUrl(null)}
          >
            <div 
              className="relative max-w-3xl max-h-[85vh] bg-slate-900 border border-slate-700 rounded-xl p-2 overflow-hidden flex flex-col items-center"
              onClick={e => e.stopPropagation()}
            >
              <div className="w-full flex items-center justify-between pb-2 px-2 border-b border-slate-800 text-xs text-slate-300">
                <span className="font-semibold">Comprobante de Recepción / Nota de Entrega</span>
                <div className="flex items-center gap-2">
                  <a 
                    href={activePhotoUrl} 
                    target="_blank" 
                    rel="noreferrer" 
                    className="flex items-center gap-1 text-blue-400 hover:underline"
                  >
                    <span>Abrir original</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  <button 
                    onClick={() => setActivePhotoUrl(null)} 
                    className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="overflow-auto mt-2 max-h-[75vh]">
                <img 
                  src={activePhotoUrl} 
                  alt="Comprobante físico" 
                  className="max-h-[72vh] object-contain rounded"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
