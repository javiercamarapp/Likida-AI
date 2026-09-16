# Tool calling — auditoría 31

**Nota: 5/10** (antes 5). **No se mueve**, y decirlo es el resultado: ninguna de
las tres razones aplica. El árbol es byte por byte el que la 30 calificó
(`git diff 5ce91b2..HEAD --name-only` → dos dotfiles de latido, cero líneas de
`src/`), así que «se atacó y subió» es imposible; los tres hallazgos nuevos que
traigo son un MEDIO y dos que no cambian el veredicto de las anclas; y la deuda
—que sí cobró factura otra vez— es exactamente la misma que la 30 ya descontó al
bajar de 7 a 5. Volver a cobrarla sería cobrar dos veces el mismo impago.

Lo contable de hoy, medido, no recordado:

| Qué | Ronda 29 | Ronda 30 | Ronda 31 |
|---|---|---|---|
| `npx vitest run src/lib/llm src/lib/agents src/lib/likida/tools_invariantes.test.ts src/lib/likida/tools_estado_viaje_aud24.test.ts` | 54 arch. / 339 pruebas | 54 / 339 | **54 / 339** |
| Hallazgos abiertos al cerrar | 8 | 10 | **13** |
| Cerrados en la ventana | — | 0 de 8 | **0 de 10** |
| `registerTool(` en producción | 33 | 33 | **33** |

Tercera ronda consecutiva con el número EXACTO de pruebas. Segunda ronda
consecutiva con cero cierres. Los dos ALTOS más viejos entran en su **4ª**
(TC-A1) y **3ª** (TC-A2) aparición.

Dónde caen las anclas del rubro, para que la nota sea comprobable y no una
impresión: **no es 8+** porque hay dos esquemas ad-hoc por los que el modelo sí
escribe un dato (el `valor` del piloto, el `valor` de `seleccionar` del
adaptador de computer-use) y porque el camino de fallback de `generateStructured`
tiene una rama sin una sola prueba (TC30-M1). **No es 6** por lo mismo: la regla
de `properties: {}` se respeta en las 33 tools del registro y en las 8 del MCP,
pero no en los 6 esquemas que se le pasan a `generateWithTools`/`generateStructured`
por fuera del registro. **No baja de 5** porque el modelo sigue sin poder decidir
QUÉ FILA se escribe: `tenantId`/`viajeId` salen de `ctx` en las 33, y los dos
candados de `guardar_liquidacion` (`cierrePedidoPorTexto`, cierre en ceros) viven
en la tool y no en el prompt.

**El riesgo mayor del rubro, hoy:** el único adaptador de facturación que está
cableado por flota deja que el modelo escriba el VALOR que se teclea en un
formulario fiscal, y el único adaptador que implementa la regla contra eso está
muerto — y ni siquiera la implementa entera (TC31-M2).

## Hallazgos

### [ALTO] TC30-A1 — REINCIDENTE (2ª ronda): el piloto de visión deja que el modelo escriba el VALOR que se teclea en el formulario fiscal; el único candado es la regla 5 del prompt

`src/lib/likida/facturacion/adaptadores/piloto_vision.ts:150` · `:496` ·
`:510-516` · `:453` · `:460-462` · `:468-476` · `:505-507` ·
`src/lib/likida/facturacion/adaptadores/registro.ts:459-473` ·
frente a `src/lib/likida/facturacion/adaptadores/computer_use.ts:43-50` y `:401-408`

Reverificado línea por línea, sin un carácter de cambio: el esquema sigue con
`valor: z.string().nullable()` (`:150`); `ejecutar()` somete el **selector** a
sus cuatro guardas (compuesto `:453`, identidad exacta contra el inventario
`:460-462`, `contar() !== 1` `:468-476`, campo password `:505-507`) y la única
condición sobre el **valor** sigue siendo `:496` (`a.valor === null || a.valor === ''`);
después `await pagina.escribir(a.selector, a.valor)` (`:512`/`:514`) y
`capturado[a.selector] = a.valor` (`:516`). El cableado por flota sigue en
`registro.ts:459` (`registrarAdaptador(tenantId, crearPilotoVision({…}))`) con el
`receptor` armado campo por campo en `:464-471`.

Escenario, con valores (idéntico al de la 30, revalidado). Flota con
`FACTURACION_PILOTO=si`, sesión vinculada en el portal de una gasolinera. El
ticket llega con `campos = [{clave:'webId', valor:'A83920', requerido:true},
{clave:'total', valor: null, requerido:true}]` — el `null` es el estado normal
cuando el OCR no leyó el campo. El prompt lo renderiza `· Importe total
(requerido): (sin leer)` (`:574`). El modelo devuelve
`{tipo:'escribir', selector:'#total', valor:'1234.00', esBotonQueEmite:false}`;
las cuatro guardas pasan y se teclea. Sale `ok: true` con
`capturado = {'#total':'1234.00'}`.

Consecuencia: la persona que abre la captura para timbrar tiene que cotejar campo
por campo contra el ticket —el trabajo que el producto existe para quitar—,
porque ninguna cifra de esa pantalla está garantizada como leída. Si no lo hace,
se timbra un CFDI irreversible con un importe que escribió un modelo.

Sigue siendo ALTO y no CRÍTICO por la misma razón que en la 30: el piloto no
emite nunca (`:488-490`, veto en los dos modos), así que siempre hay una persona
entre el valor inventado y el timbre.

Causa raíz probable: sin cambios — los dos adaptadores nacieron del mismo
problema, el que enuncia la regla se quedó sin cablear y el que se cableó
sustituyó la restricción estructural por una instrucción en lenguaje natural.

### [ALTO] TC-A1 — REINCIDENTE (4ª ronda): el candado de «una sola propuesta por turno» sigue siendo un check-then-act sobre un `await` que `Promise.all` atraviesa

`src/lib/agents/copiloto.ts:85` · `:101` · `:115` ·
`src/lib/llm/openrouter.ts:1264` · `:1276` · `:931-943` ·
`src/lib/llm/tool-executor.ts:391-408`

