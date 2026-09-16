# Pruebas — auditoría 31, continuación 2

**Nota: 6/10** (antes 6). Razón del movimiento: **no se mueve, y otra vez las dos
fuerzas son medibles y opuestas — pero NO son las mismas de la ronda pasada.**

- **Se atacó y subió, con número:** `PRU-31-C2` (CRÍTICO) **cierra de verdad**.
  Muté `config.ts:129` de `efectivoTopeMxn: 2000` a `20000` y la suite se puso
  roja: **701 archivos, 4 pruebas rojas de 10,188**, las cuatro del bloque nuevo
  de `fd66be6`. Es la primera vez en tres rondas que verifico una «prueba que
  reproduce el bug» de esta rama y muerde en el sitio exacto que dice proteger.
- **Deuda que cobró factura, con número:** de las **18 mutaciones** que corrí
  esta ronda mueren **9 (50 %)**, y las 9 que sobreviven describen una clase que
  este rubro no tenía nombrada: **el ancla cubre el motor y deja el cableado
  desnudo**, y **la propiedad se vigila con un `grep` del fuente en vez de con
  comportamiento**. Dos de los cuatro arreglos de esta misma rama son
  **reversibles en producción con la suite entera en verde**: quitar el reloj de
  `peajes/page.tsx:234` (94 archivos / 612 pruebas, 0 fallos) y devolver el
  shell a `deriva-sin-desplegar.mjs` (10/10 verdes).
- **Mirada más profunda:** 50 % esta ronda contra 53 % la anterior (24/45). No
  es comparable directo —el muestreo es otro, dirigido a las seis pruebas
  nuevas— pero sí lo es lo que no se movió: **la cifra de dinero que la pantalla
  imprime sigue en 0**, y las dos mutaciones nuevas de esta ronda la dejan en
  **0 de 14 acumuladas**.

El ancla de la nota lo sigue describiendo palabra por palabra: «la suite es
grande y verde pero hay zonas de dinero sin arnés». Un CRÍTICO retirado contra
cuatro hallazgos nuevos de decoración da exactamente cero.

**Riesgo mayor del rubro, hoy:** ya no es solo que falte arnés, es que **el
arnés que se escribió esta semana mide la aritmética y no la cadena, y el fuente
y no la conducta**. Cuatro de las seis pruebas nuevas se pueden dejar verdes
mientras la función que dicen proteger vuelve al estado que provocó el arreglo.

---

## Cómo se midió (repetible)

- **Worktree desechable** `git worktree add --detach <scratchpad>/wt-pru HEAD`
  sobre **`939c111`**, `node_modules` por symlink. Cada mutación revertida con
  `git checkout --` inmediatamente después de su corrida, y `git status
  --porcelain` del worktree vacío al terminar antes de borrarlo.
- **18 mutaciones dirigidas**, todas a los archivos que los seis commits de esta
  rama tocaron, más dos de control sobre la capa de pantalla.
- **Línea base propia de los seis archivos:** `npx vitest run <los 6>` →
  **6 archivos, 67 pruebas, 0 fallos** antes y después de todo el trabajo.
- **Línea base de la suite entera, corrida hoy sobre `939c111`:** `npx vitest
  run` → **986 archivos, 12,960 pruebas verdes, 6 saltadas, 0 fallos**
  (177.9 s). Es el número contra el que hay que leer cada «N pruebas siguen
  verdes» de abajo.
- **Evidencia de CI leída de las corridas reales**, no del YAML: las 100 últimas
  corridas `push` de `ci.yml` sobre `master` y las 4 de `claude/auditoria-31`,
  por la API de Actions.
- **NO corrí** `pruebas-manuales/*.prueba.ts` ni `npm run build`.

---

## Las seis pruebas nuevas de esta rama, mutadas una por una

