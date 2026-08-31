---
name: Dashboard de Inventario Sanesca
description: Panel de control de inventario de materiales para la Gerencia de Operaciones
colors:
  page-deep: "#0F172A"
  surface-slab: "#1E293B"
  surface-raised: "#1C2B3C"
  surface-top: "#273647"
  border-wire: "#334155"
  terminal-green: "#4EDEA3"
  terminal-green-mid: "#10B981"
  terminal-green-deep: "#059669"
  signal-red: "#EF4444"
  signal-orange: "#F59E0B"
  signal-yellow: "#EAB308"
  signal-blue: "#3B82F6"
  signal-purple: "#8B5CF6"
  text-primary: "#F1F5F9"
  text-secondary: "#94A3B8"
  text-muted: "#64748B"
  text-dim: "#475569"
typography:
  body:
    fontFamily: "Geist, Inter, system-ui, -apple-system, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist, Inter, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.05em"
  mono:
    fontFamily: "Geist Mono, JetBrains Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-toolbar:
    backgroundColor: "{colors.page-deep}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  button-toolbar-active:
    backgroundColor: "{colors.page-deep}"
    textColor: "{colors.terminal-green}"
  button-reset:
    backgroundColor: "{colors.page-deep}"
    textColor: "{colors.signal-red}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  badge-status:
    rounded: "{rounded.sm}"
    padding: "2px 6px"
  input-search:
    backgroundColor: "{colors.page-deep}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "6px 32px 6px 8px"
  kpi-card:
    backgroundColor: "{colors.surface-slab}"
    rounded: "{rounded.md}"
    padding: "12px"
---

# Design System: Dashboard de Inventario Sanesca

## Overview

**Creative North Star: "La Terminal de Almacén"**

Como la pantalla de un depósito: denso, mono, oscuro, operativo. Información a distancia de un vistazo. La interfaz existe para ser consultada, no para ser admirada. Cada píxel tiene un propósito funcional: un número, un estado, una prioridad. Los colores son señales, no decoración — rojo es peligro real, verde es suficiencia confirmada.

El dashboard respira densidad operativa. Es una hoja de cálculo con superpoderes: las mismas 19 columnas que el gerente ya conoce de su base de datos, pero con semáforos, badges y KPIs que Notion no puede mostrar. El tema oscuro no es una elección estética; es la pantalla que el supervisor ve en el almacén bajo luz artificial, o el gerente en su oficina a las 7 AM revisando qué necesita reposición urgente.

Los componentes son táctiles y confiados — se sienten sólidos al hacer clic, no débiles ni temblorosos. Un botón de filtro presionado se siente como accionar un interruptor industrial: respuesta inmediata, feedback visual claro, sin animaciones innecesarias.

**Key Characteristics:**
- Densidad máxima: más datos visibles por píxel que cualquier alternativa
- Colores semánticos operativos: cada color es una señal, no un adorno
- Monospace para números: legibilidad de hoja de cálculo
- Interacciones industriales: respuesta directa, sin duda, sin delay
- Accesibilidad en condiciones de campo: contraste alto sobre fondo oscuro

## Colors

Una paleta cromática funcional donde cada color es una señal operativa. La base es azul-pizarra profundo (slate) para reducir fatiga visual en uso prolongado; los acentos son exclusivamente semánticos.

