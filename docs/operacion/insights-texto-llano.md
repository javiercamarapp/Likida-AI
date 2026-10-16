# Guía de texto llano para los insights

Cada insight de los cinco agentes dice tres cosas, cada una en su línea: **qué pasó**, **qué significa** y **qué hacer**.
Se escriben para quien opera la flota, no para quien programa. El linter vive en `src/lib/likida/insights/llano.ts`
(`revisarTexto`, `revisarQueHacer`, `revisarInsight`) y se usa en pruebas sobre lo que produce `componer()`; no corre en pantalla.

## Reglas

1. **Una idea por línea.** Sin punto y coma ni dos oraciones en la misma línea.
2. **Máximo 140 caracteres por línea.**
3. **Qué hacer empieza con un verbo en infinitivo**: Revisar, Enviar, Pedir, Confirmar. Si no hay nada que hacer, «Nada por hacer».
4. **Nada de jerga.** Términos vetados y su sustituto:

| No decir | Decir |
|---|---|
| OCR | leer el documento |
| endpoint | conexión |
| payload | datos enviados |
| idempotente | que no se repite aunque se envíe dos veces |
| conciliar / conciliación | comparar |
| EFOS | proveedor en la lista del SAT de operaciones dudosas |
| webhook | aviso automático |
| JSON | archivo de datos |
| parsear | leer |
| timeout | se acabó el tiempo de espera |
| dashboard | panel |

5. **«Error» nunca a secas.** Decir qué falló: «falta un dato», «no coincide el monto», «error de captura».
6. **Siglas explicadas.** Solo se permiten sin explicar PDF, XML, GPS, IVA, RFC, MXN, USD, SAT y CFDI. Otra sigla va con su significado entre paréntesis.
7. **Candidatos, no acusaciones.** Nunca «cobro indebido» ni «cobro ilegal» si el texto no cita el tarifario que lo demuestra. Mientras falte,
   se dice «candidato a revisar» y se pide validarlo.

## Ejemplos por agente (datos sintéticos)

Las líneas `Mal` deben dar hallazgos y las `Bien` no; una prueba lo verifica (`llano.test.ts`).
El paréntesis indica a qué campo pertenece la línea.

### Liquidación

Ejemplo 1
- Mal (quePaso): «Se hizo OCR a 12 PDF y hubo error en 3 de ellos.»
- Bien (quePaso): «De 12 archivos recibidos, 3 no se pudieron leer.»
- Mal (queSignifica): «El payload no es idempotente.»
- Bien (queSignifica): «Esos 3 pagos no entran en el cálculo de la semana.»
- Mal (queHacer): «Sin liquidar hasta nuevo aviso.»
- Bien (queHacer): «Pedir de nuevo los 3 archivos.»

Ejemplo 2
- Mal (quePaso): «Hay que conciliar 8 viajes con la bitácora.»
- Bien (quePaso): «8 viajes no aparecen en la bitácora de la semana.»
- Mal (queSignifica): «Discrepancia en la conciliación de nómina.»
- Bien (queSignifica): «Esos viajes todavía no se pagan.»
- Mal (queHacer): «El área de pagos debe validar.»
- Bien (queHacer): «Comparar los 8 viajes con la bitácora.»

Ejemplo 3
- Mal (quePaso): «El timeout del envío dejó 5 recibos pendientes; falta firma.»
- Bien (quePaso): «5 recibos quedaron sin enviar.»
- Mal (queSignifica): «Los operadores no recibirán su desglose y hubo error.»
- Bien (queSignifica): «Cinco operadores no recibieron su desglose.»
- Mal (queHacer): «Reenviar manualmente cuando se pueda hacerlo y confirmar con cada operador, uno por uno, si recibió su desglose completo, bien y a tiempo esta semana.»
- Bien (queHacer): «Reenviar los 5 recibos.»

### Peajes

Ejemplo 1
- Mal (quePaso): «Cobro indebido en 6 cruces de clase 4.»
- Bien (quePaso): «6 cruces de clase 4 tienen una clase poco común.»
- Mal (queSignifica): «La IAVE cobró de más.»
- Bien (queSignifica): «Son candidatos a revisar, falta compararlos con el tarifario.»
- Mal (queHacer): «Reclamación inmediata.»
- Bien (queHacer): «Revisar los 6 cruces contra el tarifario.»

Ejemplo 2
- Mal (quePaso): «Hay 4 cobros ilegales del mes pasado.»
- Bien (quePaso): «4 cruces llegaron después del cierre del mes.»
- Mal (queSignifica): «Es un cobro fraudulento de la caseta.»
- Bien (queSignifica): «Son candidatos a reclamo, no un cobro confirmado.»
- Mal (queHacer): «Pago retenido.»
- Bien (queHacer): «Pedir la nota de crédito si el tarifario lo confirma.»

