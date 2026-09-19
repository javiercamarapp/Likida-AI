# Backend y API — auditoría 32, continuación 3 (19-sep-2026)

**Nota: 5/10** (antes 6). Razón del movimiento: **mirada más profunda — el
código no cambió en lo abierto y la nota anterior estaba inflada**. El 6 se
sostenía en que «los caminos de escritura de dinero anclan la condición EN la
base». Hoy abrí el único camino que `fc811a0` tocó y encontré lo que ese
resumen no contemplaba: **un lanzamiento dentro de la conciliación de un
consolidado no hace que el paquete deje de marcarse como ingerido entero**, así
que el comprobante se pierde para el reintento y la corrida siguiente ya no
vuelve por él. No es que el arreglo del 18-sep lo haya introducido —lleva ahí
desde la 0236— pero el arreglo **le puso un lanzador nuevo, rutinario y
programado** a ese `catch`, y la prueba que ya montaba ese escenario exacto
(`ciclo_flota.test.ts:547`) lo deja pasar en verde sin mirar el estado del
paquete. Las otras cuatro cosas abiertas siguen byte por byte en su sitio, así
que ninguna de las otras dos formas aplica.

**El riesgo mayor del rubro, hoy:** sigue siendo la guardia de orden de Stripe
—una LECTURA que falla ABIERTA (`src/lib/saas/suscripcion.ts:790-793`, `return
null` ante error con el «en la duda, se aplica» escrito en `:781-783`)— por la
que un `invoice.payment_failed` reentregado revierte a `fallida` una
mensualidad ya cobrada. Reverificada hoy, línea por línea.

---

## Lo que `fc811a0` cambió del contrato, visto desde backend

Tres cambios de contrato, leídos con `git show fc811a0`:

1. **`pg.ts:84-96`** — clase nueva `LecturaCortadaPorReloj`, que **no hereda de
   `LecturaIncompleta`**: es hermana, no hija.
2. **`pg.ts:271-292`** — `traerTodoDesdeId` estrena un tercer parámetro
   `opts: { venceEn?: number }` y, con el reloj vencido, **LANZA antes de pedir
   la primera página** (`pagina = 0`, `leidas = 0`). Sin `venceEn` el
   comportamiento es idéntico al de antes (`?? Number.POSITIVE_INFINITY`).
3. **`consolidado.ts:382-392` y `:485`** — `guardarYConciliarConsolidado` toma
   un cuarto parámetro opcional `venceEn` y se lo pasa a `candidatosDeGasto`.
   El único despachador que lo pasa es `sat_descarga/ciclo.ts:341`; los tres
   del camino de WhatsApp (`processor.ts:1669`, `:2027`, `:3422`) no lo pasan.

Las cuatro preguntas del encargo, contestadas:

- **¿Qué pasa con las escrituras a medias cuando el corte lanza?** El mensaje
  del commit afirma «el corte ocurre ANTES del primer avance durable
  (`enLotes`)». Es **casi** cierto y conviene precisarlo: hay un `upsert` a
  `cfdi_xml` en `consolidado.ts:399-414` que SÍ corre antes del corte y deja
  fila con `tiene_multiples_conceptos = true` y `total_conceptos = N`. Lo
  perseguí: **esas dos columnas no las lee nadie** (`grep` sobre `src/` y
  `supabase/migrations/` da la 0076 que las crea y el escritor de `:408-409`,
  nada más), y el `onConflict` las reescribe idénticas en el reintento. O sea:
  escritura durable sí, daño no. **Refutado.**
- **¿El error dice cuál fila?** A medias. `LecturaCortadaPorReloj` nombra la
  CONSULTA (`consolidado.candidatos_gasto`), las páginas y las filas leídas,
  pero **ni el tenant ni el UUID del CFDI**; lo mismo el `logger.error` de
  `pg.ts:290`. El identificador aparece un nivel más arriba, en
  `ciclo.ts:359` (`El consolidado ${uuid} no se pudo conciliar: …`). La línea
  que llega a Sentry es la de `pg.ts`, que es la que no lo trae.
