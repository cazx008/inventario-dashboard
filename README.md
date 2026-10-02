# Dashboard de Inventario & Suite de Abastecimiento OAB — Sanesca PRO

Sistema web industrial para la gestión integral de inventario, emisión de órdenes de abastecimiento (OAB), autorización gerencial, cotización de compras, recepción táctil en rampa de carga y libro mayor inmutable (Kardex) para Sanesca Exhibidores C.A.

---

## 🏗️ Arquitectura del Sistema

```
                      ┌──────────────────────────────────────┐
                      │             Notion ERP               │
                      │  • BD_Materiales_Insumos             │
                      │  • BD_Ordenes_Abastecimiento         │
                      │  • Solicitudes de Insumos            │
                      │  • Dashboard (Stock Planta)          │
                      │  • BD_Kardex_Movimientos             │
                      │  • BD_Pedidos (Obras D42)            │
                      └──────────────────┬───────────────────┘
                                         │
                          HTTPS Notion API v1 (Token seguro)
                                         │
                                         ▼
                      ┌──────────────────────────────────────┐
                      │      Cloudflare Pages Functions      │
                      │  • /api/notion/* (Proxy seguro)      │
                      │  • /api/inventory/sync (Cursor SWR)  │
                      │  • /api/oab/create (Emisión + Bot TG)│
                      │  • /api/oab/details & /review        │
                      │  • /api/oab/receive (Kardex atómico) │
                      │  • /api/kardex/list (Auditoría)      │
                      │  • /api/storage/upload (R2 Bucket)   │
                      │  • /api/telegram/notify (Bot Alertas)│
                      │  • /api/bcv/rate (Tasa oficial BCV)  │
                      └──────────────┬────────────┬──────────┘
                                     │            │
                     HTTPS Multipart │            │ Telegram Webhook
                                     ▼            ▼
                      ┌──────────────┴───────┐ ┌──┴───────────────────────┐
                      │  Cloudflare R2 Bucket│ │  Telegram Bot Canal      │
                      │  sanesca-evidencias  │ │  @sanesca_produccion_bot │
                      │  (Fotos Inmutables)  │ │  (-1003139956223)        │
                      └──────────────┬───────┘ └──────────────────────────┘
                                     │
                                     ▼
                      ┌──────────────────────────────────────┐
                      │    Frontend React 18 + Vite + TS     │
                      │  • "La Terminal de Almacén" (Dark)   │
                      │  • Emisión OAB con empaques          │
                      │  • Hoja Viajera (@media print & QR)  │
                      │  • Puente Papel-Digital (Revisión)   │
                      │  • Terminal Rampa (IndexedDB + Foto) │
                      │  • Visor Kardex & Saldos Históricos  │
                      │  • Tasa BCV & Costo Reposición Dual  │
                      └──────────────────────────────────────┘
```

---

## 🚀 Hubs Funcionales

### 1. Monitoreo y Diagnóstico en Vivo
- **21 columnas operativas** con vistas rápida (compacta) y técnica (ampliada).
- **Semáforos y KPIs dinámicos** reactivos a filtros activos (Sin Stock, Bajo Mínimo, En Stock, En Reconteo, % Auditados 3D).
- **Revalidación SWR con Cursor:** Carga ultrarrápida instantánea y sincronización en segundo plano con paginación recursiva por cursor (`start_cursor`).

### 2. Emisión de Abastecimiento (OAB)
- Detección automática de déficit respecto al stock mínimo.
- **Inteligencia de empaques comerciales:** redondeo sugerido a cajas cerradas (x100, x500), barras (6m) o cuñetes con conmutador táctil `[Empaque (X)]` / `[Neto (Y)]`.
- **Integración ERP:** Buscador reactivo de obras (`OrderSearchModal`) para vincular compras a pedidos formales de producción.
- **Hoja Viajera Impresa (`OAB-YYYYMMDD-##`):** Motor `@media print` monocromático de alta resolución con QR transaccional, montos bimonetarios ($ USD / Bs BCV) y cuadrícula manuscrita para firmas de gerencia, compras y rampa.

### 3. Puente Papel-Digital (Revisión OAB)
- Hub asistido para transcripción de la firma de Magaly y cotización de Compras.
- Opciones de un clic por renglón: "Todo Aprobado", "0 / Tachado" o "Cantidad Ajustada".
- Asentamiento de proveedor comercial adjudicado, N° de cotización/factura y fecha estimada de entrega.
- Transición formal de líneas a estado `En Compra` (En Tránsito).

