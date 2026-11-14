# Prueba del agente de liquidaciones: plan por etapas

Documento neutro: no nombra a ninguna flota. Los identificadores y montos de ejemplo son inventados. Para el mecanismo de envío
por correo ver `liquidacion-desglose-correo.md`; para el contrato y las banderas del webhook, `conexion-tms.md` (8.6).

## 1. Qué se prueba y qué se acordó

El sistema de transporte de la flota manda las bitácoras a `POST /api/v1/liquidaciones-externas/desgloses` y Likida arma el
desglose, lo retiene o lo programa, y lo entrega por correo al coordinador y a recursos humanos. Lo acordado el 5-nov:

- **Un lote diario único**, por tarea programada: una sola corrida al día, de 40 a 70 bitácoras, en ráfaga.
- `Percepciones` y `Deducciones` son **arreglos** (percepciones con cargo mayor que cero, deducciones con abono mayor que cero).
- La bitácora y el comprobante al operador van **separados**; el comprobante sale al final del día.
- Los nombres de concepto de RH **no se cambian**; la columna `desglose` del origen no se interpreta.

## 2. Auditoría del esquema actual (solo lectura, 14-nov-2026)

Revisado contra `desgloses/route.ts`, `desglose_muestra_recepcion.ts`, `desglose_muestra_tms.ts` y `desglose_resultados.ts`.

| Punto acordado | Qué hace hoy | Veredicto |
|---|---|---|
| Arreglos `Percepciones` / `Deducciones` | Cada renglón es `{ "Descripcion": texto, "Monto": número }`. Los dos bloques traen montos **positivos**; el bloque da el signo. Monto 0 se ignora con nota; negativo, nulo, texto o más de 2 decimales mandan **esa** bitácora a revisión. | Cumple. |
| Cargo mayor que cero / abono mayor que cero | Resuelto (14-nov-2026). En `Percepciones` el monto es `Monto` y, si no viene, `Cargo`; en `Deducciones`, `Monto` y, si no viene, `Abono`. Con `Monto` y el sinónimo **distintos**: `en_revision` con `monto_ambiguo` (no se adivina ni se suma). El signo lo da el arreglo; `Abono` en percepciones o `Cargo` en deducciones no valen. Sin sinónimos, igual que antes (`monto_nulo`). | Cumple. Compatible hacia atrás. |
| Ráfaga de 70 | Tope de 100 bitácoras, 100 renglones por bloque y 2 MB por petición (101 es 400 sin procesar nada). Límite de 240 peticiones por minuto por flota. | Cumple en cantidad. **Riesgo de tiempo:** la ruta procesa en serie y tiene 60 s de límite; cada bitácora real genera su Excel y lo sube a almacenamiento. 70 en una sola petición real no está medido. Recomendación: dos peticiones de 35 (el script lo hace por omisión). En simulación no hay Excel ni almacenamiento y 70 es holgado. |
| Reintentos idempotentes | Clave `BIT-<BitacoraID>`. Misma clave y mismo contenido: estado `idempotente`, no inserta ni reenvía. Un fallo de infraestructura a mitad es 500 y es seguro reintentar **todo**. | Cumple. |
| Mismo `BitacoraID` con otro contenido | No sobrescribe: estado `correccion_pendiente` y una persona decide. | Cumple. El formato de muestra no puede mandar una corrección explícita (`-R<n>`); solo el contrato interno lleva `correccion`. |
| Campos desconocidos | Dentro de una bitácora se **ignoran** (la aceptación no cambia), pero ahora se **avisan**: `resultados[i].advertencias` = `[{ codigo: 'campo_desconocido', campo }]`, solo el nombre del campo (nunca el valor), máx. 10 por bitácora, sin repetidos; la llave solo sale si hay alguna. En el sobre (`formato`, `version`, `bitacoras`) un campo extra sigue siendo 400. Un cuerpo que mezcla formato de muestra y contrato interno es 400. | Cumple. Una errata como `Póliza` ya no pasa en silencio: queda en `advertencias`. La etapa B puede apoyarse en ellas además de la comparación campo por campo. |
| Errores claros por registro | `resultados` trae una entrada por bitácora, en el orden enviado: `indice`, `bitacora`, `folio`, `estado` y `motivos` (código y nombre del campo, nunca valores personales). Una bitácora mala no tumba a las demás. | Cumple con el formato de muestra. El contrato interno, en cambio, valida **todo antes de escribir** y un solo error es 400 para el lote completo. |
| Conceptos sin cambiar | El catálogo de conceptos es cerrado (`CATALOGO_CONCEPTOS_MUESTRA`). Un concepto fuera del catálogo se **conserva** pero manda la bitácora a revisión (`concepto_desconocido`). El Excel muestra la `Descripcion` original. | Cumple, con condición: el catálogo real de RH lo entrega el cliente y se agrega con un cambio de código. |
| Seis tipos de operador | `foraneo`, `local`, `permisionario`, `rabon`, `posturero`, `cargador` (tolera mayúsculas y acentos). Por omisión solo foráneo y local reciben correo; los demás quedan `retenida` con `tipo_sin_regla` hasta habilitarlos en la configuración de la flota. | Cumple. |
| Póliza provisional | Sin `Poliza`: o no se guarda (`no_guardada`, `sin_poliza`) o, con la perilla `poliza_provisional` de la flota encendida, se guarda marcada «póliza provisional» y **siempre retenida** hasta que una persona la libera. | Cumple. |
| Simulación | Cabecera `Likida-Simular: si`: mismos `resultados` y `simulada: true`, sin escribir nada, siempre 200. Un valor distinto de `si`/`no` es 400. | Cumple. |
| Autenticación | `Authorization: Bearer <llave>`, una llave por flota y área (esta ruta pide el área administración). La flota sale de la llave, nunca del cuerpo. | Cumple. |

