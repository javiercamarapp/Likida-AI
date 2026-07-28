# El tablero

`docs/auditoria-N/tablero.html`. Un solo archivo, sin CDN ni fuentes remotas: se abre desde el disco meses después y tiene que seguir viéndose igual. Invoca `dataviz` antes de escribir la primera línea de gráfica.

## Para qué es

No es un reporte bonito de lo que ya sabes. Es el único artefacto de la ronda que se puede leer en veinte segundos con café, y su trabajo es contestar tres preguntas en ese orden:

1. **¿Qué se rompió que ayer estaba bien?** — deltas negativos, arriba, imposibles de no ver.
2. **¿Qué me impide llegar al demo?** — los críticos, con su archivo y su escenario.
3. **¿Voy mejorando o me estoy contando una historia?** — la serie histórica de la global.

Todo lo demás es secundario y va abajo.

## Qué lleva

- **Rejilla de 12 rubros.** Nota grande, delta con flecha y color, y la línea del riesgo mayor. El color codifica la nota (rojo ≤4, ámbar 5–6, verde ≥7), **nunca** el delta: un rubro que sube de 3 a 4 sigue siendo rojo, y pintarlo verde por haber subido es exactamente la mentira que esta rutina existe para evitar.
- **Serie histórica de la global**, una línea por ronda con la fecha. Con dos puntos ya sirve.
- **Hallazgos**, agrupados por severidad y con estado: `arreglado` (con el sha del commit), `propuesto`, `pendiente` (con la razón por la que no se arregló), `descartado` (con la razón por la que era falso). Los descartados se muestran: son la prueba de que la verificación ocurrió.
- **Barra de estado de la suite**: `npm test`, `typecheck`, `lint`, `build`, con el número real y el tiempo. Si algo está rojo, encabeza el tablero.
- **Reincidentes marcados aparte.** Un hallazgo que vuelve es peor noticia que uno nuevo, y en una lista plana se ve igual.

## Cómo se ve

Tema claro y oscuro, `prefers-color-scheme` más `data-theme`. Tablas anchas con su propio `overflow-x`; el cuerpo de la página nunca hace scroll horizontal. Nada de animación de entrada: este archivo se captura en headless y las animaciones salen a medio camino.

## Verificar mirando

Un tablero que nunca se renderizó no es evidencia de nada — el HTML puede compilar perfecto y mostrar una rejilla vacía porque el JSON de entrada cambió de forma.

1. Abrirlo (`open docs/auditoria-N/tablero.html`) o capturarlo en headless con `--force-prefers-reduced-motion`; sin esa bandera la captura cae a mitad de la transición.
2. **Mirar la imagen.** Contar los rubros: si no son doce, falta un auditor. Verificar que las notas del tablero son las mismas del `00-SINTESIS.md` — se desincronizan cuando la síntesis se corrige a mano después.
3. Recortar con `sips` requiere `--cropToHeightWidth`; `--cropOffset` solo no recorta y no avisa.

En modo desatendido la captura se guarda como `docs/auditoria-N/tablero.png` y se manda junto con el resumen. Sin esa imagen, la ronda no está cerrada.
