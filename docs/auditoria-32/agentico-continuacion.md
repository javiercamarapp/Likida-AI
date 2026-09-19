# Sistema agéntico y orquestación — auditoría 32 (continuación 17-sep)

**Nota: 3/10** (antes 4). Razón del movimiento: **mirada más profunda — el
código no cambió y la nota anterior estaba inflada.**

Lo primero que hice fue medir si había algo que atacar, y no lo hubo:

```
git log --oneline 8b01aec..HEAD -- src/lib/agents src/lib/likida/processor.ts \
    src/lib/likida/conv.ts src/lib/likida/cuadre src/lib/likida/agentes \
    src/lib/likida/presupuesto.ts src/lib/likida/startup.ts
  → (vacío)

git diff --stat 8b01aec..HEAD -- src/
  → src/lib/likida/migraciones_verificadas.test.ts | 3 ++-
```

**Ni una línea de este rubro se movió desde que se mergeó la 31.** El intento de
arreglo de AG-31-A1 de la continuación 1 está revertido (lo confirmé contra
`processor.ts:4804-4823`, que sigue idéntico al fuente que citó la 31). AG-C1
—el consolidado ECC de la 30— **sí sigue cerrado** en `ciclo.ts:342-357`, con
`marcar` fuera del `if (!yaDescargado)` y `r.consolidados++` adentro; ese es el
único crédito vivo del rubro y lo reconfirmé línea por línea.

Así que los 9 abiertos siguen los 9, y la nota no baja por ellos: baja porque
abrí las tres áreas que la 31 dejó escritas como «lo que NO alcancé a revisar»
—el copiloto (6ª ronda fuera), el `runner.ts` de los ~45 motores (4ª ronda) y el
camino de OFICINA del processor— y las tres tienen un punto de muerte sin cierre
hacia el humano. Uno de ellos le pega al **contralor**, no al chofer: el sistema
le contesta «Dame un minuto y te contesto ⏳» y, si el turno no cabe cinco veces,
su pregunta muere como carta muerta que —por el ALTO reincidente de más abajo—
nadie sella y nadie le avisa.

El ancla de 3 —«existe un estado donde la base dice una cosa y el usuario cree
otra»— la 31 la reconoció tocando por tres caminos y aun así se quedó en 4 por la
calidad de la maquinaria de concurrencia. Volví a recorrer esa maquinaria y sigue
siendo buena de verdad (lo detallo abajo, con `archivo:línea`). Lo que cambió es
el conteo: hoy son **seis** caminos hacia ese mismo estado, dos de ellos nuevos, y
la nota de 4 ya no se puede sostener con un solo argumento de calidad estructural
frente a seis instancias del defecto que define el ancla más baja.

Contable:

| Medida | Valor de hoy |
|---|---|
| Hallazgos abiertos de la 31 verificados uno por uno | 9 de 9 |
| Siguen intactos **línea por línea** | **9 de 9** |
| Líneas del rubro cambiadas desde la 31 | **0** |
| Hallazgos nuevos | 3 (2 ALTO, 1 MEDIO) |
| Sitios donde `soltarClaim()` aplaza y **consume** intento pese a no haber trabajado | **2** (`processor.ts:1689`, `:1941`) |
| Familias de motores que el runner despacha **sin reloj** | 4 (financieros, dirección-correo, crecimiento, ingeniería) |
| Archivos de prueba del rubro corridos hoy | 8 archivos / 276 pruebas, verdes |

**El riesgo mayor del rubro, hoy:** el producto tiene tres formas distintas de
decirle a alguien «ahorita te contesto» y ninguna de las tres garantiza que
alguien conteste — y en dos de ellas el humano que se queda esperando es el que
firma el contrato.

---

## Estado de los 9 abiertos de la 31

Verificados con el fuente delante, no con el reporte. El árbol es el mismo
(`git diff` arriba), así que todo sigue abierto **por construcción**; los
verifiqué igual porque un hallazgo que ya no está es un hallazgo mal reportado.

| Hallazgo 31 | Dónde lo verifiqué hoy | Veredicto |
|---|---|---|
| [ALTO] El cierre dice «tu PDF no se entregó» con el PDF encolado | `processor.ts:4804-4823`; `:97` importa `pdfEstadoDe` y no lo usa ahí | **REINCIDENTE** (2ª) |
| [ALTO] Carta muerta que no es foto: nadie la sella | `conv.ts:994`, `wa_pendientes.ts:344`, único llamador `processor.ts:4103` | **REINCIDENTE** (4ª) |
| [ALTO] `escalado` no re-arma su filo | `escalar_viaje.ts:274-281`, `:285`, `:465-467`, `:496-501` | **REINCIDENTE, 5ª ronda** |
| [ALTO] Consolidado que lanza se da por bajado | `ciclo.ts:358-360`, `:394`, `:660`, `:687-709` | **REINCIDENTE** (3ª) |
| [ALTO] Idempotencia de `guardarYConciliarConsolidado` falla ABIERTA | `consolidado.ts:421-439`, `:440-443`, `:457-470`, `:505-529` | **REINCIDENTE** (3ª) |
| [MEDIO] El prompt ordena narrar el remanente | `prompts.ts:79`, `guardia.ts:108-121`, `tools.ts:163-172` | **REINCIDENTE** (3ª) |
| [BAJO] `definitivo` sella para el jefe y no para el chofer | `avisar_cierre.ts:92-99` vs `processor.ts:1200-1208` vs `:4912-4915` | **REINCIDENTE** (3ª) |
| [BAJO] El «listo» sin hora se abandona MUDO | `processor.ts:4009-4015` | **REINCIDENTE** (3ª) |
| [BAJO] El degradado corre `cuadrarDesdeDB` dos veces | `processor.ts:4546`, `:4605-4610`, `guardia.ts:102,143,152` | **REINCIDENTE** (2ª) |

