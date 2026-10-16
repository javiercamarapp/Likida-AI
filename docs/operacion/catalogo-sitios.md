# Catálogo depurado de orígenes y destinos (T-SYS-25)

Cómo se depura e importa el catálogo de orígenes y destinos de una flota grande (decenas de miles de registros con
repetidos, activos e inactivos revueltos y coordenadas dudosas). Pantalla: `Agentes > Conductores > Sitios`, sección
«Catálogo depurado de orígenes y destinos». Código: `src/lib/likida/conductor/catalogo_sitios_import.ts` (puro) y
`importarCatalogoDelPanel` en `acciones_sitios.ts`.

## Principios

- **Solo lee el archivo.** No escribe en el sistema de la flota; el control de «quién da de alta un sitio» es del lado de la flota.
- **Nada se fusiona solo.** Un duplicado es un candidato que una persona resuelve.
- **Nada se corrige ni se geocodifica.** Una coordenada dudosa pasa a «por validar»; no se arregla ni se calcula.
- **Reimportar es seguro.** Misma entrada, mismo resultado; el código del sitio es el del archivo o, si falta, uno
  determinista (`CAT-…`) derivado de nombre y coordenadas, así que subir el archivo otra vez actualiza y no duplica.

## Archivo

CSV (coma, punto y coma o tabulador; con `;` el decimal puede ser coma) o JSON (arreglo de objetos, o `{ "sitios": [...] }`).
Sin tope de filas (el tope de 2 000 de la importación normal del panel no aplica: aquí se parte en lotes).

| Columna | Obligatoria | Notas |
|---|---|---|
| `nombre` | sí | también `sitio`, `origen_destino`, `descripcion` |
| `lat`, `lng` | no | su ausencia manda la fila a «por validar» |
| `estatus` | no | `activo`/`inactivo` (también 1/0, sí/no, alta/baja); vacío = activo |
| `terminal` | no | agrupa la lista de validación; vacío = «(sin terminal)» |
| `pais` | no | vacío, `MX` o `México` = México; cualquier otro = extranjero |
| `codigo`, `radio_m`, `direccion`, `tipo` | no | `tipo` por defecto `punto_interes`; radio por defecto declarado en pantalla (150 m) |

Un registro ilegible se rechaza con «Línea N: …» y no frena a los demás.

## Qué se marca

- **Posible duplicado:** mismo nombre normalizado (sin acentos, mayúsculas ni signos) **o** dos puntos con coordenadas
  confiables a 100 m o menos. Se agrupan transitivamente. Las inactivas también cuentan (son las que se reactivan a mano).
- **Por validar** (no se importa): sin coordenadas, fuera de rango, (0, 0), o fuera de México sin país extranjero declarado.
  Límite conocido: la caja de México es holgada (`dentroDeMexico`, igual que el resto del módulo) y deja pasar puntos del
  sur de EE. UU. cercanos a la frontera; esos se detectan declarando `pais`.
- **Inactiva:** se cuenta y no se importa; vuelve a revisarse si se reactiva.

## Lista de validación por terminal

Para la revisión de los sábados: por terminal, con cupo diario configurable de **20 a 30** (20 por defecto; un valor fuera
de rango se ajusta al límite). Orden: primero lo «por validar», luego los posibles duplicados, luego las activas sin reparo.
Las de EE. UU. y otros países van en su propia lista; las sin terminal, en «(sin terminal)». Cada día trae como máximo el cupo.

## Importar

Modo «Solo analizar» no guarda nada. «Analizar e importar» guarda las filas **activas y con coordenadas confiables** por
lotes de 2 000 con el importador de la 0385 (todo o nada por lote). Si un lote falla, se dice cuántas filas ya quedaron
guardadas; volver a subir el archivo completa sin duplicar. No requiere migración.

## Pendiente de insumo

Falta la exportación real del catálogo y su formato; hoy el contrato está probado con filas sintéticas (13 440, tiempo
acotado). Cuando llegue, solo se ajustan alias de encabezado si hace falta.
