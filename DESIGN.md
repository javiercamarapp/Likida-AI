# Likida — Sistema de diseño v4

## Estado vigente (v4, 10-nov-2026)

Esta sección manda sobre lo que contradiga a las de abajo, que son el historial v3.1 y se conservan por sus reglas de
producto. La v4 está **derivada del código**, no al revés: si un valor de aquí discrepa de los archivos, gana el archivo
y se corrige este texto.

**Fuentes de verdad (los valores NO se copian aquí):**

| Qué | Dónde |
|---|---|
| Colores, radios, alturas, estados de foco y de botón | `src/app/ui-v2/tokens.css` (alcance `[data-ui="v2"]`) |
| Tipografía | `src/app/ui-v2/fonts.css` y `src/app/layout.tsx` |
| Piezas (botón, chip, aviso, tabla, cajón, filtros) | `src/app/ui-v2/componentes/` y `CATALOGO-L7.md` |
| Gráficas | `src/app/ui-v2/graficas/` (el kit viejo `admin/ui/graficas` queda prohibido en pantallas nuevas) |

**Tipografía (corrige la sección «Tipografía» de abajo):** **Hanken Grotesk** (local, cuatro pesos, decisión D-5) para la UI
y los titulares (`--font-sans-ui`, `--font-display`); **IBM Plex Mono** (`next/font`) para micro-rótulos y cifras de tabla
(`.etiqueta-mono` / `.cifra-mono`). **Inter e Inter Tight ya no se cargan**: cualquier mención a ellas abajo es historia.

**Identidad (decisiones del dueño, 10-nov-2026, `DECISIONES-DUENO`):**
1. **Botón primario NEGRO**; el resto del botón como Rovaq (peso 500, radios, estados). El hover es **neutro**, coherente con el negro.
2. **Telón de carga con el logo, igual a Rovaq**, también en navegaciones internas lentas (> 250 ms), no solo en la primera carga de la sesión; respeta `prefers-reduced-motion`.
3. La cabecera de escritorio **no lleva campana ni fecha**: la campana vive como «Avisos» en el pie del sidebar; el botón Guía va junto al plegar, estilo píldora.
4. Para lo no listado (tooltip, título con icono, barra móvil, cajón 420/640): **seguir a Rovaq** y documentarlo en el commit.
5. Se conservan el Cerebro de ventas y sus datos, el Copiloto y todos los agentes con su panel.

**Rótulo «Ejemplo».** Todo dato de demostración (la página pública `/demo`, escenarios de ejemplo) lleva la etiqueta visible
«Ejemplo» (`Chip` tono `warn`). Un dato ficticio sin rótulo es una cifra inventada (regla de `CLAUDE.md`).

## Esqueletos de página F26

Decisión 11 (10-nov-2026): cada página de Likida se reconstruye con el ESQUELETO de su equivalente en Rovaq, en todas las cuentas. Los
esqueletos viven en `src/app/ui-v2/esqueletos/` (puerta única `index.ts`), están construidos sobre las piezas de `ui-v2` y NO añaden
piezas nuevas: fijan el ORDEN de los bloques y los márgenes (12 px entre bloques, 14 de padding de tarjeta). El mapa de las 145
páginas, con su plantilla, orden de bloques y talla, es `F26-MAPA.md` (en la carpeta de trabajo de la sesión).

| Esqueleto | Plantilla de Rovaq | Orden de bloques (de arriba abajo) |
|---|---|---|
| `EsqueletoPortada` | Hoy `/overview`, Resumen de plataforma | cabecera → `titular` → `filtros` → `procedencia` → `avisos` (≤2) → `cifras` (tira) → `children` (filas de `FilaTarjetas`) → `metodo` |
| `EsqueletoTablaMaestra` | Problemas, Importaciones, Auditoría, bandejas | cabecera → (pestañas del marco) → `filtros` → `avisos` → `cifras` → `agrupacion` → tabla (`children`) → `pie` («25 de N») → `vistaRapida` |
| `EsqueletoPanelCifras` | CFO, Brechas, Fuga, Cortes, mapas | cabecera → `titular` → `filtros` → `avisos` → `cifras` → `graficas` (rejilla 2 col) → `children` → `saberes` (Qué se sabe / Qué no se sabe) → `metodo` |
| `EsqueletoFicha` | Ficha de problema, Ficha 360 | cabecera «FICHA DE …» + Volver → `chips` + `descripcion` → `avisos` → `cifras` → `bloques` (2 col) → `children` |
| `EsqueletoConfiguracion` | `/setup`, Equipo, Retención, Entrega de avisos | cabecera sin eyebrow → `contexto` → `avisos` → `progreso` → `secciones` (≤780 px) |