Abajo repito con `archivo:línea` de hoy **solo los que cambian de argumento o
cuyo número de línea se movió**; los que la 31 describió exacto y siguen exactos
no los vuelvo a narrar entero — el texto de `docs/auditoria-31/agentico.md` sigue
siendo verdad palabra por palabra y duplicarlo no agrega evidencia.

---

## Hallazgos

### [ALTO] `correr_runner` del copiloto: el intent se gasta ANTES de correr, la vuelta NO tiene reloj duro, y la bitácora de la acción firmada se escribe DESPUÉS del efecto — si la invocación muere, Javier firmó una acción que ocurrió a medias y no quedó asentada

`src/app/api/admin/copiloto/route.ts:180-194` (`reclamarIntent` **marca
`usado_en` y devuelve `fase:'ejecutar'` ANTES de ejecutar nada**) ·
`:204-216` (la ejecución, y su `catch` que dice *«El intent ya se gastó: un
fallo aquí NO deja una llave viva»*) · `:52` (`maxDuration = 60`) ·
`src/lib/agents/copiloto-acciones.ts:192` (`correrRunner(soloAgente,
undefined, { venceEn: Date.now() + 45_000 })` — **reloj COOPERATIVO y nada
más**) · `:195-199` (`anotarCorridaEnBitacora`, **después** de la vuelta) ·
`:92-117` (la tarjeta: `gateo: 'doble'`, `implementada: true`) ·
`src/lib/likida/agentes/runner.ts:1178-1215` (`conRelojDuro`, **que este
camino no usa**) · `src/app/api/cron/runner/route.ts:66-70` (el mismo
`correrRunner`, **sí** envuelto) · `src/lib/agents/copiloto-intents.ts:140-149`
(`gastar`: el `UPDATE` con `usado_en` es irreversible).

**Escenario, con valores.** Javier le dice al copiloto «corre el runner ahora».
`proponer_accion` arma la tarjeta, el servidor emite el intent, Javier confirma
dos veces (es `'doble'`). Segundo POST:

1. `route.ts:180` → `reclamarIntent` → `almacen.gastar(...)` escribe `usado_en =
   now()`. **El intent ya no vale para nada más.**
2. `copiloto-acciones.ts:192` corre `correrRunner(undefined, undefined, {
   venceEn: ahora + 45_000 })`. El candado 0 (`runner.ts:676`) solo pregunta la
   hora **ANTES de despachar a cada agente**, nunca durante.
3. `ordenarPorCosto` (`runner.ts:389`) despacha los deterministas primero y deja
   `contenido_fiscal` **al final**. Los deterministas salen en milisegundos, así
   que a `t = 6 s` le toca turno: `6_000 < 45_000`, se despacha.
4. `contenido_fiscal` cae en `correrAgenteCrecimiento(a.id, 'cron')`
   (`runner.ts:996`) — **sin `venceEn`**, a diferencia del back office
   (`:854`), éxito (`:907`), dirección-bandeja (`:1027`) y leads (`:1055`), que
   sí lo reciben. Adentro, `contenido.ts:376-379` llama `generateResponse` **sin
   señal ni tope propio**: `TIMEOUT_LLM_MS = 30_000` (`openrouter.ts:29`) y el
   reintento a otro proveedor (`openrouter.ts:1178-1181`) son **60 s** en el
   peor caso. Van `t = 66 s` > `maxDuration = 60`.
5. Vercel apaga la invocación. **Javier ve un 504.** La respuesta nunca llega.

Lo que quedó en la base: todos los agentes deterministas que ya corrieron
DEJARON sus piezas en `cola_aprobacion` y sus filas en `agente_corrida`. Lo que
NO quedó: `anotarCorridaEnBitacora` (`copiloto-acciones.ts:195`) nunca corre, así
que **la acción de `gateo: 'doble'` que Javier firmó —con su motivo obligatorio—
no deja UNA fila en `bitacora_auditoria`**. Y el intent está gastado: no puede
reintentar; tiene que volver a pedírsela al copiloto.

**Intenté refutarlo y no se cae.** (a) Busqué `conRelojDuro` en el camino del
copiloto: solo aparece en `api/cron/runner/route.ts`. (b) El comentario de
`runner.ts:1160-1170` dice textualmente que el reloj cooperativo no basta *«no
impide que el motor número once, escrito el mes que viene por alguien que no leyó
este archivo, vuelva a hacerlo exactamente igual»* — y aquí hay cuatro familias
(`:799` financieros, `:822` dirección-correo, `:996` crecimiento, `:999`
ingeniería) que hoy mismo corren sin reloj. (c) `route.test.ts` del cron
comprueba leyendo el fuente que la ruta siga envuelta; **no existe la prueba
equivalente para el copiloto**. (d) El daño más caro —`enviador` mandando correo
frío real— **sí está mitigado**: `enviador.ts:208-210` lanza si
`LIKIDA_ENVIADOR_ENCENDIDO` no está puesto, y su default es apagado. No lo cuento
como parte del hallazgo.

