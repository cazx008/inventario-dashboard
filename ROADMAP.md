# Roadmap — Dashboard de Inventario Sanesca

> Resumen ejecutivo del roadmap. El plan original completo (v3) con diagramas Mermaid, decisiones cerradas, riesgos y estructura de archivos está preservado en [`docs/PLAN_v3_original.md`](docs/PLAN_v3_original.md).

## Estado de Fases

| Fase | Estado | Descripción |
|:-----|:-------|:------------|
| **Pre-Fase 0** | ✅ Completada | Rollups de Notion (relaciones, cálculos) |
| **Fase 1** | ✅ Completada | Diseño visual con StitchMCP |
| **Fase 2** | ✅ Completada | Script extractor con resolución de relaciones |
| **Fase 3** | ✅ Completada | Frontend core: tabla, filtros, agrupación, KPIs, glosario |
| **Fase 3.5** | ✅ Completada | Integración Impeccable (auditoría y refinamiento visual) |
| **Fase 4** | ✅ Completada | Pipeline CI/CD (GitHub Actions `deploy.yml` + Cloudflare Worker) |
| **Fase 5** | ✅ Completada | Validación E2E en GitHub Pages (`https://cazx008.github.io/inventario-dashboard/`) |
| **Fase 6** | ✅ Completada | Sistema Integral OAB: Abastecimiento, Compras, Recepción en Rampa, Kardex y Migración Vite+React |
| **Fase 7** | ✅ Completada | Segunda Pasada de Industrialización: SWR, Puente Papel-Digital, Rampa Offline e Inteligencia de Empaques |
| **Fase 8** | ✅ Completada | Consolidación Industrial: Visor Kardex & Cursor (8A), Almacenamiento R2 (8B), Costo Reposición Dual (8C), Alertas Telegram (8D) — Desplegada en vivo en Cloudflare Pages (`https://sanesca-inventario.pages.dev/`) |
| **Fase 9A** | ✅ Completada | Terminal de Despacho Físico a Taller: Salidas a Producción, Cruce de Tienda, Desglose BOM y Asiento Kardex — Desplegada en vivo (`https://sanesca-inventario.pages.dev/`) |
| **Fase 9B-9D** | ✅ Completada | Auditoría Ex-Post de Mermas BOM (9B), Alertas Reactivas Supervisadas (9C), Resiliencia R2 Backoff y Factura SENIAT (9D) — Desplegada y Certificada en vivo (`https://sanesca-inventario.pages.dev/`) |
| **Fase 9E** | ✅ Completada | Cierre de Ciclo BOM: Costos Unitarios USD (441 insumos), Transaccionalidad ERP (`BD_Pedidos`), Tolerancias Editables, Reintegro de Retazos y Blindaje de Despacho — Desplegada y Certificada en vivo (`https://sanesca-inventario.pages.dev/`) |
| **Fase 9F** | ✅ Completada | Conteo Cíclico en Vivo, Ajustes Físico-Financieros y Libro Mayor Kardex (Odoo 18 Quant) — Desplegada y Certificada en vivo (`https://sanesca-inventario.pages.dev/`) |
| **Fase 9L** | ✅ Completada | Costos en Ajustes de Stock, Conmutador de Silencio de Alertas y Telegram RBAC Callback Privado (`https://sanesca-inventario.pages.dev/`) |
| **Fase 9M** | ✅ Completada | Sincronización Edge KV Zero-Quota (`INVENTORY_KV` + SWR Edge Cache) y Erradicación del "Dual Truth" Multi-Dispositivo (`https://sanesca-inventario.pages.dev/`) |
| **Fase 10** | ✅ Completada | Identidad WebApp con HMAC-SHA256, RBAC en Notion, 2FA Telegram, Anti-Fuerza Bruta y Auditoría Forense Dual — Desplegada en vivo en Cloudflare Pages (`https://sanesca-inventario.pages.dev/`) |

---

## Fase 3 — Detalle (Completada)

### Features implementadas
- **3A:** Tabla con 19 columnas, vistas compacta/ampliada, selector de columnas
- **3B:** Filtros avanzados (propiedad + operador + valor, AND/OR, acumulables con badges)
- **3C:** Ordenamiento multi-nivel (3 niveles, clic en header)
- **3D:** Agrupación por cualquier categoría con colapsar/expandir
- **3E:** Búsqueda instantánea por nombre, código, marca
- **3F:** KPI cards (Sin Stock, Bajo Mínimo, En Stock, En Reconteo, % Auditados 3D)
- **3G:** Quick filters via badges de Estado y Prioridad
- **3H:** Glosario y Referencia colapsable (columnas, leyenda, indicadores, guía de uso, fuente de datos)

