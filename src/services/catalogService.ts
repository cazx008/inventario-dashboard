/**
 * Servicio Cliente: Catálogo Maestro de Insumos & Health Checker
 * Archivo: src/services/catalogService.ts
 * 
 * Micro-Fase 11B / 11C — Arquitectura Industrial Sanesca PRO
 */

import {
  ConceptRoot,
  CatalogItem,
  CatalogUpsertPayload,
  CatalogAuditReport
} from '../types/catalog';

function getAuthHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = sessionStorage.getItem('sanesca_auth_jwt') || localStorage.getItem('sanesca_auth_jwt') || '';
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

/**
 * Consulta la ontología de Conceptos Raíz ISO de BD_Diccionario_Conceptos
 */
export async function getConcepts(refresh = false): Promise<ConceptRoot[]> {
  try {
    const url = `/api/catalog/concepts${refresh ? '?refresh=true' : ''}`;
    const res = await fetch(url, {
      headers: { ...getAuthHeader() }
    });
    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}`);
    }
    const data = await res.json();
    return (data.concepts || []).map((c: any) => ({
      id: c.id,
      name: c.name || c.concepto || 'Concepto',
      codePrefix: c.codePrefix || c.prefijo || '',
      defaultUoM: c.defaultUoM || c.uomDisplay || 'UND',
      namingPattern: c.namingPattern || c.patronISO || '',
      requiredModifiers: c.requiredModifiers || c.modificadoresObligatorios || []
    }));
  } catch (err) {
    console.warn('[catalogService] Error cargando conceptos ISO:', err);
    return [];
  }
}

/**
 * Consulta la lista unificada de insumos y existencias
 */
export async function getCatalogItems(params?: {
  q?: string;
  categoria?: string;
  estado?: 'activos' | 'descontinuados' | 'todos';
}): Promise<{ items: CatalogItem[]; total: number }> {
  try {
    const sp = new URLSearchParams();
    if (params?.q) sp.set('q', params.q);
    if (params?.categoria) sp.set('categoria', params.categoria);
    if (params?.estado) sp.set('estado', params.estado);

    const res = await fetch(`/api/catalog/items?${sp.toString()}`, {
      headers: { ...getAuthHeader() }
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    return {
      items: data.items || [],
      total: data.total || (data.items || []).length
    };
  } catch (err: any) {
    console.error('[catalogService] Error consultando ítems de catálogo:', err);
    throw err;
  }
}

/**
 * Crea o edita un insumo en el Catálogo Maestro (Mutación Dual Atómica)
 */
export async function upsertCatalogItem(payload: CatalogUpsertPayload): Promise<{
  ok: boolean;
  insumoId?: string;
  dashboardId?: string;
  item?: CatalogItem;
  error?: string;
  message?: string;
}> {
  try {
    const res = await fetch('/api/catalog/upsert', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      return {
        ok: false,
        error: data.error || `Error del servidor (${res.status})`
      };
    }

    return data;
  } catch (err: any) {
    console.error('[catalogService] Error en upsertCatalogItem:', err);
    return {
      ok: false,
      error: `Error de conexión: ${err.message}`
    };
  }
}

/**
 * Verifica si un código o SKU ya existe en el catálogo
 */
export async function checkDuplicateCode(codigo: string, excludeId?: string): Promise<{
  isDuplicate: boolean;
  existingItem?: CatalogItem;
}> {
  if (!codigo || !codigo.trim()) return { isDuplicate: false };
  try {
    const { items } = await getCatalogItems({ q: codigo.trim() });
    const match = items.find(it => 
      it.codigo.toUpperCase() === codigo.trim().toUpperCase() && 
      it.id !== excludeId && 
      it.insumoId !== excludeId
    );
    return {
      isDuplicate: Boolean(match),
      existingItem: match
    };
  } catch (err) {
    return { isDuplicate: false };
  }
}

/**
 * Consulta el diagnóstico de integridad del catálogo
 */
export async function getCatalogAudit(refresh = false): Promise<CatalogAuditReport> {
  const url = `/api/catalog/audit${refresh ? '?refresh=true' : ''}`;
  const res = await fetch(url, {
    headers: { ...getAuthHeader() }
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson.error || `Error HTTP ${res.status}`);
  }

  return await res.json();
}

/**
 * Ejecuta auto-sanación de insumos huérfanos
 */
export async function healOrphans(orphanIds: string[], supervisorPIN?: string): Promise<{
  ok: boolean;
  message: string;
  healedCount: number;
  errors?: string[];
}> {
  const res = await fetch('/api/catalog/audit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader()
    },
    body: JSON.stringify({
      action: 'heal_orphans',
      orphanIds,
      supervisorPIN
    })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Error al ejecutar auto-sanación de huérfanos');
  }
  return data;
}

/**
 * Actualiza costos en lote para múltiples insumos ($0.00 USD)
 */
export async function bulkUpdateCosts(
  updates: Array<{ insumoId: string; costUSD: number }>,
  supervisorPIN?: string
): Promise<{
  ok: boolean;
  message: string;
  updatedCount: number;
  errors?: string[];
}> {
  const res = await fetch('/api/catalog/audit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader()
    },
    body: JSON.stringify({
      action: 'bulk_cost_update',
      updates,
      supervisorPIN
    })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Error al actualizar costos en lote');
  }
  return data;
}