Los mismos tres números que en la 28, la 29 y la 30:
`ACCIONES_PROPUESTAS.has(ctx.conversationId)` en `:85` (síncrono), la única acción
implementada cede el control en `await estaApagado(objetivo)` en `:101`, y el
`.set` que cierra el candado ocurre después, en `:115`. `generateWithTools`
dispara todas las tool_calls de la ronda con `Promise.all(llamadas.map(async …))`
(`openrouter.ts:1264`) y la dedup `inRound` llavea por `nombre:JSON.stringify(args)`
(`llaveDeCache`, `:931-943`, que solo colapsa a `nombre` las tools **sin**
`properties`; `proponer_accion` sí las tiene). `proponer_accion` no es
`isMutation` —el único `isMutation:true` del repo sigue siendo `tools.ts:262`—,
así que la rejilla que sí resuelve esta carrera (cachear la PROMESA antes del
`await`, `tool-executor.ts:391-408`) no la cubre.

Escenario, con valores. Javier escribe «apaga el agente de cobranza y el
redactor». El modelo devuelve en la MISMA ronda
`proponer_accion({accion:"apagar_agente", objetivo:"agente:cobranza"})` y
`proponer_accion({accion:"apagar_agente", objetivo:"agente:redactor"})` — llaves
distintas, dos ejecuciones. A: `has` → `false`, suspende en
`estaApagado('agente:cobranza')`. B: `has` → **todavía `false`**, suspende. A
reanuda y hace `set(runId, cobranza)`, devuelve
`{ok:true, instruccion:'La previsualización quedó armada…'}` (`:116-122`). B
reanuda, **sobrescribe** y devuelve el mismo `{ok:true}`. `copiloto.ts:342` lee
UNA tarjeta: `agente:redactor`.

Consecuencia: el modelo le confirma a Javier que armó las dos, él ve una, la
confirma, y `agente:cobranza` sigue encendido despachando su cron.

Causa raíz probable: el candado se escribió contra el síntoma (dos `set`
seguidos) y no contra el mecanismo que produce el par.

### [ALTO] TC-A2 — REINCIDENTE (3ª ronda): el analista del panel del CLIENTE sigue sin la red que el copiloto tiene desde la 28; un tropiezo del último ciclo tira el turno pagado

`src/lib/agents/analista.ts:370` (`try {`) · `:371` (`generateWithTools`) ·
`:479-497` (la red determinística) · `:522-525` (`} finally {`, no hay `catch`) ·
`:231` (`required: ['tipo']`) ·
`src/app/api/dashboard/chat/route.ts:151` · `:172` ·
`src/lib/llm/openrouter.ts:1255-1257` · `:1310` · `:1324` · `:1327` ·
frente a `src/lib/agents/copiloto.ts:353-383`

Reverificado: `ejecutarAnalista` abre `try {` en `:370`, llama `generateWithTools`
en `:371` con `maxToolRounds: 5` y `terminalTools:['entregar_respuesta']`, y ese
`try` **solo tiene `finally`** (`:522`). No hay `catch` en toda la función. La red
determinística —la que arma una tabla con lo que las tools sí leyeron, con el
comentario «datos reales sin narración le sirven más al contralor que una
disculpa»— vive en `:479-497`, **dentro** del mismo `try` y **después** de la
llamada que lanza: es inalcanzable por construcción.

Escenario, con valores. El contralor pregunta «¿cómo va mi flota este mes?» en
`/dashboard`. Rondas 0-3: `kpis_flota` devuelve
`{viajesLiquidados:128, montoComprobado:1847320.50, tasaCuadre:0.94}`, y
`serie_gasto`, `top_rutas` y `motor_fiscal` responden bien — los cuatro quedan en
`executed`. Ronda **4** (`round === maxRounds - 1`, `openrouter.ts:1255`): el
modelo pide `entregar_respuesta({bloques:[{tipo:"texto"}]})`, que el esquema
admite porque el item solo declara `required:['tipo']` (`analista.ts:231`).
`validarBloques` descarta el bloque por texto vacío, devuelve `null`, y el handler
contesta `{ok:false, error:'bloques inválidos…'}` (`:242`).
`entregaTerminalAterrizo` lee ese `ok:false` (`openrouter.ts:906-908`), `entregada`
queda en `false`, el `for` termina y sale `LoopGuardError(5, executed)` (`:1324`),
envuelto en `PartialExecutionError` (`:1327`). El route registra una fila
`modelo:'parcial'` (`chat/route.ts:157-165`) y manda
`{t:'error', error:'el analista no pudo responder en este momento'}` (`:172`).

Consecuencia: el contralor —el comprador— ve «el analista no pudo responder» sobre
una pregunta cuyos números el sistema acababa de leer en ese mismo turno; la flota
paga hasta nueve completions que no entregan nada. En un demo, esta es la pantalla
que se enseña.

Causa raíz probable: `LoopGuardError` se sigue tratando como «el turno no existió»
aunque `executed` traiga lecturas buenas; el arreglo de la 28 se aplicó al llamador
que se estaba auditando y no a la frontera que los dos comparten.

### [MEDIO] TC31-M1 — NUEVO: el sandbox de tools es la lista de esquemas, no una comprobación; `executeTool` resuelve el nombre contra el REGISTRO GLOBAL y nadie compara contra lo que se ofreció

`src/lib/llm/tool-executor.ts:86` (`const REGISTRY = new Map<…>`) · `:157`
(`const tool = REGISTRY.get(name)`) · `src/lib/llm/openrouter.ts:1299`
(`opts.toolExecutor(call.function.name, args, opts.signal)`) ·
`src/lib/agents/copiloto-tools.ts:6-9` (la garantía escrita) ·
`src/lib/agents/copiloto.ts:234` · `:254` · `:169` ·
`src/lib/agents/analista.ts:243`

