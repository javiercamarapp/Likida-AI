# Frontend — auditoría 31

**Nota: 5/10** (antes 5). **No se movió**, y el movimiento no se fuerza: la
ventana no trajo una sola línea de `src/` (el MAPA lo documenta: los dos
commits tocan `normas/.latido-*`), así que «se atacó y subió» es imposible por
construcción y «deuda que cobró factura» tampoco aplica —nada se rompió porque
nada entró—. Queda «mirada más profunda», y esa la gasté: abrí las tres
superficies que la 30 dejó escritas como no revisadas (`/dashboard/timbrado`,
`/dashboard/suscripcion` completa, `/dashboard/asistencia`) y salió un **ALTO
nuevo** que llevaba ahí desde la 0227. Pero esa misma mirada devolvió defensas
que la 30 no había contado y que sostienen el 5 contra la baja: **los dos
paginadores del panel clampan un `?p=` fuera de rango** (`paginar-registro.ts:81`
y `administracion.ts:765`/`:1327`), **4 de las 5 listas topadas del panel
declaran su tope** en pantalla, y el censo de mapas contra su dominio salió
**8 de 9 exacto**.

Lo contable de hoy, para que mañana se distinga de una impresión:

| Medida | Hoy |
|---|---|
| Hallazgos abiertos de la 30 verificados uno por uno | **6 de 6 intactos**, línea por línea |
| Archivos de producción de mi superficie tocados en la ventana | **0** |
| `npx vitest run src/app` | **250 archivos / 2,277 pruebas, verde** |
| `npm run typecheck` | limpio |
| Escapes de formato de cifra fuera de `lib/formato.ts` en `src/app` | **0** (17 apariciones de `toFixed/toLocaleString`, todas geometría SVG, coordenadas o texto de error de API) |
| Tablas sin contenedor `overflow-x-auto` | **1 de 47 archivos**, y es `/admin/qa` (interna) |
| Paginadores que clampan `?p=` fuera de rango | **2 de 2** |
| Listas topadas que DECLARAN el tope en pantalla | **4 de 5** (la que no: `/dashboard/timbrado` → FE-A2) |
| Mapas de rótulo cruzados contra su dominio real | **9**; exactos **8**; desincronizado **1** (`ROTULO_EVENTO`, 3 tipos sin rótulo → FE-M4) |
| `min-w-[Npx]` por encima de 360 en `src/app` | **0** (máximo 260px) |

**Riesgo mayor del rubro, hoy:** sigue siendo FE-C1 en su **sexta** ronda —el
viaje nace con anticipo 0 y la pantalla de firma presenta ese cero como una
medición—, y detrás de él, dos colas que el contador usa para decidir dinero y
papel (`/dashboard/timbrado` y `/dashboard/chat`) que afirman en firme sobre
datos que no vieron completos.

---

## Estado de los seis hallazgos abiertos de la 30

Verificados hoy, con `archivo:línea` abierto y leído, no inferido.

| Hallazgo de la 30 | Hoy | Ancla de hoy |
|---|---|---|
| **FE-C1** CRÍTICO — el despacho no ofrece el Anticipo | **REINCIDENTE (6ª ronda)** | `grep -rn 'name="anticipo"' src/` → **una** línea, `forma-viaje.tsx:92`. `forma-viaje.tsx:90` sigue siendo `{puedeCapturarDinero && <div>`; `despacho/page.tsx:163-164` sigue con `… : 0` |
| **FE-A1** ALTO — el chat afirma «todavía no hay datos de acreditables» estando ciego | **REINCIDENTE** | `chat/page.tsx:49-50`, los dos `.catch((): X \| null => null)`, intactos; `chat.tsx:94` (`sinLiq`) y `chat.tsx:146` intactos; `respuestaLocal` en `chat.tsx:175-184` sigue anteponiendo el aviso a una frase que es un dato |
| **FE-M2** MEDIO — mensaje crudo de PostgREST en pantalla | **REINCIDENTE, 3 sitios, ni uno más ni uno menos** | `arco/page.tsx:167` → `:211`; `conversaciones/page.tsx:51` → `:90`; `sat_descarga/bandeja.ts:251`+`:257` → `descarga-sat/bandeja/vista.tsx:277`. Busqué un cuarto sitio: `chat.tsx:830` pinta `errorCarga`, pero lo que se le mete es un texto nuestro (`chat.tsx:456`), no el del motor — ese no cuenta |
| **FE-M3** MEDIO — la columna «Estado» de Descarga del SAT imprime el valor crudo | **REINCIDENTE** | `descarga-sat/vista.tsx:353` sigue siendo `<td className="py-1">{s.estado}</td>`, sin mapa de rótulo, contra los 6 valores del dominio de la `0231` |
| **FE-B1** BAJO — `/admin/crons`: la corrida parcial desaparece del resumen cuando hay otro reloj caído | **REINCIDENTE** | `crons/vista.tsx:199` `const malos = [...sinLatir, ...conFallo]` (sin `parciales`); `:216` la rama buena, única que menciona `parciales` (`:220-224`); `:226-243` la rama mala, que no los nombra. `resumenRelojes` (`:186-194`) sí los calcula |
| **FE-B2** BAJO — `FaseCosto` creció a 9 y las 4 copias de `FASE_LABEL` siguen en 6 o menos | **REINCIDENTE** | `costos.ts:41` nueve fases; `consola.tsx:29`, `analitica/page.tsx:12`, `costos-facturacion/page.tsx:65` con **6** claves cada una; `model-ops/page.tsx:11` con **3** |

