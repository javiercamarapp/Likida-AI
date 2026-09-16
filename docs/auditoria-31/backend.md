# Backend y API — auditoría 31

**Nota: 6/10** (antes 7). Razón del movimiento: **mirada más profunda** — el
código no cambió (los dos commits de la ventana tocan `normas/.latido-*`, cero
líneas de `src/`), así que ni «se atacó y subió» ni «deuda que cobró factura»
aplican. La 7 se puso sin haber abierto dos caminos que hoy sí abrí, y los dos
traen un ALTO:

1. **La clase que la 30 declaró abierta es peor de lo que la 30 midió.** La 30
   encontró el predicado de «liquidación vigente» faltando en un camino
   POR VIAJE (`libro_viaje.ts:590`, MEDIO). Hoy lo encontré faltando también en
   un **AGREGADO** que suma pesos en la pantalla del contralor
   (`auditor_cobranza.ts:584` → «Margen real medido» de `/dashboard/facturacion`)
   — exactamente la forma que la `0348` trató como grave. Contado: el predicado
   está escrito **31 veces a mano** (14 en TS, 17 en SQL), no existe un helper
   compartido, y **2 lectores vivos** no lo aplican.
2. **La cola de borrado de Storage —el ejecutor ARCO— puede dejar de drenar para
   siempre y el cron sigue en verde**, y la prueba que existe **bendice** el
   estado atascado.

Lo que sostiene el 6 y no menos: los caminos de escritura de dinero que sí
revisé están anclados en la base, no en memoria (`registrar_pago_tx`,
`cancelar_factura_tx`, `guardar_liquidacion_tx`, `reclamarIntentos`,
`try_lock_viaje` con token, `escribir()` de `/v1`), y varios tienen prueba
propia y nombrada — ver «Lo que revisé y está bien». Lo que impide el 7: la
mitad destructiva de los caminos de concurrencia **no tiene prueba**, y en un
caso la prueba existente fija el defecto.

**El riesgo mayor del rubro, hoy:** sigue siendo el mismo de la 30 —la guardia
de orden de Stripe es una LECTURA que falla ABIERTA y revierte a «fallida» una
mensualidad ya cobrada—, y ahora lo acompaña una cifra de margen agregada que
suma el costo que el contralor rechazó.

---

## Estado de los hallazgos abiertos de la 30

Los seis, verificados HOY línea por línea sobre el árbol sin tocar. **Ninguno se
cerró y ninguno estaba mal reportado**: las seis líneas son idénticas.

| # | Hallazgo de la 30 | Veredicto hoy | Evidencia |
|---|---|---|---|
| BE-30-1 | Guardia de orden de Stripe falla abierta | **REINCIDENTE** | `suscripcion.ts:791` sigue `logger.warn(...); return null;` · `:861` sigue `if (ultimo !== null && ...)` · `:875` upsert incondicional · `:800-813` `sellarOrden` sin comparar |
| BE-30-2 | `pdfEstadoDe` sella «encolado» un rechazo que nunca se encoló | **REINCIDENTE** | `avisar_cierre.ts:115` sigue `if (r.codigo === undefined) return 'encolado';` · `meta/client.ts:571` sigue devolviendo **sin `status`** (compárese con `:244`, que sí lo manda) |
| BE-30-3 | `ingerirRep` corta por presupuesto sin marcador | **REINCIDENTE** | `intake/rep.ts:207-216` sigue arrancando en `rep.pagos[0].doctos[0]`; no hay lectura previa de `cfdi_pago` ni índice de corte |
| BE-30-4 | Margen de `/v1` con el costo rechazado | **REINCIDENTE** | `libro_viaje.ts:590` sigue `select('id, total_comprobado, diferencias')`, sin `revision` |
| BE-30-5 | `traerTodoDesdeId` pierde la última fila en frontera de página | **REINCIDENTE** | `pg.ts:267` sigue `if (esperadas !== null && filas.length >= esperadas) return filas;` antes de mirar si la página venía llena |
| BE-30-6 | Sello «encolado» con URL firmada de 15 min | **REINCIDENTE** | `processor.ts:1307` sigue `TTL_FIRMA_PDF_SEGUNDOS = 900`; `meta/client.ts:562` sigue encolando el payload con esa misma URL |
| BE-30-7 (BAJO) | `escalar` pierde `configAusente` con corte duro | **REINCIDENTE** | `cron/escalar/route.ts:418-422`: el ternario sigue evaluando `corteDuro` primero |
| BE-30-8 (BAJO) | Doce cartas muertas ⇒ doce mensajes | **REINCIDENTE** | `processor.ts:4101-4125` sin tope; `conv.ts:1003` `.limit(50)` |

