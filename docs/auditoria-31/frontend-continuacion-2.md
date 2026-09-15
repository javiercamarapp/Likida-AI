# Frontend — auditoría 31, continuación 2

**Nota: 5/10** (antes 5). Razón del movimiento: **ninguna neta — dos de las
tres formas aplicaron y se cancelaron, con el número de cada una a la vista.**

- *Se atacó y subió* (+): por primera vez en tres rondas entró código de
  producción en mi superficie y **el arreglo es correcto**. `065f699` cierra el
  acuse de peajes; lo verifiqué agotando los tres estados posibles contra
  `consolidado.ts` (sección siguiente) y la prueba de render (`939c111`) monta
  el componente REAL.
- *Deuda que cobró factura* (−): el mismo arreglo se aplicó a **1 de los 2**
  sitios que tienen ese patrón. `agentes/cobranza/page.tsx:124` sigue
  archivando como `estado: 'ok'` una corrida que el reloj cortó o que ni
  siquiera corrió → **FE-31C2-A1, ALTO nuevo**.
- Y el número que no se mueve: **0 de 9 hallazgos abiertos cerrados, tercera
  ronda seguida.** Los 9 reverificados hoy `archivo:línea`, uno por uno. Los
  abiertos pasan de **9 a 13** con los cuatro de hoy.

Lo que fija el techo en 5 y no en 6 es la misma línea de siempre: mientras
**FE-C1** (sexta ronda) deje que el comprador vea `Anticipo $0.00 · entregado
al operador` junto a `Diferencia $18,400.00` en la pantalla de firma, el ancla
del rubro («4 o menos si el comprador puede ver una cifra mal») está tocando la
nota. Lo que la sostiene en 5 es que todo lo demás sí pinta sus cuatro estados.

Lo contable de hoy:

| Medida | Hoy | Ronda anterior |
|---|---|---|
| Hallazgos abiertos de la ronda anterior verificados uno por uno | **9 de 9 intactos** | 6 de 6 intactos |
| Cierres | **0** (tercera ronda seguida) | 0 |
| Archivos de producción de mi superficie tocados en la ventana | **2** (`peajes/controles.tsx`, `peajes/page.tsx`) | 0 |
| Sitios con el patrón de `065f699` · sitios arreglados | **2 · 1** | — |
| `npx vitest run src/app` | **251 archivos / 2,283 pruebas, verde** | 250 / 2,277 |
| `npx tsc --noEmit -p .` | exit 0 | limpio |
| Mapas de rótulo cruzados contra su dominio REAL | **16**; exactos **13**; desincronizados **3**; sin mapa **1** | 9 / 8 / 1 / — |

**Riesgo mayor del rubro, hoy:** sigue siendo FE-C1. Detrás, el patrón que esta
ronda deja demostrado: **la bitácora durable del panel puede decir «OK» sobre
una corrida que no hizo nada**, y eso ahora está arreglado en Peajes y no en
Cobranza — que es el agente que sí manda WhatsApp a choferes.

---

## Veredicto sobre el arreglo 065f699

**Cierra el caso reportado. No cierra la clase.** Tres mediciones:

**1. El acuse en pantalla: CIERRA, y es demostrable por agotamiento.**
`controles.tsx:75-100` tiene ahora tres ramas. Perseguí si existe un camino que
llegue a la rama «No había nada pendiente que barrer» con cola llena, y **no
existe**:

- El único lugar donde se asigna `cortadosPorReloj` es
  `consolidado.ts:861` (`pendientes.length - resumen.revisadas`), dentro del
  corte por reloj.
- Con `pendientes.length === 0`, `consolidado.ts:789-792` devuelve el resumen en
  ceros y **regresa antes** de todo lo demás.
- Con `pendientes.length > 0`, o el bucle avanza (`revisadas++` en `:865`) o
  corta (`:860-863`), y al cortar con `revisadas === 0` el resultado es
  `cortadosPorReloj = pendientes.length > 0`. `conciliarLineas` devuelve un
  resultado por línea, así que ningún grupo puede tener `resultados.length === 0`.

