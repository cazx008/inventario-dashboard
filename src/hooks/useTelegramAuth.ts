import { useState, useEffect, useCallback } from 'react';
import { UserProfile, PermissionKey, AuthErrorState } from '../types/auth';

const SESSION_TOKEN_KEY = 'sanesca_auth_jwt';
const SESSION_PROFILE_KEY = 'sanesca_auth_profile';
const REMEMBER_EXPIRY_KEY = 'sanesca_auth_expiry';

/**
 * Extrae la fecha de expiración en milisegundos de una sesión (localStorage o claim JWT)
 */
function getSessionExpiryTime(tokenStr: string | null): number | null {
  // 1. Revisar si hay expiración explícita de turno en localStorage
  const savedExpiry = localStorage.getItem(REMEMBER_EXPIRY_KEY);
  if (savedExpiry) {
    const parsed = parseInt(savedExpiry, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }

  // 2. Extraer del JWT (payload.exp en segundos ➔ milisegundos)
  if (tokenStr) {
    try {
      const parts = tokenStr.split('.');
      if (parts.length === 3) {
        const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(
          atob(base64)
            .split('')
            .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
            .join('')
        );
        const payload = JSON.parse(jsonPayload);
        if (payload.exp) {
          return payload.exp * 1000;
        }
      }
    } catch {
      // Ignorar error de parsing en tokens no estándar
    }
  }

  return null;
}

export function useTelegramAuth() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<AuthErrorState | null>(null);
  const [showPinModal, setShowPinModal] = useState<boolean>(false);

  // Detectar si se está ejecutando dentro de Telegram Mini App
  const tg = typeof window !== 'undefined' ? (window as any).Telegram?.WebApp : null;
  const isTelegramWebApp = Boolean(tg && tg.initData && tg.initData.length > 0);

  // Feedback Háptico Nativo de Telegram
  const triggerHaptic = useCallback((type: 'success' | 'error' | 'warning' | 'light' | 'medium') => {
    try {
      if (tg?.HapticFeedback) {
        if (type === 'success' || type === 'error' || type === 'warning') {
          tg.HapticFeedback.notificationOccurred(type);
        } else {
          tg.HapticFeedback.impactOccurred(type);
        }
      }
    } catch {
      // Ignorar si el dispositivo no soporta hápticos
    }
  }, [tg]);

  // Cierre de Sesión (para PC)
  const logout = useCallback(() => {
    setProfile(null);
    setToken(null);
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    sessionStorage.removeItem(SESSION_PROFILE_KEY);
    localStorage.removeItem(REMEMBER_EXPIRY_KEY);
    localStorage.removeItem(SESSION_PROFILE_KEY);
    localStorage.removeItem(SESSION_TOKEN_KEY);
    setShowPinModal(true);
  }, []);

  // Verificar si el usuario cuenta con un permiso específico (Superadmin tiene acceso total)
  const hasPermission = useCallback((perm: PermissionKey): boolean => {
    if (!profile) return false;
    if (profile.permissions.includes('Superadmin')) return true;
    return profile.permissions.includes(perm);
  }, [profile]);

  // Autenticación Automática en Telegram
  const authenticateTelegram = useCallback(async (forceRefresh = false) => {
    if (!tg || !tg.initData) return;

    setLoading(true);
    setAuthError(null);

    try {
      tg.ready();
      tg.expand();

      const res = await fetch('/api/auth/telegram-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: tg.initData, forceRefresh })
      });

      const data = await res.json();

      if (res.ok && data.status === 'success') {
        const userProf: UserProfile = {
          ...data.profile,
          authMethod: 'telegram'
        };
        setProfile(userProf);
        setToken(data.token);
        sessionStorage.setItem(SESSION_TOKEN_KEY, data.token);
        sessionStorage.setItem(SESSION_PROFILE_KEY, JSON.stringify(userProf));
        triggerHaptic('success');
      } else {
        triggerHaptic('error');
        setAuthError({
          code: data.reason || 'AUTH_DENIED',
          message: data.message || 'Acceso restringido por la política de personal de Sanesca.',
          employeeName: data.employeeName,
          puestos: data.puestos,
          telegramId: data.telegramId,
          telegramUsername: data.telegramUsername
        });
        setProfile(null);
        setToken(null);
      }
    } catch (err: any) {
      triggerHaptic('error');
      setAuthError({
        code: 'NETWORK_ERROR',
        message: `Error conectando con el servidor de autenticación: ${err.message}`
      });
      setProfile(null);
      setToken(null);
    } finally {
      setLoading(false);
    }
  }, [tg, triggerHaptic]);

  // Inicialización de Sesión al montar
  useEffect(() => {
    // 1. Caso Telegram Mini App: Autenticación automática e invisible
    if (isTelegramWebApp) {
      authenticateTelegram();
      return;
    }

    // 2. Caso Navegador PC (Chrome/Edge): Comprobar si hay sesión recordada en localStorage (Turno)
    const savedExpiry = localStorage.getItem(REMEMBER_EXPIRY_KEY);
    const now = Date.now();

    if (savedExpiry && parseInt(savedExpiry, 10) > now) {
      const savedProfile = localStorage.getItem(SESSION_PROFILE_KEY);
      const savedToken = localStorage.getItem(SESSION_TOKEN_KEY);
      if (savedProfile) {
        try {
          setProfile(JSON.parse(savedProfile));
          if (savedToken) setToken(savedToken);
          setLoading(false);
          return;
        } catch {
          localStorage.removeItem(SESSION_PROFILE_KEY);
          localStorage.removeItem(REMEMBER_EXPIRY_KEY);
          localStorage.removeItem(SESSION_TOKEN_KEY);
        }
      }
    }

    // 3. Caso Sesión de pestaña en sessionStorage (PIN o Sesión Temporal 2FA)
    const sessionProfile = sessionStorage.getItem(SESSION_PROFILE_KEY);
    const sessionToken = sessionStorage.getItem(SESSION_TOKEN_KEY);
    if (sessionProfile) {
      try {
        const expiry = getSessionExpiryTime(sessionToken);
        if (expiry && now >= expiry) {
          // Sesión ya expiró
          sessionStorage.removeItem(SESSION_PROFILE_KEY);
          sessionStorage.removeItem(SESSION_TOKEN_KEY);
        } else {
          setProfile(JSON.parse(sessionProfile));
          if (sessionToken) setToken(sessionToken);
          setLoading(false);
          return;
        }
      } catch {
        sessionStorage.removeItem(SESSION_PROFILE_KEY);
        sessionStorage.removeItem(SESSION_TOKEN_KEY);
      }
    }

    // Sin sesión activa en PC: activar modal de PIN
    setLoading(false);
    setShowPinModal(true);
  }, [isTelegramWebApp, authenticateTelegram]);

  // Watcher de Expiración en Cliente cada 30 segundos (R.4)
  useEffect(() => {
    if (!profile || isTelegramWebApp) return;

    const checkExpiration = () => {
      const expiry = getSessionExpiryTime(token);
      if (expiry && Date.now() >= expiry) {
        console.warn('[useTelegramAuth] La sesión ha expirado. Ejecutando cierre automático.');
        logout();
      }
    };

    checkExpiration();
    const interval = setInterval(checkExpiration, 30000);
    return () => clearInterval(interval);
  }, [profile, token, isTelegramWebApp, logout]);

  // Iniciar sesión directa vía 2FA (Aprobación de sesión temporal de 1 hora)
  const loginWithCustomSession = (userProf: UserProfile, sessionJwt: string) => {
    const isTemp = Boolean(userProf.isTemporary || userProf.authMethod === '2fa_temp');
    const enrichedProfile: UserProfile = {
      ...userProf,
      authMethod: '2fa_temp',
      isTemporary: isTemp
    };

    setProfile(enrichedProfile);
    setToken(sessionJwt);
    sessionStorage.setItem(SESSION_TOKEN_KEY, sessionJwt);
    sessionStorage.setItem(SESSION_PROFILE_KEY, JSON.stringify(enrichedProfile));
    setShowPinModal(false);
    triggerHaptic('success');
  };

  // Login con PIN para Navegador PC
  const loginWithPin = async (employeeId: string, pin: string, rememberShift = false) => {
    setLoading(true);
    setAuthError(null);

    try {
      const res = await fetch('/api/auth/pin-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId, pin })
      });

      const data = await res.json();

      if (res.ok && data.status === 'success') {
        const userProf: UserProfile = {
          ...data.profile,
          authMethod: 'pin'
        };

        setProfile(userProf);
        setToken(data.token);
        sessionStorage.setItem(SESSION_TOKEN_KEY, data.token);
        sessionStorage.setItem(SESSION_PROFILE_KEY, JSON.stringify(userProf));

        if (rememberShift) {
          // Recordar durante 8 horas (turno laboral)
          const expiryTime = Date.now() + (8 * 60 * 60 * 1000);
          localStorage.setItem(REMEMBER_EXPIRY_KEY, expiryTime.toString());
          localStorage.setItem(SESSION_PROFILE_KEY, JSON.stringify(userProf));
          localStorage.setItem(SESSION_TOKEN_KEY, data.token);
        }

        setShowPinModal(false);
        triggerHaptic('success');
        return { success: true };
      } else {
        triggerHaptic('error');
        return {
          success: false,
          error: data.error || 'PIN incorrecto o empleado inactivo.',
          intentosRestantes: data.intentosRestantes,
          locked: data.locked,
          remainingSeconds: data.remainingSeconds
        };
      }
    } catch (err: any) {
      triggerHaptic('error');
      return { success: false, error: `Error de red: ${err.message}` };
    } finally {
      setLoading(false);
    }
  };

  // Forzar recarga de permisos desde Notion
  const refreshPermissions = async () => {
    if (isTelegramWebApp) {
      await authenticateTelegram(true);
    } else if (profile?.id) {
      triggerHaptic('light');
    }
  };

  return {
    profile,
    token,
    loading,
    authError,
    showPinModal,
    setShowPinModal,
    isTelegramWebApp,
    hasPermission,
    loginWithPin,
    loginWithCustomSession,
    logout,
    refreshPermissions,
    triggerHaptic
  };
}