Consecuencia: la acción administrativa más peligrosa del catálogo del copiloto
—la única que la propia tarjeta describe como capaz de mandar correo por su
cuenta— es la que pierde su asiento de bitácora exactamente cuando más se
necesita, y el humano que la firmó se queda sin saber qué corrió y qué no.

Causa raíz probable: la bitácora de una acción confirmada se escribe después del
efecto y bajo el mismo reloj que el efecto, y ese reloj es cooperativo justo en
el camino que no heredó `conRelojDuro`.

---

### [ALTO] La pregunta del contralor que no cabe en la invocación se APLAZA pero se contabiliza como FALLO: cinco turnos cargados y su mensaje muere de carta muerta, tras prometerle «Dame un minuto y te contesto»

`src/lib/likida/processor.ts:1689` y **`:1941`**
(`if (rOficina === 'reintentar') { await soltarClaim(); return; }` — **sin
`sinConsumirIntento`**) · `:818-821` (el `return 'reintentar'`, con el comentario
que declara la intención contraria: *«se le dice y se pide al llamador que suelte
el claim: la bandeja durable lo trae de vuelta en otra invocación, con reloj
entero»*) · `src/lib/likida/oficina_wa.ts:219-222`
(`if (reloj && !reloj.alcanza(COSTO_ANALISTA_MS))`) · `:297-302`
(`COSTO_ANALISTA_MS = 8_000 + 20_000 = 28_000`; `RESPUESTA_OFICINA_SIN_TIEMPO`) ·
`processor.ts:1526-1533` (`soltarClaim(false)` deja
`pospuestoSinConsumirIntento = false`) · `:1544` (→ `'reintentable'`) ·
`src/app/api/cron/wa-pendientes/drenado.ts:151-163` (**`'sin_tiempo'` devuelve el
intento; todo lo demás lo consume con `anotarFalloPendiente`**) ·
`src/lib/likida/wa_pendientes.ts:26` (`MAX_INTENTOS_PENDIENTE = 5`) ·
`processor.ts:4049,4072,4079,4111,4131,4150,4158` (los **siete** sitios que para
el MISMO propósito sí llaman `soltarClaim(true)`).

**Escenario, con valores.** Flota Innovativos. El contralor Luis escribe por
WhatsApp: *«¿cuánto llevamos gastado de diésel este mes?»*. Es texto libre, cae
en `atenderTextoOficina(..., { incluirPreguntaLibre: true })`.

1. Esa invocación del cron ya viene cargada: la cadena de choferes que va delante
   trajo 8 fotos a ~13 s de OCR cada una. Cuando le toca al mensaje de Luis, el
   reloj compartido de la invocación (`PRESUPUESTO_WEBHOOK_MS = 120_000`,
   `presupuesto.ts:268`) lleva **104 s gastados**: `reloj.restante()` ≈ 16 s.
2. `oficina_wa.ts:219`: `16_000 < 28_000` → devuelve
   `RESPUESTA_OFICINA_SIN_TIEMPO`. Luis recibe **«Dame un minuto y te contesto —
   ahorita voy con varias fotos de tus choferes. ⏳»**.
3. `processor.ts:818` devuelve `'reintentar'` y `:1941` hace `soltarClaim()`
   **sin el `true`**. `processInbound` devuelve `'reintentable'` (`:1544`).
4. `drenado.ts:163` → `anotarFalloPendiente(claim.id, 'pospuesto: reintentable')`
   → **`intentos` sube a 1**. Y el propio `drenado.ts:152-156` declara la regla
   que este camino viola: *«ESC-1: quedarse sin presupuesto NO es un intento
   fallido — el mensaje ni se miró»*. Aquí el mensaje **tampoco se miró**: el
   analista ni arrancó.
5. Repítelo. Con el fajo del demo (cinco choferes × 22 fotos) el backlog tarda
   varias pasadas en drenar, y en cada una el mensaje de Luis vuelve a quedar
   al final del reloj: **intentos 2, 3, 4, 5**. Luis recibe **cinco veces el
   mismo «Dame un minuto y te contesto ⏳»**.
6. A los 5 intentos la fila es invisible para el cron (`0325:55-56`, `:95-96`
   filtran `intentos < 5`). Y —por el ALTO reincidente de abajo— `tipo_evento =
   'text'` significa que **`descartarCartaMuerta` no la va a sellar jamás**
   (`conv.ts:994` filtra `evento->>type = 'image'`). Luis nunca recibe su cifra,
   nunca se entera de que su pregunta se perdió, y su fila enciende la alarma
   horaria del cron durante los 90 días de retención de la `0155`.

**Intenté refutarlo y no se sostiene.** (a) Los otros **siete** aplazamientos del
mismo archivo —todos los de la barrera de intake, `:4049` a `:4158`— llaman
`soltarClaim(true)`. Estos dos son los únicos aplazamientos que consumen. (b) No
hay ningún tope ni ninguna rama que distinga «se aplazó» de «el motor trabajó y
falló» aguas abajo: `drenado.ts` solo mira si el literal es `'sin_tiempo'`.
(c) No es cosmético: el intento consumido es lo único que separa a un mensaje
aplazable de una carta muerta.

