import React, { useState, useEffect, useRef } from 'react';
import { 
  KeyRound, 
  X, 
  Check, 
  Loader2, 
  AlertCircle, 
  CheckCircle2, 
  Smartphone, 
  Clock, 
  RefreshCw, 
  ShieldAlert,
  SendHorizontal
} from 'lucide-react';

interface ChangePinModalProps {
  isOpen: boolean;
  onClose: () => void;
  userName: string;
  employeeId?: string | number;
  isSuperadmin?: boolean;
}

type TwoFaStatus = 'IDLE' | 'REQUESTING' | 'WAITING' | 'NEW_PIN_SETUP' | 'REJECTED' | 'EXPIRED' | 'SUCCESS';

export const ChangePinModal: React.FC<ChangePinModalProps> = ({
  isOpen,
  onClose,
  userName,
  employeeId,
  isSuperadmin = false
}) => {
  // Estados 2FA y formulario
  const [twoFaStatus, setTwoFaStatus] = useState<TwoFaStatus>(isSuperadmin ? 'NEW_PIN_SETUP' : 'IDLE');
  const [twoFaRequestId, setTwoFaRequestId] = useState<string | null>(null);
  const [twoFaSecondsLeft, setTwoFaSecondsLeft] = useState<number>(120);
  const [twoFaOneTimeToken, setTwoFaOneTimeToken] = useState<string | null>(null);

  // Estados de PIN
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinStep, setPinStep] = useState<'ENTER_NEW' | 'CONFIRM_NEW'>('ENTER_NEW');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Limpiar timers al desmontar o cerrar
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  // Polling a Cloudflare Functions mientras espera aprobación 2FA
  useEffect(() => {
    if (twoFaStatus !== 'WAITING' || !twoFaRequestId) {
      if (pollingRef.current) clearInterval(pollingRef.current);
      return;
    }

    // Cuenta regresiva de 120 segundos
    const countdown = setInterval(() => {
      setTwoFaSecondsLeft(prev => {
        if (prev <= 1) {
          setTwoFaStatus('EXPIRED');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // Polling cada 2 segundos a status endpoint
    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/auth/pin-request-status?id=${twoFaRequestId}`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.status === 'APPROVED' && data.oneTimeToken) {
          clearInterval(pollingRef.current!);
          clearInterval(countdown);
          setTwoFaOneTimeToken(data.oneTimeToken);
          setTwoFaStatus('NEW_PIN_SETUP');
        } else if (data.status === 'REJECTED') {
          clearInterval(pollingRef.current!);
          clearInterval(countdown);
          setTwoFaStatus('REJECTED');
        } else if (data.status === 'EXPIRED') {
          clearInterval(pollingRef.current!);
          clearInterval(countdown);
          setTwoFaStatus('EXPIRED');
        }
      } catch (err) {
        console.warn('Error en polling 2FA de cambio de PIN:', err);
      }
    }, 2000);

    return () => {
      clearInterval(countdown);
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [twoFaStatus, twoFaRequestId]);

  if (!isOpen) return null;

  // Iniciar Solicitud 2FA a Sistemas por Telegram
  const handleRequest2FA = async () => {
    if (!employeeId) {
      setErrorMessage('Identificador de empleado no disponible.');
      return;
    }

    setTwoFaStatus('REQUESTING');
    setErrorMessage(null);

    try {
      const res = await fetch('/api/auth/pin-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId })
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        setTwoFaRequestId(data.requestId);
        setTwoFaSecondsLeft(data.ttl || 120);
        setTwoFaStatus('WAITING');
      } else {
        setTwoFaStatus('IDLE');
        setErrorMessage(data.error || 'No se pudo emitir la solicitud a Telegram.');
      }
    } catch (err: any) {
      setTwoFaStatus('IDLE');
      setErrorMessage(`Error de conexión con el servidor: ${err.message}`);
    }
  };

  const handleKeypadPress = (digit: string) => {
    setErrorMessage(null);
    if (pinStep === 'ENTER_NEW') {
      if (newPin.length < 4) {
        const updated = newPin + digit;
        setNewPin(updated);
        if (updated.length === 4) {
          // Pasar automáticamente a confirmación
          setTimeout(() => setPinStep('CONFIRM_NEW'), 200);
        }
      }
    } else {
      if (confirmPin.length < 4) {
        setConfirmPin(prev => prev + digit);
      }
    }
  };

  const handleBackspace = () => {
    setErrorMessage(null);
    if (pinStep === 'CONFIRM_NEW') {
      if (confirmPin.length > 0) {
        setConfirmPin(prev => prev.slice(0, -1));
      } else {
        setPinStep('ENTER_NEW');
        setNewPin(prev => prev.slice(0, -1));
      }
    } else {
      setNewPin(prev => prev.slice(0, -1));
    }
  };

  const handleClear = () => {
    setErrorMessage(null);
    setNewPin('');
    setConfirmPin('');
    setPinStep('ENTER_NEW');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPin.length !== 4) {
      setErrorMessage('El PIN debe tener exactamente 4 dígitos.');
      return;
    }

    if (newPin !== confirmPin) {
      setErrorMessage('Los PINs no coinciden. Por favor verifica.');
      setConfirmPin('');
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const sessionToken = sessionStorage.getItem('sanesca_auth_jwt') || localStorage.getItem('sanesca_auth_jwt') || '';
      
      const payload: Record<string, any> = {
        employeeId,
        newPin
      };

      if (twoFaOneTimeToken) {
        payload.oneTimeToken = twoFaOneTimeToken;
      } else if (isSuperadmin && sessionToken) {
        payload.token = sessionToken;
      }

      const res = await fetch('/api/auth/pin-update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok && data.status === 'success') {
        setSuccessMessage(`¡PIN actualizado con éxito en Notion para ${userName}!`);
        setTwoFaStatus('SUCCESS');
        setTimeout(() => {
          setSuccessMessage(null);
          handleClear();
          onClose();
        }, 1800);
      } else {
        setErrorMessage(data.error || 'No se pudo actualizar el PIN.');
      }
    } catch (err: any) {
      setErrorMessage(`Error de red: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 text-slate-100 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-slate-400 hover:text-white p-1"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Cabecera */}
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
            <KeyRound className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-tight">
              Modificar PIN Operativo
            </h2>
            <p className="text-[11px] font-mono text-slate-400">
              {userName}
            </p>
          </div>
        </div>

        {/* ======================================================== */}
        {/* ESTADO 1: SOLICITUD 2FA INICIAL (NO SUPERADMIN) */}
        {/* ======================================================== */}
        {twoFaStatus === 'IDLE' && (
          <div className="space-y-4">
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-slate-300 text-xs space-y-2">
              <div className="flex items-center gap-2 text-amber-400 font-semibold">
                <ShieldAlert className="w-4 h-4" />
                <span>Política de Seguridad Zero Trust</span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                Por control interno, la asignación y cambio de PIN de planta requiere la aprobación remota de <strong className="text-white">Mikel (Sistemas)</strong> a través de Telegram.
              </p>
            </div>

            {errorMessage && (
              <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <button
              type="button"
              onClick={handleRequest2FA}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-semibold text-xs tracking-wide uppercase bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-lg shadow-emerald-500/20 active:scale-[0.98] transition-all"
            >
              <SendHorizontal className="w-4 h-4" />
              Solicitar Autorización a Sistemas
            </button>
          </div>
        )}

        {/* ======================================================== */}
        {/* ESTADO 2: ENVIANDO SOLICITUD */}
        {/* ======================================================== */}
        {twoFaStatus === 'REQUESTING' && (
          <div className="py-8 flex flex-col items-center justify-center text-center space-y-3">
            <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
            <p className="text-xs text-slate-300 font-medium">
              Despachando alerta interactiva a Telegram de Mikel...
            </p>
          </div>
        )}

        {/* ======================================================== */}
        {/* ESTADO 3: ESPERANDO AUTORIZACIÓN 2FA (120s) */}
        {/* ======================================================== */}
        {twoFaStatus === 'WAITING' && (
          <div className="text-center py-2 animate-in fade-in duration-200">
            <div className="relative w-16 h-16 mx-auto mb-3 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-emerald-500/20 animate-ping opacity-75" />
              <div className="relative w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/40 text-emerald-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <Smartphone className="w-7 h-7 animate-pulse" />
              </div>
            </div>

            <h2 className="text-base font-bold text-white tracking-tight mb-1">
              Esperando Autorización 2FA
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
                <span className="font-bold text-amber-400">{formatSeconds(twoFaSecondsLeft)}</span>
              </div>
              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div 
                  className="bg-emerald-500 h-full transition-all duration-1000 ease-linear"
                  style={{ width: `${(twoFaSecondsLeft / 120) * 100}%` }}
                />
              </div>
            </div>

            <div className="flex items-center justify-center gap-2 text-[11px] text-slate-500">
              <RefreshCw className="w-3 h-3 animate-spin text-emerald-400" />
              <span>Esperando que presione "Aprobar modificar PIN en PC"...</span>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* ESTADO 4: SOLICITUD RECHAZADA */}
        {/* ======================================================== */}
        {twoFaStatus === 'REJECTED' && (
          <div className="text-center py-4 space-y-4 animate-in fade-in duration-200">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 mx-auto flex items-center justify-center">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white mb-1">Solicitud Denegada</h3>
              <p className="text-xs text-rose-300">
                Sistemas rechazó la modificación de PIN para este usuario.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setTwoFaStatus('IDLE');
                setErrorMessage(null);
              }}
              className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
            >
              Reintentar Solicitud
            </button>
          </div>
        )}

        {/* ======================================================== */}
        {/* ESTADO 5: SOLICITUD EXPIRADA */}
        {/* ======================================================== */}
        {twoFaStatus === 'EXPIRED' && (
          <div className="text-center py-4 space-y-4 animate-in fade-in duration-200">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 mx-auto flex items-center justify-center">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white mb-1">Solicitud Expirada</h3>
              <p className="text-xs text-slate-400">
                El plazo de 120 segundos transcurrió sin confirmación remota.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setTwoFaStatus('IDLE');
                setErrorMessage(null);
              }}
              className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
            >
              Emitir Nueva Solicitud
            </button>
          </div>
        )}

        {/* ======================================================== */}
        {/* ESTADO 6: ASIGNACIÓN DE NUEVO PIN (AUTORIZADO O SUPERADMIN) */}
        {/* ======================================================== */}
        {twoFaStatus === 'NEW_PIN_SETUP' && (
          <>
            {successMessage ? (
              <div className="p-4 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs flex flex-col items-center justify-center text-center space-y-2 py-6 animate-in zoom-in duration-150">
                <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                <p className="font-semibold text-sm">{successMessage}</p>
                <p className="text-[11px] text-emerald-200/80">Guardado inmediatamente en Notion ERP.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {isSuperadmin && (
                  <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[10px] text-center font-mono">
                    ★ Sesión Superadmin: Modificación Directa
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-1.5 px-1">
                    <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                      {pinStep === 'ENTER_NEW' ? '1. Nuevo PIN (4 dígitos)' : '2. Confirma el PIN'}
                    </span>
                    <span className="text-[10px] font-mono text-amber-400">
                      Paso {pinStep === 'ENTER_NEW' ? '1/2' : '2/2'}
                    </span>
                  </div>

                  {/* Indicadores de 4 Puntos */}
                  <div className="flex items-center justify-center gap-3 py-3 bg-slate-950 rounded-xl border border-slate-800 shadow-inner mb-3">
                    {[0, 1, 2, 3].map(idx => {
                      const activeLen = pinStep === 'ENTER_NEW' ? newPin.length : confirmPin.length;
                      return (
                        <div
                          key={idx}
                          className={`w-3.5 h-3.5 rounded-full transition-all duration-150 ${
                            idx < activeLen
                              ? 'bg-amber-400 scale-110 shadow-lg shadow-amber-500/50'
                              : 'bg-slate-800 border border-slate-700'
                          }`}
                        />
                      );
                    })}
                  </div>

                  {/* Teclado Numérico */}
                  <div className="grid grid-cols-3 gap-1.5">
                    {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => handleKeypadPress(d)}
                        disabled={submitting}
                        className="py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 active:bg-slate-600 text-slate-100 font-semibold text-sm transition-all shadow-sm active:scale-95"
                      >
                        {d}
                      </button>
                    ))}

                    <button
                      type="button"
                      onClick={handleBackspace}
                      disabled={submitting}
                      className="py-2.5 rounded-xl bg-slate-800/50 hover:bg-slate-700/80 text-slate-400 hover:text-slate-200 text-xs font-medium transition-all"
                    >
                      ⌫ Borrar
                    </button>

                    <button
                      type="button"
                      onClick={() => handleKeypadPress('0')}
                      disabled={submitting}
                      className="py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-100 font-semibold text-sm transition-all shadow-sm active:scale-95"
                    >
                      0
                    </button>

                    <button
                      type="button"
                      onClick={handleClear}
                      disabled={submitting}
                      className="py-2.5 rounded-xl bg-slate-800/50 hover:bg-slate-700/80 text-slate-400 hover:text-slate-200 text-xs font-medium transition-all"
                    >
                      Limpiar
                    </button>
                  </div>
                </div>

                {/* Error */}
                {errorMessage && (
                  <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{errorMessage}</span>
                  </div>
                )}

                {/* Botón Guardar */}
                <button
                  type="submit"
                  disabled={submitting || newPin.length !== 4 || confirmPin.length !== 4}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-semibold text-xs tracking-wide uppercase bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white shadow-lg shadow-amber-500/20 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Actualizando en Notion...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      Confirmar y Guardar PIN
                    </>
                  )}
                </button>
              </form>
            )}
          </>
        )}

        <div className="mt-4 pt-3 border-t border-slate-800 text-[10px] text-slate-500 text-center leading-tight">
          Sincronizado directamente con la columna <code className="text-slate-400 font-mono">PIN_App</code> en Notion.
        </div>
      </div>
    </div>
  );
};