- **¿Quién lo atrapa arriba?** El `catch` genérico de `ciclo.ts:358-360`, que
  **no distingue** un corte de reloj —evento de diseño, esperado— de una base
  caída. Los dos acaban como una cadena en `r.errores`, y de ahí a
  `descarga-sat/route.ts:156` (`errores === 0` entra en `sano`), así que el
  latido sale `'parcial'`. La señal de operación existe; lo que no existe es la
  distinción.
- **¿Hay camino donde el CFDI queda sellado sin conciliar entero?** **Sí**, y
  es el hallazgo ALTO de abajo.

---

## Hallazgos

### [ALTO · NUEVO] Un consolidado cuya conciliación lanza deja el paquete marcado como ingerido ENTERO: el ECC se queda «disponible» para siempre y nadie vuelve por él

`src/lib/likida/sat_descarga/ciclo.ts:358-360` (el `catch` que empuja a
`r.errores` y **no toca `completo`**) · `:394` (`return { completo: true }`,
fuera del bucle) · `:660` (`if (resultado.completo) bajados.push(p);`) ·
`:668-676` (el `update` de `paquetes_bajados`) · `:687-710` (`todoBien` →
`estado: 'descargada'` y `ultima_descarga_hasta` avanza). El lanzador nuevo:
`src/lib/likida/pg.ts:288-292` vía `src/lib/likida/intake/consolidado.ts:485`.

**Escenario, con valores.** Flota `t-1`, solicitud `sol-1` del rango
2026-07-01→2026-07-31, un solo paquete pendiente `p1` con dos XML:

1. `p1-cfdi-1` es el estado de cuenta mensual del monedero de casetas: un ECC
   de **$212,400** con 41 líneas. `decidirCruce` lo manda a `'consolidado'`.
2. `ingerir` comprueba el reloj al entrar a ese XML (`:277`) y todavía cabe. El
   sello de dedup se escribe (`:297-310`, `estatus: 'disponible'`). Entra a
   `guardarYConciliarConsolidado`, que escribe `cfdi_xml`, lee las líneas
   existentes, lee los sellos previos y llega a `candidatosDeGasto`
   (`consolidado.ts:485`) con el reloj ya en `Date.now() >= venceEn`. **Lanza
   `LecturaCortadaPorReloj('consolidado.candidatos_gasto', 0, 0)`.**
3. El `catch` de `:358` anota `El consolidado a1b2…-… no se pudo conciliar: …`
   y hace `continue`. **`marcar(…, 'ignorado')` no corre**: el CFDI se queda en
   `'disponible'`.
4. `p1-cfdi-2` es el siguiente y ÚLTIMO. La comprobación de reloj de `:277`
   dispara, `r.sinTurno += 1`, `return { completo: false }` → **este caso se
   salva**. Cambia una sola cosa y deja de salvarse: que el ECC sea el ÚLTIMO
   XML del paquete (entonces el bucle termina y devuelve `completo: true`), o
   que el lanzamiento no sea de reloj sino de base —un `errLineas` de
   `consolidado.ts:539-551`, una `LecturaIncompleta` de `:469-477`, un bache en
   el `upsert` de `cfdi_xml` de `:415-417`—, **porque entonces el reloj de
   `:277` no dispara y el paquete termina `completo: true` esté el ECC donde
   esté.**
5. Con `completo: true`: `bajados.push('p1')` → `paquetes_bajados = ['p1']` →
   `todoBien` sigue `true` → `sol-1` pasa a `'descargada'` y
   `ultima_descarga_hasta` avanza a `2026-07-31`.
6. **No hay vuelta siguiente.** `correrFlota:504-512` solo lee solicitudes en
   `('solicitada','en_proceso','lista')`; `sol-1` ya no está. El paquete del
   SAT caduca a las 72 h. El XML sobrevive en `cfdi_xml`, pero **nada en el
   repo lo vuelve a leer para conciliarlo**: los únicos consumidores de
   `cfdi_consolidado_linea` (`analytics.ts:1744`, `:1872`, `:1880`;
   `cuadre/desde_db.ts:282`; `consolidado.ts:612/623/655/787/901/940`) son
   lectores o la resolución a mano, y todos parten de filas que aquí nunca se
   escribieron.

