# Product Context — Dashboard de Inventario & Sistema OAB Sanesca PRO

<!-- Fabricación e Inventario Industrial -->

## Platform

Web Application (Desktop 1440px+, Tablet 768px-1024px y Mobile 390px+). Desplegado en Cloudflare Pages con backend serverless en Cloudflare Pages Functions.

## Users & Personas

1. **Gerencia General (Magaly):** Evalúa financieramente las solicitudes de abastecimiento en la Hoja Viajera física impresa (`OAB-YYYYMMDD-##`), aprueba/ajusta cantidades renglón por renglón con bolígrafo y firma en físico.
2. **Encargado de Inventario / Almacén:** Monitorea KPIs de stock, detecta déficits operativos, asocia proyectos del ERP (`OrderSearchModal`), ajusta empaques comerciales e imprime la Hoja Viajera formal.
3. **Encargada de Compras:** Recibe la hoja física aprobada por Magaly, cotiza con proveedores, transcribe las cotizaciones y autorizaciones en `OABReviewModal` (transición a `En Compra`) y entrega la hoja a rampa como guía de espera.
4. **Operador / Custodio de Rampa:** Recibe camiones y fleteros en el muelle de carga mediante `ReceptionTerminalModal` táctil (PC/Tablet), cuenta físicamente, captura fotos de la Nota de Entrega, tolera excedentes indivisibles y genera backorders automáticos en modo offline-resiliente.

## Product Purpose

Cerrar el ciclo físico-digital completo de **abastecimiento de insumos, autorización gerencial de compras, recepción en rampa y libro mayor de inventario (Kardex)** en la planta de Sanesca Exhibidores C.A.

El sistema erradica la compra reactiva a ciegas y la manipulación estática del stock, implementando un flujo de partida doble inspirado en las mejores prácticas de **Odoo ERP**, adaptado a la soberanía operativa de planta.

## Capabilities & Workflows

### 1. Monitoreo y Diagnóstico en Tiempo Real
- 21 columnas operativas con vistas compacta y ampliada, selector personalizado, ordenamiento multi-nivel (3 niveles) y agrupación flexible.
- KPIs semáforo reactivos (Sin Stock, Bajo Mínimo, En Stock, En Reconteo, % Auditados 3D).
- Stock proyectado en vivo con revalidación asíncrona SWR (`functions/api/inventory/sync.js`).

### 2. Emisión de Abastecimiento (OAB)
- Detección automática de déficit y algoritmo de sugerencia por empaque comercial (`computePackagingSuggestion`).
- Conmutador táctil entre cantidades netas y empaques cerrados.
- Buscador reactivo de obras industriales de Notion ERP (`OrderSearchModal`).
- Generación de Hoja Viajera (`OAB-YYYYMMDD-##`) con formato formal `@media print` de alta resolución, QR transaccional, montos bimonetarios ($ USD / Bs BCV) y cuadrícula manuscrita.

### 3. Puente Papel-Digital (Revisión y Cotización)
- Modal asistido `OABReviewModal` para transcripción rápida de autorizaciones de Magaly ("Todo", "0/Tachado", "Ajustado").
- Carga de cotizaciones de compras: proveedor, cotización/factura, fecha y observaciones.
- Transición formal de líneas de insumos a estado `En Compra` (En Tránsito).

### 4. Recepción Táctil en Rampa y Resiliencia Offline
- Terminal táctil en `ReceptionTerminalModal` con selector reactivo de OABs en tránsito.
- Conteo físico renglón por renglón con botones rápidos `Todo/0`.
- Partición automática de *Backorders* cuando la entrega es parcial.
- Captura fotográfica con compresión Canvas en cliente (máx 1600px, JPEG 80%, reducción ~85% del peso).
- Almacenamiento pericial directo e inmutable en Cloudflare R2 (`sanesca-evidencias`) bajo la clave canónica `evidencias/oab/{folioOAB}/{cleanNota}.jpg`.
- Cola offline durable en `IndexedDB` (`offlineReceptionStorage.ts`) con drenador en dos pasos (subida a R2 + registro en Notion) y purga atómica de Base64.

