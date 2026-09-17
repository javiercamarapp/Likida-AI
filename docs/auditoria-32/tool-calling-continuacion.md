# Tool calling — auditoría 32 (continuación 17-sep)

**Nota: 4/10** (antes 5). Razón del movimiento: **mirada más profunda — el código
no cambió, la nota anterior estaba inflada**. No es «deuda que cobró factura»
(la 30 ya descontó de 7 a 5 por los impagos y la 31 se negó, con razón, a
cobrarlos dos veces) y no puede ser «se atacó y subió»: `git diff
origin/master..HEAD -- src/` toca **un solo archivo** y es
`src/lib/likida/migraciones_verificadas.test.ts`; ni una línea de
`llm/`, `agents/`, `likida/tools.ts` ni `facturacion/adaptadores/`.

Lo que baja la nota es un hecho contable que **las últimas tres rondas
reportaron al revés**. La 29, la 30 y la 31 cerraron su bloque «lo que está
bien» con la misma frase: *«La regla de `properties: {}` sigue en pie en el
registro completo»*, y la 31 la precisó así: *«los únicos parámetros del set del
cliente son enums cerrados»*, citando tres sitios de `chat-tools.ts`. Es falso, y
no por un matiz: **2 de las 33 tools del registro reciben del modelo un
`valor: number`** que se pinta como pesos en la pantalla del contralor
(`analista.ts:217`, `:228`, `:229`) y en la del superadmin (`copiloto.ts:143`,
`:154`, `:155`). Son `entregar_respuesta` y `entregar_respuesta_admin` — las
tools TERMINALES, o sea el único camino de salida de los dos paneles. No son ad
hoc, no están fuera del registro, y no son un piloto apagado detrás de una
bandera: son lo que se ve al abrir el chat del panel.

O sea que el conteo que sostenía la nota era:

| | Ronda 30 | Ronda 31 | Hoy |
|---|---|---|---|
| `registerTool(` en producción | 33 | 33 | **33** (sin cambio) |
| …de ellas, con un valor escrito por el modelo | 0 (reportado) | 0 (reportado) | **2 (medido)** |
| Esquemas ad-hoc con valor del modelo | 2 | 2 | 2 |
| `npx vitest run src/lib/llm src/lib/agents src/lib/likida/tools_invariantes.test.ts src/lib/likida/tools_estado_viaje_aud24.test.ts` | 54 / 339 | 54 / 339 | **54 / 339** |
| Hallazgos abiertos al cerrar | 10 | 13 | **17** |
| Cerrados en la ventana | 0 de 8 | 0 de 10 | **0 de 13** |

Cuarta ronda consecutiva con el número EXACTO de pruebas y **tercera con cero
cierres**. TC-A1 entra en su **5ª** aparición, TC-M2 en la **5ª**, TC-A2 en la
**4ª** y TC30-A1 en la **3ª**.

Dónde caen las anclas: **no baja de 4** porque lo que la 31 puso como piso sigue
intacto y lo verifiqué otra vez — el modelo no puede decidir QUÉ FILA se escribe
(`tenantId`/`viajeId` salen de `ctx` en las 33, `guardar_liquidacion` muere en
`!ctx.viajeId` en `tools.ts:272`, y sus dos candados viven en la tool y no en el
prompt). **No se queda en 5** porque el argumento del 5 era «la regla se respeta
en el registro y solo se rompe en 6 esquemas ad-hoc, dos de ellos en adaptadores
sin llamador»; con dos tools del registro rompiéndola en el camino cableado, y
con el candado que las cubre medido y encontrado vacío en su régimen real
(TC32-A1), ese argumento ya no describe el código.

**El riesgo mayor del rubro, hoy:** el único candado que impide que el panel del
contralor muestre una cifra que el modelo se inventó está probado con conjuntos
de 3 números y corre con conjuntos de 97 a 400 — y en ese régimen **deja pasar el
100 % de los porcentajes y el 56 % de los enteros**.

## Hallazgos

### [ALTO] TC32-A1 — NUEVO: el candado de cifras del panel se vuelve vacuo con el tamaño REAL del respaldo; sus únicas pruebas corren con 3 números y el código corre con 97