Es decir: `revisadas === 0 && cortadosPorReloj === 0` ⟺ la cola estaba vacía.
La guarda nueva es exactamente esa equivalencia. Correcta.

**2. La bitácora: CIERRA para la escala reportada (1,000), subdeclara arriba
de ella.** `page.tsx:243` deriva `'parcial'` de `cortadosPorReloj` y `:248` pone
`tareasTotal = revisadas + cortadosPorReloj`. Las dos cosas son ciertas
**dentro de la pasada**. Pero las dos se calculan sobre `pendientes`, que
`consolidado.ts:779` topa con `.limit(1000)`: con 2,500 líneas
`por_conciliar`, la corrida se archiva como «20/1000 · Parcial» sobre una cola
de 2,500. Es la parte que queda, y la reporto abajo como FE-31C2-M1 porque
también contradice una cifra impresa en la misma tarjeta.

**3. No se aplicó al hermano: NO cierra la clase.** El mensaje del commit dice
que el patrón es «el mismo del latido de los crons», pero
`agentes/cobranza/page.tsx:124` —la otra Server Action del panel que llama
`registrarCorrida`, con el mismo reloj de 25 s y el mismo `cortadosPorReloj` en
su resultado— quedó intacta. Ver FE-31C2-A1.

---

## Estado de los nueve hallazgos abiertos

Reverificados hoy, `archivo:línea` abierto y leído, no inferido.

| Hallazgo | Hoy | Ancla de hoy |
|---|---|---|
| **FE-C1** CRÍTICO — el despacho no ofrece el Anticipo | **REINCIDENTE (7ª ronda)** | `grep -rn 'name="anticipo"' src/` → **una** línea, `forma-viaje.tsx:92`. `forma-viaje.tsx:90` sigue siendo `{puedeCapturarDinero && <div>`; `despacho/page.tsx:163-164` sigue con `… : 0`; `src/lib/auth/visibilidad.ts:41` sigue `encargado: ['operacion']` |
| **FE-A1** ALTO — el chat afirma «todavía no hay datos de acreditables» estando ciego | **REINCIDENTE** | `chat/page.tsx:49-50`, los dos `.catch((): X \| null => null)`, intactos; `chat.tsx:94` y `:146` intactos |
| **FE-A2** ALTO — la cola de Timbrado topa en 25 y pinta el tope como total | **REINCIDENTE** | `timbrado/page.tsx:44` sigue sin segundo argumento; `:82` sigue siendo `{numero(filas.length)} en la cola.`; `carta_porte_timbre.ts:456` sigue con `limite = 25` |
| **FE-M2** MEDIO — mensaje crudo de PostgREST en pantalla | **REINCIDENTE, 3 sitios exactos** | `arco/page.tsx:167`→`:211`; `conversaciones/page.tsx:51`→`:90`; `sat_descarga/bandeja.ts:251`+`:257`→`descarga-sat/bandeja/vista.tsx:277`. Busqué un cuarto y **no lo hay**: `mapa/page.tsx:136` captura `e.message` pero devuelve una frase nuestra (`:138`), con el comentario que lo explica |
| **FE-M3** MEDIO — «Estado» de Descarga del SAT en crudo | **REINCIDENTE** | `descarga-sat/vista.tsx:353` sigue siendo `<td className="py-1">{s.estado}</td>` |
| **FE-M4** MEDIO — tres eventos sin rótulo en el expediente de incidencias | **REINCIDENTE** | `mesa_control.ts:331` sigue `Record<string, string>` con 24 claves; `aviso_jefe_encolado`, `cotizacion_no_avisada` y `reloj_legal_avisado` siguen sin aparecer en él (`grep -n` dentro del archivo: cero coincidencias) |
| **FE-M5** MEDIO — «Lo que llevas este mes» desaparece sin decirlo | **REINCIDENTE** | `suscripcion/page.tsx:118` (`safe<UsoDelPlan>`) y `:365` (`{uso && (`) intactos |
| **FE-B1** BAJO — la corrida parcial desaparece del resumen de `/admin/crons` | **REINCIDENTE** | `crons/vista.tsx:199` sigue siendo `const malos = [...sinLatir, ...conFallo]`, con `parciales` desestructurado en `:198` y usado solo en la rama buena |
| **FE-B2** BAJO — `FaseCosto` tiene 9 y las 4 copias de `FASE_LABEL` siguen en 6 o menos | **REINCIDENTE** | `costos.ts:41` nueve fases; `consola.tsx:29` seis; `model-ops/page.tsx:11` **tres** |

