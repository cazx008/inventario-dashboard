# Dashboard de Inventario — Sanesca Exhibidores

Tablero web de solo lectura para la Gerencia de Operaciones. Muestra el estado del inventario de materiales de producción extraído desde Notion, con KPIs de stock, filtros avanzados y ordenamiento multi-nivel.

**🌐 Sitio en Vivo:** [cazx008.github.io/inventario-dashboard](https://cazx008.github.io/inventario-dashboard/)

---

## Arquitectura

```
 Notion BD "Dashboard"
        │
        ▼
 GitHub Actions (deploy.yml)
   ├─ npm run build  →  fetch-inventory.js  →  data/inventory.json
   └─ Deploy to GitHub Pages
        │
        ▼
 GitHub Pages (sitio estático)
```

### Triggers de sincronización

| Trigger | Mecanismo |
|---------|-----------|
| **Botón en Notion** | Botón nativo ("Enviar webhook") en la página *Central de Operaciones* → Cloudflare Worker `sanesca-sync` → `repository_dispatch` → GitHub Actions |
| **Cron diario** | GitHub Actions schedule (`1 4 * * *` = 00:01 VET) |
| **Manual** | GitHub Actions `workflow_dispatch` |
| **Push a main** | Cualquier push al branch `main` |

---

## Ejecución Local

### Requisitos

- Node.js ≥ 18
- Token de integración de Notion con acceso a la BD Dashboard

### Instalación

```bash
npm install
```

### Variables de entorno

```bash
# Token de Notion (obligatorio)
export SANESCATOKEN=ntn_xxxxx
# o alternativamente:
export NOTION_TOKEN=ntn_xxxxx

# ID de la BD (opcional, tiene fallback hardcoded)
export NOTION_DASHBOARD_DB_ID=2b586805-4e27-80fe-b6e8-e4c6dc325696
```

### Generar datos

```bash
npm run fetch
# Genera: data/inventory.json + data/meta.json
```

Luego sirve `index.html` con cualquier servidor estático:

```bash
npx serve .
```

---

## Stack

- **Frontend:** HTML estático + [Alpine.js](https://alpinejs.dev/) (CDN) + [Tailwind CSS](https://tailwindcss.com/) (CDN)
- **Extractor:** Node.js + `@notionhq/client`
- **Hosting:** GitHub Pages
- **Webhook Bridge:** Cloudflare Worker (`sanesca-sync`)
- **CI/CD:** GitHub Actions

## Ecosistema Sanesca

| Dashboard | URL |
|-----------|-----|
| 📦 Inventario de Materiales | [inventario-dashboard](https://cazx008.github.io/inventario-dashboard/) |
| ⚡ Monitoreo de Cortes Eléctricos | [sanesca-dashboard](https://cazx008.github.io/sanesca-dashboard/) |
| 🏭 Medidas Operativas | [medidas-operativas](https://cazx008.github.io/medidas-operativas/) |
