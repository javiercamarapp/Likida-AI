# Rendimiento y costo — auditoría 31, continuación

**Nota: 4/10** (antes 4). Razón del movimiento: **ninguna sola — las tres
aplican a la vez y se cancelan, con el número de cada una escrito abajo.**

- *Se atacó y subió*: sí, y es real. El peor caso de `cron/asistencia` bajó de
  **202.2 s → 130.2 s** contra 120, y el de `barrerPorConciliar` dejó de ser un
  bucle de **914 s nominales** sin reloj. Donde había **cero** pruebas que
  guardaran un margen ahora hay **tres**, y las tres mueren al mutar el arreglo
  (verificado abajo, comando por comando).
- *Deuda que cobró factura*: el arreglo de peajes **abrió un CRÍTICO nuevo en
  la pantalla del contralor**. Con el corte por reloj antes de la primera
  línea, `revisadas = 0` y `controles.tsx:71` imprime **«No había nada
  pendiente que barrer.»** sobre una cola de 1,000 líneas sin conciliar. Es
  exactamente el rótulo que el commit decía estar arreglando.
- *Mirada más profunda*: la 31 puso a `gps` y `descarga-sat` en «lo que está
  bien» con sumas de 295.0 y 294.5 contra 300. **Las dos sumas están mal por el
  mismo error que el arreglo de asistencia hereda**: `venceEn` se ancla
  DESPUÉS de una consulta acotada de hasta 9.5 s (19 s en descarga-sat), y el
  colchón del latido reserva 5.0 s para un `registrarLatido` cuyo propio techo
  es 9.5 s. Recontadas: **gps 314.0 contra 300** y **descarga-sat 323.5 contra
  300**. Los tres crons que derivan su margen lo derivan corto.

El ancla del rubro sigue diciendo lo mismo que ayer: «4 o menos si el peor caso
excede el límite y falla callado». Hoy lo excede en **seis** rutas. Que dos de
esos excesos hayan pasado de decenas de segundos a unidades de segundos es el
único movimiento real, y se lo come el CRÍTICO nuevo.

**El riesgo mayor del rubro, hoy:** el «Ejecutar ahora» de Peajes le dice al
contralor **«No había nada pendiente que barrer»** cuando el reloj cortó antes
de la primera línea — y el prólogo del barrido (hasta 100 páginas de `gasto`,
30 s nominales) se come solo los 25 s del reloj, así que ese es el caso normal
de una flota grande, no el raro.

---

## Los dos arreglos de esta continuación, verificados

Árbol limpio al empezar y al terminar (`git status --short` solo muestra
`docs/auditoria-31/progreso.md`, modificado antes de que yo entrara).

### `f4fde69` — el reloj del cron de emergencias

**La prueba muere al mutar el arreglo: SÍ, las dos.**

```
sed -i 's|Date.now() + maxDuration * 1000 - MARGEN_MS|Date.now() + (maxDuration - 15) * 1000|' src/app/api/cron/asistencia/route.ts
npx vitest run src/app/api/cron/asistencia/route.test.ts
  → Test Files 1 failed · Tests 2 failed | 6 passed
git checkout -- src/app/api/cron/asistencia/route.ts   → árbol limpio
```

```
# quitar acotada() del select de `viaje` en asistencia_escalamiento.ts:309
npx vitest run src/lib/likida/asistencia_escalamiento.test.ts
  → Test Files 1 failed · Tests 1 failed | 22 passed
git checkout -- src/lib/likida/asistencia_escalamiento.ts   → árbol limpio
```

**¿Cierra REN-31-C1? El modo de falla que nombraba, SÍ. El techo, NO.**

Lo que sí cerró, y es lo importante del hallazgo: con `venceEn = T_a + 28.5 s`,
una unidad admitida en el último instante llega a `sendButtons` en
`T_a + 105.0 s` **siempre**. El «claim quemado sin WhatsApp» —la incidencia que
desaparecía del barrido para siempre— ya no ocurre en el camino crítico.