**Cero cierres, tercera ronda seguida.** Ninguno estaba mal reportado.

---

## Hallazgos

### [ALTO] FE-31C2-A1 · NUEVO — el «Ejecutar ahora» de Cobranza archiva como corrida SANA la que el reloj cortó a los 40 de 400, y también la que no corrió: es el mismo defecto que `065f699` acaba de arreglar en Peajes, en el sitio hermano que el arreglo no tocó
`src/app/dashboard/agentes/cobranza/page.tsx:124` (`estado: resultado.fallos.length > 0 ? 'parcial' : 'ok'`), `:127` (`tareasTotal: resultado.contactados + resultado.fallos.length`) y `:128` (`resumen: { contactados, fallos }`), contra `src/lib/likida/agentes/cobranza.ts:205` (`cortadosPorReloj`), `:287` (donde se llena), `:232` y `:235` (los dos `omitido`), y contra el sitio YA arreglado: `src/app/dashboard/agentes/peajes/page.tsx:243` y `:248`.

Escenario, con valores. Flota de 400 tractos, cierre de quincena. La cola de
cobranza trae **400** viajes en tier. El contralor entra a
`/dashboard/agentes/cobranza`, aprieta «Ejecutar ahora» y confirma
(`controles.tsx:48` le dice «¿Mandar WhatsApp a 400 choferes ahora?»).

1. `page.tsx:117-119` llama `ejecutarCobranza` con `venceEn: ahoraMs() + 25_000`.
2. Los envíos van en serie. A los 25 s se contactó a **40**, con **0 fallos**.
   `cobranza.ts:287` calcula `cortadosPorReloj = 400 − (40 + 0) = 360` y corta.
3. `page.tsx:124`: `resultado.fallos.length` es **0** → `estado: 'ok'`.
   `page.tsx:127`: `tareasTotal = 40 + 0 = 40`.
4. La ficha de corridas (`agentes/ficha-corridas.tsx:53` y `:75`) imprime, en
   la misma pantalla y **de forma durable**:

   > 15/09/2026 14:02 · **OK** · **40/40** · 25 s · Ejecutar ahora

   El acuse que sí dice la verdad (`controles.tsx:84-88`: «El reloj cortó la
   corrida — 360 sin tocar todavía») vive en `useActionState`: se evapora con
   el primer `router.refresh()` del efecto de `:37-38`, con la recarga, y con
   cualquier otro usuario que abra la página. **Lo único que sobrevive es el
   renglón que dice OK 40/40.**
5. `:128` guarda `resumen: { contactados, fallos }`, así que `cortadosPorReloj`
   tampoco queda en el detalle: `/admin/corridas/[id]:167-173` pinta las claves
   de ese objeto y ahí no está. En Peajes sí (`peajes/page.tsx:249` guarda
   `{ ...resumen }` completo).
6. **Segundo valor, peor todavía.** El mismo `estado` ignora `omitido`. Si el
   agente se pausó entre el render y el clic (otro usuario, otra pestaña),
   `cobranza.ts:232` devuelve `{revisados:0, contactados:0, omitido:'el agente
   está pausado', fallos:[], cortadosPorReloj:0}` → la bitácora archiva
   **«OK · 0/0»** para una corrida que NO CORRIÓ. La pantalla dice «El agente
   no corrió: el agente está pausado» y el registro permanente dice OK.
7. `tareasTotal` además deja fuera a `sinTelefono`: con 30 contactados y 10 sin
   teléfono, el acuse en pantalla dice «Contactó a 30 de 40 · 10 sin teléfono»
   y el renglón durable dice **30/30**. Dos cifras distintas del mismo hecho en
   la misma tarjeta.