Consecuencia: el **comprador** —el contralor, el que va a estar en la sala el
6-ago— hace la única pregunta que el producto le promete contestar por WhatsApp,
recibe un acuse que dice que sí le van a contestar, y no le contestan nunca. Es
el peor caso de «se trabó y nadie lo dice», sobre la persona que firma.

Causa raíz probable: `'reintentar'` significa «aplázalo» y se implementó con el
`soltarClaim` de «abandónalo»; las dos semánticas existen en la firma y aquí se
eligió la equivocada, en los dos sitios.

---

### [MEDIO] Un motor de agente que LANZA se reporta como `'saltado'` y el latido del runner queda en `'ok'`: `/admin/crons` pinta verde una vuelta en la que corrieron cero de treinta y cuatro

`src/lib/likida/agentes/runner.ts:219-223` (`AgenteDelRunner.resultado` admite
**`'corrio' | 'saltado'` y nada más — no existe `'fallo'`**) · los **diez**
`catch` que traducen una excepción a `'saltado'`: `:784`, `:814`, `:829`, `:868`,
`:918`, `:972`, `:1002`, `:1035`, `:1062`, `:1133` ·
`src/app/api/cron/runner/route.ts:74` (`despachados` cuenta solo `'corrio'`) ·
`:77` (`cortoElReloj` mira **únicamente** `saltadosPorReloj` y
`cortadaPorRelojDuro` — una excepción no entra en ninguna de las dos) · `:78`
(el único rastro es un `logger.info`, no `error`) · **`:122`**
(`registrarLatido('runner', cortoElReloj ? 'parcial' : 'ok', { ... despachados
... })`) · `src/app/admin/crons/vista.tsx:170-171` (**el `detalle` solo se pinta
si `ultimoEstado` es `'parcial'` o `'fallo'`**) · `:71` (`ok` → pastilla
«Latiendo») · `:78` (`ok` → pastilla «OK»).

**Escenario, con valores.** Se despliega una migración que renombra una columna
que leen los lectores compartidos de `@/lib/admin` (los que arrastran dirección,
éxito, crecimiento e ingeniería). La pasada de las 04:00 del runner despacha sus
34 agentes habilitados; los 34 lanzan en su primer `select`.

- Cada uno cae en su `catch` y entra a la lista como
  `{ resultado: 'saltado', motivo: 'column tenant.x does not exist' }`.
- `route.ts:74`: `despachados = 0`. `route.ts:77`: `saltadosPorReloj` está
  **vacía** y `cortadaPorRelojDuro` es `undefined` → `cortoElReloj = false`.
- `route.ts:122`: **`registrarLatido('runner', 'ok', { agentes: 34,
  despachados: 0, ... })`**.
- `route.ts:130`: `cortesSeguidos = 0`, así que tampoco sale el correo del
  tercer corte. `alertarOperador` no se llama por ningún lado de la rama feliz.
- En `/admin/crons`, `vista.tsx` pinta **«Latiendo» + «OK»**, y como
  `ultimoEstado === 'ok'`, la línea de `resumenDetalle` —la única que enseñaría
  `despachados: 0`— **no se renderiza** (`:170`). El tablero dice que el
  orquestador está sano.

**Refutación parcial, que es la razón de que sea MEDIO y no ALTO.** Sí hay un
camino hacia un humano, por otro lado: los motores que tienen su propio
`try/catch` anotan una corrida `'fallo'` antes de relanzar (p. ej.
`exito.ts:563-566`), y esas filas las cuenta `escalaciones.ts:356`
(`corridasFallo`) y las enumera el reporte de dirección
(`direccion/reportes.ts:300`, `:352-354`). Pero ese camino (i) no cubre al motor
que lanza **antes** de su propio `try` —el `await import()` que no resuelve, el
`gastoDelDiaUsd` del back office, el predicado de divergencia—, y (ii) llega por
un correo diario, no por la señal de salud del cron, que es donde se mira.

Consecuencia: la palabra `'saltado'` significa dos cosas incompatibles en la
misma lista —«el kill switch/el techo/el reloj decidieron no correrlo» y «corrió
y explotó»— y el copiloto se la muestra a Javier tal cual
(`copiloto-acciones.ts:208`: `` `${a.agente}: saltado — ${a.motivo}` ``). El
único canal que existe para enterarse de que el orquestador dejó de operar es el
que se queda verde.

Causa raíz probable: el tipo de resultado del runner nació con dos estados y la
excepción no tenía dónde caer, así que se metió en el que sobraba.

---

### [ALTO] El cierre le dice al chofer «tu PDF no se entregó» con el PDF ya encolado; encima no sella la entrega y el siguiente «gracias» lo manda por segunda vez — REINCIDENTE (2ª ronda; el arreglo de la continuación 1 de la 31 se revirtió)

`src/lib/likida/processor.ts:4804` · **`:4805-4817`** · **`:4818-4823`** (el
`else` es el único que sella) · `:97` (importa `pdfEstadoDe` y **no lo usa
aquí**) · `src/lib/meta/client.ts:557-564` (el catch de red **encola** con
`RETRASO_AMBIGUO_SEGUNDOS` y devuelve `{ok:false}` **sin `codigo`**) ·
`:566-572` (un código reintentable **también encola**) ·
`src/lib/likida/avisar_cierre.ts:110-117` (`pdfEstadoDe`: sin `codigo` →
`'encolado'`) · `processor.ts:1187-1199` (el llamador que **sí** lo consulta) ·
`:2286-2295` (la reentrega que se dispara después).

