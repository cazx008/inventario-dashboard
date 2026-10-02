import { InventoryItem, KpiSummary } from '../types/inventory';

export interface InventoryDataResponse {
  items: InventoryItem[];
  kpis: KpiSummary;
  selectOrders: Record<string, string[]>;
  lastSyncDisplay: string;
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

  // Enriquecer items con enTransitoOAB y stockProyectado
  items = items.map(item => {
    const enTransito = item.enTransitoOAB || 0;
    const proyectado = (item.stockBase || 0) + enTransito;
    return {
      ...item,
      enTransitoOAB: enTransito,
      stockProyectado: proyectado,
      costoUnitarioUSD: item.costoUnitarioUSD || 0
    };
  });

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