**Consecuencia.** Las 41 líneas del ECC no existen: el contador abre
«Combustible & Casetas» y ve **0 por revisar** sobre un estado de cuenta de
$212,400 que nadie concilió, y los gastos que esas líneas amparaban se
liquidan **sin comprobante fiscal** (IVA y IEPS no acreditados). Peor: el CFDI
queda en `'disponible'`, que es la bandeja de «nadie reportó este gasto», y
desde ahí `resolucion.ts:184-199` + `:200` permite **elección libre** de cualquier gasto
sin comprobante de la flota — o sea el producto le ofrece al contralor ligar
1:1 un ECC de $212,400 contra un ticket de $1,200, que es literalmente lo que
la regla 3.3.1.7 prohíbe y lo que el comentario de AG-C1 (`ciclo.ts:342-349`)
declara inaceptable. El único rastro en operación es un latido `'parcial'` de
`descarga-sat` que no dice qué se perdió, y `alertarOperador` no se llama en
ese camino (`route.ts:157-175`).

No lo subo a CRÍTICO porque el dinero mal exige un paso humano (que el
contralor acepte la liga 1:1 que la pantalla le ofrece); es ALTO por la
definición exacta: falla silenciosa, sin recuperación.

**¿Hay prueba que cubra este camino? NO — y la que hay lo produce y no lo
mira.** `src/lib/likida/sat_descarga/ciclo_flota.test.ts:547-561` («si
guardarYConciliarConsolidado sigue sin poder terminar, el error se reporta — no
se traga en silencio») monta **exactamente este estado**: paquete `p1` con
`['p1-cfdi-1','p1-cfdi-2']` (`:170`), `guardarYConciliarConsolidado
.mockRejectedValueOnce(...)` sobre el primero, y afirma **solo**
`r.errores.some(e => e.includes('no se pudo conciliar'))`. Al terminar esa
prueba `db.solicitudes[0].paquetes_bajados === ['p1']` y
`db.solicitudes[0].estado === 'descargada'`, y **ninguna aserción los mira**.
Las tres pruebas que `fc811a0` añadió tampoco: `ciclo_flota.test.ts:625-663`
usa un doble que **resuelve** (`vi.fn(async () => {})`), así que el corte nunca
llega a `ciclo.ts`; comprueban el cableado del argumento
(`mock.calls[0][3] === VENCE_EN`), no el comportamiento del lanzamiento.
Corridas hoy: 4 archivos / 57 pruebas, verdes.

**Causa raíz probable.** `ingerir` decide `completo` solo por el reloj y nunca
por lo que le pasó a un XML individual; el `catch` del consolidado es el único
lugar del bucle donde un fallo por comprobante no se refleja en el valor de
retorno.

---

### [ALTO · REINCIDENTE — 3ª aparición] La cola de borrado de Storage se atasca para siempre en cuanto un lote mezcla archivos que existen con archivos que ya no, y el cron sigue latiendo `ok`

`src/lib/likida/storage_borrado.ts:93` (`const aSellar = nombres.filter((n) =>
confirmados.has(n) || confirmados.size === 0);`) · `:102-107` · `:108-109` ·
`src/app/api/cron/purgar/route.ts:383-385` (el `estado`, que sigue sin mirar
`storage`) · `src/lib/likida/storage_borrado.test.ts:81-91`.

Verificado hoy, abierto y leído: **idéntico**, carácter por carácter, a lo
reportado el 17-sep. El escenario con valores (`a/b/c` sellados a medias la
noche 1, `remove(['a','b','c','d'])` devolviendo solo `d` la noche 2 ⇒
`fallidos = 3` para siempre, ≥ 200 cadáveres de motivo `arco` y ninguna
cancelación nueva se borra jamás) vive en
`docs/auditoria-32/backend-continuacion.md` y no se repite aquí.

**¿Hay prueba que cubra este camino? No, y la que hay lo bendice** —
`storage_borrado.test.ts:81-91` afirma `expect(r.fallidos).toBe(1)` sobre el
lote mixto. Sin cambios.

**Causa raíz probable.** «Ya no existe» y «no se pudo borrar» se distinguen con
una heurística sobre el LOTE (`confirmados.size === 0`), no sobre el ARCHIVO.

---

### [ALTO · REINCIDENTE — 3ª aparición] «Margen real medido» de `/dashboard/facturacion` suma el costo comprobado de liquidaciones que el contralor RECHAZÓ