| # | Commit | Archivo de prueba | Mutación aplicada | ¿Murió? | Veredicto |
|---|---|---|---|---|---|
| M1 | `fd66be6` | `cuadre/tope_efectivo_default.test.ts` | `config.ts:129` `efectivoTopeMxn: 2000` → `20000` | **sí** — 4 rojas / 10,188 (701 arch.) | **MUERDE** |
| M2 | `f4fde69` | `api/cron/asistencia/route.test.ts` | `route.ts:76` margen derivado → el literal viejo `(maxDuration - 15) * 1000` | **sí** — 2 rojas / 8 | **MUERDE** |
| M3 | `f4fde69` | ídem | `route.ts:75` `{ consultas: 7, envios: 2 }` → `{ consultas: 1, envios: 0 }` | **sí** — 2 rojas / 8 | **MUERDE** |
| M4 | `f4fde69` | `asistencia_escalamiento.test.ts` + `route.test.ts` | **+ una OCTAVA consulta** `acotada(supabaseAdmin()…)` dentro de `escalarUna` | **no** — 31/31 verdes | **DECORACIÓN** |
| M5 | `f4fde69` | `asistencia_escalamiento.test.ts` | consulta de `viaje` otra vez SIN techo, hoisteada: `const cons = supabaseAdmin()…; await cons` | **no** — 31/31 verdes | **DECORACIÓN** |
| M5b | `f4fde69` | ídem | el revert LITERAL: `await supabaseAdmin().from('viaje')…` | **sí** — 1 roja / 23 | **A MEDIAS** |
| M6 | `54bddb2` | `intake/consolidado_barrido.test.ts` | borrar el bloque `if (Date.now() > venceEn)` de `consolidado.ts:860` | **sí** — 2 rojas / 13 | **MUERDE** |
| M7 | `54bddb2` | ídem | `consolidado.ts:861` `pendientes.length - resumen.revisadas` → `pendientes.length` | **sí** — 1 roja / 13 | **MUERDE** |
| M8 | `54bddb2` | ídem (+ toda la carpeta) | `peajes/page.tsx:234` `barrerPorConciliar(tenantId, { venceEn: … })` → `barrerPorConciliar(tenantId)` | **no** — **94 archivos / 612 pruebas, 0 fallos** | **DECORACIÓN (el cableado)** |
| M9 | `939c111` | `peajes/acuse-corte.test.tsx` | `controles.tsx:86` ↔ `:88`: intercambiar `{r.revisadas}` con `{r.conciliadas}` | **no** — 8/8 verdes | **DECORACIÓN** |
| M10 | `065f699` | ídem | `controles.tsx:75` `r.revisadas === 0 && r.cortadosPorReloj === 0` → `r.revisadas === 0` (el bug original) | **sí** — 1 roja / 8 | **MUERDE** |
| M11 | `8c0e7df` | `scripts/ci/deriva_sin_desplegar.test.ts` | `deriva-sin-desplegar.mjs:29` `execFileSync('git', args)` → `execSync(\`git …\`)` | **sí** — 1 roja / 10, **y es la prueba de `grep`** | **A MEDIAS** |
| M11b | `8c0e7df` | ídem | `execFileSync('sh', ['-c', \`git ${args.join(' ')}\`])` — el shell de vuelta | **no** — 10/10 verdes | **DECORACIÓN** |
| M12 | `8c0e7df` / `30e5e14` | ídem | `resumirDeriva`: `if (commits.length === 0)` → `if (true)` | **sí** — 2 rojas / 10 | **MUERDE** |
| W1 | cableado | ídem | `salud-produccion.yml:179` argumentos invertidos: `… origin/master "$version"` | **no** — 10/10 verdes | **DECORACIÓN** |
| W2 | cableado | ídem | `salud-produccion.yml:173` el paso entero con `if: false` | **no** — 10/10 verdes | **DECORACIÓN** |
| M14 | control | — | `rentabilidad/vista.tsx:173-174` intercambiar `mxn(f.pagado)` con `mxn(f.saldo)` | **no** — 94/612 verdes | (PRU-C1) |
| M15 | control | — | `combustible-casetas/vista-consolidado.tsx:43` `mxn(l.monto)` → `mxn(0)` | **no** — 94/612 verdes | (PRU-C1) |

**Resumen por commit:**

| Commit | Veredicto |
|---|---|
| `fd66be6` — tope de efectivo | **MUERDE**. Cierra `PRU-31-C2` de verdad. |
| `f4fde69` — margen de reloj del cron | **A MEDIAS**. La aritmética del margen está anclada (M2, M3); la **cadena** de la que se deriva y el **techo** de sus consultas, no (M4, M5). |
| `54bddb2` — barrido de peajes con reloj | **A MEDIAS**. El motor muerde (M6, M7); el **cableado que lo enciende en producción**, no (M8). |
| `065f699` — acuse del corte | **MUERDE**. Reproduce su propio bug (M10). |
| `8c0e7df` — git sin shell | **A MEDIAS**. La lógica pura muerde (M12); la propiedad de seguridad se vigila con un `grep` que se rodea (M11b) y el cableado sobrevive dos mutaciones (W1, W2). |
| `939c111` — fronteras de etiqueta | **A MEDIAS**. `>N<` distingue la cifra de un `className`, pero no **cuál de los dos `<span>`** la imprimió (M9). |

---

## Hallazgos

### [CRÍTICO] `PRU-C1` — REINCIDENTE (4.ª ronda) — la cifra de dinero que la pantalla imprime sigue en 0; con las dos de hoy van **0 de 14**