El detalle completo de los ocho (escenario con valores, consecuencia, causa
raíz) está en `docs/auditoria-30/backend.md` y **no se repite aquí**: no ha
cambiado ni una palabra. Abajo van únicamente los **nuevos**.

---

## Hallazgos

### [ALTO · NUEVO] La cola de borrado de Storage se atasca para siempre en cuanto un lote mezcla archivos que existen con archivos que ya no, y el cron sigue latiendo `ok`

`src/lib/likida/storage_borrado.ts:92` (`const aSellar = nombres.filter((n) => confirmados.has(n) || confirmados.size === 0);`)
· `:103-106` (el comentario que promete la recuperación que el código no hace)
· `:108-109` (`borrados`/`fallidos`) · `src/app/api/cron/purgar/route.ts:313-320`
(el único consumidor: `logger.warn`, sin `alertarOperador`) · `:383-385` (el
`estado` que NO mira `storage`) · `src/lib/likida/storage_borrado.test.ts:80-91`
(la prueba que fija el defecto).

**Escenario, con valores.** Flota `t-1`. El contralor ejecuta una CANCELACIÓN
ARCO (LFPDPPP art. 23-25) del operador Juan Pérez: `mantenimiento_de_datos`
marca tres fotos en `storage_huerfano_candidato`, bucket `comprobantes`, motivo
`arco`: `a.jpg`, `b.jpg`, `c.jpg`.

1. **Noche 1.** `borrarStorageMarcado()` llama
   `db.storage.from('comprobantes').remove(['a.jpg','b.jpg','c.jpg'])`. La API
   confirma las tres. El `update` que pone `borrado_en` **falla** (bache del
   pooler) ⇒ `:101-104` lo trata como no-fatal: `logger.warn('storage.sello_fallo')`,
   `borrados += 3`, `fallidos += 0`. En el cron, `storage.fallidos > 0` es
   **falso** ⇒ ni siquiera el `logger.warn` de `purgar/route.ts:316` sale. Las
   tres filas siguen con `borrado_en IS NULL`.
2. **Noche 2.** La cola trae `a.jpg`, `b.jpg`, `c.jpg` (sin sellar, ya
   inexistentes en el bucket) **más** un huérfano nuevo `d.jpg` que SÍ existe.
   `remove(['a.jpg','b.jpg','c.jpg','d.jpg'])` devuelve `data = [{name:'d.jpg'}]`
   — los que ya no existían no vienen en la respuesta, tal como el propio
   comentario `:89-91` documenta.
3. `confirmados = {'d.jpg'}`, `confirmados.size === 1` ⇒ la segunda rama del
   filtro de `:92` **no se activa** ⇒ `aSellar = ['d.jpg']`.
   `borrados = 1`, `fallidos = 3`.
4. A partir de aquí **se repite igual todas las noches**: `a/b/c` nunca se
   sellan, siempre vuelven a encabezar la lectura (`.order('motivo').order('detectado_en')`,
   `LOTE = 200`) y siempre cuentan como `fallidos`.

**Lo que hace el defecto estructural y no un tropiezo:** el comentario de
`:103-106` declara la recuperación —«la corrida siguiente lo reintentará y la
API devolverá "no existe", que este mismo camino trata como borrado»— y esa
afirmación **solo es cierta cuando el lote entero ya desapareció**
(`confirmados.size === 0`). Con un lote mixto, «ya no existe» cae en la misma
cubeta que «no se pudo borrar».

**Consecuencia.** (a) Con ≥ 200 filas atascadas de motivo `arco` —y se acumulan
solas, una por cada sello fallido— el `LOTE` se llena de cadáveres y **ninguna
cancelación ARCO nueva vuelve a borrarse jamás**: la flota tiene 15 días hábiles
para cumplir y el ejecutor está muerto. (b) Nadie se entera: `fallidos > 0` solo
produce un `logger.warn` en `purgar/route.ts:316` —sin `alertarOperador`, a
diferencia de `productoEvento` y `retencion_0104`— y `estado` (`:383-385`) **no
mira `storage`**, así que el latido sale `ok`, `/api/health` verde y
`/admin/crons` verde. (c) Y hay una segunda cara: si `remove` devolviera `[]`
sin error por una razón que NO sea «ninguno existía», el `|| confirmados.size === 0`
sella **el lote entero** como borrado con los archivos todavía en el bucket —
evidencia escrita de un borrado que no ocurrió.