Consecuencia: la bitácora de corridas existe para contestar «¿mi agente
trabajó?» (lo dice su propio comentario, `cobranza/page.tsx:147-148`). Hoy
contesta que sí sobre 360 choferes a los que nadie escribió. El contralor que
revisa por qué no le llegaron comprobantes ve una columna de renglones verdes y
concluye que el problema está del lado del chofer. Y el criterio de este
renglón es el mismo que `agentes/exito.ts` consume para sus alarmas.

Causa raíz probable: `estado` y `tareasTotal` se derivan solo de `fallos`, un
eje de tres que quedó en uno; los otros dos (`cortadosPorReloj`, `omitido`) ya
venían en el resultado y nadie los cableó. `065f699` cableó exactamente eso en
el hermano y no volvió sobre este.

---

### [MEDIO] FE-31C2-M1 · NUEVO — el acuse del barrido de Peajes dice «quedaron 960 fuera» y dos renglones abajo la misma tarjeta dice «y 2,454 más en la mesa»: el «quedaron» está topado en 1,000 y nadie lo declara
`src/lib/likida/intake/consolidado.ts:779` (`.limit(1000)`) y `:861` (`resumen.cortadosPorReloj = pendientes.length - resumen.revisadas`), contra `src/app/dashboard/agentes/peajes/controles.tsx:50` (la confirmación, que usa el total REAL), `:79-82` y `:95-96` (el acuse, que usa el topado), y contra `src/app/dashboard/agentes/peajes/vista.tsx:130` (`pendientes={lineas.total}`) y `:149-152` (`y {numero(lineas.total - 6)} más en la mesa`).

Escenario, con valores. Flota con TAG de 800 tractos, seis meses de
consolidados. `getLineasPorConciliar` cuenta con `count: 'exact'`
(`analytics.ts:1881`) y devuelve `total = 2500`.

1. `vista.tsx:130` pasa `pendientes = 2500`. El contralor aprieta «Ejecutar
   ahora» y `controles.tsx:50` le pregunta, literal:

   > ¿Barrer **las 2500 líneas pendientes** contra los gastos de hoy?

   Confirma. La promesa es de 2,500.
2. `barrerPorConciliar` lee la cola con `.limit(1000)` (`consolidado.ts:779`):
   `pendientes.length = 1000`. **Las otras 1,500 no entran a esta pasada y nada
   lo cuenta.**
3. El reloj de 25 s corta en la línea 40 → `:861` calcula
   `cortadosPorReloj = 1000 − 40 = 960`.
4. `controles.tsx:86-97` imprime:

   > Revisé **40** líneas pendientes; amarré 3 contra gastos nuevos; refresqué
   > candidatos de 12; siguen 37. Quedaron **960** fuera de esta pasada por
   > tiempo: vuelve a ejecutar para seguir donde se quedó.

   Y el efecto de `:37-38` refresca la página, así que dos renglones más abajo,
   en la misma tarjeta, `vista.tsx:151` dice **«y 2,454 más en la mesa»**.
   40 + 960 = 1,000. La tarjeta se contradice consigo misma por 1,494 líneas.
5. **«Vuelve a ejecutar para seguir donde se quedó» tampoco se sostiene para
   esas 1,500.** El SELECT de `:774-779` no lleva `ORDER BY`: la siguiente
   pasada vuelve a pedir «mil cualesquiera» de las 2,460 que quedan, y las que
   el planeador deje fuera pueden no entrar nunca. Son líneas cuya columna
   `candidatos` jamás se refresca — y ese refresco es, según el propio
   doc-comment de `:749-752`, la razón de existir del barrido: sin él «un gasto
   que llegó después del XML JAMÁS se puede elegir a mano».

Consecuencia: el contralor confirma un barrido sobre 2,500 líneas de estado de
cuenta de casetas, lee un acuse que cuadra en 1,000, y se queda con 1,500
líneas de peaje deducible que la mesa no le va a poder resolver nunca porque
sus candidatos están congelados el día del XML. Es la misma forma de FE-A2
(una lista topada que no declara su tope), aquí sobre una ESCRITURA y con el
agravante de que la cifra verdadera está impresa a tres centímetros.

