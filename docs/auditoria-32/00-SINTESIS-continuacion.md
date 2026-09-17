# Auditoría 32 — síntesis de la continuación

**17-sep-2026** · ronda de **CONTINUACIÓN** sobre el PR **#477**, rama
`claude/auditoria-32` · 4 rubros rotados de 12 · árbol limpio al arrancar,
**autofix habilitado**.

**Global: 4.3** (ayer: **4.7**) · **▼ 0.4**. Bajan 3, se quedan 9.

---

## El resultado de la ronda: el arreglo de ayer traía dos regresiones críticas, y las encontró un auditor

La 32 cerró con un arreglo del que estaba orgullosa: `f0645f9`, la migración
**0357**, que por fin reprodujo ARQ-A3 con cifras contra un Postgres real y lo
cerró. Hoy le tocaba al auditor de **modelo de datos** revisarlo, porque era el
único rubro cuyo código había cambiado. Lo midió contra Postgres 16 con las 334
migraciones aplicadas y volvió con dos CRÍTICOS:

### DAT32C-C1 — la 0357 metió a la llave el único campo que el OCR puede perder

`supabase/migrations/0357_dedup_ejercicio_por_emisor.sql:90` · `src/lib/likida/intake/ocr.ts:560`

`rfc_emisor` entró a la partición del dedup. Es el **único** elemento de esa
llave sin normalización contra la variación entre dos lecturas del mismo papel
—`concepto` va con `unaccent(lower(...))`, el folio con `folio_norm` (que existe
por esto exacto), el uuid con `lower()`— y además puede desaparecer entero:
`ocr.ts:560` hace `rfc = rfcDvOk ? rfcLeido : undefined`, y el comentario de
`:550-556` dice por qué pasa seguido («se le vio devolver PER/PEX/PTE donde
decía PEC»).

Dos fotos del **mismo ticket** de $2,500, folio 1234, con el RFC leído en una
sola. Reproducido con sonda propia:

```
con la función de la 0349 (antes)   →  total 2500.00   ← correcto
con la función de la 0357 (ayer)    →  total 5000.00   ← la regresión
```

Y se amplifica: `engine.ts:812` saca `tope = 0.15 * total` del total inflado, y
el PDF acaba imprimiendo «el ejercicio lleva **$5,000.00** de combustible pagado
con medios que la LISR 27-III no admite» sobre una compra de $2,500, negándole a
la flota los $375 de deducción que la facilidad sí concede. **La 0357 declara en
su propia cabecera que la dirección segura es «fallar hacia es copia»; en este
caso falla hacia la contraria.**

### DAT32C-C2 — cerró una de las dos copias, y las dos pantallas se contradijeron

`supabase/migrations/0355_gastos_fiscales_sin_copias.sql:110` y `:30`

El auditor barrió las 334 migraciones por `row_number() over`: hay seis sitios,
cuatro correctamente acotados a un viaje, y **dos** que portan el criterio de
`copiasDeComprobante` a un universo grande. La 0357 arregló uno. El otro,
`gastos_fiscales_agregados_tenant` —tenant + rango de fechas, que el panel llena
con el año completo— siguió dedupando sin mirar el emisor, **aunque ya calcula
`nullif(g.rfc_emisor,'')` doce líneas arriba y lo publica como dimensión de
celda**. Reproducido con sonda propia, sobre las mismas dos filas:

```
sumar_combustible_ejercicio   →  5000.00
gastos_fiscales_agregados     →  2500.00   (celda única, n:1, rfcEmisor "ESA030303CCC")
iva del panel                 →   344.83
la verdad en la base          →  5000.00  y  689.66
```

La estación B no sale como advertencia: **sale como ausencia** — `orden_copia = 1`
tira la fila antes de agregar. El contralor abre `/dashboard/fiscal`, ve $2,500 y
$344.83, lo cruza contra su póliza y encuentra $5,000 y $689.66. Es exactamente
lo que `CLAUDE.md` prohíbe con todas sus letras: «una cifra fiscal que se lee
distinto en dos pantallas se lee como dos cálculos».

### Lo que esto dice del método, y es el producto de la ronda

**Es la segunda ronda seguida en que un auditor encuentra que el arreglo del
orquestador no cerraba.** La 31 lo escribió primero: de sus cuatro arreglos,
tres cerraban a medias o no cerraban, y lo dijeron los auditores. Hoy los dos
hallazgos más caros del día son regresiones que introdujo la auditoría de ayer.

