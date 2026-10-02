import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Lock, User, KeyRound, Search, Check, AlertCircle, Loader2, X, ShieldAlert, Sparkles, Building2, Send, ShieldCheck, Smartphone, Clock, RefreshCw } from 'lucide-react';
import { ActiveEmployee, UserProfile } from '../types/auth';

interface PinLoginModalProps {
  isOpen: boolean;
  onLogin: (employeeId: string, pin: string, rememberShift: boolean) => Promise<{
    success: boolean;
    error?: string;
    intentosRestantes?: number;
    locked?: boolean;
    remainingSeconds?: number;
  }>;
  onDirectLogin?: (profile: UserProfile, token: string) => void;
}

type TwoFaStatus = 'IDLE' | 'REQUESTING' | 'WAITING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'NEW_PIN_SETUP';

export const PinLoginModal: React.FC<PinLoginModalProps> = ({
  isOpen,
  onLogin,
  onDirectLogin
}) => {
  const [employees, setEmployees] = useState<ActiveEmployee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [selectedEmp, setSelectedEmp] = useState<ActiveEmployee | null>(null);
  
  // Search & Combobox State
  const [searchTerm, setSearchTerm] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  
  // PIN & Submission State
  const [pin, setPin] = useState('');
  const [rememberShift, setRememberShift] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Anti-Fuerza Bruta & Lockout State
  const [isLockedOut, setIsLockedOut] = useState(false);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);

  // Protocolo 2FA Interactivo por Telegram
  const [twoFaStatus, setTwoFaStatus] = useState<TwoFaStatus>('IDLE');
  const [twoFaRequestId, setTwoFaRequestId] = useState<string | null>(null);
  const [twoFaSecondsLeft, setTwoFaSecondsLeft] = useState(120);
  const [twoFaOneTimeToken, setTwoFaOneTimeToken] = useState<string | null>(null);
  const [twoFaActionType, setTwoFaActionType] = useState<string | null>(null);
  const [twoFaError, setTwoFaError] = useState<string | null>(null);

  // Formulario de asignación/modificación de PIN respaldado por 2FA
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [updatingPin, setUpdatingPin] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Cargar catálogo seguro de empleados al abrir
  useEffect(() => {
    if (!isOpen) return;
    setLoadingEmployees(true);
    setErrorMessage(null);
    setPin('');
    setSearchTerm('');
    setIsDropdownOpen(false);
    setTwoFaStatus('IDLE');
    setTwoFaRequestId(null);
    setTwoFaError(null);

    fetch('/api/auth/employees')
      .then(res => res.json())
      .then(data => {
        if (data.status === 'success' && data.employees) {
          setEmployees(data.employees);
          // Pre-seleccionar por defecto si hay un empleado con PIN activo o Mikel
          const defaultEmp = data.employees.find((e: ActiveEmployee) => e.name.toLowerCase().includes('mikel') && e.hasPin) ||
                             data.employees.find((e: ActiveEmployee) => e.hasPin);
          if (defaultEmp) {
            setSelectedEmp(defaultEmp);
          } else if (data.employees.length > 0) {
            setSelectedEmp(data.employees[0]);
          }
        }
      })
      .catch(err => {
        console.warn('Error cargando empleados:', err);
        setErrorMessage('No se pudo cargar la lista de personal de planta.');
      })
      .finally(() => setLoadingEmployees(false));
  }, [isOpen]);

  // Click outside para cerrar el dropdown de búsqueda
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Temporizador de Bloqueo por Fuerza Bruta (Cuenta regresiva)
  useEffect(() => {
    if (!isLockedOut || lockoutSeconds <= 0) return;
    const timer = setInterval(() => {
      setLockoutSeconds(prev => {
        if (prev <= 1) {
          setIsLockedOut(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isLockedOut, lockoutSeconds]);

  // Polling suave y Temporizador de 120s para Solicitud 2FA
  useEffect(() => {
    if (twoFaStatus !== 'WAITING' || !twoFaRequestId) {
      if (pollingRef.current) clearInterval(pollingRef.current);
      return;
    }

    // Temporizador de 120 segundos
    const countdown = setInterval(() => {
      setTwoFaSecondsLeft(prev => {
        if (prev <= 1) {
          setTwoFaStatus('EXPIRED');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // Polling cada 2 segundos a Cloudflare Functions
    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/auth/pin-request-status?id=${twoFaRequestId}`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.status === 'APPROVED') {
          clearInterval(pollingRef.current!);
          clearInterval(countdown);

          if (data.action === 'TEMP_SESSION' && data.tempToken && data.profile) {
            // Sesión temporal autorizada de 1 hora
            setTwoFaStatus('APPROVED');
            if (onDirectLogin) {
              onDirectLogin(data.profile, data.tempToken);
            }
          } else if (data.oneTimeToken) {
            // Aprobado para introducir o modificar PIN en PC
            setTwoFaOneTimeToken(data.oneTimeToken);
            setTwoFaActionType(data.action);
            setTwoFaStatus('NEW_PIN_SETUP');
          }
        } else if (data.status === 'REJECTED') {
          clearInterval(pollingRef.current!);
          clearInterval(countdown);
          setTwoFaStatus('REJECTED');
        } else if (data.status === 'EXPIRED') {
          clearInterval(pollingRef.current!);
          clearInterval(countdown);
          setTwoFaStatus('EXPIRED');
        }
      } catch (e) {
        console.warn('Error en polling 2FA:', e);
      }
    }, 2000);

    return () => {
      clearInterval(countdown);
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [twoFaStatus, twoFaRequestId, onDirectLogin]);

  // Soporte de Teclado Físico para Desktop PC (0-9, Backspace, Enter)
  useEffect(() => {
    if (!isOpen || !selectedEmp || isDropdownOpen || twoFaStatus !== 'IDLE' || isLockedOut) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignorar si el usuario está escribiendo en el buscador
      if (document.activeElement === searchInputRef.current) return;

      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        if (pin.length < 4) {
          setPin(prev => prev + e.key);
          setErrorMessage(null);
        }
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setPin(prev => prev.slice(0, -1));
        setErrorMessage(null);
      } else if (e.key === 'Enter' && pin.length === 4 && !submitting) {
        e.preventDefault();
        triggerSubmit();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, selectedEmp, pin, submitting, isDropdownOpen, twoFaStatus, isLockedOut]);

  // Filtrado reactivo de empleados (por nombre o departamentos/áreas)
  const filteredEmployees = useMemo(() => {
    if (!searchTerm.trim()) return employees;
    const term = searchTerm.toLowerCase().trim();
    return employees.filter(emp => {
      const matchName = emp.name.toLowerCase().includes(term);
      const matchArea = emp.areas && emp.areas.some(a => a.toLowerCase().includes(term));
      return matchName || matchArea;
    });
  }, [employees, searchTerm]);

  if (!isOpen) return null;

  const triggerSubmit = async () => {
    if (!selectedEmp) {
      setErrorMessage('Seleccione su nombre de la lista.');
      return;
    }
    if (!selectedEmp.hasPin) {
      setErrorMessage('Este usuario no tiene PIN configurado. Usa el botón 2FA para solicitar acceso.');
      return;
    }
    if (pin.length !== 4) {
      setErrorMessage('El PIN debe contener exactamente 4 dígitos.');
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    const result = await onLogin(selectedEmp.id, pin, rememberShift);
    setSubmitting(false);

    if (!result.success) {
      if (result.locked) {
        setIsLockedOut(true);
        setLockoutSeconds(result.remainingSeconds || 600);
      }
      setErrorMessage(result.error || 'PIN incorrecto.');
      setPin('');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    triggerSubmit();
  };

  // Iniciar Solicitud 2FA interactiva a Sistemas (Mikel)
  const handleRequest2FA = async () => {
    if (!selectedEmp) return;
    setTwoFaStatus('REQUESTING');
    setTwoFaError(null);

    try {
      const res = await fetch('/api/auth/pin-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: selectedEmp.id })
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        setTwoFaRequestId(data.requestId);
        setTwoFaSecondsLeft(data.ttl || 120);
        setTwoFaStatus('WAITING');
      } else {
        setTwoFaStatus('IDLE');
        setErrorMessage(data.error || 'No se pudo emitir la solicitud a Telegram.');
        if (data.locked) {
          setIsLockedOut(true);
          setLockoutSeconds(data.remainingSeconds || 600);
        }
      }
    } catch (err: any) {
      setTwoFaStatus('IDLE');
      setErrorMessage(`Error conectando con el servidor: ${err.message}`);
    }
  };

  // Guardar nuevo PIN autorizado por 2FA
  const handleSaveNewPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmp || !twoFaOneTimeToken) return;

    if (!/^\d{4}$/.test(newPin)) {
      setTwoFaError('El nuevo PIN debe tener exactamente 4 dígitos numéricos.');
      return;
    }
    if (newPin !== confirmPin) {
      setTwoFaError('Los PINs ingresados no coinciden.');
      return;
    }

    setUpdatingPin(true);
    setTwoFaError(null);

    try {
      const res = await fetch('/api/auth/pin-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: selectedEmp.id,
          newPin,
          oneTimeToken: twoFaOneTimeToken
        })
      });

      const data = await res.json();
      if (res.ok && data.status === 'success') {
        // PIN asignado exitosamente en Notion. Iniciar sesión inmediata
        const loginRes = await onLogin(selectedEmp.id, newPin, true);
        if (!loginRes.success) {
          // Si por alguna razón falla, volver al keypad principal con PIN prellenado
          setTwoFaStatus('IDLE');
          setPin(newPin);
        }
      } else {
        setTwoFaError(data.error || 'Error al guardar el PIN en Notion.');
      }
    } catch (err: any) {
      setTwoFaError(`Error de red: ${err.message}`);
    } finally {
      setUpdatingPin(false);
    }
  };

  const handleKeypadPress = (digit: string) => {
    if (selectedEmp && !selectedEmp.hasPin) return;
    if (pin.length < 4) {
      setPin(prev => prev + digit);
      setErrorMessage(null);
    }
  };

  const handleBackspace = () => {
    setPin(prev => prev.slice(0, -1));
    setErrorMessage(null);
  };

  const handleClear = () => {
    setPin('');
    setErrorMessage(null);
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(n => n[0].toUpperCase())
      .join('');
  };

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const isSelectedEmpWithoutPin = Boolean(selectedEmp && !selectedEmp.hasPin);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 text-slate-100 overflow-visible"
        onClick={e => e.stopPropagation()}
      >
        {/* Glow sutil */}
        <div className="absolute -top-10 -left-10 w-28 h-28 bg-emerald-500/10 rounded-full blur-xl pointer-events-none" />

        {/* ======================================================== */}
        {/* VISTA 1: BLOQUEO POR FUERZA BRUTA (10 MINUTOS) */}
        {/* ======================================================== */}
        {isLockedOut ? (
          <div className="text-center py-2 animate-in fade-in duration-200">
            <div className="w-14 h-14 rounded-2xl bg-rose-500/20 border border-rose-500/40 text-rose-400 mx-auto flex items-center justify-center mb-3 shadow-lg shadow-rose-500/20">
              <ShieldAlert className="w-7 h-7" />
            </div>
            <h2 className="text-base font-bold text-white tracking-tight mb-1">
              Terminal Bloqueada por Seguridad
            </h2>
            <p className="text-xs text-rose-300 font-medium mb-3">
              Has superado el límite de 3 intentos fallidos de PIN.
            </p>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-center mb-4">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-mono">
                Tiempo de enfriamiento restante
              </span>
              <div className="text-2xl font-black font-mono text-amber-400 tracking-wider mt-1">
                {formatSeconds(lockoutSeconds)}
              </div>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed mb-5">
              Se ha despachado una alerta a Sistemas con un botón para desbloquearte de inmediato desde Telegram.
            </p>

            <button
              type="button"
              onClick={() => {
                // Comprobar si el Superadmin ya desbloqueó desde Telegram
                setIsLockedOut(false);
                setPin('');
                setErrorMessage(null);
              }}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
            >
              <RefreshCw className="w-3.5 h-3.5 text-brand-400" />
              Comprobar Desbloqueo Remoto
            </button>
          </div>
        ) : twoFaStatus === 'WAITING' ? (
          /* ======================================================== */
          /* VISTA 2: ESPERANDO AUTORIZACIÓN 2FA EN TELEGRAM (120s) */
          /* ======================================================== */
          <div className="text-center py-2 animate-in fade-in duration-200">
            <div className="relative w-16 h-16 mx-auto mb-3 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-emerald-500/20 animate-ping opacity-75" />
              <div className="relative w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/40 text-emerald-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <Smartphone className="w-7 h-7 animate-pulse" />
              </div>
            </div>

            <h2 className="text-base font-bold text-white tracking-tight mb-1">
              Esperando Confirmación 2FA
            </h2>
            <p className="text-xs text-slate-400 mb-4">
              Notificación enviada a <span className="text-white font-medium">Mikel (Sistemas)</span> por Telegram
            </p>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 mb-4">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5 font-mono">
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                  Expira en:
                </span>
                <span className="font-bold text-amber-400">{twoFaSecondsLeft}s</span>
              </div>
              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div 
                  className="bg-emerald-500 h-full transition-all duration-1000 ease-linear"
                  style={{ width: `${(twoFaSecondsLeft / 120) * 100}%` }}
                />
              </div>
            </div>

            <div className="text-[11px] text-slate-400 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80 mb-5 leading-tight text-left">
              💬 En cuanto Mikel pulse <span className="text-emerald-400 font-semibold">"Aprobar"</span> en su teléfono, esta pantalla se desbloqueará de forma automática.
            </div>

            <button
              type="button"
              onClick={() => setTwoFaStatus('IDLE')}
              className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
            >
              Cancelar Solicitud
            </button>
          </div>
        ) : twoFaStatus === 'REJECTED' ? (
          /* ======================================================== */
          /* VISTA 3: SOLICITUD RECHAZADA POR SUPERADMIN */
          /* ======================================================== */
          <div className="text-center py-2 animate-in fade-in duration-200">
            <div className="w-14 h-14 rounded-2xl bg-rose-500/20 border border-rose-500/40 text-rose-400 mx-auto flex items-center justify-center mb-3">
              <X className="w-7 h-7" />
            </div>
            <h2 className="text-base font-bold text-white tracking-tight mb-1">
              Solicitud Denegada
            </h2>
            <p className="text-xs text-slate-400 mb-5">
              Sistemas ha rechazado la solicitud de autorización para esta terminal.
            </p>
            <button
              type="button"
              onClick={() => setTwoFaStatus('IDLE')}
              className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
            >
              Regresar al Inicio
            </button>
          </div>
        ) : twoFaStatus === 'EXPIRED' ? (
          /* ======================================================== */
          /* VISTA 4: SOLICITUD EXPIRADA */
          /* ======================================================== */
          <div className="text-center py-2 animate-in fade-in duration-200">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/20 border border-amber-500/40 text-amber-400 mx-auto flex items-center justify-center mb-3">
              <Clock className="w-7 h-7" />
            </div>
            <h2 className="text-base font-bold text-white tracking-tight mb-1">
              Tiempo Agotado
            </h2>
            <p className="text-xs text-slate-400 mb-5">
              La solicitud 2FA caducó tras 120 segundos sin confirmación.
            </p>
            <button
              type="button"
              onClick={() => setTwoFaStatus('IDLE')}
              className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
            >
              Reintentar
            </button>
          </div>
        ) : twoFaStatus === 'NEW_PIN_SETUP' ? (
          /* ======================================================== */
          /* VISTA 5: ESTABLECER NUEVO PIN (AUTORIZADO POR 2FA) */
          /* ======================================================== */
          <div className="animate-in fade-in duration-200">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white tracking-tight">
                  Autorización 2FA Aprobada
                </h2>
                <p className="text-[11px] font-mono text-emerald-400">
                  {selectedEmp?.name}
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveNewPin} className="space-y-4">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 uppercase tracking-wider mb-1.5">
                  Nuevo PIN (4 dígitos numéricos)
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={newPin}
                  onChange={e => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                    setNewPin(val);
                    setTwoFaError(null);
                  }}
                  placeholder="••••"
                  autoFocus
                  className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-xl py-2.5 px-3 text-center text-lg tracking-widest text-emerald-400 font-mono outline-none transition"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-400 uppercase tracking-wider mb-1.5">
                  Confirmar Nuevo PIN
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={confirmPin}
                  onChange={e => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                    setConfirmPin(val);
                    setTwoFaError(null);
                  }}
                  placeholder="••••"
                  className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-xl py-2.5 px-3 text-center text-lg tracking-widest text-emerald-400 font-mono outline-none transition"
                />
              </div>

              {twoFaError && (
                <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{twoFaError}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={updatingPin || newPin.length !== 4 || confirmPin.length !== 4}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-semibold text-xs tracking-wide uppercase bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 text-white shadow-lg shadow-emerald-500/20 active:scale-[0.98] transition-all disabled:opacity-40"
              >
                {updatingPin ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Guardando PIN en Notion...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    Guardar PIN e Iniciar Sesión
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setTwoFaStatus('IDLE')}
                className="w-full py-2 text-xs text-slate-500 hover:text-slate-300 transition"
              >
                Cancelar
              </button>
            </form>
          </div>
        ) : (
          /* ======================================================== */
          /* VISTA DEFAULT: LOGIN CON PIN Y DISPARADOR 2FA */
          /* ======================================================== */
          <>
            {/* Cabecera */}
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white tracking-tight">
                  Terminal de Oficina
                </h2>
                <p className="text-[11px] font-mono text-slate-400">
                  Sanesca PRO · Identificación Operativa
                </p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Selector de Empleado con Autocompletado */}
              <div className="relative" ref={dropdownRef}>
                <label className="block text-[11px] font-medium text-slate-400 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-slate-500" />
                    Operador / Usuario
                  </span>
                  {selectedEmp && !isDropdownOpen && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsDropdownOpen(true);
                        setTimeout(() => searchInputRef.current?.focus(), 50);
                      }}
                      className="text-[10px] text-brand-400 hover:text-brand-300 font-normal transition"
                    >
                      Cambiar usuario
                    </button>
                  )}
                </label>

                {loadingEmployees ? (
                  <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-500">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                    Cargando personal asignado a departamentos...
                  </div>
                ) : selectedEmp && !isDropdownOpen ? (
                  /* Tarjeta de Usuario Seleccionado */
                  <div 
                    onClick={() => {
                      setIsDropdownOpen(true);
                      setTimeout(() => searchInputRef.current?.focus(), 50);
                    }}
                    className="group flex items-center justify-between p-2.5 rounded-xl bg-slate-950 border border-slate-700/80 hover:border-slate-500 cursor-pointer transition shadow-inner"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-brand-600 to-indigo-600 flex items-center justify-center text-xs font-bold text-white flex-shrink-0 shadow-sm">
                        {getInitials(selectedEmp.name)}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-100 truncate group-hover:text-brand-300 transition">
                          {selectedEmp.name}
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-slate-400 truncate">
                          <Building2 className="w-2.5 h-2.5 text-slate-500 flex-shrink-0" />
                          <span className="truncate">
                            {(selectedEmp.areas && selectedEmp.areas.length > 0) ? selectedEmp.areas.join(', ') : 'Operaciones'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                      {selectedEmp.hasPin ? (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-mono flex items-center gap-1">
                          <Check className="w-2.5 h-2.5" /> PIN
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[10px] font-mono">
                          Sin PIN
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  /* Input Buscador con Autocompletado */
                  <div>
                    <div className="relative">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none" />
                      <input
                        ref={searchInputRef}
                        type="text"
                        value={searchTerm}
                        onChange={e => {
                          setSearchTerm(e.target.value);
                          setIsDropdownOpen(true);
                        }}
                        onFocus={() => setIsDropdownOpen(true)}
                        placeholder="Buscar por nombre o departamento..."
                        className="w-full bg-slate-950 border border-brand-500/60 focus:border-brand-400 focus:ring-1 focus:ring-brand-400 rounded-xl pl-9 pr-8 py-2.5 text-xs text-slate-100 outline-none transition"
                      />
                      {searchTerm && (
                        <button
                          type="button"
                          onClick={() => setSearchTerm('')}
                          className="absolute right-2.5 top-2.5 text-slate-400 hover:text-white p-0.5"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Dropdown de Resultados Filtrados */}
                    {isDropdownOpen && (
                      <div className="absolute left-0 right-0 top-full mt-1.5 max-h-56 overflow-y-auto rounded-xl bg-slate-950 border border-slate-700 shadow-2xl z-50 divide-y divide-slate-800/60">
                        {filteredEmployees.length === 0 ? (
                          <div className="p-3 text-center text-xs text-slate-500 font-mono">
                            No se encontraron operadores con ese criterio
                          </div>
                        ) : (
                          filteredEmployees.map(emp => (
                            <div
                              key={emp.id}
                              onClick={() => {
                                setSelectedEmp(emp);
                                setIsDropdownOpen(false);
                                setSearchTerm('');
                                setPin('');
                                setErrorMessage(null);
                              }}
                              className={`flex items-center justify-between p-2.5 hover:bg-slate-800/80 cursor-pointer transition ${
                                selectedEmp?.id === emp.id ? 'bg-slate-800/60 text-brand-300' : 'text-slate-200'
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <div className="w-6 h-6 rounded bg-slate-800 text-[10px] font-bold text-slate-300 flex items-center justify-center flex-shrink-0">
                                  {getInitials(emp.name)}
                                </div>
                                <div className="min-w-0">
                                  <p className="text-xs font-medium truncate">{emp.name}</p>
                                  {emp.areas && emp.areas.length > 0 && (
                                    <p className="text-[10px] text-slate-400 truncate">
                                      {emp.areas.join(', ')}
                                    </p>
                                  )}
                                </div>
                              </div>

                              <div className="flex-shrink-0 ml-2">
                                {emp.hasPin ? (
                                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/30">
                                    🔑 Con PIN
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-mono text-slate-500 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                                    Sin PIN
                                  </span>
                                )}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Botón de Solicitud 2FA interactiva a Sistemas */}
              {selectedEmp && (
                <div className="pt-0.5">
                  <button
                    type="button"
                    onClick={handleRequest2FA}
                    disabled={twoFaStatus === 'REQUESTING'}
                    className={`w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl border text-xs font-semibold transition active:scale-[0.98] ${
                      selectedEmp.hasPin
                        ? 'bg-slate-950 hover:bg-slate-800 text-slate-300 border-slate-800 hover:border-slate-700'
                        : 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/40 hover:border-amber-500/60 shadow-sm'
                    }`}
                  >
                    {twoFaStatus === 'REQUESTING' ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                        <span>Enviando alerta a Telegram...</span>
                      </>
                    ) : selectedEmp.hasPin ? (
                      <>
                        <Smartphone className="w-3.5 h-3.5 text-brand-400" />
                        <span>Solicitar Modificar PIN (2FA Telegram)</span>
                      </>
                    ) : (
                      <>
                        <Smartphone className="w-3.5 h-3.5 text-amber-400" />
                        <span>Solicitar Acceso o Nuevo PIN a Sistemas (2FA)</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Input Visual de PIN (4 Puntos) */}
              <div className={isSelectedEmpWithoutPin ? 'opacity-40 pointer-events-none' : ''}>
                <label className="block text-[11px] font-medium text-slate-400 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-slate-500" />
                    PIN Operativo (4 Dígitos)
                  </span>
                  <span className="text-[10px] font-mono text-slate-500 hidden sm:inline">
                    (Puedes usar tu teclado físico)
                  </span>
                </label>
                <div className="flex items-center justify-center gap-3 py-2.5 bg-slate-950 rounded-xl border border-slate-800 shadow-inner mb-3">
                  {[0, 1, 2, 3].map(idx => (
                    <div
                      key={idx}
                      className={`w-3.5 h-3.5 rounded-full transition-all duration-150 ${
                        idx < pin.length
                          ? 'bg-emerald-400 scale-110 shadow-lg shadow-emerald-500/50'
                          : 'bg-slate-800 border border-slate-700'
                      }`}
                    />
                  ))}
                </div>

                {/* Teclado Numérico */}
                <div className="grid grid-cols-3 gap-1.5">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => handleKeypadPress(d)}
                      disabled={submitting || isSelectedEmpWithoutPin}
                      className="py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 active:bg-slate-600 text-slate-100 font-semibold text-sm transition-all shadow-sm active:scale-95 disabled:opacity-40"
                    >
                      {d}
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={handleBackspace}
                    disabled={submitting || pin.length === 0}
                    className="py-2.5 rounded-xl bg-slate-800/50 hover:bg-slate-700/80 active:bg-slate-600 text-slate-400 hover:text-slate-200 text-xs font-medium transition-all disabled:opacity-30"
                  >
                    ⌫ Borrar
                  </button>

                  <button
                    type="button"
                    onClick={() => handleKeypadPress('0')}
                    disabled={submitting || isSelectedEmpWithoutPin}
                    className="py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 active:bg-slate-600 text-slate-100 font-semibold text-sm transition-all shadow-sm active:scale-95 disabled:opacity-40"
                  >
                    0
                  </button>

                  <button
                    type="button"
                    onClick={handleClear}
                    disabled={submitting || pin.length === 0}
                    className="py-2.5 rounded-xl bg-slate-800/50 hover:bg-slate-700/80 active:bg-slate-600 text-slate-400 hover:text-slate-200 text-xs font-medium transition-all disabled:opacity-30"
                  >
                    Limpiar
                  </button>
                </div>
              </div>

              {/* Recordar sesión de turno */}
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="rememberShift"
                  checked={rememberShift}
                  onChange={e => setRememberShift(e.target.checked)}
                  className="rounded bg-slate-950 border-slate-700 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-slate-900"
                />
                <label htmlFor="rememberShift" className="text-xs text-slate-400 cursor-pointer select-none">
                  Recordar sesión durante el turno (8 horas)
                </label>
              </div>

              {/* Mensaje de Error */}
              {errorMessage && (
                <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-2 animate-in shake duration-200">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Botón de Submit */}
              <button
                type="submit"
                disabled={submitting || pin.length !== 4 || isSelectedEmpWithoutPin}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-semibold text-xs tracking-wide uppercase bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:from-teal-500 text-white shadow-lg shadow-emerald-500/20 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Verificando credenciales...
                  </>
                ) : isSelectedEmpWithoutPin ? (
                  'PIN No Registrado'
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    Ingresar al Sistema
                  </>
                )}
              </button>
            </form>

            {/* Ayuda sobre PIN */}
            <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-500 text-center leading-tight">
              💡 Para modificar tu PIN o ingresar por primera vez, pulsa el botón de <span className="text-slate-400 font-semibold">2FA Telegram</span> para solicitar autorización a Sistemas.
            </div>
          </>
        )}
      </div>
    </div>
  );
};