`vitest.config.ts:104` (`'src/app/**/*.tsx'` sigue en `coverage.exclude`,
verificado hoy, byte por byte el mismo) ·
`src/app/dashboard/rentabilidad/vista.tsx:173-174` ·
`src/app/dashboard/combustible-casetas/vista-consolidado.tsx:43`

**Escenario, con valores, las dos mutaciones nuevas de esta ronda.**

1. En `rentabilidad/vista.tsx` intercambio las dos columnas contiguas de la
   tabla de facturas:

   ```
   -   <td …>{mxn(f.pagado)}</td>
   -   <td … font-medium>{mxn(f.saldo)}</td>
   +   <td …>{mxn(f.saldo)}</td>
   +   <td … font-medium>{mxn(f.pagado)}</td>
   ```

   Con una factura de `total $116,000`, `pagado $40,000`, `saldo $76,000`, la
   pantalla de Rentabilidad dice «Pagado **$76,000** · Saldo **$40,000**».
2. En `combustible-casetas/vista-consolidado.tsx:43`, el monto de cada línea del
   consolidado de casetas → `mxn(0)`.

⇒ las dos juntas: `npx vitest run src/app/dashboard/` → **94 archivos, 612
pruebas, 0 fallos.**

**Y la ironía medible:** `rentabilidad/vista.test.tsx` es exactamente el archivo
que la ronda pasada citó como «el antídoto que ya está en el repo y funciona»
—afirma la frase completa del estado vacío—. Sigue siendo cierto de esa frase, y
al mismo tiempo las tres columnas de dinero de su propia tabla se pueden barajar
sin que se ponga roja. Afirmar una frase larga no es lo mismo que afirmar una
cifra.

**Consecuencia.** La regla que define el producto es «nunca inventar una cifra».
El contralor abre Rentabilidad para saber cuánto le deben, y la columna «Saldo»
le enseña lo que ya cobró. Hoy hay 986 archivos de prueba y ninguna se pone roja
por eso.

**Causa raíz (una línea):** la puerta de cobertura mide la capa donde el dinero
se *calcula* y excluye por configuración la capa donde se *imprime*, así que
escribir pruebas ahí no produce señal y no escribirlas no produce alarma.

---

### [ALTO] `PRU-31C-A1` — NUEVO — el ancla de `REN-30-C1` prueba el motor del reloj y deja el cableado desnudo: quitar `venceEn` de la Server Action deja **612 pruebas verdes** y el barrido vuelve a correr sin reloj

`src/app/dashboard/agentes/peajes/page.tsx:234` ·
`src/lib/likida/intake/consolidado_barrido.test.ts:282-322` (las tres pruebas
nuevas de `54bddb2`) · `src/app/dashboard/agentes/peajes/acuse-corte.test.tsx:93-102`

**Escenario, con valores.**

```
- const resumen = await barrerPorConciliar(tenantId, { venceEn: ahoraMs() + 25_000 });
+ const resumen = await barrerPorConciliar(tenantId);
```

`barrerPorConciliar` declara `opts: { venceEn?: number } = {}` y hace
`opts.venceEn ?? Number.POSITIVE_INFINITY`, así que la línea de arriba compila,
es legal, y **devuelve el barrido al estado exacto de antes del arreglo**: cola
de hasta 1,000 líneas, 3 consultas por línea, 3,047 viajes de red y ~914 s
nominales contra los 300 s de techo — 3.05×, que es la medición con la que se
justificó `54bddb2`. ⇒ `npx vitest run src/app/dashboard/` → **94 archivos, 612
pruebas, 0 fallos**; `npx vitest run src/app/dashboard/agentes/peajes/` → **3
archivos, 8 pruebas, 0 fallos**.

**Por qué ninguna de las pruebas nuevas lo ve.** Las tres de
`consolidado_barrido.test.ts` llaman a `barrerPorConciliar` **pasándole ellas
mismas el `venceEn`**: prueban que el motor obedece el reloj que se le presta,
nunca que alguien se lo preste. Y la única prueba que mira `page.tsx` —el
segundo `describe` de `acuse-corte.test.tsx`— lee el fuente con dos expresiones
regulares y las dos son sobre `estado: resumen.cortadosPorReloj > 0 ? 'parcial'
: 'ok'`; ninguna menciona `venceEn`.

**Consecuencia.** Es el arreglo de un CRÍTICO reincidente de dos rondas. Puede
desaparecer en un refactor de la Server Action —o en un revert selectivo— sin un
solo rojo, y el modo de falla es el que el propio commit describe: la plataforma
corta a media línea, `ligarLineaAGasto` deja el sello escrito en `gasto`, el
UPDATE que cierra la línea no corre, y el contador ve un error genérico sobre un
barrido que SÍ amarró conciliaciones fiscales.