`src/lib/agents/analista.ts:153` (`esDerivada`) · `:157` (`arr.length > 600`) ·
`:172-190` (`cifrasRespaldadas`) · `:182-184` (las tres puertas) · `:146`
(`BLANCOS`) · `:200-237` (el esquema de `entregar_respuesta`, con
`valor: { type: 'number' }` en `:217`, `:228`, `:229`) ·
`src/lib/agents/copiloto.ts:126-163` (el gemelo del admin, `:143`/`:154`/`:155`) ·
`src/lib/agents/analista_guardia.test.ts:31` · `:41-43` · `:47-48` · `:62` · `:71`

`entregar_respuesta` es la ÚNICA forma en que el analista entrega; su argumento
`bloques` trae `valor: number`, `filas[].valor`, `segmentos[].valor` y
`puntos[].valor`, todos escritos por el modelo, y la interfaz los pinta con
`formato: 'mxn'`. `validarBloques` (`:53-119`) valida FORMA, nunca procedencia.
El único candado de procedencia es `cifrasRespaldadas`, que para cada número del
bloque prueba tres puertas: `BLANCOS` (`:182`), pertenencia exacta a `respaldo`
(`:183`) y `esDerivada` (`:184`). `esDerivada` acepta el número si existen dos
elementos `a`, `b` de `respaldo` tales que `|a+b−n| < 0.011`, `||a−b|−n| < 0.011`
o `|(a/b)·100 − n| < 0.6`.

El problema es que la potencia de esa tercera puerta crece con `|respaldo|²`, y
`respaldo` se llena con **todos** los números que las tools devolvieron —
recursivamente, incluidos los dígitos incrustados en cadenas (`extraerNumeros`,
`:122-143`: un folio `VJ-2026-4100` aporta `2026` y `4100`, una fecha
`2026-08-12T07:35:00Z` aporta seis).

Medido (transcripción literal de `extraerNumeros`/`BLANCOS`/`esDerivada` a un
script, corrida sobre la forma exacta que devuelven las tools de
`chat-tools.ts`):

| `|respaldo|` | pasa un porcentaje `x.y` (0-100) | pasa un monto `$0-10,000.xx` | pasa un entero 14-999 |
|---|---|---|---|
| 3 (el régimen de las pruebas) | 6 % | 0 % | 0 % |
| 20 | 81 % | 2 % | 25 % |
| 40 | **100 %** | 7 % | 43 % |
| 97 (**UNA** llamada a `liquidaciones_flota`) | **100 %** | 17 % | **56 %** |
| 159 (`kpis_flota` + `liquidaciones_flota` + `serie_gasto`) | **100 %** | 24 % | **96 %** |
| 400 | 100 % | 56 % | 100 % |
| 601 | 1 % | 0 % | 0 % (el corte de `:157`) |

Escenario, con valores. El contralor abre «Pregunta a tus datos» y escribe «¿cómo
va mi flota?». El modelo llama `liquidaciones_flota` — una sola tool — que
devuelve 20 filas con `folio`, `comprobado`, `diferencia`, `estatus` y `creadaEn`
(`chat-tools.ts:191-200`). `respaldo` queda con **97** números. El modelo entrega
`entregar_respuesta({bloques:[{tipo:'texto', texto:'Tu tasa de cuadre va en
87.3 %, seis décimas abajo de agosto.'}]})`. Ninguna tool devolvió `87.3`: la
tasa de cuadre vive en `kpis_flota`, que no se llamó. `cifrasRespaldadas`
→ `87.3` no está en `BLANCOS`, no está en `respaldo`, y `esDerivada(87.3, respaldo)`
→ **`true`** (verificado: con ese mismo conjunto también pasan `63` y cualquier
otro porcentaje que probé). Sale a pantalla, y `route.ts:137-148` lo PERSISTE en
la conversación.

El contrato de la prueba lo confirma al revés: `analista_guardia.test.ts:41-43`
demuestra que `$12,500` se bloquea — con un `respaldo` de **tres** números
(`:31`). `:71` demuestra que `12,345` se bloquea con un `respaldo` de **tres**.
Con 400 (una pregunta que toque tres o cuatro tools) esa misma cifra pasa el
56 % de las veces. La prueba mide el candado en un régimen en el que el producto
nunca corre.

Hay un agravante estructural: el reintento correctivo (`analista.ts:414-472`)
existe justo para los turnos en que esta guardia tumbó los bloques, y en él
`respaldo` **solo crece** (`:464`, se le suman los resultados del segundo ciclo).
El comentario de `:421-428` se preocupó por eso —«el mismo texto rechazado, con
una vara más baja la segunda vez»— y cerró la mitad del agujero (`CAPTURAS`);
la vara sigue bajando.