### Fix de datos aplicado
- `extractRollupValue()` corregido para relations y dates
- `resolvePageTitle()` + `resolveRelationIds()` con cache
- 5 columnas vacías resueltas: grupoProceso, proceso, departamento, seReconto3D, diasDesdeReconteo

---

## Fase 3.5 — Integración Impeccable (✅ Completada)

- **Fase I:** `PRODUCT.md`, `DESIGN.md`, `.impeccable/config.json`, `.impeccable/design.json` configurados.
- **Fase II:** Auditoría dual (heurísticas Nielsen + detector automatizado).
- **Fase III:** Refinamiento visual y de usabilidad:
  - Vista compacta ampliada a 6 columnas con pre-orden por Prioridad/Déficit.
  - Estado de error con botón de reintento.
  - KPIs reactivos filtrados (`activeKpis` + badge `FILTRADO`).
  - Barra de herramientas colapsable en mobile (`⚙ Herramientas`) con soporte táctil.
  - Navegación por teclado completa (accesibilidad WCAG).
- **Fase IV:** Verificación visual responsive (Desktop 1440px / Mobile 390px).

---

## Fase 4 — Pipeline CI/CD (✅ Completada)

### Componentes desplegados
1. **Cloudflare Worker `sanesca-sync`:**
   - URL: `https://sanesca-sync.sanesca-sync-worker.workers.dev`
   - Función: Recibe webhook POST/GET y dispara `repository_dispatch` hacia GitHub API (`cazx008/inventario-dashboard`).
   - Secret configurado: `GITHUB_TOKEN`.

2. **GitHub Actions Workflow `.github/workflows/deploy.yml`:**
   - Triggers: `push` a `main`, `workflow_dispatch`, `repository_dispatch` (event: `notion-sync`), `schedule` (cron diario).
   - Steps: Checkout → Setup Node.js → `npm ci` → `npm run build` (`fetch-inventory.js`) → Deploy GitHub Pages.

3. **Trigger en Notion:**
   - Botón nativo configurado en la página **"Central de Operaciones"** (`3bf86805-4e27-80bf-8fc7-f1b1eee3c1de`).
   - Acción: **Enviar webhook** a la URL del Worker.
   - Botón complementario: **Abrir Dashboard** (`https://cazx008.github.io/inventario-dashboard/`).

---

## Fase 5 — Validación E2E y Cierre (✅ Completada)

1. **GitHub Pages en Vivo:** `https://cazx008.github.io/inventario-dashboard/` (HTTP 200, 131 ítems).
2. **Ciclo de Sincronización Verificado:** Clic en botón de Notion → Cloudflare Worker → GitHub Actions dispatch → Fetch Notion → Build & Deploy Pages (~30s).
3. **Mapeo de Campos Validado:** `Stock (base)` y `Stock mínimo` alineados exactamente con Notion.
4. **Cache-Busting Frontend:** Query parameter de timestamp en llamadas `fetch` para evitar caché obsoleto del CDN en navegadores cliente.
5. **Navegación Cruzada:** Enlaces funcionales hacia Dashboards hermanos (*Cortes Eléctricos* y *Medidas Operativas*).

---

## Fase 6 — Sistema OAB, Compras, Recepción en Rampa y Migración a Vite+React (✅ Completada)

- **6A. Arquitectura & Stack Unificado:** Migrado exitosamente a Vite + React 18 + TypeScript + Tailwind CSS, compartiendo stack y tokens con `kits-dashboard`. Despliegue en Cloudflare Pages con proxy seguro `functions/api/notion/[[path]].js`.
- **6B. Reabastecimiento Automático:** Detección de déficit en tiempo real, redondeo comercial e integración de `OrderSearchModal.tsx` para vinculación de obras industriales del ERP (D42).
- **6C. Hoja Viajera de Abastecimiento (`OAB-YYYYMMDD-##`):** Componente `PrintSheetOAB.tsx` con motor de impresión `@media print`, código QR transaccional, totales bimonetarios ($ USD / Bs BCV) y cuadrícula de casillas manuscritas para Magaly, Compras y Rampa.
- **6D. Terminal Táctil de Recepción en Rampa:** Componente `ReceptionTerminalModal.tsx` con conteo físico, botones táctiles `Todo/0`, división automática de backorders, tolerancia de indivisibles y notas de discrepancia.
- **6E. Libro Mayor (Kardex):** Formalizada `BD_Kardex_Movimientos` (ID: `26286805-4e27-803b-91ce-ef8f121d622d`) con 6 movimientos canónicos, cabecera `BD_Ordenes_Abastecimiento` (ID: `3eb86805-4e27-81f9-860a-c51fc794ebb0`) y endpoints atómicos `functions/api/oab/create.js` y `functions/api/oab/receive.js`.

