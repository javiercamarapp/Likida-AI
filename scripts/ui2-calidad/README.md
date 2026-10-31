# ui2-calidad

Detector de calidad de la UI v2 (puerto de los detectores de Rovaq: `choques`, `movil-contenido`, `carga-pantalla-completa`).
Mide las pantallas del arnés de capturas (`scripts/ui2-captura/`) en 1440 / 1024 / 768 / 390 × claro / oscuro.
Datos sintéticos; no es parte de `npm test` ni del build.

```
scripts/ui2-calidad/render.sh [TRABAJO]          # HTML + CSS v2 (vitest bajo heavy.sh, un proceso pesado a la vez)
node scripts/ui2-calidad/detectar.mjs            # medidas-<etiqueta>.json + INFORME-<etiqueta>.md; sale 1 si hay hallazgos
node scripts/ui2-calidad/detectar.mjs --selftest # casos sintéticos MALOS (debe marcar) y BUENOS (no debe marcar) de cada criterio; pantalla limpia = 0
```

Opciones de `detectar.mjs`: `--trabajo= --out= --etiqueta= --pantallas=c01,a1 --anchos= --temas= --capturas`.

| id | Criterio | Norma |
|---|---|---|
| c1 | controles | alto visual ≤ 36 (primario ≤ 32, 36 en <820), toque ≥ 44 (prueba de impacto; input/select de escritorio y la caja de 44 de móvil exentos), vecinos ≥ 8 px |
| c2 | tipografía | 0 textos < 11 px; H1 20; KPI 26 (tope 30; «—» 18; móvil 18–21); escala {11 MAYÚSC., 12, 13, 14, 15, 20, 26} (16 solo campo móvil y cifra de tooltip; 18 solo KPI «—») |
| c3 | padding / gap / radios | radios {8, 12, píldora; 16 solo hoja inferior móvil}; tarjeta ≤ 14 (móvil ≤ 12); gap ≤ 12; página 24 |
| c4 | espacio vacío | 0 huecos de fila; aire inferior por tarjeta ≤ 24 px y ≤ 25 %; 0 min-height decorativo; vecinas ±4 px |
| c5 | primer pliegue 1440×900 | KPI + gráfica + ≥ 8 filas (solo pantallas de tipo `panel`, ver `pantallas.mjs`) |
| c6 | choques | 0 desborde, 0 recorte, 0 solapes, 0 controles sin nombre |
| c7 | contraste | texto ≥ 4.5:1 (grande 3:1); 0 caja del color de su fondo |
| c8 | carga | 1 logo, capa fija 100 % del viewport, sin texto, sin shell visible, un solo color |
| c9 | movimiento | duraciones = tokens {120,140,160,170,180,220,250,260,360,380,420,700,1600} ms; en reglas de gráfica cualquier valor ≤ 700 ms (CSS de `ui-v2/` y `style=""` del HTML) |
| N1 | primarios | ≤ 1 botón primario en el pliegue; 0 bloques negros (claro) o blancos (oscuro) de navegación |
| N2 | mono | 0 `font-family` mono fuera de IDs/folios/trazas (`code`, `.rv-id`, texto con forma de folio) y captions de grupo del sidebar |
| N3 | pie del sidebar | pie ≤ 150 px y sin ítem recortado a 1440×900 **y** a 1280×720 (pasada extra, solo `n3.*`) |
| N4 | categorías | ≤ 1 categoría abierta en el sidebar y 1 sola variante de sidebar entre pantallas (global) |
| N5 | logo | exactamente 1 instancia SVG del logo en el sidebar (≥ 768) o en la cabecera móvil |
| N6 | cero falso | 0 «0» pelados en KPI/valores de barra sin fuente+periodo (`data-cero-fuente`), 0 «$0.00» en filas «Revisar/Pendiente» |
| N7 | fixtures | 0 folios repetidos, 0 «Operador Uno»/«de prueba», ≤ 1 aviso «sintético» por página |
| N8 | esqueletos | 0 esqueletos; ≤ 1 chip «Observado» y ninguno dentro de un KPI |

**Tipos de pantalla** (`pantallas.mjs`, ESTILO §6) deciden c5 en 1440×900: `resumen` (KPI 112 ±8, gráfica con plot ≥ 140, «Requiere tu atención» ≥ 3 filas, sin tabla),
`hub` (KPI, gráfica, tabla ≥ 10 filas), `lista` (KPI, tabla ≥ 10 filas), `formulario`/`asistente` (≥ 8 filas o campos), `carga` (solo c8), `componentes` (muestrario, sin pliegue).
También c3: marcas de gráfica (hojas con radio ≤ 4 dentro de figure/svg o con `title`) exentas de `c3.radio`; cabecera de tabla 36 px; tolerancia 16 px en `c1.toque` entre controles contiguos.

**Contrato de selectores** que los componentes v2 respetan: sidebar `.rv-sb` con pie `.rv-sb__pie`, cabecera móvil `.rv-cab-movil`, primario `.rv-btn--primary`,
captions de grupo `.rv-grupo__t`, tira de KPI `.rv-kpis`. El arnés ABORTA (código 4) si una pantalla no trae `[data-ui="v2"]`.

Salida: `medidas-<etiqueta>.json` (todo), `medidas-<etiqueta>/<pantalla>.json` (uno por ruta, con su tipo y ruta) e `INFORME-<etiqueta>.md`.

Límites conocidos: el arnés renderiza HTML estático (sin JS ni red), así que la carga real entre navegaciones
(umbrales 250 ms / 400 ms / 600 ms, latencias simuladas) no se mide aquí; c8 mide lo que el producto pinta mientras carga.
