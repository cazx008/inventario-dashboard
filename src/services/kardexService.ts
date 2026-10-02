/**
 * Servicio Cliente de Consulta y Auditoría de Kardex
 * Ruta: src/services/kardexService.ts
 */

export interface KardexMovement {
  id: string;
  descripcion: string;
  movimiento: string;
  cantidad: number;
  costoUnitarioUSD: number;
  costoTotalUSD: number;
  folioOAB: string;
  numeroNotaEntrega: string;
  fecha: string;
  dashboardId?: string | null;
  insumoId?: string | null;
  comprobanteUrl?: string | null;
  saldoCalculado?: number;
}

export interface KardexQueryParams {
  cursor?: string | null;
  pageSize?: number;
  dashboardId?: string | null;
  tipo?: string | null;
  folioOAB?: string | null;
}

export interface KardexResponse {
  status: string;
  results: KardexMovement[];
  nextCursor: string | null;
  hasMore: boolean;
  totalReturned: number;
}

/**
 * Generador de datos simulados realistas para desarrollo local (Vite sin backend serverless conectado)
 */
function getMockKardexResponse(params: KardexQueryParams): KardexResponse {
  const allMockMovements: KardexMovement[] = [
    {
      id: 'mock-kardex-1',
      descripcion: '[REC] Tornillo Autoperforante #8 x 1/2" (50 und)',
      movimiento: '🟢 Entrada por Compra',
      cantidad: 50,
      costoUnitarioUSD: 0.05,
      costoTotalUSD: 2.50,
      folioOAB: 'OAB-20261001-01',
      numeroNotaEntrega: 'NE-8841',
      fecha: '2026-10-01',
      dashboardId: params.dashboardId || 'dash-mock-1',
      insumoId: 'ins-mock-1',
      comprobanteUrl: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=800&auto=format&fit=crop'
    },
    {
      id: 'mock-kardex-2',
      descripcion: '[ORD] Despacho a Producción Obra EPA San Diego',
      movimiento: '🔴 Salida a Producción',
      cantidad: 20,
      costoUnitarioUSD: 0.05,
      costoTotalUSD: 1.00,
      folioOAB: 'ORD-PROD-244',
      numeroNotaEntrega: 'OP-112',
      fecha: '2026-09-28',
      dashboardId: params.dashboardId || 'dash-mock-1',
      insumoId: 'ins-mock-1'
    },
    {
      id: 'mock-kardex-3',
      descripcion: '[REC] Perfil Tubular 2x1 Calibre 18 (12 barras de 6m)',
      movimiento: '🟢 Entrada por Compra',
      cantidad: 12,
      costoUnitarioUSD: 14.50,
      costoTotalUSD: 174.00,
      folioOAB: 'OAB-20260920-04',
      numeroNotaEntrega: 'NE-6721',
      fecha: '2026-09-20',
      dashboardId: 'dash-mock-2',
      insumoId: 'ins-mock-2',
      comprobanteUrl: 'https://images.unsplash.com/photo-1504917599217-d4dc5ebe6122?w=800&auto=format&fit=crop'
    },
    {
      id: 'mock-kardex-4',
      descripcion: '[MER] Merma de taller por corte angular defectuoso',
      movimiento: '🟡 Ajuste / Merma',
      cantidad: 2,
      costoUnitarioUSD: 14.50,
      costoTotalUSD: 29.00,
      folioOAB: 'AUDIT-20260918',
      numeroNotaEntrega: 'AJU-04',
      fecha: '2026-09-18',
      dashboardId: 'dash-mock-2',
      insumoId: 'ins-mock-2'
    },
    {
      id: 'mock-kardex-5',
      descripcion: '[INI] Inventario Inicial Verificado por Auditoría',
      movimiento: '⚪ Inventario Inicial',
      cantidad: 40,
      costoUnitarioUSD: 14.50,
      costoTotalUSD: 580.00,
      folioOAB: 'AUDIT-INICIAL-2026',
      numeroNotaEntrega: 'S/N',
      fecha: '2026-09-01',
      dashboardId: 'dash-mock-2',
      insumoId: 'ins-mock-2'
    }
  ];

  let filtered = allMockMovements;
  if (params.dashboardId) {
    filtered = filtered.filter(m => m.dashboardId === params.dashboardId);
    if (filtered.length === 0) {
      // Si no coincide con ninguno, asignamos al primer mock para visualización
      filtered = allMockMovements.slice(0, 2).map(m => ({ ...m, dashboardId: params.dashboardId }));
    }
  }

  if (params.tipo && params.tipo !== 'TODOS') {
    filtered = filtered.filter(m => m.movimiento === params.tipo);
  }

  return {
    status: 'success',
    results: filtered,
    nextCursor: null,
    hasMore: false,
    totalReturned: filtered.length
  };
}

