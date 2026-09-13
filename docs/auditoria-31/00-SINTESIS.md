# Auditoría 31 — síntesis

**13-sep-2026** · ronda **COMPLETA**, 12 rubros · rama `claude/auditoria-31` sobre
`4047a50` · árbol limpio al arrancar, **autofix habilitado**.

**Global: 4.8** (anterior: **5.2**) · **▼ 0.4**. Bajan 5, sube 1, se quedan 6.

---

## Lo primero, porque cambia cómo se lee todo lo demás: no entró código

`git diff 5ce91b2..HEAD --name-only` devuelve **dos rutas**, y las dos son
dotfiles de bitácora:

```
normas/.latido-cuota-diesel
normas/.latido-vigilancia
```

Cero líneas de `src/`. Cero de `supabase/`. Cero fichas `normas/*.yaml`. Las dos
rutinas de vigilancia no pudieron salir a la red (egress bloqueado) y lo único
que escribieron fue el registro del intento fallido.

**El árbol que calificaron estos doce auditores es, byte por byte, el que la
ronda 30 calificó con 5.2.** Por eso este ▼0.4 no mide el código. Mide el
instrumento — y ésa era exactamente la pregunta que la 30 dejó abierta.

## La acción de cierre de la 30, ejecutada y con resultado

La 30 cerró admitiendo un sesgo del orquestador: su `MAPA.md` les dijo a los
doce auditores, con esas palabras, que bajar una nota por «mirada más profunda»
era «un resultado válido y esperado». Nueve de doce bajaron y **siete citaron esa
razón**. La acción escrita fue: *el MAPA de la 31 no debe contener ninguna frase
que sugiera una dirección para las notas.*

Se cumplió. El `MAPA.md` de esta ronda dice, literal: «Que suba, que baje o que
se quede son los tres resultados igual de válidos, y ninguno de los tres es el
que este documento quiere», y pide anclar cada movimiento en algo contable.

**El resultado es medible y es el hallazgo metodológico de la ronda:**

| | Ronda 30 (MAPA sesgado, 38 commits) | Ronda 31 (MAPA neutral, 0 commits) |
|---|---|---|
| Notas que **no se movieron** | **1** de 12 | **6** de 12 |
| Bajaron | 9 | 5 |
| Subieron | 2 | 1 |
| Movimientos «mirada más profunda» | 7 | 4 |

**Seis rubros escribieron, sin ponerse de acuerdo, alguna forma de «ninguna de
las tres razones aplica».** Fiscal lo argumentó explícitamente: «no se atacó
nada… la deuda no cobró factura nueva… y la mirada más profunda de esta ronda
**confirma** el 3 en vez de corregirlo. Bajar a 2 exigiría que algo empeorara, y
nada empeoró: el árbol es idéntico.»

Esa frase es lo que la serie histórica necesitaba y no tenía. **La conclusión
provisional: buena parte del bandazo de las rondas 28-30 era el encargo, no el
código.** Con el encargo neutralizado y el código congelado, la mitad del
tablero se quedó quieto.

**Lo que esto NO prueba.** Sigue habiendo ▼0.4 con cero líneas cambiadas, así que
el instrumento aún no es estable. Tres de las cinco bajadas traen cifra propia y
son defendibles (ver abajo); las otras dos son juicio. **Acción para la 32:**
mantener el MAPA neutral —ya no es un experimento, es el default— y exigir que
todo movimiento traiga un número contable, no solo una explicación.

---

## El hallazgo operativo de la ronda, y es el que urge

**Los dos arreglos que la ronda 30 commiteó están en `master` y NO en
producción.** Verificado con comando, no inferido:

```
$ git log --format='%h %s' | grep -m1 '^\S* \[deploy'
cfa00ab [deploy] publicar fix de integridad de REN-C1 (keyset en candidatosDb)   ← 10-sep

$ git diff --stat 4e36c82..5ce91b2 -- src/
 src/lib/likida/cuadre/desde_db.ts      | 19 ++++++++-      ← ARQ-C2 (cubo del 15 %)
 src/lib/likida/sat_descarga/ciclo.ts   | 22 +++++++---      ← AG-C1 (consolidado ECC)
```

El merge de la Auditoría 30 (`5ce91b2`, 12-sep) **no lleva la bandera `[deploy]`
en el asunto**, y ninguno de los commits posteriores tampoco. Producción sigue
sirviendo `cfa00ab`, del 10-sep.

Lo que eso significa en dinero: **ARQ-C2 es el hallazgo que la propia 30 midió en
$90,600 impresos contra $95,300 correctos** — cupo del 15 % regalado por cada
ticket fotografiado dos veces, con el PDF declarando deducible lo que ya excedió
la RFA 2026 2.9. Ese arreglo existe, tiene prueba, está mergeado, y no está
publicado.