Lo que NO cerró está en **REN-31C-A1** y **REN-31C-A2** abajo: la suma real
termina en `T_a + 120.7 s` contra `maxDuration = 120`, o sea que **el exceso
empieza con `T_a = 0`**; y el conteo de «7 consultas» no incluye
`leerConfigCobranza`, que además **no tiene techo**.

**Correcciones al conteo del commit (las dos hacia el lado conservador, dichas
para que nadie las herede):**

- El commit y el comentario de `route.test.ts:143-145` cuentan `alertarOperador`
  como **1 envío de WhatsApp** («con ALERTA_WA puesto»). No puede serlo:
  `alerta.ts:191` solo deja salir por WhatsApp los eventos que casan con
  `/^(timbre\.|finanzas\.|stripe\.|cron\.facturar|cron\.cobranza|wa\.rechazo_masivo|pdf\.no_entregado)/`,
  y `asistencia.escalamiento` no casa. Su costo real es Redis 1.2 s
  (`alerta.ts:61`) + correo 5.0 s (`enviar.ts:42`) = **6.2 s**, no 10.0. El
  margen reserva 3.8 s de más por ese renglón — es la única holgura accidental
  que hoy tapa parte del error del colchón.

**¿Rompió algún contrato?** No. `escalarAsistenciasPendientes` ya devolvía
`cortadosPorReloj` antes del arreglo (`asistencia_escalamiento.ts:191`) y el
latido ya lo leía. La ventana de despacho baja de ~105 s a **28.5 s**: en
costos nominales (5.1 s por escalada) pasa de ~20 escaladas por corrida a
**~5**, y con el `traerTodo` de `:213` en su techo puede quedar en **0**. Eso
sale declarado (`cortadosPorReloj` + latido `parcial`, `route.ts:82`), así que
el resumen sigue diciendo la verdad. Una ráfaga de 30 incidencias tarda ahora
**6 ciclos de cron (30 min)** en vez de 2 (10 min) — para un reloj de
emergencias es una degradación real, pero es la que el hallazgo compró a
cambio de no perderlas.

### `54bddb2` — el «Ejecutar ahora» de Peajes

**La prueba muere al mutar el arreglo: SÍ.**

```
# desactivar el chequeo: `if (false && Date.now() > venceEn)` en consolidado.ts:860
npx vitest run src/lib/likida/intake/consolidado_barrido.test.ts
  → Test Files 1 failed · Tests 2 failed | 11 passed
git checkout -- src/lib/likida/intake/consolidado.ts   → árbol limpio
```

**¿Cierra REN-30-C1? Solo el bucle. El prólogo sigue sin reloj** — y el prólogo
es el tramo caro (**REN-31C-A3**).

**¿Rompió algún contrato? SÍ, dos, y los dos son rótulos.** El MAPA preguntaba
si alguien dependía del significado viejo de `revisadas`. **Dos sitios, y los
dos ahora mienten**: `controles.tsx:71` (**REN-31C-C1**, CRÍTICO) y
`page.tsx:239-242` (**REN-31C-A4**). La prueba nueva de `:283-294` ejerce
exactamente la tupla que rompe la pantalla (`revisadas: 0, cortadosPorReloj: 2`)
y afirma que «el resumen no miente» — y tiene razón: el motor no miente, la
pantalla sí. Nadie miró el render.

Suite del rubro corrida sobre el árbol restaurado:
`npx vitest run presupuesto pg.test lotes openrouter asistencia drenado consolidado_barrido peajes`
→ **35 archivos / 400 pruebas, todas pasan**. Ninguna falla por nada de lo de
abajo.

---

## Hallazgos

### REN-31C-C1 · [CRÍTICO] El barrido de peajes dice «No había nada pendiente que barrer» sobre una cola de 1,000 líneas que el reloj cortó antes de tocar la primera

`src/app/dashboard/agentes/peajes/controles.tsx:71-72` contra
`src/lib/likida/intake/consolidado.ts:787` (`revisadas: 0` como valor inicial de
un contador) y `:860-864` (el corte que deja `revisadas` en 0 y
`cortadosPorReloj` en `pendientes.length`). La rama que pinta
`cortadosPorReloj` (`:82-87`) vive **dentro del `else`**, así que en este caso
no se renderiza nunca.