**Prueba que lo cubra: ninguna, y la que hay lo bendice.**
`storage_borrado.test.ts:80-91` («sella solo los que la API confirmó, no el lote
entero») monta exactamente el lote mixto —`data: [{name:'a.jpg'}]` sobre
`['a.jpg','b.jpg']`— y **afirma `r.fallidos === 1`**, o sea fija como correcto
que `b.jpg` se quede en la cola. La rama `confirmados.size === 0` con filas en
la cola no se prueba en ningún caso: el único test con `data: []` sale antes por
la cola vacía (`:55-57`). Corrí el archivo hoy: 4 pruebas verdes, y ninguna
distingue «ya no estaba» de «no se pudo».

**Causa raíz probable.** «Ya no existe» y «no se pudo borrar» se distinguen con
una heurística sobre el LOTE (`confirmados.size === 0`) en vez de sobre el
ARCHIVO; la API no da esa distinción por archivo y nadie la consulta (un `list`
o un segundo `remove` individual la darían).

---

### [ALTO · NUEVO] «Margen real medido» de `/dashboard/facturacion` suma el costo comprobado de liquidaciones que el contralor RECHAZÓ — la misma clase de la `0348`, ahora en un AGREGADO

`src/lib/likida/auditor_cobranza.ts:584-586` (la lectura: `select('viaje_id, total_comprobado')`,
sin `revision` en el select ni en el filtro) · `:689` (`liqPorViaje`) · `:722`
(lo que entra a `auditarViaje`) · `:381` (`comprobado`) · `:386-388`
(`faltaMargen`) · `:463-469` y `:472-486` (`resumirAuditoria`: **suma**
`comprobado` y calcula `margenPct`) · `src/app/dashboard/facturacion/vista.tsx:641-643`
(el rótulo «Margen real medido»).

**Escenario, con valores.** Flota `t-1`, ventana del mes. Tres viajes con
`ingreso_flete` capturado:

| viaje | pactado | liquidación | revisión |
|---|---|---|---|
| F-1040 | $20,000 | comprobado $12,000 | aprobada |
| F-1041 | $20,000 | comprobado $12,000 | aprobada |
| F-1042 | $20,000 | comprobado **$18,500** | **rechazada** (el contralor la invalidó; el viaje volvió a `en_cuadre`) |

- `getAuditoriaCobranza` lee los viajes **sin filtrar por `estatus`**
  (`:539-547`: solo `fecha_inicio` entre `desde` y `hasta`), así que F-1042
  entra a la auditoría.
- La lectura de `liquidacion` (`:584`) **no pide `revision`**, así que
  `auditarViaje` no tiene con qué distinguirla: `comprobado = 18500`,
  `faltaMargen = null` — literalmente «no falta nada».
- `resumirAuditoria` (`:463-469`) suma los tres: `pactado = 60,000`,
  `comprobado = 42,500`, `margen = 17,500`, `margenPct = 29.2 %`,
  `viajesMedidos = 3`, `viajesSinDato = 0`.
- La pantalla imprime **«Margen real medido $17,500.00 · 29.2 % · pactado menos
  gastos liquidados, en 3 viajes medidos; 0 sin las dos mitades»**.
- La cifra correcta —la que el contralor obtiene al cruzar contra su PDF, y la
  que `rentabilidad_tenant` **ya corregida por la 0348** le enseña en otra
  pantalla del mismo producto— es `pactado 40,000 · comprobado 24,000 ·
  margen 16,000 · 40 %` sobre **2** viajes medidos y 1 sin dato.

**Consecuencia.** Es el peor caso de la regla de la casa: dos pantallas del
mismo producto, en la misma sesión, dicen dos cifras distintas del mismo mes, y
la que miente es la que el contralor abre para decidir a quién facturarle. Y
miente en la dirección peligrosa: **infla el costo** (baja el margen) con un
comprobante que él mismo declaró inválido, y el campo que existe para avisarlo
(`falta`) afirma que no falta nada. El rótulo «pactado menos gastos liquidados,
en 3 viajes medidos» es falso en sus dos mitades.

**Por qué es un escalón por encima de su hermano de la 30.** `libro_viaje.ts:590`
(BE-30-4, MEDIO) equivoca el margen de UN viaje en una API. Esto equivoca una
**suma** que se pinta en pesos en el panel del comprador. Es exactamente la
forma que la `0348` fue a arreglar en seis RPC, y este camino nunca estuvo en
esa lista.