**Precondición que sorprende.** El formato de muestra está **apagado y falla cerrado (403)**, también en simulación. Para la etapa A
hacen falta: variable de plataforma `LIKIDA_TMS_MUESTRA=si` (un redeploy), interruptores `global` y `agente:liquidacion`
encendidos, y la flota con «Activar el envío» y canal `correo`. Para que activar el envío no mande nada en las etapas A y B,
poner antes una **fecha de corte** futura en la configuración: toda bitácora cuyo periodo termine antes de esa fecha nace con sus
entregas en `omitida`. El cambio de variable de plataforma es un despliegue; agruparlo con otros cambios (regla de builds).

Conclusión: la diferencia de `Cargo`/`Abono` frente a `Monto` quedó cerrada con sinónimos estrictos y los campos desconocidos ahora
se avisan en `advertencias` (ambos cambios aditivos, sin renombrar nada). Lo que sigue abierto es el riesgo de tiempo de una
petición real de 70 (se mitiga con dos peticiones y se mide en la etapa D) y confirmar con el cliente que `Cargo`/`Abono` es lo que
manda el origen.

## 3. Plan por etapas

### Etapa A. Conexión y autenticación con una bitácora de muestra (simulación)

Objetivo: demostrar que el sistema del cliente llega a Likida y que Likida entiende su formato, sin escribir nada.

1. Likida entrega la llave de API (área administración) por un canal privado, nunca por chat ni correo abierto.
2. El cliente manda **una** bitácora con la cabecera `Likida-Simular: si`.
3. Cómo leer la respuesta (siempre `datos.resultados`):

| Respuesta | Significa |
|---|---|
| HTTP 200, `simulada: true`, `estado: recibida` | Habría quedado guardada y programada. Todo en orden. |
| `estado: retenida` con motivos | Habría quedado guardada pero sin enviarse hasta que una persona la libere (póliza provisional, `tipo_sin_regla`, neto negativo). |
| `estado: en_revision` | No se habría guardado: falta o falla un dato. `motivos[].campo` dice cuál. |
| `estado: no_guardada` | No se habría guardado: operador sin alta, sin póliza (perilla apagada) o bitácora duplicada. |
| HTTP 401 `no_autenticado` | Llave ausente, mal escrita o revocada. |
| HTTP 403 `sin_permiso` | Formato de muestra apagado para la flota, o la llave no es del área administración. |
| HTTP 400 `parametro_invalido` | Sobre mal formado (campo extra, lote vacío, más de 100, cabecera de simulación con valor raro). |
| HTTP 429 `demasiadas_peticiones` | Más de 240 peticiones por minuto. |

Herramienta de Likida para ensayar sin depender del cliente:

```
node scripts/probar-webhook-liquidaciones.mjs --url https://<host> --n 1 --dry-run     # solo muestra lo que mandaría
node scripts/probar-webhook-liquidaciones.mjs --url https://<host> --n 1               # simulación real contra el endpoint
```

El script pide la llave en un diálogo oculto de macOS (nunca por argumento ni en pantalla), usa simulación por omisión y solo
escribe con `--real --confirmo-escritura`. Las bitácoras sintéticas llevan identificador `PRB-…` y operadores ficticios; si la
flota de prueba no los tiene dados de alta saldrán `en_revision` con `operador_no_encontrado`, que es lo esperado. Para usar
operadores reales de la flota de prueba: `--padron padron.json` con `[{ "numeroEmpleado": "…", "nombre": "…" }]`.