**Causa raíz (una línea):** se probó el parámetro y no el argumento — el motor
tiene arnés y el único llamador de producción no.

---

### [ALTO] `PRU-31C-A2` — NUEVO — el margen del cron de emergencias se ancla contra sí mismo: la cuenta «7 consultas + 2 envíos» no se coteja con la cadena real, y una octava consulta pasa con **31/31 verdes**

`src/app/api/cron/asistencia/route.ts:75` ·
`src/app/api/cron/asistencia/route.test.ts:121-167` (las dos pruebas de `f4fde69`) ·
`src/lib/likida/asistencia_escalamiento.ts:295-313` (`escalarUna`)

**Escenario, con valores.** Dentro de `escalarUna`, en el camino de
`hayLesionados === true`, añadí **una octava consulta acotada**:

```
+ await acotada(supabaseAdmin().from('unidad').select('id')
+   .eq('tenant_id', inc.tenantId).limit(1), 'asistencia.mutacion_m4');
```

⇒ `npx vitest run src/app/api/cron/asistencia/ src/lib/likida/asistencia_escalamiento.test.ts`
→ **2 archivos, 31 pruebas, 0 fallos.**

La aritmética, con las constantes del repo (`TECHO_PASO_CONSULTA_MS = 8,000 +
1,500 = 9,500`, `TECHO_ENVIO_WHATSAPP_MS = 10,000`, `COLCHON_LATIDO_CRON_MS =
5,000`):

| | ms |
|---|---|
| Margen reservado (7 consultas + 2 envíos + colchón) | 91,500 |
| `venceEn` = 120,000 − 91,500 | **+28,500** |
| Peor caso REAL con 8 consultas (8×9,500 + 2×10,000) | 96,000 |
| `venceEn` + peor caso | **124,500 contra `maxDuration = 120,000`** |

**4.5 s por encima del hachazo de Vercel** — el mismo desbordamiento que
`f4fde69` existió para cerrar, y con el mismo desenlace que su propio comentario
describe: la función muere **después** del claim
(`reclamarEscalacionAsistencia` ya escribió `nivel_escalado = objetivo`), el
barrido siguiente filtra `.lt('nivel_escalado', NIVEL_MAXIMO)` y la emergencia
**sale del barrido para siempre**, sin `sendButtons`, sin `alertarOperador` y
sin fila de bitácora.

**Por qué las dos pruebas no lo ven.** `PEOR_CASO_ESCALADA_MS` es
`7 * TECHO_PASO_CONSULTA_MS + 2 * TECHO_ENVIO_WHATSAPP_MS` **escrito a mano en
la prueba**, contado en un comentario y no en el código. Las dos aserciones
comparan ese literal contra `margenUnidadAtomicaMs({ consultas: 7, envios: 2 })`
—el mismo par de números que usa producción—, así que lo que se prueba es
`7 ≡ 7`. Cambiar los números de producción sí muere (M3, 2 rojas); cambiar la
CADENA, no. Nada en el repo cuenta las consultas de `escalarUna`.

**Consecuencia.** Un nivel 4 (volcadura con lesionados, 20 min sin que nadie
reconozca) que se pierde del barrido nunca se reintenta: el dueño no recibe el
aviso y no queda una fila que diga que no lo recibió. El arreglo protege contra
que alguien *teclee* mal el margen, no contra que la cadena crezca — que es la
forma en que estos crecen.

**Causa raíz (una línea):** se ancló la aritmética del margen contra una cuenta
escrita a mano en la propia prueba, en vez de contra la cadena que la produce.

---

### [ALTO] `PRU-31C-A3` — NUEVO — la propiedad de seguridad de `8c0e7df` la sostiene un `grep` del fuente: `execFileSync('sh', ['-c', …])` reintroduce la inyección con **10/10 verdes**, y `correrGit` no lo ejecuta ninguna prueba

`scripts/ci/deriva-sin-desplegar.mjs:29` ·
`scripts/ci/deriva_sin_desplegar.test.ts:78-92` (las dos pruebas de `8c0e7df`)

**Escenario, con valores.**

```
- const correrGit = (args) => execFileSync('git', args, { encoding: 'utf8' });
+ const correrGit = (args) => execFileSync('sh', ['-c', `git ${args.join(' ')}`], { encoding: 'utf8' });
```