`generateWithTools` toma el nombre que vino en la `tool_call` y se lo pasa tal cual
al executor (`:1299`); `executeTool` lo busca en `REGISTRY`, que es global al
proceso (`:157`). **En ningún punto del camino se comprueba que ese nombre estuviera
en `opts.tools`.** El único guardarraíl del repo en esa dirección es el simétrico y
solo avisa del caso contrario: `toolSchemas` loguea `tool.schema_faltante` cuando se
pide un nombre que no existe (`:106-119`). El caso «se ejecutó algo que no ofrecí»
no tiene log.

Medido, no supuesto: recorrí la clausura de imports de cada entrada (resolviendo
`@/` y relativos sobre `src/`):

| Entrada | Archivos en la clausura | Módulos de tools que registra |
|---|---|---|
| `src/app/api/dashboard/chat/route.ts` | 166 | `likida/tools.ts`, `agents/chat-tools.ts`, `agents/analista.ts` |
| `src/app/api/admin/copiloto/route.ts` | 199 | + `agents/copiloto-tools.ts`, `agents/copiloto.ts` |
| `src/lib/likida/processor.ts` | 153 | `likida/tools.ts`, `agents/chat-tools.ts`, `agents/analista.ts` |

O sea: el copiloto ofrece 16 tools (`copiloto.ts:234`) y tiene **33** alcanzables en
su propio registro, en el mismo proceso, sin depender de ningún supuesto de
despliegue.

Escenario, con valores. `/api/admin/copiloto`, turno de Javier. El modelo emite
`entregar_respuesta({bloques:[{tipo:'texto',texto:'…'}]})` en vez de
`entregar_respuesta_admin` — los dos nombres difieren en un sufijo y los esquemas de
tools no llevan `strict: true` (lo dice el propio repo, `tool-executor.ts:380-381`).
`executeTool` la encuentra (la registró `analista.ts:200`), la ejecuta y escribe los
bloques en **`CAPTURAS` de `analista.ts`** (`:243`), un `Map` de módulo distinto del
`CAPTURAS` de `copiloto.ts` (`:169`). Devuelve `{ok:true, instruccion:'Tu respuesta ya
quedó entregada. Termina tu turno con la palabra "listo"…'}`. Pero `terminales` del
copiloto es `{entregar_respuesta_admin}` (`:253`), así que `entregada` sigue en
`false`; el modelo obedece la instrucción y contesta «listo» en texto plano; la
ronda siguiente sale por `!calls` con `finalText:'listo'` y
`CAPTURAS.get(runId)` del copiloto vacío → la respuesta que Javier ve es la palabra
**«listo»**, sola, después de pagar el turno entero. Y los bloques reales quedan en
el `Map` de `analista.ts` llaveados por ese `runId`, que `copiloto.ts:386` no borra
porque borra el suyo: fuga de memoria con el contenido de una respuesta de superadmin
dentro.

Consecuencia: para el equipo que mantiene esto, la frase de `copiloto-tools.ts:6-9`
—«el analista del cliente lista sus tools por nombre […] y estas no están en esa
lista — un tenant no puede alcanzarlas»— describe una garantía que el código no da.
Lo que hoy la sostiene son dos cosas accidentales: el empaquetado por ruta de
Next.js (que mantiene `copiloto-tools.ts` fuera de la clausura de `/api/dashboard/chat`)
y que **cada** handler falla cerrado por su cuenta (`guardar_liquidacion` muere en
`!ctx.viajeId`, `tools.ts:272`; las de `chat-tools` filtran por `ctx.tenantId`, que en
el copiloto es la cadena vacía, `copiloto.ts:222`). La seguridad está repartida en 33
handlers en vez de en una puerta: la tool nueva que no necesite `viajeId` la abre sin
que nada avise.

Refutación intentada, y falla parcialmente —por eso es MEDIO y no ALTO—: (a) **no**
es cross-tenant hoy: la clausura de `/api/dashboard/chat` no incluye
`copiloto-tools.ts`, así que `metrica_negocio` y compañía no son alcanzables desde el
panel del cliente **en ese bundle**; (b) **no** deja pasar `guardar_liquidacion` desde
el analista: `executeTool:164-167` ya rechaza mutaciones sin `runId` y `analista.ts:335`
sí pone `runId`, pero el handler muere en `!ctx.viajeId` antes de tocar nada — lo que
sí ocurre es un `claimMutation` con llave
`guardar_liquidacion:<tenant>:-:-:<runId>` y su `failMutation` (`tool-executor.ts:176`,
`:292`), fila escrita en `agente_mutacion_idempotencia` desde una ruta de solo lectura;
(c) **no** lo tapa `llaveDeCache` ni `inRound`: operan después, sobre el nombre ya
aceptado.

Causa raíz probable: el registro es global por diseño (registro por efecto colateral del
import) y la lista de esquemas se trató como si fuera el sandbox, cuando solo es lo que
se le enseña al proveedor.

### [MEDIO] TC31-M2 — NUEVO: en el adaptador que ENUNCIA «el modelo no puede teclear texto libre», `seleccionar` recibe texto libre del modelo — y es el que elige la clave del SAT

`src/lib/likida/facturacion/adaptadores/computer_use.ts:43-50` (la regla) ·
`:401-408` (`escribir`, que sí la implementa) · `:362-364` (el esquema de
`seleccionar`) · `:410-414` (su handler) · `:368-372` (`emitir` existe en modo
`emitir`) · `:425-426`

La cabecera del archivo es categórica: *«EL MODELO NO PUEDE TECLEAR TEXTO LIBRE.
Nunca. `escribir` no recibe un valor: recibe la CLAVE de un valor que el sistema ya
tenía […]. El modelo elige DÓNDE va cada dato; nunca CUÁL es»* (`:43-50`). `escribir`
lo cumple: `clave: { type:'string', enum: Object.keys(valores) }` (`:360`) y el
handler se niega si la clave no existe (`:404-405`).

`seleccionar`, tres líneas más abajo, **no**:

```
herramienta('seleccionar', 'Elige una opción de un <select>. `valor` tiene que venir de sus opciones.', {
  selector: { type: 'string' }, valor: { type: 'string' },      // :362-364
}),
…
case 'seleccionar': {
  const valor = String(args.valor ?? '');
  await p.seleccionar(selector, valor);                          // :412
  capturado[selector] = valor;                                   // :413
```

No hay enum, no hay cotejo contra las opciones reales del `<select>` (que el
inventario sí trae: `opciones`, `playwright_base.ts:111`), no hay comprobación contra
`valores`. Lo único que sostiene la regla aquí es la frase «`valor` tiene que venir de
sus opciones» **en la descripción de la tool** — exactamente el candado que el mismo
archivo declara inválido cuarenta líneas antes: *«Un candado que depende de que el
modelo obedezca no es un candado»* (`:56`).

Escenario, con valores. Portal de autofacturación en modo `emitir`. El formulario
trae `<select id="usoCfdi">` con `G01 Adquisición de mercancías`, `G03 Gastos en
general`, `I04 Equipo de cómputo…`. Los datos verdaderos de la flota viajan en
`valores` (`usoCfdi: 'G03'`, armado en `registro.ts:464-471` para el piloto y en el
equivalente de este adaptador). El modelo, que solo ve el `<select>` y la
descripción, pide `seleccionar({selector:'#usoCfdi', valor:'G01'})`. Se ejecuta sin
una sola comprobación, `capturado['#usoCfdi'] = 'G01'` se reporta como capturado, y
el paso siguiente `emitir` (`:425-426` → `clicDeEmision`, `:381-393`) timbra un CFDI
**irreversible ante el SAT** con un uso del CFDI que la flota nunca declaró. Lo
mismo aplica a `formaPago` y a `regimenFiscalReceptor`, que en los portales mexicanos
son `<select>`, no `<input>`.

Consecuencia: el contador de la flota recibe un CFDI con una clave del SAT que no
corresponde; corregirlo exige cancelar y re-timbrar, con la ventana de cancelación
del ejercicio de por medio. Y para el equipo: la regla que este archivo exporta como
doctrina del producto está implementada en una de sus dos tools de escritura.

Sigue siendo MEDIO y no ALTO por el mismo motivo que TC-M3: el adaptador **no tiene
un solo llamador** (`grep -rn 'AdaptadorComputerUse' src/` fuera de su archivo y sus
pruebas: cero). Pero es el archivo del que se va a copiar la regla el día que se
escriba el adaptador bueno.

Causa raíz probable: la regla se pensó para `escribir` (donde el dato es una cadena
del sistema) y `seleccionar` se escribió como «es un desplegable, las opciones ya las
acota el DOM» — que es cierto para el navegador y falso para lo que el CFDI declara.

### [MEDIO] TC30-M1 — REINCIDENTE (2ª ronda): la escalera de truncamiento de `generateStructured` se traga el error del reintento al doble sin una línea de log, y después juzga «¿es transitorio?» sobre un `TruncatedError`

`src/lib/llm/openrouter.ts:790-805` · `:808` · `:812` ·
frente a `:449-458` (la hermana, que lo excluye a propósito) y
`src/lib/llm/openrouter_truncado.test.ts:133`

Sin un carácter de cambio. `catch (eT)` en `:798` **solo relanza los
`TruncatedError`** (`:803`): un 503 del proveedor, un `JSON parse falló` o un
`APIConnectionError` en el reintento al doble se pierden enteros —no se relanzan, no
se loguean— y el flujo cae al `attempt(model, note)` de `:808` con el tope ORIGINAL,
el que ya se sabe insuficiente. Y en `:812`, `isTransientError(e1)` se evalúa sobre un
`TruncatedError` cuyo mensaje es `Respuesta truncada: se agotaron los ${maxTokens}
tokens de salida (usó ${tokOut})…` (`:748`), con `isTransientError` clasificando por
texto con `/(?<![$\-\w])(5\d\d|429|408)(?!\.\d)\b/` (`:184`). `generateResponse`
excluye ese caso explícitamente —`if (!fallback || err instanceof TruncatedError ||
!isTransientError(err)) throw err` (`:458`)— y tiene prueba con nombre propio
(`openrouter_truncado.test.ts:133`). `generateStructured` no tiene ni la exclusión ni
la prueba.

Escenario, con valores. El piloto de visión pide su acción con `maxTokens: 700`
(`piloto_vision.ts:627`), rol `piloto` = `anthropic/claude-sonnet-5` ($2/$10,
`models.ts:140`), fallback `openai/gpt-5.6-terra` (`openrouter.ts:97`). Con ~4,500
tokens de entrada:

1. Intento 1 → `finish_reason:'length'`, `completion_tokens: 700` → `TruncatedError`
   (e1). Pagado ~$0.016.
2. Reintento al doble (tope 1400) → el proveedor devuelve **503**. `eT` no es
   `TruncatedError` → **se descarta en silencio**; el 503 no existió para nadie.
3. `attempt(model, note)` con tope **700** otra vez → vuelve a truncar, ahora con
   `completion_tokens: 512`. e2 = `TruncatedError` con el texto «…(usó **512**)…».
4. `:812` → `isTransientError(e2)` ve `512` con frontera de palabra a los dos lados →
   **`true`** → `llm.fallback` a `openai/gpt-5.6-terra` con el MISMO tope de 700.
5. Vuelve a truncar → `conGastado(e3, 'Falló generación estructurada (fallback)')`.

Cuatro completions pagadas y liquidadas contra el presupuesto del tenant para un
problema que el paso 2 ya había diagnosticado; el diagnóstico que sale dice
«truncado» y el 503 desapareció.

Consecuencia: el paso del piloto que más caro sale se paga hasta cuatro veces por una
sola decisión, y un proveedor caído a mitad de la escalera no deja rastro en ningún
log —el modo de falla que `resumenCausa` existe para impedir—. Como además el piloto
no escribe en `llm_costo` (TC-M2), `/admin/costo-ia` no lo puede explicar.

