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

## Archivos del proyecto

| Archivo | Descripción |
|:--------|:------------|
| `index.html` | Dashboard interactivo Alpine.js + Tailwind CSS (~1160 líneas) |
| `scripts/fetch-inventory.js` | Extractor Notion API con resolución de relaciones (~465 líneas) |
| `data/inventory.json` | Datos de inventario procesados |
| `data/meta.json` | Metadata y timestamp de sincronización |
| `worker/src/index.js` | Cloudflare Worker (Webhook bridge) |
| `worker/wrangler.jsonc` | Configuración de despliegue Wrangler |
| `.github/workflows/deploy.yml` | Pipeline CI/CD GitHub Actions |
| `PRODUCT.md` | Contexto de producto y directrices de diseño |
| `DESIGN.md` | Sistema de diseño "La Terminal de Almacén" |
| `assets/logo-sanesca.png` | Logo corporativo Sanesca |
