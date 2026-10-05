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
- Modelo contable de Costo de Reposición (última compra conforme) que actualiza atómicamente `Costo_Unitario_Base_USD` en `BD_Catalogo_Insumos` para blindar los márgenes de BOM frente a la inflación en Bolívares.
- Denominación dual sincronizada en tiempo real (USD Neto + Bs a Tasa BCV del día).
- Detección reactiva de sobrecostos (>5% vs cotizado por Magaly en la OAB) con badge ámbar semántico en rampa y estampa pericial de auditoría `[⚠️ SOBRECOSTO +X%]` en Kardex sin bloquear la descarga física del camión.

### 6. Libro Mayor de Inventario (Kardex Inmutable) y Visor de Auditoría
- Transacción atómica serverless en `functions/api/oab/receive.js` (entradas) y `functions/api/kardex/dispatch.js` (salidas).
- Asiento inmutable en `BD_Kardex_Movimientos` (10 columnas canónicas con emojis) enlazando el comprobante fotográfico inmutable en Cloudflare R2 en la propiedad `Comprobante` (files).
- Doble barrera de idempotencia para prevenir dobles asientos por caídas de red o reintentos en rampa.
- Ajuste atómico directo de `Stock (base)` en `BD_Control_Stock_Existencias` de Notion.
- Visor de auditoría denso en frontend (`KardexViewerModal.tsx`) con acceso dual (cabecera y filas), búsqueda reactiva, retro-cálculo matemático de saldos históricos hacia atrás y lightbox de comprobantes.

### 7. Alertas Automatizadas por Telegram Bot en Operaciones
- Notificaciones serverless desacopladas vía `@sanesca_produccion_bot` hacia el canal oficial de planta (`-1003139956223`).
- Alerta bimonetaria instantánea ante emisión de OAB con desglose de ítems, montos totales y botón interactivo al dashboard.
- Alerta pericial de rampa ante incidencias operativas (rechazos, faltantes y sobrecostos detectados) con deep-link directo al visor de Kardex.
- Alerta instantánea ante salidas de materiales a producción con detalle de pedido, tienda, mobiliario y motivo.
- Resiliencia serverless con timeout defensivo `AbortController` (3.5s).

### 8. Terminal de Despacho Físico a Taller (Fase 9A)
- Registro de salidas de almacén hacia líneas de fabricación mediante `MaterialDispatchModal.tsx` con acceso desde cabecera industrial ("Despacho a Taller") y fila de la tabla.
- Imputación de consumos en 3 niveles de ingeniería industrial:
  1. **General Planta (MTS):** Consumibles universales de taller (discos, lijas, solventes, soldadura) sin atar a órdenes de venta.
  2. **Tienda / Obra (MTO):** Imputación directa a obras activas del ERP (`BD_Pedidos` hidratadas con clientes y proyectos de `BD_Clientes` y `BD_Proyectos`), con selector obligatorio de destino: *Presupuestado* (receta original) vs *No Presupuestado* (adicional, merma o imprevisto de obra).
  3. **Mobiliario Específico (BOM MTO):** Vinculación a renglones de `BD_Pedidos_Lineas` mediante endpoint `/api/orders/lines.js`, permitiendo imputar consumo por pieza a fabricar.
- Conmutador táctil de empaque comercial vs fraccionario (barras de 6m vs metros, cajas de 100/500 und vs piezas sueltas) que preserva la unidad base física en Kardex y la glosa comercial para auditoría.
- Decremento atómico de existencias físicas en `BD_Control_Stock_Existencias`.
- Generación inmutable de asiento `🔴 Salida a Producción` en `BD_Kardex_Movimientos` con tag canónico `[ORDER_UUID:${pedidoId}]`.

### 9. Auditoría Ex-Post de Mermas BOM y Cierre de Tienda (Fase 9B-9D)
- Conciliación matemática ex-post entre la Demanda Teórica (despiece precompilado de 956 muebles y 198 insumos de Valery en `bom_index_optimized.json`) y las Salidas Reales de Kardex registradas bajo la orden.
- Backend serverless de alta velocidad (`/api/bom/order-balance.js`) que analiza títulos con regex `/\b(P\d+[-A-Z0-9]*)\b/i`, computa varianzas porcentuales, calcula impacto financiero neto en USD y segrega transparentemente muebles especiales sin receta.
- Visor interactivo `OrderBOMAuditModal.tsx` con selector de pedidos activos, tarjetas de KPIs de ahorro/sobrecosto, tabla densa monospace, soporte para declaración de retazos devueltos y plantilla formal de impresión `@media print`.
- Resiliencia táctica en rampa ante caídas de Cloudflare R2: algoritmo de backoff exponencial con jitter (1s, 2s, 4s, 8s), cola persistente en IndexedDB (`photo_retry_queue`) y marca provisional `[FOTO_PENDIENTE_R2]` que permite ingresar la mercancía sin bloquear el camión ni demorar la planta.
- Integración fiscal SENIAT: campos opcionales de Factura Legal y Número de Control en rampa u oficina, estampados en Kardex y OAB para auditoría tributaria venezolana.
- Optimización de CDN Edge con cabecera `Cache-Control: public, s-maxage=60, stale-while-revalidate=30` y telemetría de cota `X-Sync-Overflow`.