**Y el pulso de salud sale verde igual**, porque su invariante es «¿aterrizó lo
último que alguien pidió publicar?», no «¿producción está al día?». Siete
corridas de `salud-produccion.yml` posteriores al merge, las siete `success`.
Es OP-M3 de la 30 —degradado entonces a MEDIO «por disciplina humana»— cobrando
la factura: **cobertura efectiva de publicación de esta ventana, 0 %,** contra
el 100 % que sostuvo el 7 de operabilidad.

**Se arregla en un minuto:** Redeploy en el panel de Vercel sobre el último
deployment, o un commit cuya **primera línea** lleve `[deploy]`. Se notificó al
dueño en cuanto se verificó, sin esperar al cierre de la ronda.

---

## Las notas

Global = media aritmética de los 12, con un decimal: **57 / 12 = 4.75 → 4.8**.

| Rubro | Antes | Hoy | Δ | Porqué del movimiento |
|---|---|---|---|---|
| **Modelo de datos** | 7 | **7** | = | **Ninguna de las tres razones aplica** — no entró esquema. Y lo sostiene midiendo caminos que la 30 no barrió: 155/155 tablas con RLS, 21/21 destinos de `onConflict` respaldados por un único índice no parcial, 77/82 columnas de estado con CHECK. Los 11 abiertos siguen abiertos y ninguno estaba mal reportado. |
| **Backend y API** | 7 | **6** | ▼1 | **Mirada más profunda**, con cifra: el predicado de «liquidación vigente» está escrito **31 veces a mano** (14 TS + 17 SQL), sin helper, y faltan **2 lectores vivos** — la 30 cerró seis agregados y no la clase. Dos ALTO nuevos, uno de ellos una cola de borrado de Storage que se atasca para siempre mientras el cron late `ok`. |
| **Pruebas** | 6 | **6** | = | **Dos fuerzas medibles se cancelan.** El motor de cuadre —que la 30 nunca muteó— sí está anclado: **20 de 23 mutaciones mueren (87 %)**. Y sobre la clase comparable, la cifra de dinero que la pantalla imprime, el número es idéntico al de la 30: **0 de 12**. 45 mutaciones, 24 muertas. |
| **Frontend** | 5 | **5** | = | **Ninguna de las tres razones aplica**: el rubro no recibió una línea. Cero cierres por segunda ronda seguida, los 6 abiertos verificados uno por uno, y 3 hallazgos nuevos que se compensan con defensas que la 30 no había acreditado (4 de 5 listas topadas sí declaran su tope; 0 `min-w` por encima de 360). |
| **Seguridad** | 6 | **5** | ▼1 | **Mirada más profunda.** Dos afirmaciones de la nota anterior salieron **más angostas** al medirlas. Descartó el CRÍTICO **por escrito y con el barrido que lo sostiene** (156/156 tablas con RLS, 6/7 buckets privados con el séptimo público a propósito, `npm audit` 0/751) — eso es lo que hace creíble la bajada. |
| **Tool calling** | 5 | **5** | = | **Ninguna de las tres razones aplica**: «el árbol es byte por byte el que la 30 calificó». 10 reincidentes verificados uno por uno, 3 nuevos, ningún crítico. Las 33 tools siguen respetando `properties: {}`. |
| **Operabilidad y DX** | 7 | **5** | ▼2 | **Deuda que cobró factura**, y es la bajada mejor fundada del tablero. La medición que sostenía el 7 —cobertura de publicación **100 %**— se invirtió a **0 %** dentro de una sola ventana, y lo que quedó sin publicar son los dos arreglos fiscales de la 30. Verificado por el orquestador con `git`, no solo reportado. |
| **Sistema agéntico** | 4 | **4** | = | **Se cancelan un cierre real y un ALTO nuevo.** AG-C1 quedó **cerrado de verdad** —verificado en `ciclo.ts:342-357`: `marcar('ignorado')` salió del `if`, y el contador se quedó adentro, que era la mitad sutil—. Contra eso, un ALTO nuevo en el camino feliz del demo. |
| **Rendimiento y costo** | 5 | **4** | ▼1 | **Mirada más profunda:** tres techos reventados más que nadie había sumado, en rutas que la 30 dio por buenas. Y la cifra que no se mueve desde la 29: la suma del peor caso sigue en **331.2 s contra `maxDuration = 300`**. Los 13 abiertos, intactos. |
| **Arquitectura** | 3 | **4** | ▲1 | **Se atacó y subió**, topado por el ancla del rubro (la misma lógica de dinero sigue en más de un archivo). ARQ-C2 y ARQ-A1 **cerrados de verdad**, y el segundo se cerró con el mecanismo correcto: el guardia TS↔SQL ya **deriva** la migración viva (`rutaVigente()`) en vez de teclearla, que es lo que este rubro venía pidiendo desde la 24. |
| **Cumplimiento legal** | 4 | **3** | ▼1 | **Mirada más profunda.** El ancla dice «3 o menos si hay transferencia de datos personales sin cobertura», y hay **dos** abiertas y reconfirmadas (LEG-A1, LEG-A5): con eso, 4 no era defendible. Los 12 abiertos verificados línea por línea, los 12 intactos. Cifra nueva: las 3 tablas con dato personal de esta ronda no aparecen en ninguna de las **18** funciones de `mantenimiento_de_datos`. |
| **Cumplimiento fiscal** | 3 | **3** | = | **Ninguna de las tres razones aplica**, argumentado explícitamente: el ancla ya estaba fijada por FIS-C1 y nada empeoró. Hallazgo nuevo de peso: la **calculadora pública** imprime el estímulo de IEPS **en pesos** multiplicando un año de litros por la cuota de **una semana** — 3.80× de dispersión según la semana en que entre el visitante. |

