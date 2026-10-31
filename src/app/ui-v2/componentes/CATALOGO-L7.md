# Catálogo de uso · piezas comunes L7

Todas se importan de `@/app/ui-v2/componentes`. Medidas y tonos salen de Vexa; paleta de Likida (chrome negro/gris/blanco, sin azul de interfaz).
CSS en `ui-v2/piezas.css` (el tooltip, en `overlay.css` por ser del motor de overlays). Pruebas de comportamiento reales (Chromium):
`componentes/piezas_l7_comportamiento.test.ts`.

| Pieza | Cuándo | No uses cuando |
|---|---|---|
| `Icono` | Todo icono de lucide: trazo 1.75, 16 px (`tam` 14/18/20 solo donde Vexa los usa). | Gráficas y SVG propios (no son iconos). |
| `Casilla` / `Radio` | Control nativo con caja propia de 16 px, etiqueta clicable (36 px; 44 en móvil), `ayuda` enlazada. `indeterminada` para «seleccionar todas». | Un ajuste que se aplica al instante: usa `Switch`. |
| `Switch` | Encendido/apagado con efecto inmediato (34×20, perilla blanca que recorre 14 px). | Una opción de formulario que se envía con «Guardar»: `Casilla`. |
| `Campo` | Etiqueta + control + ayuda + error (`role="alert"` con icono). Recibe UN input/select/textarea. | Casillas y radios (ya traen su etiqueta). |
| `Fieldset` | Grupo de radios/casillas o sección de formulario con `<legend>` (13/600, borde y radio 12). | Un solo campo. |
| `CampoArchivo` | `<input type="file">` real con el botón interno de 32 px. | Arrastrar y soltar con vista previa (otro componente). |
| `SegmentedControl` | Elegir UNA opción corta (periodo, modo): radiogroup, flechas/Inicio/Fin, 2–5 opciones, conteos opcionales. | Navegar entre rutas (`TabsLinea`) o paneles (`Tabs`). |
| `Tabs` | Paneles de la misma página: tablist/tab/tabpanel, flechas, `param="vista"` refleja `?vista=`. | Secciones que son rutas distintas. |
| `TabsLinea` | Secciones hermanas que son rutas (hubs): enlaces con `aria-current="page"`, máx. 6. | Paneles en la misma página. |
| `Tooltip` | Aclaración CORTA (≤ 2 líneas) de un botón/ícono/rótulo: hover y foco, Esc, `aria-describedby`. Tarjeta blanca 160–280 px. | Algo largo: ⓘ (`InfoTip`) o `Popover`. Nunca contenido esencial solo en tooltip. |
| `StatusChip` | Estado de un registro: punto + texto (ok/warn/bad/info/neutral/muted), 22 px. | Categorías con matiz de datos (`Chip categoria`) o variaciones (`Chip tamano="delta"`). |
| `TablaBase` | Tabla estática con filas en memoria: región con foco, cabecera pegajosa 36, filas 40/32, estados. | Orden, paginación por URL, selección masiva: `TablaLista` (L6). |

## Convivencia TablaBase / TablaLista (L6)
Las dos comparten medidas (cabecera 36, fila 40, densa 32) y estados (`EsqTablaV2`, `EstadoError`, `EstadoVacio`). `TablaLista` añade orden,
paginación por URL, selección y teclado de celdas; `TablaBase` es el marcado mínimo correcto. No dupliques: si una pantalla necesita más
que `TablaBase`, sube a `TablaLista` sin cambiar el contenido de las celdas (`celda(fila)` es el mismo contrato).

## Reglas
- Sin `style=` ni `<style>` (CSP con nonce). Movimiento solo bajo `prefers-reduced-motion: no-preference`.
- Nunca solo color: el estado siempre lleva texto (o forma, como el punto hueco de `muted`).
- Iconos: `Icono`; `iconos_trazo.test.ts` impide grosores mezclados en código nuevo (la deuda anterior está en `iconos_trazo_base.ts` y solo baja).
- Filtros (`BarraFiltros`/`ChipFiltro`): no se tocan en L7.
- ⓘ: cada `Cifra` y cada título de recuadro de las pantallas del dashboard sigue llevando su `InfoTip` (`info_cobertura.test.ts`).
