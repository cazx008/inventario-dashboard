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
  Layers,
  RotateCcw,
  ShieldCheck,
  KeyRound
} from 'lucide-react';
import { 
  KardexMovement, 
  fetchKardexMovements, 
  computeRunningBalances,
  reverseKardexMovement,
  ReverseKardexResult
} from '../services/kardexService';

interface KardexViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialDashboardId?: string | null;
  initialMaterialName?: string | null;
  initialSearchTerm?: string | null;
  currentStock?: number | null;
  onReversalSuccess?: (result: ReverseKardexResult) => void;
}

export const KardexViewerModal: React.FC<KardexViewerModalProps> = ({
  isOpen,
  onClose,
  initialDashboardId = null,
  initialMaterialName = null,
  initialSearchTerm = null,
  currentStock = null,
  onReversalSuccess
}) => {
  const [movements, setMovements] = useState<KardexMovement[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // Estados para Reversión de Ajustes (Fase 9I)
  const [reversalTarget, setReversalTarget] = useState<KardexMovement | null>(null);
  const [reversalJustificacion, setReversalJustificacion] = useState('');
  const [reversalPin, setReversalPin] = useState('');
  const [reversing, setReversing] = useState(false);
  const [reversalError, setReversalError] = useState<string | null>(null);
  const [reversalSuccessMsg, setReversalSuccessMsg] = useState<string | null>(null);

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

  // Manejador de reversión de ajuste (Fase 9I)
  const handleExecuteReversal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reversalTarget) return;

    if (reversalJustificacion.trim().length < 10) {
      setReversalError('La justificación debe tener al menos 10 caracteres.');
      return;
    }

    if (!reversalPin.trim()) {
      setReversalError('Debe ingresar el PIN de supervisor.');
      return;
    }

    setReversing(true);
    setReversalError(null);

    try {
      const res = await reverseKardexMovement({
        kardexId: reversalTarget.id,
        justificacion: reversalJustificacion.trim(),
        supervisorPin: reversalPin.trim()
      });

      setReversalSuccessMsg(res.message);
      if (onReversalSuccess) {
        onReversalSuccess(res);
      }

      // Cerrar modal de confirmación tras 1.2s y recargar movimientos
      setTimeout(() => {
        setReversalTarget(null);
        setReversalJustificacion('');
        setReversalPin('');
        setReversalSuccessMsg(null);
        loadMovements(true);
      }, 1200);

    } catch (err: any) {
      setReversalError(err.message || 'Error procesando la reversión del movimiento.');
    } finally {
      setReversing(false);
    }
  };

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
            {/* Chip Rápido Solo Ajustes / Mermas (Fase 9G) */}
            <button
              onClick={() => setSelectedTipo(selectedTipo === '🟡 Ajuste / Merma' ? 'TODOS' : '🟡 Ajuste / Merma')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                selectedTipo === '🟡 Ajuste / Merma'
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-sm'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white hover:border-slate-600'
              }`}
              title="Filtrar exclusivamente asientos de reconteo físico y ajustes de inventario"
            >
              <span>🟡 Solo Ajustes</span>
            </button>

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
                  <th className="py-2.5 px-3 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs font-normal">
                {filteredMovements.map((mov) => {
                  const isAjuste = mov.movimiento.toLowerCase().includes('ajuste') || mov.movimiento.toLowerCase().includes('merma');
                  const isContraAsiento = Boolean(
                    mov.folioOAB?.startsWith('REV-') || 
                    mov.numeroNotaEntrega?.startsWith('REV-') || 
                    mov.descripcion?.includes('[CONTRA-ASIENTO]')
                  );
                  const isEligibleForReversal = isAjuste && !isContraAsiento && mov.cantidad !== 0;

                  const isEntry = mov.movimiento.toLowerCase().includes('entrada') || 
                                  mov.movimiento.toLowerCase().includes('inicial') ||
                                  (isAjuste && mov.cantidad > 0);
                  const isExit = mov.movimiento.toLowerCase().includes('salida') || 
                                 (isAjuste && mov.cantidad < 0);

                  const deltaDisplay = mov.cantidad > 0 
                    ? `+${mov.cantidad}` 
                    : mov.cantidad < 0 
                    ? `${mov.cantidad}` 
                    : '0';

                  let badgeClass = 'bg-amber-500/15 text-amber-300 border-amber-500/30';
                  if (isEntry && !isAjuste) {
                    badgeClass = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
                  } else if (isExit && !isAjuste) {
                    badgeClass = 'bg-rose-500/10 text-rose-400 border-rose-500/20';
                  }

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
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border ${badgeClass}`}>
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
                        {deltaDisplay}
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

                      {/* Acciones de Reversión (Fase 9I) */}
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        {isEligibleForReversal ? (
                          <button
                            onClick={() => {
                              setReversalTarget(mov);
                              setReversalJustificacion('');
                              setReversalPin('');
                              setReversalError(null);
                              setReversalSuccessMsg(null);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30 hover:bg-amber-500/20 text-[11px] font-medium transition-colors"
                            title="Generar contra-asiento formal de corrección (Odoo 18)"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Revertir</span>
                          </button>
                        ) : (
                          <span className="text-slate-600 text-[11px] font-mono">—</span>
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

        {/* SUB-MODAL DE CONFIRMACIÓN DE REVERSIÓN (FASE 9I) */}
        {reversalTarget && (
          <div 
            className="fixed inset-0 z-60 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-in fade-in duration-150"
            onClick={() => !reversing && setReversalTarget(null)}
          >
            <div 
              className="relative w-full max-w-lg bg-slate-900 border border-amber-500/40 rounded-xl shadow-2xl p-6 text-slate-100 flex flex-col gap-4"
              onClick={e => e.stopPropagation()}
            >
              {/* Header del Sub-modal */}
              <div className="flex items-start justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400">
                    <RotateCcw className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <span>Reversión de Ajuste</span>
                      <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        Odoo 18
                      </span>
                    </h3>
                    <p className="text-xs text-slate-400">
                      Contra-asiento compensatorio sobre saldo vivo
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => !reversing && setReversalTarget(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                  disabled={reversing}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Resumen del Movimiento a Revertir */}
              <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-400">Insumo:</span>
                  <span className="font-semibold text-slate-200">{selectedMaterialName || reversalTarget.descripcion}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Folio Original:</span>
                  <span className="font-mono text-amber-300">{reversalTarget.numeroNotaEntrega || reversalTarget.folioOAB || reversalTarget.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Discrepancia asentada (Δ):</span>
                  <span className="font-mono font-bold text-rose-400">{reversalTarget.cantidad > 0 ? `+${reversalTarget.cantidad}` : reversalTarget.cantidad} Und</span>
                </div>
                <div className="flex justify-between border-t border-slate-800 pt-1.5 text-emerald-400 font-semibold">
                  <span>Compensación por Contra-Asiento:</span>
                  <span className="font-mono">{reversalTarget.cantidad < 0 ? `+${Math.abs(reversalTarget.cantidad)}` : `-${Math.abs(reversalTarget.cantidad)}`} Und</span>
                </div>
              </div>

              {/* Alerta de Política */}
              <div className="p-3 rounded-lg bg-amber-950/20 border border-amber-500/20 text-[11px] text-amber-200/90 leading-relaxed">
                <strong>Aviso de Auditoría:</strong> El asiento original no se borrará (Libro Mayor inmutable). Se generará un contra-asiento formal <code>REV-...</code> y se aplicará la compensación aditiva al stock actual en Notion.
              </div>

              {/* Formulario de Reversión */}
              <form onSubmit={handleExecuteReversal} className="flex flex-col gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Justificación técnica del error de conteo <span className="text-rose-400">* (mín. 10 chars)</span>
                  </label>
                  <textarea
                    value={reversalJustificacion}
                    onChange={e => setReversalJustificacion(e.target.value)}
                    disabled={reversing}
                    placeholder="Ej: Error de tipeo en conteo de grano P40 vs P60 por operario en pasillo B..."
                    rows={2}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 text-xs text-white placeholder-slate-500 outline-none resize-none"
                  />
                  <div className="flex justify-between mt-1 text-[10px] text-slate-500">
                    <span>Mínimo 10 caracteres explicativos</span>
                    <span className={reversalJustificacion.trim().length >= 10 ? 'text-emerald-400' : 'text-slate-500'}>
                      {reversalJustificacion.trim().length}/10
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                    <span>PIN de Autorización de Supervisor <span className="text-rose-400">*</span></span>
                  </label>
                  <input
                    type="password"
                    maxLength={6}
                    value={reversalPin}
                    onChange={e => setReversalPin(e.target.value)}
                    disabled={reversing}
                    placeholder="Ingrese PIN (default: 1234)"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 text-xs text-white font-mono placeholder-slate-500 outline-none"
                  />
                </div>

                {reversalError && (
                  <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-500/40 text-xs text-rose-300 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{reversalError}</span>
                  </div>
                )}

                {reversalSuccessMsg && (
                  <div className="p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-500/40 text-xs text-emerald-300 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 shrink-0" />
                    <span>{reversalSuccessMsg}</span>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setReversalTarget(null)}
                    disabled={reversing}
                    className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={reversing || reversalJustificacion.trim().length < 10 || !reversalPin.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs shadow-lg shadow-amber-900/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {reversing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                    <span>Confirmar Contra-Asiento</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

