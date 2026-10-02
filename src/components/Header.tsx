import { ShoppingCart, Truck, ExternalLink, RefreshCw, ClipboardCheck, BookOpen, User, LogOut, ShieldCheck, KeyRound, ShieldAlert, Clock } from 'lucide-react';
import { UserProfile } from '../types/auth';

interface HeaderProps {
  lastSyncDisplay: string;
  bcvRate: number;
  onOpenSupplyModal: () => void;
  onOpenReviewModal: () => void;
  onOpenReceptionModal: () => void;
  onOpenKardexModal: () => void;
  onOpenAuditModal?: () => void;
  onRefresh: () => void;
  isRefreshing?: boolean;
  profile?: UserProfile | null;
  onRefreshPermissions?: () => void;
  onChangePin?: () => void;
  onLogout?: () => void;
  isTelegram?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  lastSyncDisplay,
  bcvRate,
  onOpenSupplyModal,
  onOpenReviewModal,
  onOpenReceptionModal,
  onOpenKardexModal,
  onOpenAuditModal,
  onRefresh,
  isRefreshing = false,
  profile,
  onRefreshPermissions,
  onChangePin,
  onLogout,
  isTelegram = false
}) => {
  return (
    <header className="bg-surface/95 backdrop-blur border-b border-borderSubtle sticky top-0 z-40 no-print">
      <div className="max-w-[1600px] mx-auto px-4 py-2.5 sm:px-6 flex flex-wrap items-center justify-between gap-3">
        {/* Brand & Title */}
        <div className="flex items-center gap-3">
          <div className="logo-contrast-plate px-2 py-1 rounded-lg flex items-center justify-center">
            <img src="assets/logo-sanesca.png" alt="Sanesca" className="h-6 sm:h-7 w-auto object-contain" onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }} />
            <span className="text-slate-900 font-black text-sm tracking-wider">SANESCA</span>
          </div>
          <div>
            <h1 className="text-white font-bold text-base sm:text-lg tracking-tight flex items-center gap-2">
              📦 Dashboard de Inventario
              <span className="hidden sm:inline-block text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-brand-500/20 text-brand-400 border border-brand-500/40">
                PRO v2.0
              </span>
            </h1>
            <p className="text-xs text-slate-400 hidden md:block">Gerencia de Operaciones · Sanesca Exhibidores</p>
          </div>
        </div>

        {/* Action Hub & Navigation */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
          {/* Main Action: Sugerencias de Abastecimiento */}
          <button
            onClick={onOpenSupplyModal}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-brand-500 hover:bg-brand-600 text-slate-950 transition shadow-sm active:scale-95"
            title="Generar Hoja Viajera de Abastecimiento (OAB)"
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            <span>Abastecimiento (OAB)</span>
          </button>

          {/* Action: Revisión & Transcripción de OAB (Magaly & Compras) */}
          <button
            onClick={onOpenReviewModal}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-surfaceHigh hover:bg-surfaceHighest text-slate-200 border border-borderSubtle hover:border-amber-500/50 transition active:scale-95"
            title="Puente Papel-Digital: Transcribir vistos buenos de Magaly y cotizaciones de Compras"
          >
            <ClipboardCheck className="w-3.5 h-3.5 text-amber-400" />
            <span>Revisión OAB</span>
          </button>

          {/* Action: Recepción en Rampa */}
          <button
            onClick={onOpenReceptionModal}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-surfaceHigh hover:bg-surfaceHighest text-slate-200 border border-borderSubtle hover:border-slate-500 transition active:scale-95"
            title="Terminal de Recepción e ingreso de mercancía a almacén"
          >
            <Truck className="w-3.5 h-3.5 text-signal-blue" />
            <span>Recepción en Rampa</span>
          </button>

          {/* Action: Libro Mayor Kardex */}
          <button
            onClick={onOpenKardexModal}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-surfaceHigh hover:bg-surfaceHighest text-slate-200 border border-borderSubtle hover:border-slate-500 transition active:scale-95"
            title="Libro Mayor inmutable de movimientos de almacén"
          >
            <BookOpen className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Libro Mayor</span>
            <span>Kardex</span>
          </button>

          {/* Action: Bitácora de Auditoría Forense (Exclusivo Superadmin) */}
          {profile?.permissions?.includes('Superadmin') && onOpenAuditModal && (
            <button
              onClick={onOpenAuditModal}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:border-rose-500/60 transition active:scale-95 shadow-sm"
              title="Visor Forense de Auditoría, Telemetría y Accesos (Superadmin)"
            >
              <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
              <span className="hidden sm:inline">Auditoría</span>
              <span>Accesos</span>
            </button>
          )}

          {/* BCV Rate Badge */}
          {bcvRate > 0 && (
            <div className="hidden lg:flex items-center gap-1 px-2.5 py-1 text-xs font-mono rounded-lg bg-surfaceHigh border border-borderSubtle text-amber-300" title="Tasa Oficial BCV">
              <span>💵 BCV:</span>
              <span className="font-bold">Bs {bcvRate.toFixed(2)}</span>
            </div>
          )}

          {/* Cross navigation */}
          <a
            href="https://cazx008.github.io/sanesca-dashboard/"
            target="_blank"
            rel="noreferrer"
            className="hidden xl:inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg text-slate-400 hover:text-slate-200 hover:bg-surfaceHigh transition border border-transparent hover:border-borderSubtle"
          >
            ⚡ Cortes Eléctricos <ExternalLink className="w-3 h-3" />
          </a>
          <a
            href="https://cazx008.github.io/medidas-operativas/"
            target="_blank"
            rel="noreferrer"
            className="hidden xl:inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg text-slate-400 hover:text-slate-200 hover:bg-surfaceHigh transition border border-transparent hover:border-borderSubtle"
          >
            🏭 Medidas Operativas <ExternalLink className="w-3 h-3" />
          </a>

          {/* Sync badge & Refresh */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono rounded-lg bg-surfaceHigh border border-borderSubtle">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="text-slate-300 hidden sm:inline">Sync: {lastSyncDisplay}</span>
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="text-slate-400 hover:text-white transition ml-1 disabled:opacity-50"
              title="Refrescar inventario"
            >
              <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin text-brand-400' : ''}`} />
            </button>
          </div>

          {/* Profile Identity Pill */}
          {profile && (
            <div className="flex items-center gap-2 pl-1.5 pr-2 py-1 rounded-xl bg-slate-900 border border-slate-700/80 shadow-inner text-xs">
              <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-brand-600 to-indigo-600 flex items-center justify-center text-[10px] font-bold text-white shadow-sm">
                {profile.name.split(' ').map(n => n[0]).slice(0, 2).join('')}
              </div>
              <div className="flex flex-col leading-tight">
                <span className="font-semibold text-slate-200 text-[11px] truncate max-w-[110px] sm:max-w-[150px]">
                  {profile.name}
                </span>
                <span className="text-[9px] font-mono text-slate-400 truncate max-w-[110px]">
                  {profile.permissions.includes('Superadmin') ? (
                    <span className="text-rose-400 font-bold">★ Superadmin</span>
                  ) : profile.isTemporary || profile.authMethod === '2fa_temp' ? (
                    <span className="text-amber-400 font-bold flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" /> 1h Temp
                    </span>
                  ) : (
                    profile.puestos?.[0] || 'Personal'
                  )}
                </span>
              </div>

              {onRefreshPermissions && (
                <button
                  type="button"
                  onClick={onRefreshPermissions}
                  className="p-1 text-slate-400 hover:text-emerald-400 transition-colors ml-0.5"
                  title="Refrescar mis permisos desde Notion"
                >
                  <RefreshCw className="w-3 h-3" />
                </button>
              )}

              {onChangePin && (
                <button
                  type="button"
                  onClick={onChangePin}
                  className="p-1 text-slate-400 hover:text-amber-400 transition-colors"
                  title="Modificar mi PIN de acceso en Notion"
                >
                  <KeyRound className="w-3 h-3" />
                </button>
              )}

              {!isTelegram && onLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  className="p-1 text-slate-500 hover:text-rose-400 transition-colors"
                  title="Cerrar sesión en este equipo"
                >
                  <LogOut className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
