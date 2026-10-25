# Lectura de la asignación desde el sistema de seguimiento del cliente (spike T-A5-62)

**Para qué sirve.** Cuando se asigna un viaje al chofer, el sistema de seguimiento que ya usa el cliente trae las instrucciones del
viaje, la ruta, las detenciones y las coordenadas del lugar de descarga. Si el Conductor pudiera leerlas, no habría que capturarlas
otra vez ni dependería de que alguien las copie. El propio cliente lo considera «una integración que se pudiera hacer», pero no es
sencilla y **no hay API confirmada**.

**Estado: spike, sin conexión real.** Existe la interfaz y un doble de pruebas; ninguna parte de este documento se ha probado contra
el sistema real. Nace apagado y nadie lo invoca aún desde el flujo del chofer; se enciende solo en la fase 2 y en la cuenta del
cliente piloto.

## Qué define el código

`conductor/lector_seguimiento.ts`:

- `LectorSeguimiento.leer(tenantId, viajeRef, ahora)`: devuelve la `AsignacionSeguimiento` del viaje (instrucciones, ruta, detenciones con
  orden y nombre, coordenadas del destino, hora de lectura) o `null`. **Solo lectura.**
- `leerAsignacionSeguimiento(puerto, tenantId, viajeRef, ahora)`: lee y limpia; no lanza nunca. Puerto ausente, fallo del sistema, referencia
  vacía, flota vacía o lectura inservible dan `null`. La asignación declara su `tenantId` y una lectura de otra flota se descarta
  (A37-S35-08: el `viajeRef` es del cliente y dos flotas pueden repetirlo; el adaptador real debe resolver credenciales por flota).
- `normalizarAsignacion`: descarta lecturas de más de 30 minutos, con hora futura o sin hora; descarta coordenadas fuera de rango o no
  finitas, detenciones sin nombre e instrucciones vacías; ordena las detenciones. Lo que el sistema no trae queda vacío o `null`: no
  se inventa.
- `lectorSeguimientoApagado` (por omisión) y `crearDobleSeguimiento` (pruebas, datos sintéticos).

No duplica la posición en vivo de la unidad (T-A5-15) ni los sitios o geocercas del transportista (T-A5-16): esto es lo **planeado**
al asignar, aquello es lo **observado** durante el viaje. Cuando exista el adaptador real, los destinos y detenciones leídos aquí
deberían contrastarse con los sitios propios antes de usarse.

## Qué hay que preguntar al cliente (preguntas pendientes)

1. **Modo de acceso.** ¿Tiene API para terceros, puede entregar una exportación periódica (archivo o correo programado) o solo
   permite consulta manual en pantalla? Si es solo consulta manual, la integración deja de ser automática.
2. **Autenticación.** ¿Llave de API, usuario de servicio, OAuth o sesión de navegador? ¿Quién la emite y cómo se revoca? Debe ser
   una credencial de solo lectura, propia de esta integración y no la de una persona.
3. **Límites.** Frecuencia máxima de consulta, tamaño de lote, ventanas de mantenimiento y costo por uso, si lo hay.
4. **Contenido.** ¿Las instrucciones son texto libre o campos estructurados? ¿La ruta viene como puntos, como lista de lugares o
   solo como texto? ¿Las detenciones traen orden y coordenadas? ¿Las coordenadas del destino vienen siempre o solo a veces? ¿Hay una
   referencia de viaje estable y cómo se relaciona con nuestro folio?
5. **Oportunidad.** ¿La información existe desde que se asigna el viaje o se completa después? ¿Cuánto tarda en reflejarse un cambio
   (reubicación de rampa, cambio de destino)?
6. **Contacto técnico.** Persona o área responsable del sistema que pueda confirmar lo anterior y autorizar un entorno de pruebas.
7. **Permiso y datos.** Confirmar por escrito que el cliente autoriza leer su sistema para esta finalidad y qué campos no deben
   copiarse.

## Bloqueo externo

Acceso, API o exportación del sistema del cliente y su contacto técnico. Hasta tenerlos, esta pieza solo entrega el contrato
(interfaz y doble) para que el adaptador real sea un cambio acotado cuando haya respuesta.

## Guardias

Sin credenciales ni red en el repositorio; solo lectura; apagado por omisión; sin coordenadas ni textos de instrucciones en logs;
sin datos reales (las pruebas usan datos sintéticos). El perfil de fase 1 sigue mostrando el Conductor como «Próximamente».