⇒ `npx vitest run scripts/ci/deriva_sin_desplegar.test.ts` → **1 archivo, 10
pruebas, 0 fallos.** El fuente sigue conteniendo `execFileSync` y sigue sin
contener `execSync(\``, que son las dos cosas que la prueba mira. Y el shell
está de vuelta: con `desplegado = 'a;rm -rf /'` —el valor que la prueba hermana
usa como ejemplo— la línea que corre es `sh -c "git log … a;rm -rf /..origin/master --"`,
o sea la clase `js/shell-command-injection-from-environment` que CodeQL marcó en
rojo en este PR. El revert literal (`execSync` con plantilla, M11) **sí** muere,
pero con **una sola** prueba roja y es la del `grep`.

**Por qué el arnés no alcanza.** La prueba que sí es de comportamiento —«los
refs viajan como ARGUMENTOS»— le pasa a `commitsSinDesplegar` un **doble** en el
tercer parámetro (`ejecutar`), así que comprueba el arreglo que el módulo
*construye* y nunca ejecuta `correrGit`, que es el único sitio donde se decide
si hay shell o no. `correrGit` es el valor por defecto de ese parámetro y
**ninguna prueba de la suite lo llama**. Agravante: `coverage.include` es
`['src/**/*.{ts,tsx}']` (`vitest.config.ts:60`), así que este `.mjs` tampoco
entra en el denominador de la puerta — ni la cobertura ni la mutación lo tocan.

**Consecuencia.** El detector corre en `salud-produccion.yml` con `$version`
salido de un `curl` a `/api/health`: entrada externa ejecutándose en un runner
con el checkout del repo. La única barrera contra que vuelva a ser una cadena
para el shell es que nadie escriba `sh -c`, y eso no es una prueba, es una
costumbre.

**Causa raíz (una línea):** se afirmó la FORMA del fuente (que aparezca
`execFileSync`) en vez del EFECTO (que ningún argumento llegue a un intérprete
de shell), y el único camino que produce el efecto no se ejecuta nunca.

---

### [MEDIO] `PRU-31C-M1` — CONFIRMADO (lo dijo `operabilidad-continuacion.md`, OP-31C-M2): el detector de deriva muere al destripar `resumirDeriva` y sobrevive a **tres** mutaciones del cableado

`scripts/ci/deriva_sin_desplegar.test.ts:104-123` (la versión de `939c111`) ·
`.github/workflows/salud-produccion.yml:172-179`

**Lo mido y lo confirmo, mutación por mutación.**

| Mutación | Resultado |
|---|---|
| `resumirDeriva`: `if (commits.length === 0)` → `if (true)` (nunca hay deriva) | **muere** — 2 rojas / 10 |
| `salud-produccion.yml:179`: argumentos invertidos → `deriva-sin-desplegar.mjs origin/master "$version"` | **sobrevive** — 10/10 |
| `salud-produccion.yml:173`: el paso entero con `if: false` | **sobrevive** — 10/10 |
| `deriva-sin-desplegar.mjs:29`: `sh -c` (PRU-31C-A3) | **sobrevive** — 10/10 |

La primera del cableado es la peor de las tres porque es **silenciosa y
plausible**: con los argumentos invertidos el rango que se le pide a git es
`origin/master..$version`, que con producción atrás de master está **vacío**, así
que el detector imprime «Producción corre todo el código de master: no hay
deriva» en cada corrida. Es exactamente el verde-mentiroso de siete pulsos que
`30e5e14` se escribió para terminar, con el detector instalado y verde.

**Por qué las tres pruebas de `describe('salud-produccion.yml — cableado')` no
lo ven.** Las tres son `toContain` de cadenas sueltas sobre el YAML leído como
texto: `'deriva-sin-desplegar.mjs'`, `'ultimo-deploy-en-asunto.mjs'` y
`'git merge-base --is-ancestor'`, más un `not.toContain('exit 1')` acotado al
paso. Ninguna mira los **argumentos**, ni el `if:`, ni que el `::warning::` salga
por algún canal.

**Consecuencia.** El aviso que existe para que «no desplegué» sea una decisión y
no un descubrimiento puede quedar apagado o mudo sin que nada se ponga rojo —
sobre la misma clase de commit (`cuadre/desde_db.ts`, el cubo del 15 %) que ya
se quedó tres días sin publicar.

**Causa raíz (una línea):** el cableado se afirma por presencia de un nombre de
archivo en un YAML, que es lo único que un `toContain` sobre texto puede decir.

**Re-medido contra la versión EN VUELO, y aguanta.** Mientras yo medía, otro
agente dejó sin commitear una reescritura de `deriva_sin_desplegar.test.ts` (de
123 a 224 líneas, con `publicarDeriva`, `pasoDe()` por bloques del YAML y la
exigencia de `id: deriva` y del paso que abre issue). Copié esos tres archivos
al worktree —línea base **17/17 verdes**— y repetí las tres mutaciones:

| Mutación, contra la versión en vuelo | Resultado |
|---|---|
| `correrGit` con `sh -c` | **sobrevive** — 17/17 |
| argumentos invertidos en `salud-produccion.yml` | **sobrevive** — 17/17 |
| el paso del detector con `if: false` | **sobrevive** — 17/17 |

O sea que el arreglo de `OP-31C-A1` añade cableado y aserciones por paso, y las
tres siguen sin tener quien las muerda. `PRU-31C-A3` y `PRU-31C-M1` valen para
las dos versiones.

---

### [MEDIO] `PRU-31C-M2` — NUEVO — la «frontera de etiqueta» de `939c111` distingue la cifra de un `className`, pero no **cuál** de los dos `<span>` la imprimió

`src/app/dashboard/agentes/peajes/acuse-corte.test.tsx:63` (`const cifra = (n) => \`>${n}<\``)
y `:83-90` · `src/app/dashboard/agentes/peajes/controles.tsx:86` y `:88`

**Escenario, con valores.** El caso «corte a medias» de la prueba es
`{ revisadas: 3, conciliadas: 1, candidatosRefrescados: 1, siguenPendientes: 2,
cortadosPorReloj: 997 }`, y afirma `>3<` y `>997<`. Intercambio las dos cifras
del acuse:

```
- Revisé <span …>{r.revisadas}</span> … amarré <span …>{r.conciliadas}</span> contra
+ Revisé <span …>{r.conciliadas}</span> … amarré <span …>{r.revisadas}</span> contra
```

⇒ la pantalla dice «Revisé **1** línea pendiente; amarré **3** contra gastos
nuevos» sobre un barrido que revisó 3 y amarró 1 — y `npx vitest run
src/app/dashboard/agentes/peajes/` da **3 archivos, 8 pruebas, 0 fallos**,
porque el `3` sigue apareciendo en la página, solo que en el otro `<span>`.

**Lo que esto dice del commit.** `939c111` se tituló «se afirma con fronteras de
etiqueta, no con texto pelado» y el cambio es real —`>3<` ya no casa con el `3`
de un `text-[12px]`—, pero el defecto que lo motivaba es el de `PRU-M1`: un
`toContain` de un número suelto no distingue **cuál sitio de la pantalla lo
imprimió**. La frontera de etiqueta sube un escalón y deja el mismo hueco. El
caso tampoco afirma `conciliadas`, `candidatosRefrescados` ni `siguenPendientes`:
tres de las cinco cifras del acuse no tienen aserción.

**Consecuencia.** El acuse del «Ejecutar ahora» es el único sitio donde el
contador se entera de cuántas conciliaciones fiscales se escribieron. «Amarré 3»
cuando fueron 1 es la cifra inventada que la regla del producto prohíbe, y el
arreglo que se hizo para que el acuse no mintiera no la ataja.

**Causa raíz (una línea):** se endureció la frontera del token y no la
identidad del campo; hace falta afirmar la frase, no el número.

---

### [MEDIO] `PRU-31C-M3` — NUEVO — la guardia de `acotada()` de `f4fde69` es un `grep` de `await supabaseAdmin()`: hoistear la consulta a una variable la deja sin techo con **31/31 verdes**

`src/lib/likida/asistencia_escalamiento.ts:309` ·
`src/lib/likida/asistencia_escalamiento.test.ts:365-385`

**Escenario, con valores.**

```
- const { data: v } = await acotada(supabaseAdmin().from('viaje').select('operador_id')
-   .eq('id', inc.viajeId).eq('tenant_id', inc.tenantId).maybeSingle(), 'asistencia.operador_del_viaje');
+ const cons = supabaseAdmin().from('viaje').select('operador_id')
+   .eq('id', inc.viajeId).eq('tenant_id', inc.tenantId).maybeSingle();
+ const { data: v } = await cons;
```

⇒ **2 archivos, 31 pruebas, 0 fallos.** La consulta vuelve a heredar los 300 s
de undici —el supuesto falso que el commit dice haber quitado— y la prueba sigue
verde porque cuenta ocurrencias de la cadena literal `await supabaseAdmin()`,
que ya no aparece. El revert **literal** (M5b) sí muere, con 1 roja.

**Contraste medido en el mismo archivo:** la segunda prueba del bloque («y hay
consultas acotadas de verdad que contar») existe precisamente para que el
contador no vigile cero — y no ayuda aquí, porque sigue habiendo otras llamadas
`acotada(supabaseAdmin()` en el archivo.

**Consecuencia.** La misma de `PRU-31C-A2`: una consulta colgada después del
claim se come los 120 s, la incidencia sale del barrido y la emergencia con
lesionados no se reintenta nunca.