Salida de la etapa: una bitácora de muestra con `estado` explicable y sin errores de autenticación.

### Etapa B. Lote completo en simulación

Objetivo: validar los 40 a 70 registros de una corrida típica sin enviar correos ni guardar nada.

1. El cliente ejecuta su tarea programada apuntando al endpoint con `Likida-Simular: si` (una corrida; 70 en una petición alcanza en
   simulación, o dos peticiones de 35).
2. Likida ensaya el mismo volumen por su lado: `node scripts/probar-webhook-liquidaciones.mjs --url … --n 70`.
3. Revisión conjunta, en una tabla de dos columnas (lo que mandó el origen, lo que respondió Likida):
   - **Campos**: ninguno mal escrito (los campos desconocidos se ignoran sin avisar; comparar contra la lista de la sección 4).
   - **Conceptos**: todos reconocidos. Cada `concepto_desconocido` es un nombre que falta en el catálogo; se agrega y se vuelve a
     probar. Los nombres no se cambian.
   - **Tipos de operador**: los seis valores llegan bien escritos; los que no reciben correo salen `retenida` con `tipo_sin_regla`
     y la flota decide cuáles habilitar.
   - **Padrón**: cada `NumeroEmpleado` existe en el padrón de la flota; si no, `operador_no_encontrado`.
   - **Montos y neto**: dos decimales, positivos; si se manda `Neto`, cuadra con percepciones menos deducciones
     (si no, `total_no_cuadra`).
   - **Póliza**: cuántas vienen vacías y qué se quiere hacer (perilla provisional o esperar la póliza).
4. Reintento: repetir la misma corrida y confirmar que el resultado es idéntico (en simulación todo se repite igual).

Salida: 0 bitácoras en `en_revision` por causas del formato; las que queden son datos del padrón o del catálogo con dueño y fecha.

### Etapa C. Comparación contra su Excel de una corrida real del día anterior

Objetivo: demostrar que lo que Likida calcularía coincide con lo que la flota ya manda hoy.

1. El cliente elige una corrida real del día anterior con **3 coordinadores** distintos y su Excel actual de desglose por bitácora.
2. Esa corrida se manda en simulación; Likida arma el desglose en modo vista previa y se compara bitácora por bitácora:
   operador, unidad, periodo, cada renglón (concepto y monto), total de percepciones, total de deducciones y neto.
3. Tolerancia: **cero centavos** de diferencia. Likida no recalcula: si algo no coincide, el error está en cómo se mapeó un campo o
   en un concepto, no en una operación aritmética.
4. Se registra cada diferencia con su causa y se corrige en el origen o en el catálogo antes de seguir.

Salida: 100 % de las bitácoras de la muestra coinciden, o cada diferencia tiene causa explicada y corregida.

### Etapa D. Envío real a un coordinador y a RH de prueba

Objetivo: probar el correo de verdad, con personas que saben que es una prueba.

1. Configurar la flota de prueba: canal `correo`, remitente y respuesta, **un** coordinador de prueba y **un** correo de RH de
   prueba, perilla de póliza provisional encendida si el origen aún no manda póliza, y **modo primer mes** con los revisores
   nombrados por el cliente.
2. Poner la **fecha de corte** en el primer periodo que sí debe enviarse y usar la vista previa con confirmación del panel
   (cuenta «N desgloses / M correos» antes de subir).
3. Mandar una corrida corta (5 a 10 bitácoras, de preferencia dos peticiones para medir el tiempo) y activar el envío.
4. Revisión humana: el coordinador y RH de prueba reciben el correo, abren el Excel y lo comparan contra el origen. Una póliza
   provisional **siempre** nace retenida: una persona la libera y se verifica que el correo lleve la marca «póliza provisional».
5. Confirmar: un correo por destinatario, sin importes en el asunto ni en el cuerpo, estado de entrega (`entregada`), y el reintento
   de la misma corrida devuelve `idempotente` sin segundo correo.
6. El comprobante al operador va aparte, al final del día: se verifica por separado y no forma parte de esta ruta.

Salida: correos recibidos y revisados por personas, sin duplicados, con el tiempo de la petición medido.

### Etapa E. Criterios de salida

Se pasa a producción solo si se cumplen **todos**:

- Una semana de corridas diarias sin `en_revision` por formato ni por catálogo.
- Cero diferencias de centavos en la comparación contra su Excel (etapa C) en al menos 3 corridas.
- Una corrida real de 70 sin error de tiempo (HTTP 5xx o 60 s agotados).
- Reintentos idempotentes comprobados.
- Revisores del primer mes nombrados y la regla para bitácoras retenidas acordada.
- Decisión escrita sobre póliza (provisional o esperar), tipos de operador que reciben y fecha de corte.
- Plan de apagado probado: `activa = false` en la configuración o interruptor `agente:liquidacion`.

Qué necesitamos del cliente en cada etapa:

| Etapa | Datos que necesitamos |
|---|---|
| A | Quién ejecuta la tarea programada; desde qué dirección o red sale; un canal privado para entregarle la llave; confirmar si usan token o usuario y contraseña (sección 5). |
| B | **Padrón de operadores** (número de empleado y nombre) cargado o entregado; **catálogo completo de conceptos** de percepciones y deducciones tal como los escribe RH; confirmación de los seis tipos de operador y de si el campo se llama `Monto` o `Cargo`/`Abono`. |
| C | La corrida real del día anterior (3 coordinadores) y su Excel actual; el listado de coordinadores con su correo. |
| D | **Correo remitente** de la empresa y a dónde deben llegar las respuestas; correo de RH (hasta 3); correos de coordinadores; **revisores** del primer mes (uno por departamento); decisión sobre póliza; fecha de corte; ventana horaria de envío. |
| E | Aprobación escrita de los revisores y de la persona que administra la flota. |

## 4. Referencia de campos (formato de muestra, versión 1)

Sobre: `{ "formato": "muestra-tms", "version": 1, "bitacoras": [ … ] }` o una bitácora suelta con `BitacoraID`.

| Campo | Obligatorio | Nota |
|---|---|---|
| `BitacoraID` | sí | Entero o texto `[A-Za-z0-9._-]`, hasta 40. Es la llave de idempotencia. |
| `Operador` | sí (o `NumeroEmpleado`) | Nombre; se compara sin acentos ni mayúsculas contra el padrón. |
| `NumeroEmpleado` | no | Si viene, manda sobre el nombre; si el nombre no coincide, revisión `operador_no_coincide`. |
| `Unidad` | sí | Texto corto. |
| `Fecha.Inicia`, `Fecha.Termina` | sí | `yyyy-MM-dd HH:mm:ss`, hora de México. |
| `Percepciones[]`, `Deducciones[]` | al menos un renglón con valor | `{ Descripcion, Monto }`, `Monto` positivo con hasta 2 decimales. |
| `TipoOperador` | no | Sin él: `tipo_sin_regla`, queda retenida. |
| `Poliza` | no | Texto hasta 40 o null. |
| `NumeroPago`, `Folio`, `Neto` | no | `Neto` debe cuadrar con los renglones. |

## 5. Errores comunes y su causa