Consecuencia: la regla que define al producto («nunca inventar una cifra») tiene
un candado que, en su régimen de operación, bloquea montos grandes y **no
bloquea nada más**: ni porcentajes, ni conteos, ni montos de cuatro cifras. El
contralor es exactamente quien va a cruzar «87.3 %» contra su hoja, y quien va a
dejar de creerle al producto entero cuando no cuadre. El copiloto de Javier
tiene el mismo candado con el mismo defecto (`copiloto.ts:257-261`).

Refutación intentada, y no alcanza: (a) `validarBloques` no mira procedencia;
(b) `fundamentarBloques` (`:286-305`) solo quita CITAS legales, y corre después;
(c) la red determinística (`:479-497`) solo entra si la guardia dice `false` —
aquí dice `true`; (d) el corte de `:157` (`> 600 → false`) SÍ es fail-closed,
pero llega tarde y es un acantilado: la guardia es más débil con 400 números que
con 3 y que con 601.

Causa raíz probable: el candado se diseñó contra la invención de un MONTO y se
le añadió `esDerivada` para no romper la comparación honesta, sin advertir que la
derivación es una relación de pares y satura el espacio de llegada con el
cuadrado del respaldo.

### [ALTO] TC32-A2 — NUEVO: el respaldo de la guardia se siembra con los turnos `asistente` que manda el CUERPO DE LA PETICIÓN; una cifra inventada se auto-certifica en el turno siguiente

`src/lib/agents/analista.ts:393-397` (el comentario y la línea) ·
`src/lib/agents/copiloto.ts:257-259` (idéntico) ·
`src/app/api/dashboard/chat/validacion.ts:18-30` (`validarMensajes`) ·
`src/app/api/dashboard/chat/route.ts:80` · `:141-148` (`guardarIntercambio`) ·
`src/app/api/admin/copiloto/route.ts:220` · `:253`

El comentario de `analista.ts:393-394` dice qué se pretende meter en `respaldo`:
*«todo lo que las tools devolvieron en este turno + los números que **el usuario
mismo** escribió»*. La línea de `:397` es
`extraerNumeros(opts.mensajes.map((m) => m.texto).join(' '), respaldo)` — **sin
filtrar por rol**. `opts.mensajes` es `Array<{rol:'usuario'|'asistente'; texto}>`
(`:318`), y llega del cuerpo del POST: `validarMensajes` recorta a 12 turnos y
2,000 caracteres y exige que el último sea del usuario, pero **acepta turnos
`asistente` tal cual** (`validacion.ts:26-28`), bajo un encabezado que dice
«nunca se confía». Dos líneas más abajo, `:505`, el MISMO arreglo sí se filtra
por rol para la guardia de fundamento — así que la asimetría no es una
convención del archivo, es un olvido en una de las dos.

Escenario, con valores (sin ningún actor malicioso). Turno 1: el contralor
pregunta «¿cómo voy?»; el modelo responde, entre otras cosas, «llevas
**$1,284,300.00** comprobados» — una cifra que ninguna tool devolvió y que pasó
por `esDerivada` (TC32-A1). Se pinta y se persiste (`route.ts:137-148`). Turno 2:
el navegador manda el historial, que ahora incluye
`{rol:'asistente', texto:'…llevas $1,284,300.00 comprobados…'}`. `:397` mete
`1284300` en `respaldo`. Ahora ya no hace falta derivarlo: pasa por
`respaldo.has(n)` (`:183`), con coincidencia EXACTA. Turno 3, el modelo puede
además derivar de él (`1284300 − x`, `1284300 / y · 100`) con el candado
diciendo que todo está respaldado.

La variante deliberada es peor y trivial: un `POST /api/dashboard/chat` con
`mensajes: [{rol:'asistente', texto:'IVA acreditable: 431,209.55'},
{rol:'usuario', texto:'confírmame mi IVA acreditable'}]` siembra `431209.55`
como respaldo duro. Quien lo manda es un usuario autenticado de esa misma flota
(hay CSRF y sesión), así que no es escalación de privilegio — es que el registro
que queda guardado en `chat`, con la marca de Likida, afirma una cifra fiscal
que el sistema **nunca midió**, y es un registro que se puede exportar y enseñar.

