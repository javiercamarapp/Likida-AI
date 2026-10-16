# Siguiente paso posible: conciliar diésel y urea (vale, factura, viaje)

Estado: **diferido, decide el dueño; no cotizado.** Este documento solo ordena lo que pidió el cliente para poder decidir; no se construye nada ni se promete fecha.

Documentos hermanos: [conciliacion-peajes.md](conciliacion-peajes.md) y [peajes-revision-cobros.md](peajes-revision-cobros.md).

## Por qué se menciona

Al cerrar la sesión de peajes, finanzas planteó como siguiente paso conciliar combustible: después de nóminas, diésel y urea son lo que más dinero se gasta, y el diésel pesa varias veces más que los peajes. Quedó como nota para platicarlo con el dueño, porque los agentes actuales ya están cotizados sin esto.

## Requisitos citados (sesión de casetas, GPS y combustibles, 14-oct)

1. **Vale, factura y viaje con un número común.** El vale se hace por un tope de litros (todavía no se sabe cuánto cargará); el proveedor lo captura y luego se ajusta a los litros reales. Hoy la conciliación solo comprueba que lo cobrado esté en el sistema, no que corresponda a un viaje real ni a los litros que se debieron gastar. En el reporte del proveedor aparece el número de vale, no la unidad, y no hay una llave que amarre los tres documentos (26:40 a 31:25).
2. **Varias cargas por viaje.** Un mismo viaje puede cargar en distintos lugares y con distintos proveedores; esos vales «se pierden del radar» si no se ligan al viaje correcto (28:09). Sobran vales sin cobro y puede haber vales cobrados sin saber para qué viaje fueron (30:51).
3. **Cargas sin bitácora.** Permisionarios y unidades locales cargan y registran vale pero no hacen bitácora, así que sus litros no aparecen en el resumen mensual de bitácoras (32:12 a 33:44).
4. **Rendimiento que no cuadra.** El rendimiento promedio por litros comprados no coincide con el que sale de litros contra kilómetros del sistema, porque faltan los kilómetros de esas cargas sin bitácora (33:44). Se pidió que el sistema calcule los litros que debió gastar cada viaje (por kilómetros y parametrización de la unidad) y avise de la diferencia (46:12).
5. **Urea ligada al vale.** Cada carga de diésel debe ir con su carga de urea y, si no están amarradas, la bitácora no se cierra y no debería pagarse (37:17 a 40:39). Se pidió resolver primero el diésel y luego «el gemelo» para urea.
6. **Qué se busca.** No perseguir vales de más uno por uno, sino tener visible el dato todo el tiempo para que alguien lo atienda (34:47, 46:59).

## Fuentes que haría falta

| Fuente | Quién la tiene | Estado |
|---|---|---|
| Reporte de vales (vale, unidad, viaje, litros) | Sistema de transporte del cliente | Sin muestra |
| Facturas o reportes de cada proveedor de combustible | Proveedores | Sin muestra; cada uno trae su propio formato |
| Bitácoras de viaje (kilómetros, litros, vale de diésel y de urea) | Sistema de transporte del cliente | Sin muestra |
| Parametrización de rendimiento por unidad | Sistema de transporte del cliente | Sin muestra |

## Reglas candidatas (a validar con el cliente)

- **R1** Vale sin factura de proveedor: marcar «vale sin cobro» después de un plazo configurable.
- **R2** Factura sin vale: marcar «cobro sin vale» para revisión.
- **R3** Vale ligado a un viaje cuya ruta y fechas no justifican los litros (litros reales contra litros esperados por kilómetros), con tolerancia configurable.
- **R4** Viaje con bitácora sin vale de diésel o sin vale de urea: señalar que no debería cerrarse.
- **R5** Vales de unidades de permisionario o locales sin bitácora: listarlos aparte para no distorsionar el rendimiento.
- **R6** Varias cargas del mismo viaje: sumarlas antes de comparar contra litros esperados.

Todas serían señales para revisar, no acusaciones a una persona; un faltante puede ser captura, formato del proveedor o un viaje mal ligado.

## Preguntas para el dueño (máximo 8)

1. ¿Se quiere abrir este frente ahora o después de cerrar peajes? ¿Se cotiza aparte?
2. ¿Qué reporte de vales exporta hoy el sistema de transporte y con qué columnas?
3. ¿Cuántos proveedores de combustible hay y en qué formato entrega cada uno su factura o reporte?
4. ¿Existe un número común entre vale, factura y viaje, o hay que construirlo (por ejemplo, el número de vale como llave)?
5. ¿Cómo se registra hoy una segunda o tercera carga del mismo viaje?
6. ¿Se pueden obtener las bitácoras de permisionarios o solo sus vales?
7. ¿Qué tolerancia de litros se acepta entre lo esperado y lo cargado?
8. ¿Quién recibe las diferencias y con qué frecuencia?

## Estimación

Tamaño orientativo, sin compromiso: un lote de importación y cruce (vale contra factura) más reglas R1 a R6 es comparable en forma al módulo de conciliación de peajes, y depende de contar antes con muestras reales de las cuatro fuentes. La urea sería una extensión del mismo cruce. No se estima tiempo calendario.

## Fuera de alcance

Construir importadores, reglas o pantallas; prometer fecha o precio; tocar la captura de vales del cliente.