---

## Fase 7 — Segunda Pasada de Industrialización Operativa (✅ Completada)

- **7A. Consistencia Viva de Datos & SWR:**
  - Endpoint `functions/api/inventory/sync.js` para cálculo dinámico en tiempo real de insumos en tránsito desde `Solicitudes de Insumos`.
  - Revalidación asíncrona SWR (`revalidateInventoryLive`) en `inventoryService.ts` (arranque ultrarrápido desde snapshot + revalidación en segundo plano).
  - Actualización optimista en React con badge pulsante (`isOptimisticSync`) en `Header.tsx`.
  - Doble barrera de idempotencia en `functions/api/oab/receive.js` mediante verificación unívoca en `BD_Kardex_Movimientos` (Folio OAB + N° Nota de Entrega).
- **7B. Puente Papel-Digital (Aprobación Magaly & Cotización Compras):**
  - Modal `OABReviewModal.tsx` accesible desde la cabecera industrial ("Revisión OAB").
  - Selector y filtro reactivo de órdenes en estado `Solicitado`.
  - Transcripción manuscrita asistida línea por línea ("Todo", "0/Tachado", "Ajustado").
  - Registro de datos comerciales de Compras: Proveedor Adjudicado, N° Cotización/Factura, Fecha Estimada y Observaciones.
  - Endpoints serverless `functions/api/oab/details.js` y `functions/api/oab/review.js` para transicionar a `En Compra`.
- **7C. Rampa Resiliente (IndexedDB Offline y Fotografía Real):**
  - Servicio durable `offlineReceptionStorage.ts` en IndexedDB (`sanesca_inventario_rampa_db`) con auto-drenado reactivo ante evento `window.addEventListener('online')`.
  - Selector reactivo de OABs en camino en `ReceptionTerminalModal.tsx`.
  - Captura fotográfica física nativa con `<input type="file" capture="environment">`, previsualización y eliminación.
- **7D. Inteligencia de Empaques y Tolerancias Comerciales:**
  - Algoritmo `computePackagingSuggestion` en `src/types/oab.ts` (tornillería, perfiles 6m, químicos).
  - Conmutador táctil `[Empaque (X)]` / `[Neto (Y)]` en `SupplyOrderModal.tsx`.
  - Reflejo de empaque comercial en `PrintSheetOAB.tsx`.
  - Casilla de admisión de tolerancias por excedente indivisible en `ReceptionTerminalModal.tsx`.

---

## Fase 8 — Detalle (Completada)

- **8A. Paginación por Cursor en Sync & Visor de Auditoría de Kardex:**
  - Paginación recursiva con cursor (`start_cursor`) en `functions/api/inventory/sync.js` (cota defensiva de 500 registros y pausa de 80ms contra rate-limit de Notion).
  - Endpoint serverless `functions/api/kardex/list.js` con filtros por material (`dashboardId`), folio OAB y tipo de movimiento.
  - Servicio `src/services/kardexService.ts` con reconstrucción matemática de saldos históricos hacia atrás (`saldo_anterior`).
  - Modal denso `src/components/KardexViewerModal.tsx` con acceso dual (botón en cabecera y botón por fila en tabla), filtros, búsqueda reactiva y lightbox de comprobantes.
- **8B. Almacenamiento Pericial en Cloudflare R2 y Resiliencia Offline:**
  - Compresión pericial en cliente (`src/utils/imageCompressor.ts`: máx 1600px, JPEG 80%, reducción ~85% del peso).
  - Endpoint serverless `functions/api/storage/upload.js` conectado al bucket Cloudflare R2 `sanesca-evidencias` con clave canónica `evidencias/oab/{folioOAB}/{cleanNota}.jpg`.
  - Propiedad de tipo `files` (`Comprobante`) en `BD_Kardex_Movimientos` de Notion para enlazar la URL pública inmutable de R2.
  - Sincronizador offline `src/services/offlineReceptionStorage.ts` en 2 pasos: primero sube foto a R2, luego registra en Notion y purga inmediatamente el Base64 de IndexedDB.