## Stack Tecnológico

- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, Lucide React.
- **Persistencia Local / Offline:** IndexedDB (`sanesca_inventario_rampa_db` v2 con `reception_queue` y `photo_retry_queue`) y LocalStorage.
- **Índice Precompilado de Ingeniería:** `bom_index_optimized.json` (214 KB, despiece maestro 100% resuelto de Valery).
- **Almacenamiento de Evidencias (Object Storage):** Cloudflare R2 (`sanesca-evidencias`).
- **Canal de Notificaciones Operativas:** Telegram Bot API (`@sanesca_produccion_bot`).
- **Backend Serverless:** Cloudflare Pages Functions (`/api/notion/*`, `/api/inventory/*`, `/api/oab/*`, `/api/kardex/*`, `/api/orders/*`, `/api/bom/*`, `/api/storage/*`, `/api/telegram/*`, `/api/bcv/*`, `/api/auth/*`).
- **Bases de Datos Core (Estándar Odoo 18 en Notion):**
  - `BD_Catalogo_Insumos` (`product.template` / `product.product`, ID: `26286805-4e27-8067-8847-d39de1bf0bde`)
  - `BD_Control_Stock_Existencias` (`stock.quant`, ID: `2b586805-4e27-80fe-b6e8-e4c6dc325696`)
  - `BD_Kardex_Movimientos` (`stock.move`, ID: `26286805-4e27-803b-91ce-ef8f121d622d`)
  - `BD_Ordenes_Abastecimiento` (`purchase.order`, ID: `3eb86805-4e27-81f9-860a-c51fc794ebb0`)
  - `BD_Lineas_Abastecimiento` (`purchase.order.line`, ID: `2bc86805-4e27-8036-ba88-d52ec84742ba`)
  - `BD_Pedidos` (`sale.order`, ID: `3d086805-4e27-814b-9ff4-e694d56a58bb`)
  - `BD_Pedidos_Lineas` (`sale.order.line`, ID: `3d086805-4e27-811c-b163-cd5f972b0855`)
  - `BD_Proyectos` (`project.project`, ID: `31e86805-4e27-80e0-8be5-f3d30532e900`)
  - `BD_Clientes` (`res.partner`, ID: `31e86805-4e27-8060-a52b-c2f81d58f466`)
  - `BD_Auditoria_Accesos_Logs` (`ir.logging`, ID: `3ec86805-4e27-8111-8cc9-fcfb594f3b1e`)
- **Despliegue y CDN:** Cloudflare Pages (`https://sanesca-inventario.pages.dev/`).

## Product Principles

1. **Visibilidad Inmediata:** Los semáforos, badges y KPIs revelan el estado crítico del inventario en menos de 2 segundos.
2. **Densidad Operativa:** Hoja de cálculo de grado industrial; máxima cantidad de información útil por píxel sin distracciones decorativas.
3. **Respeto a la Soberanía Física (Puente Papel-Digital):** La tecnología acompaña y agiliza el flujo humano real (la firma de Magaly y la cotización de Compras), nunca lo bloquea.
4. **Tolerancia Cero a la Pérdida de Datos en Rampa:** Resiliencia offline absoluta; una mala señal Wi-Fi en el portón de planta jamás impide recibir un camión ni extravía una foto.
5. **Inmutabilidad y Partida Doble:** Cada tuerca que entra o sale de planta queda registrada con su responsable, fecha, folio OAB/Pedido, comprobante y costo de reposición en el Kardex.
6. **Trazabilidad Industrial Tripartita (MTS / MTO Obra / MTO BOM):** Ningún material abandona el almacén central sin quedar imputado a un centro de costo general, orden de tienda o renglón de mobiliario específico.
7. **Cero Freno a Fabricación (Auditoría Ex-Post vs Bloqueo Ex-Ante):** El taller despacha libremente a demanda del operario; las desviaciones, mermas y desperdicios se calculan analíticamente al cierre formal de la orden sin estrangular el ritmo productivo de planta.
