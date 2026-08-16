# Likida — Sistema de diseño v3

Dirección fijada el **12-ago-2026**, reemplazando la dirección "degradado de
marca" del 7-ago-2026. Javier pidió explícito: **logo negro, ya no paleta
naranja** en los paneles, tipografía más corporativa, y todo compacto.

**Las frases que gobiernan:**
1. Los paneles son NEUTROS — tinta, gris y blanco (`.tema-neutro` en
   globals.css pivota `--marca/--accent/--g1..--g5`); el color solo existe en
   semáforos y estatus. El naranja QUEDA para la marca hacia afuera (login,
   landing, PDF, ads) — no para las consolas.
2. Un contralor debe poder proyectar cualquier pantalla y que se lea como
   estado de cuenta, no como anuncio.

**Tipografía:** Inter para UI (`--font-sans`),
**Inter Tight** para titulares y la cifra de una stat (`.font-display`),
**IBM Plex Mono** para micro-rótulos en mayúsculas y cifras de tabla
(`.etiqueta-mono` / `.cifra-mono`). Las tres cargadas en `layout.tsx`.

**Anatomía de página (Resumen es el patrón):** BarraPagina blanca (breadcrumb
+ búsqueda real + "Preguntar a la IA" que abre el rail + campana de
pendientes reales) → bienvenida SIN recuadro, directo sobre el lienzo tenue
(`--g1`), con chip de fecha y CTA `--marca` → tarjetas blancas encima:
StatCards con caja interna y delta verde/rojo abajo, la TABLA protagonista,
y los bloques de periodo. Compacto: paddings `p-3.5`, gaps `gap-2.5`,
filas de tabla `py-2.5`.

---

## 1. Lo que YA existía y SE QUEDA (no rediseñar)

- **Tokens de `globals.css`** — todos auditados AA con fórmula WCAG, no a ojo:
  `--bg #fbfbfd`, `--surface #ffffff`, `--ink #17100d`, `--muted`, `--faint`,
  `--line/--line2`, `--accent/--marca #c2410c` (5.18:1 sobre blanco),
  `--ok/--warn/--bad` con sus fondos suaves, rampa `--g1..--g5`.
- **El kit compartido** `admin/ui/kit.tsx`: `KpiTile`, `StatusPill`,
  `Semaphore`, `ChartCard`, `EstadoVacio`, `EstadoError`, `EstadoCargando`.
  Ya son el lenguaje del sistema. Se EXTIENDE, nunca se duplica.
- Gráficas solo de `admin/charts.tsx` + `admin/ui/graficas.tsx`.
- `.tabular` para toda cifra; el formato vive SOLO en `lib/formato.ts`.
- Reglas de producto que ningún rediseño toca: **nunca inventar una cifra**
  (sin dato → guion o `EstadoVacio`, jamás un 0 de encuadre), **el encargado
  no ve finanzas** (`lib/auth/visibilidad.ts`), un rótulo tiene que ser verdad.

## 2. Lo que MUERE con esta dirección

- `DEGRADADO_MARCA` como relleno de KPIs y hero (`KpiDegradado`): las cifras
  van en tinta sobre blanco, no en blanco sobre naranja.
- El banner con foto del camión en el Resumen (la foto queda en `public/`).
- `glass-panel` como material de las columnas: el marco pasa a tarjeta blanca
  con hairline y sombra suave (`.card`). El blur queda solo para overlays.
- Fondos crema/durazno. El lienzo es `--bg` frío-neutro.

## 3. Las reglas del lenguaje

**Lienzo y jerarquía de superficie.** Fondo `--bg`; TODO contenido vive en
tarjetas blancas `--surface` con borde `1px --line`, radio `--radius-lg`
(1rem) y `--shadow-card`. Nada flota sin borde. Máximo dos niveles de
superficie: lienzo → tarjeta (→ sub-bloque `--canvas` si hace falta).