- **8C. Valuación por Costo de Reposición Dual y Alerta de Sobrecosto:**
  - Modelo contable de Costo de Reposición (última compra conforme) que actualiza atómicamente `Costo_Unitario_Base_USD` en `BD_Materiales_Insumos`.
  - Denominación bimonetaria sincronizada (USD Neto + Bs a Tasa BCV del día) en `src/components/ReceptionTerminalModal.tsx`.
  - Detección de sobrecosto (>5% vs cotizado por Magaly en OAB) con badge ámbar visual y estampa pericial `[⚠️ SOBRECOSTO +X%]` en `Detalle (ext)` de Kardex sin bloquear la rampa de descarga.
- **8D. Alertas Automatizadas por Telegram Bot en Operaciones:**
  - Helper serverless `functions/api/telegram/notify.js` con timeout defensivo `AbortController` (3.5s) y parse mode HTML.
  - Disparo bimonetario ante emisión de OAB en `functions/api/oab/create.js` hacia el canal oficial de planta (`-1003139956223`).
  - Disparo condicional ante incidencias operativas en rampa (rechazos, faltantes y sobrecostos) en `functions/api/oab/receive.js` con deep-links interactivos al visor de Kardex.
---

## Fase 9 — Detalle: Consumo en Taller, Mermas BOM, Guardián y Hardening

### Sub-fase 9A: Terminal de Despacho Físico a Taller (✅ Completada y Desplegada en Producción)
- **Estandarización Canónica Notion ↔ Odoo 18:** Actualización de 22 bases de datos en Notion API con nomenclatura unificada (`BD_*`), descripciones técnicas en el esquema y desacoplamiento estricto entre catálogo maestro (`BD_Catalogo_Insumos`), existencias físicas (`BD_Control_Stock_Existencias`) y libro mayor (`BD_Kardex_Movimientos`).
- **Hotfix de Ingesta y Buscador de Pedidos:** Eliminación definitiva de clones `ORD-000` mediante endpoint serverless `/api/orders/active.js` con hidratación concurrente de relaciones de Notion (`BD_Clientes`, `BD_Proyectos`), resolviendo nombres reales de tienda (ej: `GARMIN-BELLO-CAMPO`, `EPA-4049205-T04`).
- **Terminal de Despacho Físico a Taller (`MaterialDispatchModal.tsx`):**
  - Acceso dual desde botón industrial en cabecera ("Despacho a Taller") y botón directo por fila en `InventoryTable.tsx`.
  - Imputación en 3 niveles de ingeniería industrial: General Planta (MTS), Tienda / Obra (MTO con selector obligatorio Presupuestado vs No Presupuestado), y Mobiliario Específico (BOM MTO).
  - Desglose de piezas de mobiliario en tiempo real vía `/api/orders/lines.js`.
- **Backend Transaccional Serverless (`/api/kardex/dispatch.js`):**
  - Decremento atómico del `Stock (base)` en `BD_Control_Stock_Existencias`.
  - Creación de asiento inmutable `🔴 Salida a Producción` en `BD_Kardex_Movimientos` con vinculación nativa a la orden en `BD_Pedidos`.
  - Alerta instantánea en Telegram (`@sanesca_produccion_bot`) reportando salida, operario receptor, destino y motivo.
- **Validación E2E y PVVN:** Despliegue en Cloudflare Pages (`https://sanesca-inventario.pages.dev/`), pruebas E2E con `chrome-devtools-mcp` y capturas periciales archivadas en `07_Evidencias_Visuales/`.

### Sub-fases 9B, 9C y 9D (⏳ Planificadas / Backlog)
- **9B. Conciliador de Mermas BOM:** Comparación matemática entre materiales retirados y recetas en `BD_Materiales_Requeridos` (`3df86805`), con alertas de desviación >5% y asiento pericial `⚠️ Merma Extraordinaria`.
- **9C. Guardián Autónomo Telegram (Cron):** Cloudflare Cron Trigger (07:00 AM VET) con briefing matutino proactivo de insumos bajo punto de reorden sin OAB activa.
- **9D. Cierre Fiscal SENIAT & Resiliencia:** Modal de cierre de Factura Fiscal y retenciones de IVA/ISLR, filtro `Estado != 'Recibido'` en `sync.js`, cursor en `KardexViewerModal.tsx`, backoff exponencial en `offlineReceptionStorage.ts` y hardening estricto de secretos.