`src/lib/likida/auditor_cobranza.ts:582-586` (`traerPorIds<{ viaje_id;
total_comprobado }>` → `select('viaje_id, total_comprobado')`, sin `revision`
en el select ni en el filtro) · `:722` · `:463-486` ·
`src/app/dashboard/facturacion/vista.tsx:641`.

Verificado hoy: `:582-586` sigue pidiendo exactamente dos columnas y ninguna es
`revision`. Escenario con valores (F-1040/F-1041 aprobadas + F-1042 rechazada
con $18,500 comprobados ⇒ la pantalla dice `60,000 / 42,500 / 29.2 % / 3
medidos` donde lo correcto es `40,000 / 24,000 / 40 % / 2 medidos`) en el
reporte del 17-sep.

**¿Hay prueba que cubra este camino? No.** `grep -c revision
auditor_cobranza.test.ts` → **0**, tercera ronda igual.

**Causa raíz probable.** No existe un predicado compartido de «liquidación
vigente»; está escrito a mano en cada lector.

---

### [ALTO · REINCIDENTE — 4ª aparición, BE-30-1] La guardia de orden de Stripe falla ABIERTA: un `invoice.payment_failed` reentregado revierte a `fallida` una mensualidad ya cobrada

`src/lib/saas/suscripcion.ts:787-796` (`ordenAplicado`: `if (error) { …; return
null; }`) · `:781-783` (el docblock que lo declara: «en la duda, se aplica») ·
`:859-868` (la guardia, que solo actúa con `ultimo !== null`) · `:873-890` (el
`upsert` a `factura_saas` con `estado: datos.pagada ? 'pagada' : 'fallida'`).

(Corrección de ruta respecto a mis dos reportes anteriores: el archivo es
`src/lib/saas/suscripcion.ts`, **no** `src/lib/likida/saas/suscripcion.ts`.
Reverificado hoy abriéndolo.)

Escenario: la factura `in_1Q…` de la flota `t-1` se cobra el 1-sep
(`invoice.paid`, `created = 1756...`), se sella la marca de orden. El 3-sep
Stripe reentrega el `invoice.payment_failed` del intento fallido del 31-ago
(`created` menor). `ordenAplicado('in_1Q…','factura')` cae en un bache del
pooler ⇒ `logger.warn` y **`return null`** ⇒ `ultimo === null` ⇒ la guardia de
`:861` no entra ⇒ el `upsert` de `:873` escribe `estado: 'fallida'` y
`pagada_en: null` sobre una mensualidad **ya cobrada**.

Consecuencia: el panel de cobranza SaaS afirma que una flota que pagó no pagó;
si algo automatiza la suspensión por impago, la suspende.

**¿Hay prueba que cubra este camino? No la encontré.** Existen
`suscripcion_orden.test.ts` y `suscripcion_doble.test.ts`, que cubren el orden
CON marca legible; el camino de la marca ILEGIBLE (`error` por valor) no lo
cubre ninguno de los dos — es el mismo hueco que la 30 reportó.

**Causa raíz probable.** «No hay marca» y «no pude leer la marca» comparten el
mismo valor de retorno (`null`).

---

### [MEDIO · REINCIDENTE — 2ª aparición] Un Chromium que no arranca en la SEGUNDA flota se traga el aviso de los tickets que la PRIMERA ya sacó de la cola automática

`src/app/api/cron/facturar/lote.ts:697` (`if (falloDeArranque) {`) · `:725`
(el `return` con 503) · `:741` (`const avisos = await
avisarALasPersonas(bloqueadosPorFlota, hoy);`, por debajo de ese `return`) ·
`:385`/`:358` (`anotarBloqueo`) · `:406`+`:686` (`falloDeArranque`, declarado
fuera del bucle) · `src/lib/likida/facturacion/al_vuelo.ts:713-735`.

Verificado hoy: las líneas son las mismas. El escenario con valores (CAPUFE
pide CAPTCHA a dos tickets de `t-1` ⇒ `bloquear()` los saca de la cola con
`autofactura_bloqueada_en`; el segundo `conNavegador` de `t-2` no arranca ⇒
`return` 503 en `:725` ⇒ `:741` no corre ⇒ los reintentos de QStash devuelven
`ya_en_proceso` sin campo `bloqueado`) está en el reporte del 17-sep.