| Lo que se ve | Causa probable | Qué hacer |
|---|---|---|
| 401 `no_autenticado` | Llave mal pegada (espacios), vencida o revocada; falta `Bearer ` | Reemitir la llave; revisar la cabecera `Authorization`. |
| 403 `sin_permiso` en el primer intento | Formato de muestra apagado (bandera, interruptores o «Activar el envío» con canal correo) o llave de otra área | Revisar las cuatro condiciones de la sección 2; no hay mensaje que diga cuál falta, a propósito. |
| 400 «campos que el contrato no tiene» | Campo extra en el sobre, o cuerpo que mezcla formato de muestra y contrato interno | Quitar el campo; usar un solo formato. |
| 400 «Máximo 100 bitácoras» | Lote de más de 100 | Partir en peticiones de 35 a 50. |
| 400 por tamaño | Cuerpo mayor de 2 MB | Partir el lote. |
| 400 en `Likida-Simular` | Valor distinto de `si` o `no` | Usar `si`. |
| 429 | Más de 240 peticiones por minuto | Una petición por lote, no una por bitácora. |
| 500 o corte a los 60 s | Petición real demasiado grande | Reintentar **todo** (es seguro, lo guardado vuelve `idempotente`) y partir en peticiones menores. |
| `en_revision` `operador_no_encontrado` | El nombre o el número no está en el padrón de la flota | Dar de alta al operador o corregir el dato. |
| `en_revision` `operador_homonimo` | Dos operadores con el mismo nombre | Mandar `NumeroEmpleado`. |
| `en_revision` `operador_no_coincide` | Nombre y número apuntan a personas distintas | Corregir en el origen. |
| `en_revision` `concepto_desconocido` | Descripción que no está en el catálogo | Agregarla al catálogo (cambio de código) sin renombrarla. |
| `en_revision` `concepto_lado_inesperado` | Concepto de deducción en percepciones o al revés | Corregir el lado en el origen. |
| `en_revision` `monto_nulo` / `monto_no_numerico` | Renglón sin `Monto` ni su sinónimo (`Cargo` en percepciones, `Abono` en deducciones), `Abono`/`Cargo` del lado contrario, o monto como texto | Mandar `Monto` (o el sinónimo del lado correcto) numérico. |
| `en_revision` `monto_ambiguo` | Vienen `Monto` y `Cargo`/`Abono` con valores distintos | Mandar solo uno de los dos. |
| `advertencias` `campo_desconocido` | Un campo que no pertenece al contrato (p. ej. `Póliza` mal escrito); no cambia el estado | Corregir el nombre en el origen; el campo se ignoró. |
| `en_revision` `monto_decimales` / `monto_negativo` | Más de 2 decimales o signo negativo | Mandar positivo con dos decimales; el bloque da el signo. |
| `en_revision` `total_no_cuadra` | `Neto` distinto de percepciones menos deducciones | Corregir el neto o quitarlo. |
| `en_revision` `fecha_invalida` / `fechas_invertidas` | Formato de fecha o `Termina` anterior a `Inicia` | `yyyy-MM-dd HH:mm:ss`. |
| `en_revision` `bitacora_repetida` | El mismo `BitacoraID` dos veces en el lote | Mandarlo una vez. |
| `retenida` `tipo_sin_regla` | Tipo ausente o que la flota no recibe | Mandar el tipo o habilitarlo en la configuración. |
| `retenida` póliza provisional | Sin `Poliza` con la perilla encendida | Esperado: una persona la libera. |
| `retenida` neto negativo | Neto menor que cero con `neto_negativo = retener` | Revisar el origen. |
| `no_guardada` `sin_poliza` | Sin póliza y perilla apagada | Mandar la póliza o encender la perilla. |
| `no_guardada` `bitacora_duplicada` | La bitácora ya existe bajo otra clave | Corregir el identificador. |
| `correccion_pendiente` | Mismo `BitacoraID` con otro contenido | Una persona decide cuál vale; no se sobrescribe. |
| Correo `omitida` | Periodo anterior a la fecha de corte, o destinatario sin correo | Revisar la fecha de corte y los contactos. |

## 6. Pregunta abierta: usuario y contraseña en lugar de token

Hoy la ruta solo entiende una **llave de API por flota y área** (`Authorization: Bearer <llave>`): se guarda su hash, se compara en
tiempo constante, se revoca desde el panel y marca su último uso. Si el sistema del cliente solo sabe iniciar sesión con usuario y
contraseña, la forma más barata y segura es un **inicio de sesión que devuelva un token de corta vida**, sin cambiar la ruta de
desgloses. **No se implementó**; esto es lo que costaría:

1. Un endpoint `POST /api/v1/auth/token` que reciba usuario y contraseña de una **cuenta de servicio** (no de una persona del panel)
   y devuelva `{ token, expira_en }` con una vida de 15 a 60 minutos.
2. Una migración aditiva con dos tablas: cuenta de servicio (usuario, hash de contraseña con costo alto, área, flota, activa) y
   token emitido (hash, expiración, última vez usado), con llaves foráneas compuestas `(id, tenant_id)`, prueba SQL y entrada en la
   lista de migraciones verificadas.
3. En `abrir()`: aceptar el token emitido como segunda vía junto a la llave, sin tocar el resto de la ruta (el área y la flota salen
   del token, igual que hoy).
4. Endurecer: límite de intentos y bloqueo temporal por cuenta y por IP, mismo mensaje para usuario o contraseña incorrectos,
   contraseña generada por Likida y entregada por canal privado, rotación y revocación desde el panel, y registro de accesos sin la
   contraseña.
5. Pruebas: éxito, contraseña errónea, token vencido, token de otra flota, área equivocada, bloqueo.

Estimación: de 2 a 3 días de construcción y revisión, una migración y un despliegue. Riesgo principal: una contraseña de larga vida
es una credencial más débil que una llave larga y aleatoria; por eso el token debe ser corto y la cuenta solo debe poder llamar a
esta ruta. **Recomendación:** mantener la llave de API y ofrecer el inicio de sesión solo si el cliente confirma que su herramienta
no puede enviar una cabecera `Authorization` fija.
