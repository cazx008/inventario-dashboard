import React from 'react';
import { ShieldAlert, Send, XCircle, Building2, UserX } from 'lucide-react';
import { AuthErrorState } from '../types/auth';

interface AccessDeniedModalProps {
  error: AuthErrorState;
  targetModule?: string;
  onClose?: () => void;
}

export const AccessDeniedModal: React.FC<AccessDeniedModalProps> = ({
  error,
  targetModule = 'Compras & Inventario',
  onClose
}) => {
  const tg = typeof window !== 'undefined' ? (window as any).Telegram?.WebApp : null;

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else if (tg?.close) {
      tg.close();
    }
  };

  const handleRequestAccess = () => {
    const employee = error.employeeName || error.telegramUsername || 'Usuario';
    const puesto = (error.puestos && error.puestos.length > 0) ? error.puestos.join(', ') : 'Sin puesto';
    const message = encodeURIComponent(
      `Hola Mikel, soy ${employee} (${puesto}). Solicito acceso al módulo de ${targetModule} en Sanesca PRO.`
    );
    const directTelegramLink = `https://t.me/cazx008?text=${message}`;

    if (tg?.openTelegramLink) {
      tg.openTelegramLink(directTelegramLink);
    } else {
      window.open(directTelegramLink, '_blank');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-md rounded-2xl bg-slate-900 border border-rose-500/40 shadow-2xl p-6 text-slate-100 overflow-hidden">
        {/* Glow de seguridad */}
        <div className="absolute -top-12 -right-12 w-32 h-32 bg-rose-500/10 rounded-full blur-2xl pointer-events-none" />

        {/* Icono de Candado / Alerta */}
        <div className="mx-auto w-14 h-14 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 mb-4 shadow-inner">
          <ShieldAlert className="w-8 h-8" />
        </div>

        {/* Título */}
        <h2 className="text-xl font-bold text-center tracking-tight text-white mb-1">
          Acceso Restringido
        </h2>
        <p className="text-xs font-mono text-center text-rose-400/90 mb-4 uppercase tracking-wider">
          Política de Seguridad Zero Trust
        </p>

        {/* Tarjeta de Identificación Detectada */}
        <div className="bg-slate-950/70 rounded-xl p-3.5 border border-slate-800 space-y-2 mb-4 text-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="flex items-center gap-1.5">
              <UserX className="w-3.5 h-3.5 text-slate-500" />
              Usuario:
            </span>
            <span className="font-semibold text-slate-200">
              {error.employeeName || (error.telegramUsername ? `@${error.telegramUsername}` : 'No Registrado')}
            </span>
          </div>

          <div className="flex items-center justify-between text-slate-400">
            <span className="flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-slate-500" />
              Puesto en Planta:
            </span>
            <span className="font-mono text-slate-300">
              {(error.puestos && error.puestos.length > 0) ? error.puestos.join(', ') : 'Sin Puesto Asignado'}
            </span>
          </div>
        </div>

        {/* Motivo del Bloqueo */}
        <p className="text-xs text-slate-300 leading-relaxed text-center mb-6">
          {error.message || `Tu puesto actual no tiene los permisos requeridos para acceder a ${targetModule}. Si requieres operar este módulo, solicítalo al Administrador de Sistemas.`}
        </p>

        {/* Botonera de Acción */}
        <div className="space-y-2.5">
          <button
            type="button"
            onClick={handleRequestAccess}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-semibold text-sm bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-lg shadow-blue-500/20 active:scale-[0.98] transition-all"
          >
            <Send className="w-4 h-4" />
            💬 Solicitar Acceso a Sistemas (Mikel)
          </button>

          <button
            type="button"
            onClick={handleClose}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-medium text-slate-400 hover:text-white bg-slate-800/60 hover:bg-slate-800 transition-colors"
          >
            <XCircle className="w-4 h-4" />
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