Causa raíz probable: el `catch` se escribió para enriquecer el `usage` del
truncamiento, no para decidir el destino de las demás excepciones; y la exclusión de
`TruncatedError` del fallback se aplicó donde se encontró el hallazgo, sin barrer la
tercera función.

### [MEDIO] TC-M2 — REINCIDENTE (4ª ronda): el rol más caro por llamada del repo sigue sin una fila en `llm_costo`

`src/lib/likida/facturacion/adaptadores/piloto_vision.ts:620` · `:103` · `:285-286` ·
`src/lib/likida/costos.ts:41` ·
`supabase/migrations/0351_costo_fase_copiloto_runner.sql:17` ·
`src/lib/llm/models.ts:140` · `src/lib/agents/copiloto-tools.ts:279-293`

`decidir()` sigue desestructurando **solo** `{ data }` (`:620`): `cost`, `tokensIn`,
`tokensOut` y `model` se tiran en esa línea. `grep -n registrarCosto
src/lib/likida/facturacion/` → cero. El ledger de presupuesto sí lo ve (`budget`
existe porque `registro.ts:460` pasa `tenantId`), pero `llm_costo` es otra tabla y es
la que leen `/admin/costo-ia` y la tool `costo_por_fase_modelo`
(`copiloto-tools.ts:279-293`). La 0351 amplió `FaseCosto` a 9 valores para dos fases
que **siguen sin escritor** (`copiloto`, `runner`) y no le abrió renglón a esta.

Escenario, con valores. Una flota con 6 portales sin adaptador escrito corre el lote.
Cada sesión son hasta **14** llamadas (`PASOS_MAXIMOS`, `:103`) con `role:'piloto'` =
`anthropic/claude-sonnet-5` ($2/$10), cada una con la captura adjunta: ~4,500 tokens
de entrada y ~400 de salida por paso → ~$0.013 por paso → ~$0.18 por portal, el costo
de una liquidación completa (`COSTO_ESTIMADO_USD.liquidacion = $0.18`,
`models.ts:270`). Seis portales ≈ $1.10 en una corrida. En `/admin/costo-ia` y en
`costo_por_fase_modelo`, esa corrida vale **$0.00**.

Consecuencia: Javier compara el costo por liquidación contra un total que no incluye
el camino más caro por llamada del repo, y la decisión que ese número alimenta
(encender `FACTURACION_PILOTO`, graduar portales a adaptador escrito) se toma sobre un
dato incompleto.

### [MEDIO] TC-M1 — REINCIDENTE: una respuesta truncada se paga y se anota como **cero medido** en los agentes de fondo

`src/lib/llm/openrouter.ts:412` · `:422-430` ·
`src/lib/likida/agentes/contenido.ts:376-380` · `:409-412` ·
`src/lib/likida/agentes/faq.ts:418-422` · `:443-445` ·
`src/lib/likida/agentes/sdr.ts:227-238` ·
`src/lib/likida/agentes/runner.ts:395-407` · `src/lib/llm/models.ts:278`

`generateResponse` liquida la reserva (`:412`) y **luego** lanza `TruncatedError` con
su `usage` completo (`:428`). Ninguno de los tres llamadores de fondo lo lee: los dos
primeros siguen con `catch (e) { motivoSinModelo = 'el modelo no respondió'; … }` y
sin sumar nada (`contenido.ts:409-412`, `faq.ts:443-445`), el tercero cuenta un
`saltado`. Los tres corren en modo plataforma **sin `budget`**, así que tampoco hay
fila en el ledger: el gasto no queda en ningún lado.

Escenario, con valores. `correrContenidoFiscal` pide un artículo con
`role:'marketing'` (`openai/gpt-5.6-luna`, $0.10/$0.60 por M) y `maxTokens: 1_400`. El
modelo escribe 1,400 de salida sobre 2,000 de entrada y llega al techo:
`finish_reason:'length'` → `costoContabilizado = 2000×$0.10/1e6 + 1400×$0.60/1e6 =
$0.00104`. La corrida se anota con `costoUsd = 0` —un cero MEDIDO, no un `null`— y la
pieza dice «el modelo no respondió» sobre una llamada que respondió y se cobró.

Consecuencia: son centavos, y hay que decirlo; lo que se rompe es la invariante que
estos archivos citan en sus propios comentarios («un costo no medido no es cero»,
`faq.ts:423-433`). El repo tiene DOS tratamientos honestos —`null` pegajoso y
`COSTO_ESTIMADO_USD.corridaAgenteSinMedir`— y el truncamiento no cae en ninguno: entra
como gasto real disfrazado de medición en cero, que es justo lo que `gastoDelDiaUsd`
(`runner.ts:395-407`, filtra `.not('costo_usd','is',null)`) suma contra el techo diario.

### [MEDIO] TC-M3 — REINCIDENTE: el modo `ensayo` no impide el clic físico que emite; solo le quita el nombre a la tool

`src/lib/likida/facturacion/adaptadores/computer_use.ts:353-355` · `:368-372` ·
`:381-393` · `:421` · `:444`

`ensayo` se implementa quitando `emitir` del catálogo (`:368`) y diciéndoselo al
modelo (`:444`). Pero `clic` sigue en el catálogo con `selector` de texto libre
(`:365`) y el arreglo de TC-B4 lo enruta a `clicDeEmision` cuando el botón huele a
emisión (`:421`) — el camino que de verdad aprieta (`p.hacerClic`, `:385`) y devuelve
`EMITIDO` (`:392`). El candado (`reclamarEmision`, `:382`) protege contra la emisión
**doble**, no contra la emisión **en ensayo**: no mira `modo` en ninguna de sus dos
ramas.

Escenario, con valores. `facturar(campos, 'ensayo')` sobre un portal con
`<button id="btnSubmit">Timbrar</button>`. Sin `emitir` disponible, el modelo pide
`clic({selector:'#btnSubmit'})`. `esBotonDeEmision('#btnSubmit')` es `true` por el
TEXTO del último inventario (`:353-355`), entra a `clicDeEmision`, reclama el candado,
**aprieta Timbrar** y le contesta al modelo `EMITIDO`.