/**
 * Consulta la lista de movimientos de Kardex con filtros y paginación
 */
export async function fetchKardexMovements(params: KardexQueryParams = {}): Promise<KardexResponse> {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.pageSize) query.set('pageSize', params.pageSize.toString());
  if (params.dashboardId) query.set('dashboardId', params.dashboardId);
  if (params.tipo) query.set('tipo', params.tipo);
  if (params.folioOAB) query.set('folioOAB', params.folioOAB);

  try {
    const res = await fetch(`/api/kardex/list?${query.toString()}`);
    if (!res.ok) {
      if (res.status === 404 && import.meta.env.DEV) {
        return getMockKardexResponse(params);
      }
      throw new Error(`Error en consulta de Kardex (${res.status})`);
    }
    return await res.json();
  } catch (err) {
    if (import.meta.env.DEV) {
      console.info('Operando con mock de desarrollo local para el Libro Mayor.');
      return getMockKardexResponse(params);
    }
    console.error('Error al consultar Kardex:', err);
    return {
      status: 'error',
      results: [],
      nextCursor: null,
      hasMore: false,
      totalReturned: 0
    };
  }
}

/**
 * Determina el signo del delta transaccional según el tipo de movimiento
 */
function getMovementDelta(movimiento: string, cantidad: number): number {
  const lower = movimiento.toLowerCase();
  const absQty = Math.abs(cantidad);

  if (lower.includes('entrada') || lower.includes('inicial') || lower.includes('devolución') || lower.includes('reabastecimiento')) {
    return absQty;
  }
  if (lower.includes('salida') || lower.includes('merma') || lower.includes('consumo') || lower.includes('producción')) {
    return -absQty;
  }
  return cantidad;
}

/**
 * Algoritmo robusto de cálculo dinámico de saldos para el Libro Mayor
 * - Si existe un movimiento de Apertura (Día Cero), calcula los saldos hacia adelante desde el saldo inicial.
 * - Si no existe movimiento de Apertura, retro-calcula desde currentStock.
 * - movements DEBE venir ordenado descendentemente por fecha/creación (el más reciente en index 0).
 */
export function computeRunningBalances(
  movements: KardexMovement[],
  currentStock: number | null | undefined
): KardexMovement[] {
  if (!movements || movements.length === 0) return [];

  // Verificar si el movimiento más antiguo es un asiento de apertura oficial
  const oldestMovement = movements[movements.length - 1];
  const isOldestAperture = Boolean(
    oldestMovement.folioOAB?.includes('APERTURA') ||
    oldestMovement.descripcion?.includes('APERTURA') ||
    oldestMovement.movimiento?.toLowerCase().includes('inicial')
  );

  // Si tenemos el asiento de apertura como raíz de la historia (Día Cero)
  if (isOldestAperture) {
    const reversed = [...movements].reverse();
    let forwardBalance = 0;

    const computedReversed: KardexMovement[] = [];
    for (let i = 0; i < reversed.length; i++) {
      const mov = reversed[i];
      const delta = getMovementDelta(mov.movimiento, mov.cantidad);
      forwardBalance += delta;
      computedReversed.push({
        ...mov,
        saldoCalculado: forwardBalance
      });
    }

    // Retornamos en el orden original (descendente, más reciente en index 0)
    return computedReversed.reverse();
  }

  // Si no tenemos apertura, usamos retro-cálculo desde currentStock
  const effectiveStock = (currentStock !== null && currentStock !== undefined) ? currentStock : 0;
  const computed: KardexMovement[] = [];
  let running = effectiveStock;

  for (let i = 0; i < movements.length; i++) {
    const mov = movements[i];
    computed.push({
      ...mov,
      saldoCalculado: Math.max(0, running)
    });

    // Para el siguiente movimiento hacia el pasado, restamos el delta que produjo este estado:
    const delta = getMovementDelta(mov.movimiento, mov.cantidad);
    running = running - delta;
  }

  return computed;
}