**Cero cierres, segunda ronda seguida.** Ninguno estaba mal reportado: los seis
existen exactamente como se describieron.

---

## Hallazgos

### [CRÍTICO] FE-C1 · REINCIDENTE (SEXTA ronda) — el despacho sigue sin ofrecer el Anticipo: el viaje nace en 0 y la pantalla de firma presenta ese cero como una medición
`src/app/dashboard/forma-viaje.tsx:90` (el campo, tras `{puedeCapturarDinero &&
…}`) y `:174-177` (los Kilómetros que lo sustituyen);
`src/app/dashboard/despacho/page.tsx:163-164` (`… : 0`) y `:198`;
`src/lib/auth/visibilidad.ts:41` (`encargado: ['operacion']`), contra
`src/app/dashboard/[id]/detalle.tsx:241` (`Anticipo`) y `:245-249`
(`Diferencia`).

Escenario, con valores, reverificado hoy archivo por archivo. Flota con jefe de
tráfico (`rol = 'encargado'`). Despacha `VJ-2026-0845` Silao → Monterrey con
**$20,000** de anticipo en efectivo al chofer.

1. `puedeVerArea('encargado','dinero')` es `false` (`visibilidad.ts:41`) →
   `forma-viaje.tsx:90` **no pinta el campo Anticipo**; `:175` pinta
   «Kilómetros» en su lugar. Nada en pantalla dice que el anticipo lo captura
   alguien más.
2. `despacho/page.tsx:163`: `fd.get('anticipo')` es `null` → `:164` deja
   `anticipo = 0` y `:198` lo escribe. La columna es `NOT NULL DEFAULT 0`: un 0
   tecleado y un 0 por ausencia son indistinguibles para siempre.
3. Comprobantes por **$18,400** → `diferencia = round2(0 − 18400) = −18400`.
4. `/dashboard/[id]` pinta, uno junto al otro en la misma fila de KPIs:
   `Anticipo $0.00 · entregado al operador` (`detalle.tsx:241`) y
   `Diferencia $18,400.00 · faltante · a favor del operador` en tono `bad`
   (`:245-249`).
5. **Sigue sin haber dónde arreglarlo después.** `grep -rn 'name="anticipo"'
   src/` devuelve hoy **una sola línea**: `forma-viaje.tsx:92`. Los únicos
   escritores de `viaje.anticipo` siguen siendo los dos CREADORES
   (`despacho/page.tsx:198` y `api/v1/viajes/route.ts`); no existe un `update`.

Consecuencia: el contralor firma una liquidación cuya cifra principal está mal
por el monto entero del anticipo, y el PDF que el chofer conserva afirma que la
empresa le debe $18,400 que ya cobró. La flota que más se parece al comprador
—la que tiene jefe de tráfico dedicado— es exactamente la que cae.

Causa raíz probable: el bloqueo de la captura financiera se resolvió ocultando
el campo en el render, sin decidir quién captura entonces el dato que el motor
necesita ni cómo se representa «no capturado» en una columna `NOT NULL DEFAULT
0`. Es una decisión de producto pendiente, no un defecto de render — y por eso
lleva seis rondas sin moverse.

(REINCIDENTE, 6ª ronda.)

---

### [ALTO] FE-A2 · NUEVO — la cola de Timbrado topa en 25 en silencio, tira las solicitudes MÁS VIEJAS, y luego imprime el tope como si fuera el total
`src/app/dashboard/timbrado/page.tsx:44` (la llamada, sin límite) y **`:82`**
(`{numero(filas.length)} en la cola.`), contra
`src/lib/likida/carta_porte_timbre.ts:456` (`listarTimbrado(tenantId: string,
limite = 25)`), `:465` y `:471` (los dos `.limit(limite)`) y `:502`
(`faltan.slice(0, limite)`). El pie de la pantalla que declara su propia
semántica: `page.tsx:112-116`.

Escenario, con valores. Flota mediana, cierre de mes. **40** viajes tienen su
borrador de Carta Porte trabajado (`ccp_xml_generado_en` no nulo) y ninguno
timbrado. El contador abre `/dashboard/timbrado`.

1. `page.tsx:44` llama `listarTimbrado(tenantId)` sin segundo argumento → el
   default `limite = 25` de `:456`.
2. `:460-465` pide los viajes `.order('ccp_xml_generado_en', { ascending: false
   }).limit(25)` → vuelven **los 25 más recientes**. Los **15 más viejos** —los
   que llevan más días esperando timbre, o sea los que más urgen— no vuelven.
3. `listarTimbrado` **no hace ningún `count`**: no devuelve total, ni `hayMas`,
   ni cursor. `RenglonTimbrado` (`:436-443`) no tiene dónde ponerlo.
4. `page.tsx:82` imprime, literal:

   > **25** en la cola. Primero lo que pide acción.

   Y el pie (`:112-116`) reafirma la semántica completa: *«Esta cola lista los
   viajes cuyo XML de Carta Porte ya se generó alguna vez y los que ya tienen
   timbre o reserva»*. Con 40 viajes, esa frase es falsa: lista 25 de ellos.
5. **No hay salida.** La pantalla no tiene paginación, ni «ver más», ni filtro:
   leí las 119 líneas del archivo. Los 15 viajes no aparecen por ningún camino
   de esta ruta.