Por qué MEDIO y no ALTO: hace falta una cola de más de 1,000 líneas, y el total
real sí está en pantalla —el contralor atento puede notar la contradicción—.

Causa raíz probable: `cortadosPorReloj` se define como «lo que quedó de la cola
LEÍDA», y la pantalla lo presenta como «lo que quedó de la cola». `065f699`
arregló el caso en que ese número era 0 y no dijo nada del caso en que es un
número topado.

---

### [BAJO] FE-31C2-B1 · NUEVO — la secuencia de pensamiento del chat del contralor rotula 11 de las 13 herramientas del analista; las dos que faltan salen con guiones bajos convertidos en espacios
`src/app/dashboard/chat.tsx:43-55` (`ETIQUETA_TOOL`, **11 claves**) y `:57` (`const rotuloTool = (t) => ETIQUETA_TOOL[t] ?? t.replaceAll('_', ' ')`), donde se pinta en `:899`; contra `src/lib/agents/analista.ts:42-47` (`TOOLS_LECTURA`, **12 nombres**) + `'entregar_respuesta'` (`:389`), y contra `src/lib/agents/chat-tools.ts:320` (`consultar_carta_porte`) y `:370` (`consultar_normas`).

Cómo lo conté (reproducible): `TOOLS_LECTURA` en `analista.ts:42` más
`terminalTools: ['entregar_respuesta']` es el juego completo de valores que
`onPaso` puede emitir (`analista.ts:324`, `:385`, `:452`), y llegan tal cual a
la interfaz por `api/dashboard/chat/route.ts:124`. Crucé esos 13 contra las 11
claves del mapa: faltan **`consultar_carta_porte`** y **`consultar_normas`**.

Escenario, con valores. El contralor teclea «¿necesito Carta Porte para el
viaje VJ-2026-0845?». El analista llama `consultar_carta_porte` y luego
`consultar_normas`. La caja de pensamiento pinta:

> Leyendo tus viajes…
> **consultar carta porte**…
> **consultar normas**…
> Armando la respuesta…

Dos de cuatro renglones en minúsculas y en infinitivo, entre dos que son
gerundios en español con mayúscula. Y son precisamente los dos pasos que tocan
materia legal, que es donde el producto quiere que se le crea.

Consecuencia: cosmético y no hay cifra mal — por eso BAJO. Lo que cobra factura
es la forma, que es la del rubro: `Record<string, string>` con `??`, así que
`tsc` no se pone en rojo cuando el catálogo de herramientas crece, y ya creció
dos veces sin que nadie lo notara. Es FE-B2/FE-M4 otra vez, en la pantalla que
se enseña en el demo.

---

### [BAJO] FE-31C2-B2 · NUEVO — la bandeja de Soporte del cliente imprime `categoria` y `prioridad` crudas de la base: «facturacion» y «tecnico» sin acento, en la pantalla donde la flota se queja con Likida
`src/app/dashboard/soporte/page.tsx:252-253` (`<td …>{t.categoria}</td>` y `{t.prioridad}`), `:300` (`{detalle.categoria}/{detalle.prioridad}`) y `:366` / `:372` (los dos `<select>` que pintan las claves como opciones), contra `src/lib/likida/comercial.ts:694-695` (`CATEGORIAS_TICKET = ['facturacion','operacion','tecnico','cuenta','otro']`, `PRIORIDADES_TICKET = ['baja','media','alta','urgente']`) y el `check` de `supabase/migrations/0051_soporte_y_cotizacion.sql:42-43`.

Escenario, con valores. El flota_admin abre `/dashboard/soporte` para reportar
que una factura no timbró. En el desplegable «Categoría» lee las cinco
opciones: `facturacion · operacion · tecnico · cuenta · otro`. Elige la
primera. En la tabla, su ticket aparece como:

| Asunto | Categoría | Prioridad | Estado |
|---|---|---|---|
| No timbró CFDI de agosto | **facturacion** | **alta** | Abierto |