Consecuencia: un CFDI irreversible en el modo cuyo contrato es no emitir. MEDIO y no
CRÍTICO porque el adaptador no está cableado; pero `ensayo` es precisamente el modo
con el que se estrenaría con el primer cliente.

### [BAJO] TC31-B1 — NUEVO: el loop-guard del piloto de visión solo compara contra el paso ANTERIOR, así que una oscilación de dos estados consume la sesión entera de 14 pasos

`src/lib/likida/facturacion/adaptadores/piloto_vision.ts:267` · `:350-354` ·
`:103` · `:388-389`

El guardia es literal: `const firma = \`${accion.tipo}|${accion.selector}|${accion.valor}\``
(`:350`), `if (firma === anterior) { … }` (`:351`), `anterior = firma` (`:354`).
`anterior` es un **solo** valor (`let anterior: string | null = null`, `:267`), no un
conjunto de lo ya visto. Su propio comentario dice para qué existe: *«la misma acción
dos veces seguidas es estar atorado, y cada vuelta cuesta una llamada de visión y un
riesgo en un formulario fiscal»*.

Escenario, con valores. Portal con el formulario partido en dos pestañas:
`<a id="tabDatos">Datos</a>` y `<a id="tabFactura">Factura</a>`. Ninguno huele a
emisión, los dos están en el inventario y `contar()` devuelve 1 para cada uno, así que
las cuatro guardas de `ejecutar()` pasan. El modelo, que en cada pestaña ve los campos
de la OTRA como faltantes, alterna: paso 1 `clic #tabFactura`, paso 2 `clic #tabDatos`,
paso 3 `clic #tabFactura`… Las firmas son `clic|#tabFactura|null` y
`clic|#tabDatos|null`, nunca dos iguales seguidas: **el guardia no dispara ni una vez**.
La sesión corre los 14 `PASOS_MAXIMOS` (`:103`) y sale por `:388-389` con
`ok:false, error:'El piloto agotó sus 14 pasos sin terminar el formulario'` y
`capturado = {}`.

Consecuencia: 14 llamadas de visión a `anthropic/claude-sonnet-5` con captura adjunta
≈ **$0.18** —el costo de una liquidación completa— por un portal que no llenó un solo
campo, y ninguna de esas 14 deja fila en `llm_costo` (TC-M2), así que en el panel la
corrida vale $0.00. El ciclo queda acotado por `PASOS_MAXIMOS` y por
`PRESUPUESTO_SESION_MS`, y por eso es BAJO y no MEDIO: el techo existe, lo que no
existe es el corte temprano que el guardia promete.

Causa raíz probable: el guardia se escribió contra la repetición inmediata (que es lo
que se vio en las pruebas) y no contra el ciclo, que es el modo de atasco natural de un
formulario con pestañas.

### [BAJO] TC-B1 — REINCIDENTE: `PartialExecutionError` no lleva `costoPorModelo`; el turno más caro se atribuye a un modelo llamado `parcial`

`src/lib/llm/openrouter.ts:853-874` · `:1327` ·
`src/lib/likida/processor.ts:4392-4400` · `:4430-4441` ·
`src/app/api/dashboard/chat/route.ts:157-165` · `src/lib/agents/analista.ts:446-460`

La clase declara `tokensIn`, `tokensOut` y `cost` (`:869-871`) y **no** el mapa; `:1327`
la construye con `(message, err, executed, tokIn, tokOut, costo)`. En el camino de
éxito, `processor.ts:4392-4398` y `chat/route.ts:128-133` escriben una fila por modelo
real; en el de excepción queda una sola fila `modelo:'parcial'`. Se ve también en el
reintento del analista: `:446-460` suma `e.tokensIn/e.tokensOut/e.cost` del primer ciclo
al error y no puede sumar el desglose porque el campo no existe.

Escenario, con valores. Cierre de un viaje: rondas 0-2 en `anthropic/claude-sonnet-5`
($2/$10), la ronda 3 recibe un 503, `complete` cruza al fallback
`openai/gpt-5.6-terra` ($1/$6), la ronda 4 corre ahí y el turno muere por
`LoopGuardError`. `costoPorModelo` tiene `{sonnet-5: $0.121, terra: $0.038}` y se
descarta; en `llm_costo` queda **una** fila `modelo:'parcial', costo_usd: 0.159`. El
total es correcto; el desglose que `costo_por_fase_modelo` le enseña a Javier pierde
justo el turno en el que el fallback cross-provider corrió.

### [BAJO] TC-B2 — REINCIDENTE: `generateStructured.costoPorModelo` se produce y no lo consume nadie; el OCR sigue etiquetando el total con el modelo del ÚLTIMO intento

`src/lib/llm/openrouter.ts:678-685` · `:767` ·
`src/lib/likida/intake/ocr.ts:775` · `src/lib/likida/processor.ts:2074` · `:2574`

Contado hoy: `grep -rn costoPorModelo src --include=*.ts` sin pruebas y sin
`src/lib/llm/` devuelve **6 sitios y los 6 son consumidores de `generateWithTools`**
(`chat/route.ts:128`, `run.ts:29`/`:99`, `analista.ts:258`/`:468-470`/`:517`,
`oficina_wa.ts:256`, `processor.ts:4392-4395`). Ninguno de los llamadores de
`generateStructured` lo lee. `ocr.ts:775` sigue en
`costo: { modelo: res.model, tokensIn: res.tokensIn, tokensOut: res.tokensOut, costoUsd: res.cost }`,
donde `res.model` es el del último intento (`openrouter.ts:767`) y `res.cost` el
acumulado de todos.