Lo reverifiqué entero porque el encargo avisa que la continuación 1 lo intentó y
la suite lo rechazó: **el árbol de hoy es el de antes del intento**. `:4805`
sigue mirando solo `!enviado.ok`, `pdfEstadoDe` sigue con **dos** de los tres
llamadores del PDF (`:1187` y `avisar_cierre.ts:282`), y el sello sigue viviendo
únicamente en el `else` de `:4818`. El escenario de la 31 (V-4410, anticipo
$12,000.00, comprobado $9,681.00, `fetch failed` → payload en `wa_outbox` a 300 s
→ Juan recibe el PDF cinco minutos después, y otra vez al escribir «gracias»)
se reproduce línea por línea.

Consecuencia: en el camino feliz del demo, el chofer es mandado a molestar al
contralor por un PDF que ya viene en camino, y `alertarOperador('pdf.no_entregado')`
—que `alerta.ts:191` clasifica como evento de dinero— despierta a Javier por
WhatsApp por un blip de red que el propio sistema ya resolvió.

Causa raíz probable: en esta rama «Meta no contestó» y «Meta dijo que no» son el
mismo booleano, y el sistema contesta siempre el peor de los dos.

---

### [ALTO] Una carta muerta que NO es foto no la sella nadie — REINCIDENTE, 4ª ronda

`src/lib/likida/conv.ts:994` (`.eq('evento->>type','image')`) ·
`src/lib/likida/wa_pendientes.ts:344-361` (`descartarCartaMuerta`) ·
`src/lib/likida/processor.ts:4103` (**su único llamador**, dentro del
`if (cierreSolicitado)` y solo sobre `fotoAnterior.muertas`) ·
`wa_pendientes.ts:316-325` (`cartasMuertas()` cuenta **todas**, sin filtrar
tipo) · `src/app/api/cron/wa-pendientes/drenado.ts:241-245` (la alerta) ·
`:251-254` (el latido `'parcial'`) · `src/lib/observability/alerta.ts:43`
(`PISO_ALERTA_MS` = 1 h) · `supabase/migrations/0155_purgas_y_bucket_comprobantes.sql:148-151`
(90 días de retención).

Reconfirmado: `grep descartarCartaMuerta` fuera de pruebas da exactamente dos
apariciones —su definición y `processor.ts:4103`—, y la lista que le llega sale
de `consultarFotoAnterior`, que filtra `image`. El escenario de la 31 (el
«talacha, me cobran 800» que se agota en cinco intentos y se queda sin sellar,
con ~2,160 correos «Urgente» del mismo incidente) se reproduce igual.

**Lo que agrego esta ronda** es que ya no es hipotético que haya cartas muertas
de tipo `'text'`: el hallazgo de arriba (`processor.ts:1689,1941`) **fabrica
una** cada vez que la pregunta del contralor no cabe cinco turnos seguidos. Los
dos defectos se componen, y el segundo convierte al primero en el modo de falla
de una conversación con el comprador, no solo con el chofer.

Causa raíz probable: «carta muerta» se modeló como un caso de la barrera de fotos
del cierre, no como un estado terminal de la bandeja con su propio cierre hacia
el humano.

---

### [ALTO] `escalado` no re-arma su filo para la flota que se compuso: el aviso queda mudo DE POR VIDA — REINCIDENTE, 5ª ronda

`src/lib/likida/escalar_viaje.ts:274-281` (`anota`, llamada **solo dentro** del
`for (const v of viajes)` de `:285`) · `:465-466`
(`for (const [tenantId, c] of porFlota)`) · `:496-501`
(`avisar(..., { hayProblema: c.folios.length > 0 })`) ·
`src/lib/likida/agentes/notificaciones.ts:990-993` (`cerrarIncidente`) ·
`:515-522` (`debeAvisar`, el silencio tras agotar las marcas).

El propio comentario de `escalar_viaje.ts:485-487` nombra el defecto sin verlo:
*«Ahora se llama SIEMPRE que la flota tuvo candidatos esta corrida (`porFlota` la
incluye solo entonces)»*. Ese «solo entonces» **es** el bug: la flota que arregló
su operación deja de tener candidatos, no entra a `porFlota`, y
`avisar(..., hayProblema:false)` nunca se emite, así que `cerrarIncidente` nunca
corre. Escenario y valores idénticos a la 31 (Innovativos, `magnitud_avisada =
12`, semana 5 en silencio).

Consecuencia: el dueño que arregló su operación pierde para siempre la alarma que
compró. Se apaga al portarse bien.

---

### [ALTO] Un consolidado cuya conciliación lanza se da por bajado, avanza el calendario fiscal y no se reintenta NUNCA — REINCIDENTE (3ª)

`src/lib/likida/sat_descarga/ciclo.ts:358-360` (el `catch` empuja a `r.errores` y
`continue`) · **`:394`** (`ingerir` devuelve `{completo:true}` con errores
adentro) · `:660` (`if (resultado.completo) bajados.push(p)`) · `:687-709`
(`todoBien` **nunca lo tocan los errores** → `estado: 'descargada'` y
`ultima_descarga_hasta` avanza) · `:508` (la consulta de solicitudes filtra
`['solicitada','en_proceso','lista']`, así que `'descargada'` es terminal) ·
`src/app/api/cron/descarga-sat/route.ts:155-157`.