### 5. Valuación por Costo de Reposición Dual y Alerta de Sobrecosto
- Modelo contable de Costo de Reposición (última compra conforme) que actualiza atómicamente `Costo_Unitario_Base_USD` en `BD_Materiales_Insumos` para blindar los márgenes de BOM frente a la inflación en Bolívares.
- Denominación dual sincronizada en tiempo real (USD Neto + Bs a Tasa BCV del día).
- Detección reactiva de sobrecostos (>5% vs cotizado por Magaly en la OAB) con badge ámbar semántico en rampa y estampa pericial de auditoría `[⚠️ SOBRECOSTO +X%]` en Kardex sin bloquear la descarga física del camión.

### 6. Libro Mayor de Inventario (Kardex Inmutable) y Visor de Auditoría
- Transacción atómica serverless en `functions/api/oab/receive.js`.
- Asiento inmutable en `BD_Kardex_Movimientos` (10 columnas canónicas con emojis) enlazando el comprobante fotográfico inmutable en Cloudflare R2 en la propiedad `Comprobante` (files).
- Doble barrera de idempotencia para prevenir dobles asientos por caídas de red o reintentos en rampa.
- Incremento atómico directo de `Stock (base)` en la base de datos de planta de Notion.
- Visor de auditoría denso en frontend (`KardexViewerModal.tsx`) con acceso dual (cabecera y filas), búsqueda reactiva, retro-cálculo matemático de saldos históricos hacia atrás y lightbox de comprobantes.

### 7. Alertas Automatizadas por Telegram Bot en Operaciones
- Notificaciones serverless desacopladas vía `@sanesca_produccion_bot` hacia el canal oficial de planta (`-1003139956223`).
- Alerta bimonetaria instantánea ante emisión de OAB con desglose de ítems, montos totales y botón interactivo al dashboard.
- Alerta pericial de rampa ante incidencias operativas (rechazos, faltantes y sobrecostos detectados) con deep-link directo al visor de Kardex.
- Resiliencia serverless con timeout defensivo `AbortController` (3.5s).

## Stack Tecnológico

- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, Lucide React.
- **Persistencia Local / Offline:** IndexedDB (`sanesca_inventario_rampa_db`) y LocalStorage.
- **Almacenamiento de Evidencias (Object Storage):** Cloudflare R2 (`sanesca-evidencias`).
- **Canal de Notificaciones Operativas:** Telegram Bot API (`@sanesca_produccion_bot`).
- **Backend Serverless:** Cloudflare Pages Functions (`/api/notion/*`, `/api/inventory/*`, `/api/oab/*`, `/api/kardex/*`, `/api/storage/*`, `/api/telegram/*`, `/api/bcv/*`).
- **Base de Datos Core:** Notion API v1 (`BD_Materiales_Insumos`, `BD_Ordenes_Abastecimiento`, `Solicitudes de Insumos`, `Dashboard`, `BD_Kardex_Movimientos`, `BD_Pedidos`).
- **Despliegue y CDN:** Cloudflare Pages.

## Product Principles

1. **Visibilidad Inmediata:** Los semáforos, badges y KPIs revelan el estado crítico del inventario en menos de 2 segundos.
2. **Densidad Operativa:** Hoja de cálculo de grado industrial; máxima cantidad de información útil por píxel sin distracciones decorativas.
3. **Respeto a la Soberanía Física (Puente Papel-Digital):** La tecnología acompaña y agiliza el flujo humano real (la firma de Magaly y la cotización de Compras), nunca lo bloquea.
4. **Tolerancia Cero a la Pérdida de Datos en Rampa:** Resiliencia offline absoluta; una mala señal Wi-Fi en el portón de planta jamás impide recibir un camión ni extravía una foto.
5. **Inmutabilidad y Partida Doble:** Cada tuerca que entra a planta queda registrada con su responsable, fecha, folio OAB, comprobante en R2 y costo de reposición en el Kardex.