6. **Y para el contador no hay otra ruta.** `visibilidad.ts:41` le da
   `contador: ['dinero']`; `/dashboard/carta-porte` está declarada
   `'operacion'` (`visibilidad.ts:105`) y `/dashboard/timbrado` `'dinero'`
   (`:174`). Esta pantalla existe, según su propio comentario de cabecera
   (`page.tsx:18-27`), precisamente porque «el contador no podía siquiera
   abrir» la de Carta Porte. Es su única vista del universo a timbrar.

Consecuencia: el contador timbra 25 complementos, ve la cola vacía y cierra el
mes creyendo que terminó. Los 15 viajes más viejos —los de mayor exposición al
plazo del complemento— nunca se timbran, y nada en pantalla dijo que existieran.
Es una infracción de Carta Porte por omisión, causada por una lista que se
presenta como completa.

Por qué ALTO y no CRÍTICO: no hay una cifra de dinero mal en pantalla y el demo
no se cae. Es falla silenciosa, que es exactamente la definición de ALTO.

Causa raíz probable: la función de lectura trae un `limite` con default y no
devuelve el total, y la página presenta `filas.length` como un conteo. La casa
ya resolvió este mismo problema cuatro veces —`mapa/page.tsx:75` tiene un
`contarVivos` aparte y `mapa/vista.tsx:112` dice *«Se dibujan los N … de M»*;
`viajes-recientes.tsx:14-17` documenta por escrito que *«Ver los 100» NO puede
sonar a «ver todos»*; `registro-filtro.tsx:67-69` imprime el «N de M»;
`suscripcion/page.tsx` declara `LIMITE_FACTURAS_SAAS`— y esta pantalla es la
única de las cinco que no lo hace.

Cómo se fija con prueba (determinista, sin red): sembrar `listarTimbrado` con
25 filas y afirmar que el HTML **no** contiene la frase `25 en la cola` sin una
declaración de tope al lado.

---

### [MEDIO] FE-M4 · NUEVO — tres eventos que el producto SÍ escribe no tienen rótulo, y salen como identificadores de base dentro del expediente que la flota le enseña a su aseguradora
`src/lib/likida/mesa_control.ts:331-355` (`ROTULO_EVENTO`, **24 claves**)
contra sus escritores reales: `src/lib/likida/asistencia_camara.ts:184` y
`:242` (`aviso_jefe_encolado`),
`src/lib/likida/asistencia_coordinacion.ts:696` (`cotizacion_no_avisada`) y
`src/lib/likida/relojes_legales.ts:299` y `:327` (`reloj_legal_avisado`,
constante en `:121`). Donde se pinta:
`src/app/dashboard/asistencia/page.tsx:208`
(`{ROTULO_EVENTO[e.tipo] ?? e.tipo}`).

Cómo lo conté (reproducible): junté todos los literales que llegan como tercer
argumento de `anotarEventoIncidencia(` en `src/lib` y `src/app` sin pruebas, los
crucé con las claves del mapa, y aparté los que no cuadran. Salen **tres**, y
los tres están escritos por código de producción vivo.

Escenario, con valores. Flota con cámaras en cabina. La cámara de la unidad
`EC-214` detecta una frenada brusca a las 03:10 de un martes; el aviso al jefe
se encola (`asistencia_camara.ts:184`, rama `aviso ? 'aviso_jefe_encolado' :
…`). Más tarde el chofer reporta avería, la mesa autoriza coordinación con
«Grúas García», el proveedor contesta con ETA y precio, y el `sendButtons` al
jefe falla porque la ventana de 24 h de Meta está cerrada
(`asistencia_coordinacion.ts:694`) → se escribe `cotizacion_no_avisada`. El
reloj legal de jornada anota su paso (`relojes_legales.ts:299`). El jefe abre
`/dashboard/asistencia`, despliega «Timeline del expediente» y lee:

> 03:10 — La cámara de la unidad detectó el evento y abrió el expediente
> 03:10 — **aviso_jefe_encolado**
> 06:44 — El chofer reportó y se abrió el expediente
> 07:02 — El jefe autorizó contactar a un proveedor
> 07:31 — El proveedor respondió con su cotización
> 07:31 — **cotizacion_no_avisada**
> 08:00 — **reloj_legal_avisado**

Tres de siete renglones en el idioma de la migración, con guion bajo, entre
cuatro que son frases en español. Y el peor de los tres es
`cotizacion_no_avisada`: es la línea que dice *«la cotización llegó y NADIE fue
avisado»* —la alarma que la auditoría 28 metió a propósito (AG-A4, comentario en
`asistencia_coordinacion.ts:690-693`)— y se pinta con el mismo peso, el mismo
color y el mismo tamaño que «Mensaje del proveedor agregado al expediente». El
renglón que avisa de una falla es el que menos se lee.

Consecuencia: el expediente de incidencias es lo que la flota le presenta a su
aseguradora y a su abogado cuando hay un siniestro. Tres renglones ilegibles
—uno de ellos el de una alarma, otro el del reloj de jornada de la LFT— en el
documento que sustenta una reclamación. Y `aviso_jefe_encolado` no es un caso
raro: es el camino de ÉXITO de toda incidencia originada por cámara, así que en
una flota con cámaras aparece en cada expediente.

