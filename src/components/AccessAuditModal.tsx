import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  ShieldAlert,
  ShieldCheck,
  Search,
  Filter,
  Download,
  RefreshCw,
  Clock,
  AlertTriangle,
  Smartphone,
  Laptop,
  Globe,
  KeyRound,
  CheckCircle2,
  XCircle,
  Loader2,
  Calendar,
  Wrench,
  Zap,
  Check
} from 'lucide-react';
import { reconcileAllocations } from '../services/inventoryService';

interface AuditLogItem {
  id: string;
  timestamp: string;
  timestampReadable?: string;
  eventType: string;
  employeeName: string;
  employeeId?: string;
  puesto?: string;
  area?: string;
  ip: string;
  canal?: string;
  city?: string;
  country?: string;
  ray?: string;
  isSuccess: boolean;
  isHorarioInusual?: boolean;
  details?: string;
  alertSecurity?: boolean;
}

interface AuditMetrics {
  totalEvents: number;
  successfulLogins: number;
  failedAttempts: number;
  twoFactorRequests: number;
  unusualHours: number;
}

interface AccessAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
  token?: string | null;
}

export const AccessAuditModal: React.FC<AccessAuditModalProps> = ({
  isOpen,
  onClose,
  token
}) => {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [metrics, setMetrics] = useState<AuditMetrics>({
    totalEvents: 0,
    successfulLogins: 0,
    failedAttempts: 0,
    twoFactorRequests: 0,
    unusualHours: 0
  });
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<'ALL' | 'SUCCESS' | 'FAILED' | '2FA' | 'UNUSUAL'>('ALL');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Reconciliación Forense MTO y Auto-Sanación (Micro-Fase 10E / D2-10E)
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<any | null>(null);
  const [reconcileError, setReconcileError] = useState<string | null>(null);

  const handleRunReconcile = async (applyFix: boolean) => {
    setReconciling(true);
    setReconcileError(null);
    try {
      const res = await reconcileAllocations(applyFix, token);
      setReconcileResult(res);
      if (applyFix) {
        fetchLogs();
      }
    } catch (e: any) {
      setReconcileError(e.message || 'Error en reconciliación');
    } finally {
      setReconciling(false);
    }
  };

  const fetchLogs = async () => {
    setLoading(true);
    setErrorMsg(null);

    const authToken = token || sessionStorage.getItem('sanesca_auth_jwt') || localStorage.getItem('sanesca_auth_jwt');

    try {
      const res = await fetch('/api/auth/audit-logs', {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        setLogs(data.logs || []);
        if (data.metrics) {
          setMetrics(data.metrics);
        }
      } else {
        setErrorMsg(data.error || 'No se pudieron consultar los registros de auditoría.');
      }
    } catch (err: any) {
      setErrorMsg(`Error de red al consultar auditoría: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchLogs();
    }
  }, [isOpen]);

  // Filtrado reactivo en cliente
  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      // 1. Filtro por categoría
      if (selectedFilter === 'SUCCESS' && !log.isSuccess) return false;
      if (selectedFilter === 'FAILED' && log.isSuccess) return false;
      if (selectedFilter === '2FA' && !(log.eventType.includes('2FA') || log.eventType.includes('PIN_REQUEST') || log.eventType.includes('PIN_CHANGE'))) return false;
      if (selectedFilter === 'UNUSUAL' && !log.isHorarioInusual) return false;

      // 2. Filtro por buscador de texto
      if (!searchTerm.trim()) return true;
      const term = searchTerm.toLowerCase();
      const matchName = (log.employeeName || '').toLowerCase().includes(term);
      const matchEvent = (log.eventType || '').toLowerCase().includes(term);
      const matchIp = (log.ip || '').toLowerCase().includes(term);
      const matchCanal = (log.canal || '').toLowerCase().includes(term);
      const matchDetails = (log.details || '').toLowerCase().includes(term);
      const matchPuesto = (log.puesto || '').toLowerCase().includes(term);

      return matchName || matchEvent || matchIp || matchCanal || matchDetails || matchPuesto;
    });
  }, [logs, selectedFilter, searchTerm]);

  // Exportar registros a formato CSV
  const handleExportCSV = () => {
    if (filteredLogs.length === 0) return;

    const headers = ['Fecha/Hora VET', 'Colaborador', 'Puesto', 'Evento', 'Resultado', 'IP', 'Canal', 'Horario Inusual', 'Detalles'];
    const rows = filteredLogs.map(l => [
      `"${l.timestampReadable || l.timestamp}"`,
      `"${l.employeeName || 'Desconocido'}"`,
      `"${l.puesto || 'N/A'}"`,
      `"${l.eventType}"`,
      `"${l.isSuccess ? 'EXITOSO' : 'FALLIDO'}"`,
      `"${l.ip || 'N/A'}"`,
      `"${l.canal || 'N/A'}"`,
      `"${l.isHorarioInusual ? 'SI' : 'NO'}"`,
      `"${(l.details || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `auditoria_accesos_sanesca_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getEventBadge = (eventType: string, isSuccess: boolean) => {
    if (eventType === 'LOGIN_SUCCESS_PIN' || eventType === 'LOGIN_SUCCESS_TELEGRAM') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
          <CheckCircle2 className="w-3 h-3" />
          {eventType === 'LOGIN_SUCCESS_PIN' ? 'Login PIN' : 'Login Telegram'}
        </span>
      );
    }
    if (eventType === 'LOGIN_FAILED_PIN') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-rose-500/10 text-rose-400 border border-rose-500/30 font-mono">
          <XCircle className="w-3 h-3" />
          PIN Fallido
        </span>
      );
    }
    if (eventType === 'PIN_REQUEST_2FA') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-500/10 text-amber-300 border border-amber-500/30">
          <Smartphone className="w-3 h-3" />
          Solicitud 2FA
        </span>
      );
    }
    if (eventType === 'PIN_CHANGE_APPROVED') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-indigo-500/10 text-indigo-300 border border-indigo-500/30">
          <KeyRound className="w-3 h-3" />
          PIN Actualizado
        </span>
      );
    }
    if (eventType === 'ACCESS_DENIED') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-rose-500/20 text-rose-300 border border-rose-500/40">
          <ShieldAlert className="w-3 h-3" />
          Acceso Denegado
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-800 text-slate-300 border border-slate-700">
        {eventType}
      </span>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-6xl max-h-[92vh] flex flex-col rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl text-slate-100 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Glow Superior */}
        <div className="absolute top-0 left-1/4 w-96 h-28 bg-rose-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Cabecera del Modal */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90 z-10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                  Bitácora Forense de Auditoría & Accesos
                </h2>
                <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30 text-[10px] font-mono uppercase tracking-wider font-semibold">
                  ★ Superadmin
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Monitoreo Zero Trust, telemetría de red, prevención de fuerza bruta y bitácora en tiempo real.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchLogs}
              disabled={loading}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition border border-slate-700 disabled:opacity-50"
              title="Recargar bitácora de auditoría"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-brand-400' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition border border-slate-700"
              title="Cerrar ventana"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 4 KPI Cards de Seguridad */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-6 pb-4 flex-shrink-0 bg-slate-950/40 border-b border-slate-800/80">
          <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
            <span className="text-[11px] text-slate-400 uppercase tracking-wider font-medium">
              Total Eventos Hoy
            </span>
            <div className="text-xl font-bold font-mono text-white mt-1">
              {metrics.totalEvents}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-900 border border-emerald-500/20">
            <span className="text-[11px] text-emerald-400 uppercase tracking-wider font-medium flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> Logins Exitosos
            </span>
            <div className="text-xl font-bold font-mono text-emerald-400 mt-1">
              {metrics.successfulLogins}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-900 border border-rose-500/20">
            <span className="text-[11px] text-rose-400 uppercase tracking-wider font-medium flex items-center gap-1.5">
              <XCircle className="w-3.5 h-3.5" /> Fallos / Bloqueos
            </span>
            <div className="text-xl font-bold font-mono text-rose-400 mt-1">
              {metrics.failedAttempts}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-900 border border-amber-500/20">
            <span className="text-[11px] text-amber-400 uppercase tracking-wider font-medium flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> Horario Inusual
            </span>
            <div className="text-xl font-bold font-mono text-amber-400 mt-1">
              {metrics.unusualHours}
            </div>
          </div>
        </div>

        {/* Sección de Integridad MTO y Auto-Sanación Forense (Micro-Fase 10E / D2-10E) */}
        <div className="px-6 py-2.5 bg-slate-950/70 border-b border-slate-800 flex items-center justify-between gap-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="p-1 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30">
              <Zap className="w-3.5 h-3.5" />
            </span>
            <div>
              <span className="text-xs font-bold text-slate-200">Gobernanza de Reservas MTO (Edge KV vs Notion ERP)</span>
              <span className="text-[10px] text-slate-400 block font-mono">Detección de reservas huérfanas, sobre-reservas y auto-sanación</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setReconcileOpen(prev => !prev)}
              className="px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs font-semibold flex items-center gap-1.5 transition active:scale-95"
            >
              <Wrench className="w-3.5 h-3.5" />
              <span>{reconcileOpen ? 'Ocultar Auditoría MTO' : 'Auditar Reservas MTO'}</span>
            </button>
          </div>
        </div>

        {/* Panel Desplegable de Conciliación y Auto-Sanación */}
        {reconcileOpen && (
          <div className="p-4 bg-slate-950/90 border-b border-amber-500/30 space-y-3 flex-shrink-0 animate-in fade-in duration-150">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-amber-400" />
                Diagnóstico Forense de Reservas Multitienda
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleRunReconcile(false)}
                  disabled={reconciling}
                  className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1 transition disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${reconciling ? 'animate-spin text-amber-400' : ''}`} />
                  <span>Auditar (Solo Lectura)</span>
                </button>
                <button
                  onClick={() => handleRunReconcile(true)}
                  disabled={reconciling}
                  className="px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold flex items-center gap-1 transition shadow-md disabled:opacity-50 active:scale-95"
                >
                  <Wrench className="w-3.5 h-3.5" />
                  <span>Ejecutar Auto-Sanación en KV</span>
                </button>
              </div>
            </div>

            {reconcileError && (
              <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-500/40 text-rose-300 text-xs">
                {reconcileError}
              </div>
            )}

            {reconcileResult && (
              <div className="space-y-2 text-xs">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-900/60 p-2.5 rounded-xl border border-slate-800 text-center font-mono">
                  <div>
                    <span className="block text-[9px] text-slate-400 uppercase font-sans">Reservas Activas</span>
                    <span className="font-bold text-slate-200 text-sm">{reconcileResult.metrics?.totalAllocations || 0}</span>
                  </div>
                  <div>
                    <span className="block text-[9px] text-amber-400 uppercase font-sans">Huérfanas Detectadas</span>
                    <span className="font-bold text-amber-300 text-sm">{reconcileResult.metrics?.orphanReservationsFound || 0}</span>
                  </div>
                  <div>
                    <span className="block text-[9px] text-rose-400 uppercase font-sans">Sobre-Reservas</span>
                    <span className="font-bold text-rose-300 text-sm">{reconcileResult.metrics?.overReservationsFound || 0}</span>
                  </div>
                  <div>
                    <span className="block text-[9px] text-cyan-400 uppercase font-sans">Deudas Operativas</span>
                    <span className="font-bold text-cyan-300 text-sm">{reconcileResult.metrics?.totalDebts || 0} ({reconcileResult.metrics?.activeDebts || 0} pendientes)</span>
                  </div>
                </div>

                {reconcileResult.discrepancies?.length === 0 ? (
                  <div className="p-3 bg-emerald-950/30 border border-emerald-500/30 rounded-xl text-emerald-300 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>¡Integridad 100% verificada! No existen reservas huérfanas ni desvíos contra Notion ERP.</span>
                  </div>
                ) : (
                  <div className="space-y-1 max-h-36 overflow-y-auto pr-1 scrollbar-thin">
                    <span className="text-[11px] font-semibold text-slate-400">
                      Discrepancias {reconcileResult.applyFix ? 'Corregidas' : 'Detectadas'}:
                    </span>
                    {reconcileResult.discrepancies?.map((d: any, idx: number) => (
                      <div key={idx} className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-[11px] flex items-start gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-semibold text-slate-200">{d.type}</span>: {d.detail}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Barra de Filtros, Búsqueda y Exportación */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-b border-slate-800 bg-slate-900/60 flex-shrink-0">
          {/* Píldoras de Filtro */}
          <div className="flex items-center gap-1.5 overflow-x-auto text-xs">
            <button
              onClick={() => setSelectedFilter('ALL')}
              className={`px-3 py-1.5 rounded-lg font-medium transition ${
                selectedFilter === 'ALL'
                  ? 'bg-slate-700 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              Todos ({logs.length})
            </button>
            <button
              onClick={() => setSelectedFilter('SUCCESS')}
              className={`px-3 py-1.5 rounded-lg font-medium transition ${
                selectedFilter === 'SUCCESS'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              Exitosos
            </button>
            <button
              onClick={() => setSelectedFilter('FAILED')}
              className={`px-3 py-1.5 rounded-lg font-medium transition ${
                selectedFilter === 'FAILED'
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              Fallos & Bloqueos
            </button>
            <button
              onClick={() => setSelectedFilter('2FA')}
              className={`px-3 py-1.5 rounded-lg font-medium transition ${
                selectedFilter === '2FA'
                  ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              Eventos 2FA
            </button>
            <button
              onClick={() => setSelectedFilter('UNUSUAL')}
              className={`px-3 py-1.5 rounded-lg font-medium transition ${
                selectedFilter === 'UNUSUAL'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              Horario Inusual
            </button>
          </div>

          {/* Buscador y Exportación */}
          <div className="flex items-center gap-2.5 flex-grow sm:flex-grow-0">
            <div className="relative flex-grow sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Buscar por operador, IP, detalle..."
                className="w-full bg-slate-950 border border-slate-800 focus:border-slate-600 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 outline-none transition"
              />
            </div>

            <button
              onClick={handleExportCSV}
              disabled={filteredLogs.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition disabled:opacity-40"
              title="Descargar bitácora en formato CSV"
            >
              <Download className="w-3.5 h-3.5 text-brand-400" />
              <span>CSV</span>
            </button>
          </div>
        </div>

        {/* Tabla Denso-Industrial de Eventos Forenses */}
        <div className="flex-1 overflow-y-auto p-6 pt-3">
          {errorMsg ? (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 text-rose-400" />
              <div>
                <p className="font-semibold mb-0.5">Error consultando bitácora</p>
                <p className="text-[11px] text-rose-200/90">{errorMsg}</p>
              </div>
            </div>
          ) : loading && logs.length === 0 ? (
            <div className="py-20 flex flex-col items-center justify-center text-slate-500">
              <Loader2 className="w-8 h-8 animate-spin text-brand-400 mb-3" />
              <p className="text-xs font-mono">Consultando memoria forense en Upstash Redis y Notion...</p>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="py-16 text-center text-slate-500 text-xs font-mono">
              No se encontraron registros de auditoría que coincidan con los criterios actuales.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-800 shadow-inner">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-950/80 text-[11px] font-mono text-slate-400 uppercase tracking-wider border-b border-slate-800">
                    <th className="py-2.5 px-3">Fecha / Hora (VET)</th>
                    <th className="py-2.5 px-3">Colaborador / Puesto</th>
                    <th className="py-2.5 px-3">Evento</th>
                    <th className="py-2.5 px-3">Terminal / Red</th>
                    <th className="py-2.5 px-3">Detalle Forense</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-sans">
                  {filteredLogs.map(item => (
                    <tr 
                      key={item.id} 
                      className={`hover:bg-slate-800/40 transition ${
                        item.alertSecurity ? 'bg-rose-950/10' : item.isHorarioInusual ? 'bg-amber-950/10' : ''
                      }`}
                    >
                      {/* Fecha / Hora */}
                      <td className="py-2.5 px-3 whitespace-nowrap font-mono text-[11px] text-slate-300">
                        <div className="flex items-center gap-1.5">
                          <span>{item.timestampReadable || item.timestamp}</span>
                          {item.isHorarioInusual && (
                            <span 
                              className="px-1 py-0.2 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[9px] font-mono"
                              title="Evento registrado fuera de horario operativo (06:30-17:30 VET o domingo)"
                            >
                              ⚠️ Inusual
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Colaborador & Puesto */}
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-slate-100">
                          {item.employeeName}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {item.puesto || 'Sin Puesto'} · {item.area || 'Planta'}
                        </div>
                      </td>

                      {/* Evento & Estado */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {getEventBadge(item.eventType, item.isSuccess)}
                      </td>

                      {/* Terminal / Red */}
                      <td className="py-2.5 px-3">
                        <div className="text-[11px] text-slate-200 flex items-center gap-1">
                          {item.canal?.includes('Telegram') ? (
                            <Smartphone className="w-3 h-3 text-sky-400 flex-shrink-0" />
                          ) : (
                            <Laptop className="w-3 h-3 text-slate-400 flex-shrink-0" />
                          )}
                          <span className="truncate max-w-[140px]">{item.canal || 'PC Oficina'}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                          <Globe className="w-2.5 h-2.5 text-slate-500 flex-shrink-0" />
                          <span>{item.ip}</span>
                          {item.city && <span>({item.city})</span>}
                        </div>
                      </td>

                      {/* Detalle Forense */}
                      <td className="py-2.5 px-3 text-[11px] text-slate-300 max-w-xs">
                        <span className="leading-tight block">
                          {item.details || 'Sin detalles adicionales.'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between text-[11px] text-slate-500 font-mono flex-shrink-0">
          <span>Persistencia: Upstash Redis (Buffer LIFO) + Notion DB_Auditoria_Accesos_Logs</span>
          <button
            onClick={onClose}
            className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition text-xs font-sans"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
