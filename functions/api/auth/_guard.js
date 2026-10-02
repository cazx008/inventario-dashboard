/**
 * Middleware Serverless de Autorización y Defensa en Profundidad (RBAC Guard)
 * Archivo: functions/api/auth/_guard.js
 * 
 * Valida la firma del token JWT (HS256) y verifica que el colaborador cuente
 * con el permiso modular requerido o el rol 'Superadmin'.
 */

import { verifyJWT } from './_utils.js';
import { recordAuditLog } from './_audit.js';

const DEFAULT_BOT_TOKEN = '8818827554:AAFtwP7rGOLjIrtYVC1UZfYIv0QbZq8f7cM';

/**
 * Verifica si la petición entrante está autorizada para la acción solicitada.
 * @param {object} context - Contexto de Cloudflare Pages Function ({ request, env })
 * @param {string} requiredPermission - Permiso requerido (ej. 'Emitir_OAB', 'Recepcion_Rampa', 'Revisar_OAB', 'Auditoria_Kardex')
 * @returns {Promise<{ ok: boolean, status?: number, error?: string, user?: object }>}
 */
export async function requirePermission(context, requiredPermission) {
  const { request, env } = context;
  const botToken = env.TELEGRAM_BOT_TOKEN || DEFAULT_BOT_TOKEN;

  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : '';

  if (!token) {
    return {
      ok: false,
      status: 401,
      error: 'No autorizado. Se requiere token de sesión Bearer.'
    };
  }

  const payload = await verifyJWT(token, botToken);
  if (!payload) {
    return {
      ok: false,
      status: 401,
      error: 'Sesión inválida o expirada. Por favor identifícate nuevamente.'
    };
  }

  const permissions = Array.isArray(payload.permissions) ? payload.permissions : [];
  const isSuperadmin = permissions.includes('Superadmin');
  const hasRequired = isSuperadmin || permissions.includes(requiredPermission);

  if (!hasRequired) {
    recordAuditLog({
      env,
      context,
      request,
      eventType: 'ACCESS_DENIED_API',
      employeeId: payload.sub,
      employeeName: payload.name,
      puesto: payload.puestos?.[0] || 'N/A',
      area: 'API Endpoints',
      isSuccess: false,
      details: `Intento no autorizado al endpoint. Se requería permiso '${requiredPermission}'. Permisos del usuario: [${permissions.join(', ')}].`,
      alertSecurity: true
    });

    return {
      ok: false,
      status: 403,
      error: `Acceso restringido. Tu puesto de trabajo no cuenta con el permiso '${requiredPermission}'.`
    };
  }

  return {
    ok: true,
    user: payload
  };
}