**Causa raíz (una línea):** la guardia mide una cadena de texto del fuente y no
la propiedad (que ninguna promesa de supabase se espere sin techo), y una
variable intermedia la rodea sin cambiar nada del comportamiento.

---

### Reincidentes sin cambio de código (verificados por identidad y por conteo)

`git diff --stat 0f5ca48..HEAD` toca **12 archivos**, todos los de los seis
commits. Ninguno de los que sostienen los hallazgos de abajo se movió, así que
las mediciones de `pruebas.md` se transcriben **sin volver a mutar** —y lo digo
en vez de fingir que las repetí—, salvo donde hay un conteo nuevo:

- **`PRU-M2`** (MEDIO, reincidente) — **recontado hoy** contra la API de
  Actions, las 100 últimas corridas `push` de `ci.yml` sobre `master`:
  **51 `success` · 46 `cancelled` · 3 `failure`**, cifra por cifra la de la
  ronda pasada (master no se ha movido). `5ce91b2` —el merge de la auditoría
  30— sigue siendo `cancelled`.
  **Dato nuevo de esta rama:** `ci.yml` tiene **4** corridas `push` sobre
  `claude/auditoria-31`, las 4 en `success`, para **8** commits. Los cinco
  commits intermedios (`fd66be6`, `f4fde69`, `54bddb2`, `30e5e14`, `065f699`)
  entraron en un push en lote y **no tienen corrida propia**: el árbol quedó
  verificado en el `tip`, pero un `git bisect` sobre esta rama no encuentra
  veredicto en ninguno de los cinco.
- **`PRU-31-M5`** (MEDIO, reincidente) — **recontado hoy**: **29 de 53** arneses
  de `supabase/tests/` no aparecen en `.github/workflows/ci-postgres.yml`.
  Idéntico.
- **`PRU-M1`** (MEDIO, 5.ª ronda) — **recontado hoy**: `toContain('<2-6
  dígitos>')` sobre `src/**/*.test.ts*` → **81** aserciones, la misma cifra.
  `PRU-31C-M2` es su versión con etiquetas.
- **`PRU-31-A4`** (ALTO) — `repo.ts` no está en el diff de la rama:
  `getSnapshotCierreLiquidacion` sigue existiendo solo mockeado.
- **`PRU-A1`**, **`PRU-A2`**, **`PRU-A3`** (ALTO) — `perfil/preguntas.ts`,
  `perfil/entrevista.ts` y `processor.ts` no están en el diff.
- **`PRU-M3`** (MEDIO) y **`PRU-B1`** (BAJO) — sus archivos tampoco.
- **`PRU-31-C2`** (CRÍTICO) — **CERRADO**, verificado por mutación (M1).

---

## Lo que revisé y está bien

- **`PRU-31-C2` cierra, y el ancla nueva está bien construida.** No solo muere
  la mutación de la constante: el bloque afirma el default de `DEMO_CONFIG`, la
  forma exacta de `getConfig()` (`fusionarConfig(DEMO_CONFIG, {})` y `…, null`),
  las dos fronteras ($2,000.00 pasa, $2,000.01 no) **con los `estimulos` que
  manda el camino real**, y la banda completa de $2,500 a $19,999. Es el patrón
  que el resto del rubro necesita: se ancló el valor **y** la conducta, en el
  camino que producción toma.
- **El motor del reloj del barrido está anclado en las dos direcciones.**
  Borrar el corte (M6) tira 2; hacer que `cortadosPorReloj` cuente la cola
  entera en vez de la cola menos lo revisado (M7) tira 1. La prueba «corta A
  MEDIAS» es de las pocas de la rama que afirma **las dos mitades de una
  partición**, que es lo que impide el rótulo falso.
- **`065f699` reproduce su bug de verdad.** Devolver la guarda a
  `r.revisadas === 0` —el estado que dejaba «No había nada pendiente que barrer»
  sobre 1,000 líneas cortadas— pone 1 roja. Es el arreglo de una regresión
  propia de esta rama y sí quedó anclado.
- **El margen derivado sí está atado a las constantes.** Bajar
  `{ consultas: 7, envios: 2 }` a `{ consultas: 1, envios: 0 }` (M3) o volver al
  literal `15` (M2) ponen 2 rojas cada uno. Lo que falta es el otro extremo (la
  cadena), no este.