**¿Hay prueba que cubra este camino? No.** `route.test.ts:544-557` monta el
fixture exacto y afirma `status 503`, `intentados: 1`, `sinIntentar: 1` — **no
mira `avisos` ni una vez**.

**Causa raíz probable.** El aviso a las personas es POR FLOTA y quedó debajo de
un `return` que decide por el LOTE; sus tres hermanos ya se movieron al
`finally` por esta misma razón (`:796-814`).

---

### [BAJO · REINCIDENTE — 3ª aparición] `mantener_mcp_oauth` puede fallar todas las noches y el latido de `purgar` sale `ok`

`src/app/api/cron/purgar/route.ts:361-375` (el fallo se loguea y se alerta;
`mcpOauth` queda `null` y nada más) · `:383-385` (`estado` mira
`erroresRetencion0104` y `productoEventoError`, **no** `mcpOauth` ni `storage`)
· `:390-397`.

Verificado hoy: sin cambios. De los 4 subsistemas que este cron ejecuta, 2
mueven el veredicto y 2 no. La prueba que prometería cerrar la clase
—`src/app/api/cron/latido-en-toda-salida.test.ts`— solo exige que haya latido
en `interruptor_ilegible` y `saltado:`, nunca que un subsistema fallido mueva
el veredicto: el `purgar` de hoy la pasa en verde.

**Causa raíz probable.** `estado` se fue ampliando subsistema por subsistema en
vez de derivarse de la lista de resultados.

---

### [BAJO · NUEVO] `LecturaCortadaPorReloj` nace fuera de la jerarquía que la API pública ya sabe traducir, y su línea de Sentry no trae ni tenant ni comprobante

`src/lib/likida/pg.ts:84-96` (la clase: `extends Error`, no `extends
LecturaIncompleta`) · `:289-291` (el `logger.error`, con `consulta`, `leidas`
y `paginas` — sin tenant, sin uuid) · `src/app/api/v1/_comun.ts:116-121` (el
único traductor: `if (err instanceof LecturaIncompleta)`).

Escenario: el día que cualquier ruta de `/api/v1` le pase un `venceEn` a
`traerTodoDesdeId` —que es para lo que se hizo el parámetro— el corte de reloj
sale por `fallo()` como `error_interno` con el texto «No se pudo completar la
lectura… vuelve a intentar en un momento», o sea un 500 genérico que invita al
TMS del cliente a reintentar en bucle, en vez del `lectura_incompleta` con
instrucciones que su hermana ya tiene. Y en Sentry, la línea
`pg.lectura_cortada_por_reloj` dice `consulta: 'consolidado.candidatos_gasto'`
y nada que permita saber **de qué flota** o **de qué CFDI** hablaba: el
identificador solo aparece si el `catch` de `ciclo.ts:359` alcanza a envolverlo.

Consecuencia: para el equipo que mantiene esto. Es deuda, no daño: hoy el único
llamador con reloj es el cron, que sí envuelve. Por eso BAJO.

**¿Hay prueba que cubra este camino? No aplica del todo** —
`pg.test.ts:354` afirma `rejects.toThrow(LecturaCortadaPorReloj)`, que es el
motor; no existe ninguna sobre `_comun.ts::fallo()` con esta clase.

**Causa raíz probable.** La clase se escribió al lado de `LecturaIncompleta` en
vez de debajo de ella.

---

## Lo que revisé y está bien

Todo abierto y leído hoy. Las cuatro primeras son candidatos a hallazgo que
**perseguí y refuté**, y cuentan tanto como los hallazgos porque cierran la
pregunta.

- **El `upsert` a `cfdi_xml` de `consolidado.ts:399-414` como «avance durable
  antes del corte».** Era mi mejor candidato contra el mensaje del commit:
  `fc811a0` afirma que el corte ocurre antes del primer avance durable y esta
  escritura ocurre antes del corte. **Refutado:** `tiene_multiples_conceptos` y
  `total_conceptos` no tienen un solo lector en `src/` (solo la 0076 que las
  crea y `:408-409` que las escribe), y el `onConflict
  'tenant_id,cfdi_uuid'` las reescribe idénticas en el reintento. Escritura
  inerte.