**Color con cuentagotas.** En los paneles el "acento" es la TINTA
(`--marca` = #18181b vía `.tema-neutro`): chips de ícono, pill activa del
sidebar, CTA primaria. Semáforos solo en estatus, y TODO estado de color
lleva texto (nunca color solo). El naranja NO existe dentro de las consolas.

**Botones.** Primaria = `--ink` con texto blanco, radio `--radius-md`,
`h-9 px-4 text-sm font-medium`. Secundaria =
blanca con hairline. Peligro = `--bad` texto sobre `--badbg`. Máximo UNA
primaria visible por vista.

**KPI / stat card:**
```
[icon-chip]  Etiqueta muted 13px
             Cifra 28-32px semibold tabular en --ink
             [DeltaChip +12.6% vs jul]   ← solo con dato real de comparación
```
Anatomía real: tarjeta blanca `p-2.5` → CAJA
INTERNA `--canvas` con hairline (chip de ícono OSCURO `--marca`/`--marca-fg`
+ etiqueta + cifra `.font-display` 28px) → delta DEBAJO de la caja como
texto `--ok`/`--bad` ("↑ 12% vs periodo anterior"). `bueno` lo decide el
llamador; sin comparable, el delta se omite (nunca "0.0%").

**Pills de estatus** (dominio Likida): `liquidado → ok`, `en_cuadre → warn`,
`abierto → neutral`, vencido/EFOS/error → `bad`. Siempre `StatusPill`.

**Tablas:** header 11px uppercase `--muted`, filas 52-56px,
divisores `--line2`, hover `--canvas`, cifras `.tabular` alineadas a la
derecha, estatus como pill, acciones a la derecha (texto, no íconos sueltos).
Las tablas viven DENTRO de una tarjeta con título y acción "Ver todo".

**Gráficas.** Serie principal en rampa `--g3/--g4`, comparativos en gris;
la barra/punto del periodo actual puede ir `--marca` (una barra encendida
marca el periodo). Tooltip = pill oscura (`--ink` bg, texto blanco). Ejes
`--faint` 11px. Nada de rejillas duras: hairlines `--line2` u omitidas.

**Sidebar:** superficie blanca, logo arriba,
secciones con rótulo 11px uppercase `--faint` (OPERACIÓN / DINERO / GESTIÓN),
ítems `h-9 rounded-lg text-sm` con ícono 16px; activo = fondo `--g1`, texto e
ícono `--marca`, `font-medium` (pill suave, NO bloque degradado); hover =
`--canvas`. Abajo: tarjeta del tenant + usuario. El widget de plan
queda reservado para cuando exista suscripción real.

**Encabezado de página.** Título 18-20px semibold + subtítulo `--muted` 13px
a la izquierda; filtros/CTA a la derecha. El encabezado NO scrollea: patrón
`shrink-0` + `flex-1 min-h-0 overflow-y-auto` (FASE 1.5) en toda página nueva.

**Densidad y aire.** Padding de tarjeta `p-4` (KPI `p-3.5`), gap de grillas
`gap-3`/`gap-4`, márgenes de página `px-5 py-4`. El sistema respira:
ante la duda, un bloque menos por fila.

**Microinteracción.** Lo ya existente: count-up (con `prefers-reduced-motion`),
`animate-in`, skeleton shimmer. Nada nuevo de movimiento.

## 4. Dónde vive cada cosa

| Pieza | Archivo |
|---|---|
| Tokens | `src/app/globals.css` (`@theme` + `:root`) |
| Primitivas compartidas | `src/app/admin/ui/kit.tsx` (`StatCard`, `KpiTile`, `StatusPill`, `ChartCard`, estados) |
| Barra superior del Resumen | `dashboard/resumen-visual.tsx` (`BarraPagina`, `ChipFecha`, `TablaViajes`) + `barra-acciones.tsx` (búsqueda / IA / campana) |
| Marco de las dos consolas | `src/app/marco.ts` (geometría) — material `.card`, ya no `.glass-panel` |
| Sidebar de /dashboard | `src/app/dashboard/sidebar-nav.tsx` + `rutas.ts` |
| Gráficas | `admin/charts.tsx`, `admin/ui/graficas.tsx` |

Una página NUEVA se compone solo de piezas del kit. Si una página necesita un
patrón que el kit no tiene, el patrón se sube al kit con nombre y regla — no
nace como excepción local (así murió la dirección del 7-ago: vivía en una
sola pantalla).