«Estado» sí está traducido —`pillTicket`, `soporte/estatus.ts:21`, que existe
exactamente porque la auditoría 21 encontró «en_proceso» crudo en esta misma
fila—, y las dos columnas de al lado se quedaron sin ese tratamiento. El
archivo lo explica por escrito en `:16-19` y no lo extendió.

Segundo sitio con la misma causa: `src/app/dashboard/cotizaciones/page.tsx:277`
pinta `{q.estado}` crudo en una píldora, y las cinco del dominio
(`0051:95`: borrador/enviada/ganada/perdida/vencida) comparten el mismo
`background: var(--canvas)` — una cotización **perdida** se ve idéntica a una
**ganada**.

Consecuencia: el cliente lee castellano sin acentos en la pantalla que usa
para juzgar el soporte de su proveedor; es la primera impresión de posventa.
Bajo porque no hay cifra mal y todas las palabras son legibles.

Causa raíz probable: cada dominio nuevo llega como `text` con `check` y el
rótulo se agrega solo cuando alguien lo ve feo. No hay nada que obligue a que
una constante `as const` exportada traiga su diccionario — el patrón de
`Record<EstadoTicket, …>` que este mismo archivo ya usa para `estado` está a
una importación de distancia.

---

## Lo que revisé y está bien

Todo abierto y leído hoy; los intentos de romperlo van descritos. Vale tanto
como los hallazgos.

- **El censo de mapas contra su dominio real, ampliado a 16.** La regla del
  rubro dice que esto es trabajo obligatorio; lo extendí a los mapas que la
  ronda anterior no tocó. **Exhaustivos por TIPO (`tsc` obliga, no se pueden
  desincronizar):** `ROTULO_DIFERENCIA` (`agentes/liquidacion/rotulo-diferencia.ts:18`,
  `Record<TipoDiferencia, string>`, las ~50 de `types/likida.ts:94-138`),
  `ROTULO_REVISION` y `ROTULO_VACIO` (`liquidacion/cola.tsx:33` y `:42`, 4/4 de
  `RevisionLiquidacion`), `PILL_TICKET` (`soporte/estatus.ts:21`, 5/5, con el
  comentario que explica por qué NO es `Record<string,…>`), `ROTULO_FASE` y
  `ROTULO_SIN_MONTO` (`facturacion/estadias.tsx:39` y `:46`, 4/4 cada uno),
  `MOTIVO` (`huerfanos/vista.tsx:12`, 3/3), `ESTADO_PILL`
  (`suscripcion/page.tsx:57`, 5/5).
  **`Record<string,…>` cruzados a mano contra el dominio real y exactos:**
  `CONCEPTO` (`[id]/page.tsx:32`) y `CONCEPTO_LABEL`
  (`gasto-semanal-chart.tsx:13`), **9/9** los dos contra `ConceptoGasto`
  (`types/likida.ts:20-25`) y vigilados por `etiquetas_sincronizadas.test.ts`;
  `ESTATUS` (`dashboard/estatus.ts:17`, 3/3 de `EstatusLiquidacion`);
  `PILL_ESTATUS` (`resumen-visual.tsx:103`, 3/3 del constraint
  `viaje_estatus_dominio`); `ROTULO` (`[id]/revision-panel.tsx:68`, 4/4);
  `ROTULO_ESTADO` (`liquidacion/cola.tsx:48`, 3/3); `MOTIVO_ERROR`
  (`combustible-casetas/page.tsx:33`, **5/5** contra los cinco literales de
  `ResultadoResolverLinea.motivo`, `consolidado.ts:563`); `FORMA_PAGO` y
  `ETIQUETA_CAPTURA` (`[id]/vista.tsx:149` y `:190`, el primero con su propia
  prueba `etiqueta_forma_pago.test.ts`); `PILL` (`agentes/ficha-corridas.tsx:15`,
  3/3 de `EstadoCorrida`, `corridas.ts:72`, que es el mismo juego del `check`
  de la `0102`).
  **Uno parcial A PROPÓSITO y verificado como tal:** `PILL_ESTATUS`
  (`facturacion/vista.tsx:327`) cubre 2 de los 4 estados de
  `factura_estatus_dominio`, y `:395`+`:410` usan `{pill && …}` — «emitida» y
  «pagada» no llevan píldora por diseño, no por olvido; la información está en
  las columnas Pagado/Saldo/Antigüedad del mismo renglón.
  Los tres desincronizados son `ETIQUETA_TOOL` (nuevo hoy), `ROTULO_EVENTO`
  (FE-M4) y las cuatro copias de `FASE_LABEL` (FE-B2).