Causa raíz probable: `ROTULO_EVENTO` es `Record<string, string>` y el dominio de
`incidencia_evento.tipo` quedó deliberadamente abierto en la base — la `0291`
lo dice por escrito en `:40-46` («sus escritores pasan `tipo` como VARIABLE …
un dominio incompleto rechazaría el evento legítimo de un siniestro en curso»).
La decisión de base es correcta; lo que falta es el otro lado: nada obliga a que
un tipo nuevo traiga su rótulo, así que `tsc` nunca se pone en rojo y el `??`
convierte el desfase en algo que no falla nunca, solo se lee mal. Es la misma
forma exacta de FE-B2, en una pantalla con más consecuencia.

---

### [MEDIO] FE-M5 · NUEVO — en Plan & Facturación, «Lo que llevas este mes» DESAPARECE sin decir nada cuando la lectura se cae; es la única de las cuatro secciones de esa página que se calla
`src/app/dashboard/suscripcion/page.tsx:118` (`const uso = await
safe<UsoDelPlan>(() => getUso(tenantId, planActual))`) y **`:365`**
(`{uso && (`), contra `src/lib/saas/suscripcion.ts:209-233` (la firma y los dos
`throw`) y contra las otras tres secciones de la MISMA página, que sí lo dicen:
`:325` (`No se pudo leer tu suscripción ahora mismo`), `:448` (`No se pudieron
leer los planes.`) y `:491` (`No se pudieron leer las facturas.`).

Escenario, con valores. Flota en el plan «Operación» con tope de 200 viajes al
mes; lleva **231** este mes. El `count exact, head` sobre `operador` topa con el
pooler saturado un lunes a mediodía.

1. `getUso` está declarado `Promise<UsoDelPlan>` y **nunca devuelve `null`**:
   falla cerrado y lanza (`suscripcion.ts:224` y `:225`). Después de `safe()`,
   `uso === null` significa **una sola cosa: la lectura falló**. No existe el
   caso «leyó y no había nada» — una flota sin viajes devuelve
   `{ viajesMes: 0, … }`, no `null`.
2. `page.tsx:365` es `{uso && (`. Con `uso === null` **no se pinta nada**: se
   evapora el encabezado «Lo que llevas este mes», las dos barras de uso y la
   leyenda que explica que pasarse del límite no apaga nada. La página se
   renderiza completa y sin un hueco visible: Estado, Planes y Facturas siguen
   ahí, y entre «Tu plan» y «Datos para tu factura» simplemente ya no hay nada.
3. El contralor —que entró justamente a ver si ya se pasó del plan— no ve ni la
   cifra ni un aviso. Recarga y a lo mejor aparece; si no recarga, concluye que
   esa sección no aplica a su cuenta.

Consecuencia: la única señal de «vas 231 de 200, hay que hablar de subir de
plan» se puede desvanecer sin dejar rastro, y el patrón contradice a las otras
tres secciones de su propia pantalla. Es la misma forma de FE-A1 —un `null` que
solo puede significar «no pude leer» renderizado como «aquí no hay nada»—, un
escalón más abajo porque no se afirma ninguna cifra falsa.

Por qué MEDIO y no ALTO: es silenciosa, sí, pero lo que se pierde es una señal
comercial de Likida, no una cifra fiscal del contralor, y no se imprime ningún
número equivocado.

Causa raíz probable: `safe()` colapsa «falló» y «no aplica» en el mismo `null`,
y el render usó el atajo `{x && …}` en vez de la rama de tres estados que el
resto del archivo sí escribió.

---

### [MEDIO] FE-M2 · REINCIDENTE — el mensaje crudo de PostgREST sigue en Privacidad, en Conversaciones y en la bandeja de conciliación del SAT
`src/app/dashboard/arco/page.tsx:167` (el `catch`) y **`:211`** (donde se
pinta); `src/app/dashboard/conversaciones/page.tsx:51` y **`:90`**; y
`src/lib/likida/sat_descarga/bandeja.ts:251` (`throw new Error(error.message)`)
→ `:256-258` (`return { ...vacia, error: detalle }`) →
`src/app/dashboard/descarga-sat/bandeja/vista.tsx:277`.

Escenario, con valores (sin cambios respecto de la 30, reverificado). Se aplica
una migración y un `GRANT` no alcanza sobre `sat_cfdi_descargado`. El contralor
entra a `/dashboard/descarga-sat/bandeja?estatus=ambiguo`, que es donde decide a
qué gasto se liga cada CFDI deducible. `leerBandeja` atrapa, loguea bien
(`logger.warn('sat_descarga.bandeja_no_leida', …)`) y además devuelve el mismo
string a la pantalla, que lo imprime literal:

> No se pudo leer esta lista, así que NO significa que esté vacía: **permission
> denied for table sat_cfdi_descargado**

Consecuencia: el cliente lee el nombre de una tabla interna dentro de la
pantalla donde decide una deducción fiscal, y no puede accionar nada con eso.
La casa ya decidió que esto no se hace y tiene la herramienta escrita:
`lib/likida/errores.ts:64-70` (`mensajeParaPantalla`) registra con `logger` y
devuelve una frase nuestra. Estos tres sitios no la usan.

Causa raíz probable: el mismo string sirve de mensaje de log y de texto de UI;
no hay tipo, lint ni prueba que separe los dos usos. (REINCIDENTE.)

---

