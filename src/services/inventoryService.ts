import { InventoryItem, KpiSummary } from '../types/inventory';

export interface InventoryDataResponse {
  items: InventoryItem[];
  kpis: KpiSummary;
  selectOrders: Record<string, string[]>;
  lastSyncDisplay: string;
}

// Persistencia de Ajustes Recientes en Almacenamiento Local (Fase 9H - Decisión D3)
const STOCK_OVERRIDES_KEY = 'sanesca_stock_overrides';

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

  // Leer sobreescrituras locales recientes de ajustes físicos (Fase 9H/9I - Decisión D5)
  const overrides = typeof window !== 'undefined' ? getStockOverrides() : {};
  let overridesModified = false;

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
      costoUnitarioUSD: item.costoUnitarioUSD || 0
    };
  });

  // Si se desalojaron overrides reconciliados, sincronizar localStorage
  if (overridesModified && typeof window !== 'undefined') {
    try {
      localStorage.setItem(STOCK_OVERRIDES_KEY, JSON.stringify(overrides));
    } catch (e) {
      console.warn('Error persistiendo evicción de overrides:', e);
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
    if (!data || data.status !== 'synced') {
      return { updatedItems: currentItems, activeOrdersCount: data.activeOrdersCount || 0, synced: false };
    }

    const transitoByDash = data.enTransitoByDashboardId || {};
    const transitoByName = data.enTransitoByName || {};

    const updated = currentItems.map(item => {
      // Prioridad 1: buscar por dashboardId
      let transit = transitoByDash[item.id];
      // Prioridad 2: buscar por nombre normalizado si no se encontró
      if (transit === undefined && item.nombre) {
        transit = transitoByName[item.nombre.toLowerCase().trim()];
      }

      const enTransito = transit !== undefined ? transit : (item.enTransitoOAB || 0);
      const stockProyectado = (item.stockBase || 0) + enTransito;

      return {
        ...item,
        enTransitoOAB: enTransito,
        stockProyectado,
        isOptimisticSync: false,
        syncNote: undefined
      };
    });

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

