import { InventoryItem, KpiSummary } from '../types/inventory';

export interface InventoryDataResponse {
  items: InventoryItem[];
  kpis: KpiSummary;
  selectOrders: Record<string, string[]>;
  lastSyncDisplay: string;
}

// Persistencia de Ajustes Recientes en Almacenamiento Local (Fase 9H - Decisión D3)
const STOCK_OVERRIDES_KEY = 'sanesca_stock_overrides';
const COST_OVERRIDES_KEY = 'sanesca_cost_overrides';

export function saveStockOverride(dashboardId: string, newStock: number, nuevoEstadoStock?: string) {
  try {
    if (typeof window === 'undefined') return;
    const raw = localStorage.getItem(STOCK_OVERRIDES_KEY);
    const overrides = raw ? JSON.parse(raw) : {};
    overrides[dashboardId] = {
      stock: newStock,
      estadoStock: nuevoEstadoStock,
      timestamp: Date.now()
    };
    localStorage.setItem(STOCK_OVERRIDES_KEY, JSON.stringify(overrides));
  } catch (e) {
    console.warn('Error guardando override de stock:', e);
  }
}

export function saveCostOverride(dashboardId: string, newCost: number) {
  try {
    if (typeof window === 'undefined') return;
    if (!newCost || newCost <= 0) return;
    const raw = localStorage.getItem(COST_OVERRIDES_KEY);
    const overrides = raw ? JSON.parse(raw) : {};
    overrides[dashboardId] = {
      cost: newCost,
      timestamp: Date.now()
    };
    localStorage.setItem(COST_OVERRIDES_KEY, JSON.stringify(overrides));
  } catch (e) {
    console.warn('Error guardando override de costo:', e);
  }
}

export function removeStockOverride(dashboardId: string) {
  try {
    if (typeof window === 'undefined') return;
    const raw = localStorage.getItem(STOCK_OVERRIDES_KEY);
    if (!raw) return;
    const overrides = JSON.parse(raw);
    delete overrides[dashboardId];
    localStorage.setItem(STOCK_OVERRIDES_KEY, JSON.stringify(overrides));
  } catch (e) {
    console.warn('Error eliminando override de stock:', e);
  }
}