Verificado de nuevo porque AG-C1 tocó estas mismas líneas: **no lo arrastró**. Con
`marcar` fuera del `if`, el orden es `try { guardarYConciliar(); marcar(); }` — si
`guardarYConciliar` lanza, `marcar` tampoco corre y el sello sigue en
`'disponible'`; pero el paquete ya se anotó como bajado y la solicitud queda
`'descargada'`, que la consulta de `:508` no vuelve a mirar.

Consecuencia: el mes de diésel más caro del año queda medio conciliado y fuera del
alcance de cualquier reintento automático, con un `1` junto a un `parcial` como
única señal.

---

### [ALTO] La puerta de idempotencia de `guardarYConciliarConsolidado` falla ABIERTA y puede revertir la resolución HUMANA de una línea — REINCIDENTE (3ª)

`src/lib/likida/intake/consolidado.ts:421-439` (el `try/catch` deja
`existentes = null` y **sigue**) · `:440-443` (la salida temprana que ese bloque
dice ser) · `:457-470` (`selladoPorIndice` solo reconoce el trabajo de la
MÁQUINA: gastos con `cfdi_orden`) · `:477-483` (el JOIN se re-corre para toda
línea sin gasto sellado) · `:505-529` (el `upsert` con `estatus` y **sin**
`resuelto_por`/`resuelto_en`) · `:609-618` (`resolverLineaAMano` →
`estatus = 'sin_match'`, que por definición **no sella ningún gasto**) ·
`src/lib/likida/sat_descarga/ciclo.ts:340` (el llamador vivo en cada re-ingesta).

El comentario de `:419-420` —*«El error de lectura conserva su camino de siempre
(seguir al JOIN, que la reanudación de abajo protege)»*— **sigue siendo falso**:
la reanudación de `:445-470` protege las líneas cuyo gasto quedó sellado, y
`sin_match` es precisamente la resolución humana que no sella ninguno. Escenario y
valores idénticos a la 30/31 (línea `indice = 7`, `monto = 1,842.50`, el contador
Luis declarando «ninguno corresponde» el 2-sep-2026).

Consecuencia: un veredicto humano firmado se revierte en silencio y el gasto queda
con `xml_verificado = true`, la bandera que abre el acreditamiento.

---

### [MEDIO] El prompt ORDENA narrar una cifra derivada que la guardia define como inventada — REINCIDENTE (3ª)

`src/lib/agents/prompts.ts:79` (*«ÁBRELE con los números (cuántos comprobantes
lleva, cuánto suman, cuánto era el anticipo, **cuánto queda**)»*) ·
`src/lib/likida/tools.ts:163-172` (lo que `estado_viaje` devuelve: `anticipo`,
`comprobado`, `comprobantes`, `copias_excluidas`, `por_concepto`,
`litros_diesel_leidos` — **ningún remanente**) ·
`src/lib/likida/cuadre/cifras.ts:137-145` (la derivada no está respaldada) ·
`src/lib/likida/cuadre/guardia.ts:108-121` (el cotejo) · **`:119`**
(`registrarEventoSeguridad({ tipo:'cifra_sin_respaldo' })`) · `:143,152` (cae al
reemplazo con `cuadrarDesdeDB`) · `src/lib/seguridad/eventos.ts:38`
(`severidad: ev.severidad ?? 'media'`).

Intacto. Verifiqué las dos mitades hoy: el prompt sigue pidiendo «cuánto queda» y
`estado_viaje` sigue sin devolverlo. Cada «¿cómo vas?» del chofer planta un evento
de severidad media en el tablero de Trust & Safety y paga un `cuadrarDesdeDB`
completo para sustituir el texto por otro que dice lo mismo.

Consecuencia: el tablero que existe para detectar a un chofer manipulando al
modelo mide, en realidad, cuántas veces el chofer saludó.

---

### [BAJO] `definitivo` sella la entrega del contralor y no la del chofer — REINCIDENTE (3ª)

`src/lib/likida/avisar_cierre.ts:92-99` (`pdfListoParaSellar` acepta `'encolado'`
y `'definitivo'`) · `src/lib/likida/processor.ts:1200-1208` (el camino del
CHOFER: `'definitivo'` → `pdf = 'fallo'`, **sin sellar**) · `:4912-4925` (el
camino del JEFE, que sí lo acepta y sí sella). Sin cambios.

---

### [BAJO] El «listo» sin hora de Meta se abandona MUDO y consume su intento — REINCIDENTE (3ª)

`src/lib/likida/processor.ts:4009-4015`: `logger.error('cierre.timestamp_indeterminado')`,
`await soltarClaim()`, `return` — **sin un solo `say`**. Es el mismo `soltarClaim()`
sin `true` del ALTO de oficina, y la misma consecuencia: cinco vueltas y el «listo»
es carta muerta que nadie sella porque `type = 'text'`.

---

### [BAJO] El degradado por OpenRouter caído corre `cuadrarDesdeDB` DOS veces en el mismo turno — REINCIDENTE (2ª)

`src/lib/likida/processor.ts:4546` (`reply = resumenCuadre(await
cuadrarDesdeDB(...), false, 'operador')`) · `:4605-4610` (`guardiaCifras(reply,
agentTools, ...)` con `agentTools = []`) · `src/lib/likida/cuadre/guardia.ts:102`
(no sale temprano: el texto sí tiene cifras) · `:143` · `:152`. Sin cambios, y
`:4607` sigue escribiendo `logger.warn('agent.cifras_forzadas')` en un turno donde
el modelo no escribió una palabra.