**Refutación intentada.** Busqué el guardarraíl tres veces y no está: (a) la
consulta de viajes no filtra `estatus`, así que un viaje reabierto por rechazo
sí entra; (b) `auditarViaje` no recibe `revision` — el tipo mismo lo prohíbe
(`:160`: `liquidacion: { totalComprobado: unknown } | null`); (c)
`aNumero`/`sumarOCallar`, que sí se importan de `libro_viaje` para no duplicar
criterio, no saben de revisión. La pantalla tampoco lo tapa: `vista.tsx:641` usa
`resumen.margen` tal cual.

**Prueba que lo cubra: ninguna.** `grep -c revision src/lib/likida/auditor_cobranza.test.ts`
→ **0**. Igual que `libro_viaje.test.ts` → 0 y
`api/v1/viajes/[id]/contribucion/route.test.ts` → 0. Corrí
`auditor_cobranza.test.ts` hoy: verde, y ni una de sus pruebas toca una
liquidación rechazada.

**Causa raíz probable.** No existe un predicado compartido de «liquidación
vigente»: hay **31 copias escritas a mano** (14 en TS con `neq('revision',…)` /
`revision !== 'rechazada'` / `in('revision',…)`, 17 en SQL con
`revision <> 'rechazada'`) y ningún helper. La `0348` arregló la lista de seis
del hallazgo anterior, no la clase.

---

### [BAJO · NUEVO] `mantener_mcp_oauth` puede fallar todas las noches y el latido de `purgar` sale `ok`

`src/app/api/cron/purgar/route.ts:364-368` (el fallo se loguea y se alerta, pero
`mcpOauth` queda `null` y nada más) · `:383-385` (el `estado`, que mira
`erroresRetencion0104` y `productoEventoError` y **no** `mcpOauth` ni `storage`)
· `:390-397` (el latido, que tampoco los lleva).

**Escenario, con valores.** La RPC `mantener_mcp_oauth` (0265) empieza a fallar
—p. ej. `42883` porque una migración quedó a medias—. Cada corrida diaria:
`logger.error('cron.purgar.mcp_oauth_falló')` + `alertarOperador`, pero
`estado = 'ok'`, `registrarLatido('purgar','ok',…)` y HTTP **200**. El tablero
`/admin/crons` y `/api/health` pintan la purga en verde indefinidamente
mientras los tokens de acceso MCP revocados/expirados y los clientes DCR que
nunca completaron un login se acumulan sin techo.

**Consecuencia.** El correo al operador es la ÚNICA señal, y es la que se pierde
en la bandeja; el tablero —que es donde se mira— afirma lo contrario. Contado:
de los **4** subsistemas que este cron ejecuta (retención 0104, producto_evento,
storage, mcp_oauth), **2 mueven el veredicto y 2 no**.

**Causa raíz probable.** `estado` se fue ampliando subsistema por subsistema en
vez de derivarse de una lista de resultados; cada RPC hermana nueva entra sin
que nada obligue a sumarla al veredicto.

---

## Lo que revisé y está bien

Todo abierto y leído hoy, no inferido del nombre.

- **`mcp/oauth.ts`** (el OAuth del copiloto, que la 29 y la 30 dejaron sin
  abrir): es el mejor trabajo de concurrencia que leí en el rubro. El canje
  quema el código con la condición EN la base (`:352-357`, `.is('usado_en', null)`
  + `.select('id')`; el perdedor de la carrera recibe cero filas y además tumba
  la familia, `:362-365`), la rotación del refresco hace lo mismo
  (`:457-462`), **y las dos deshacen su propia marca si `emitirPar` falla —solo
  si la fila sigue trayendo SU sello** (`:387-392`, `:494-499`), que es la única
  forma correcta de compensar sin pisar a quien ganó la carrera. Revalida la
  identidad congelada contra `mcp_oauth_usuario_vigente` antes de rotar
  (`:440-452`), y un error de lectura es 503, nunca `invalid_grant`
  (`token/route.ts:33`).
- **`/api/v1/_escritura.ts` — `escribir()`**: las tres capas hacen lo que el
  docblock promete y la que sostiene la promesa es el unique de la base, no el
  Map. El paso 4 (`:765-777`) relee tras el 23505 y distingue reintento honesto
  (200) de mismo folio con otro contenido (409). **Y tiene prueba nombrada:**
  `_escritura.test.ts:831` («el choque contra `unidad_economico_unico` en carrera
  se resuelve con la fila que ganó»). `leerRecuerdoDurable`/`guardarRecuerdoDurable`
  no lanzan **a propósito y con la razón escrita** (`:469-479`, `:503-507`): son
  conveniencia, y degradar a la llave natural es la conducta previa a la tabla.