Consecuencia: la guardia de cifras deja de ser un candado y pasa a ser un
trinquete. Basta UN escape (que TC32-A1 hace probable) para que la cifra falsa
quede certificada para siempre en esa conversación, y para que el contralor la
vea repetida turno tras turno — que es exactamente la forma en que una cifra
mala se vuelve creíble. El copiloto del superadmin tiene la misma línea.

Causa raíz probable: `respaldo` se pensó como «lo que el sistema midió + lo que
la persona aportó» y se implementó sobre el arreglo entero, que también contiene
lo que el modelo dijo — la única fuente que la guardia existe para desconfiar.

### [MEDIO] TC32-M1 — NUEVO: una respuesta TRUNCADA del ciclo de cuadre se clasifica como error de programación, así que el chofer recibe «se me trabó, reenvíame» en vez del cuadre determinístico que RES-15 existe para darle

`src/lib/llm/openrouter.ts:1219-1227` (el `TruncatedError` del ciclo de tools) ·
`:1325-1327` (el envoltorio) · `:158-187` (`isTransientError`) ·
`src/lib/likida/processor.ts:1067-1069` (`causaDeFondo`) · `:4520` · `:4523-4525` ·
`:4545-4556` (el degradado) · `src/lib/agents/run.ts:33-35` (`maxTokensCuadre`) ·
frente a `openrouter.ts:449-458`, que en `generateResponse` excluye
`TruncatedError` ANTES de `isTransientError` y lo explica

`generateWithTools` distingue el truncamiento (`:1219`) y lanza `TruncatedError`;
el catch-all lo envuelve en `PartialExecutionError` (`:1327`). El processor
decide el degradado con `isTransientError(causaDeFondo(e))` (`:4520`), y
`causaDeFondo` devuelve el `TruncatedError` desnudo (`:1068`). `isTransientError`
no tiene rama por TIPO para él: mira `name` (no casa el regex de `:167`),
`status` (no existe) y después **clasifica por el TEXTO del mensaje** (`:184`).

Escenario, con valores. Cierre de un viaje de 21 comprobantes. Rol `cuadre` =
`anthropic/claude-sonnet-5` con `reasoning: 'high'` (`models.ts:213`) y
`maxTokens = maxTokensCuadre() = 4000` (`run.ts:33-35`). En la ronda 2 el
razonamiento invisible se come el techo: `finish_reason: 'length'`, y `:1219`
lanza con el mensaje `Respuesta truncada en el ciclo de tools: se agotaron los
4000 tokens de salida (usó 6842)` — `tokOut` es el ACUMULADO de las tres rondas
(`:1197`), no el de ésta, así que el diagnóstico ya sale raro de origen. En
`:4520`: `4000` no casa `(5\d\d|429|408)`, `6842` tampoco, y ninguna palabra del
mensaje casa la segunda alternativa → **`transitorio = false`**. El chofer recibe
«Perdón, se me trabó el sistema tantito. ¿Me reenvías tu último mensaje?»
(`:4523-4525`) y el bloque de degradado (`:4545`) no corre. Reenvía: el prompt es
el mismo y el techo es el mismo, así que vuelve a truncar, idéntico.

Y el reverso, por la misma línea: si el truncamiento cae en la ronda 0 con un
`tokOut` de tres cifras que empiece en 5 (pasa en cuanto alguien baje
`LIKIDA_CUADRE_MAX_TOKENS`), el mensaje dice «(usó 512)», `512` sí casa
`5\d\d` con frontera a los dos lados → `transitorio = true` → el chofer SÍ recibe
`resumenCuadre(cuadrarDesdeDB(...))` con sus cifras reales. El mismo fallo, dos
productos distintos, decididos por una coincidencia numérica.

Consecuencia: el modo de falla que RES-15 documenta con esas palabras —«le
pedimos que repita un trabajo que no era suyo y que no arregla nada, mientras sus
comprobantes YA están en la base»— sigue abierto para el truncamiento, que es
precisamente el fallo persistente donde reenviar no puede servir. El motor tenía
la respuesta a mano: `cuadrarDesdeDB` la da en milisegundos y sin modelo.

Causa raíz probable: la exclusión explícita de `TruncatedError` de la escalera de
transitorios se aplicó en `generateResponse` (`:458`), donde se encontró el
hallazgo, y no en las dos fronteras que comparten el mismo clasificador —
`generateStructured` (TC30-M1) y el `transitorio` del processor.

### [MEDIO] TC32-M2 — NUEVO: `guardar_liquidacion` devuelve la fotografía COMPLETA del cierre al modelo; su único consumidor la lee de `toolCalls`, no del modelo

