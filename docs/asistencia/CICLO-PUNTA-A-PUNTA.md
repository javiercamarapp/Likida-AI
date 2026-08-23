# El ciclo del back office de transporte, etapa por etapa (23-ago-2026)

Catálogo real en producción: **58 agentes — 10 vivos, 48 diseñados.**
Y los 48 se dividen en dos cosas que NO son lo mismo, y confundirlas ha sido el error de lectura:

- **Agentes de PRODUCTO** (operan la flota del cliente): 6 vivos — `liquidacion`, `facturas`,
  `peajes`, `proveedores`, `conductores`, `cobranza`. Diseñado y apagado: `experto_fiscal`.
- **Agentes de LA STARTUP** (operan Likida como empresa): 4 vivos — `copiloto`, `guardia_alertas`,
  `redactor`, `ventas`. Los otros 44 diseñados son el organigrama de Likida (crecimiento 10,
  ingeniería 8, leads 8, back_office 8, dirección 7, éxito de cliente 6). **No son huecos de
  producto**, y contarlos como tales infla el problema.

El hueco real de producto se mide contra el ciclo, no contra el catálogo.

## Las 14 etapas y quién las cubre hoy

| # | Etapa | Estado | Quién |
|---|---|---|---|
| 1 | Cotizar el flete | ❌ **VACÍO** | tabla `cotizacion` sin escritor, 0 filas |
| 2 | Alta de flota / unidades / operadores | ⚠️ parcial | onboarding existe; **`unidad` tiene 0 filas en G3M** |
| 3 | Planear y asignar el viaje | ⚠️ manual | se captura, no se planea |
| 4 | Carta Porte y documentación | ⚠️ parcial | se emite; **nadie vigila `ValorMercancia` ni `AseguraCarga`** |
| 5 | **Ejecución en carretera** | ❌ **VACÍO** | `posicion` 0 filas, `geocerca` sin lector — **es el agente nuevo** |
| 6 | Gastos en ruta | ✅ | `peajes`, `proveedores`, talacha |
| 7 | Comprobantes y OCR | ✅ | `facturas` |
| 8 | Liquidación del viaje | ✅ | `liquidacion` — el corazón, y está bien |
| 9 | Facturar al cliente | ✅ | `facturas` + timbrado |
| 10 | Cobranza | ✅ | `cobranza` |
| 11 | Pagar al operador | ✅ | `conductores` |
| 12 | Cierre fiscal y contable | ⚠️ | `experto_fiscal` DISEÑADO Y APAGADO |
| 13 | Mantenimiento de unidades | ❌ **VACÍO** | tabla `mantenimiento` sin escritor, 0 filas |
| 14 | Cumplimiento (licencias, pólizas, verificaciones, multas) | ❌ **VACÍO** | `unidad.poliza_vence` es una fecha suelta que nadie lee |

**Veredicto: el back office está cerrado del 6 al 11.** Es la mitad que produce el dinero, y por eso
Likida ya vende. Lo que falta es lo de ANTES del viaje (1-5) y lo de DESPUÉS del peso (12-14).

## Por qué el orden correcto es 5 → 14 → 13 → 1

No es el orden del ciclo: es el orden del valor.

1. **Etapa 5 (carretera)** primero porque es la única donde el software toca al chofer en el peor
   momento de su día, y donde una flota siente que el sistema le sirve. Además su ausencia hoy
   produce un bug activo: una foto de un choque entra al OCR y el chofer recibe *"esa foto salió
   difícil de leer"*.
2. **Etapa 14 (cumplimiento)** después porque es puro reloj sobre datos que Likida YA tiene, sin
   integración externa, y porque los montos son brutales: sobrepeso >3 t cuesta ~$8,800 **por
   tonelada**, y reincidir dos veces en 2 años faculta a la SICT a **revocar el permiso**.
   Un aviso de "tu carta porte no declara valor" evita cobrar $1,759/tonelada por una caja perdida.
3. **Etapa 13 (mantenimiento)** porque la tabla ya existe y es el insumo que vuelve predecible a la 5.
4. **Etapa 1 (cotizar)** al final porque es la más grande, la que más se parece a un CRM y la que
   compite con software que las flotas ya tienen.

## Lo que NO hay que construir
`experto_fiscal` no es un agente nuevo: la ley fiscal ya vive en TypeScript y probada
(RMF 9.1.8, LISR 27-III, LIVA 5-III, RFA 2.9, LIF 20-A). Encenderlo es exponer lo que existe,
no escribir un cerebro.
Y las 44 fichas del organigrama de Likida no se construyen "para cerrar el back office":
se construyen cuando Likida tenga el problema que resuelven.