---

## Lo que revisé y está bien

Abierto, leído y recorrido con la pregunta del rubro («si muere aquí, ¿qué ve el
humano y qué quedó en la base?»):

- **El cierre de AG-C1 sigue cerrado**: `sat_descarga/ciclo.ts:342-357`. `marcar`
  fuera del `if (!yaDescargado)`, `r.consolidados++` adentro. Lo leí entero otra
  vez: el reparto es correcto y el `update` de `marcar` es idempotente sobre un
  CFDI ya `'ignorado'`.
- **El claim del mensaje y el sellado del turno** (`processor.ts:1493-1549`):
  cuatro estados, no dos; `'indeterminado'` **no** abandona el turno y dice por
  qué (`:1512-1520`); el renovador con `unref()`; y `soltarClaim` distingue de
  verdad las dos semánticas (`:1526-1533`, `:1544`) — el problema del ALTO de
  arriba no es el mecanismo, es que dos llamadores eligieron mal.
- **La contabilidad de reintentos del drenado** (`drenado.ts:146-168`): el
  `break` que corta la cadena, el `devolverIntentoPendiente` exclusivo de
  `'sin_tiempo'` y el `anotarFalloPendiente` del resto son correctos y están bien
  argumentados (ESC-1). El defecto vive del lado del que clasifica, no del que
  contabiliza.
- **La libreta de ráfaga** (`intake/rafaga.ts`, entera, 375 líneas): el
  `empiezaRafaga` que borra lo de una ráfaga muerta (`:158-160`), el desalojo por
  orden de alta que se apoya en que `set` sobre llave existente no reordena
  (`:133-139`), y sobre todo `lineaIncidencias:312-325` — **no afirma el total**
  porque `vistas` es lo de esta invocación y no el fajo del chofer. Es un ejemplo
  ejemplar de la regla «nunca inventar una cifra» aplicada a un texto.
- **El cierre de ráfaga por corte cierra SOLO la libreta del teléfono afectado**
  (`processor.ts:1439-1460`), que era el fix de la 24, y registra el costo solo
  si Meta aceptó (`:1454-1455`).
- **`runAgent`** (`agents/run.ts:49-104`): tres señales de aborto combinadas, el
  `clearTimeout` en el `finally`, `budget` por `runId`, y `costoPorModelo`
  propagado para la fila por modelo. `registry.ts` es de 19 líneas y no tiene
  dónde esconder nada.
- **`guardiaCifras` con snapshot de cierre** (`guardia.ts:88-91`, `:137-140`):
  sin snapshot **no se recalcula** — se dice «Ya cerré tu liquidación ✅» y se
  manda el PDF. Ningún camino puede narrar un cuadre distinto del impreso.
- **El copiloto, ciclo completo** (`agents/copiloto.ts`, 389 líneas, primera vez
  que se abre entero en seis rondas): `CAPTURAS.delete(runId)` antes del
  reintento correctivo (`:276`), el `.catch` que suma lo de la primera vuelta al
  `PartialExecutionError` (`:296-309`), la red final determinista que prefiere la
  tabla cruda de la tool a una disculpa (`:319-337`), y —lo mejor— el `catch` de
  `:353-383`, que **rescata la tarjeta de acción del mapa antes de que el
  `finally` lo limpie** y la entrega en una respuesta degradada. Ese es el patrón
  que el rubro pide: el ciclo que truena igual cierra con el humano.
- **El contrato del intent** (`copiloto-intents.ts`): un solo uso, TTL de 2 min,
  anclado al actor, `argsHash` sobre una tupla JSON, y el consumo ATÓMICO con las
  guardas en el `WHERE` del `UPDATE` (`:140-149`). Dos POSTs simultáneos no
  ejecutan dos veces. El defecto que reporto no está en el contrato: está en que
  se gasta antes de un efecto que puede no terminar.
- **El gateo de `proponer_accion`** (`copiloto.ts:85-104`): rechaza la segunda
  propuesta del mismo turno en vez de sobrescribirla (TC-M3), y valida el
  objetivo contra `INTERRUPTORES` **y** contra `estaApagado` antes de ofrecer un
  no-op. Y `copiloto-acciones.ts:102-116` tiene el texto más honesto del repo:
  describe que `enviador` manda correo por su cuenta en la misma tarjeta que
  Javier firma, con prueba de acoplamiento que falla si sale de la lista.
- **Los candados del runner** (`runner.ts:676-800`): reloj antes de despachar,
  kill switch obligatorio con `continue` si no está declarado, `experimental`,
  techo declarado, backpressure de bandeja estrecha (redactor) y ancha (AGB-5), y
  —lo más fino— el `corridasSinCostoMedidoHoy` de `:906` y `:951`, que trata un
  costo NO MEDIDO como desconocido y no como cero. Los cinco fallan cerrados.
- **`conRelojDuro` + `cerrarPorRelojDuro` + `AvanceRunner`**
  (`runner.ts:272-300`, `:1178-1215`, `api/cron/runner/route.ts:65-70`): el parte
  en vivo compartido POR REFERENCIA con los arreglos del resultado es la decisión
  correcta (un espejo se desincroniza), y el latido va **antes** del correo
  (`route.ts:108-127`) con `PASOS_LATIDO` comparado contra `MARGEN_RELOJ_MS` por
  una prueba. Nada de esto está mal: lo que falta es que el copiloto lo herede.
