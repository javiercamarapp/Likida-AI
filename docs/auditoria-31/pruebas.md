# Pruebas — auditoría 31

**Nota: 6/10** (antes 6). Razón del movimiento: **no se mueve, y la razón es
que dos fuerzas contrarias se cancelan y las dos son medibles.** El árbol es
línea por línea el mismo que calificó la 30 (los dos commits de la ventana
tocan `normas/.latido-*` y nada más), así que no hay «se atacó y subió» ni
«deuda que cobró factura» por código. Lo que sí hay es **mirada más profunda en
las dos direcciones**: el **motor de cuadre** —que la 30 nunca muteó— resultó
estar anclado de verdad (**20 de 23 mutaciones mueren, 87 %**), y eso sostiene
el 6; y al mismo tiempo encontré **por qué** la campaña de cobertura de la 30 no
podía cerrar PRU-C1 aunque lo intentara: **`vitest.config.ts:104` excluye
`src/app/**/*.tsx` entero de la puerta de cobertura** —296 archivos, 58,201
líneas, **196 sitios donde se imprime una cifra de dinero**— mientras 99
archivos de prueba corren sobre ellos sin contar para el umbral. El 6 se queda
porque la definición del ancla lo describe exacto: «la suite es grande y verde
pero hay zonas de dinero sin arnés».

**Riesgo mayor del rubro, hoy:** el arnés protege **dónde se calcula** el dinero
y no **dónde se imprime**. De 12 mutaciones nuevas que cambian la cifra de pesos
que una pantalla enseña —seis de páginas que la 30 nunca tocó, entre ellas
`/dashboard/[id]`, la pantalla exacta que el contralor abre para cruzar contra
su PDF— **no muere ninguna**, con 12,934 pruebas en verde. Y hay un caso peor
que la pantalla: el **tope de efectivo de LISR 27-III que de verdad llega al
motor** (`config.ts:129`) se puede subir de $2,000 a $20,000 y pasan 10,177
pruebas, porque el ancla que la auditoría 24 escribió vigila la constante de la
rama que producción nunca toma.

---

## Cómo se midió (repetible)

- **Worktree desechable** `git worktree add --detach <scratchpad>/wt-pru HEAD`
  sobre `4047a50`, `node_modules` por symlink. **Borrado al terminar**
  (`git worktree list` → una sola entrada) y `git status --porcelain` vacío.
- **45 mutaciones dirigidas**, cada una revertida con `git checkout --`
  inmediatamente después de su corrida. Las que sobrevivieron un alcance corto
  se re-corrieron contra el alcance grande (`src/lib/` = 701 arch. / 10,177
  pruebas, `src/lib/likida/` = 518 / 7,937, `src/app/dashboard/` = 93 / 608,
  `src/app/admin/` = 58 / 390) para no confundir «no la cubre este archivo» con
  «no la cubre nadie».
- **Línea base propia, corrida entera:** `npx vitest run` → **984 archivos,
  12,934 pruebas verdes, 6 saltadas, 0 fallos** (141.8 s).
- **Intermitencia por huso, medida y no razonada:** la suite completa corrida
  además con `TZ=Pacific/Kiritimati` (UTC+14) y `TZ=Pacific/Midway` (UTC−11) →
  **984 / 12,934 / 0 fallos en las tres**. Cero deriva por reloj.
- **Inventario contado hoy:** 982 `*.test.ts*` en `src scripts`; 984 con
  `supabase/`. `supabase/tests/` → 53 archivos.
- **Evidencia de CI leída de las corridas reales**, no del YAML: las **100**
  últimas corridas `push` de `ci.yml` sobre `master` vía la API de Actions.
- **NO corrí** `pruebas-manuales/*.prueba.ts` ni `npm run build`.

---

## La medición de esta ronda

### **24 de 45 mutaciones mueren (53 %).** Antes: 14 de 34 (41 %).

**El 53 % NO es una mejora: es un muestreo distinto.** Subió porque esta vez
muté el motor de cuadre y la capa de cálculo, que la 30 nunca tocó y que sí
están ancladas. Sobre la **clase comparable** —la cifra de dinero que una
pantalla imprime— el número es **idéntico: 0 de 12 esta ronda, 0 de 11 la
anterior.**

| Zona | Mueren | Total | % |
|---|---|---|---|
| **Motor de cuadre + cálculo del dinero** (nueva) | **20** | 23 | **87 %** |
| El argumento de una **escritura** | 4 | 6 | 67 % |
| **La cifra de dinero que la pantalla imprime** | **0** | **12** | **0 %** |
| **Hallazgos abiertos de la 30 (PRU-A1/A2/A3)** | **0** | 4 | **0 %** |

Detalle, mutación por mutación:

| # | Archivo mutado : línea | Qué cambié | Alcance corrido | ¿Murió? |
|---|---|---|---|---|
| **Zona 1 — reincidentes de la 30 (12, ninguna muere)** |
| R1 | `lib/likida/perfil/preguntas.ts:362` | `['624','612']` → `['624','612','626']` | 518 / 7,937 | **no** |
| R2 | `lib/likida/perfil/entrevista.ts:713` | `v==='612'\|\|v==='624'` → `… \|\| v==='626'` | 701 / 10,177 | **no** |
| R3 | `lib/likida/processor.ts:352` | `if (operadorId)` → `if (false)` | 518 / 7,937 | **no** |
| R4 | `lib/likida/perfil/preguntas.ts:400` | `regimenElegible: f15.…===true` → `: true` | 518 / 7,937 | **no** |
| R5 | `app/dashboard/clientes/vista.tsx:110` | `valor={panel.ingresoTotal}` → `={0}` | 93 / 608 | **no** |
| R6 | `app/dashboard/suscripcion/page.tsx:345` | `mxn(planActual.precioMensual)` → `mxn(0)` | 93 / 608 | **no** |
| R7 | `app/admin/consumo/page.tsx:184` | `usd(f.costoIaUsd)` → `usd(0)` | 58 / 390 | **no** |
| R8 | `app/admin/ejecutivo/page.tsx:44` | `valor={mrr.totalMxn === null ? null : mrr.totalMxn*10}` | 1 / 7 | **no** |
| R9 | `app/admin/costos-facturacion/page.tsx:125` | `mxn(r.monto)` ↔ `mxn(r.subtotal)` | 1 / 9 | **no** |
| R10 | `app/dashboard/despacho/vista.tsx:232` | `{numero(activos.total ?? 0)}` → `0` | 3 / 19 | **no** |
| R11 | `app/dashboard/emergencias/page.tsx:181` | tenant desde el `FormData` | 1 / 14 | **no** |
| R12 | `app/dashboard/conversaciones/page.tsx:49` | tenant desde `searchParams` | 1 / 12 | **no** |
| **Zona 2 — anclas que la 30 declaró vivas, re-verificadas (4, mueren las 4)** |
| R13 | `app/admin/flotas/page.tsx:97` | `actualizarFacilidad15(id, ded, reg…)` → `(id, reg, ded…)` | 1 / 10 | **sí** |
| R14 | `app/dashboard/llaves-api/page.tsx:98` | tenant desde el `FormData` | 1 / 15 | **sí** |
| R15 | `app/admin/compliance/page.tsx:57` | `sol.tenant_id` → `'t-CUALQUIERA'` | 1 / 7 | **sí** |
| R16 | `app/dashboard/suscripcion/page.tsx:168` | `p.stripePriceId` → `'price_OTRO'` | 1 / 13 | **sí** |
| **Zona 3 — motor de cuadre (NUEVA; 7, mueren 6)** |
| R17 | `cuadre/engine.ts:1253` | `anticipo − comprobado` → `comprobado − anticipo` | 53 / 574 | **sí** (2) |
| R18 | `cuadre/engine.ts:679` | `totalComprobado` deja de excluir duplicados | 53 / 574 | **sí** (7) |
| R19 | `cuadre/engine.ts:1663` | proporción del IVA acreditable → `1` | 53 / 574 | **sí** (6) |
| R20 | `cuadre/engine.ts:1835` | proporción del deducible → `1` | 53 / 574 | **sí** (15) |
| R21 | `cuadre/engine.ts:1625` | `estimulos?.peajeFactor ?? 0.5` → `?? 1.0` | 701 / 10,177 | **no** (rama muerta, ver C2) |
| R30 | `marketing/calculadora.ts:58` | `DIAS_VIGENCIA_CUOTA = 14` → `140` | 701 / 10,177 | **sí** |
| R31 | `marketing/calculadora.ts:170` | `litrosMes × cuota` → `× cuota × 2` | 701 / 10,177 | **sí** |
| **Zona 4 — defaults fiscales de `config.ts` (NUEVA; 3, mueren 2)** |
| R24 | `lib/likida/config.ts:127` | `peajeFactor: 0.5` → `1.0` | 701 / 10,177 | **sí** (2) |
| R25 | `lib/likida/config.ts:128` | `viaticosTopeFiscalDiarioMxn: 750` → `7500` | 701 / 10,177 | **sí** |
| R26 | `lib/likida/config.ts:129` | `efectivoTopeMxn: 2000` → `20000` | 701 / 10,177 | **no** |
| **Zona 5 — el PDF que se entrega (NUEVA; 3, mueren 3)** |
| R27 | `liquidacion/pdf.ts:350` | `Total comprobado` imprime el anticipo | 518 / 7,937 | **sí** (3) |
| R28 | `liquidacion/pdf.ts:391` | la diferencia se imprime como `mxn(0)` | 518 / 7,937 | **sí** (2) |
| R29 | `liquidacion/pdf.ts:314` | el monto de cada gasto → `mxn(0)` | 518 / 7,937 | **sí** |
| **Zona 6 — dinero del SaaS y agregados (NUEVA; 7, mueren 7)** |
| R32 | `lib/saas/iva.ts:101` | `TASA_IVA = 0.16` → `0.08` | 701 / 10,177 | **sí** (4) |
| R33 | `lib/saas/iva.ts:~102` | `criterio === true` → `=== false` (IVA del otro lado) | 701 / 10,177 | **sí** (7) |
| R34 | `lib/admin/negocio.ts:1059` | el MRR deja de declararse no medible | 701 / 10,177 | **sí** |
| R35 | `lib/likida/facturacion_escritura.ts:161` | `subtotal+iva−retención` → `+retención` | 701 / 10,177 | **sí** |
| R36 | `lib/likida/facturacion_escritura.ts:258` | `total−pagado` → `total+pagado` | 701 / 10,177 | **sí** (3) |
| R37 | `lib/likida/comercial.ts:178` | `ingresoTotal` → `0` | 701 / 10,177 | **sí** (3) |
| R38 | `lib/likida/comercial.ts:182` | concentración sobre `filas.at(-1)` | 701 / 10,177 | **sí** (3) |
| **Zona 7 — la cifra impresa, páginas que la 30 NO muestreó (NUEVA; 6, ninguna muere)** |
| R39 | `app/dashboard/facturacion/vista.tsx:258` | `mxn(c.porCobrar)` → `mxn(c.cobrado)` | 93 / 608 | **no** |
| R40 | `app/dashboard/facturacion/vista.tsx:301` | `mxn(c.saldo)` → `mxn(c.facturado)` | 93 / 608 | **no** |
| R41 | `app/dashboard/facturacion/page.tsx:130` | `mxn(valores.total)` → `mxn(0)` | 93 / 608 | **no** |
| R42 | `app/dashboard/[id]/detalle.tsx:242` | KPI «Anticipo» imprime `d.totalComprobado` | 93 / 608 | **no** |
| R43 | `app/dashboard/viajes/vista.tsx:212` | la columna Anticipo imprime `v.comprobado` | 93 / 608 | **no** |
| R44 | `app/dashboard/agentes/peajes/vista.tsx:330` | `mxn(peajeAcreditable)` → `mxn(0)` | 93 / 608 | **no** |
| **Zona 8 — escritura y lectura del dinero cerrado (NUEVA; 3, mueren 2)** |
| R45 | `lib/likida/repo.ts:1206-1207` | `p_total_comprobado` ↔ `p_total_anticipo` | 701 / 10,177 | **sí** |
| R46 | `lib/likida/repo.ts:1208` | `p_diferencia: liq.diferencia` → `0` | 701 / 10,177 | **sí** |
| R47 | `lib/likida/repo.ts:1172` | `total_comprobado` → `total_anticipo` al leer | 701 / 10,177 | **no** |