`src/lib/likida/tools.ts:505-519` (el `liq` del return) ·
`src/types/likida.ts:169-199` (`Liquidacion.gastos: Gasto[]`) · `:30-92` (`Gasto`) ·
`src/lib/llm/openrouter.ts:1312` (el resultado se `JSON.stringify` al `content`
del mensaje `role:'tool'`) · `:1315` (se empuja a `convo`) ·
`src/lib/agents/run.ts:72-88` (no pasa `terminalTools`) ·
`src/lib/likida/cuadre/guardia.ts:104-107` (quién lo consume de verdad)

El comentario de `tools.ts:505-517` explica por qué el snapshot viaja con el
resultado: para que `guardiaCifras` lo REUSE y no vuelva a leer la base. Es
correcto y la guardia lo lee de donde debe — de `toolCalls`
(`guardia.ts:104-107`). Lo que nadie decidió es que además pasara por el modelo.
`guardar_liquidacion` no es terminal (`run.ts` no pasa `terminalTools`), así que
`entregada` nunca es `true` y el ciclo sigue: `openrouter.ts:1312` serializa el
resultado ENTERO al `content` del mensaje `role:'tool'` y `:1315` lo empuja a
`convo`, que se reenvía completo en la ronda siguiente.

Qué va ahí dentro: `liq.gastos` es `Gasto[]` (`types/likida.ts:177`), y cada
`Gasto` trae `rfcEmisor`, `rfcReceptor`, `cfdiUuid`, `imagenUrl` (la ruta de
Storage), `imgHash`, `waMessageId`, `ocrExtra`, `efos`, `estadoSat`… (`:30-92`).

Escenario, con valores. Cierre de un viaje de 21 comprobantes. Un `Gasto`
poblado serializa en el orden de 450-550 caracteres; 21 de ellos, más
`diferencias` con sus `nota`, son ~10,500 caracteres ≈ 2,600-3,500 tokens que se
añaden a `convo` y se reenvían en la ronda siguiente del rol más caro del repo
(`anthropic/claude-sonnet-5`, $2/$10, `openrouter.ts:207`). Son ~$0.007 por
ronda extra sobre un costo unitario medido de $0.18 (`models.ts:270`), y se
reenvían otra vez si el modelo pide una tool más. Y de ese paquete el modelo
necesita exactamente cuatro campos: `liquidacion_id`, `estatus`, `diferencia` y
las dos banderas de PDF, que ya van aparte (`:490-504`).

Consecuencia: el ejemplo de manual de «un resultado de tool que vuelve al modelo
con más de lo que necesita». Para la flota, tokens que se pagan por plomería
interna. Para el equipo: los RFC del emisor y del receptor, los UUID de CFDI y
las rutas de Storage de cada comprobante cruzan al proveedor en un turno cuya
única salida es un texto que `guardiaCifras` sustituye entero y descarta
(`guardia.ts:151`) — o sea, viajan para nada. `models.ts:19-31` dice con todas
sus letras que RFC y CFDI son datos personales y que lo que los lleve se enruta
con criterio; ese criterio se cumple, pero la superficie no tenía por qué
existir.

Causa raíz probable: el canal de retorno de una tool se usó como canal lateral
entre dos piezas del servidor, sin separar «lo que el orquestador necesita» de
«lo que el modelo lee».

## Reincidentes — verificados hoy, línea por línea, sin un carácter de cambio

Los trece de la 31 siguen abiertos. Reverificados contra el árbol de hoy; las
líneas son las de HOY y coinciden con las de la 31 porque `src/` no se tocó. El
detalle (escenario y consecuencia) sigue siendo válido tal cual está escrito en
`docs/auditoria-31/tool-calling.md`; aquí va lo mínimo para localizarlos.

