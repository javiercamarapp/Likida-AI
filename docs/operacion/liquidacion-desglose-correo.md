# Desglose de liquidación por correo: operación y rollback

Documento neutro: describe el mecanismo, no a ninguna flota concreta. Los nombres, importes y direcciones de ejemplo son
inventados. Para el contrato de la API de recepción de la liquidación anterior, ver `liquidacion-externa.md`.

## 1. Qué es

El sistema de transporte de la flota calcula la liquidación de cada bitácora. Likida **no la recalcula**: la recibe (por
lectura periódica o por el plan B), arma un Excel **con valores, sin fórmulas**, con el formato que la flota ya usa
(encabezado de operador, unidad, bitácora y periodo; bloque «Percepción» a la izquierda y «Deducción» a la derecha; total
por bloque y neto), y lo **entrega por correo**. El correo es sobrio: sin logotipo, sin pie de Likida y sin importes en
el asunto ni en el cuerpo. El detalle va solo en el archivo adjunto.
Likida no edita los importes de un desglose recibido: el agente solo envía el desglose y no procesa bonos ni condiciones.

Se envía **un correo por destinatario**, nunca uno solo con copias. Así el rebote o la queja de uno no oculta lo de los
demás y cada envío tiene su propio estado.

| Rol | Quién es | De dónde sale |
|---|---|---|
| `operador` | Quien trabajó la bitácora | `operador.correo` |
| `coordinador` | Coordinador de operaciones del operador | `liquidacion_coordinador.correo`, vía `operador.coordinador_id` |
| `rh` | Recursos humanos (hasta 3 correos fijos) | `liquidacion_correo_config.rh_correos` |
| `archivo` | Buzón de «Enviados» que sirve de archivo | `liquidacion_correo_config.archivo_correo` |

Si dos roles resuelven al mismo correo se envía una sola vez, con el rol más específico
(operador, coordinador, rh, archivo). Un operador sin correo (o con el correo rebotado) **no recibe**, pero coordinador,
RH y archivo sí; la excepción `operador_sin_correo` lo deja a la vista.

## 2. Flujo

```
Origen (API del sistema de transporte)  ─┐
Plan B: POST /api/v1/liquidaciones-externas/desgloses ─┤
Plan B: importador de CSV/Excel         ─┘
        │  validar (contrato DesgloseBitacora v1) → idempotencia por bitácora → resolver operador
        │  → reglas (renombres, renglón de viaje, conceptos prohibidos) → guardas previas al envío
        │  → Excel (Storage) → filas de entrega por destinatario
        ▼
liquidacion_entrega_correo  ──cron cada 5 min──▶  Resend  ──webhook──▶  entregada / rebotada / queja
```

- **Lectura periódica (pull):** el cron existente `/api/cron/liquidaciones-externas` (cada 5 minutos) lee del origen con
  un cursor propio (`liquidacion_pull_estado`) y una ventana de traslape de 24 horas, porque la póliza puede llegar tarde.
  Procesa a lo más 100 bitácoras nuevas por pasada. Si el origen falla, el cursor no avanza y la siguiente corrida
  reintenta. Likida es solo consumidor: no guarda credenciales del origen en este módulo.
- **Sin póliza:** la bitácora no se envía. Abre la excepción `sin_poliza`, que se resuelve sola cuando una lectura
  posterior ya trae la póliza.
- **Idempotencia:** misma clave de bitácora y mismo contenido no inserta ni reenvía nada.
- **Entrega:** el cron reclama las filas listas con `reclamar_entregas_correo` (reclamo atómico con arrendamiento; dos
  trabajadores nunca toman la misma fila). Envía con Resend usando una llave de idempotencia por entrega.
- **Confirmación:** el webhook `/api/correo/eventos` registra entregado, rebotado o queja sobre la fila de entrega.
  Un rebote de nómina **no** entra a la lista de supresión global de campañas.

## 3. Estados

Entrega por destinatario (`liquidacion_entrega_correo.estado`):

| Estado | Significa |
|---|---|
| `pendiente` | En cola; sale cuando vence `proximo_intento_en` (y dentro de la ventana de envío si hay una). |
| `enviando` | Reclamada por un trabajador; si el arrendamiento vence sin terminar, vuelve a reclamarse. |
| `enviada` | Resend aceptó el correo. Todavía no hay confirmación de buzón. |
| `entregada` | El webhook confirmó la entrega al buzón. |
| `rebotada` | La dirección no existe o el buzón no lo acepta. Marca `operador.correo_rebotado_en` si era el operador. |
| `queja` | El destinatario lo marcó como no deseado. |
| `fallida` | Se agotaron los intentos o el proveedor lo rechazó sin remedio. Queda **visible** con su motivo en lenguaje llano. |
| `omitida` | No se envía (por ejemplo, destinatario sin correo válido). |