**Una nota de método sobre R8.** La mutación ingenua de la 30
(`valor={mrr.totalMxn * 10}`) **sí** pone una prueba en rojo hoy — pero por la
razón equivocada: `null * 10 = 0`, así que lo que se rompe es el caso «MRR null
se declara, no se ve como $0». Preservando el `null`
(`mrr.totalMxn === null ? null : mrr.totalMxn * 10`) el MRR ×10 vuelve a pasar
en verde. Si no se separan las dos, la 32 va a leer un falso arreglo.

---

## Hallazgos

### [CRÍTICO] `PRU-C1` — REINCIDENTE (3.ª ronda) — la cifra de dinero que la pantalla imprime sigue en 0 de 12, y ahora se sabe por qué la campaña no podía cerrarlo: la puerta de cobertura excluye la capa entera

`vitest.config.ts:104` (`'src/app/**/*.tsx'` en `coverage.exclude`) ·
`src/app/dashboard/[id]/detalle.tsx:242` ·
`src/app/dashboard/facturacion/vista.tsx:258` y `:301` ·
`src/app/dashboard/facturacion/page.tsx:130` ·
`src/app/dashboard/viajes/vista.tsx:212` ·
`src/app/dashboard/agentes/peajes/vista.tsx:330`
(+ los seis sitios de la 30, verificados intactos)

**Escenario, con valores, el peor de los seis nuevos.** `detalle.tsx:242` es la
pantalla de UNA liquidación —la que el contralor abre para cruzar contra el PDF
que le llegó—. Cambio:

```
- <Kpi titulo="Anticipo" valor={mxn(d.totalAnticipo)} nota="entregado al operador" />
+ <Kpi titulo="Anticipo" valor={mxn(d.totalComprobado)} nota="entregado al operador" />
```

⇒ `npx vitest run src/app/dashboard/` → **93 archivos, 608 pruebas, 0 fallos.**
Con un anticipo de $10,000 y un comprobado de $8,200, la pantalla enseña
«Anticipo $8,200.00 · Comprobado $8,200.00», el operador queda a mano, y el PDF
archivado del mismo cierre dice que sobraron $1,800. Las otras cinco son del
mismo molde: `facturacion/vista.tsx:258` imprime lo cobrado bajo el rótulo «Por
cobrar» (93 / 608, 0 fallos) y `:301` imprime lo facturado bajo «Saldo» (93 /
608, 0 fallos) — las dos columnas contiguas de la cartera, intercambiables sin
un solo rojo.

**Lo nuevo, y es la causa raíz medible.** `vitest.config.ts:104` saca
`src/app/**/*.tsx` de `coverage.exclude`, o sea de la puerta que `ci.yml:75`
llama «el umbral que convierte la cobertura en una puerta». Contado hoy:

| | Cuenta |
|---|---|
| `.tsx` de producción bajo `src/app` | **296** |
| Líneas que contienen | **58,201** |
| Sitios que llaman `mxn(`/`usd(`/`mxnCompacto(`/`usd4(` | **196** |
| Archivos `*.test.tsx` que corren sobre ellos | **99** (76 renderizan) |
| Cuánto de eso ve el trinquete de `lines: 86 / branches: 73` | **0 %** |