### [MEDIO] FE-M3 · REINCIDENTE — la columna «Estado» de Descarga del SAT imprime el valor crudo del dominio (`en_proceso`, `descargada`) y un `error` con el mismo tono que un éxito
`src/app/dashboard/descarga-sat/vista.tsx:353` (`<td className="py-1">
{s.estado}</td>`), contra `src/lib/likida/sat_descarga/lectura.ts:117`
(`estado: s.estado as string`) y el dominio de
`supabase/migrations/0231_descarga_masiva_sat.sql` (`check (estado in
('solicitada','en_proceso','lista','descargada','error','expirada'))`).

Escenario, con valores. El contralor pide un rango a mano. El SAT tarda. Abre
«Tus solicitudes» y lee, en la columna rotulada **Estado**:

| Periodo | Buzón | Estado | CFDI nuevos |
|---|---|---|---|
| 01/08/2026 → 31/08/2026 | recibidos | `en_proceso` | — |
| 01/07/2026 → 31/07/2026 | recibidos | `error` | — |

`en_proceso` con guion bajo es un identificador de base, no una frase; y `error`
se pinta con exactamente el mismo color y peso que `descargada`, en un panel
donde **todas** las demás listas usan un mapa de rótulo y tono
(`crons/vista.tsx:77`, `unidades/vista.tsx:16`, `facturacion/vista.tsx:327`,
`clientes/vista.tsx:352`, `conexiones/vista.tsx:5`). Seis estados de dominio,
cero rótulos.

Consecuencia: la única pantalla donde el contralor ve si el SAT le contestó
enseña seis estados en el idioma de la migración, y el que importa —`error`— no
se distingue del que no. Es la pantalla que se abre para contestar «¿por qué no
me han llegado mis facturas?».

Causa raíz probable: la pantalla se construyó alrededor de la configuración y
las cinco tarjetas de conteo (que sí distinguen `null` de `0`); la tabla de
solicitudes se agregó como volcado directo y nunca pasó por el kit.
(REINCIDENTE.)

---

### [ALTO] FE-A1 · REINCIDENTE — «Preguntar a la IA» afirma «todavía no hay datos de acreditables» cuando lo que pasó es que la base no contestó
`src/app/dashboard/chat/page.tsx:49-50` (los dos `.catch(() => null)`) contra
`src/app/dashboard/chat.tsx:94` (`sinLiq`), `:126` y `:146`, y contra
`src/lib/likida/analytics.ts` (las firmas `Promise<DashboardKpis>` /
`Promise<Acreditables>` y sus `throw`). La prueba que lo congela:
`src/app/dashboard/chat/page.test.tsx:75-80`.

Reverificado hoy línea por línea; el escenario de la 30 sigue igual, con
valores:

1. `getKpis` y `getAcreditables` **nunca devuelven `null`**: fallan cerrado y
   lanzan, con comentario que dice por qué.
2. `chat/page.tsx:49-50` vuelve a abrir esa puerta. Después de esa línea,
   `acred === null` significa **una sola cosa: la lectura falló**.
3. El contralor teclea la pregunta sugerida por la propia caja («¿Cuánto llevo
   de acreditables?»). El analista corre contra la misma base caída → el flujo
   entra al paracaídas (`chat.tsx:566`) → `respuestaLocal` → `responder`.
4. `chat.tsx:146` devuelve **«Todavía no hay datos de acreditables este
   periodo.»** y `respuestaLocal` (`:175-184`) la antepone del aviso «esto es lo
   que puedo contestarte con lo último que ya tenía cargado» — o sea, la
   presenta como un dato. La frase es una afirmación sobre el IVA y el peaje
   acreditables de la flota, hecha estando ciego.
5. Hay un camino peor, sin ni siquiera el aviso: `chat.tsx:566` solo pone el
   `motivo` si `d.t === 'error'`. Un `200` sin `bloques` deja `motivo = null` y
   la frase sale a secas.
6. `responder()` sigue sin una sola prueba: `grep -rn 'Todavía no hay
   liquidaciones para calcular'` en todo `src/` devuelve **una** línea, la del
   propio `chat.tsx:94`.

Consecuencia: en la pantalla del demo, con la base a medias, el comprador
pregunta por sus acreditables y Likida le contesta que no tiene ninguno. Es
falso y es sobre materia fiscal. Es la falla que CLAUDE.md nombra con esas
palabras.

Causa raíz probable: la página convierte una excepción en `null` por
disponibilidad, y el respondedor local ya usaba `null` con el significado
opuesto; el tipo `Respuesta` no tiene forma de decir «no pude leer».
(REINCIDENTE.)

---

### [BAJO] FE-B1 · REINCIDENTE — `/admin/crons`: cuando un reloj no late, la corrida parcial de otro desaparece del resumen
`src/app/admin/crons/vista.tsx:199` (`const malos = [...sinLatir,
...conFallo]`), `:216`, `:220-224` (la única mención de `parciales`) y
`:226-243` (la rama mala, que nunca los nombra), contra `:186-194`
(`resumenRelojes`, que sí los calcula en tres ejes).

Escenario, con valores. `gps` late puntual y reporta `parcial`; `purgar` lleva 9
horas sin latir (`estado: 'vencido'`). `resumenRelojes` devuelve
`sinLatir: ['purgar']`, `conFallo: []`, `parciales: ['gps']` → `malos.length ===
1` → se toma la rama de `:226`, que solo sabe imprimir `sinLatir` y `conFallo`:

> ⚠ **1** de 11 relojes no están latiendo como deberían: purgar.