Escenario, con valores. Un ticket con `gemini-3.1-flash-lite` ($0.25/$1.50): intento 1
devuelve JSON malformado (100 in / 400 out = $0.000625), intento 2 recibe 503, el
fallback `claude-haiku-4.5` ($1/$5) cierra bien (900 in / 300 out = $0.0024).
`processor.ts:2574` escribe **una** fila `modelo:'anthropic/claude-haiku-4.5',
costo_usd: 0.003`, cargándole a Haiku el gasto de Gemini — y es el renglón que sostiene
la decisión medida del 4-ago-2026 («12.5× más barato»).

### [BAJO] TC30-B1 — REINCIDENTE: la etiqueta `modelo` de `llm_costo` cambia de FORMA según si hubo fallback

`src/lib/likida/processor.ts:4392-4400` · `src/lib/llm/openrouter.ts:1203` ·
`:264-267` · `:224-226` · `src/lib/likida/agentes/finanzas.ts:175-181` · `:210-221` ·
`src/lib/admin/negocio.ts:507`

Las dos ramas del mismo `if` etiquetan con cosas distintas. Con **más de un modelo**
(hubo fallback) las filas se etiquetan con las llaves de `costoPorModelo`, que son
`activeModel` — nuestro slug canónico. Con **uno solo** (el camino normal) la fila se
etiqueta con `res.model` (`processor.ts:4399`), que es `used = res.model || activeModel`
(`openrouter.ts:1203`): el eco del proveedor. El propio archivo documenta que ese eco
puede traer sufijo (`:224-226`) y `calcCost` lo limpia **solo para precificar**
(`:266`, `model.split(':')[0]`); nada lo limpia para la etiqueta que se escribe.

Escenario, con valores. Turno normal de cuadre, sin fallback: OpenRouter responde
`model: "anthropic/claude-sonnet-5:floor"`. `modelosDelCiclo.length === 1` → rama `else`
→ fila `modelo: 'anthropic/claude-sonnet-5:floor'`. Turno siguiente, con fallback: filas
`anthropic/claude-sonnet-5` y `openai/gpt-5.6-terra`. En `getCostoPorFaseModelo`
(`negocio.ts:507`) el mismo modelo aparece como dos renglones; y `evaluarUmbralesCostos`
compara `f.modelo !== modeloEsperado('cuadre')` con
`esperado = 'anthropic/claude-sonnet-5'` (`finanzas.ts:211-213`) → **ROJO U1**: «la fase
`cuadre` corrió con un modelo distinto del esperado», sobre un override que nunca
existió.

Consecuencia: una alarma ROJA del parte diario de costos que culpa a una variable de
Vercel, y un desglose partido en dos para el mismo modelo justo en la pantalla que
existe para decidir el precio del producto.

## Lo que revisé y está bien

- **La regla de `properties: {}` sigue en pie en el registro completo.**
  `grep -rn "registerTool(" src --include=*.ts` sin pruebas y sin la propia
  definición → **33**, el mismo número que la 29 y la 30, y el mismo reparto: 14
  `copiloto-tools.ts`, 12 `chat-tools.ts`, 4 `tools.ts`, 1 `analista.ts`, 2
  `copiloto.ts`. **Ninguna tool nueva.** Las 4 del agente de dinero siguen con
  `parameters: { type:'object', properties:{}, additionalProperties:false }`
  (`tools.ts:40`, `:102`, `:182`, `:268`) y `tenantId`/`viajeId` siguen saliendo de
  `ctx`. Los únicos parámetros del set del cliente son enums cerrados:
  `chat-tools.ts:61-69` (`PARAM_MODO`) con `modoDe` colapsando cualquier otra cosa a
  `'semanal'` (`:71-75`), `:279-284` (`proyectar_serie`, dos enums) y `:374-383`
  (`consultar_normas`, enum sobre `TEMAS_NORMATIVOS`).
