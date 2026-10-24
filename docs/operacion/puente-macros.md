# Puente WhatsApp → macro del proveedor de telemetría (spike T-A5-55)

**Para qué sirve.** Hoy el operador reporta paradas y llegadas con una «macro» en el equipo del proveedor de telemetría, y cerca de la
mitad no las manda (se les levanta incidencia y pierden bono). Idea surgida en la reunión de monitoreo: que el mismo mensaje de
WhatsApp del chofer («detención») dispare además la macro en el sistema del proveedor, «dos pájaros de un tiro», y así se omitan las
macros manuales.

**Estado: spike, sin conexión real.** Existe la interfaz y un doble de pruebas; nada de este documento se ha probado contra el
proveedor. Nace apagado y nadie lo invoca desde el flujo del chofer. **No se enciende sin la decisión D-2** y la capacitación al
operador es presencial: esto no se comunica como promoción ni sale en plantillas.

## Decisión pendiente (D-2)

Dirección debe decidir si el WhatsApp **sustituye** a las macros, **coexiste** con ellas (este puente) o se queda solo como reporte
propio. El 15-oct operaciones propuso quitar el tema de las macros y el dueño ya había dicho «en lugar de macro, por WhatsApp»
(sin acta). Recomendación de diseño: **reemplazo, sin puente**; este puente solo se construye de verdad si dirección pide coexistir.
La pregunta ya está redactada en `preguntas-javier.md` (D2). Tampoco se mete costo: si el proveedor cobra por macro o por API,
se documenta aquí y se pregunta antes de encender.

## Qué define el código

`conductor/emisor_macro.ts`:

- `EmisorMacro.emitir(macro)`: el puerto. Devuelve `enviada`, `duplicada` o `apagado`; cualquier otra cosa o un lanzamiento cuenta
  como fallo.
- `emitirMacro(puerto, evento, ahora, { habilitado })`: valida y emite; **no lanza nunca**. Resultado: `apagado` (perilla falsa por
  omisión, sin puerto o emisor apagado), `invalida`, `enviada`, `duplicada` o `fallo`.
- `normalizarEventoMacro`: descarta evento sin id, sin viaje, de tipo desconocido (`detencion`, `llegada`, `salida`) o con hora
  inválida o futura (más de 2 min). No inventa: el motivo vacío queda ausente.
- Idempotencia: `claveMacro` = `flota|viaje|tipo|evento` (A37-S35-08: el `viajeRef` es del proveedor y dos flotas pueden repetirlo; `EventoMacro.tenantId` es obligatorio). El mismo evento reintentado nunca duplica la macro; el adaptador real debe
  respetar esa clave (o pedir al proveedor una llave de idempotencia equivalente).
- `emisorMacroApagado` (por omisión) y `crearDobleEmisorMacro` (pruebas, datos sintéticos).

## Qué hay que preguntar al cliente / al proveedor

1. **Endpoint y modo de acceso.** ¿Hay API para terceros que acepte una macro por viaje y unidad, o solo la consola del proveedor?
   Si solo hay consola, el puente no es automático y deja de tener sentido.
2. **Autenticación.** ¿Llave de API, usuario de servicio u OAuth? ¿Quién la emite y cómo se revoca? Debe ser una credencial propia de
   esta integración, no la de una persona.
3. **Límites.** Frecuencia máxima, tamaño de lote, ventanas de mantenimiento y comportamiento ante reintentos (¿acepta clave de
   idempotencia o duplica?).
4. **Costo.** ¿Cobra por macro, por llamada o por licencia? Sin meter costo adicional al cliente sin su visto bueno.
5. **Mapeo.** ¿Qué macros existen hoy (detención, llegada, salida, otras) y cómo se corresponden con nuestros eventos? ¿Cómo se
   relaciona su referencia de viaje con nuestro folio?
6. **Bono y monitoreo.** Si el reporte por WhatsApp cuenta como macro para el bono, ¿quién lo autoriza por escrito? (Ver T-A5-67:
   solo constancia de reportes, sin calcular bono.)
7. **Contacto técnico** del proveedor y entorno de pruebas.

## Bloqueo externo

D-2 (decisión de dirección) y acceso a la API del proveedor con su contacto técnico. Hasta tenerlos, esta pieza solo entrega el
contrato (interfaz, validación y doble) para que el adaptador real sea un cambio acotado.

## Guardias

Sin credenciales ni red en el repositorio; apagado por omisión; idempotente; sin datos reales (las pruebas usan datos sintéticos);
sin nombres de personas o empresas del cliente. El perfil de fase 1 sigue mostrando el Conductor como «Próximamente».