La conclusión operativa es concreta y ya está aplicada: **el rubro cuyo código
tocó la propia auditoría entra en la rotación de la ronda siguiente por derecho
propio, aunque su nota no sea de las tres más bajas.** Eso fue lo que puso al
auditor de datos en esta ronda, y es lo único que separó estas dos regresiones
de llegar a `master` dentro de un PR que ya estaba en verde con 12/12 checks.

---

## Los tres arreglos, con su mutación

Los tres con prueba que los reproduce, rojo medido → verde, mutación verificada
en los dos sentidos y suite completa entre uno y otro. **Revertidos: 0.**

| sha | hallazgo | rojo medido | mutación |
|---|---|---|---|
| `53740a1` | **DAT32C-C1** (CRÍTICO) — migración 0358 | `total=5000 (esperado 2500)` | con la 0357 → rojo · con la 0349 → rojo (caso mixto, `3500` vs 4500) |
| `5c1734e` | **DAT32C-C2** (CRÍTICO) — migración 0359 | `panel=3500 (esperado 6000)` | con la 0355 → rojo · con partición estilo 0357 → rojo (`6300`) |
| `4b84716` | **PRU32C-A1** (ALTO) — el intermitente | 4 de 10 corridas en rojo | mover el ancla en `route.ts` → roja por 36 ms |

**El arreglo de los dos críticos, en una frase:** el emisor discrimina **solo
cuando se conoce**. Dentro del grupo (concepto, folio, monto), una fila sin
emisor hereda el emisor conocido del grupo vía `min() over` en vez de abrir
partición propia. Un emisor ausente no es evidencia de una estación distinta: es
evidencia de nada. Las cuatro direcciones quedan iguales en las dos pantallas:

1. emisores distintos y los dos conocidos → **no** son copias (ARQ-A3 sigue cerrado)
2. mismo emisor → **sí** son copias
3. emisor nulo en ambos → **sí** son copias (conserva la 0349)
4. emisor en uno y nulo en el otro → **sí** son copias ← la que faltaba

La 0359 se escribió desde `pg_get_functiondef` con **un solo cambio textual**:
reescribir 190 líneas a mano para cambiar cuatro es cómo se cuela una diferencia
que nadie ve. Las dos son idempotentes y conservan la ACL (`service_role`
mantiene EXECUTE; `anon` y `authenticated` siguen sin él).

**El intermitente no era ruido del runner.** La 32 lo estimó en 1 de 5 y lo dejó
anotado. Medido hoy: **4 de 10**, con causa raíz aritmética — dos aserciones del
mismo archivo comparan contra un `Date.now()` tomado antes de la llamada cuando
la holgura es **exactamente 0 ms** (`margen = 9·TPC + 2·TEW = 105,500 ms` y el
peor caso es la misma cifra). Es el contrato de la propia ruta: «el peor caso
queda en 120.0 s exactos contra maxDuration = 120». El código no está mal; la
prueba no podía observar una igualdad a través de un reloj que corre. **0 de 25
después.**

---

## Las notas

| Rubro | Ayer | Hoy | Δ | Porqué del movimiento |
|---|---|---|---|---|
| **Modelo de datos y esquema** | 7 | **5** | ▼2 | **Deuda que cobró factura**, con la factura fechada ayer: la única migración de la ventana abrió dos regresiones CRÍTICAS medidas contra Postgres. El esquema estático no se movió —las unicidades siguen puestas, RLS en 155/155— pero el SQL que el esquema **ejecuta** sí, y dos funciones fiscales quedaron contradiciéndose 2 a 1 sobre las mismas filas. De pilón el auditor corrigió como **falso** uno de sus propios hallazgos de la 31 (DAT31-M1: el CHECK existía desde `0144:23`, y lo descubrió un `INSERT`, no una relectura). 2 CRÍTICOS · 1 ALTO · 4 BAJOS. |
| **Backend y API** | 6 | **6** | = | **Ninguna de las tres razones aplica**, con el saldo detrás: abrió nueve caminos que la 31 listó como no revisados y volvió con **un MEDIO nuevo contra cinco refutaciones** —cinco sitios donde el patrón malo aparecía y el guardarraíl ya estaba—. Y refutó que «un cron falla y late `ok`» fuera una clase: lo persiguió en los once crons y solo `purgar` lo tiene. 0 CRÍTICOS. Lo que impide el 7 tampoco cambió: la mitad destructiva de los caminos de concurrencia sigue sin prueba. |
| **Tool calling** | 5 | **4** | ▼1 | **Mirada más profunda** con dos números contables detrás: **2 ALTOS nuevos** (TC32-A1 y TC32-A2) y reincidentes en su 3ª, 4ª y **5ª** ronda sin cerrarse. El ancla («4 o menos si el modelo puede influir en qué fila se escribe») la fija TC30-A1, en su 3ª aparición: el piloto de visión deja que el modelo escriba el VALOR que se teclea en el formulario fiscal, y el único candado es la regla 5 del prompt. 0 CRÍTICOS. |
| **Sistema agéntico** | 4 | **3** | ▼1 | **Mirada más profunda**, y el número es **3 hallazgos nuevos en áreas que la 31 listó como no revisadas** — no es releer el mismo código con peor humor. El ancla («3 o menos si existe un estado donde la base dice una cosa y el usuario cree otra») la fija el nuevo ALTO de `processor.ts:1689`/`:1941`, que verifiqué yo: al contralor se le manda `RESPUESTA_OFICINA_SIN_TIEMPO` («Dame un minuto y te contesto») y el turno se aplaza con `soltarClaim()` **consumiendo intento**; a los cinco, muere como carta muerta que nadie sella. 0 CRÍTICOS · 7 ALTOS · 2 MEDIOS · 3 BAJOS. |
| Los otros 8 | — | — | = | **No auditados esta ronda.** Conservan su nota por regla. |