**Escenario: entra esto → sale esto mal.** Una flota con 1,000 líneas
`por_conciliar` y ~50,000 gastos sin CFDI en el rango de fechas. El contralor
aprieta «Ejecutar ahora». El prólogo (`:774`, `:797`, `:817-827`) gasta
0.3 + 0.3 + 50 × 0.3 = **15.6 s** nominales; si tres de esas páginas van al
techo (`TECHO_PASO_CONSULTA_MS = 9.5 s`) el prólogo solo son **28.5 s** y ya
pasó `venceEn = ahoraMs() + 25_000` (`page.tsx:234`). El primer `Date.now() >
venceEn` de `:860` corta antes de la primera línea:

```
{ revisadas: 0, conciliadas: 0, candidatosRefrescados: 0,
  siguenPendientes: 0, cortadosPorReloj: 1000 }
```

`controles.tsx:71` evalúa `r.revisadas === 0` y escribe, palabra por palabra:
**«No había nada pendiente que barrer.»** Antes de `54bddb2` esa misma condición
era `pendientes.length === 0` y el rótulo era verdad.

**Consecuencia para alguien real.** El contralor —el comprador— concluye que su
cola de casetas está limpia, no vuelve a apretar el botón y no reclama el IVA
acreditable de 1,000 líneas de peaje. Es CLAUDE.md literal: «Un rótulo tiene que
ser verdad». Y es la superficie del demo: el botón se aprieta delante de él.

**Causa raíz probable:** `revisadas` pasó de «tamaño de la cola» a «contador de
lo recorrido» y nadie buscó los lectores del significado viejo; la línea que
declara el corte quedó dentro del `else` del rótulo que el corte vuelve falso.

---

### REN-31C-A1 · [ALTO] Los tres crons que DERIVAN su margen lo anclan después de una consulta acotada y reservan 5.0 s para un latido de 9.5 s: asistencia 130.2/120, gps 314.0/300, descarga-sat 323.5/300

`src/app/api/cron/asistencia/route.ts:41` (`leerInterruptor`, acotada vía
`interruptores.ts:209`, techo 9.5 s) contra `:76`
(`const venceEn = Date.now() + maxDuration * 1000 - MARGEN_MS`), y
`src/lib/likida/presupuesto.ts:366` (`COLCHON_LATIDO_CRON_MS = 5_000`) contra
`src/lib/admin/salud.ts:102` (`registrarLatido` envuelto en `acotada`, techo
`TECHO_PASO_CONSULTA_MS = 9_500`). Mismo patrón en
`src/app/api/cron/gps/route.ts:89` → `:110` y en
`src/app/api/cron/descarga-sat/route.ts:50-55` → `:107` (este lee **dos**
interruptores, hasta 19.0 s).

**Escenario: entra esto → sale esto mal.** `cron/asistencia`, volcadura con
lesionados, prioridad crítica, dueño sin teléfono. La cadena real de
`escalarUna`, paso por paso con los techos del repo:

| paso | archivo:línea | techo |
|---|---|---|
| `reclamarEscalacionAsistencia` | `asistencia_escalamiento.ts:293` | 9.5 s |
| `polizaVigenteDe` | `:299` | 9.5 s |
| `select` de `viaje` (ya acotado por `f4fde69`) | `:309` | 9.5 s |
| `contactoSiLesionadosDe` | `:313` | 9.5 s |
| `telefonoDeRol('flota_admin')` | `:331` | 9.5 s |
| `telefonoJefeDe` | `:333` | 9.5 s |
| `sendButtons` | `:343` | 10.0 s |
| `alertarOperador` (Redis 1.2 + correo 5.0) | `:351` | 6.2 s |
| `anotarEventoIncidencia` | `:359` | 9.5 s |
| **unidad** | | **82.7 s** |
| `registrarLatido` de la ruta | `route.ts:80` | 9.5 s |

`MARGEN_MS = 91.5 s` ⇒ `venceEn = T_a + 28.5 s`, donde `T_a` es el instante de
`:76` — **no el arranque de la invocación**, sino después de `leerInterruptor`
(su caché dura 5 s, `interruptores.ts:154`, y el cron corre cada 5 min: nunca
pega). Fin = `T_a + 28.5 + 82.7 + 9.5` = **`T_a + 120.7 s` contra 120**. Con
`T_a = 0` ya sobra 0.7 s; con `T_a = 9.5` son **130.2 s, +10.2**.

