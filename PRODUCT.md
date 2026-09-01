# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary — Gerente de Operaciones de Sanesca Exhibidores.** Consulta el dashboard diariamente desde PC de escritorio en oficina durante la jornada laboral. Necesita una vista instantánea del estado de inventario de materiales sin navegar la base de datos de Notion. Toma decisiones de reposición basándose en los KPIs de stock, estado y prioridad.

**Secondary — Supervisores, Compras y Almacenistas.** También consultan desde móvil o tablet en planta/almacén para verificar existencias puntuales y prioridades de compra. No deben acceder ni editar la base de datos fuente.

## Product Purpose

Ofrecer una interfaz de consulta rápida, visual y de solo lectura del inventario de materiales de producción de Sanesca Exhibidores. El dashboard permite identificar inmediatamente qué materiales están sin stock, bajo mínimo o requieren reposición urgente, sin requerir cuenta de Notion, conocimiento de la base de datos, ni permisos de edición.

El éxito se mide en: reducción del tiempo de decisión de reposición, visibilidad instantánea de estados críticos para el gerente, y acceso controlado para roles operativos.

## Positioning

A diferencia de consultar Notion directamente, este dashboard proporciona:
- Indicadores visuales semánticos (KPIs, badges de estado y prioridad con colores de severidad) que no existen en la vista de tabla de Notion
- Control de qué columnas y datos son visibles según el contexto gerencial
- Acceso de solo lectura para personas que no deben ver ni editar la base de datos completa
- Filtros avanzados, agrupación y búsqueda diseñados para el flujo de trabajo de reposición

## Operating Context

El gerente abre el dashboard al inicio de la jornada y durante reuniones de coordinación. Los datos se sincronizan desde la BD de Notion mediante un script Node.js que extrae y transforma los registros a JSON estático. La sincronización no es en tiempo real; se ejecuta manualmente o por pipeline CI/CD. Los materiales están categorizados por proceso productivo, departamento, grupo de proceso y origen de consumo. El inventario incluye ~131 productos activos con 19 propiedades visibles.

## Capabilities and Constraints

**Funcionalidades confirmadas:**
- 19 columnas de datos con filtrado avanzado (propiedad + operador + valor, AND/OR), búsqueda instantánea, ordenamiento multi-nivel (3 niveles), agrupación por categoría
- Vistas compacta (6 columnas: nombre, stock, stock mín., déficit, estado, prioridad) y ampliada (todas), selector de columnas personalizable
- Quick filters via badges de Estado y Prioridad
- KPI cards: Sin Stock, Bajo Mínimo, En Stock, En Reconteo, % Auditados 3D
- Glosario y referencia colapsable con definiciones de columnas, leyenda de estados/prioridades, indicadores visuales y guía de uso
- Navegación cruzada entre dashboards de la empresa (Cortes Eléctricos, Medidas Operativas)

**Restricciones de diseño confirmadas por el usuario:**
- Sin panel lateral (sidebar) — todo en flujo vertical
- Las tablas NO pasan a tarjetas en mobile — se mantienen como tabla con scroll horizontal
- El footer no debe contener enlaces a fuentes de Notion
- El disparador de sincronización no debe estar en la web visible al gerente

**Stack:** HTML estático, Alpine.js (CDN), Tailwind CSS (CDN). Sin framework, sin build step. Servido estáticamente.

## Brand Commitments

- Logo de Sanesca Exhibidores presente en el header (asset existente: `assets/logo-sanesca.png`)
- Identidad visual industrial/operativa: tema oscuro, paleta funcional con semántica de estado (rojo = sin stock, naranja = bajo mínimo, verde = en stock, azul = en reconteo, púrpura = auditado 3D)

## Evidence on Hand

- Base de datos de Notion con ~131 productos activos (BD Dashboard ID: `2b586805-4e27-80fe-b6e8-e4c6dc325696`)
- Script extractor funcional (`scripts/fetch-inventory.js`) que resuelve relaciones y rollups
- JSON de inventario con datos reales en `data/inventory.json`
- Dashboards hermanos ya desplegados: `sanesca-dashboard` (cortes eléctricos), `medidas-operativas`
- No hay testimonios, case studies ni material de marketing — es una herramienta interna operativa

## Product Principles

1. **Visibilidad inmediata:** Un vistazo a los KPIs debe revelar el estado del inventario sin hacer clic ni filtrar.
2. **Densidad operativa:** Mostrar la máxima información útil en el mínimo espacio, como una hoja de cálculo experta, no como una aplicación de consumo.
3. **Acceso sin fricción:** Cualquier persona autorizada puede consultar sin cuenta, login ni conocimiento técnico.
4. **Fidelidad a la fuente:** Los datos reflejan exactamente lo que está en Notion, sin interpretaciones ni cálculos inventados (excepto Déficit = Mín − Stock).
5. **Separación de lectura y escritura:** El dashboard es de solo lectura; las modificaciones se hacen exclusivamente en Notion.

## Accessibility & Inclusion

Los usuarios en planta/almacén pueden consultar en condiciones de iluminación variable (oficina con pantalla, almacén con móvil bajo luz artificial). El tema oscuro debe mantener contraste WCAG AA (≥4.5:1 para texto body, ≥3:1 para texto grande). Las acciones de filtrado y navegación deben ser operables con teclado.