El comentario que justifica la exclusión (`vitest.config.ts:77-79`) dice: «*No
hay una sola prueba de nodo sobre ellas y no la va a haber*». Se escribió el
14-ago-2026. La campaña de la 30 (10-sep) escribió exactamente esas pruebas —99
archivos, 76 con `renderToStaticMarkup`— y la línea 104 sigue igual: el lote
entró y **el porcentaje no se podía mover ni un punto**, ni podrá bajar nunca
cuando esta capa se degrade.

**Consecuencia.** La regla que define el producto es «nunca inventar una cifra».
Hoy hay 984 archivos de prueba y 12,934 pruebas, y ninguna se pone roja si una
de las 196 cifras de dinero de la pantalla sale cambiada, borrada o
intercambiada con la de al lado. El contralor cruza el panel contra su PDF: dos
columnas de cartera invertidas, o un anticipo que se lee igual que el
comprobado, es el error que cuesta el trato.

**Causa raíz (una línea):** la puerta mide la capa donde el dinero se *calcula*
y excluye por configuración la capa donde el dinero se *imprime*, así que
escribir pruebas ahí no produce señal y no escribirlas no produce alarma.

---

### [CRÍTICO] `PRU-31-C2` — NUEVO — el tope de efectivo de LISR 27-III que de verdad llega al motor no tiene ancla: `2000 → 20000` pasa 10,177 pruebas, y la prueba que dice anclarlo vigila la rama que producción nunca toma

`src/lib/likida/config.ts:129` (`efectivoTopeMxn: 2000`) ·
`src/lib/likida/cuadre/engine.ts:754` (`?? TOPE_EFECTIVO_LISR_27_III`) ·
`src/lib/likida/cuadre/tope_efectivo_default.test.ts:15-53` (el ancla que no
alcanza) · `src/lib/likida/cuadre/desde_db.ts:215` · `src/lib/likida/fiscal.ts:586`

**Escenario, con valores.** En `config.ts:129` cambio `efectivoTopeMxn: 2000`
por `20000` ⇒ `npx vitest run src/lib/` → **701 archivos, 10,177 pruebas, 1
saltada, 0 fallos.** Un comprobante de hospedaje de **$5,000 pagado en
efectivo** deja de levantar `efectivo_sobre_tope`, se queda en la cubeta
deducible, entra al PDF como deducible y suma al agregado fiscal del panel.

**Por qué el ancla existente no lo ve, y esto es lo que lo vuelve CRÍTICO.**
La auditoría 24 (PRU-2) escribió `tope_efectivo_default.test.ts` justamente para
esto, y el archivo lo dice en su cabecera: «*`?? 2000` → `?? 20000` pasaba 10,001
pruebas en verde*». Pero ancló la constante **de la otra rama**: la prueba llama
`cuadrarViaje` **sin `estimulos`** (`:27`, el parámetro es opcional) y por eso
cae en `engine.ts:754 … ?? TOPE_EFECTIVO_LISR_27_III`. El camino real nunca pasa
por ahí: `desde_db.ts:215` pasa `estimulos: config.estimulos` **siempre**, y
`config` sale de `getConfig()` → `fusionarConfig(DEMO_CONFIG, override)`, o sea
del `2000` de `config.ts:129`. La misma cifra viaja al agregado SQL por
`fiscal.ts:586` → `p_tope_efectivo`. Lo confirma la asimetría de la medición:
sus dos vecinos de línea **sí** mueren —`peajeFactor` (R24, lo ata
`config_merge.test.ts:32`) y `viaticosTopeFiscalDiarioMxn` (R25, lo ata
`arnes_ticket_real.test.ts`)—; `efectivoTopeMxn` es el único de los tres sin una
aserción sobre su valor en `DEMO_CONFIG`.

**Intenté refutarlo.** Busqué el guardarraíl en `tope_efectivo_default_aud24.test.ts`
(pasa `efectivoTopeMxn: 5000` explícito), en `config_merge.test.ts:29-32` (usa un
`base` local, no `DEMO_CONFIG`, y afirma los dos hermanos, no éste) y en
`arnes_ticket_real.test.ts` (su único caso en efectivo es el diésel, que lo ataja
antes la capa de `combustible_efectivo` y por eso no ejerce la frontera). No hay
tercero.

**Consecuencia.** Es la regla más citada del producto: LISR 27-III, «los pagos
cuyo monto exceda de $2,000.00». Con el tope movido, la banda de $2,000–$20,000
en efectivo —diésel sin monedero, casetas, hospedaje de carretera, donde vive el
grueso de los comprobantes de una flota— se declara deducible y el contralor la
deduce con el papel de Likida en la mano. Lo descubre el SAT, no la suite.

**Causa raíz (una línea):** el valor vive en dos sitios (la constante nombrada y
el default de `DEMO_CONFIG`) y el ancla histórica se colgó del que producción no
usa.

---

### [ALTO] `PRU-31-A4` — NUEVO — `getSnapshotCierreLiquidacion` solo existe mockeado: su mapeo columna→campo puede intercambiar comprobado y anticipo con las 10,177 pruebas verdes

`src/lib/likida/repo.ts:1172` ·
`src/lib/likida/processor_cierre_recuperado_snapshot.test.ts:67-74` y `:170-174` ·
`src/lib/likida/processor_cierre_parcial.test.ts:110`

**Escenario, con valores.** En `repo.ts:1172`:

```
-    totalComprobado: Number(f.total_comprobado ?? 0),
+    totalComprobado: Number(f.total_anticipo ?? 0),
```

⇒ `npx vitest run src/lib/` → **701 archivos, 10,177 pruebas, 0 fallos.** Una
liquidación cerrada con anticipo $10,000 y comprobado $8,200 hace que el WhatsApp
del cierre recuperado narre «comprobado $10,000, diferencia $0» mientras el PDF
archivado del MISMO cierre dice $8,200 y $1,800 de sobrante.

**Por qué la suite no lo ve.** Los dos únicos archivos que nombran la función la
**mockean**: `processor_cierre_recuperado_snapshot.test.ts:67` la declara como
`vi.fn()` y `:170` le pone a mano
`{ totalComprobado: 8000, totalAnticipo: 8000, diferencia: 0, … }`. El cuerpo real
—el `select` de las siete columnas y su mapeo a los siete campos— no se ejecuta
nunca. Agravante de forma: los tres números del mock son **8000, 8000 y 0**, así
que incluso un intercambio dentro del propio mock sería invisible. Y el
encabezado de la función (`repo.ts:1140-1142`) declara que existe precisamente
porque «*el PDF archivado y el WhatsApp del MISMO cierre podían narrar dos
cuadres distintos*»: es la garantía que se compró con ese arreglo, y es la que
no tiene quién la defienda. Contraste medido en el mismo archivo: la
**escritura** sí muerde —R45 (swap `p_total_comprobado`/`p_total_anticipo`) y
R46 (`p_diferencia → 0`) mueren las dos—; es solo la **lectura** la que está
desnuda.

**Consecuencia.** El operador y el contralor reciben dos cuadres distintos del
mismo cierre por dos canales, que es exactamente el fallo que este código se
escribió para cerrar.

**Causa raíz (una línea):** la frontera se probó del lado del llamador
(`processor`), con la función sustituida por un doble, y nadie ejerció el mapeo
de columnas que es todo su contenido.

---

### [ALTO] `PRU-A1` — REINCIDENTE (3.ª ronda): la whitelist del 15 % sigue sin una aserción sobre su contenido; `'626'` (RESICO) sobrevive 10,177 pruebas

`src/lib/likida/perfil/preguntas.ts:362` ·
`src/lib/likida/perfil/entrevista.ts:713`

**Escenario, sin cambio respecto de la 30 y de la 29.** `preguntas.ts:362`
`REGIMENES_ELEGIBLES_15 = ['624','612']` → `['624','612','626']` ⇒ `npx vitest
run src/lib/likida/` → **518 archivos, 7,937 pruebas, 1 saltada, 0 fallos.** La
copia suelta de `entrevista.ts:713` (`const elegible = v === '612' || v === '624';`
→ `… || v === '626';`) ⇒ `npx vitest run src/lib/` → **701 / 10,177, 0 fallos.**
`facilidad15_regimen_cotejado.test.ts` sigue probando `601`, `612`, `624` y
`null`, y nunca `626`.

**Consecuencia.** Con `'626'` colado en cualquiera de las dos listas, el motor le
concede a un RESICO el diésel pagado en efectivo que la LISR 27-III le niega, y
el PDF lo imprime citando la RFA 2026 regla 2.9 al lado. Ya pasó con `601`
(auditoría 18-c2).

**Causa raíz (una línea):** la fuente única fija **de dónde sale** la regla y
nadie fijó **qué dice**; una whitelist sin un caso negativo por clave excluida no
sobrevive un refactor de catálogo.

---

### [ALTO] `PRU-A2` — REINCIDENTE (3.ª ronda): el escritor del derecho de oposición ARCO se apaga entero y 7,937 pruebas siguen verdes

`src/lib/likida/processor.ts:352` (el `update` de `operador.oposicion_automatizada`)

**Escenario, idéntico a la 30.** `if (operadorId) {` → `if (false) {` ⇒ `npx
vitest run src/lib/likida/` → **518 archivos, 7,937 pruebas, 1 saltada, 0
fallos.** El operador manda «me opongo», la solicitud se registra,
`oposicion_automatizada` nunca se enciende y tampoco sale el «Además, desde ahora
tus liquidaciones las revisa una persona antes de cerrarse» (`:364`). El único
rastro sería un `logger.error` que la mutación ni dispara.

**Consecuencia.** El aviso de privacidad le promete a un operador —típicamente
uno dado de baja— que una persona revisará sus liquidaciones, y el acuse ya le
dijo que su solicitud «quedó registrada». Con el derecho apagado, el pipeline
sigue decidiendo solo.

**Causa raíz (una línea):** se probó la frontera observable (los argumentos que
viajan a `registrarSolicitudArco`) y no la escritura que hace efectivo el derecho.

---

### [ALTO] `PRU-A3` — REINCIDENTE (3.ª ronda): la rama legada de `facilidad15Vigente` puede forzar `regimenElegible: true` con la suite verde

`src/lib/likida/perfil/preguntas.ts:400`

