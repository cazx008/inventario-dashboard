import { OABHeader, OABLineItem } from '../types/oab';

export interface CreateOABPayload {
  folio: string;
  fechaEmision: string;
  tasaBCV: number;
  totalUSD: number;
  totalBs: number;
  notas?: string;
  lineas: OABLineItem[];
}

export interface ReceptionItemPayload {
  solicitudId?: string;
  dashboardId?: string;
  insumoId?: string;
  nombre: string;
  cantidadAprobada: number;
  cantidadRecibida: number;
  cantidadRechazada: number;
  costoUnitarioUSD: number;
  costoAprobadoUSD?: number;
  toleranciaExcedente?: boolean;
  notasDiscrepancia?: string;
}

export interface RegisterReceptionPayload {
  folioOAB: string;
  oabId?: string;
  proveedorId?: string;
  numeroNotaEntrega: string;
  fechaRecepcion?: string;
  tasaBCV?: number;
  items: ReceptionItemPayload[];
  comprobanteUrl?: string;
  comprobanteFile?: string; // Base64 temporal en caso de captura offline
  numeroFacturaFiscal?: string; // SENIAT Factura Legal (Opcional)
  numeroControlFiscal?: string; // SENIAT Número de Control (Opcional)
  fotoPendienteSync?: boolean; // Bandera de resiliencia R2
}

function getAuthHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = sessionStorage.getItem('sanesca_auth_jwt') || localStorage.getItem('sanesca_auth_jwt') || '';
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

export async function uploadEvidenceToR2(
  folioOAB: string,
  numeroNotaEntrega: string,
  imageBase64: string
): Promise<string> {
  const res = await fetch('/api/storage/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify({ folioOAB, numeroNotaEntrega, imageBase64 })
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Error ${res.status} al subir evidencia a R2`);
  }

  const data = await res.json();
  return data.url;
}

export async function createOABSheet(payload: CreateOABPayload) {
  const res = await fetch('/api/oab/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Error ${res.status} al emitir OAB`);
  }

  return await res.json();
}

export async function registerReception(payload: RegisterReceptionPayload) {
  const res = await fetch('/api/oab/receive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Error ${res.status} al registrar recepción`);
  }

  return await res.json();
}

export function generateFolioOAB(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const randSeq = String(Math.floor(Math.random() * 90) + 10);
  return `OAB-${yyyy}${mm}${dd}-${randSeq}`;
}

export interface OABReviewLine {
  solicitudId: string;
  nombre: string;
  cantidadSolicitada: number;
  cantidadAprobada: number;
  costoUnitarioUSD: number;
  subtotalUSD: number;
  estadoFlujo?: string;
  dashboardId?: string;
  insumoId?: string;
  prioridad?: string;
  proyectoNombre?: string;
}

export interface OABReviewDetails {
  oab: {
    id: string;
    folio: string;
    fechaEmision: string;
    totalUSD: number;
    totalBs: number;
    tasaBCV: number;
    estadoGeneral: string;
    proveedor?: string;
    cotizacion?: string;
    fechaEstimadaEntrega?: string;
    notas?: string;
    notasCompras?: string;
  };
  lines: OABReviewLine[];
}

export interface SubmitReviewPayload {
  oabId: string;
  folioOAB: string;
  proveedorNombre?: string;
  numeroCotizacion?: string;
  fechaEstimadaEntrega?: string;
  notasCompras?: string;
  comprobanteUrl?: string;
  lineas: {
    solicitudId: string;
    cantidadAprobada: number;
    costoUnitarioUSD: number;
  }[];
}

export interface CancelOABPayload {
  folioOAB: string;
  oabId?: string;
  motivoCancelacion: string;
}

export async function cancelOAB(payload: CancelOABPayload) {
  const res = await fetch('/api/oab/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Error ${res.status} al anular la OAB`);
  }

  return await res.json();
}

export async function fetchPendingOABs(): Promise<any[]> {
  try {
    const res = await fetch('/api/oab/details?list=pending', {
      headers: { ...getAuthHeader() }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.orders || [];
  } catch {
    return [];
  }
}

export async function fetchOABDetails(folio: string): Promise<OABReviewDetails | null> {
  const res = await fetch(`/api/oab/details?folio=${encodeURIComponent(folio)}`, {
    headers: { ...getAuthHeader() }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'No se pudo cargar la orden');
  }
  return await res.json();
}

export async function submitOABReview(payload: SubmitReviewPayload) {
  const res = await fetch('/api/oab/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Error al guardar la revisión de OAB');
  }

  return await res.json();
}