---

## Los 13 críticos — ninguno sin estado

**Arreglado con prueba que lo reproduce (1), commit atómico, 0 revertidos de los retenidos:**

- **`fd66be6` — PRU-31-C2 (CRÍTICO).** El tope de efectivo de la **LISR 27-III**
  que de verdad llega al motor no tenía ancla. La auditoría 24 escribió el test
  para esto y ancló **la constante de la rama que producción nunca toma**:
  `engine.ts:754` lee `input.estimulos?.efectivoTopeMxn ?? TOPE_EFECTIVO_LISR_27_III`,
  y el `??` solo dispara si no llega `estimulos` — pero `desde_db.ts:215` lo
  manda **siempre**. El número que juzga un comprobante en efectivo es el de
  `config.ts:129`, y no tenía una sola aserción sobre su valor.
  **Medido:** `2000 → 20000` pasaba **593 pruebas** de `cuadre`+`config` en verde
  (10,177 de `src/lib/` según el auditor). Con el tope movido, la banda de
  $2,000–$20,000 en efectivo —hospedaje de carretera, casetas, diésel sin
  monedero— se declara deducible y sale impresa como deducible en el PDF.
  **Rojo medido → verde:** con la mutación mueren 4 de las 5 aserciones nuevas
  (2 por valor, 2 por comportamiento); sin ella pasan las 9 del archivo.

**Revertido (1), y lo que destapó vale más que el arreglo:**

- **AG-31-A1 (ALTO)** — el cierre trata «Meta no contestó» y «Meta dijo que no»
  como el mismo booleano, así que cuando `sendDocument` **ya encoló** el PDF le
  dice al chofer «no se te entregó, pídeselo a tu contralor» cinco minutos antes
  de que le llegue, despierta a Javier con una alerta de dinero falsa, y no sella
  la entrega (el siguiente «gracias» se lo manda por segunda vez).
  La prueba reprodujo el bug (2 rojas, control verde) y el arreglo la puso verde
  — **pero la suite completa lo rechazó, con razón.** Un 400 de Meta cuyo cuerpo
  no trae `code` parseable devuelve `codigo: undefined`, que `pdfEstadoDe`
  traduce a `'encolado'`… y ese caso **no** se encola (`client.ts:570` solo
  encola si `esReintentableMeta`). El arreglo habría **sellado como entregado un
  PDF perdido**. Revertido; el hallazgo vuelve a *pendiente*.
- **Hallazgo NUEVO que salió de ese intento, y está vivo hoy:** `pdfEstadoDe` es
  **insegura para cualquier llamador**, porque `client.ts:571` no devuelve
  `status` y por tanto nadie puede distinguir «el catch de red encoló» de «un 400
  sin código, que no encola». El llamador que **ya** la usa —`processor.ts:1192`,
  el camino de reentrega— tiene el defecto **en producción**: con un 400 sin
  código sella la entrega, marca `pdf = 'mandado'` y se calla. Arreglarlo bien
  es cambiar el contrato de `sendDocument`, que usan cuatro emisores: **propuesto,
  no tocado** — no es un cambio para dejar caer de madrugada sin revisión.