---

## Fase 10 — Detalle (✅ Completada y Desplegada en Producción)

- **10A. RBAC Descentralizado en Notion (Cero Código):**
  - Matriz de permisos anclada en `Puestos de trabajo` (`2b7f9d6e`) mediante la propiedad `Permisos_App` (`Revisar_OAB`, `Recepcion_Rampa`, `Auditoria_Kardex`, `Emitir_OAB`, `Superadmin`).
  - Mikel Itriago configurado como único `Superadmin`. Unión aditiva de permisos para colaboradores con múltiples cargos.
  - Propiedad `PIN_App` en `DB_Lista de empleados` (`18a86805`) para terminales de PC.
- **10B. Backend Serverless de Autenticación Criptográfica:**
  - `functions/api/auth/telegram-verify.js`: Validación de firma HMAC-SHA256 con Web Crypto nativo y ventana anti-replay de 24h.
  - `functions/api/auth/pin-verify.js`: Validación segura de credenciales para PC con emisión de JWT HS256 y bloqueo de fuerza bruta (3 fallos = 10 min).
  - `functions/api/auth/employees.js`: Directorio de colaboradores con filtro estricto por `Areas` vinculadas.
  - `functions/api/auth/_utils.js`: Helpers de firmado y verificación criptográfica JWT y HMAC.
- **10C. Frontend React & Guardián Zero Trust:**
  - Hook `src/hooks/useTelegramAuth.ts` con detección de entorno Telegram Mini App vs navegador de PC.
  - Modal `PinLoginModal.tsx` con combobox de autocompletado en tiempo real, keypad táctil, soporte de teclado físico y temporizador regresivo de bloqueo.
  - Modal `AccessDeniedModal.tsx` con botón interactivo de contacto a Sistemas (`@cazx008`).
  - Protección de rutas para modales restringidos (`OABReviewModal`, `ReceptionTerminalModal`, `KardexViewerModal`).
- **10D. Botonera Dual y Despliegue en Vivo:**
  - Integración de botones interactivos duales en alertas de Telegram (`web_app` para Telegram, enlace HTTP para navegadores).
  - Desplegado y verificado en producción en Cloudflare Pages (`https://sanesca-inventario.pages.dev/`).
- **10E. Protocolo 2FA Interactivo por Telegram para PIN y Sesión Temporal (✅ Desplegado):**
  - Cero modificación/asignación de PIN en frontend sin confirmación previa del Superadmin.
  - Botón contextual en PC que despacha ticket efímero a Upstash Redis y alerta interactiva al chat privado de Mikel (`1143226405`).
  - Botones inline remotos: `[ ✅ Aprobar modificar PIN ]`, `[ 🔑 Aprobar introducir PIN ]`, `[ ⏱️ Aprobar sesión temporal ]` y `[ ❌ Rechazar ]`.
  - Nonce criptográfico `oneTimeToken` con destrucción inmediata (*burn-after-reading*) consumido por `functions/api/auth/pin-update.js`.
- **10F. Sistema de Auditoría Forense, Telemetría Avanzada y Anti-Fuerza Bruta (✅ Desplegado):**
  - Arquitectura híbrida: Buffer caliente en Upstash Redis (<20ms) y persistencia permanente asíncrona (`ctx.waitUntil`) en `BD_Auditoria_Accesos_Logs` (`3ec86805`) de Notion.
  - Telemetría avanzada: captura de IP (`CF-Connecting-IP`), Ciudad/País Cloudflare, CF-Ray, User-Agent, contador de intentos en 24h y bandera `⚠️ HORARIO_INUSUAL`.
  - Bloqueo temporal de 10 min al 3er fallo consecutivo de PIN con alerta push de emergencia a Mikel y botón inline `[ 🔓 Desbloquear Inmediatamente ]`.
  - Modal denso integrado en Dashboard `AccessAuditModal.tsx` exclusivo para Superadmin con KPIs, filtros por categoría, búsqueda en vivo y exportación CSV.

---

## Fase 9E — Cierre de Ciclo BOM, Costos USD y Transaccionalidad ERP (✅ Desplegada y Certificada)

- **9E.1. Enriquecimiento de Costos Base USD (`BD_Catalogo_Insumos`):**
  - Script `scripts/enrich-insumos-costs.cjs` para conciliación cruzada de 3 fuentes (compras en `BD_Lineas_Abastecimiento`, catálogo físico `inventory.json` y precios de mercado).
  - 441/441 insumos enriquecidos con `Costo_Unitario_Base_USD` en Notion. Recompilación automática de `bom_index_optimized.json` erradicando costos $0.00 en la auditoría.