| Id | Sev. | Aparición | Dónde está hoy |
|---|---|---|---|
| TC30-A1 — el piloto de visión deja que el modelo escriba el VALOR del formulario fiscal | ALTO | **3ª** | `facturacion/adaptadores/piloto_vision.ts:150` (`valor: z.string().nullable()`) · `:496` (única condición sobre el valor) · `:512`/`:514` · `:516` · `registro.ts:459` |
| TC-A1 — «una sola propuesta por turno» es check-then-act sobre un `await` que `Promise.all` atraviesa | ALTO | **5ª** | `agents/copiloto.ts:85` (`has`) · `:101` (`await estaApagado`) · `:115` (`set`) · `llm/openrouter.ts:1264` · `:931-943` · `tool-executor.ts:391-408` |
| TC-A2 — el analista del panel del CLIENTE no tiene `catch`: un tropiezo del último ciclo tira el turno pagado | ALTO | **4ª** | `agents/analista.ts:370` (`try {`) · `:371` · `:479-497` (la red, inalcanzable) · `:522` (`} finally {`, sin `catch`) · `:231` (`required:['tipo']`) · `api/dashboard/chat/route.ts:172` |
| TC31-M1 — el sandbox de tools es la lista de esquemas, no una comprobación | MEDIO | **2ª** | `llm/tool-executor.ts:86` (`REGISTRY` global) · `:157` (`REGISTRY.get(name)`) · `:393` (lo mismo en `makeExecutor`) · `llm/openrouter.ts:1299` · `agents/copiloto-tools.ts:6-9` (la garantía escrita) |
| TC31-M2 — en el adaptador que enuncia «el modelo no puede teclear texto libre», `seleccionar` recibe texto libre | MEDIO | **2ª** | `facturacion/adaptadores/computer_use.ts:43-50` (la regla) · `:362-364` (el esquema sin `enum`) · `:410-414` (el handler) · frente a `:359-360` (`escribir`, que sí la cumple) |
| TC30-M1 — la escalera de truncamiento de `generateStructured` se traga el error del reintento al doble | MEDIO | **3ª** | `llm/openrouter.ts:790-805` (`catch (eT)` en `:798`, relanza solo `TruncatedError` en `:803`) · `:808` · `:812` (`isTransientError(e1)` sobre un `TruncatedError`) |
| TC-M2 — el rol más caro por llamada del repo sigue sin una fila en `llm_costo` | MEDIO | **5ª** | `facturacion/adaptadores/piloto_vision.ts:620` (`const { data } = await generateStructured…`, tira `cost`/`model`) · `:103` (`PASOS_MAXIMOS = 14`) · `grep -n registrarCosto src/lib/likida/facturacion/` → **0** |
| TC-M1 — una respuesta truncada se paga y se anota como CERO MEDIDO en los agentes de fondo | MEDIO | reincidente | `llm/openrouter.ts:412` (settle) · `:422-430` (throw) · `likida/agentes/contenido.ts:409-411` · `likida/agentes/faq.ts:413` |
| TC-M3 — el modo `ensayo` no impide el clic físico que emite | MEDIO | reincidente | `facturacion/adaptadores/computer_use.ts:365` (`clic`, selector libre) · `:368-372` (`emitir` fuera del catálogo) · `:381-393` (`clicDeEmision`) · `:421` |
| TC31-B1 — el loop-guard del piloto solo compara contra el paso ANTERIOR | BAJO | **2ª** | `facturacion/adaptadores/piloto_vision.ts:267` (`let anterior`) · `:350` (`const firma`) · `:351` · `:103` · `:388-389` |
| TC-B1 — `PartialExecutionError` no lleva `costoPorModelo`; el turno más caro se atribuye a `parcial` | BAJO | reincidente | `llm/openrouter.ts:853-874` · `:1327` · `likida/processor.ts:4431-4441` · `api/dashboard/chat/route.ts:157-165` |
| TC-B2 — `generateStructured.costoPorModelo` se produce y no lo consume nadie | BAJO | reincidente | `llm/openrouter.ts:678-685` · `:767` · `likida/intake/ocr.ts:775` |
| TC30-B1 — la etiqueta `modelo` de `llm_costo` cambia de FORMA según si hubo fallback | BAJO | reincidente | `likida/processor.ts:4392-4400` (rama `else` en `:4400`, `res.model`) · `llm/openrouter.ts:1203` (`used = res.model \|\| activeModel`) · `:264-267` |

Los dos ALTOS más viejos merecen la lectura que el encargo pide: **TC-A1 va por
su 5ª ronda y TC30-A1 por su 3ª**, y ninguna de las tres últimas rondas movió una
línea de `src/` en este rubro. Eso ya no es información sobre los bugs: un
hallazgo que sobrevive cinco auditorías con su `archivo:línea` intacto está
diciendo que el rubro **no tiene dueño que ejecute**, solo quien lo mide. El
contraste con la propia ronda 32 lo hace medible: ARQ-A3 se encontró y se arregló
con migración y prueba dentro de la misma ventana; aquí se lleva cinco rondas
escribiendo el mismo párrafo. Mientras eso siga así, la nota de este rubro va a
bajar por acumulación aunque nadie rompa nada nuevo.