export function getStockOverrides(): Record<string, { stock: number; estadoStock?: string; timestamp: number }> {
  try {
    if (typeof window === 'undefined') return {};
    const raw = localStorage.getItem(STOCK_OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const now = Date.now();
    const clean: Record<string, { stock: number; estadoStock?: string; timestamp: number }> = {};
    // Mantener overrides de las últimas 48 horas
    for (const [id, data] of Object.entries(parsed)) {
      const d = data as any;
      if (now - d.timestamp < 48 * 3600 * 1000) {
        clean[id] = d;
      }
    }
    return clean;
  } catch {
    return {};
  }
}

export function getCostOverrides(): Record<string, { cost: number; timestamp: number }> {
  try {
    if (typeof window === 'undefined') return {};
    const raw = localStorage.getItem(COST_OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const now = Date.now();
    const clean: Record<string, { cost: number; timestamp: number }> = {};
    for (const [id, data] of Object.entries(parsed)) {
      const d = data as any;
      if (now - d.timestamp < 48 * 3600 * 1000) {
        clean[id] = d;
      }
    }
    return clean;
  } catch {
    return {};
  }
}

export async function loadInventoryData(): Promise<InventoryDataResponse> {
  const ts = Date.now();
  let items: InventoryItem[] = [];
  let kpis: KpiSummary = {
    total: 0,
    estado: { sinStock: 0, bajoMinimo: 0, enStock: 0, enReconteo: 0, descontinuado: 0 },
    prioridad: { urgente: 0, alta: 0, media: 0, baja: 0, porPedido: 0 },
    auditados3D: 0,
    auditados3DPct: 0,
  };
  let selectOrders: Record<string, string[]> = {};
  let lastSyncDisplay = '—';

  try {
    const [invRes, metaRes] = await Promise.all([
      fetch(`data/inventory.json?t=${ts}`).catch(() => null),
      fetch(`data/meta.json?t=${ts}`).catch(() => null),
    ]);

    if (invRes && invRes.ok) {
      const invData = await invRes.json();
      items = invData.items || [];
      if (invData.kpis) kpis = invData.kpis;
      if (invData.selectOrders) selectOrders = invData.selectOrders;
    }

    if (metaRes && metaRes.ok) {
      const metaData = await metaRes.json();
      if (metaData.lastSyncLocal) {
        lastSyncDisplay = metaData.lastSyncLocal;
      } else if (metaData.lastSync) {
        lastSyncDisplay = new Date(metaData.lastSync).toLocaleString('es-VE');
      }
    }
  } catch (err) {
    console.warn('Fallo cargando data estática local:', err);
  }

  // Leer sobreescrituras locales recientes de ajustes físicos y costos (Fase 9H/9I - Decisión D5)
  const overrides = typeof window !== 'undefined' ? getStockOverrides() : {};
  const costOverrides = typeof window !== 'undefined' ? getCostOverrides() : {};
  let overridesModified = false;
  let costOverridesModified = false;

  // Enriquecer items con enTransitoOAB, stockProyectado y reconciliar/evictar overrides locales
  items = items.map(item => {
    const override = overrides[item.id];
    let baseStock = item.stockBase || 0;
    let estado = item.estadoStock;

    if (override !== undefined) {
      // Reconciliación Fase 9I: si el JSON estático ya consolidó el saldo ajustado, evictar override
      if (item.stockBase === override.stock) {
        delete overrides[item.id];
        overridesModified = true;
      } else {
        // Discrepancia activa: prevalece el override reciente del usuario
        baseStock = override.stock;
        if (override.estadoStock) estado = override.estadoStock;
      }
    }

    // Reconciliación reactiva de Costo Unitario
    const costOverride = costOverrides[item.id];
    let unitCost = item.costoUnitarioUSD || 0;
    if (costOverride !== undefined && costOverride.cost > 0) {
      if (item.costoUnitarioUSD === costOverride.cost) {
        delete costOverrides[item.id];
        costOverridesModified = true;
      } else {
        unitCost = costOverride.cost;
      }
    }

    const enTransito = item.enTransitoOAB || 0;
    const proyectado = baseStock + enTransito;
    const deficit = Math.max(0, (item.stockMinimo || 0) - baseStock);
    return {
      ...item,
      stockBase: baseStock,
      deficit,
      estadoStock: estado,
      enTransitoOAB: enTransito,
      stockProyectado: proyectado,
      costoUnitarioUSD: unitCost
    };
  });

  // Si se desalojaron overrides reconciliados, sincronizar localStorage
  if (overridesModified && typeof window !== 'undefined') {
    try {
      localStorage.setItem(STOCK_OVERRIDES_KEY, JSON.stringify(overrides));
    } catch (e) {
      console.warn('Error persistiendo evicción de stock overrides:', e);
    }
  }

  if (costOverridesModified && typeof window !== 'undefined') {
    try {
      localStorage.setItem(COST_OVERRIDES_KEY, JSON.stringify(costOverrides));
    } catch (e) {
      console.warn('Error persistiendo evicción de cost overrides:', e);
    }
  }

  // Si hay overrides aplicados, actualizar los conteos de estado en kpis
  if (Object.keys(overrides).length > 0 && items.length > 0) {
    const sinStock = items.filter(i => (i.stockBase || 0) === 0).length;
    const bajoMinimo = items.filter(i => (i.stockBase || 0) > 0 && (i.stockBase || 0) < i.stockMinimo).length;
    const enStock = items.filter(i => (i.stockBase || 0) >= i.stockMinimo).length;
    const reconteo3D = items.filter(i => i.seReconto3D).length;
    kpis = {
      ...kpis,
      total: items.length,
      estado: {
        ...kpis.estado,
        sinStock,
        bajoMinimo,
        enStock
      },
      auditados3D: reconteo3D,
      auditados3DPct: items.length > 0 ? Math.round((reconteo3D / items.length) * 100) : 0
    };
  }

  return {
    items,
    kpis,
    selectOrders,
    lastSyncDisplay,
  };
}

export async function fetchBCVRate(): Promise<{ rate: number; source: string }> {
  try {
    const res = await fetch('/api/bcv/rate');
    if (res.ok) {
      const data = await res.json();
      if (data.promedio && Number(data.promedio) > 0) {
        return { rate: Number(data.promedio), source: data.fuente || 'BCV Oficial' };
      }
    }
  } catch (err) {
    console.warn('No se pudo consultar /api/bcv/rate, usando fallback referencial:', err);
  }

  return { rate: 36.50, source: 'Referencial (Contingencia)' };
}

export interface RevalidationResult {
  updatedItems: InventoryItem[];
  activeOrdersCount: number;
  synced: boolean;
}

export async function revalidateInventoryLive(currentItems: InventoryItem[]): Promise<RevalidationResult> {
  try {
    const res = await fetch('/api/inventory/sync');
    if (!res.ok) {
      return { updatedItems: currentItems, activeOrdersCount: 0, synced: false };
    }

    const data = await res.json();
    if (!data || (data.status !== 'synced' && data.status !== 'offline_or_unconfigured')) {
      return { updatedItems: currentItems, activeOrdersCount: data.activeOrdersCount || 0, synced: false };
    }

    const transitoByDash = data.enTransitoByDashboardId || {};
    const transitoByName = data.enTransitoByName || {};
    const liveStockByDash = data.liveStockByDashboardId || {};
    const liveCostByDash = data.liveCostByDashboardId || {};

    const updated: InventoryItem[] = currentItems.map(item => {
      // 1. Prioridad Tránsito OAB
      let transit = transitoByDash[item.id];
      if (transit === undefined && item.nombre) {
        transit = transitoByName[item.nombre.toLowerCase().trim()];
      }
      const enTransito = transit !== undefined ? transit : (item.enTransitoOAB || 0);

      // 2. Stock Base en Vivo (Ajustes de inventario y Despachos en tiempo real)
      let baseStock = item.stockBase || 0;
      let estado = item.estadoStock;
      if (liveStockByDash[item.id] !== undefined) {
        const liveVal = Number(liveStockByDash[item.id]);
        if (!isNaN(liveVal)) {
          baseStock = liveVal;
          if (baseStock === 0) {
            estado = 'Sin Stock';
          } else if (baseStock < (item.stockMinimo || 0)) {
            estado = 'Bajo Mínimo';
          } else {
            estado = 'En Stock';
          }
          saveStockOverride(item.id, baseStock, estado);
        }
      }

      // 3. Costo Unitario en Vivo
      let unitCost = item.costoUnitarioUSD || 0;
      if (liveCostByDash[item.id] !== undefined && Number(liveCostByDash[item.id]) > 0) {
        unitCost = Number(liveCostByDash[item.id]);
        saveCostOverride(item.id, unitCost);
      }

      const stockProyectado = baseStock + enTransito;
      const deficit = Math.max(0, (item.stockMinimo || 0) - baseStock);

      return {
        ...item,
        stockBase: baseStock,
        costoUnitarioUSD: unitCost,
        estadoStock: estado,
        deficit,
        enTransitoOAB: enTransito,
        stockProyectado,
        isOptimisticSync: false,
        syncNote: undefined
      };
    });

    // 4. Hidratación en caliente de adiciones del Catálogo Maestro desde Edge KV (Dual-Truth Loopback)
    const liveAdditions = Array.isArray(data.liveCatalogAdditions) ? data.liveCatalogAdditions : [];
    for (const liveItem of liveAdditions) {
      const liveId = liveItem.dashboardId || liveItem.id || liveItem.insumoId;
      const alreadyPresent = updated.some(it => 
        (it.id && (it.id === liveId || it.id === liveItem.dashboardId || it.id === liveItem.insumoId)) ||
        (it.insumoId && (it.insumoId === liveItem.insumoId || it.insumoId === liveId)) ||
        (it.codigo && liveItem.codigo && it.codigo.toUpperCase() === liveItem.codigo.toUpperCase())
      );

      if (!alreadyPresent && liveItem.nombre) {
        const baseStk = liveItem.stockBase || 0;
        const minStk = liveItem.stockMinimo || 0;
        const def = Math.max(0, minStk - baseStk);
        const estStk = liveItem.estadoStock || (baseStk === 0 ? 'Sin Stock' : (baseStk < minStk ? 'Bajo Mínimo' : 'En Stock'));

        const mappedItem: InventoryItem = {
          id: liveItem.dashboardId || liveItem.id || `live-${Date.now()}`,
          insumoId: liveItem.insumoId || liveItem.id,
          nombre: liveItem.nombre,
          codigo: liveItem.codigo || '',
          marca: liveItem.marca || '',
          stockBase: baseStk,
          stockMinimo: minStk,
          deficit: def,
          estadoStock: estStk,
          estadoStockColor: estStk === 'Sin Stock' ? 'red' : (estStk === 'Bajo Mínimo' ? 'orange' : 'green'),
          prioridad: liveItem.prioridad || 'Alta',
          prioridadColor: 'orange',
          categoriaMaterial: liveItem.categoria || 'General',
          rolMaterial: liveItem.rolMaterial || 'Materia Prima',
          unidad: liveItem.unidad || 'UND',
          costoUnitarioUSD: liveItem.costoUnitarioUSD || 0,
          color: liveItem.color || '',
          dimensiones: liveItem.dimensiones || '',
          enTransitoOAB: 0,
          stockProyectado: baseStk,
          stockApartado: 0,
          stockLibre: baseStk,
          isOptimisticSync: false
        };

        updated.unshift(mappedItem);
      }
    }

    return {
      updatedItems: updated,
      activeOrdersCount: data.activeOrdersCount || 0,
      synced: true
    };
  } catch (err) {
    console.warn('Revalidación SWR en segundo plano no disponible:', err);
    return { updatedItems: currentItems, activeOrdersCount: 0, synced: false };
  }
}

// =========================================================================
// GOBIERNO DE ALMACÉN: RESERVAS MTO Y ASIGNACIONES MULTITIENDA (FASE 10C)
// =========================================================================

export interface StoreAllocation {
  id: string;
  dashboardId: string;
  insumoId: string;
  insumoNombre: string;
  codigo: string;
  proyectoId: string;
  proyectoNombre: string;
  cantidadApartada: number;
  cantidadTransito: number;
  cantidadConsumida: number;
  unidad?: string;
  costoUnitarioUSD?: number;
  updatedAt: number;
}

export interface ProjectSummary {
  proyectoId: string;
  proyectoNombre: string;
  totalItems: number;
  totalUSD: number;
  items: StoreAllocation[];
}

export interface InsumoSummary {
  totalApartado: number;
  totalTransito: number;
  totalConsumido: number;
  proyectosCount: number;
  desglose: StoreAllocation[];
}

export interface AllocationsResponse {
  status: string;
  allocations: StoreAllocation[];
  debts: any[];
  summaryByDashboardId: Record<string, InsumoSummary>;
  summaryByProyectoId: Record<string, ProjectSummary>;
  activeDebtsCount: number;
  timestamp: number;
}

export async function fetchLiveAllocations(filter?: { dashboardId?: string; proyectoId?: string }): Promise<AllocationsResponse> {
  const params = new URLSearchParams();
  if (filter?.dashboardId) params.set('dashboardId', filter.dashboardId);
  if (filter?.proyectoId) params.set('proyectoId', filter.proyectoId);

  const res = await fetch(`/api/inventory/allocations?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Error consultando asignaciones: ${res.statusText}`);
  }
  return res.json();
}

export async function reserveStockDirect(payload: {
  dashboardId: string;
  insumoId?: string;
  materialNombre: string;
  codigo?: string;
  proyectoId: string;
  proyectoNombre: string;
  cantidad: number;
  unidad?: string;
  costoUnitarioUSD?: number;
  notas?: string;
}) {
  const res = await fetch('/api/inventory/allocations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'reserve',
      ...payload
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Error desconocido' }));
    throw new Error(err.error || `Error reservando material (${res.status})`);
  }
  return res.json();
}

export async function reassignStoreStock(payload: {
  dashboardId: string;
  insumoId?: string;
  materialNombre: string;
  origenProyectoId: string;
  origenProyectoNombre: string;
  destinoProyectoId: string;
  destinoProyectoNombre: string;
  cantidad: number;
  motivo: string;
  reponerCedente?: boolean;
  unidad?: string;
}) {
  const res = await fetch('/api/inventory/allocations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'reassign',
      ...payload
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Error desconocido' }));
    throw new Error(err.error || `Error reasignando material (${res.status})`);
  }
  return res.json();
}

export async function releaseStoreStock(payload: {
  dashboardId: string;
  materialNombre: string;
  proyectoId: string;
  proyectoNombre: string;
  cantidad: number;
  motivo?: string;
  unidad?: string;
}) {
  const res = await fetch('/api/inventory/allocations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'release',
      ...payload
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Error desconocido' }));
    throw new Error(err.error || `Error liberando material (${res.status})`);
  }
  return res.json();
}

export async function liquidateStoreAllocations(payload: {
  proyectoId: string;
  proyectoNombre?: string;
  motivo?: string;
  itemsToRelease?: Array<{ dashboardId: string; materialNombre?: string; cantidadLiberar: number }>;
  marcarProyectoConcluido?: boolean;
}) {
  const res = await fetch('/api/inventory/allocations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'liquidate',
      ...payload
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Error desconocido' }));
    throw new Error(err.error || `Error liquidando obra (${res.status})`);
  }
  return res.json();
}

export async function reconcileAllocations(applyFix: boolean = false, token?: string | null, supervisorPIN?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch('/api/inventory/reconcile', {
    method: 'POST',
    headers,
    body: JSON.stringify({ applyFix, supervisorPIN: supervisorPIN || '1234' })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Error desconocido' }));
    throw new Error(err.error || `Error ejecutando reconciliación (${res.status})`);
  }

  return res.json();
}