Lo que muere es la cola: `anotarEventoIncidencia` (la fila `escalada` de la
bitácora) y `registrarLatido`. Las mismas cuentas sobre los otros dos:
**gps** `T_a + 190.5 + 104.5 + 9.5 = T_a + 304.5` → hasta **314.0 contra 300**;
**descarga-sat** `T_a + 256.5 + 38.5 + 9.5 = T_a + 304.5` con `T_a ≤ 19.0` →
hasta **323.5 contra 300**.

**Consecuencia para alguien real.** El WhatsApp de la emergencia sale (eso lo
arregló `f4fde69`), pero el expediente de la incidencia no tiene la fila que
prueba que salió —el dato que se pide en un siniestro o en un pleito laboral— y
`/admin/crons` pinta «no late» sin causa para el cron de emergencias, cada vez
que pasa. Y retira de «lo que está bien» a los dos crons que la 31 usaba como
ejemplo de margen bien derivado.

**Causa raíz probable:** `margenUnidadAtomicaMs` es correcto; el llamador le
pasa como `t = 0` un `Date.now()` que ya viene tarde, y `COLCHON_LATIDO_CRON_MS`
es un literal de 5 s que no se derivó de `TECHO_PASO_CONSULTA_MS` como todo lo
demás del archivo.

---

### REN-31C-A2 · [ALTO] `leerConfigCobranza` está en la cadena de la escalada, no tiene `acotada()`, y la prueba nueva que jura que no queda ninguna solo mira un archivo

`src/lib/likida/agentes/cobranza.ts:39-44` (`await supabaseAdmin().from('agente_cobranza_config')…`
— sin `acotada`; el archivo entero no importa `acotada`: `grep -n acotada` da
cero) llamado desde `src/lib/likida/asistencia_escalamiento.ts:278`, contra la
prueba de `asistencia_escalamiento.test.ts:363-375`, que hace
`readFileSync('src/lib/likida/asistencia_escalamiento.ts')` y cuenta
`await supabaseAdmin()` **en ese archivo y nada más**.

**Escenario: entra esto → sale esto mal.** Una incidencia ÁMBAR — `asistencia_wa.ts:534`
escribe `prioridad: asistencia.nivel === 'rojo' ? 'critica' : 'alta'`, así que
toda incidencia que no sea roja entra por `:277` (`inc.prioridad !== 'critica'`).
Supabase acepta el socket de `agente_cobranza_config` y no contesta. Sin techo,
`fetch` hereda el default de undici: **300 s**. Vercel mata la invocación a los
120. Nada de lo que venía después corre: ni esa incidencia, ni **las de las
demás flotas que seguían en la lista** (el cron barre todos los tenants,
`:213-225`), ni `registrarLatido`. Se repite cada 5 minutos mientras dure.

Y el conteo del margen tampoco la incluye: el camino ámbar con lesionados hace
**8** consultas, no 7 — `leerConfigCobranza` + las siete de la tabla de arriba
—, así que aun con techo la unidad vale 92.2 s contra los 86.5 s de trabajo que
el margen reserva.

**Consecuencia para alguien real.** Un varado ámbar de la flota A deja sin
escalar la volcadura roja de la flota B que iba detrás en la lista, y el
tablero dice «no late» sin decir por qué. Es el silencio que este cron existe
para romper, movido un eslabón más adentro.

**Causa raíz probable:** el guardarraíl nuevo es una prueba de un solo archivo
sobre una cadena que cruza cinco (`cobranza.ts`, `emergencias.ts`,
`contactos.ts`, `asistencia_wa.ts`, `meta/client.ts`); el techo se verifica
donde se escribió el hallazgo, no donde corre la cadena.

---

### REN-31C-A3 · [ALTO] El reloj de 25 s del barrido de peajes no cubre su propio prólogo: hasta 100 páginas de `gasto` corren antes del primer `Date.now()`