La liquidación en sí (`liquidacion_externa.estado`) reutiliza los estados existentes sin añadir otros: `pendiente`
(recibida, sin enviar), `enviada` (el correo al operador fue aceptado) y `fallida` (agotó reintentos). Los estados
`en_cola` y `acusada` pertenecen al canal anterior y no se usan en el canal correo.

Reintentos: espera de 2, 4, 8 y 16 minutos entre intentos y un máximo de 5 intentos por entrega. Un fallo transitorio
(red, 429, 5xx) reintenta solo; un rechazo por correo inválido no reintenta y pide corregir la dirección.

## 4. Tablas

| Tabla | Para qué |
|---|---|
| `operador` (columnas `correo`, `correo_rebotado_en`, `coordinador_id`) | Contacto del operador. Se vacían al anonimizar (ARCO) por el disparador `operador_anonimiza_correo`. |
| `liquidacion_coordinador` | Coordinadores a quienes se copia el desglose. Un correo por flota. |
| `liquidacion_correo_config` | Una fila por flota: canal, remitente, destinatarios fijos, reglas. Sin fila equivale al canal anterior. |
| `liquidacion_desglose` | Encabezado de la bitácora (bitácora, terminal, póliza, unidad, tipo de operador, días, motivo de retención). |
| `liquidacion_excepcion` | Lo que requiere atención humana. Una abierta por flota, clave y tipo. Sin importes ni nombres en el detalle. |
| `liquidacion_pull_estado` | Cursor y contadores de la última lectura periódica, una fila por flota. |
| `liquidacion_entrega_correo` | La cola: una fila por (liquidación, generación, rol, correo). La unicidad es la idempotencia. |

Todas son de lectura para quien ve finanzas de la flota y de escritura solo para `service_role`. Todo el acceso a datos
nuevo vive en un solo módulo (`liquidacion_externa/repo_correo.ts`); la prueba de frontera de datos congela el número de
archivos y de llamadas directas a Supabase fuera de la frontera, y sus techos se suben en el mismo commit que añade
acceso, con explicación (hoy 290 archivos y 1 940 llamadas).

## 5. Configuración por flota

Pantalla: Agentes, Liquidación, Configuración (solo la persona que administra la flota). **Nace apagada**: guardar la
configuración no envía nada hasta que se enciende `activa`.

| Campo | Efecto | Defecto |
|---|---|---|
| `canal` | `whatsapp`, `correo` o `ambos` | `whatsapp` |
| `activa` | Interruptor del canal correo | `false` |
| `remitente_nombre`, `responder_a` | Nombre del remitente y dirección de respuesta; sin marca de Likida | vacío |
| `rh_correos` | Hasta 3 destinatarios fijos de recursos humanos | vacío |
| `archivo_correo` | Buzón de archivo que recibe copia de todo lo enviado | vacío |
| `envia_coordinador`, `envia_rh` | Si se escribe a esos roles | sí |
| `etiqueta_viaje`, `agrupar_viaje`, `conceptos_viaje` | Colapsa los conceptos indicados en un solo renglón «de viaje» | no agrupa |
| `renombres` | Cambia el nombre de un concepto al mostrarlo | ninguno |
| `conceptos_prohibidos` | Un desglose que los contenga se **retiene** y no se envía | ninguno |
| `tipos_que_reciben` | Tipos de operador que reciben desglose | foráneo y local |
| `neto_negativo` | `retener` (no enviar y avisar) o `enviar` | `retener` |
| `enviar_desde_hora` | Hora local (0 a 23) desde la que se puede enviar; antes de ella la fila se libera sin gastar intento | sin ventana |

Con `canal = 'correo'` el camino anterior no corre para esa flota (el gate por canal lo impide); con `ambos` corren los
dos; con `whatsapp` todo sigue como antes. El interruptor global del agente (`agente:liquidacion`) apaga el cron entero.

## 6. Plan B si la API del origen no está disponible

Ambos caminos pasan por el mismo servicio de recepción (mismas guardas, mismo Excel, mismas entregas):

1. `POST /api/v1/liquidaciones-externas/desgloses` con el JSON de la bitácora (contrato `DesgloseBitacora` v1). Llave de
   API con permiso de administración.
2. Importador de CSV o Excel del export de bitácoras (una fila por concepto; agrupa por terminal y bitácora; reporta
   por número de fila lo que no entiende y no frena las demás). Los encabezados aceptan alias; ajustar el formato real es
   añadir una línea de alias.

## 7. Qué hacer ante cada caso

**Rebote.** La entrega queda `rebotada` y, si era el operador, `operador.correo_rebotado_en` se marca: no se le vuelve a
escribir hasta corregir. Corregir la dirección y reenviar desde el detalle del desglose, con «correo corregido»: valida
la dirección antes de guardarla, limpia el rebote y crea una generación nueva. El rebote de un operador **no** suprime
a nadie globalmente.

