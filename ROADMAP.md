# Roadmap — Dashboard de Inventario Sanesca

> Resumen ejecutivo del roadmap. El plan original completo (v3) con diagramas Mermaid, decisiones cerradas, riesgos y estructura de archivos está preservado en [`docs/PLAN_v3_original.md`](docs/PLAN_v3_original.md).

## Estado de Fases

| Fase | Estado | Descripción |
|:-----|:-------|:------------|
| **Pre-Fase 0** | ✅ Completada | Rollups de Notion (relaciones, cálculos) |
| **Fase 1** | ✅ Completada | Diseño visual con StitchMCP |
| **Fase 2** | ✅ Completada | Script extractor con resolución de relaciones |
| **Fase 3** | ✅ Completada | Frontend core: tabla, filtros, agrupación, KPIs, glosario |
| **Fase 3.5** | 🔄 En progreso | Integración Impeccable (auditoría y refinamiento visual) |
| **Fase 4** | ⏳ Pendiente | Pipeline CI/CD (Worker + GitHub Actions + Trigger Notion) |
| **Fase 5** | ⏳ Pendiente | Validación E2E y cierre |

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

## Fase 3.5 — Integración Impeccable (En progreso)

Ver plan detallado en artefacto `implementation_plan.md` de la sesión actual.

---

## Fase 4 — Pipeline CI/CD (Pendiente)

### Componentes
1. **Cloudflare Worker `sanesca-sync`:**
   - Endpoint que ejecuta el fetch desde Notion API
   - Transforma y genera `inventory.json` + `meta.json`
   - Hace commit al repositorio via GitHub API

2. **GitHub Actions workflow `.github/workflows/sync-inventory.yml`:**
   - Trigger: `workflow_dispatch` (manual) + `repository_dispatch` (desde Worker)
   - Steps: checkout → ejecutar fetch-inventory.js → commit/push data/ → deploy Pages

3. **GitHub Secrets requeridos:**
   - `SANESCATOKEN` (Notion API token)
   - `CF_ACCOUNT_ID` (Cloudflare)

4. **Trigger desde Notion:**
   - Botón/automatización en Notion que invoca el Worker
   - **Restricción del usuario:** El disparador NO debe estar en la web visible al gerente

### Credenciales disponibles
- Cloudflare Account ID: `98ee9f66220ad7147392ace5bb911953`
- SANESCATOKEN: Configurado como variable de entorno
- BD Dashboard ID: `2b586805-4e27-80fe-b6e8-e4c6dc325696`

### Pendiente
- Verificar permiso `actions:write` en el PAT de GitHub existente

---

## Fase 5 — Validación E2E y Cierre (Pendiente)

1. Desplegar a GitHub Pages
2. Verificación HTTP con Chrome DevTools MCP
3. Captura de pantalla del sitio desplegado (PVVN del PDICL)
4. Test de navegación cruzada (links a Cortes Eléctricos y Medidas Operativas)
5. Test de sincronización manual end-to-end
6. Walkthrough final documentado

---

## Archivos del proyecto

| Archivo | Descripción |
|:--------|:------------|
| `index.html` | Dashboard principal (~1078 líneas) |
| `scripts/fetch-inventory.js` | Extractor Notion → JSON (~465 líneas) |
| `data/inventory.json` | Datos de inventario (131 ítems) |
| `data/meta.json` | Metadata de sincronización |
| `PRODUCT.md` | Contexto de producto (Impeccable init) |
| `assets/logo-sanesca.svg` | Logo corporativo |