**Global: 52/12 = 4.3** (ayer 4.7) · ▼0.4.

**Las notas que NO subí, y por qué lo digo.** Los tres arreglos de hoy son de
**modelo de datos** (los dos críticos) y de **pruebas** (el intermitente).
Ninguno de los dos rubros sube por ellos: subirle el punto a datos sería
calificar mi propio arreglo con su auditor ya ido, y pruebas ni siquiera se
rotó. Los califican sus auditores en la 33. Es la misma regla que aplicaron la
continuación 1 de la 31 y la propia 32, y está escrita para que la serie no
premie al orquestador por su propio trabajo.

**Sobre el ▼0.4 con el código casi congelado.** La 31 cerró pidiendo que todo
movimiento trajera un número contable detrás, y la 32 lo convirtió en default.
Hoy los tres movimientos lo traen: dos regresiones reproducidas con cifras
(datos), dos ALTOS nuevos más un reincidente en su 5ª ronda (tool calling), y
tres hallazgos nuevos en áreas no revisadas (agéntico). **Ninguno de los tres es
«el código no cambió y hoy me cayó peor».** Los otros nueve rubros no se
movieron, ocho porque no se auditaron y backend porque su auditor argumentó por
escrito que ninguna de las tres razones aplicaba.

---

## Verificación adversarial del orquestador

**Confirmados abriendo el archivo, no heredados del reporte:**

- **DAT32C-C1 y DAT32C-C2**: los dos, línea por línea (`ocr.ts:560`, `0357:90`,
  `0355:110`, `0355:30`) **y** reproducidos con sonda propia contra un Postgres
  16 que levanté yo, con las 334 migraciones aplicadas limpias.
- **El nuevo ALTO de agéntico** (`processor.ts:1689`/`:1941`): las dos ramas
  hacen `soltarClaim()` sin `sinConsumirIntento`, y ese parámetro (`:1526`)
  **no se pasa `true` en ningún sitio del repo**. El mensaje que promete la
  respuesta existe en `oficina_wa.ts:302`.
- **ARQ-C1**, el hallazgo más antiguo del tablero, en su **11ª aparición**:
  `export/poliza/route.ts:363-367` mete al arreglo `bloqueos` cualquier
  liquidación cuyo desglose no cuadre, y `:392-402` corta el export **del
  periodo completo** con 409 en cuanto `bloqueos.length > 0`. Abierto e intacto.

**Lo que el auditor de datos corrigió de sí mismo, y cuenta como descartado:**
**DAT31-M1** (MEDIO de la 31, `factura_proveedor` sin piso en sus importes)
resultó **FALSO** — el CHECK existe desde `0144:23`. Lo encontró un `INSERT`
contra la base, no una relectura. Es la clase de corrección que mantiene
honestos a los auditores de mañana.

**NO verificado uno por uno:** los 33 hallazgos que entregaron los cuatro. Abrí
y confirmé los que moví, arreglé o cité arriba; los reincidentes vienen con el
`archivo:línea` que cada auditor dice haber abierto hoy. **No puedo afirmar que
los 33 aguanten**; sí que ninguno de los que toqué resultó falso, y que el único
falso del día lo cazó un auditor sobre su propio trabajo previo.

---

## Lo que queda pendiente, con su razón escrita