**Escenario.** `regimenElegible: f15.regimenElegible === true` → `regimenElegible: true`
⇒ `npx vitest run src/lib/likida/` → **518 archivos, 7,937 pruebas, 1 saltada, 0
fallos.** Las pruebas de `facilidad15_fuente_unica*.test.ts` siguen probando
**quién gana** entre perfil y `config`; ninguna prueba que un `false` del `config`
**siga siendo `false`** al salir. Para una flota `601` nacida en `/admin/flotas`
con `config.regimenElegible = false`, la mutación le abre la facilidad del 15 %
en el cuadre.

**Causa raíz (una línea):** se probó la *precedencia* entre las dos fuentes y se
dio por probado el *valor* que sale de la fuente perdedora.

---

### [MEDIO] `PRU-M1` — REINCIDENTE (4.ª ronda): la aserción por número suelto, contada — 81 en la suite

`src/app/admin/ejecutivo/page.test.tsx:75-76` ·
`src/app/dashboard/despacho/vista.test.tsx:55` y `:107` ·
`src/app/dashboard/despacho/vista.tsx:232`

**Escenario, medido.** Con `{ filas: [], pagina: 8, porPagina: 25, total: 140 }`,
cambio `vista.tsx:232` de `<span>0–0 de {numero(activos.total ?? 0)} en curso</span>`
a `<span>0–0 de 0 en curso</span>` ⇒ `npx vitest run src/app/dashboard/despacho/`
→ **3 archivos, 19 pruebas, 0 fallos.** La pantalla dice en dos renglones
seguidos «hay **140** en curso» y «**0–0 de 0** en curso», y las dos aserciones
`toContain('140')` pasan porque el otro renglón lo sigue imprimiendo. En
`ejecutivo/page.test.tsx:75-76` el par `toContain('123')` + `toContain('456')`
deja pasar `$1,234,560.00`, o sea un MRR diez veces mayor en la lámina del board
(R8).

**Lo contable de esta ronda:** `grep` de `toContain('<2-6 dígitos>')` sobre
`src/**/*.test.ts*` → **81 aserciones**. No todas son defectuosas —varias son
sobre folios o códigos de estado, donde el valor sí es único—, pero es el tamaño
de la superficie, y el antídoto ya está en el repo y funciona:
`rentabilidad/vista.test.tsx` afirma la frase completa («Esta página no tiene
facturas — hay 350 en la cartera completa.») y por eso sus mutaciones mueren.

**Causa raíz (una línea):** `toContain` sobre un número suelto no distingue cuál
de los dos sitios de la pantalla lo imprimió.

---

### [MEDIO] `PRU-M2` — REINCIDENTE, **y empeoró de forma medible**: 46 de las últimas 100 corridas de `master` se cancelaron — y la que se canceló es la del merge de la auditoría 30

`.github/workflows/ci.yml:28-30`
(`concurrency: group: ${{ github.workflow }}-${{ github.ref }}` +
`cancel-in-progress: true`)

**Escenario, medido contra la API de Actions (las 100 últimas corridas `push` de
`ci.yml` sobre `master`):** **51 `success` · 46 `cancelled` · 3 `failure`.** La
30 midió 40 / 18 / 2 sobre 60, o sea 30 % canceladas; hoy son **46 %**. Y el sha
que encabeza la lista de canceladas es el peor posible:

| Sha | Asunto | Conclusión |
|---|---|---|
| `5ce91b20` | `Auditoría 30 — 12 rubros, 122 hallazgos, 3 arreglos con prueba` | **cancelled** |
| `ecfdf426` | `chore(normas): latido de vigilancia — 12-sep-2026` | **cancelled** |
| `139e792b` / `ed8a1b83` / `ea3745f8` … | los siete lotes de la campaña de cobertura | **cancelled** |

El commit que fusionó la ronda entera —incluidos los tres arreglos que la 30
declaró cerrados con prueba (`7d5bcdc`, `b740fe0`, `7a9b087`)— **nunca tuvo una
corrida verde propia**. Quedó tapado por el latido de `normas/` que se pusheó
encima minutos después.

**Consecuencia.** `master` es la rama desde la que se publica. Un `git bisect`,
un rollback, o un **Redeploy** de Vercel sobre cualquiera de esos 49 shas parte
de un árbol que la compuerta nunca aprobó; y con la bandera `[deploy]` leyéndose
solo del asunto, publicar uno de ellos no enciende ninguna alarma.

**Causa raíz (una línea):** el `concurrency` se agrupa por `github.ref` sin
excluir `master`, así que la rama que más necesita historial verde es la que más
corridas pierde — y los pushes automáticos de las rutinas (`normas/.latido-*`)
son los que más a menudo la decapitan.

---

### [MEDIO] `PRU-M3` — REINCIDENTE: la prueba que se llama «dice las TRES cifras» sigue sin tocar una sola cifra

`src/app/admin/costos-facturacion/page.tsx:121-127` ·
`src/app/admin/costos-facturacion/page.test.tsx:139-147`

**Escenario, con valores.** Con `emitirMensualidad` devolviendo
`{ monto: 2784, subtotal: 2400, iva: 384, referencia: 'REF-1' }`, intercambio
total y base en el mensaje:

```
- `Mensualidad emitida por ${mxn(r.monto)} (base ${mxn(r.subtotal)} + IVA ${mxn(r.iva)})…`
+ `Mensualidad emitida por ${mxn(r.subtotal)} (base ${mxn(r.monto)} + IVA ${mxn(r.iva)})…`
```