Ni una palabra de `gps`. Con `purgar` sano, la misma corrida sí saldría. La
señal parcial se calla precisamente cuando hay más cosas rotas a la vez.

Consecuencia: Javier y el turno de guardia pierden un aviso de degradación
parcial justo en la corrida que ya viene mal. Es la consola interna — por eso
BAJO.

Causa raíz probable: `resumenRelojes` se extendió a tres ejes y solo dos se
cablearon a la rama mala del render. (REINCIDENTE.)

---

### [BAJO] FE-B2 · REINCIDENTE — `FaseCosto` tiene 9 fases y las CUATRO copias del diccionario de rótulos siguen en 6 o menos
`src/lib/likida/costos.ts:41` (`'ocr' | 'cuadre' | 'escalacion' | 'chat' |
'router' | 'whatsapp' | 'transcripcion' | 'copiloto' | 'runner'` — nueve)
contra las cuatro copias de `FASE_LABEL`, todas `Record<string, string>`:
`src/app/admin/consola.tsx:29-32` (6), `src/app/admin/analitica/page.tsx:12-15`
(6), `src/app/admin/costos-facturacion/page.tsx:65-68` (6, con el comentario
«Mismo diccionario de admin/consola.tsx (no se exporta de ahí)») y
`src/app/admin/model-ops/page.tsx:11` (**3**).

Escenario, con valores. El runner de agentes y el copiloto gastan en el mes.
`getResumenNegocio().porFase` trae `[{fase:'ocr'},{fase:'runner'},
{fase:'copiloto'},{fase:'transcripcion'}]`. Los cuatro llamadores hacen
`FASE_LABEL[f.fase] ?? f.fase` → la leyenda de la dona «Costo por fase» sale
mezclada: *Agente OCR · Agente de Cuadre · `runner` · `copiloto` ·
`transcripcion`*. En `/admin/model-ops`, solo 3 de las 9 tienen rótulo.

Consecuencia: cosmético y de consola interna — por eso BAJO. Lo que cobra
factura es la forma: `Record<string, string>` con `??` significa que `tsc` no se
pone en rojo cuando el dominio crece, y ya creció sin que nadie lo notara.

Causa raíz probable: el mapa se copió tres veces en vez de exportarse (el
comentario de `costos-facturacion:63-64` lo admite por escrito).
(REINCIDENTE.)

---

## Lo que revisé y está bien

Vale tanto como los hallazgos: es lo que distingue un rubro sano de uno sin
revisar. Todo abierto y leído hoy; los intentos de romperlo van descritos.

- **El censo de mapas contra su DOMINIO REAL, no contra el `??`.** La 30 midió
  qué mapas se indexan sin fallback; hoy hice lo otro, que es el trabajo que el
  rubro exige: crucé cada mapa de rótulo del panel contra el juego de valores
  que de verdad puede llegarle (unión de TS, `check` de la migración, o los
  literales que escriben los productores). **Nueve mapas cruzados, ocho
  exactos:**
  - `arco/page.tsx:19-21` `ETIQUETA_TIPO` — 4 claves contra
    `arco_tipo_dominio check (tipo in ('acceso','rectificacion','cancelacion','oposicion'))`
    (`0053_…sql:113`). **4/4.**
  - `agentes/peajes/vista.tsx:346-353` `MOTIVO_LEGIBLE` — 6 claves contra los
    literales que escribe `intake/desglose_peaje.ts` (`:436` `sin_fecha`, `:451`
    `contraparte_ya_reclamada`/`sin_gastos_en_ventana`, `:483` y `:489` los dos
    `motivoAmbigua`, `:496` `monto_distinto`). **6/6.**
  - `agentes/peajes/vista.tsx:357-362` `EVIDENCIA_LEGIBLE` — **se indexa SIN
    `??`** (`:376`), así que un hueco dejaría el renglón de evidencia GPS en
    blanco. Intenté provocarlo: `MotivoSinEvidencia`
    (`peajes/evidencia_gps.ts:53`) tiene exactamente los 4 que el mapa cubre, y
    las 4 ramas de `:75-81` son las únicas que lo producen. **4/4.**
  - `carta-porte/vista.tsx:116-120` `PILL` — `pill.rotulo` se accede sin guarda
    (`:137`), o sea un hueco sería `TypeError`, no un blanco. `decision.necesita`
    es `'si' | 'no' | 'falta_declarar'` (`carta_porte.ts:78`) y las siete
    asignaciones de `:101-166` no salen de ahí. **3/3.**
  - `unidades/vista.tsx:27-32` `ESTADO_UNIDAD` — 4 claves, misma lista que
    `ESTADOS_UNIDAD` (`operacion.ts:837`), que `operacion.ts:880` usa como
    validador y `operacion.test.ts:758` pina clave por clave. **4/4.**
  - `huerfanos/vista.tsx:12-16` `MOTIVO` es `Record<MotivoHuerfano, string>` —
    exhaustivo por TIPO, `tsc` obliga. **3/3.**
  - `suscripcion/page.tsx:57-63` `ESTADO_PILL` es
    `Record<Suscripcion['estado'], …>` — exhaustivo por tipo, 5/5, y además
    `getSuscripcion` filtra `.in('estado', [...4])` así que `cancelada` no
    llega a la pantalla por diseño (`saas/suscripcion.ts:136`).
  - `timbrado/page.tsx:98-104` — parece un mapa de 2 ramas sobre 6 estados
    posibles de `ccp_timbre.estado`, y lo perseguí: **está cerrado por la
    consulta.** `listarTimbrado` filtra `.in('estado', ['vigente','pendiente'])`
    (`carta_porte_timbre.ts:469`) y el tipo de retorno se estrecha a esos dos
    (`:442`, `:479`). Un timbre `cancelado` no puede salir rotulado «Timbrado».
  - El único desincronizado es `ROTULO_EVENTO` → **FE-M4**.
