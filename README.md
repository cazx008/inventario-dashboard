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
                      │  • /api/inventory/allocations (MTO)  │
                      │  • /api/catalog/* (Items, ISO, Audit)│
                      │  • /api/oab/create (Emisión + Bot TG)│
                      │  • /api/oab/details & /review        │
                      │  • /api/oab/receive (Kardex atómico) │
                      │  • /api/kardex/list, dispatch, adjust│
                      │  • /api/bom/* (Balance Mermas, Cierre│
                      │  • /api/auth/* (HMAC, PIN, 2FA, Logs)│
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
                      │  • Terminal de Despacho y Mermas BOM │
                      │  • Catálogo Maestro & Health Checker │
                      │  • Rótulos MTO Multi-Densidad QR 45mm│
                      │  • Conteo Cíclico y Ajustes Odoo 18  │
                      │  • Directorio Bultos & Cédula QR PC  │
                      │  • Bitácora Forense & Taxonomía 3D   │
                      │  • Popover Portal & Despacho Cero    │
                      │  • Rampa MTS, Split & PIN Supervisor │
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

### 7. Terminal de Despacho Físico a Taller (Fase 9A)
- Salida formal de materias primas e insumos desde almacén hacia líneas de fabricación.
- Imputación en 3 niveles de ingeniería: General Planta (MTS), Tienda/Obra (MTO) y Mobiliario Específico (BOM MTO).
- Conmutador de empaque comercial y justificación técnica obligatoria ($\ge 15$ caracteres) para consumos no presupuestados.
- Decremento atómico de existencias y asiento inmutable en Kardex.

### 8. Auditoría de Cierre BOM, Conciliación de Mermas y Transaccionalidad ERP (Fase 9B-9E)
- Comparación cuantitativa ex-post entre Demanda Teórica (Valery SSOT) y Despachos Reales (Kardex).
- Costos unitarios en USD reales para el 100% de insumos (441 ítems) en `BD_Catalogo_Insumos`.
- Matriz dinámica de tolerancias (5%, 8%, 10%, 12%) con dictamen dinámico (`🟢 CONFORME` vs `🔴 DESVIACIÓN`).
- Liquidación formal con mutación a `Cerrado` en `BD_Pedidos`, registro inmutable en `BD_Auditoria_Accesos_Logs` y reintegro contable de retazos útiles ($\ge 1.0\text{ m}$) en Kardex.
- Bloqueo activo en terminal para órdenes concluidas con bypass de excepción por PIN de supervisor.
- Hoja de impresión formal en formato Carta con 4 cuadrantes de firmas físicas.

### 9. Identidad, Seguridad Criptográfica RBAC y 2FA Telegram (Fase 10)
- Autenticación criptográfica con HMAC-SHA256 para Telegram WebApp y PIN operativo para terminales de PC.
- Matriz de permisos RBAC gobernada directamente desde Notion (`Puestos de trabajo`).
- Flujo interactivo 2FA vía Telegram con tickets efímeros y nonces de un solo uso para reseteo de PIN.
- Protección anti-fuerza bruta en Upstash Redis y visor denso de auditoría forense para Superadmin (`AccessAuditModal`).

### 10. Reservas Make-to-Order (MTO) y Asignaciones por Tienda (Fase 10 MTO & 10F)
- Apartado y protección de insumos físicos por tienda/obra para erradicar la canibalización de materiales comprados para proyectos específicos.
- Tablero panorámico (`StoreAllocationModal.tsx`) y popover flotante (`AllocationsPopover.tsx`) para transferencias entre obras y liquidación de sobrantes.
- Gestión en Cloudflare Edge KV (`INVENTORY_KV` `live_allocations`) con latencia sub-5ms y protocolo "Shoe Box" de rampa.

### 11. Gestión Maestra del Catálogo, Ficha Técnica ISO y Health Checker (Fase 11)
- Desacoplamiento estricto y modelo atómico dual: Catálogo Maestro (`BD_Catalogo_Insumos`) y Control de Stock Físico (`BD_Control_Stock_Existencias`).
- Modal maestro integral (`ItemMasterModal.tsx`): Directorio, Ficha Técnica asistida por Ontología ISO (Conceptos normalizados, subcategorías, unidades de medida bloqueadas).
- Health Checker de Catálogo (`/api/catalog/audit.js`): detección de huérfanos, inconsistencias de esquema y auto-sanación con un solo clic.
- Vista modular ergonómica de 15 columnas con sorting interactivo y nombres completos visibles.

### 12. Motor de Rótulos Logísticos MTO, Bultos y Multi-Densidad con QR 45mm (Fase 12)
- Motor multi-densidad de impresión física: `8up` Carta compacto (Default, 102×60mm), `10up` Avery 5163/8163 (101.6×50.8mm), `4up` Carta grande (105×140mm) y `rollo4x6` continuo térmico (101.6×152.4mm).
- Hardening mecánico para impresoras láser (HP LaserJet / EPSON / Brother): cota vertical de 254mm en hoja Carta con márgenes de 4mm, erradicando hojas en blanco por margen de agarre del rodillo.
- Diseño logístico de 3 bandas: Cabecera negra 100% con código de obra y bulto; Cuerpo asimétrico 60/40 con regla tipográfica híbrida (16.5px $\le 45$ chars / 14px $>45$ chars, caja de cantidad en 21px bold monospace).
- Código QR colosal de 45mm × 45mm (resolución nativa 200px) con alcance óptico de hasta 2.8m, origen de producción inmutable (`CANONICAL_ORIGIN`) y sufijos seriales dinámicos `-S1`/`-S2` para bultos fraccionados en taller.

### 13. Núcleo de Despacho & Matching Canónico Bimodal O(1) (Fase 13 / PLAN-008)
- Algoritmo de normalización léxica y matching heurístico $O(1)$ (`normalizeMatchKey`) insensible a acentos, diacríticos y variaciones de espaciado para enlazar insumos de catálogo con reservas de pedidos (Caso *Cola Blanca Pega Sold* / *SHOE BOX*).
- Despacho contextual instantáneo: botones directos `[ 📤 Despachar ]` integrados en el Popover de asignaciones y en el Tablero Panorámico de Asignaciones con pre-llenado automático de obra y material.
- Purga atómica de reservas residuales: eliminación automática de llaves con saldo cero en Cloudflare Edge KV (`INVENTORY_KV`).

### 14. Directorio Central de Bultos y Cédula Pericial QR en Pantalla (Fase 14 / PLAN-009)
- Pestaña central "Directorio de Bultos" integrada en el Tablero Panorámico (`StoreAllocationModal.tsx`) con vista bimodal conmutador Grid (Tarjetas de Bulto) vs Tabla ERP densa.
- Motor de búsqueda reactiva por PKG-ID, código de pedido, descripción de insumo y tipo de bulto.
- Modal de Cédula Pericial QR en pantalla completa para PC (`BultoVerificationModal.tsx` extendido) con código QR de 240px, código de barras Code128, detalles de ingeniería y deep-link a Cédula Digital Móvil (390px).

### 15. Bitácora Forense Integral y Taxonomía Tríada de Eventos sin Impacto Físico (Fase 15 / PLAN-010)
- Trazabilidad pericial y bitácora unificada de eventos operacionales que no alteran el Kardex físico de inmediato pero requieren auditoría estricta:
  - `OPERACIONES`: `RECLASIFICACION_MTO_RAMPA`, `IMPRESION_ETIQUETAS_MTO`, `APERTURA_BULTO_TALLER`, `DESPACHO_ORDEN`.
  - `AJUSTES`: `CONTEO_VERIFICADO_CONFORME`, `AJUSTE_DIFERENCIA_FISICA`, `REINTEGRO_RETAZO_UTIL`.
  - `SEGURIDAD`: `SOLICITUD_2FA_PIN`, `LOGIN_PC_EXITOSO`, `LOGIN_PC_FALLIDO`, `BLOQUEO_ANTI_BRUTEFORCE`.
- 4 Tarjetas analíticas KPI con severidades normalizadas (`INFO`, `WARN`, `CRITICAL`), búsqueda difusa multicampo y exportación pericial a CSV con UTF-8 BOM.
- Buffer caliente LIFO en Upstash Redis y persistencia asíncrona permanente en `BD_Auditoria_Accesos_Logs` (`3ec86805`) en Notion mediante `ctx.waitUntil`.

### 16. Popover Bimodal Anti-Clipping y Despacho Defensivo ante Stock Cero (Fase 16 / PLAN-011 / INC-007)
- Arquitectura bimodal de popovers flotantes: React Portal (`createPortal`) montado en `#portal-root` con cálculo dinámico de coordenadas en Desktop (erradicando cualquier corte vertical por `overflow: hidden` en tablas filtradas) y Bottom Sheet táctil nativo en terminales móviles (390px).
- Erradicación de `max=0` HTML5 nativo: prevención de bloqueos cuando un insumo posee apartado MTO pero stock físico libre en cero, desplegando puentes defensivos directos hacia Requisición de Compras (OAB) y Rampa de Recepción.
- Paginación y scroll fluido con preservación estricta de contexto y badges de proyecto al filtrar inventario.

### 17. Abastecimiento Stock Común (MTS), Rectificación Dinámica en Rampa, Split de Destinos y Rotulado Universal (Fase 17 / PLAN-012)
- Emisión de OAB para Stock Común (MTS / General Planta) mediante tarjeta destacada en el buscador modal de pedidos (`OrderSearchModal.tsx`), erradicando la necesidad de asociar una obra de cliente para reposición de bodega general.
- Rectificación dinámica en muelle de Rampa (`ReceptionTerminalModal.tsx`): reclasificación in situ del destino del material (MTS ➔ MTO o MTO Obra A ➔ Obra B / MTS) ante cambios de prioridad en planta, estampando el badge pericial `[RECTIFICADO EN RAMPA]` y emitiendo logs forenses.
- Fraccionamiento cuantitativo (`Split`): división de una línea de compra en múltiples bultos con destinos disjuntos (ej. 70 unidades a Obra X y 30 unidades a Stock Común MTS) sin alterar la orden de compra original.
- Autorización por PIN de Supervisor (`1234` / Superadmin) requerida para validar rectificaciones o split en rampa antes del cierre de recepción.
- Rotulado QR Universal: generación de etiquetas industriales con QR colosal de 45mm y seriales PKG-ID para el 100% de los bultos descargados, cubriendo tanto pedidos MTO como insumos MTS para bodega general.

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

## 🗄️ Esquema Canónico de Bases de Datos en Notion (Estándar Odoo 18)

| Base de Datos Canónica | ID de Notion | Modelo Odoo 18 | Rol en Ingeniería Industrial |
|:-----------------------|:-------------|:---------------|:-----------------------------|
| **BD_Catalogo_Insumos** | `26286805-4e27-8067-8847-d39de1bf0bde` | `product.template` | Ficha técnica maestra y costo unitario base USD (Cero Stock) |
| **BD_Control_Stock_Existencias** | `2b586805-4e27-80fe-b6e8-e4c6dc325696` | `stock.quant` | Existencias físicas activas en planta y stock mínimo |
| **BD_Kardex_Movimientos** | `26286805-4e27-803b-91ce-ef8f121d622d` | `stock.move` | Libro mayor inmutable de movimientos de almacén |
| **BD_Ordenes_Abastecimiento** | `3eb86805-4e27-81f9-860a-c51fc794ebb0` | `purchase.order` | Requisiciones y cabeceras de compras (Folio OAB) |
| **BD_Lineas_Abastecimiento** | `2bc86805-4e27-8036-ba88-d52ec84742ba` | `purchase.order.line` | Renglones transaccionales por insumo y obra |
| **BD_Pedidos** | `3d086805-4e27-814b-9ff4-e694d56a58bb` | `sale.order` | Órdenes de fabricación confirmadas y estado de auditoría |
| **BD_Pedidos_Lineas** | `3d086805-4e27-811c-b163-cd5f972b0855` | `sale.order.line` | Líneas de mobiliario despiezado a fabricar |
| **BD_Proyectos** | `31e86805-4e27-80e0-8be5-f3d30532e900` | `project.project` | Cuentas analíticas de obras y tiendas |
| **BD_Clientes** | `31e86805-4e27-8060-a52b-c2f81d58f466` | `res.partner` | Directorio comercial canónico de clientes |
| **BD_Auditoria_Accesos_Logs** | `3ec86805-4e27-8111-8cc9-fcfb594f3b1e` | `ir.logging` | Pista forense inmutable, sesiones y cierres BOM |

---

## 🌐 Ecosistema de Dashboards Sanesca PRO

| Módulo | Repositorio / URL | Función |
|:-------|:------------------|:--------|
| 📦 **Inventario & Abastecimiento OAB** | `inventario-dashboard` | Gestión de stock, compras, rampa y Kardex |
| ⚡ **Monitoreo Energético** | `sanesca-dashboard` | Telemetría de cortes eléctricos y horómetros |
| 🏭 **Medidas Operativas** | `medidas-operativas` | Dimensiones y especificaciones técnicas |
| 🛠️ **Kits de Instalación** | `kits-dashboard` | Trazabilidad de kits y bultos por obra |