- **La alternativa a FE-M2 no es un hallazgo suelto: es un patrón ya ganado.**
  Busqué un cuarto sitio que filtre el mensaje del motor a pantalla barriendo
  los 60 usos de `e instanceof Error ? e.message : String(e)` en `src/app`.
  Todos menos los tres de FE-M2 van a `logger` o a una frase nuestra. El caso
  más instructivo es `mapa/page.tsx:128-138`: captura el `e.message`, lo manda
  al `logger.warn` **y devuelve `'no se pudo leer el rastreo de la flota'`**,
  con ocho líneas de comentario explicando que la frase que sale de ahí tiene
  que ser nuestra siempre. Ese es el sitio donde el patrón ya se cerró.
- **El foco visible de los radios `sr-only` está cerrado de verdad, y lo
  ataqué.** `globals.css:398` es `label:has(> input.sr-only:focus-visible)` con
  `outline: 3px solid`. La regla exige hijo DIRECTO; verifiqué los dos sitios
  que la necesitan: `[id]/revision-panel.tsx:135-136` (los tres radios de la
  firma) y `agentes/cobranza/estrategia.tsx:107-108` (los días de la
  estrategia) — en los dos el `<input className="sr-only">` es hijo directo del
  `<label>`. Y `revision_panel.test.tsx:86-97` congela las dos mitades: el HTML
  y la regla CSS.
- **Los tokens de fondo de las píldoras existen en los DOS temas.** Sospeché de
  `ficha-corridas.tsx:17` (`var(--warnbg, var(--canvas))` — un fallback sugiere
  un token que no existe) y fui a verlo: `globals.css:111-115` define
  `--okbg`/`--warnbg`/`--badbg` en claro y `:165-167` los redefine en oscuro.
  El fallback es cinturón, no parche. `liquidacion/cola.tsx:48-52`, que los usa
  SIN fallback, está a salvo.
- **`calcular-alertas-flota.ts` es el mejor ejemplo de «cuatro estados a
  propósito» del panel, y el gate por rol no lo rompe.** `:99-111` convierte
  cada señal `null` en su PROPIA alerta («No se pudo revisar X — el dato de
  abajo está incompleto, no en cero»), antes que todo lo demás. Ataqué el
  filtro final de `:174-175`, que podría tragarse esa alerta si el rol no
  pudiera abrir su destino: su `href` es `/dashboard/soporte`, y
  `visibilidad.ts:272-276` lo mete en `RUTAS_TODO_ROL`, así que la ve todo rol
  conocido. El contador (solo `dinero`) sí puede abrir `/dashboard/notificaciones`
  por la misma razón.
- **`/dashboard/contador` — la casa del comprador — separa `null` de cero en
  las siete secciones.** `inicio-contador.tsx:398-425` cuenta cuántas cayeron y
  tiene DOS mensajes distintos («No se pudieron cargar los datos» vs «Faltan
  datos por cargar — esta pantalla está incompleta … No tomes estas cifras como
  el corte del periodo»); `:434-440` y `:459-462` y `:532-535` dan a cada
  bloque su propia frase; `:536-542` distingue «0 comprobantes leídos» medido
  de lectura caída. El export CSV de `:201` declara en el rótulo que se lleva
  el mes («Exportar CSV del mes»), que es lo que FE-A2 no hace.
- **`/dashboard/rentabilidad` sobrevive a un `?p=99`.** `page.tsx:34` clampa a
  1..1000, `comercial.ts:322-323` vuelve a clampar, y `rentabilidad/vista.tsx:42-49`
  imprime «0–0 de N» en vez de una tabla vacía muda, con `hayMas` calculado de
  las consumidas para no ofrecer «Siguientes» hacia otro vacío (`:197-206`).
