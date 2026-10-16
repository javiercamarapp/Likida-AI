# Vigía: frontera con el sistema de transporte (TMS) para el correo de «datos del servicio»

Estado: **decisión de arquitectura propuesta, pendiente de revisión de la orquestadora y de Javier**. Elegida como base de trabajo:
**escenario (a) para lo que ya esté capturado en el sistema, con escenario (b) como respaldo mientras no lo esté**. El Vigía sigue
«Próximamente» para el cliente: este documento no activa nada ni promete fechas.

## Qué se pidió y qué se sabe

- La prioridad 1 del Vigía es dejar de mandar a mano, servicio por servicio, caja, placas, unidad, operador, licencia y teléfono. El
  cliente lo percibe como una carga de varias horas al día para la mayoría del equipo; **no hay cifra medida** (ver línea base de
  insights) y no debe presentarse como porcentaje de ahorro.
- Operaciones pidió que, al asignar la unidad en el sistema, salga **un correo al cliente, sin captura aparte,** con los datos del servicio del
  día siguiente. Hoy capturar esos datos son tres pantallas distintas (operador, remolque, tractor) y es trabajo manual.
- La persona de sistemas del cliente respondió que eso **se puede programar desde el requerimiento**, siempre que la información esté
  en el sistema (si viene de una hoja de cálculo, no), y que lo hablaría con desarrollo. **No dio fecha ni compromiso** (transcripción
  d445f2d3, 33:13–36:15).
- Hay dos constructores posibles para el mismo mensaje: sistemas, dentro del TMS; y nosotros, desde el programa de despacho
  (tareas T-A4-13 a T-A4-21). Sin una regla de frontera, el cliente final podría recibir dos correos, o ninguno.
- La planeación vive hoy **en dos sistemas**: unos equipos ya capturan en el sistema nuevo y otros en el viejo. Operaciones pidió una
  sola vía para ambos. Hasta que la planeación esté en un solo sistema, el correo del TMS solo cubre lo que ese sistema conoce.

## Escenarios

| Escenario | Quién emite el correo | Datos que dependen de que el planeador capture en el sistema | Costo | Riesgo | Qué se le dice al dueño |
|---|---|---|---|---|---|
| (a) | El TMS emite al asignar la unidad. El Vigía conserva priorización y «ASAP», lo que aún no está en el sistema (caja sin unidad, cambios de última hora), la ETA 1:1 y los avisos de excepción | Unidad, operador, remolque y caja asignados en el sistema; planeación del equipo que ya trabaja ahí | Bajo para nosotros (el correo es de sistemas); coordinación con sistemas | Depende del calendario de sistemas, que no hay; un equipo en el sistema viejo queda fuera hasta migrar | «El correo de datos sale del sistema cuando la asignación esté ahí; el Vigía cubre lo que falta y las excepciones.» |
| (b) | El Vigía emite desde el programa de despacho; el TMS no emite | Nada del sistema: lee el programa de despacho (importación ya construida) | Medio: terminar T-A4-13 a T-A4-21; ya hay código en stand-by | El programa puede traer datos viejos o incompletos; el cliente final recibe el correo desde otra fuente | «El Vigía manda el correo desde el programa de despacho mientras el sistema no lo haga.» |
| (c) | Ambos, con regla de «quién gana» y desduplicación por servicio | Lo mismo que (a) y (b) a la vez | Alto: dos emisores, clave común de servicio, prueba de duplicados | Correo doble o contradictorio si la regla falla; difícil de depurar | «Hay dos fuentes; la del sistema manda cuando existe.» |

### Recomendación

**(a) para lo que ya esté en el sistema y (b) como respaldo hasta entonces**, sin llegar a (c): el respaldo (b) se apaga para un servicio
en cuanto el sistema emite su correo. Para eso se necesita una **marca por servicio** («correo ya emitido por el sistema»). Mientras
esa marca no exista, el respaldo (b) se queda en stand-by y no se envía nada: preferimos no mandar a mandar dos veces.

Consecuencias en la COLA si se elige (a): T-A4-13 a T-A4-21 pasan a «en espera de frontera». **El código ya construido queda en
stand-by; no se borra.** La orquestadora aplica la nota correspondiente en la ficha del frente A4.

### Lo que se puede afirmar y lo que no

- Bajo el escenario (a), la intervención manual **desaparece solo para los servicios capturados completos en el sistema**; el resto
  sigue necesitando captura o el respaldo (b).
- Toda frase de automatización en este documento queda ligada al escenario (a), (b) o (c) por nombre; sin escenario elegido no se
  promete nada.
- No se promete fecha de sistemas. No se envía ningún correo al cliente final con el Vigía en «Próximamente».

## Preguntas para sistemas (máximo 5, cada una con fecha)

Las fechas son el día en que pedimos la respuesta, no un compromiso de sistemas.

1. ¿El correo de «datos del servicio» se puede emitir al asignar la unidad, y con qué campos exactos (caja, placas, unidad, operador,
   licencia, teléfono)? Fecha límite de respuesta: 2026-10-20.
2. ¿Cuándo estará la planeación de todos los equipos en un solo sistema, o qué equipos quedan en el sistema viejo? Fecha límite:
   2026-10-22.
3. ¿El sistema puede dejar una marca por servicio cuando emitió el correo, para que el Vigía no repita? Fecha límite: 2026-10-27.
4. ¿A qué dirección y con qué plantilla sale el correo al cliente, y puede configurarse por cliente? Fecha límite: 2026-10-29.
5. ¿Qué pasa con la caja si no hay unidad aún (aviso parcial, ninguno)? Fecha límite: 2026-10-30.

## Lo NO verificado

- Que sistemas pueda emitir el correo, con qué datos y cuándo: es una frase dicha en una reunión, no un compromiso.
- Que el programa de despacho traiga datos tan frescos como el sistema.
- El volumen de servicios por día y el tiempo real que ahorra el correo (línea base pendiente).