- **DAT32C-A1 (ALTO) — propuesto, NO arreglado, y a propósito.**
  `desde_db.ts:184` fija por contrato que `copiasDeComprobante` (`engine.ts:514-561`)
  es «el espejo exacto» del criterio de la RPC. La 0357 movió un lado del espejo
  y no el otro, y mis 0358/0359 lo movieron otra vez. Arreglarlo exige tocar
  `copiasDeComprobante`, que corre sobre **un viaje** —donde su criterio sigue
  siendo el correcto, y es justo lo que la 0357 declaró fuera de alcance con
  razón—. Cambiarlo ahí afectaría el cuadre de todos los viajes para arreglar un
  sustraendo: eso no es un cambio quirúrgico, es un rediseño, y la salida limpia
  (un espejo propio para `desde_db.ts`) es una decisión de diseño, no un parche
  de madrugada. **Queda propuesto para la 33 con esta razón.**
- **Los 7 ALTOS de agéntico, los 5 de tool calling y los 2 de backend**: medios
  y altos sin reproducción propia quedan propuestos. El tope de **3 vueltas de
  arreglo está gastado** (dos críticos y un alto), que es el presupuesto escrito.
- **ARQ-C1**, 11ª aparición, y **TC-A1**, 5ª: los dos abiertos. Un hallazgo que
  reaparece cinco rondas no necesita un sexto reporte, necesita una decisión.

---

## Lo que urge y no es código, QUINTO día

El último commit con `[deploy]` en el **asunto** sigue siendo `cfa00ab`, del
**10-sep** — hace siete días. Verificado con comando, no inferido:

```
$ git log --format='%h %ci %s' origin/master | grep -m1 '\[deploy'
cfa00ab 2026-09-10 01:17:30 -0600 [deploy] publicar fix de integridad de REN-C1

$ git diff --name-only cfa00ab origin/master -- src/ supabase/ | wc -l
21
```

Entre esos 21 archivos siguen `cuadre/desde_db.ts` (ARQ-C2, el cubo del 15 %:
$90,600 impresos contra $95,300 correctos) y `sat_descarga/ciclo.ts` (AG-C1).
**Están en `master` y no en producción.** El pulso de salud sale verde igual
porque mide «¿aterrizó lo último que se pidió publicar?», no «¿producción está al
día?». Se arregla con **Redeploy** en el panel de Vercel sobre el último
deployment, o con un commit que lleve la bandera en la primera línea. Notificado
al dueño, quinto día consecutivo.

---

## Compuerta, sobre el árbol final

```
npx vitest run     988 archivos · 12,976 pasan · 6 saltadas · 0 fallan · exit 0
npx tsc --noEmit   exit 0
npm run lint       0 errores · 154 avisos · exit 0
Postgres 16.13     336 migraciones limpias sobre base VIRGEN · 21/21 pruebas SQL
```

`npm run build` **no se corrió**: pide Supabase, OpenRouter, Facturapi y Upstash,
que no existen en la nube, y su fallo no diría nada del código.

La única prueba SQL en rojo del contenedor es `wa_leases_fencing.sql`, que pide
pgTAP y aquí no está instalado. **INFRA, no código**: en CI corre verde.

## Tablero

`tablero-continuacion.html` + `tablero-continuacion.png`, capturado **y mirado**.
Mirarlo encontró un defecto que medir no encontró: la tarjeta de la compuerta
desbordaba su caja y el texto se salía por abajo. Corregido y recapturado.
Verificado en la imagen final: **12 rubros**, las notas coinciden con las de esta
síntesis rubro por rubro, **suma 52**, global **4.3**, cuatro píldoras «auditado
hoy», y los 12 puntos de la serie global dentro del `viewBox` con su etiqueta
legible.

## INFRA de esta corrida

- El clon no traía `node_modules`: `npm ci`, exit 0. Costo de la ronda, no fallo.
- **Trampa nueva, anotada para la 33:** `initdb` falla **mudo** si el datadir
  cuelga del scratchpad de la sesión (`/tmp/claude-0/...`), porque el usuario
  `postgres` no puede atravesar ese directorio y el error se pierde. El datadir
  va en `/var/tmp` con `chown postgres`. El resto de la receta de la 32 se
  confirmó: binarios en `/usr/lib/postgresql/16/bin` (fuera del PATH) y `su
  postgres` obligatorio.
- El binario de Chromium está en `/opt/pw-browsers/chromium` —es el ejecutable,
  no un directorio—, no en la ruta que espera el Playwright del repo.
- No hay `gh` en la imagen: todo lo de GitHub salió del MCP.
- Sin red saliente hacia `app.likida.ai`: lo que se afirma de producción sale de
  `git` y de la API de GitHub.
- `docs/auditoria-*/` está en `.gitignore:36` y se commitea con `git add -f`.