- **El mutex del viaje, con dueño.** `try_lock_viaje` es un
  `insert … on conflict do update … where locked_until < now()` que devuelve
  `found` (0280:57-74): atómico, sin lectura previa. Y `unlock_viaje` borra
  `where token is not distinct from p_token` (0280:80-88) — **intenté refutar
  que `reabrirViaje` (`administracion.ts:1123`/`:1182`), que toma y suelta SIN
  token, pudiera robarle el lease a un cierre, y no puede**: el `is not distinct
  from` con `NULL` solo alcanza filas de token nulo. Prueba:
  `conv_lock_dueno_aud24.test.ts`. `intentarLockViaje` devuelve
  `'indeterminado'` y los dos llamadores del cierre lo respetan y lo dicen
  distinto al chofer (`processor.ts:4206-4232`).
- **El claim de autofactura.** `al_vuelo.ts:820-852` (`reclamarIntentos`) es un
  UPDATE condicional sobre **la misma columna que pisa** (`autofactura_intentada_en`
  nula o vencida) con `.select('id')`: el ganador deja a los demás sin filas.
  Falla **cerrado** si el UPDATE da error (`:844-850`), que es la mitad que la
  mayoría de los repos se come. Cubre el reencolado doble de
  `cron/facturar/route.ts` (el `deduplicationId` cambia de ranura cada 15 min,
  así que dos corridas SÍ pueden encolar el mismo ticket; el claim lo absorbe).
  Prueba: `facturacion/al_vuelo.test.ts`.
- **`registrarPago` / `cancelarFactura`** (`facturacion_escritura.ts:609-636`,
  `:687-698`): los dos abandonaron el select-luego-update por RPC con `for
  update` (`registrar_pago_tx` 0159, `cancelar_factura_tx` 0284), y el 23505 se
  traduce a `AbonoYaRegistrado` con la propuesta como llave de idempotencia —
  nunca a un segundo abono. `conciliarPropuesta`
  (`portal_pago_escritura.ts:233-270`) no abre un segundo camino a
  `pago_recibido`: pasa por el mismo. Y `/api/pago/registrar` **no importa nada
  de ese módulo**, así que no existe ruta desde una petición anónima hasta un
  abono.
- **`/api/webhook/whatsapp`**: `receive → PERSIST → 2xx → worker` está bien
  puesto (`route.ts:249-264`: si no se pudo guardar, **503**, no 200), el rate
  limit se cobra DESPUÉS de deduplicar contra la bandeja (`:203-222`) y lo
  diferido sale **429**, no 200 — o sea que la cola es la de Meta. El pool
  agrupa por chofer y **corta la cadena** cuando un mensaje queda pendiente
  (`:417-421`), que es lo que impide que un «listo» adelante a sus fotos.
  `sin_tiempo` devuelve el intento en vez de contarlo como fallo (`:403-412`).
- **`/api/correo/entrante`**: firma antes de leer, tenant del DESTINATARIO
  (nunca del `from`), y el claim durable con lease (`reclamar_correo`, 0177)
  donde `busy` es **503** y solo `applied` es acuse definitivo (`:214-233`). La
  llave del canal se comprueba ANTES de consumir el correo (`:203-208`) — el
  orden correcto, y está razonado.
- **`/api/cron/wa-outbox`**: la palanca se lee ANTES de reclamar (`:65-83`, «un
  lease tomado con el sistema apagado secuestra la salida»), la config del canal
  también (`:93-107`, para no quemar `intentos` por algo que no es de la fila), y
  un 200 de Meta **sin wamid** no se sella como enviado: queda muerto y alerta
  (`:155-167`).
- **`/api/export/poliza`**: intenté que el recorte silencioso de PostgREST le
  cortara el archivo al contador y **no puede**: `poliza_datos_tenant` (0342)
  devuelve **`jsonb` agregado**, una sola fila, no `setof`, así que `max-rows`
  no aplica. Además falla cerrado en cuatro puertas antes de escribir nada
  (versión de RPC, firma humana, ajustes incompatibles, base gravable
  desconocida) y ninguna produce un archivo parcial.