**Uso.** Una página elige UNA plantilla y le pasa piezas ya armadas; no importa `MarcoPagina` por su cuenta. Los filtros son
`BarraPeriodo` (segmentado píldora 30/24 + «Filtros N» con contador + chips de alcance, ya existente: no hay una `BarraFiltros` nueva); las
cifras son `PropsCifra[]` de `ui-v2/graficas`; la tabla es `TablaLista` (cabecera 36, fila 40); los estados son los de `Tarjeta`/`EstadoVacio`
(vacío punteado, «No disponible ahora. No es cero»); el sello Observado/Inferido/Estimado lo pone `Cifra` o `SelloDato`.

```tsx
// Tabla maestra con cajón de vista rápida (la fila es un enlace `?ver=<id>`; el servidor arma el cajón de esa fila).
<EsqueletoTablaMaestra
  titulo="Viajes" apoyo="Los viajes del periodo y su estado de liquidación."
  acciones={<Boton variante="secondary">Exportar</Boton>}
  filtros={<BarraPeriodo periodo={...} cajon={...} chips={...} />}
  cifras={[{ etiqueta: 'Viajes', valor: 128 }, ...]}
  pie={`${visibles} de ${total}`}
  vistaRapida={sel ? (
    <CajonVistaRapida titulo={sel.folio} subtitulo={`Viaje ${n} de ${total}`} hrefCerrar="/dashboard/viajes"
      cifras={[{ etiqueta: 'Flete', valor: '$12,400' }, { etiqueta: 'Anticipo', valor: '—' }, ...]}
      pie={<BotonEnlace variante="suave" href={`/dashboard/${sel.id}`}>Abrir viaje</BotonEnlace>} />
  ) : null}
>
  <TablaLista etiqueta="Viajes" columnas={...} filas={...} idFila={...} base="/dashboard/viajes" params={...} />
</EsqueletoTablaMaestra>
```

**Reglas.**
1. Un solo `h1` (lo pone el marco) y un solo primario por zona; las acciones secundarias son fantasma o van en menú.
2. Las cifras son una tira (`formaCifras="tira"`) o cuatro tarjetas sueltas con filete (`"tarjetas"`, la consola). Una cifra sin dato dice
   «—», nunca 0; una gráfica sin serie real se queda en `estado="vacio"`.
3. **Cajón**: 420 (`tamano="m"`) y 640 (`xl`) —Rovaq usa 420 y 480; la Vista rápida de 480 se pinta a 420 (decisión 7, R8). Foco, Esc, fondo,
   hoja inferior en móvil y logo los da `Drawer`; `CajonVistaRapida` solo arma el 2×2 de cifras, el aviso y el pie.
4. **Paleta (decisión 10, anula a Rovaq)**: ni azul, ni petróleo, ni naranja, ni violeta en el cromo de los esqueletos. El borde del paso
   actual es la tinta (`--ink`), el progreso es negro sobre gris, el segmentado activo lee los tokens `--seg-activo-*`. `esqueletos.css` no
   lleva un solo color, sombra ni animación (la guarda `esqueletos_css.test.ts` lo exige). Burdeos `--senal` solo para «requiere acción».
5. Movimiento: la entrada escalonada (`data-entra`) y el lift (`data-lift`) los ponen `Tarjeta` y `TiraCifras`, ambos tras
   `prefers-reduced-motion: no-preference`; los esqueletos no añaden ninguno.
6. Pestañas de hub: las pinta `MarcoPagina` (`PestanasDelMarco`); un esqueleto NO añade otra barra.
7. Los esqueletos NO traen texto propio (decisión 4, guarda `i18n_deuda`): los nombres accesibles (`etiquetaProcedencia`, `etiquetaResumen`,
   `etiquetaChips`, `etiquetaCifras`) y los títulos de «Qué se sabe / Qué no se sabe» (`saberes.seSabe.titulo`) los pasa la página desde su diccionario.

---

# Sistema v3.1 (historial)

Dirección fijada el **12-ago-2026**, reemplazando la dirección "degradado de
marca" del 7-ago-2026. Se pidió explícito: **logo negro, ya no paleta
naranja** en los paneles, tipografía más corporativa, y todo compacto.

