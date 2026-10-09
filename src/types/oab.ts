export interface OABHeader {
  id?: string;
  folio: string; // OAB-YYYYMMDD-##
  fechaEmision: string;
  totalUSD: number;
  totalBs: number;
  tasaBCV: number;
  estadoGeneral: 'Borrador' | 'Solicitado' | 'Aprobado por Gerencia' | 'En Compra' | 'Recepción Parcial' | 'Completada' | 'Cancelada';
  notas?: string;
  comprobanteUrl?: string;
}

export interface OABLineItem {
  id?: string;
  nombre: string;
  insumoId?: string;
  dashboardId?: string;
  cantidadStock: number;
  stockMinimo: number;
  deficit: number;
  cantidadSugerida: number;
  cantidadSolicitada: number;
  cantidadAprobada?: number;
  cantidadRecibida?: number;
  cantidadRecibidaHoy?: number;
  cantidadRecibidaPrevia?: number;
  cantidadRechazada?: number;
  backorderPendiente?: number;
  costoUnitarioUSD: number;
  costoAprobadoUSD?: number;
  subtotalUSD: number;
  prioridad: string;
  proyectoId?: string;
  proyectoNombre?: string;
  notasDiscrepancia?: string;
  toleranciaExcedente?: boolean;
  empaqueComercial?: string;
  factorEmpaque?: number;
  paquetesSugeridos?: number;
  cantidadComercialSugerida?: number;
}

export interface PackagingSuggestion {
  empaqueComercial: string;
  factorEmpaque: number;
  paquetesSugeridos: number;
  cantidadComercialSugerida: number;
}

export function computePackagingSuggestion(nombre: string, categoria?: string, deficit: number = 0): PackagingSuggestion {
  const lowerName = (nombre || '').toLowerCase();
  const lowerCat = (categoria || '').toLowerCase();
  const def = Math.max(1, Math.round(deficit));

  // 1. Tornillería / Remaches / Tuercas / Anclajes / Arandelas / Ramplús
  if (
    lowerName.includes('tornill') ||
    lowerName.includes('tuerca') ||
    lowerName.includes('rampl') ||
    lowerName.includes('remache') ||
    lowerName.includes('arandela') ||
    lowerCat.includes('tornill') ||
    lowerCat.includes('fijaci')
  ) {
    const factor = def > 100 ? 500 : 100;
    const packs = Math.ceil(def / factor);
    return {
      empaqueComercial: `Caja x ${factor} und`,
      factorEmpaque: factor,
      paquetesSugeridos: packs,
      cantidadComercialSugerida: packs * factor
    };
  }

  // 2. Perfilería Metálica / Tubos / Barras / Ángulos / Pletinas (Estándar 6.00 m)
  if (
    lowerName.includes('tubo') ||
    lowerName.includes('perfil') ||
    lowerName.includes('angulo') ||
    lowerName.includes('ángulo') ||
    lowerName.includes('pletina') ||
    lowerName.includes('barra') ||
    lowerName.includes('viga') ||
    lowerCat.includes('metal') ||
    lowerCat.includes('perfil')
  ) {
    const factor = 6; // 6 metros por barra comercial
    const packs = Math.ceil(def / factor);
    return {
      empaqueComercial: `Barra 6.0m`,
      factorEmpaque: factor,
      paquetesSugeridos: packs,
      cantidadComercialSugerida: packs * factor
    };
  }

  // 3. Pinturas / Solventes / Thinner / Pegamentos / Químicos
  if (
    lowerName.includes('pintura') ||
    lowerName.includes('thinner') ||
    lowerName.includes('solvente') ||
    lowerName.includes('pega') ||
    lowerName.includes('fondo') ||
    lowerName.includes('esmalte') ||
    lowerCat.includes('quimic') ||
    lowerCat.includes('químic') ||
    lowerCat.includes('acabado')
  ) {
    if (def >= 15) {
      const factor = 19; // Cuñete ~5 galones (~19 Litros)
      const packs = Math.ceil(def / factor);
      return {
        empaqueComercial: `Cuñete 5 Gal (19L)`,
        factorEmpaque: factor,
        paquetesSugeridos: packs,
        cantidadComercialSugerida: packs * factor
      };
    } else if (def >= 4) {
      const factor = 4; // Galón ~3.785 - 4L
      const packs = Math.ceil(def / factor);
      return {
        empaqueComercial: `Galón (4L)`,
        factorEmpaque: factor,
        paquetesSugeridos: packs,
        cantidadComercialSugerida: packs * factor
      };
    }
  }

  // 4. Tableros / MDF / Melaminas / Vidrios / Acrílicos
  if (
    lowerName.includes('mdf') ||
    lowerName.includes('melamina') ||
    lowerName.includes('lamina') ||
    lowerName.includes('lámina') ||
    lowerName.includes('vidrio') ||
    lowerName.includes('acrilic') ||
    lowerName.includes('acrílic') ||
    lowerCat.includes('madera') ||
    lowerCat.includes('tablero')
  ) {
    const factor = 1;
    const packs = Math.ceil(def);
    return {
      empaqueComercial: `Lámina estándar (1.22x2.44m)`,
      factorEmpaque: factor,
      paquetesSugeridos: packs,
      cantidadComercialSugerida: packs
    };
  }

  // 5. Electrodos / Alambre soldadura
  if (lowerName.includes('alambre') || lowerName.includes('soldad') || lowerName.includes('electrodo')) {
    const factor = 15; // Rollo soldadura 15kg o caja electrodos 5kg
    const packs = Math.ceil(def / factor);
    return {
      empaqueComercial: `Rollo/Caja x 15 kg`,
      factorEmpaque: factor,
      paquetesSugeridos: packs,
      cantidadComercialSugerida: packs * factor
    };
  }

  // Fallback: Pieza / Unidad
  return {
    empaqueComercial: `Pieza suelta`,
    factorEmpaque: 1,
    paquetesSugeridos: def,
    cantidadComercialSugerida: def
  };
}

export interface OrderReference {
  id: string;
  codigo: string;
  cliente: string;
  proyecto: string;
  tipo: 'PED' | 'PRS' | 'FAC' | 'OBRA' | 'OE' | string;
  fecha?: string;
  estado?: string;
  toleranciaObraPct?: number;
}