- **`key` de React en tablas de dinero: cero regresiones.** Re-barrí los 60
  `key={i}` de `src/app`. Los que quedan en `/dashboard` con dinero encima
  —`agentes/liquidacion/vista.tsx:102`/`:266`, `agentes/cobranza/vista.tsx:137`,
  `agentes/conductores/vista.tsx:151`/`:283`, `cotizaciones/page.tsx:286`,
  `descarga-sat/vista.tsx:380`— están **todos en Server Components** (ninguno
  de esos archivos abre con `'use client'`; lo verifiqué archivo por archivo).
  El único `key={i}` en un componente cliente sobre datos variables es
  `agentes/cobranza/controles.tsx:90`, y la lista que indexa (`r.fallos`) es
  inmutable dentro de un mismo resultado de acción.
- **Compuerta de mi rubro, corrida por mí:** `npx vitest run src/app` → **251
  archivos / 2,283 pruebas, todas verdes**; `npx tsc --noEmit -p .` → exit 0.
  La prueba nueva `peajes/acuse-corte.test.tsx` corre dentro de ese total.

---

## Lo que NO alcancé a revisar

- **Sigo sin mirar un render.** `npm run build` está prohibido en este entorno.
  Todo lo de arriba es lectura de fuente, aritmética y ejecución de pruebas.
  Siguen sin verse: el `grid-cols-3` de `despacho/vista.tsx:112` a 375 px, los
  `min-w-[190px]` de `motor-fiscal-periodo.tsx:60,75`, y si el renglón de
  `cotizacion_no_avisada` (FE-M4) se distingue del de al lado.
- **El formato del delta de `StatCard` quedó como sospecha sin cerrar.**
  `admin/ui/kit.tsx:195` imprime `{Math.abs(delta.pct)}%` en crudo, y
  `pctCambio` (`lib/formato.ts:162`) devuelve `round2`, así que la misma fila
  de cuatro tarjetas puede decir «↑ 5%», «↑ 12.34%» y «↑ 8.5%», mientras el
  preset `'porcentaje'` de `formato-preset.ts:30` redondea a entero. **No lo
  reporto como hallazgo** porque es formato y no cambia el significado —
  necesito el render para decidir si se nota. Queda anotado para la próxima.
- **Tamaños de toque:** no medidos, cuarta ronda. `BOTON_PERIODO`
  (`kit.tsx:111`) ya declara 24×24 con su porqué; los candidatos siguen siendo
  el `BTN_CHICO` de `emergencias/page.tsx:188` y los `py-0.5` del kit.
- **Orden de foco y navegación por teclado más allá de los radios `sr-only`:**
  sin revisar, cuarta ronda.
- **`/admin` en profundidad:** `admin/qa/*`, `admin/vendedores/tablero.tsx`,
  `admin/observabilidad` y `admin/copiloto.tsx` (que tiene su propio
  `ETIQUETA_TOOL` en `:81`, no cruzado hoy) quedan sin abrir salvo por el censo.
- **`/demo`, `/pago/[token]`, `/aviso/[tenant]`, `/calculadora`, `/login`,
  `/blog`, `/legal`:** solo grepeados.
- **Ningún hallazgo lo fijé con prueba**, porque no puedo escribir en el repo
  fuera de este entregable. Los cuatro son deterministas: FE-31C2-A1 con el
  mismo patrón de `acuse-corte.test.tsx:94-101` aplicado a
  `cobranza/page.tsx`; FE-31C2-M1 sembrando `barrerPorConciliar` con una cola
  de 2,500 y afirmando que `revisadas + cortadosPorReloj === 1000 < total`;
  FE-31C2-B1 cruzando `TOOLS_LECTURA` contra `Object.keys(ETIQUETA_TOOL)` —el
  mismo patrón que `etiquetas_sincronizadas.test.ts` ya usa para `CONCEPTO`—;
  FE-31C2-B2 afirmando que el HTML de `/dashboard/soporte` no contiene
  `>facturacion<`.