**v3.1 (16-ago-2026)**: Se sumó como referencia el template MIT
`shadcndashboard/next-shadcn-dashboard` ("visual minimalista y tipografía,
todo") y ordenó 5 patrones suyos en LOS DOS paneles: divisores internos
PUNTEADOS (filas de tabla y pies de stat), línea comparativa punteada en
gráficas, pill activa del sidebar SÓLIDA en tinta, `WidgetUso` al pie del
sidebar, y el fantasma "Ver estadísticas →" (`VerMas`) bajo grupos de
métricas. Más microinteracciones de prensado/lift (principios de `Amicro`,
CSS puro, cero dependencias, tras `prefers-reduced-motion`). Ningún patrón
entra como librería nueva: todo con los tokens y el kit de la casa.

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

**Tablas** (textura v3.1): header 11px uppercase `--muted` con divisor
SÓLIDO, filas 52-56px con divisores `--line2` **punteados** (la regla vive
en globals.css: `.card table tbody tr`), hover `--canvas`, cifras `.tabular`
alineadas a la derecha, estatus como pill, acciones a la derecha (texto, no
íconos sueltos). Las tablas viven DENTRO de una tarjeta con título y acción
"Ver todo". La textura punteada es SOLO para divisores internos de una
tarjeta; el borde externo sigue sólido.

**Gráficas.** Serie principal en rampa `--g3/--g4`, comparativos en gris;
la barra/punto del periodo actual puede ir `--marca` (una barra encendida
marca el periodo). El periodo ANTERIOR va como línea PUNTEADA gris
(`AreaChartSimple.comparativa`, v3.1) — al MISMO max que la actual, y solo
con serie real. Tooltip = pill oscura (`--ink` bg, texto blanco). Ejes
`--faint` 11px. Nada de rejillas duras: hairlines `--line2` u omitidas.

**Sidebar:** superficie blanca, logo arriba,
secciones con rótulo 11px uppercase `--faint` (OPERACIÓN / DINERO / GESTIÓN),
ítems `h-9 rounded-lg text-sm` con ícono 16px; activo = pill SÓLIDA en tinta
(`--marca` de fondo, texto e ícono `--marca-fg`, `font-medium`) — v3.1
reemplaza a la pill suave `--g1`; hover = `--canvas`. Abajo: `WidgetUso`
(kit) con DATO MEDIDO — costo de IA del mes en /admin, % del presupuesto
diario de análisis en /dashboard; el widget de PLAN real sigue reservado
para cuando exista suscripción real. Luego tarjeta del tenant + usuario.

**Encabezado de página.** Título 18-20px semibold + subtítulo `--muted` 13px
a la izquierda; filtros/CTA a la derecha. El encabezado NO scrollea: patrón
`shrink-0` + `flex-1 min-h-0 overflow-y-auto` (FASE 1.5) en toda página nueva.

**Densidad y aire.** Padding de tarjeta `p-4` (KPI `p-3.5`), gap de grillas
`gap-3`/`gap-4`, márgenes de página `px-5 py-4`. El sistema respira:
ante la duda, un bloque menos por fila.

**Microinteracción.** Count-up (con `prefers-reduced-motion`), `animate-in`,
skeleton shimmer — y desde v3.1 (principios de Amicro, CSS puro en
globals.css, cero dependencias): prensado `scale(0.97)` en todo botón
activo y lift de 1px en tarjetas-link al hover. TODO detrás de
`prefers-reduced-motion`; nada más de movimiento sin pasar por aquí.

**Avisos, diálogos, estados y paginación — UN solo sistema (W2, 1-oct-2026).**
Antes había 18 copias del aviso de resultado y cuatro maneras de confirmar lo
destructivo. Ahora cada situación tiene UNA pieza, y una pantalla nueva no inventa
otra:

| Situación | Pieza | Regla |
|---|---|---|
| Resultado de UN formulario (ok / error) | `AvisoResultado` (`admin/ui/aviso-resultado.tsx`) | Junto a los campos que se corrigen. Error `role="alert"`, éxito `role="status"`, ícono + texto (nunca color solo). El error del servidor sale VERBATIM. Acepta las tres formas de resultado de los server actions. |
| Resultado de una acción de FILA o de una operación larga | Toast (`useNotificar` / `useNotificarResultado`, `admin/ui/notificaciones.tsx`; el proveedor vive en `dashboard/chrome.tsx`) | Éxito/info/aviso se van solos (5/6/9 s); un ERROR no se va solo (WCAG 2.2.1) y se cierra con la X o con Esc; pausa con cursor o foco; máximo 4; el mismo mensaje no se apila. |
| Confirmar algo destructivo o que corta el acceso de alguien | `DialogoConfirmar` / `BotonConfirmar` (`admin/ui/confirmar.tsx`) sobre `<dialog>` nativo | El diálogo DICE qué pasa y a cuántos afecta. Tono `peligro`: el foco inicial cae en Cancelar. Prohibido `confirm()` del navegador y el `<details>` de dos pasos. |
| Lista vacía / lectura caída / carga | `EstadoVacio` (con `accion`: un enlace REAL al siguiente paso), `EstadoError`, `EstadoCargando` (`kit.tsx`) | Un vacío dice cómo se llena; una lectura caída NUNCA se pinta como vacío. |
| Búsqueda y páginas de un registro | `FiltroRegistro` (`dashboard/registro-filtro.tsx`) + `paginar-registro.ts` | El pie declara «25 de N». La URL dice qué se mira. |

Los toasts no reemplazan al aviso del formulario: si el error tiene campos al
lado, se enseña ahí.

## 4. Dónde vive cada cosa

| Pieza | Archivo |
|---|---|
| Tokens | `src/app/globals.css` (`@theme` + `:root`) |
| Primitivas compartidas | `src/app/admin/ui/kit.tsx` (`StatCard`, `KpiTile`, `StatusPill`, `ChartCard`, estados) |
| Avisos, toasts y diálogo de confirmación | `src/app/admin/ui/{aviso-resultado,notificaciones,confirmar}.tsx` |
| Encabezado y periodo del Resumen | `MarcoPagina` + `BarraPeriodo` (`ui-v2/componentes`); `resumen-v2.tsx` es la página canónica. El respaldo v1 (`inicio-contenido.tsx`, `inicio-operacion.tsx`, `barra-acciones.tsx`) se retiró el 11-nov-2026 |
| Marco de las dos consolas | `src/app/marco.ts` (geometría) — material `.card`, ya no `.glass-panel` |
| Sidebar de /dashboard | `src/app/dashboard/sidebar-nav.tsx` + `rutas.ts` |
| Gráficas | `admin/charts.tsx`, `admin/ui/graficas.tsx` |

Una página NUEVA se compone solo de piezas del kit. Si una página necesita un
patrón que el kit no tiene, el patrón se sube al kit con nombre y regla — no
nace como excepción local (así murió la dirección del 7-ago: vivía en una
sola pantalla).

---

## 5. Igualar a Rovaq (R8, 7-nov-2026)

El dueño decidió igualar el nivel visual de Rovaq y **adoptar su azul**. Alcance EXACTO, y nada más:

- **Paleta de ALTO CONTRASTE (11-nov-2026, punto 10 del dueño; ANULA el azul de Rovaq y su petróleo)**: cromo y datos son negro, gris y blanco.
  Estado activo de segmentados, chips y filtros y acción del cajón (`--seg-activo-*`, `--accion-cajon-*`): gris `#e4e4e6`, texto y anillo
  `#0e0e10` (oscuro: `#34343a` / `#f4f4f5`). Series `--chart-1..8`: negro y grises ordenados por luminosidad (claro `#0e0e10 #8a8a90 #3a3a40
  #b4b4ba #5a5a61 #a3a3ab #707078 #d9d9dc`; oscuro `#f4f4f5 #7f7f87 #c4c4ca #55555c #a0a0a8 #66666e #909098 #3a3a40`); las claras (4, 6, 8) llevan
  contorno `--chart-borde`. Filete de KPI `--kpi-filete` negro; cabecera de tabla con texto negro. Semáforos ok/aviso/error conservan color sobrio
  (siempre con texto o icono) y el rojo queda para error/peligro; `--senal` solo para «requiere acción». `sin_azul_cromo.test.ts` ya no admite excepción.
- **Cajón unificado** (`Drawer`/`PanelLateral`, `ui-v2/overlay.css`): dos anchos por tipo, **420** estándar y **640** paquetes y previas
  (los valores heredados `tamano="l"`, `ancho` 320 y 560 se pintan con el de su tipo). Borde del panel `--line`, título con tracking
  -0.01em y SIEMPRE el logo de Likida abajo en escritorio (100 px de ancho, franja de 28 px, padding 9/0/11, filete superior, opacidad .6).
  El ⓘ (`InfoTip`) abre un cajón de 420 con bloques `rv-ov-bloque`, pares `rv-ov-kv`, «Lo que no sabemos» y el sello «Clase de dato»
  (`ContenidoInfo`). Los campos opcionales del catálogo (`periodo`, `cobertura`, `loQueNoSabemos`, `clase`) vacíos no se pintan: no se inventa contenido.
- **BrandMark** (`componentes/marca-integracion.tsx`): `MarcaIntegracion` (logo de 16 px, viewBox 24, a color de marca) y `ChipFuente`
  (píldora tipo casilla de 28 px que filtra en un `<form method="get">` sin JavaScript). Los trazados son de simple-icons (CC0) y viven
  solo en `marca-integracion.data.ts`, con su versión; lo que no tiene trazado verificable usa un icono genérico de lucide, nunca uno inventado.
- **Sidebar activo**: barra izquierda inset de 3 px, fondo tinta al 7 % y peso 500. El color de la barra es UN token,
  `--nav-activo-barra` (negra `#0e0e10`; en oscuro blanca `#f4f4f5`; anula el rojo de Rovaq); cambiarlo en `tokens.css` cambia todos los menús. Grupo del
  menú: 11/500 mayúsculas con tracking 0.66 px. (Esto reemplaza lo de §3 sobre la pill activa sólida en tinta.)