**Pendientes con razón escrita (9):** FIS-C1 (3ª forma), FIS-C2, ARQ-A3, ARQ-C1
(9ª aparición), LEG-C1, REN-30-C1, REN-30-C2, OP-C1 (5ª ronda), PRU-C1, FE-C1
(6ª ronda). Ninguno se tocó: todos exigen decisiones de producto o cambios que
exceden el alcance del hallazgo, y el tope de 3 vueltas se gastó en los dos de
arriba.

**Propuestos verificados (2 nuevos):** LEG-31-C1 (la foto que el aviso promete
borrar y tres candados retienen) y REN-31-C1 (el cron de emergencias que reserva
15 s para una unidad de 81.5 s y quema el claim antes de mandar el WhatsApp).

---

## Verificación adversarial: qué comprobé yo y qué no

Esto va explícito porque la skill lo exige y porque es lo que impide que la nota
se mueva por ruido.

**Verificado por el orquestador con comando o abriendo el archivo:**

- El tamaño de la ventana (`git diff --name-only`, 2 rutas) y que el árbol no
  cambió. **Confirmado.**
- La brecha de despliegue: último `[deploy]` = `cfa00ab`; `5ce91b2` tocó
  `desde_db.ts` y `ciclo.ts` sin bandera. **Confirmado, y notificado.**
- PRU-31-C2 completo: leí `config.ts:129`, `engine.ts:754`, `desde_db.ts:215` y
  el test de la 24, y **reproduje la mutación** (593 verdes). **Confirmado.**
- AG-31-A1: leí `processor.ts:4804-4823`, el hermano de `:1187-1199`, el
  docblock de `pdfEstadoDe` y `client.ts:550-571`. **Confirmado** — y al
  intentar arreglarlo encontré por qué el arreglo obvio es inseguro.
- Que AG-C1, ARQ-C2 y ARQ-A1 están **cerrados de verdad**: lo verificaron por
  separado los auditores de agéntico y arquitectura, con `archivo:línea`.

**Falso, encontrado y corregido — y es un defecto del método, no de un auditor:**

- Los tres shas que la ronda 30 cita como sus arreglos (`7d5bcdc`, `b740fe0`,
  `7a9b087`) **no existen en el repo**: `git cat-file -t` da `Not a valid object
  name` en los tres. El PR de la 30 entró **aplastado** en `5ce91b2`. Mi propio
  `MAPA.md` los propagó, y el auditor de arquitectura lo cazó y verificó los
  arreglos contra el código en vez de contra el sha. **Consecuencia para la 32:
  el `RESULTADO.md` de una ronda no debe citar shas de rama que el squash va a
  destruir; debe citar `archivo:línea` del arreglo.**

**NO verificado uno por uno:** los 148 hallazgos. Abrí y confirmé los que
moví, arreglé o cité arriba, y los reincidentes vienen con el `archivo:línea`
que cada auditor dice haber abierto hoy. **No puedo afirmar que los 148
aguanten**; sí que ninguno de los que toqué resultó falso.

---

## Compuerta

Sobre el árbol final (con `fd66be6` dentro):

```
npm test        984 archivos · 12,939 pasan · 6 saltadas · 144.49 s · exit 0
tsc --noEmit    exit 0
eslint src/     0 errores · 154 avisos · exit 0
lint:ratchet    154/194 heredados · 0 nuevos · 0 errores
```

`npm run build` **no se corrió**: pide Supabase, OpenRouter, Facturapi y Upstash,
que no existen en la nube, y su fallo no diría nada del código.

## Tablero

`tablero.html` + `tablero.png`, capturado **y mirado**. Mirarlo encontró un
defecto que medir no encontró: la primera captura quedaba **truncada** a 2,560 px
y cortaba la tabla de hallazgos a la mitad; se recapturó a 3,600 px. Verificado
en la imagen final: **12 rubros**, las notas del tablero coinciden con las de
esta síntesis rubro por rubro, suma **57**, global **4.8**, y Arquitectura se
pinta **roja** con su ▲1 — el color codifica la nota, nunca el delta.

## INFRA de esta corrida

- El clon no traía `node_modules`: `npm ci`, exit 0. Costo de la ronda, no fallo.
- **Trampa que casi cuesta la ronda entera:** `docs/auditoria-*/` está en
  `.gitignore:36`. Los 18 archivos de la 30 están rastreados solo porque se
  forzaron. Un `git add docs/auditoria-31/` normal **no habría añadido nada** y el
  PR habría salido vacío sin avisar. Se commitea con `git add -f`.
- Sin red saliente: nada de producción se consultó contra `app.likida.ai`. Lo que
  se afirma de producción sale de `git` y de la API de GitHub.
- El binario de Chromium está en `/opt/pw-browsers/chromium`, no en la ruta que
  espera el Playwright del repo; la captura usó ese ejecutable directo.