Ejemplo 3
- Mal (quePaso): «El endpoint de peajes regresó un JSON vacío.»
- Bien (quePaso): «Hoy no llegaron cruces nuevos.»
- Mal (queSignifica): «Falló con error.»
- Bien (queSignifica): «Puede ser que no hubo cruces o que no se cargó el archivo.»
- Mal (queHacer): «Verificar si hay payload.»
- Bien (queHacer): «Confirmar con el proveedor si hubo cruces ayer.»

### Carta porte

Ejemplo 1
- Mal (quePaso): «Faltan 3 CCP por timbrar y hay error de RFC.»
- Bien (quePaso): «3 cartas porte siguen sin timbrar.»
- Mal (queSignifica): «El EFOS bloquea el flujo.»
- Bien (queSignifica): «Sin timbre, esos 3 viajes no pueden circular en regla.»
- Mal (queHacer): «Pendiente de la validación.»
- Bien (queHacer): «Completar el RFC del cliente en las 3 cartas.»

Ejemplo 2
- Mal (quePaso): «El parseo del PDF falló en 2 documentos.»
- Bien (quePaso): «2 documentos PDF no se pudieron leer.»
- Mal (queSignifica): «Hubo un error.»
- Bien (queSignifica): «Los datos de esos 2 viajes no llegaron a la carta porte.»
- Mal (queHacer): «Intervención manual necesaria.»
- Bien (queHacer): «Capturar a mano los datos de los 2 viajes.»

Ejemplo 3
- Mal (quePaso): «Conciliar 7 viajes contra el dashboard de timbrado.»
- Bien (quePaso): «7 viajes no tienen carta porte asociada.»
- Mal (queSignifica): «Hay inconsistencias en los viajes del mes entre la bitácora, el sistema de transporte y los documentos que llegaron por correo en la última semana.»
- Bien (queSignifica): «Esos viajes salieron sin el documento que se exige.»
- Mal (queHacer): «Corregir antes de la salida; urgente.»
- Bien (queHacer): «Generar la carta porte de los 7 viajes.»

### Vigía (servicio al cliente)

Ejemplo 1
- Mal (quePaso): «Webhook de ubicación sin respuesta por timeout.»
- Bien (quePaso): «La unidad 12 no manda ubicación desde hace 40 minutos.»
- Mal (queSignifica): «Hubo un error con la ubicación.»
- Bien (queSignifica): «Puede llegar tarde y el cliente aún no lo sabe.»
- Mal (queHacer): «Se debe contactar al cliente.»
- Bien (queHacer): «Avisar al cliente que la entrega se puede retrasar.»

Ejemplo 2
- Mal (quePaso): «El ETA excede el SLA en 3 viajes.»
- Bien (quePaso): «3 viajes llegarán más tarde que la hora prometida.»
- Mal (queSignifica): «Incumplimiento del SLA.»
- Bien (queSignifica): «El cliente espera su carga antes de lo que se va a lograr.»
- Mal (queHacer): «Escalamiento inmediato.»
- Bien (queHacer): «Avisar a los 3 clientes con la nueva hora estimada.»

Ejemplo 3
- Mal (quePaso): «Dashboard sin datos de 5 viajes.»
- Bien (quePaso): «5 viajes no tienen ubicación registrada hoy.»
- Mal (queSignifica): «El payload llegó incompleto.»
- Bien (queSignifica): «No se puede avisar al cliente de esos viajes.»
- Mal (queHacer): «Sin acción.»
- Bien (queHacer): «Pedir la ubicación a los operadores de esos 5 viajes.»

### Conductores

Ejemplo 1
- Mal (quePaso): «Operador sin respuesta al webhook de check-in.»
- Bien (quePaso): «Un operador no confirmó su salida de hoy.»
- Mal (queSignifica): «Hay un error.»
- Bien (queSignifica): «No sabemos si ya salió a la ruta.»
- Mal (queHacer): «Llamada pendiente.»
- Bien (queHacer): «Llamar al operador y confirmar su salida.»

Ejemplo 2
- Mal (quePaso): «Jornada al 95 % del tope; el siguiente tramo lo excede.»
- Bien (quePaso): «Un operador lleva casi todas las horas de manejo de hoy.»
- Mal (queSignifica): «Riesgo de multa por incumplir la NOM.»
- Bien (queSignifica): «Si sigue, pasaría el límite de horas permitido.»
- Mal (queHacer): «Ajustes por revisar.»
- Bien (queHacer): «Cambiar el siguiente tramo a otro operador.»

Ejemplo 3
- Mal (quePaso): «Fotos de evidencia ilegibles por OCR en 4 viajes.»
- Bien (quePaso): «4 viajes tienen fotos que no se ven bien.»
- Mal (queSignifica): «Hay un error.»
- Bien (queSignifica): «Sin foto clara no se puede comprobar la entrega.»
- Mal (queHacer): «Evidencia por reponer.»
- Bien (queHacer): «Pedir al operador que vuelva a tomar las fotos.»