- **9E.2. Endpoint Serverless de Cierre Transaccional (`order-close-audit.js`):**
  - Mutación atómica en `BD_Pedidos`: transición de orden a `Cerrado`, dictamen (`CONFORME` / `DESVIACION_ACEPTADA`), merma porcentual y varianza monetaria USD.
  - Asiento forense inmutable en `BD_Auditoria_Accesos_Logs` con snapshot de reglas aplicadas y justificación de supervisor.
  - Reingreso contable automático de retazos útiles ($\ge 1.0\text{ m}$) a `BD_Kardex_Movimientos` (`ENTRADA / REINTEGRO_RETAZO_UTIL`) incrementando stock físico y deduciendo costo de merma.
- **9E.3. Matriz Dinámica de Tolerancias y Dictamen Visual:**
  - Selector de tolerancias configurables (5% Tornillería, 8% Perfiles, 10% Maderas, 12% Pintura/Foráneos) y override de obra en Notion (`Tolerancia_Especial_Obra_Pct`).
  - Dictamen dinámico (`🟢 CONFORME` vs `🔴 DESVIACIÓN`) con segregación de causas (varianza neta vs mermas críticas individuales).
  - Submodal de liquidación previa con resumen financiero y exigencia de PIN de supervisor (`1234`) ante desviaciones.
- **9E.4. Blindaje Operativo en Terminal de Despacho (`MaterialDispatchModal.tsx`):**
  - Bloqueo disuasivo de entregas para órdenes concluidas (`estado === 'Cerrado'`) con bypass de excepción por PIN de supervisor.
  - Alerta temprana ámbar preventiva al superar el 115% de la receta teórica con flag `[SOBRECONSUMO_BOM_115%]` en Kardex y Telegram.
  - Validación en caliente de justificación obligatoria ($\ge 15$ caracteres) con contador dinámico para insumos no presupuestados.
- **9E.5. Formato Carta para Impresión Formal (`PrintSheetBOMAudit.tsx`):**
  - Hoja de liquidación `@media print` en una página Letter, desglose cuantitativo y 4 cuadrantes de firmas físicas (Ingeniería, Taller, Almacén, Auditoría).

---

## Fase 9F — Conteo Cíclico en Vivo, Ajustes Físico-Financieros y Kardex Odoo 18 (✅ Desplegada y Certificada)

- **9F.1. Backend Serverless Transaccional (`functions/api/kardex/adjust.js`):**
  - Modelo canónico Odoo 18: `stock.quant` ➔ `stock.move` ➔ `account.move` ➔ `ir.logging`.
  - Mutación atómica en `BD_Control_Stock_Existencias`: recalculo de `Stock (base)`, `Déficit`, `Estado` y sellado de fecha de reconteo (`Se Recontó Hoy`, `Fecha Último Reconteo`).
  - Asiento de doble partida condicional en `BD_Kardex_Movimientos`: si $\Delta \ne 0$, genera asiento `AJUSTE_INVENTARIO` (`🟢 Entrada por Ajuste` o `🔴 Salida por Merma/Ajuste`) con valuación bimonetaria ($ USD y Bs BCV a tasa oficial).
  - Si $\Delta = 0$ (conteo conforme), **no genera asiento en Kardex** para evitar polución de datos; asienta evento inmutable `INVENTORY_COUNT_VERIFIED` en `BD_Auditoria_Accesos_Logs`.
  - Pista forense en Redis y Notion con metadata completa: operador, insumo, discrepancia física, impacto financiero y justificación técnica.
- **9F.2. Modal Táctil Industrial y Reactividad Optimista (`StockAdjustmentModal.tsx`):**
  - Acceso global desde cabecera (`[ ⚖️ Conteo / Ajuste ]`) y contextual desde cada fila de la tabla (`[ ⚖️ ]` y celda `Reconteo 3D`).
  - Buscador combobox reactivo con autocompletado y listado de existencias en tiempo real.
  - Formulario con 5 motivos estandarizados Odoo 18 (`STOCK_ADJUSTMENT_REASONS`) y campo obligatorio de justificación técnica ($\ge 10$ caracteres).
  - Protocolo de supervisión estricto: descalces $> 5$ unidades o impacto $> \$5.00$ USD exigen PIN de supervisor (`1234`). Detección automática y bypass transparente para sesiones activas de rango de mando (Supervisor / Superadmin Mikel Itriago).
  - Mutación reactiva optimista instantánea: actualiza el stock, déficit, KPIs y badge de reconteo en pantalla en milisegundos sin esperar la respuesta remota de Notion.
  - Blindaje Zero Trust RBAC: guardián estricto para perfiles sin permiso `Auditoria_Kardex` o `Superadmin` con despliegue de `AccessDeniedModal`.