## Lo que revisé y está bien

- **El piso del rubro sigue en pie, y lo verifiqué entero, no de memoria.**
  `grep -rn "registerTool(" src --include=*.ts` sin pruebas → **34 hits, 33
  registros** (el 34º es la definición en `tool-executor.ts:88`), mismo reparto
  que la 29/30/31: 14 `copiloto-tools.ts`, 12 `chat-tools.ts`, 4 `tools.ts`, 2
  `copiloto.ts`, 1 `analista.ts`. **Ninguna tool nueva.** Las 4 del agente de
  dinero siguen con `properties:{}` (`tools.ts:40`, `:102`, `:182`, `:268`) y
  `tenantId`/`viajeId` siguen saliendo de `ctx` en las 33. Ninguna tool del
  registro decide QUÉ FILA se escribe.
- **Los dos candados de `guardar_liquidacion` siguen en la TOOL y siguen
  LANZANDO** (`tools.ts:291-298`, `cierrePedidoPorTexto`; `:368-376`, cierre en
  ceros + `cierreEnCerosConfirmado`), y el kill switch de `:307-312` falla
  cerrado. El error viaja al modelo como resultado, no como no-op silencioso.
- **La guardia de cifras de WhatsApp SÍ contiene el sobre-retorno de TC32-M2 en
  lo que se refiere al TEXTO.** Perseguí la hipótesis de que los veredictos
  `SOLO_CONTRALOR` (`cuadre/resumen.ts:45-55`: `cfdi_efos`, `cfdi_cancelado`,
  `rfc_receptor`…) pudieran llegarle al chofer por la narración del modelo, ya
  que `liq` se los enseña sin filtrar. No pasa: cuando `cuadrar_viaje` o
  `guardar_liquidacion` corrieron sin error, `guardiaCifras` sustituye la
  respuesta ENTERA (`guardia.ts:102`, `:152`) por `resumenCuadre(liq, cerro,
  'operador')`, que sí filtra (`resumen.ts:88`). Y el camino de cierre
  recuperado usa `replyDeCierreRecuperado`, también determinístico
  (`processor.ts:4500`). El hallazgo TC32-M2 es de superficie y tokens, no de
  fuga al chofer, y lo reporto así.
- **Idempotencia por EFECTO y no por llamada, intacta.** `tool-executor.ts:391`
  cachea la PROMESA antes del `await` y llavea por **nombre** (`:402`);
  `:164-167` rechaza cerrado una mutación sin `runId`; `:215-223` techa el lease
  en 10 renovaciones con `.unref()` (`:230`); `:266-270` sella el éxito FUERA
  del `try` que decide el resultado; `:279-289` conserva el lease si el handler
  siguió vivo tras el timeout; `mutationEffectKey` (`:353-355`) lleva `runId`.
- **El corte del loop-guard ANTES del `Promise.all`** (`openrouter.ts:1255-1258`):
  con `terminales` vacío —el caso del agente de dinero, `run.ts:72-88` no pasa
  `terminalTools`— una `guardar_liquidacion` pedida en la última ronda **no se
  ejecuta**. Recorrido otra vez de arriba abajo.
- **Ninguna tool con prefijo de lectura escribe.** Recorrí los 33 nombres contra
  `READ_PREFIXES` (`openrouter.ts:886`): ninguna de las que casan
  (`consultar_politica`, `consultar_carta_porte`, `consultar_normas`,
  `estado_viaje`, `estado_agentes`, `estado_runner`, `cuadrar_viaje`) muta nada,
  así que la caché `crossRound` (`:1309`) no puede convertir una escritura en
  un acierto de caché.
- **El error crudo de Postgres no cruza al modelo** (`tool-executor.ts:140-147`),
  con el detalle completo en `logger.error` (`:277`).
- **La reserva no se cobra ante un error de red** en las tres funciones
  (`openrouter.ts:404`, `:728`, `:1147-1152`), y se conserva cuando el proveedor
  omite `usage` (`:411`, `:738`, `:1118-1127`) en vez de liquidar a cero.
- **`cotaEntradaEnTokens` no cuenta imagen ni audio por byte**
  (`openrouter.ts:568-593`), y `PROVIDER_OPTS` (`data_collection:'deny'` +
  `usage:{include:true}`) va en las TRES funciones (`:382`, `:709`, `:1172`). No
  hay camino al proveedor sin el opt-out.