### Primary
- **Terminal Green** (#4EDEA3): Acento de interfaz. Indica elemento activo, selección confirmada, sort activo, link de acción. Usado con parsimonia: solo sobre lo que el usuario está haciendo ahora.
- **Terminal Green Mid** (#10B981): Estado "En Stock" — el material está bien. También usado en el indicador de conexión (pulse dot del sync badge).
- **Terminal Green Deep** (#059669): Hover del acento primario. No se usa como texto por contraste insuficiente sobre oscuro.

### Neutral
- **Page Deep** (#0F172A): Fondo de la página y de inputs/controles incrustados. El negro más profundo de la interfaz.
- **Surface Slab** (#1E293B): Superficie principal: toolbar, tabla, cards, paneles dropdown. Un escalón sobre la página.
- **Surface Raised** (#1C2B3C): Superficie elevada: header del glosario, group header en tabla. Sutil diferenciación tonal.
- **Surface Top** (#273647): Máxima elevación tonal. Hover sobre filas, superficie de controles activos.
- **Border Wire** (#334155): Bordes sutiles. Visible pero no protagónico. Separa sin cortar.
- **Text Primary** (#F1F5F9): Texto principal — nombres de productos, valores numéricos destacados, títulos.
- **Text Secondary** (#94A3B8): Texto de soporte — labels de toolbar, conteos, descripciones.
- **Text Muted** (#64748B): Texto terciario — placeholders, ayudas, pistas contextuales.
- **Text Dim** (#475569): Texto casi invisible — separadores textuales, secciones uppercase.

### Named Rules
**The Signal-Only Color Rule.** Fuera de la escala de grises (slate), el color solo aparece para comunicar estado operativo. Rojo = peligro, naranja = precaución, verde = nominal, azul = proceso, púrpura = auditoría. El verde de acento (#4EDEA3) es la única excepción: indica "elemento activo de interfaz", no un estado de datos.

## Typography

**Body Font:** Geist (with Inter, system-ui fallback)
**Mono Font:** Geist Mono (with JetBrains Mono, ui-monospace fallback)

**Character:** La pareja Geist + Geist Mono es la voz tipográfica de una terminal moderna. Geist aporta legibilidad neo-grotesca para labels y texto; Geist Mono da la cadencia de hoja de cálculo a los números. No hay font display — las jerarquías se resuelven con peso y tamaño, nunca con una fuente decorativa.

### Hierarchy
- **Title** (700, 16-18px, 1.3): Título del dashboard en el header. Único uso.
- **Body** (400, 14px, 1.5): Texto estándar de tabla. Celdas de datos textuales.
- **Label** (600, 11px, 1.2, tracking 0.05em): Sección headers, category labels, toolbar buttons. Siempre uppercase.
- **Caption** (400-500, 10-11px, 1.3): Badges, conteos, tooltips, guía rápida. El texto más pequeño del sistema.
- **Mono** (400, 12px, 1.4): Números en tabla (stock, mínimo, déficit, código SKU, días). Alineación decimal visual.

### Named Rules
**The Mono Numbers Rule.** Todo valor numérico y todo código alfanumérico usa `font-mono`. Sin excepción. Esto alinea visualmente las columnas numéricas como una hoja de cálculo real.

## Layout

La interfaz es una columna vertical centrada con ancho máximo de 1600px. El flujo es estrictamente lineal: Header → KPIs → Toolbar → Tabla → Glosario → Footer. No hay sidebar, no hay columnas laterales, no hay split-view.

El grid de KPIs es el único layout multi-columna: 2 cols en móvil, 3 en tablet, 5 en desktop. La tabla ocupa el ancho completo con scroll horizontal en pantallas pequeñas. El contenedor principal tiene padding `px-4 sm:px-6` y spacing vertical `space-y-4` (16px) entre secciones.

Los breakpoints se resuelven via Tailwind responsive: `sm:` (640px), `md:` (768px), `lg:` (1024px). No hay breakpoint personalizado. En mobile, la toolbar apila en `flex-wrap` y la navegación cruzada se oculta (`hidden sm:inline-flex`).

## Elevation & Depth

**Flat-tonal system.** No hay box-shadows funcionales en el contenido. La profundidad se comunica exclusivamente a través del escalamiento tonal de superficies: `page-deep` → `surface-slab` → `surface-raised` → `surface-top`. Cada escalón es ~8-12% más claro en lightness.

Las únicas shadows del sistema son:
1. **Logo contrast plate** (`0 0 0 1px rgba(255,255,255,0.15), 0 2px 8px rgba(0,0,0,0.4)`): Placa blanca que sostiene el logo sobre fondo oscuro.
2. **Panel dropdown** (`0 10px 25px rgba(0,0,0,0.5)`): Menus flotantes de filtros, sort y columnas. Shadow pronunciado para separar claramente del contenido de tabla debajo.

### Named Rules
**The Flat-By-Default Rule.** Las superficies son planas en reposo. La shadow solo aparece en elementos que flotan sobre otros (dropdowns, modals). Los hover states cambian background-color, nunca agregan sombra.

## Shapes

Bordes rectos con esquinas redondeadas funcionales. Radio `8px` (md) para contenedores y botones — suficiente para suavizar sin perder la geometría industrial. Radio `4px` (sm) para badges y chips — más compactos, más densos.

Los bordes (`1px solid border-wire`) son omnipresentes: separan celdas, delimitan paneles, enmarcan inputs. El borde izquierdo de 4px en KPI cards usa el color de su señal (rojo, naranja, verde, azul, púrpura) como indicador visual lateral — una barra de alerta vertical.

Las filas de peligro tienen `border-left: 3px solid signal-red` y fondo tenue `rgba(239,68,68,0.08)`.

## Components

### Buttons
- **Shape:** Esquinas suavizadas (8px radius)
- **Toolbar:** `bg-page-deep` con borde `border-wire`, texto `text-secondary`. Padding `6px 12px`. Fuente 12px weight 500.
- **Hover:** Texto aclara a `text-primary`, borde a `slate-500`. Transición CSS `transition` estándar.
- **Active state:** Cuando el control tiene filtros/sorts activos, el borde cambia a `terminal-green` y el texto a `terminal-green` (tinted state).
- **Reset:** Misma forma que toolbar pero tinted en rojo cuando hay filtros activos: `text-red-400 border-red-500/40`. Deshabilitado como `text-slate-500 cursor-not-allowed`.

### Badges (Status/Priority)
- **Shape:** Rectángulo compacto (4px radius), `padding 2px 6px`, fuente 10px weight 500.
- **Inactive (quick filter off):** Transparente con borde `border-wire`, texto `text-secondary`.
- **Active:** Fondo tenue del color de señal al 15% opacidad, borde sólido del color, texto en tono claro del color. Cada color de señal tiene su clase: `badge-active-red`, `badge-active-green`, etc.
- **In-cell (table):** Mismo estilo pero sin borde, solo fondo tenue + texto coloreado.

### Input (Search)
- **Style:** `bg-page-deep`, borde `border-wire`, radius 6px. Ícono 🔍 posicionado absolutamente a la izquierda.
- **Focus:** Borde cambia a `terminal-green` (`focus:border-brand-400`). Sin ring externo, sin glow.
- **Placeholder:** `text-slate-500`, desaparece al escribir.

### KPI Cards
- **Shape:** `bg-surface-slab`, borde `border-wire`, radius 8px. Borde izquierdo de 4px en color de señal.
- **Interior:** Label 12px `text-secondary` en la línea superior. Número 24px bold en color de señal en la línea inferior.
- **Grid:** 2 columnas mobile, 3 tablet, 5 desktop. Última card (Auditados 3D) ocupa `col-span-2` en mobile, `col-span-1` en desktop.

### Table
- **Header:** Sticky, fondo `surface-slab`, texto 11px uppercase tracking-wider `text-slate-400`. Click para sort (cursor pointer).
- **Rows:** Zebra stripes alternando `page-deep` y `#131D2E`. Hover: `surface-top/50`.
- **Danger row:** Stock = 0 → fondo rojo tenue + borde izquierdo rojo 3px.
- **Warning row:** Semáforo naranja → fondo naranja tenue + borde izquierdo naranja 3px.
- **Celdas:** Bordes derechos sutiles (`border-wire/30`), padding `12px`. Texto tamaño body o xs según tipo.

### Dropdown Panel
- **Shape:** `bg-surface-slab`, borde `border-wire`, radius 8px.
- **Shadow:** `0 10px 25px rgba(0,0,0,0.5)` — shadow pronunciado.
- **Animation:** `x-transition` de Alpine.js (fade + scale, ~150ms).
- **Dismiss:** Click outside (`@click.away`).

### Glossary Toggle
- **Shape:** Botón full-width, fondo `surface-raised/40`, hover `surface-raised`. Borde inferior sutil.
- **Icon + Label:** 📖 + "Glosario y Referencia" + subtítulo `text-slate-500` "Columnas · Leyenda · Guía de uso".
- **Body:** Revela con `x-transition.duration.300ms` (no x-collapse, Alpine core only).

## Do's and Don'ts

### Do:
- **Do** usar `font-mono` para todo valor numérico y código alfanumérico en la tabla.
- **Do** mantener los colores semánticos exactos de Notion (rojo=Sin Stock, naranja=Bajo Mínimo, verde=En Stock, azul=En Reconteo, gris=Descontinuado) sin variación.
- **Do** usar uppercase tracking-wider para section headers y labels de categoría (11px, weight 600, tracking 0.05em).
- **Do** preservar el layout de tabla en mobile — scroll horizontal, nunca cards.
- **Do** comunicar estados activos de controles cambiando borde + texto a `terminal-green` (#4EDEA3).

### Don't:
- **Don't** agregar box-shadow a superficies que no flotan. La profundidad se comunica tonalmente.
- **Don't** usar colores semánticos para decoración. Rojo solo para peligro real, verde solo para stock suficiente o confirmación.
- **Don't** poner enlaces a Notion en el footer ni en ninguna parte visible al usuario final.
- **Don't** usar fuentes display ni pesos por debajo de 400. La jerarquía se resuelve con tamaño y color, no con light/thin.
- **Don't** agregar gradientes, glassmorphism, o efectos visuales decorativos. Es una terminal, no un portfolio.
- **Don't** agregar sidebar, columnas laterales, o split-view. La información fluye en una sola columna vertical.