### 4. Terminal Táctil de Rampa y Resiliencia Offline
- Diseñada para tablets y PCs en el muelle de carga con botones táctiles grandes `Todo/0`.
- Selector reactivo de OABs en tránsito para evitar digitación a ciegas.
- División y registro automático de entregas parciales (*Backorders*).
- Admisión de tolerancias físicas por excedentes de perfiles indivisibles o pesaje.
- **Captura fotográfica real con compresión Canvas** (máx 1600px, 80%) y almacenamiento directo en Cloudflare R2 (`sanesca-evidencias`).
- **Cola offline durable en IndexedDB** (`offlineReceptionStorage.ts`): si falla el Wi-Fi en rampa, la recepción se almacena en el dispositivo y se auto-drena en 2 pasos al restaurar conexión.
- **Kardex inmutable:** Asiento de partida doble con clave de idempotencia que previene duplicados.

### 5. Valuación por Costo de Reposición Dual & Auditoría de Kardex
- **Costo de Reposición en USD Neto:** Se actualiza con cada compra conforme para proteger márgenes en recetas BOM.
- **Tasa BCV del día:** Equivalencia calculada en Bolívares en tiempo real.
- **Alerta de Sobrecosto (>5%):** Advertencia visual ámbar en rampa y estampa pericial en Kardex sin bloquear la descarga.
- **Visor de Kardex en Frontend (`KardexViewerModal.tsx`):** Histórico denso con cálculo matemático de saldos hacia atrás, filtros por material y lightbox de comprobantes.

### 6. Alertas Automatizadas por Telegram Bot
- Despacho serverless desde `@sanesca_produccion_bot` al canal de planta (`-1003139956223`).
- Alerta bimonetaria instantánea ante emisión de OAB con deep-link al dashboard.
- Alerta pericial ante incidencias en rampa (rechazos, faltantes y sobrecostos) con deep-link al visor de Kardex.

---

## 💻 Desarrollo y Ejecución Local

### Requisitos
- Node.js ≥ 18
- Token de integración de Notion con acceso a las bases de datos de Sanesca

### Instalación
```bash
npm install
```

### Ejecución en Desarrollo
```bash
# Iniciar servidor local de desarrollo Vite (puerto 3456 por defecto)
npm run dev
```

### Compilación para Producción
```bash
npm run build
```

---

## 🗄️ Esquema de Bases de Datos en Notion

| Base de Datos | ID de Notion | Rol en el Sistema |
|:--------------|:-------------|:-------------------|
| **BD_Materiales_Insumos** | `26286805-4e27-8067-8847-d39de1bf0bde` | Catálogo maestro de materias primas y empaques |
| **BD_Ordenes_Abastecimiento** | `3eb86805-4e27-81f9-860a-c51fc794ebb0` | Cabeceras de órdenes de abastecimiento (Folio OAB) |
| **Solicitudes de Insumos** | `2bc86805-4e27-8036-ba88-d52ec84742ba` | Renglones transaccionales por material y proyecto |
| **Dashboard** | `2b586805-4e27-80fe-b6e8-e4c6dc325696` | Existencias físicas activas en planta (Stock base) |
| **BD_Kardex_Movimientos** | `26286805-4e27-803b-91ce-ef8f121d622d` | Libro mayor inmutable de movimientos de almacén |
| **BD_Pedidos** | `3d086805-4e27-814b-9ff4-e694d56a58bb` | Órdenes y proyectos industriales activos de la empresa |

---

## 🌐 Ecosistema de Dashboards Sanesca PRO

| Módulo | Repositorio / URL | Función |
|:-------|:------------------|:--------|
| 📦 **Inventario & Abastecimiento OAB** | `inventario-dashboard` | Gestión de stock, compras, rampa y Kardex |
| ⚡ **Monitoreo Energético** | `sanesca-dashboard` | Telemetría de cortes eléctricos y horómetros |
| 🏭 **Medidas Operativas** | `medidas-operativas` | Dimensiones y especificaciones técnicas |
| 🛠️ **Kits de Instalación** | `kits-dashboard` | Trazabilidad de kits y bultos por obra |