---

## Archivos del proyecto

| Archivo / Carpeta | Descripción |
|:------------------|:------------|
| `src/App.tsx` | Componente raíz: orquestador de estado, KPIs dinámicos, ordenamiento y modales |
| `src/components/Header.tsx` | Cabecera industrial con logo contrast plate, tasa BCV, sync badge, botón de auditoría y hubs de acción |
| `src/components/KpiCards.tsx` | 5 tarjetas de KPI semáforo con filtrado reactivo e indicador lateral de 4px |
| `src/components/FilterBar.tsx` | Búsqueda, vistas, selector de columnas, orden multi-nivel y chips de estado |
| `src/components/InventoryTable.tsx` | Tabla densa con 21 columnas, monospace para números, zebra stripes y señales |
| `src/components/GlossaryModal.tsx` | Glosario operativo colapsable con definiciones, leyenda y guía de uso |
| `src/components/SupplyOrderModal.tsx` | Modal de emisión de OAB con precarga de déficit, empaque comercial y selector ERP |
| `src/components/OrderSearchModal.tsx` | Buscador modal de órdenes/obras de Notion ERP (D42) |
| `src/components/OABReviewModal.tsx` | Modal de revisión de OAB: transcripción manuscrita de Magaly y cotización de Compras |
| `src/components/PrintSheetOAB.tsx` | Plantilla formal imprimible con QR y cuadrantes de visto bueno manuscrito |
| `src/components/ReceptionTerminalModal.tsx` | Terminal táctil de rampa para conteo físico, fotos de guía, backorders, Tasa BCV y Kardex |
| `src/components/MaterialDispatchModal.tsx` | Modal táctil de despacho a taller: imputación en 3 niveles (MTS, MTO Tienda, MTO BOM) con decremento de stock y conmutador de empaque |
| `src/components/OrderBOMAuditModal.tsx` | Modal de auditoría ex-post de mermas: balance de insumos (Teórico Valery vs Kardex Real) por pedido/tienda, KPIs monetarios, declaración de retazos e impresión |
| `src/components/KardexViewerModal.tsx` | Visor denso de auditoría de Kardex con reconstrucción histórica y lightbox de comprobantes R2 |
| `src/components/PinLoginModal.tsx` | Modal de acceso para terminales de PC con combobox autocompletado en tiempo real, keypad táctil y flujo 2FA |
| `src/components/AccessDeniedModal.tsx` | Pantalla de bloqueo Zero Trust con botón de contacto interactivo a Sistemas (Mikel) |
| `src/components/AccessAuditModal.tsx` | Visor denso de auditoría de accesos y telemetría para Superadmin con KPIs y exportación |
| `src/components/StockAdjustmentModal.tsx` | Modal táctil de Conteo Cíclico y Ajustes de Kardex (Fase 9F) con calculadora bimonetaria y motivos Odoo 18 |
| `src/types/adjustment.ts` | Tipos TypeScript de ajustes de stock, contratos de payload y motivos estandarizados Odoo 18 |
| `src/hooks/useTelegramAuth.ts` | Hook de autenticación híbrida: Telegram WebApp HMAC + PIN sesión PC |
| `src/services/inventoryService.ts` | Servicio de carga de inventario, enriquecimiento SWR en vivo y tasa BCV |
| `src/services/oabService.ts` | Servicio cliente de emisión de OAB, transcripción gerencial y recepciones |
| `src/services/kardexService.ts` | Servicio cliente de consulta de Kardex, retro-cálculo y registro de ajustes de inventario |
| `src/services/offlineReceptionStorage.ts` | Servicio de persistencia local IndexedDB para recepciones offline en rampa con drenador R2 |
| `src/utils/imageCompressor.ts` | Utilidad Canvas para compresión pericial de fotografías en cliente (máx 1600px, JPEG 80%) |
| `functions/api/auth/telegram-verify.js` | Cloudflare Pages Function: validación criptográfica HMAC-SHA256 de initData y RBAC Notion |
| `functions/api/auth/pin-verify.js` | Cloudflare Pages Function: validación de PIN operativo en PC, rate limiting y emisión de sesión JWT |
| `functions/api/auth/pin-request.js` | Cloudflare Pages Function: generación de tickets 2FA y despacho de alertas interactivas a Mikel |
| `functions/api/auth/pin-request-status.js` | Cloudflare Pages Function: consulta de polling suave (2s) sobre estado de ticket 2FA en Redis |
| `functions/api/auth/pin-update.js` | Cloudflare Pages Function: persistencia atómica de nuevo PIN en Notion con nonce burn-after-reading |
| `functions/api/auth/employees.js` | Cloudflare Pages Function: consulta de empleados filtrados por Areas y departamentos |
| `functions/api/auth/_utils.js` | Utilidades criptográficas: firmado y verificación HS256 JWT y verificación HMAC Telegram |
| `functions/api/auth/_audit.js` | Módulo serverless de telemetría y auditoría: Redis buffer + ctx.waitUntil hacia Notion |
| `functions/api/auth/audit-logs.js` | Cloudflare Pages Function: consulta paginada de logs de auditoría y métricas de seguridad |
| `functions/api/notion/[[path]].js` | Cloudflare Pages Function: proxy seguro Notion API con secretos de entorno |
| `functions/api/_kv.js` | Helper modular Cloudflare KV (`INVENTORY_KV`) para gestión de deltas en caliente sin consumo de Redis |
| `functions/api/inventory/sync.js` | Cloudflare Pages Function: SWR Edge KV sync de deltas en caliente y cálculo dinámico de insumos en tránsito |
| `functions/api/kardex/list.js` | Cloudflare Pages Function: consulta paginada y filtrada del histórico de Kardex |
| `functions/api/kardex/dispatch.js` | Cloudflare Pages Function: decremento atómico de stock, asiento de salida a taller en Kardex y alerta Telegram |
| `functions/api/kardex/adjust.js` | Cloudflare Pages Function: ajuste atómico Odoo 18 en existencias, doble partida en Kardex y pista forense |
| `src/components/PrintSheetBOMAudit.tsx` | Plantilla formal imprimible Carta de auditoría BOM con 4 cuadrantes de firmas y balance de mermas |
| `functions/api/bom/order-balance.js` | Cloudflare Pages Function: balance matemático ex-post de pedido (BOM Teórico vs Kardex Real) con segregación de especiales |
| `functions/api/bom/order-close-audit.js` | Cloudflare Pages Function: liquidación y cierre formal en Notion ERP (`BD_Pedidos`), log forense y reintegro contable de retazos en Kardex |
| `scripts/enrich-insumos-costs.cjs` | Script de enriquecimiento de costos en USD de insumos cruzando compras de abastecimiento y catálogo físico |
| `src/data/bom_index_optimized.json` | Índice precompilado de despiece industrial Valery (956 muebles, 198 insumos, 10,111 renglones, 214 KB) |
| `functions/api/orders/active.js` | Cloudflare Pages Function: consulta e hidratación concurrente de pedidos activos con clientes y proyectos |
| `functions/api/orders/lines.js` | Cloudflare Pages Function: consulta reactiva de líneas de mobiliario (BOM) asociadas a un pedido |
| `functions/api/storage/upload.js` | Cloudflare Pages Function: subida pericial de imágenes a Cloudflare R2 (`sanesca-evidencias`) |
| `functions/api/telegram/notify.js` | Cloudflare Pages Function: despachador de alertas a Telegram Bot con timeout y deep-links |
| `functions/api/oab/create.js` | Cloudflare Pages Function: creación atómica de OAB, líneas en Notion y alerta Telegram |
| `functions/api/oab/details.js` | Cloudflare Pages Function: consulta de detalle y líneas de una OAB para revisión |
| `functions/api/oab/review.js` | Cloudflare Pages Function: asentamiento de aprobación gerencial y cotización |
| `functions/api/oab/receive.js` | Cloudflare Pages Function: asiento atómico de recepción, Kardex, Costo Reposición y alerta |
| `functions/api/bcv/rate.js` | Cloudflare Pages Function: consulta y caché de tasa oficial BCV |
| `index.html` | Entry point HTML para Vite con tipografías Geist y Geist Mono |
| `index.html.vanilla.bak` | Respaldo del prototipo vanilla original |
| `DESIGN.md` | Sistema de diseño "La Terminal de Almacén" |
| `PRODUCT.md` | Contexto de producto y directrices de diseño |