**Sin póliza.** No se envía; excepción `sin_poliza`. No hay nada que liberar a mano: se corrige en el origen y la
siguiente lectura la resuelve sola.

**Corrección de un desglose ya enviado.** Si llega la misma bitácora con contenido distinto, Likida **no sobrescribe ni
envía** (el operador pudo haber recibido ya el primero): abre `correccion_pendiente` con el neto anterior y el nuevo.
Una persona decide mandar la corrección: vuelve a enviar la bitácora corregida a `POST /api/v1/liquidaciones-externas/desgloses`
con `"correccion": { "motivo": "…" }` en el sobre (llave de administración). Entra como liquidación nueva con la clave terminada en `-R1`
(`-R2`, etc.), con su archivo nuevo; el operador la recibe con el asunto «CORRECCIÓN — Desglose de pago…» y el aviso de que reemplaza
al anterior; la original queda como constancia y la excepción `correccion_pendiente` se cierra. Reintentar la misma corrección no
crea otra. (Una bitácora cuyo nombre original ya termine en `-R<n>` se rotularía como corrección sin serlo: evita ese sufijo.)

**Retenido por una guarda.** Un neto negativo o un tipo de operador sin regla dejan el desglose guardado sin entregas y
con su excepción. Quien administra la flota puede **liberar el envío** desde el detalle (queda en la auditoría quién y
cuándo); es idempotente, dos clics no duplican nada. Un concepto prohibido o la falta de póliza no se liberan a mano:
son datos que se corrigen en el origen.

**Operador sin correo o coordinador sin asignar.** Excepciones `operador_sin_correo` y `coordinador_sin_correo`. Se
cargan con el importador de contactos o desde el detalle. Los demás roles reciben mientras tanto.

**Reclamo de un operador («no me llegó mi desglose»).** Reenvío manual desde el detalle: solo administradores; nunca a
un rol cuya entrega anterior sigue `pendiente` o `enviando`; máximo 5 reenvíos por desglose y por día (hora de México);
siempre queda un evento de auditoría con quién lo pidió y por qué.

**Errores en lenguaje llano.** La pantalla muestra una frase por código (`sin_configurar`, `correo_invalido`,
`reintentando`, `red`, `rebotada`, `queja`, `sin_confirmar`, `interno`); el texto crudo del proveedor nunca llega a la
pantalla ni a `/v1`. El latido del cron reporta `parcial` si algo quedó sin terminar. El aviso al operador de guardia
solo se dispara si la lectura falla 3 pasadas seguidas o si las rebotadas superan el umbral.

**Corregir un importe: se corrige en el origen.** Ninguna pantalla ni ruta de Likida modifica `concepto`, `monto`, `total` ni `neto` de un desglose
ya recibido (lo vigila la prueba `guardia_sin_edicion.test.ts`). Lo permitido es reenviar, corregir el correo del operador y registrar o
resolver excepciones. Si un pago está mal, se corrige en el sistema de origen y se reimporta; el camino previsto es que entre como una nueva generación, con su motivo,
y la anterior quede como constancia (hoy reintentar la misma liquidación no pisa el desglose recibido). Si el dueño pide algún día poder editar un pago, el contrato `aprobacion_mancomunada.ts` ya fija la
regla (dos personas distintas y bitácora sin importes); nace apagado y sin pantalla, y encenderlo es una decisión aparte.

## 8. Retención

- La entrega por correo se conserva 13 meses (piso de 12). Pasado ese plazo, y solo para entregas en estado terminal
  (`enviada`, `entregada`, `rebotada`, `queja`, `fallida`, `omitida`), la función `purgar_liquidacion_entrega_correo`
  (la invoca el cron `purgar`) borra el Excel del almacenamiento y sustituye el correo por la constancia literal `purgado`.
  La fila queda para estadística sin dato personal. Una entrega `pendiente` o `enviando` jamás se toca.
- La liquidación misma (`liquidacion_externa`) sigue su retención propia de 60 meses (piso de 24); al purgarla, sus
  entregas se van en cascada.
- El archivo de consulta de la flota es la carpeta de «Enviados» de su buzón (`archivo_correo`), no esta base.
- Al anonimizar a un operador (ARCO) se vacían su correo, su rebote y su coordinador.

## 9. Frontera de datos (ceiling)

El desglose es dato de dinero y dato personal. Reglas que no se rompen: ninguna ruta lo expone sin la flota de la
credencial; el asunto y el cuerpo del correo no llevan importes ni nombre de la flota; los registros de log llevan el
correo enmascarado y ningún importe; el detalle de las excepciones no lleva cifras ni nombres. La prueba de frontera
(`frontera_datos_guardiana.test.ts`) congela el techo de accesos directos a la base fuera de `repo.ts` y `pg.ts`; es
un techo, no un objetivo, y no se sube sin explicarlo en el commit.