- **Las 8 tools del MCP, auditadas a fondo esta ronda** (la 30 las dejó pendientes).
  La puerta común exige el ÁREA antes de ejecutar y valida con `safeParse` de zod
  (`mcp/herramientas.ts:81-95`); el `tenantId` sale de la credencial y nunca del
  argumento (`:104`, `h.ejecutar(tenantId, …)`). Cuerpos revisados: `viajes.ts:60-72`
  (todo `.eq('tenant_id', tenantId)`, `.limit()` con su `.order()` completo),
  `viajes.ts:84-96` (`resolverViaje` decide uuid vs folio con regex y usa `.eq`, no
  `ilike`), `viajes.ts:105-110` (`buscarViajesTexto` sanea `%`, `_`, `\` y además los
  metacaracteres `,()` del `.or()` de PostgREST), `dinero.ts:69-86` (más de un
  candidato → **no adivina**, devuelve la lista y pide el id), `unidades.ts:14-47`
  (`sin_dato` ≠ `vigente`, dicho en el texto), `busqueda.ts:78-95` (`fetch` valida el
  uuid antes de tocar la base y **degrada el documento** cuando la credencial no
  alcanza `dinero`, con la línea explícita «las cifras de dinero de este viaje no
  están al alcance de esta credencial»). `viajes.ts:9-12` minimiza a propósito: el
  nombre del operador no se devuelve. `npx vitest run src/lib/mcp` → 7 archivos, 117
  pruebas, 0 fallos.
- **Los dos candados de `guardar_liquidacion` siguen en la TOOL, no en el prompt.**
  `tools.ts:291-298` (`cierrePedidoPorTexto`, calculado por el processor sobre el
  texto del turno) y `:368-376` (cierre en ceros + `cierreEnCerosConfirmado`); los dos
  LANZAN para que el error viaje al modelo. El kill switch de `:307-312` falla cerrado.
- **Idempotencia por EFECTO, no por llamada.** `tool-executor.ts:391-408` cachea la
  PROMESA antes del `await` y llavea por **nombre**, no por args; `:164-167` rechaza
  cerrado una mutación sin `runId`; `:217-230` techa el lease en 10 renovaciones con
  `.unref()`; `:266-270` sella el éxito FUERA del `try` que decide el resultado de la
  tool; `:279-289` conserva el lease cuando el handler siguió vivo tras el timeout;
  `mutationEffectKey:353-355` lleva `runId`.
- **El corte del loop-guard ANTES del `Promise.all`** (`openrouter.ts:1245-1258`): con
  `terminales` vacío —el caso del agente de dinero, `run.ts:72-91` no pasa
  `terminalTools`— una `guardar_liquidacion` pedida en la última ronda **no se
  ejecuta**.
- **El error crudo de Postgres no cruza al modelo** (`tool-executor.ts:140-147`), con
  el detalle completo en `logger.error`.
- **La reserva no se cobra ante un error de red** en las tres funciones
  (`openrouter.ts:404`, `:728`, `:1147-1152`), y `settle` conserva la reserva cuando el
  proveedor omite `usage` (`:411`, `:738`, `:1119-1127`) en vez de liquidar a cero.
- **`cotaEntradaEnTokens` no cuenta una imagen ni un audio por byte**
  (`openrouter.ts:568-593`): `TOKENS_POR_IMAGEN = 4_000` y la estimación por duración
  del audio. Verifiqué que el piloto entrega la captura como data-URI
  (`piloto_vision.ts:626`, `comoDataUriAcotada`) y que `inv.texto` viene recortado a
  1,800 caracteres (`pagina_playwright.ts:923`), así que la reserva de un paso del
  piloto no puede reventar sola el techo de la corrida.
- **`PROVIDER_OPTS` (`provider:{data_collection:'deny'}` + `usage:{include:true}`) va
  en las TRES funciones**: `openrouter.ts:382`, `:709`, `:1172`. No hay camino que
  llame al proveedor sin el opt-out.
- **`modelosAisladosDeFallback()` sigue vacío.** Recorrí `FALLBACK` (`:82-116`) contra
  `PRICES` (`:190-218`): los slugs con precio están o como llave o como destino.
- **`faseDeModelo` sigue acotado a `cuadre`** (`costos.ts:108-111`), y
  `registrarCosto` sigue fallando ruidoso y no mudo (`:126-133` descarta NaN/negativo
  con `logger.error`; `:137-147` desestructura `{ error }`).
- **El piloto de visión, en todo lo que NO es el valor**: `:453` (selector compuesto
  rechazado), `:460-462` (identidad exacta, no `includes`), `:468-476` (`contar() !== 1`
  se detiene — y `pagina_playwright.ts:711` sí implementa `contar`, así que la guarda
  no es opcional en el camino real), `:488-490` (el veto de emisión mira
  `esBotonQueEmite` **y** los cuatro rótulos, en los dos modos), `:505-507` (guarda dura
  de contraseña), `:285-286` (un solo `LlmBudget` por sesión), `:650-658`
  (`senalDeSesion` devuelve una señal YA abortada si el reloj venció).
- **El texto de una página ajena viaja como DATO** (`piloto_vision.ts:613-615`), con la
  misma fórmula que `analista.ts` aplica a lo que lee.

## Lo que NO alcancé a revisar

- **Nada contra Postgres real ni contra los proveedores.** Sin `.env`, sin base y sin
  red: la RPC `reservar_presupuesto_llm` bajo concurrencia, y que
  `provider:{data_collection:'deny'}` se respete del otro lado, siguen siendo contrato
  declarado. Mismo hueco que de la 24 a la 30.
- **TC31-M1 lo medí sobre la CLAUSURA DE IMPORTS, no sobre el bundle de Vercel.** Mi
  script resuelve `@/` y relativos leyendo `import`/`from` con una expresión regular:
  no ve imports dinámicos, `next/dynamic` ni el tree-shaking del empaquetador. Lo que
  afirmo con certeza es lo que el grafo de módulos dice; si dos rutas comparten
  proceso en producción (un `next start`, o una instancia caliente que sirve las dos),
  el alcance es MAYOR que el que reporto, no menor. No lo puedo comprobar sin red.
- **TC30-B1 depende de que OpenRouter devuelva el sufijo de proveedor.** Lo afirma el
  repo en dos comentarios (`openrouter.ts:224-226`, `:265`) y el `split(':')` de
  `calcCost` existe por eso, pero no lo pude observar en una respuesta real.
- **Ningún hallazgo está reproducido con una prueba EJECUTADA**: el encargo prohíbe
  tocar archivos del repo. TC-A1 lo recorrí por el interleaving (`Promise.all` → `map`
  → `executeTool` → `AsyncLocalStorage.run` → `await estaApagado`). TC31-M1 se
  reproduce con un executor de prueba y una respuesta mockeada cuyo `tool_calls` traiga
  un nombre fuera de `opts.tools`. TC31-B1, con un `PaginaPortal` falso de dos pestañas
  y un `decidir` mockeado que alterne.
- **`generateStructured` con audio** (`openrouter.ts:655`, el cast a `input_audio`): el
  fallback de `transcripcion` hacia `openai/gpt-5.6-luna`, que no tiene oído
  (`models.ts:146-148` lo documenta), sigue sin prueba. Sexta ronda pendiente.
- **Si `openai/gpt-5.6-terra` acepta imágenes.** `FALLBACK` se indexa por SLUG
  (`openrouter.ts:97`), así que el rol `piloto` —que manda una captura en cada paso—
  hereda el fallback textual de `anthropic/claude-sonnet-5`, el mismo que usa `cuadre`.
  El repo hizo ese razonamiento explícito para los modelos de OCR (`:105-108`: «el
  respaldo tiene que seguir leyendo imagen») y no para `piloto`. No lo reporto como
  hallazgo porque no puedo verificar la capacidad del modelo sin red; queda anotado
  para la ronda que sí tenga acceso al catálogo de OpenRouter.
- **La frecuencia real de TC-A2, TC-M1, TC30-M1 y TC31-B1**: cuántos turnos del
  analista mueren en la última ronda, cuántas corridas de fondo truncan, y con qué
  frecuencia un portal hace oscilar al piloto no se puede medir aquí.