- **Los dos paginadores del panel clampan un `?p=` fuera de rango.** Ataqué la
  forma de FE-M3 de la 29 (quedar atrapado en una página vacía) sobre los
  registros del panel y **no se puede**: `paginar-registro.ts:81` es
  `Math.min(pCruda, paginas)` para el lado en memoria, y
  `administracion.ts:764-765` (operadores) y `:1326-1327` re-leen la última
  página real cuando `pagina > paginas`, con el comentario «un `?p=` más allá
  del final (un link viejo) cae a la última página real». `/dashboard/viajes` ni
  siquiera usa índice: `viajes_registro.ts:153-163` es cursor opaco con `hayMas`.
- **Formato de cifras: una sola fuente, intacta.** `grep -rnE
  "toLocaleString|Intl.NumberFormat|toFixed\("` sobre `src/app` sin pruebas da
  **17** apariciones y las revisé una por una: geometría SVG
  (`charts.tsx:22,115,116,119`, `graficas.tsx:141`, `mapa/page.tsx:116,200,201`,
  `mapa/mapa-vivo.tsx:62`), coordenadas (`mapa/vista.tsx:221`), textos de error
  de API (`export/poliza/route.ts:130`, `qa/*/route.ts`) y un `String()` de un
  default (`calculadora/calc.tsx:28`). **Ni una cifra de dinero del panel se
  formatea fuera de `lib/formato.ts`.**
- **`src/app/tokens_definidos.test.ts`: 4/4 verde** (lo corrí). Cero
  `var(--x)` huérfanos en `src/app`.
- **El contraste tiene arnés y está verde:** `dashboard/contraste.test.ts`,
  **12/12**, cubre `--color-ok`, `--color-bad`, `--faint`, `--muted` y los siete
  tokens de región, en claro y en oscuro, y además exige que la jerarquía
  `--faint` > `--muted` se conserve invertida. Calculé a mano los dos que el
  arnés no toca y pasan AA: `--warn #9a5c00` = **5.38:1** sobre blanco,
  `--color-warn #a16207` = **4.92:1**, `--marca #c2410c` = **5.18:1**.
- **`/dashboard/mapa` es el patrón que FE-A2 no siguió.** `mapa/page.tsx:31`
  declara `TOPE_MAPA = 200`, `:75-82` tiene un `contarVivos` aparte que devuelve
  `null` (≠ 0) si no se pudo contar, `:215` pasa las dos cosas a la vista, y
  `mapa/vista.tsx:88-89` pinta «—» con la nota «no se pudo contar» mientras
  `:112` dice *«Se dibujan los 200 … de N — el resto está en el registro»*. Los
  otros tres que también lo declaran: `viajes-recientes.tsx:14-17`,
  `registro-filtro.tsx:67-69` y `agentes/peajes/vista.tsx:445-446`.
- **`/dashboard/combustible-casetas` aguantó el ataque obvio.**
  `page.tsx:215` y `:218` son `diesel?.total ?? 0` y `caseta?.total ?? 0`, que a
  primera vista es «lectura caída → $0.00 medido». No lo es: `:204` corta antes
  con `porConcepto === null ? … No se pudo cargar esta sección`, así que el
  `undefined` que llega a esas dos líneas solo puede significar «la consulta
  corrió y no hay gastos de ese concepto», y la nota lo dice («Sin cargas
  registradas todavía»). El tile de al lado (`:225-229`) va más lejos y pasa
  `null` con `vacio="No se pudo leer lo acreditable"`.
- **`panel-periodo.tsx` mueve las cinco gráficas juntas y ninguna miente.**
  `:55` `totalLiquidado` cae a `0` con la serie en `null`, pero `:122` lo
  esconde tras `totalLiquidado > 0` y `:126` pinta «No se pudo cargar esta
  gráfica» — las tres tarjetas separan `null` (caída) de vacío medido, cada una
  con su frase (`:88`, `:114`, `:126`, `:151`).
- **Server actions: el error del servidor no llega como stack.**
  `lib/likida/errores.ts:64-70` (`mensajeParaPantalla`) devuelve `e.message`
  SOLO cuando es `DatoInvalido` (un error de captura, escrito para el usuario) y
  en cualquier otro caso loguea y devuelve una frase nuestra. Es la herramienta
  que FE-M2 no usa, no una que falte.
- **`key` de React en tablas de dinero.** Re-revisado: `facturacion/vista.tsx:353`
  `key={f.id}`, `:679` `key={\`${h.viajeId}-${h.cubeta}\`}`,
  `rentabilidad/vista.tsx:168` `key={f.id}`, `descarga-sat/vista.tsx:350`
  `key={s.id}`, `bandeja/vista.tsx:295` `key={f.id}`, `crons/vista.tsx:268`
  `key={x.cron}`, `timbrado/page.tsx:86` `key={f.viajeId}`,
  `suscripcion/page.tsx` `key={f.id}` y `key={p.clave}`,
  `operadores/vista.tsx:143` `key={f.operadorId}`. Los `key={i}` que quedan los
  crucé con su archivo: `[id]/detalle.tsx:346`, `resumen-visual.tsx:210`,
  `combustible-casetas/page.tsx:281` y `opera-whatsapp.tsx:44` **no tienen
  `'use client'`** — son Server Components, sin reconciliación de cliente que
  reordenar.