- **La racha sobrevive al fallo** (`api/cron/runner/route.ts:151-179`): un fallo
  ni suma ni reinicia `cortesSeguidos`, y si no se puede leer se **omite la
  llave** en vez de escribir 0. «No se sabe» no es «es cero», aplicado bien.
- **`startup.ts` entero** (316 líneas): `sinRespuesta()` distingue «eso no
  existe» de «no pude preguntar» (`:30-33`) con la historia real del 28-jul
  documentada; ningún `return` temprano entre sondeos; `Promise.allSettled` con
  `faltan` e `inconclusos` separados, de modo que un sondeo que lanza **no** puede
  producir `{ok:true}` (`:142-155`); y los probes ya no ejecutan negocio (la 0326
  lee catálogo). Es el archivo mejor escrito de mi rubro.
- **`presupuesto.ts:301-335`**: el reloj arranca en el inicio de LA INVOCACIÓN;
  `margenDuro()` es distinto de `restante()` por la identidad que AGEN-A1
  documenta; y `senal(0)` devuelve una señal **ya abortada** en vez de agendar un
  timeout de 0 ms (`:330-333`), que es el borde que la mayoría de los repos
  olvida.
- **El destinatario del veredicto**: los cuatro llamadores de `resumenCuadre`
  pasan `'operador'` explícito (`processor.ts:1418`, `:4316`, `:4546`,
  `guardia.ts:152`); `SOLO_CONTRALOR` se filtra ANTES de contar
  (`resumen.ts:86-101`) y el descargo legal solo va al contralor (`:123`). No
  encontré ningún camino por el que un veredicto del contralor llegue al chofer.
- **El desempate chofer/oficina** (`processor.ts:1930-1943`, `:702-770`): «con
  viaje abierto, es chofer» está aplicado consistentemente —`incluirPreguntaLibre`
  e `incluirDespacho` van a `false` en ruta—, y el log de
  `chofer.oficina_otro_tenant` (`:1931-1934`) no adivina: dice que el dato está
  roto en vez de elegir un tenant.
- **Pruebas corridas hoy**: `guardia`, `copiloto-acciones`, `cron/runner/route`,
  `processor_cierre`, `conv`, `intake/rafaga`, `escalar_viaje`,
  `agentes/runner` — **8 archivos / 276 pruebas, todas verdes**, para confirmar
  que estoy leyendo el árbol vivo.

## Lo que NO alcancé a revisar

- **Los ~45 motores de agente por dentro.** Esta ronda abrí `runner.ts` entero
  (el despachador, que era el hueco de cuatro rondas) y `copiloto*.ts` entero
  (seis rondas), pero de los motores solo entré a `exito.ts` por su
  `anotar`/`correrAgenteExito`, a `contenido.ts` por la llamada al modelo y a
  `enviador.ts` por su interruptor maestro. `backoffice.ts` (67 KB),
  `crecimiento.ts` (88 KB), `ingenieria.ts` (88 KB), `leads.ts` (89 KB),
  `direccion.ts` (59 KB), `finanzas.ts`, `cola.ts` y `cobranza.ts` **siguen sin
  caminar**: 5ª ronda. Los tres primeros son, además, los que el runner despacha
  **sin reloj**, así que ahí puede haber más de lo que reporté.
- **`copiloto-tools.ts` (cross-tenant) y `copiloto-historial.ts`.** Leí
  `copiloto.ts`, `copiloto-acciones.ts` y `copiloto-intents.ts` completos; el
  catálogo de tools de lectura cross-tenant y la persistencia del historial
  (0121) no los abrí. Séptima ronda para las tools.
- **La ráfaga y el runner bajo concurrencia REAL.** Leí `intakeDelta`,
  `esperarIntake`, `intentarLockViaje`, las tres capas de orden de la `0325` y el
  `AvanceRunner`, y monté los casos en papel; **no** monté dos invocaciones
  solapadas. Octava ronda sin rehacerlo.
- **El costo del camino de jornada** (`processor.ts:2255-2266`): ese `for (const
  t of jornada) await sendText(...)` no pasa por `say` y no registra
  `registrarCostoWhatsApp` ni comprueba si Meta aceptó. La asimetría es real y la
  leí; **no la reporto** porque es de contabilidad de costo (rubro de
  rendimiento), no del ciclo conversacional, y porque no pude fijar el valor del
  costo perdido.
- **El camino de oficina del consolidado sin reloj** (`processor.ts:1667-1672`):
  sigue llamando `guardarYConciliarConsolidado` **sin `venceEn`** a diferencia de
  `ingerirRep` dos líneas arriba. Lo leí otra vez y **sigo sin reportarlo** por
  la misma razón que la 31: no pude fijar valores que demuestren que un ECC
  típico no cabe en la invocación.
- **`sat_descarga/peaje_cierre.ts`**: comparte `venceEn` con la descarga; solo lo
  miré desde el lado del reloj. Segunda ronda fuera.
- **Nada que exija base viva.** Los cinco ALTOs reincidentes, el de oficina y el
  del copiloto se argumentan sobre el fuente, las migraciones (`0325`, `0155`,
  `0131`) y las pruebas existentes. El comportamiento de `wa_outbox` se deriva de
  `meta/client.ts:557-572`, leído, no ejecutado.
- **No corrí la suite completa** (la corre el orquestador): 8 archivos del rubro,
  276 pruebas.
