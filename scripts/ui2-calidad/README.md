# ui2-calidad

Detector de calidad de la UI v2 (puerto de los detectores de Rovaq: `choques`, `movil-contenido`, `carga-pantalla-completa`).
Mide las pantallas del arnés de capturas (`scripts/ui2-captura/`) en 1440 / 1024 / 768 / 390 × claro / oscuro.
Datos sintéticos; no es parte de `npm test` ni del build.

```
scripts/ui2-calidad/render.sh [TRABAJO]          # HTML + CSS v2 (vitest bajo heavy.sh, un proceso pesado a la vez)
node scripts/ui2-calidad/detectar.mjs            # medidas-<etiqueta>.json + INFORME-<etiqueta>.md; sale 1 si hay hallazgos
node scripts/ui2-calidad/detectar.mjs --selftest # prueba que cada criterio detecta y que una pantalla limpia da 0
```

Opciones de `detectar.mjs`: `--trabajo= --out= --etiqueta= --pantallas=c01,a1 --anchos= --temas= --capturas`.

| id | Criterio | Norma |
|---|---|---|
| c1 | controles | alto visual ≤ 36 (primario sólido ≤ 32), toque ≥ 44 (prueba de impacto), vecinos ≥ 8 px |
| c2 | tipografía | 0 textos < 11 px; H1 20; KPI 26 (tope 30); escala {11 MAYÚSC., 12, 13, 14, 15, 20, 26} |
| c3 | padding / gap / radios | radios {8, 12, píldora}; tarjeta ≤ 14 (móvil ≤ 12); gap ≤ 12; página 24 |
| c4 | espacio vacío | 0 huecos de fila; aire inferior por tarjeta ≤ 24 px y ≤ 25 %; 0 min-height decorativo; vecinas ±4 px |
| c5 | primer pliegue 1440×900 | KPI + gráfica + ≥ 8 filas (solo pantallas de tipo `panel`, ver `pantallas.mjs`) |
| c6 | choques | 0 desborde, 0 recorte, 0 solapes, 0 controles sin nombre |
| c7 | contraste | texto ≥ 4.5:1 (grande 3:1); 0 caja del color de su fondo |
| c8 | carga | 1 logo, capa fija 100 % del viewport, sin texto, sin shell visible, un solo color |

Límites conocidos: el arnés renderiza HTML estático (sin JS ni red), así que la carga real entre navegaciones
(umbrales 250 ms / 400 ms / 600 ms, latencias simuladas) no se mide aquí; c8 mide lo que el producto pinta mientras carga.