⇒ el mensaje sale como «**Mensualidad emitida por $2,400.00 (base $2,784.00 +
IVA $384.00)**» y `npx vitest run src/app/admin/costos-facturacion/` da **1
archivo, 9 pruebas, 0 fallos.** El comentario del código (`:121-123`) dice que
las tres cifras van juntas «*para cachar el día uno que el IVA quedó del lado
equivocado*», y las tres aserciones de la prueba son `'REF-1'` y dos
`revalidatePath`.

**Consecuencia.** Es el mensaje que ve Javier al cobrarle a un cliente real, y el
desglose es el que va a salir en el CFDI de esa flota. El único mecanismo escrito
para cachar un IVA invertido no tiene quién lo defienda, y el nombre de la prueba
afirma lo contrario.

**Causa raíz (una línea):** se afirmó el identificador (la referencia), que es lo
fácil de comparar, en vez de los tres valores que el propio código declara como
su razón de existir.

---

### [MEDIO] `PRU-31-M5` — NUEVO (la 30 lo dejó en «no alcancé a revisar»): 29 de los 53 arneses de `supabase/tests/` no los invoca nadie, tercera ronda con la cifra exacta

`.github/workflows/ci-postgres.yml:177-206` (la lista de invocaciones)

**Escenario, contado.** Para cada archivo de `supabase/tests/`, `grep` de su
nombre en `ci-postgres.yml`: **29 de 53 no aparecen**. Son las series
**0319–0337** completas: `0324_gps_poll_durable.sql`,
`0329_shared_unit_no_deadlock.sh`, `0334_capacidad_r4_red.sql`,
`0336_capacidad_r5_load.sh`, `0337_gps_r5_red.sql`, los cuatro de Cal.com de la
0323, los cinco de capacidad/jornada… Verifiqué que tampoco los llama ningún
otro workflow (`ls .github/workflows/` → 12 archivos) ni ningún `scripts/`.
`ci-postgres.yml` **sí** corre en cada push a cualquier rama (`:56-59`), así que
no es que el job no corra: es que estos 29 no están en su lista.

**Por qué importa y no es limpieza.** El GPS (`posicion`) y la capacidad de
jornada son de los pocos escritores nuevos del producto —el poller de
`conectores/sincronizar_gps.ts` y el pin del chofer—, y sus arneses son
justamente los de concurrencia y red, que es donde un `.sh` de 200 líneas paga
por sí mismo. Están escritos, versionados, y ninguna corrida los ha ejecutado.

**Consecuencia.** Para el equipo que mantiene esto: 29 archivos que parecen
cobertura en el árbol y no lo son. Un `git grep` encuentra la prueba de la
0336, alguien confía en ella, y esa garantía nunca se ha verificado ni una vez.

**Causa raíz (una línea):** la lista de invocación es manual y hay que acordarse
de añadir cada arnés nuevo; no existe nada que compare el directorio contra el
workflow.

---

### [BAJO] `PRU-B1` — REINCIDENTE: dos pruebas del mismo lote, el mismo ataque de tenant cruzado, distinto resultado; falta el caso hostil, no la aserción

`src/app/dashboard/emergencias/page.test.tsx` (sin el caso) ·
`src/app/dashboard/conversaciones/page.test.tsx` (sin el caso) ·
`src/app/dashboard/llaves-api/page.test.tsx:127` (**con** el caso)

**Escenario, medido esta ronda.** `llaves-api/page.test.tsx` inyecta
`tenantId: 'OTRO'` en el `FormData` y por eso R14 (`revocarLlaveApi(String(fd.get('tenantId') ?? s.tenantId), …)`)
**muere**. Sus hermanas no lo construyen: R11 en `emergencias/page.tsx:181`
(`borrarContactoEmergencia` con el tenant tomado del `FormData`) ⇒ **1 archivo,
14 pruebas, 0 fallos**; R12 en `conversaciones/page.tsx:49`
(`getHilosDeFlota(sp.tenant ?? tenantId)`) ⇒ **1 archivo, 12 pruebas, 0 fallos**,
en el archivo cuyo commit se titula `test(privacidad): primera cobertura de
/dashboard/conversaciones`. Las dos tienen la aserción correcta
(`toHaveBeenCalledWith('t-1', …)`); lo que falta es la entrada que la ponga a
prueba.

**Causa raíz (una línea):** el lote copió el molde del `FormData` limpio de una
prueba a la siguiente y solo una conservó el campo hostil.

---

## Lo que revisé y está bien

- **El motor de cuadre está anclado de verdad: 6 de 7 mutaciones mueren, y las
  que mueren lo hacen en plural.** Invertir el signo de la diferencia contra el
  anticipo (`engine.ts:1253`) tira 2 pruebas; dejar de excluir los duplicados del
  comprobado (`:679`) tira **7**; forzar a `1` la proporción deducible del viático
  (`:1835`) tira **15**, y la del IVA acreditable (`:1663`) tira 6. Esto es lo
  contrario del modo de falla del rubro y es lo que sostiene el 6: el número que
  el motor calcula sí tiene quien lo defienda.
- **El PDF —el papel que se entrega— muerde en los tres sitios que muté.**
  `pdf.ts:350` (el total comprobado), `:391` (la diferencia) y `:314` (el monto de
  cada renglón) rompen 3, 2 y 1 pruebas respectivamente. La asimetría con la
  pantalla es total y vale la pena decirla: el mismo número, en el PDF está
  protegido y en el panel no.