- **`al_vuelo.ts` — el claim, la marca de emisión y el bloqueo.** Perseguí el
  «CFDI emitido dos veces». Los tres candados están y en el orden correcto:
  `reclamarIntento` (`:227`) ANTES de decidir; `marcarEmisionEnCurso`
  (`:660-682`) ANTES de abrir la sesión y **falla cerrado** (`:257` y `:469`
  devuelven sin tocar el portal si el `update` no se pudo confirmar); y
  `levantarEmisionEnCurso` (`:684-699`) solo levanta SU motivo
  (`.eq('autofactura_bloqueo', BLOQUEO_EMISION_EN_CURSO)`), así que un bloqueo
  real puesto mientras tanto no se pisa. El proceso que muere a media sesión
  deja la marca puesta a propósito. Y un gasto ya bloqueado no puede reentrar:
  `decidirAutofactura:109` lo rechaza con `motivo: 'bloqueado'` vía `enrutar`.
- **`facturacion_escritura.ts::crearFactura` (`:348-452`).** Las dos escrituras
  sin transacción (`factura_emitida` + `factura_viaje`) tienen compensación
  real, y la compensación **cancela, no borra** (`:436-437`), con el fallo de
  la compensación gritado con `facturaId` incluido (`:439-442`). El error del
  insert principal preserva la traducción del choque (`traducirChoque`,
  `:400-404`) en vez de aplanarlo a «error interno».
- **`duplicados.ts` (140 líneas, completo).** Sospeché del `monto` que se fija
  con la PRIMERA fila del grupo (`:39`) y nunca se actualiza. **No puede
  mentir:** en el grupo de folio el monto forma parte de la llave
  (`:126`), y en el de CFDI la llave es `uuid#orden`, que es la partida —el
  mismo dedup del motor y del índice de la 0065—, así que todas las filas del
  grupo traen el mismo importe por construcción.
- **`ciclo.ts` — los otros tres cortes de reloj.** Los tres están en el punto
  correcto y `todoBien = false` **no es opcional** en ninguno: antes de
  `prov.verificar` (`:532-538`), antes de quemar cuota del SAT
  (`:632-639`, con el comentario que explica que un paquete se baja dos veces y
  a la tercera el proveedor lo rechaza) y al entrar a cada XML (`:277-283`). El
  que falla es el del `catch`, no estos.
- **`ciclo.ts::ligar` (`:214-227`)** — guardia optimista `.is('cfdi_uuid',
  null)` con `.select('id')` y la verdad devuelta por valor
  (`(data ?? []).length === 1`); el perdedor de la carrera se marca
  `'disponible'` con motivo en vez de pisar el comprobante ajeno.
- **`ciclo.ts::soltarSolicitudAtorada` (`:471-489`)** — el `update` ancla
  `.eq('estado','solicitada').is('request_id', null)` en el WHERE, así que dos
  barridos simultáneos no la sueltan dos veces, y el mensaje que se escribe en
  `proveedor_mensaje` dice el rango exacto.
- **`ciclo.ts:756-772`** — la reserva del rango distingue el rebote del candado
  (`CODIGOS_RANGO_YA_VIVO` → `logger.info`) de cualquier otro error (→
  `r.errores` + `logger.error` con el código SQLSTATE). Es el fail-open que la
  ronda anterior cerró y sigue cerrado.
- **`pg.ts:271-312` completo.** El corte va ANTES de `construir(cursor)`, así
  que no deja una promesa de consulta colgando; `exigir(res, consulta)` sigue
  comprobando el error por valor en cada página; y las dos salidas honestas
  (`filas.length >= esperadas` y `pag.length === 0`) no se tocaron.
- **Compuerta de mi rubro, corrida por mí:** `npx vitest run src/app/api` →
  **86 archivos / 1,233 pruebas verdes** (22.1 s) — el mismo par que el 17-sep,
  ni una prueba nueva en mi superficie. Y los archivos que cito como evidencia
  del rubro (`ciclo_flota`, `pg`, `consolidado_orquestador`, `storage_borrado`)
  → **4 archivos / 57 pruebas verdes** (1.1 s).

## Lo que descarté y por qué

- **«El reloj corta a media escritura de líneas».** No puede: `candidatosDeGasto`
  corre en `consolidado.ts:485` y el `enLotes` de ligado está en `:507`, el
  `upsert` de líneas en `:538-541`. Entre el corte y la primera escritura de
  decisión no hay nada. Descartado.