- **`/api/cron/runner`**: el reloj duro envuelve la vuelta entera
  (`conRelojDuro`), el latido va **antes** del correo con la razón medida
  escrita (`:118-131`), y la racha `cortesSeguidos` **sobrevive** a un fallo sin
  inventarse (`:160-175`: se omite la llave si no se pudo leer, en vez de
  escribir 0).
- **`/api/correo/eventos`**: el `<>` sobre columna anulable ya está dicho en
  positivo (`:115-121`), el 500 devuelve el evento a la cola de Resend, y la
  supresión por rebote solo toca las direcciones que el payload identifica.
- **`/api/v1/_comun.ts` — `abrir()`**: la llave manda sobre la cookie y el
  porqué está escrito (`:194-205`); las escrituras con cookie exigen origen
  propio (`:242-250`) y las de llave no lo necesitan; todo fallo de credencial
  es 401/403/503 con cuerpo, nunca un 200 con lista vacía.
- **`duplicados.ts`**: puro y correcto (agrupa por `uuid#orden`, no por uuid —
  el consolidado de TAG no se acusa de fraude). Nota para `arquitectura`, no
  hallazgo mío: **no tiene ningún llamador de producción**; el camino vivo es la
  RPC `anomalias_gasto_tenant` y este archivo es el oráculo de la prueba de
  equivalencia (`analytics.ts:383-396` lo dice).
- **Compuerta de mi rubro, corrida por mí:** `npx vitest run src/app/api` →
  **86 archivos / 1,229 pruebas, verdes** (18.7 s). Y los 8 archivos que cito
  como evidencia (`storage_borrado`, `auditor_cobranza`, `conv_lock_dueno_aud24`,
  `factura_orden`, `_escritura`, `intake/rep`, `pg`, `libro_viaje`) →
  **255 pruebas, verdes**.

---

## Lo que NO alcancé a revisar

- **`src/middleware.ts` sigue sin existir.** Mi rubro me lo asigna y el repo no
  lo tiene (igual que en la 30). La cobertura que alguien podría suponer ahí
  vive en `api/v1/_comun.ts::abrir()` y en `puertaCron`.
- **`cron/facturar/lote.ts` (915 líneas)**: leí sus dos llamadores y el claim que
  lo protege, **no** el interior de la sesión de portal. Es el único camino del
  repo que emite un CFDI irreversible desde un cron.
- **`processor.ts` completo (4,990 líneas)**: abrí el brazo del XML
  (`:3430-3580`), el del cierre (`:4170-4300`), `confirmarCierreEnBase`
  (`:1342`) y la entrega del PDF (`:1184-1230`). El resto —el bucle de tools, la
  asistencia, las estadías— no.
- **La carrera de `marcarEvento`** (`suscripcion.ts:563-584`) que la 30 dejó
  abierta: hoy sí leí `cancelarFacturaDeStripe` (`:930-1009`) y **el efecto
  duplicado existe pero no es dinero**: dos entregas simultáneas del mismo
  `evt.id` pasan las dos por `if (f.estado === 'cancelada')` y las dos llaman
  `cancelarCfdi` en el PAC; la segunda rebota y cae en el `catch` de `:997`, que
  grita «hay un CFDI vivo que hay que cancelar A MANO» sobre uno ya cancelado.
  Es una alarma falsa, no un cobro doble — **no lo reporto como hallazgo propio**
  porque no pude medir qué contesta Facturapi ante un doble cancel y no voy a
  afirmarlo sin verlo.
- **Sin abrir**, de la lista que la 29 y la 30 arrastran: `marketing/*`, `lead`,
  `admin/copiloto`, `admin/qa/*`, `cron/{jornada,portales-vivos,asistencia}`,
  `export/{bitacora-peaje,carta-porte-xml,facturas-proveedor,jornada}`,
  `client-error`, `dashboard/{chat,ingesta,archivo,onboarding-chat}`. Sí abrí en
  esta ronda, y salieron limpios, `webhook/calcom` + `lib/admin/calcom_webhook.ts`
  (242 líneas), `cron/{purgar,runner,gps,wa-outbox,facturar}`, `correo/*`,
  `mcp/oauth/*`, `export/poliza`, `pago/registrar`.
- **Todo lo que exige Postgres vivo.** Cuanto afirmo del SQL (0280, 0337, 0342)
  sale de leerlo contra su test, no de ejecutarlo: aquí no hay base.
- **No corrí `npm test` completo** (lo corre el orquestador) ni `npm run build`
  (prohibido en esta ronda).