## 10. Runbook de rollback

Orden de menor a mayor impacto. Nada de esto requiere migrar hacia atrás para detener el correo.

**1. Detener el correo de una flota y volver al camino anterior (sin migrar).**
En `liquidacion_correo_config` de esa flota: `activa = false` y `canal = 'whatsapp'`. Desde la pantalla de
configuración, o con una actualización a esa fila por `service_role`. Efecto: el cron deja de reclamar entregas de
correo para la flota y el camino anterior vuelve a correr. Las filas ya en cola quedan guardadas, sin enviarse.
Para parar a todas las flotas a la vez, apagar el interruptor `agente:liquidacion`.

**2. Revertir el código.** Revertir con `git revert` los commits del frente (uno por tarea, en orden inverso al de
integración). No se reescribe historia. La tabla nueva queda inerte: ningún código la lee.

**3. SQL de reversa de las migraciones 0785 a 0788 (documentado, NO ejecutado).** Solo si se decide quitar el esquema.
Respaldar antes. Orden inverso a la aplicación:

```sql
-- 0788: función de purga y ajustes a la tabla de entregas
drop function if exists public.purgar_liquidacion_entrega_correo(integer, integer, timestamptz);
-- Solo si NO hay filas con correo = 'purgado' (la regla vieja no las admite):
alter table public.liquidacion_entrega_correo drop constraint liquidacion_entrega_correo_correo_forma;
alter table public.liquidacion_entrega_correo add constraint liquidacion_entrega_correo_correo_forma check (
  correo ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' and char_length(correo) <= 254);
drop index if exists public.liquidacion_entrega_correo_destinatario_unico;
create unique index liquidacion_entrega_correo_destinatario_unico
  on public.liquidacion_entrega_correo (liquidacion_externa_id, generacion, rol, lower(correo));

-- 0787: cola de entrega
drop function if exists public.reclamar_entregas_correo(integer, timestamptz, integer);
drop table if exists public.liquidacion_entrega_correo;

-- 0786: encabezado, excepciones y estado del pull
drop table if exists public.liquidacion_pull_estado;
drop table if exists public.liquidacion_excepcion;
drop table if exists public.liquidacion_desglose;

-- 0785: contactos y configuración
drop trigger if exists operador_anonimiza_correo on public.operador;
drop function if exists public.operador_anonimiza_correo();
drop table if exists public.liquidacion_correo_config;
alter table public.operador drop constraint if exists operador_coordinador_tenant_fkey;
alter table public.operador drop constraint if exists operador_correo_forma;
drop table if exists public.liquidacion_coordinador;
alter table public.operador drop column if exists coordinador_id;
alter table public.operador drop column if exists correo_rebotado_en;
alter table public.operador drop column if exists correo;
```

Antes de ejecutar: comprobar que
ningún código desplegado sigue leyendo esas tablas (paso 2 primero) y que se respaldaron las entregas y las excepciones
si hace falta evidencia de lo enviado. Estas sentencias no se corren desde un agente: las aplica una persona.

**4. Reenviar a mano lo pendiente tras un corte.** Con el canal otra vez activo:
(a) en la lista de desgloses, filtrar los que están `pendiente` o `fallida`; (b) abrir el detalle y usar «Reenviar» al
rol que falte; (c) para un desglose retenido por guarda, «Liberar envío»; (d) verificar en el detalle que el estado pase
a `enviada` y luego `entregada`. No reenviar una entrega que sigue `pendiente` o `enviando`: el sistema lo rechaza para
no duplicar un pago. Si fueron muchas, subir `enviar_desde_hora` para escalonar y revisar el tope de 5 reenvíos diarios
por desglose.

**5. Si Resend cae.** No hay que hacer nada de inmediato: las entregas reintentan solas a los 2, 4, 8 y 16 minutos
(5 intentos) y, agotados, quedan `fallida` y visibles con su frase en la lista. El latido del cron marca `parcial`.
Cuando el servicio vuelva: usar el reenvío del paso 4 sobre las `fallida`. Si faltan `RESEND_API_KEY` o el dominio
verificado, las entregas esperan con el motivo «el envío de correo todavía no está configurado» y salen solas al
configurarlo; ningún intento se pierde. Si el webhook de eventos no está configurado, los envíos quedan `enviada` sin
pasar a `entregada` (frase «sin confirmar»): revisar antes de reenviar, para no duplicar.

## 11. Stand-by (se conserva, no se borra)

El canal anterior (entrega por mensajería con botones y aviso de discrepancia), la lectura propia por CSV de Likida y el
modo de fotos siguen intactos, ocultos y apagados mientras la flota use el canal correo. Reactivarlos es el paso 1 del
rollback.