- **«El `venceEn` no llega desde la ruta».** Llega: `descarga-sat/route.ts:104`
  lo calcula y `:116` se lo pasa a `correrDescargaSat`; `ciclo.ts:341` lo
  reenvía. Y hay prueba que lo ancla (`ciclo_flota.test.ts:625-644`). El
  cableado está bien; lo que falla es qué se hace con el lanzamiento.
- **«Los tres llamadores de `processor.ts` se quedaron sin reloj».** Es cierto y
  es **deliberado** (el parámetro es opcional para no cambiarle el
  comportamiento a nadie más), y el riesgo que genera —una lectura de 950 s
  dentro del webhook de WhatsApp— es de reloj y presupuesto, **no de mi
  rubro**. Se lo dejo a rendimiento; lo anoto aquí solo para que conste que lo
  vi y no lo reporto.
- **`logger.error` en `pg.ts:290` para un corte de reloj que es de diseño.** Es
  ruido en Sentry (`logger.ts:4-8`: los `warn` y `error` se replican), pero el
  ruido de observabilidad es de operabilidad, no mío. Solo reporto la parte de
  contrato (no lleva identificador de fila), que sí es mía.
- **`cotizador/lector.ts:164`**, hermano del ALTO de `auditor_cobranza`: sigue
  filtrando `.eq('estatus','liquidado')` y la constraint de la
  `0299:210` impide que un viaje rechazado siga en ese estatus. Refutado por
  tercera ronda consecutiva; no vuelve a aparecer.
- **`src/middleware.ts`**: sigue sin existir. Cuarta ronda que mi rubro me lo
  asigna y el repo no lo tiene. Lo que alguien podría suponer ahí vive en
  `api/v1/_comun.ts::abrir()` y en `puertaCron`.

## Lo que NO alcancé a revisar

- **La ejecución real del hallazgo ALTO nuevo.** Está demostrado por lectura de
  control de flujo (`ciclo.ts:358 → 394 → 660 → 687`) y por el estado que la
  prueba `:547` deja escrito en su base falsa, pero **no lo ejecuté**: no puedo
  editar archivos del repo y no monté un runner aparte. Es lectura rigurosa, no
  ejecución, y lo digo con esas palabras.
- **`correrLote` por dentro** (`al_vuelo.ts:340-505` sí lo abrí hoy;
  `reconectar`, `refrescarSesiones` y `conPortales` **no**). Sigue siendo el
  único camino del repo que emite un CFDI irreversible desde un cron.
- **`processor.ts` completo (4,990 líneas).** Hoy solo miré los tres llamadores
  de `guardarYConciliarConsolidado` (`:1669`, `:2027`, `:3422`). El bucle de
  tools, la asistencia y las estadías siguen sin abrir, cuarta ronda.
- **Los reincidentes de la 30 que no toqué:** BE-30-2 (`avisar_cierre.ts:115`),
  BE-30-3 (`intake/rep.ts:207-216`), BE-30-4 (`libro_viaje.ts:590`), BE-30-5
  (`pg.ts:267`), BE-30-6 (`processor.ts:1307`), BE-30-7
  (`cron/escalar/route.ts:420-424`) y BE-30-8. Hoy solo reverifiqué BE-30-1,
  que va arriba con sus líneas. Su detalle vive en `docs/auditoria-30/backend.md`.
- **Sin abrir**, de la lista que la 29-32 arrastran: `marketing/*`, `lead`,
  `admin/copiloto`, `admin/qa/*`, `auth/correo`, `client-error`,
  `export/{bitacora-peaje,carta-porte-xml,facturas-proveedor,jornada,liquidaciones,pdf}`,
  `dashboard/{chat,archivo,onboarding-chat}`, `admin/mapa-prospectos/mensaje`,
  `v1/openapi` (1,200 líneas), `mcp/route.ts`.
- **Postgres vivo.** Lo que afirmo de la `0299` y de la 0076 sale de leer su
  SQL, no de ejecutarlo. El MAPA dice que se puede levantar Postgres en esta
  imagen y **no lo levanté**.
- **No corrí la suite completa** (~150 s), ni `npm run build` (prohibido), ni un
  solo `pruebas-manuales/*.prueba.ts`.