`src/lib/likida/intake/consolidado.ts:768` (`venceEn`), `:774-779`
(`barrido.lineas_pendientes`), `:797-801` (`barrido.cfdi_xml`) y `:817-827`
(`traerTodo` de `barrido.candidatos_gasto`) contra `:860`, que es el **primer y
único** `Date.now() > venceEn` de toda la función. `src/lib/likida/pg.ts:48`
(`MAX_PAGINAS = 100`), `:45` (`PAGINA = 1_000`).

**Escenario: entra esto → sale esto mal.** Una flota con ≥ 99,000 gastos sin
`cfdi_uuid` dentro del rango de fechas de sus líneas pendientes. El prólogo son
**100 páginas × 0.3 s = 30.0 s** nominales —más las dos consultas de arriba—
contra un `venceEn` de **25.0 s**: el corte dispara en la primera vuelta del
bucle, **siempre**. `revisadas = 0`, `conciliadas = 0`,
`cortadosPorReloj = 1000`. Y cada re-ejecución vuelve a pagar el prólogo
entero: el botón nunca avanza ni una línea, por más veces que se apriete. A
techos el prólogo son **100 × 9.5 = 950 s**, tres veces cualquier límite de
plataforma, y ahí no hay reloj que corte.

En la escala intermedia el efecto es de costo: con 45,000 gastos el prólogo se
lleva **14.1 s** de los 25, dejan ~10.9 s para el bucle, y a 3 consultas por
línea (`ligarLineaAGasto` 2 + el `update` de `:888`) son **~12 líneas por
clic**. Drenar 1,000 líneas pide **~83 clics** y **~3,735 lecturas de página**
de `gasto` que antes se pagaban una sola vez.

**Consecuencia para alguien real.** El contralor aprieta el botón, ve el
mensaje de REN-31C-C1 («no había nada pendiente») o «quedaron 1,000 fuera»,
y no hay número de clics que lo resuelva. El trabajo no se pierde —es
re-entrante— pero tampoco progresa, y el gasto de lectura se multiplica por el
número de intentos.

**Causa raíz probable:** el corte se puso en el bucle porque ahí está el efecto
irreversible (el sello de `ligarLineaAGasto`), y el tramo que de verdad consume
el presupuesto —la lectura paginada previa— quedó fuera del reloj. Es la misma
forma de REN-30-C2, en el otro llamador del mismo patrón.

---

### REN-31C-A4 · [ALTO] La bitácora de corridas de peajes escribe `ok` y `0/0` sobre un barrido que dejó 1,000 líneas fuera

`src/app/dashboard/agentes/peajes/page.tsx:239` (`estado: 'ok'`, literal, sin
mirar `resumen.cortadosPorReloj`) y `:242` (`tareasTotal: resumen.revisadas`),
contra el hermano `src/app/dashboard/agentes/cobranza/page.tsx:124`
(`estado: resultado.fallos.length > 0 ? 'parcial' : 'ok'`) y contra
`src/app/api/cron/asistencia/route.ts:82`, que sí usa `'parcial'` cuando
`cortadosPorReloj > 0`. La ficha (`ficha-corridas.tsx:70-77`) pinta
`tareasHechas/tareasTotal` y la píldora del estado, y **no lee `resumen`**,
que es donde `cortadosPorReloj` quedó guardado (`page.tsx:243`).

**Escenario: entra esto → sale esto mal.** El barrido revisa 12 de 1,000 líneas
y corta. Se escribe `estado: 'ok'`, `tareasHechas: 0`, `tareasTotal: 12`. La
ficha «Corridas del agente» pinta la píldora **verde «OK»** y **«0/12»**. Antes
de `54bddb2`, con `revisadas = pendientes.length`, ese mismo caso pintaba
«0/1000» — incompleto a la vista. El cambio de significado empeoró el registro
persistente. Con el caso de REN-31C-A3 la fila es **«OK — 0/0»**.

**Consecuencia para alguien real.** El acuse de la pantalla se va al recargar;
la ficha de corridas es lo que queda, y es lo que el contralor (o quien
mantenga esto) mira para responder «¿mi agente trabajó?». Le responde que sí,
completo, en verde.