- **El dinero del SaaS es 7 de 7.** `TASA_IVA 0.16 → 0.08` (4 rojos), invertir el
  criterio de IVA incluido/excluido en `desglosarPrecio` (7 rojos), apagar el
  `medible = false` del MRR, sumar la retención en vez de restarla al total de la
  factura, invertir `total − pagado` en el saldo (3 rojos), y los dos agregados de
  `comercial.ts` (3 rojos cada uno). Ninguna sobrevive.
- **La escritura del cierre sí tiene arnés** (`repo.ts:1206-1208`): intercambiar
  `p_total_comprobado` con `p_total_anticipo` y anular `p_diferencia` ponen rojo
  cada uno. Es la lectura la que no (PRU-31-A4).
- **Cero intermitencia por reloj, medido y no razonado.** La suite completa
  corrida tres veces con husos extremos (`TZ` por defecto, `Pacific/Kiritimati`
  UTC+14, `Pacific/Midway` UTC−11) da **984 / 12,934 / 0 fallos** las tres veces,
  al dígito. De los 15 archivos de prueba que usan `new Date()` sin
  `useFakeTimers`, los que abrí (`legal/marco_leg12_aud24.test.ts:20-31`,
  `formato.test.ts:304-321`, `utils_fecha.test.ts:77`) son **guardias contra** el
  reloj, no dependencias de él: prohíben `new Date()` en el código de producción.
- **La frescura de la cuota de diésel está anclada por los dos lados.**
  `calculadora.ts:136` (`diasEntre(CUOTA_DOF.registradaEl, hoy) > 14`) se rompe si
  se afloja el plazo (R30) o si se dobla la estimación (R31), y
  `calculadora.test.ts:167-169` compara la constante publicada contra la última
  semana del YAML — no contra sí misma, que era el fallo que el propio archivo
  documenta. La tabla cubre hasta el **2026-09-11** y hoy es el 13: dentro del
  plazo de 14 días, y cuando se pase, la página dirá `null` en vez de una cifra
  vieja, que es lo que la regla del producto manda.
- **Los seis tests SQL nuevos de la 30 siguen cableados** en
  `ci-postgres.yml:193-198`, y `ci-postgres.yml` corre en cada push a cualquier
  rama (`:56-59`).
- **El trinquete de cobertura sigue existiendo y sigue mordiendo sobre lo que
  mide**: `ci.yml:75` corre `npm run test:coverage` y `:82` recupera con
  `npx vitest run fundamento duplicados` las dos pruebas de tiempo que
  `--coverage` salta. El problema no es que la puerta no exista; es su
  `exclude` (PRU-C1).

---

## Lo que NO alcancé a revisar

- **Ni un `psql`, sexta ronda seguida.** No hay Postgres en el contenedor. Todo
  lo que digo de `supabase/tests/*.sql` y de `verificaciones.sql` es **lectura
  estructural y conteo de invocaciones**: **cero mutaciones de SQL**. Es el hueco
  más grande del rubro y no se cierra con más lectura. Un tope de efectivo o una
  retención mal puesta dentro de una función plpgsql no la tocaría ninguna de mis
  45 mutaciones.
- **No abrí los 29 arneses huérfanos uno por uno.** Conté sus nombres contra
  `ci-postgres.yml` y verifiqué que ningún otro workflow ni script los llame; no
  leí su contenido para juzgar si lo que prueban vale la pena.
- **No corrí `--coverage` yo mismo.** El número de `vitest.config.ts:129-133`
  (86/83/73/86) lo doy por vigente porque CI lo evalúa en cada push; lo que sí
  medí de primera mano es **qué queda fuera del denominador** (los 296 `.tsx` y
  58,201 líneas de PRU-C1), que es lo que importaba para el hallazgo.
- **45 mutaciones no son la suite.** Cubrí 12 zonas y elegí las que tocan dinero;
  quedaron sin atacar `intake/ocr`, `carta_porte_xml`, los agentes, el timbrado
  contra Facturapi y todo `src/app/api/`. Si el patrón se sostiene —y 12 de 12 en
  la capa de pantalla sugiere que sí—, PRU-C1 es más grande que las 12 que medí:
  hay **196** sitios que imprimen dinero en esa capa.
- **No toqué la Capa 0** (`wa_leases_fencing.sql`, pgTAP), ni `playwright-smoke`,
  ni `e2e-navegador.yml`: octava ronda fuera por falta de `pg_prove` y navegador.
- **No revisé `pruebas-manuales/`** (prohibido correrlas) más allá de confirmar
  que siguen fuera del `include` de vitest.
- **Una sola corrida por mutación** (salvo las que re-corrí en alcance ancho). No
  puedo afirmar nada sobre intermitencia por carga o por orden de archivos; sobre
  intermitencia por reloj sí, y salió limpia.

---

## Árbol limpio

```
$ git status --porcelain
?? docs/auditoria-31/pruebas.md
```

El worktree desechable quedó borrado (`git worktree list` → una sola entrada,
`/home/user/cuadra  4047a50 [claude/auditoria-31]`) y cada una de las 45
mutaciones se revirtió con `git checkout -- <archivo>` inmediatamente después de
su corrida, verificado archivo por archivo.