- **Tablas y responsive, medidos hoy.** De los 47 archivos de `src/app` con
  `<table>`, **46 tienen tantos `overflow-x-auto` como tablas**; el único que no
  es `admin/qa/[id]/medicion-corrida.tsx` (consola interna). `min-w-[Npx]` en
  todo `src/app`: 190, 200, 220 y 260 px — **cero por encima de 360**. De los
  `grid-cols-3..9` sin prefijo responsive en `/dashboard` queda **uno**,
  `despacho/vista.tsx:112` (`grid-cols-3 lg:grid-cols-6`), que a 375 px son tres
  columnas de ~110 px: lo dejo abajo porque sin render no lo puedo afirmar.
- **La cascada de errores del panel está completa.** `dashboard/error.tsx`
  registra con `logger`, pinta el `digest` seleccionable y separa «hubo un
  problema al leer los datos» de «no hay datos»; existen además
  `admin/error.tsx`, `admin/loading.tsx`, `dashboard/loading.tsx` y cuatro
  `error.tsx` de sub-ruta en `/admin`.
- **`/dashboard/timbrado`, aparte de FE-A2, es de los buenos:** `:42-47`
  distingue lectura caída de cola vacía y lo dice con esas palabras (`:68-72`);
  `:57-59` separa PAC de producción, PAC de sandbox («los timbres no amparan
  nada») y sin PAC («Likida jamás simula un timbre»); `:102` bloquea el
  re-timbrado de un timbre a medio registrar en vez de invitar a reintentar.
  Sus 7 pruebas (`page.test.tsx`) cubren esos estados — ninguna cubre el tope.
- **`/dashboard/suscripcion`, aparte de FE-M5, está bien pensada:**
  `vista.tsx:24` distingue «sin límite» de «0 %» con palabras; `vista.tsx:77-79`
  nunca pinta `$0.00` por precio ausente y siempre dice si el IVA va dentro o
  encima; `page.tsx:102-107` separa `suscripcionCaida` de `suscripcion === null`
  con dos mensajes distintos; `page.tsx:523-527` marca «Sin timbrar» una factura
  cobrada sin CFDI; y `:530-533` declara el tope de 12 facturas.
- **Compuerta de mi rubro, corrida por mí:** `npx vitest run src/app` →
  **250 archivos / 2,277 pruebas, todas verdes**; `npm run typecheck` → limpio.

---

## Lo que NO alcancé a revisar

- **Sigo sin mirar un render.** `npm run build` está prohibido en este entorno y
  no hay credenciales. Todo lo de arriba es lectura de fuente, aritmética y
  ejecución de pruebas. En concreto quedan sin ver: el `grid-cols-3` de
  `despacho/vista.tsx:112` a 375 px (tres KPIs de ~110 px con títulos de dos
  palabras), el `min-w-[190px]` de `motor-fiscal-periodo.tsx:60,75`, y si el
  renglón de `cotizacion_no_avisada` de FE-M4 se distingue visualmente de los
  demás (por el código, no: mismo `<li>`, mismo color).
- **Ningún hallazgo lo fijé con prueba**, porque no puedo escribir en el repo
  fuera de este entregable. Los tres nuevos son deterministas y se fijan así:
  FE-A2 sembrando `listarTimbrado` con 25 filas y
  `expect(html).not.toMatch(/25 en la cola/)` sin declaración de tope al lado;
  FE-M4 cruzando en una prueba los literales de `anotarEventoIncidencia` contra
  `Object.keys(ROTULO_EVENTO)` —el mismo patrón que ya usa
  `etiquetas_sincronizadas.test.ts` para `CONCEPTO`—; FE-M5 con
  `getUso` rechazando y `expect(html).toMatch(/no se pudo/i)`.
- **Orden de foco y navegación por teclado:** sin revisar, tercera ronda.
  Verifiqué solo que `globals.css` no tiene ningún `outline: none` global.
- **Tamaños de toque:** no los medí esta ronda. El `BTN_CHICO` de
  `emergencias/page.tsx:188` (`px-2.5 py-1`, texto 12 px) y los botones de
  `py-0.5` del kit son los candidatos a revisar cuando haya render.
- **`/admin` en profundidad:** `admin/qa/*`, `admin/vendedores/tablero.tsx`,
  `admin/observabilidad` y `admin/copiloto.tsx` quedaron sin abrir salvo por el
  censo de mapas y el conteo de tablas.
- **`/demo`, `/vendedor`, `/aviso/[tenant]`, `/calculadora`, `/login`,
  `/blog`, `/legal`:** solo grepeados. Abrí `/demo/page.tsx` entero y no
  encontré nada reportable, pero no verifiqué si es el demo que el equipo
  enseña de verdad o un artefacto viejo — eso cambia su severidad.
- **`/dashboard/cobranza`, `/dashboard/rentabilidad` y
  `/dashboard/facturacion` completas:** las recorrí por el censo de mapas, por
  `key`, por formato de cifras y por topes declarados; no abrí sus vistas de
  punta a punta.