**Causa raíz probable:** el arreglo cambió el significado de `revisadas` y
actualizó el acuse efímero, no el registro durable que lo consume.

---

### Los abiertos de la 31 que nadie tocó — verificados contra el fuente de hoy

`origin/master` no se movió (`4047a50`); los únicos cambios son los tres
commits de la continuación. Reverifiqué línea por línea los que no toca ninguno:

| ID | Veredicto | Evidencia de hoy |
|---|---|---|
| **REN-30-C2** (CRÍTICO) — `candidatosDeGasto` 427.5 s antes del primer avance durable | **REINCIDENTE** | `consolidado.ts:342-356` sigue sin reloj; `:473` (`const candidatosDb = rango ? await candidatosDeGasto(...)`) sigue sin `venceEn`; `:495` (`enLotes`) sigue siendo el primer avance durable. `descarga-sat/route.ts:107` sigue en `margenUnidadAtomicaMs({consultas:3,envios:1})`. **331.2 s contra 300**, y con REN-31C-A1 encima, 350.2. |
| **REN-31-A1** (ALTO) — el drenado presta el presupuesto entero al mensaje | **REINCIDENTE** | `drenado.ts:141-145` sigue pasando `inicioInvocacionMs`; `presupuesto.ts:268` sigue en `PRESUPUESTO_WEBHOOK_MS = 120_000`; la cola del cron sigue en `drenado.ts:201, 217, 241, 254`. **158.0 s contra 120.** |
| **REN-31-A2** (ALTO) — el chat escribe el costo antes de entregar la respuesta | **REINCIDENTE** | `dashboard/chat/route.ts` sin cambios (`git log` no lo toca). **106.5 s contra 60.** |
| **REN-30-A1** (ALTO) — la copia de `candidatos_gasto` que sigue en `range()` | **REINCIDENTE** | `consolidado.ts:817-827` sigue con `traerTodo` + `.order('id').range(d, h)` contra `:342-356` ya en keyset. Y ahora también es el prólogo sin reloj de REN-31C-A3. |
| **REN-30-M1** (MEDIO) — el keyset sin índice que cubra su predicado | **REINCIDENTE** | Sin Postgres no se mide; los índices siguen siendo `(tenant_id, id)` y `(tenant_id, fecha)`. |
| **REN-30-M2** (MEDIO) — `traerTodoDesdeId` devuelve lectura corta en silencio | **REINCIDENTE** | `pg.ts:267-273` verbatim: tras `if (esperadas !== null && filas.length >= esperadas) return filas;` viene `if (pag.length === 0) { … return filas; }` sin volver a mirar `esperadas`. |
| **REN-30-M3** (MEDIO) — `copiloto` y `runner` declaran fase de costo y nadie la escribe | **REINCIDENTE** | `grep -rl "registrarCosto("` sobre `src/` da hoy 6 archivos de producción (`ingesta/route.ts`, `chat/route.ts`, `oficina_wa.ts`, `voz_transcrita.ts`, `costos.ts`, `processor.ts`). Ni `copiloto.ts` ni `agentes/runner.ts`, que sí reservan contra el techo diario (`copiloto.ts:217`, `runner.ts:765`). |
| **REN-30-B1** (BAJO) — el upsert reescribe el XML completo en cada reintento | **REINCIDENTE** | `consolidado.ts:388-402` sin cambios. |
| **REN-A1 · A2 · M1 · M2 · M3 · B1** (los 6 de la 29) | **REINCIDENTES, los 6** | `budget.ts:219` sigue en `PISO_TOPE_TENANT_USD = 5.00`; `presupuesto.ts:268` en 120 000; `correo/entrante/route.ts:284` en `RESERVA_PARA_LIBERAR_MS = 3_000`; `cron/facturar/lote.ts:80` en `150_000`; `grep -c registrarCostoWhatsApp` sigue en 0 para `avisar_cierre.ts` y `meta/aviso_oficina.ts`; `PASOS_CIERRE` sigue en 20 renglones con docblocks de 18. |

---

## Lo que revisé y está bien

- **Las tres pruebas nuevas mueren de verdad.** Mutadas una por una y
  restauradas con `git checkout --`, árbol limpio verificado con `git status`
  después de cada una. Ninguna de las tres pasa con el arreglo revertido.
