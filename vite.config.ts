import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

function localApiMiddlewarePlugin(): Plugin {
  const handler = (req: any, res: any, next: any) => {
    if (!req.url?.startsWith('/api/')) {
      return next();
    }

    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }

    if (pathname === '/api/auth/employees') {
      res.statusCode = 200;
      return res.end(JSON.stringify({
        status: 'success',
        employees: [
          { id: 'emp-1', name: 'Mikel Itriago', hasPin: true, areas: ['Dirección General', 'Sistemas'] },
          { id: 'emp-2', name: 'Pedro Herrero', hasPin: false, areas: ['Herrería', 'Estructuras'] },
          { id: 'emp-3', name: 'Carlos Carpintero', hasPin: false, areas: ['Carpintería', 'Corte & Canteado'] },
          { id: 'emp-4', name: 'Jose Pintor', hasPin: false, areas: ['Pintura Electrostática'] },
          { id: 'emp-5', name: 'Luis Ensamblador', hasPin: false, areas: ['Ensamble Final', 'Embalaje'] },
          { id: 'emp-6', name: 'Magaly González', hasPin: true, areas: ['Administración', 'Compras'] }
        ]
      }));
    }

    if (pathname === '/api/orders/active') {
      res.statusCode = 200;
      return res.end(JSON.stringify({
        status: 'success',
        orders: [
          { id: 'P0334', codigo: 'PED-1025', proyecto: 'GARMIN - BELLO CAMPO', cliente: 'GARMIN', estado: 'En Producción' },
          { id: 'P0335', codigo: 'PED-1026', proyecto: 'ADIDAS - SAMBIL CHACAO', cliente: 'ADIDAS', estado: 'Confirmado' },
          { id: 'P0336', codigo: 'PED-1027', proyecto: 'FARMAGO - LAS MERCEDES', cliente: 'FARMAGO', estado: 'Cerrado' }
        ]
      }));
    }

    if (pathname === '/api/orders/lines') {
      res.statusCode = 200;
      return res.end(JSON.stringify({
        status: 'success',
        lines: [
          { id: 'line-1', nombre: 'P862 - Cremallera 240cm Tubo 1" Enganche Izq', cantidad: 6, estado: 'En Fabricación' },
          { id: 'line-2', nombre: 'P866 - Barra de Unión 122.5cm Tubo 1x1"', cantidad: 15, estado: 'En Fabricación' },
          { id: 'line-3', nombre: 'P861 - Cremallera 240cm Tubo 1" Calzado', cantidad: 17, estado: 'Pendiente' }
        ]
      }));
    }

    if (pathname === '/api/bom/order-balance') {
      const bomPath = path.resolve(__dirname, 'data/bom_index_optimized.json');
      let bomData: any = {};
      if (fs.existsSync(bomPath)) {
        bomData = JSON.parse(fs.readFileSync(bomPath, 'utf8'));
      }

      const getCost = (matKey: string, defaultCost = 1.0) => {
        return bomData?.insumos?.[matKey]?.costo ?? defaultCost;
      };

      const balance = [
        {
          mat: 'M66',
          codigo: 'TUB-021',
          dashboardId: null,
          nombre: 'Tubo Hierro 1X1 1.1Mm E',
          unidad: 'Metro Lineal',
          teorico: 34.5,
          real: 36.0,
          diferencia: 1.5,
          varianzaPct: 4.35,
          costoUnitarioUSD: getCost('M66', 2.0),
          costoVariacionUSD: +(1.5 * getCost('M66', 2.0)).toFixed(2),
          estado: 'NORMAL',
          salidasCount: 3
        },
        {
          mat: 'M4',
          codigo: 'DIS-009',
          dashboardId: null,
          nombre: 'Discos Flap',
          unidad: 'Unidad',
          teorico: 2.1,
          real: 2.0,
          diferencia: -0.1,
          varianzaPct: -4.76,
          costoUnitarioUSD: getCost('M4', 1.8),
          costoVariacionUSD: +(-0.1 * getCost('M4', 1.8)).toFixed(2),
          estado: 'AHORRO',
          salidasCount: 1
        },
        {
          mat: 'M6',
          codigo: 'PIN-009',
          dashboardId: null,
          nombre: 'Pintura',
          unidad: 'Galón',
          teorico: 2.1,
          real: 2.5,
          diferencia: 0.4,
          varianzaPct: 19.05,
          costoUnitarioUSD: getCost('M6', 16.0),
          costoVariacionUSD: +(0.4 * getCost('M6', 16.0)).toFixed(2),
          estado: 'MERMA_EXCESIVA',
          salidasCount: 2
        },
        {
          mat: 'M23',
          codigo: 'DIS-013',
          dashboardId: null,
          nombre: 'Disco Corte Metal',
          unidad: 'Unidad',
          teorico: 0.042,
          real: 0.042,
          diferencia: 0,
          varianzaPct: 0,
          costoUnitarioUSD: getCost('M23', 1.2),
          costoVariacionUSD: 0,
          estado: 'EXACTO',
          salidasCount: 1
        }
      ];

      const totalTeoricoUSD = balance.reduce((acc, b) => acc + (b.teorico * b.costoUnitarioUSD), 0);
      const totalRealUSD = balance.reduce((acc, b) => acc + (b.real * b.costoUnitarioUSD), 0);
      const diferenciaNetaUSD = totalRealUSD - totalTeoricoUSD;
      const varianzaGlobalPct = totalTeoricoUSD > 0 ? (diferenciaNetaUSD / totalTeoricoUSD) * 100 : 0;

      res.statusCode = 200;
      return res.end(JSON.stringify({
        status: 'success',
        orderId: url.searchParams.get('orderId') || 'PED-1025',
        pedidoCodigo: url.searchParams.get('pedidoCodigo') || 'PED-1025',
        balance,
        mueblesConBOM: [
          { id: 'm-1', codigo: 'P862', nombre: 'Cremallera 240cm Tubo 1" Enganche Izq', cantidad: 6 },
          { id: 'm-2', codigo: 'P866', nombre: 'Barra de Unión 122.5cm Tubo 1x1"', cantidad: 15 }
        ],
        mueblesSinBOM: [],
        kpis: {
          totalTeoricoUSD: +totalTeoricoUSD.toFixed(2),
          totalRealUSD: +totalRealUSD.toFixed(2),
          diferenciaNetaUSD: +diferenciaNetaUSD.toFixed(2),
          varianzaGlobalPct: +varianzaGlobalPct.toFixed(2),
          itemsAuditadosCount: balance.length,
          mermasCriticasCount: balance.filter(b => b.estado === 'MERMA_EXCESIVA').length,
          mueblesConBOMCount: 2,
          mueblesSinBOMCount: 0,
          salidasKardexCount: 7
        }
      }));
    }

    if (pathname === '/api/bom/order-close-audit') {
      res.statusCode = 200;
      return res.end(JSON.stringify({
        status: 'success',
        message: 'Auditoría de cierre formal concluida exitosamente.',
        auditLogId: 'audit-log-e2e-ok',
        updatedOrder: {
          id: 'PED-1025',
          estado: 'Cerrado',
          auditado: true
        }
      }));
    }

    if (pathname === '/api/kardex/dispatch') {
      res.statusCode = 200;
      return res.end(JSON.stringify({
        status: 'success',
        message: 'Salida a taller registrada con éxito.',
        newStock: 45,
        kardexId: 'kardex-e2e-ok'
      }));
    }

    next();
  };

  return {
    name: 'local-api-middleware',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    }
  };
}

export default defineConfig({
  plugins: [react(), localApiMiddlewarePlugin()],
  server: {
    port: 3456,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  }
});