- **Cero intermitencia detectada en las seis pruebas nuevas.** Las corrí 3 veces
  seguidas: 6 archivos / 67 pruebas / 0 fallos las tres. La única con dependencia
  real del reloj es `consolidado_barrido.test.ts:296-313`, que mockea `Date.now`
  **por número de llamada**; si alguien añade un `Date.now()` antes del bucle el
  caso cambia de significado — pero **falla ruidosamente**, no en verde, así que
  no es un flake silencioso. `route.test.ts:141-152` deja 5 s
  (`COLCHON_LATIDO_CRON_MS`) de holgura de reloj de pared sobre un `GET`
  enteramente mockeado: margen amplio, no lo cuento como intermitente.
- **La compuerta de CI sigue completa y corriendo.** `ci.yml:75`
  (`npm run test:coverage`, con el umbral 86/83/73/86), `:82` (las dos pruebas
  de tiempo que `--coverage` salta) y `:88` (el build). Corre en cada push a
  cualquier rama (`:21-24`). El problema no es que la puerta no exista.
- **Los seis archivos nuevos entran en la suite normal** — ninguno lleva
  `skipIf(LIKIDA_COBERTURA)`, así que ninguno se pierde en el paso de cobertura.
- **Inventario contado hoy:** 986 `*.test.ts*` en `src scripts supabase`.

---

## Lo que NO alcancé a revisar

- **Ni un `psql`, séptima ronda seguida.** No hay Postgres en el contenedor:
  todo lo que digo de `supabase/tests/*.sql` y de `verificaciones.sql` es
  lectura estructural y conteo de invocaciones, **cero mutaciones de SQL**.
  Sigue siendo el hueco más grande del rubro.
- **No abrí los 29 arneses huérfanos** uno por uno; los conté contra el
  workflow, como en la ronda pasada.
- **No corrí `--coverage`.** Lo que medí de primera mano es qué queda fuera del
  denominador: `src/app/**/*.tsx` (`vitest.config.ts:104`) y, nuevo de esta
  ronda, **todo `scripts/`**, porque `coverage.include` es
  `['src/**/*.{ts,tsx}']` (`:60`) — el detector de deriva de `30e5e14`/`8c0e7df`
  no está en el denominador de la puerta.
- **No re-muté los siete reincidentes cuyo código no cambió** (`PRU-31-A4`,
  `PRU-A1/A2/A3`, `PRU-M3`, `PRU-B1`). El diff de la rama demuestra que sus
  archivos están intactos; las mediciones son las de `pruebas.md`, transcritas,
  no repetidas.
- **18 mutaciones no son la suite.** Esta ronda fue deliberadamente estrecha:
  las seis pruebas nuevas más dos controles de pantalla. Quedaron sin atacar
  `intake/ocr`, `carta_porte_xml`, los agentes, el timbrado y casi todo
  `src/app/api/` (empecé a mirar `api/v1/_escritura.ts`, que escribe
  `ingreso_flete`, `anticipo` y `km_recorridos`, y no alcancé a mutarlo: queda
  anotado como la zona de **escritura de dinero** sin medir).
- **No toqué la Capa 0** (`wa_leases_fencing.sql`, pgTAP), ni
  `playwright-smoke`, ni `e2e-navegador.yml`: novena ronda fuera por falta de
  `pg_prove` y navegador.
- **No revisé `pruebas-manuales/`** (prohibido correrlas) más allá de confirmar
  que siguen fuera del `include` de vitest.

---

## Estado del árbol al entregar

Salida literal de `git status --short` en `/home/user/cuadra`:

```
 M .github/workflows/salud-produccion.yml
 M docs/auditoria-31/progreso.md
 M scripts/ci/deriva-sin-desplegar.mjs
 M scripts/ci/deriva_sin_desplegar.test.ts
```

**Esos cuatro NO son míos y los dejé intactos a propósito.** Son el arreglo en
vuelo de `OP-31C-A1` (el canal del aviso de deriva: `id: deriva`, el paso que
abre issue, `publicarDeriva`) que otro agente estaba escribiendo mientras yo
medía; revertirlos habría borrado su trabajo. Lo verifiqué: `git worktree list`
deja **una sola entrada** (`/home/user/cuadra 939c111`), y `git diff` sobre esos
cuatro archivos no contiene ninguna de mis mutaciones.

**Yo no toqué un solo archivo del árbol principal.** Las 18 mutaciones vivieron
y murieron dentro del worktree desechable
(`<scratchpad>/wt-pru`), que quedó con `git status --porcelain` vacío, se
re-verificó contra su línea base (4 archivos / 18 pruebas / 0 fallos) y se borró
con `git worktree remove --force`.

Mi único archivo escrito es **`docs/auditoria-31/pruebas-continuacion-2.md`**, y
no aparece arriba porque `.gitignore:36` ignora `docs/auditoria-*/` (los
archivos de auditoría se añaden con `git add -f`). Confirmado con
`git check-ignore -v`.