- **El corte del barrido va donde debe: ANTES de tocar la línea, nunca entre el
  sello y el UPDATE.** `consolidado.ts:857-865` — el chequeo está arriba del
  `resumen.revisadas++`, así que `ligarLineaAGasto` (`:881`) y el `update` de
  `:888` siempre corren juntos o ninguno. La prueba de `:283-294` verifica
  `sellos` y `escrituras` vacíos. Eso sí cierra la mitad de REN-30-C1 que
  hablaba de morir a media línea.
- **`barrerPorConciliar` sin `venceEn` sigue siendo infinito** (`:768`,
  `opts.venceEn ?? Number.POSITIVE_INFINITY`) y hay prueba que lo ancla
  (`:315-322`): el arreglo no cambió el comportamiento de ningún llamador que
  no pase reloj. Solo hay un llamador (`peajes/page.tsx:234`).
- **`escalarAsistenciasPendientes` cuenta el corte honestamente.**
  `asistencia_escalamiento.ts:228-231`: `cortadosPorReloj = filas.length -
  r.revisadas`, y la ruta lo convierte en latido `'parcial'` (`route.ts:82`).
  Aquí el rótulo sí es verdad — es el contraste que hace visible lo de peajes.
- **El `select` de `viaje` quedó bien acotado** (`asistencia_escalamiento.ts:309`)
  y el archivo entero ya no tiene una sola consulta cruda (verificado con el
  mismo `grep` que usa la prueba).
- **`margenUnidadAtomicaMs` sigue derivando y no copiando**
  (`presupuesto.ts:399-401`). El defecto de REN-31C-A1 está en los llamadores y
  en `COLCHON_LATIDO_CRON_MS`, no en el helper.
- **`cotaEntradaEnTokens` sigue sin contar una imagen por byte**
  (`openrouter.ts:568-591`, `TOKENS_POR_IMAGEN = 4_000`), el SDK sigue en
  `maxRetries: 0` (`:52-53`), y el OCR sigue reusando la `reducida` en vez de
  redimensionar dos veces (`intake/ocr.ts:435-446`). Nada de eso lo tocaron los
  tres commits; lo reverifiqué porque es donde vive el costo por operación.
- **`cron/wa-outbox` y `cron/jornada` siguen cabiendo** con las mismas sumas de
  la 31 (~174.5 contra 300 y el corte por lote de `derivar.ts:262`). No usan
  `margenUnidadAtomicaMs`, así que REN-31C-A1 no los toca.

---

## Lo que NO alcancé a revisar

- **El render de `controles.tsx` con `revisadas: 0, cortadosPorReloj: 1000`.**
  REN-31C-C1 lo deduje leyendo el JSX y la tupla que la prueba del motor ya
  produce, no levantando el preview. La condición es de una línea y no tiene
  ramas, pero mirarlo sigue siendo el estándar de CLAUDE.md y no lo hice.
- **El `EXPLAIN` de las dos `candidatos_gasto`** (REN-30-M1). Sin Postgres
  corriendo no se mide, aunque hoy sé que hay binarios de PG 16 en la imagen —
  levantar un cluster temporal y cargar las migraciones es la primera cosa que
  haría la ronda siguiente.
- **Cuántos gastos sin `cfdi_uuid` tiene de verdad una flota en un rango de
  peajes.** Toda la aritmética de REN-31C-A3 se apoya en el supuesto de la 31
  (45,000) y en el tope estructural de `MAX_PAGINAS` (100). La base está en
  cero, así que el número real no existe todavía.
- **El default real de `maxDuration` de una Server Action.** Sigue sin `vercel.json`
  con bloque `functions` y sin `maxDuration` en ningún `page.tsx`. Uso 300 s
  como techo; si fuera menor, REN-31C-A3 es peor.
- **Cuántas llamadas de modelo gasta una liquidación de punta a punta.** Abierto
  desde la 27, sin moverse.
- **`npm test` completo.** Corrí 35 archivos / 400 pruebas del rubro y las tres
  mutaciones. No edité código; el árbol quedó como lo encontré.