- **`modelosAisladosDeFallback()` sigue vacío** (recorrí `FALLBACK`, `:82-116`,
  contra `PRICES`, `:190-218`), y **`ROLE_PARAMS` sí tiene consumidor**
  (`run.ts:7`, `:70`, `:78-79`): el cuadre corre con `temperature: 0` +
  `reasoning:'high'` de verdad, no con el 0.3 mudo del default.
- **`modelFor` sigue rechazando el override MARCADOR** (`models.ts:206-208`, vía
  `envPuesta`): `LIKIDA_MODEL_*` con `[SENSITIVE]` cae al default y no al 400.
- **`traza_corrida` valida el uuid ANTES de tocar la base**
  (`copiloto-tools.ts:217-220`) y `ficha_cliente` **no adivina**: con más de un
  candidato devuelve `desambiguar` en vez de elegir (`:347`).
- **`npx vitest run src/lib/llm src/lib/agents src/lib/likida/tools_invariantes.test.ts src/lib/likida/tools_estado_viaje_aud24.test.ts`**
  → 54 archivos, **339 pruebas, 0 fallos**, 6.34 s. Cuarta ronda con el mismo
  número exacto.

## Lo que NO alcancé a revisar

- **Nada contra Postgres real ni contra los proveedores.** Sin `.env` y sin red:
  la RPC `reservar_presupuesto_llm` bajo concurrencia y que
  `provider:{data_collection:'deny'}` se respete del otro lado siguen siendo
  contrato declarado. Mismo hueco que de la 24 a la 31.
- **Ningún hallazgo está reproducido con una prueba EJECUTADA dentro del repo**:
  el encargo prohíbe tocar archivos. TC32-A1 lo medí con una **transcripción
  literal** de `extraerNumeros`/`BLANCOS`/`esDerivada` a un script fuera del
  repo, alimentada con la forma exacta que devuelven las tools de
  `chat-tools.ts`; la transcripción la puede verificar cualquiera comparando
  `analista.ts:122-166` con el script. Lo que NO medí es la distribución real de
  `|respaldo|` en tráfico de producción — no hay tráfico. Mi tabla dice qué pasa
  para cada tamaño; qué tamaño ocurre más depende de qué tools llame el modelo.
  El caso de 97 (una sola llamada a `liquidaciones_flota`) es el piso, no el
  promedio.
- **TC32-A2 no lo ejercité contra el endpoint**: el camino
  `route.ts:80 → validarMensajes → ejecutarAnalista → :397` lo recorrí leyendo,
  y `validarMensajes` (`validacion.ts:18-30`) es puro y explícito. Falta ver un
  POST real con un turno `asistente` fabricado.
- **TC31-M1 sigue medido sobre la CLAUSURA DE IMPORTS, no sobre el bundle de
  Vercel** — igual que en la 31, y con la misma advertencia: si dos rutas
  comparten proceso en producción, el alcance es MAYOR que el reportado.
- **TC30-B1 sigue dependiendo de que OpenRouter devuelva el sufijo de proveedor**
  (`:floor`, `:nitro`). El repo lo afirma en dos comentarios y `calcCost` tiene
  el `split(':')` por eso, pero no lo observé en una respuesta real.
- **`generateStructured` con audio** (`openrouter.ts:655`): el fallback de
  `transcripcion` hacia un modelo sin oído sigue sin prueba. **Séptima ronda
  pendiente.**
- **Si `openai/gpt-5.6-terra` acepta imágenes**: `FALLBACK` se indexa por SLUG
  (`:97`), así que el rol `piloto` —que manda una captura en cada paso— hereda el
  fallback textual de `anthropic/claude-sonnet-5`. No lo puedo verificar sin el
  catálogo de OpenRouter; queda anotado por segunda ronda.
- **Los tres adaptadores de facturación no los volví a recorrer completos**:
  reverifiqué las líneas de TC30-A1, TC31-M2 y TC-M3 y el conteo de
  `registrarCosto`, no el resto de `piloto_vision.ts` ni de `playwright_base.ts`.
- **La frecuencia real de TC-A2, TC32-M1, TC-M1 y TC30-M1**: cuántos turnos
  mueren en la última ronda y cuántos ciclos de cuadre truncan de verdad no se
  puede medir aquí.
