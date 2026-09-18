# Frontend — auditoría 32 (continuación 2, 18-sep)

**Nota: 5/10** (antes 5). Razón del movimiento: **ninguna neta — dos de las tres
formas aplicaron y se cancelaron, con su número cada una.**

- *Se atacó y cerró* (+): **el primer cierre en cuatro rondas.** `FE-31C2-A1`
  (ALTO) está **CERRADO de verdad**, y lo verifiqué por dentro, no por el
  mensaje del commit. El arreglo no parcheó el `.tsx`: extrajo
  `corridaDeCobranza` a `src/lib/likida/agentes/cobranza_pura.ts:136` con el
  predicado completo de tres ejes (`fallos.length === 0 && cortadosPorReloj === 0
  && !omitido`, `:151`), puso `tareasTotal = revisados` —la cola ENTERA, no lo
  alcanzado (`:156`)— y metió `cortadosPorReloj`, `sinTelefono` y `omitido` en el
  `resumen` durable (`:158-164`). Lo pinta `cobranza/page.tsx:131`
  (`...corridaDeCobranza(resultado)`). Viene con dos pruebas:
  `cobranza_bitacora.test.ts` (5 casos con valores) y
  `cobranza/reloj-corte.test.ts:42`, que afirma sobre el FUENTE que la página
  sigue llamando a la función pura. El commit es el squash `8b01aec`, del
  15-sep — o sea, **posterior** a la entrega del auditor anterior: entra entero
  en esta ventana.
- *Deuda que cobró factura* (−): **`FE-C1` entra en su OCTAVA ronda**
  (`visibilidad.ts:41` + `forma-viaje.tsx:90` + `despacho/page.tsx:163-164`,
  los tres abiertos y leídos hoy). Y la ronda anterior escribió, textual,
  «Busqué un cuarto [sitio de FE-M2] y **no lo hay**»: **sí lo hay**
  (`admin/corridas/page.tsx:75`→`:79`), sólo que con otra ortografía del mismo
  patrón, que es por lo que el grep no lo vio. Los abiertos pasan de **13 a 15**
  (13 − 1 cerrado + 3 nuevos).
- Y la tercera forma, *mirada más profunda*, **no aplica a la nota**: encontró
  cosas (los tres de hoy), pero ninguna cambia el veredicto del rubro.

Lo que fija el techo en 5 y no en 6 sigue siendo la misma línea: mientras
`FE-C1` deje que el comprador vea **`Anticipo $0.00 · entregado al operador`**
(`[id]/detalle.tsx:242`) junto a una diferencia de cinco cifras en la pantalla
de firma, el ancla del rubro («4 o menos si el comprador puede ver una cifra
mal») está tocando la nota. Lo que la sostiene en 5 es que todo lo demás sí
pinta sus cuatro estados — y esta ronda eso se verificó en once caminos más.

Lo contable de hoy:

| Medida | Hoy | Ronda anterior |
|---|---|---|
| Hallazgos abiertos reverificados uno por uno | **13 de 13** | 9 de 9 |
| **Cierres** | **1** (FE-31C2-A1, ALTO) | 0 (tercera ronda seguida) |
| Abiertos al cerrar | **15** | 13 |
| Archivos de producción de mi superficie tocados en la ventana | **0** (la rama sólo movió migraciones y pruebas) | 2 |
| Mapas de rótulo cruzados contra su dominio REAL | **28** acumulados; exactos **24**; desincronizados **4** | 16 / 13 / 3 |
| `npx vitest run src/app` | **251 archivos / 2,286 pruebas, verde** | 251 / 2,283 |
| `npx tsc --noEmit -p .` | exit 0 | exit 0 |

**Riesgo mayor del rubro, hoy:** sigue siendo FE-C1 — el jefe de tráfico
despacha el viaje, el campo de Anticipo no existe para él, el servidor escribe
`0`, y la liquidación firma contra un anticipo inventado. Detrás, el patrón que
esta ronda vuelve a demostrar: **el panel no tiene nada que obligue a un mapa de
rótulos a cubrir su dominio**, y hoy encontré una llamada a un traductor de
rótulos que, por un prefijo, no traduce nada y nadie se enteró.

---

## Verificación de los 13 hallazgos abiertos

Abiertos y leídos hoy, `archivo:línea`. No inferidos del nombre.

| Hallazgo | Hoy | Ancla de hoy |
|---|---|---|
| **FE-31C2-A1** ALTO — Cobranza archiva «OK» lo que el reloj cortó | **CERRADO** | `cobranza_pura.ts:136-165` + `cobranza/page.tsx:131`; pruebas `cobranza_bitacora.test.ts` y `reloj-corte.test.ts:42` |
| **FE-C1** CRÍTICO — el despacho no ofrece el Anticipo | **REINCIDENTE (8ª ronda)** | `grep -rn 'name="anticipo"' src/` → **una** línea, `forma-viaje.tsx:92`; `forma-viaje.tsx:90` sigue `{puedeCapturarDinero && <div>`; `despacho/page.tsx:80` (`puedeVerArea(rol,'dinero')`) y `:163-164` (`… : 0`); `visibilidad.ts:41` sigue `encargado: ['operacion']` |
| **FE-A1** ALTO — el chat afirma «no hay acreditables» estando ciego | **REINCIDENTE** | `chat/page.tsx:48-50`, los dos `.catch((): X \| null => null)`, intactos |
| **FE-A2** ALTO — la cola de Timbrado topa en 25 y pinta el tope como total | **REINCIDENTE** | `timbrado/page.tsx:44` sigue sin segundo argumento; `:82` sigue `{numero(filas.length)} en la cola.` |
| **FE-31C2-M1** MEDIO — el acuse de Peajes se contradice por el tope de 1,000 | **REINCIDENTE** | `consolidado.ts:779` (`.limit(1000)`) y `:861` (`cortadosPorReloj = pendientes.length - resumen.revisadas`) intactos; `peajes/controles.tsx:50` sigue preguntando por el total REAL y `:93-97` sigue acusando el topado |
| **FE-M2** MEDIO — mensaje crudo de PostgREST en pantalla | **REINCIDENTE, y ahora son 4 sitios** | los 3 de antes (`arco/page.tsx`, `conversaciones/page.tsx`, `descarga-sat/bandeja`) + el cuarto que se declaró inexistente: ver FE-32C2-B1 |
| **FE-M3** MEDIO — «Estado» de Descarga del SAT en crudo | **REINCIDENTE** | `descarga-sat/vista.tsx:353` sigue `<td className="py-1">{s.estado}</td>` |
| **FE-M4** MEDIO — tres eventos sin rótulo en el expediente de incidencias | **REINCIDENTE** | `mesa_control.ts` sigue con `ROTULO_EVENTO` como `Record<string,string>`; `aviso_jefe_encolado`, `cotizacion_no_avisada` y `reloj_legal_avisado` siguen sin aparecer |
| **FE-M5** MEDIO — «Lo que llevas este mes» desaparece sin decirlo | **REINCIDENTE** | `suscripcion/page.tsx:368` (`Lo que llevas este mes`) sigue detrás del `{uso && (` |
| **FE-31C2-B1** BAJO — 11 de 13 herramientas rotuladas en el chat | **REINCIDENTE** | `chat.tsx:44-55` sigue con **11** claves y `:57` con `?? t.replaceAll('_',' ')`; `analista.ts:42-47` sigue listando `consultar_carta_porte` y `consultar_normas` |
| **FE-31C2-B2** BAJO — Soporte imprime `categoria`/`prioridad` crudas | **REINCIDENTE** | `soporte/page.tsx:252` (`{t.categoria}`), `:253` (`{t.prioridad}`), `:300` — intactos; `StatusPill` de al lado (`:255`) sí traduce |
| **FE-B1** BAJO — la corrida parcial desaparece del resumen de `/admin/crons` | **REINCIDENTE** | `crons/vista.tsx:199` sigue `const malos = [...sinLatir, ...conFallo]`, con `parciales` desestructurado en `:198` |
| **FE-B2** BAJO — `FaseCosto` tiene 9 y las copias de `FASE_LABEL` menos | **REINCIDENTE** | `admin/model-ops/page.tsx:11` sigue con **tres** (`ocr`, `cuadre`, `whatsapp`); `admin/consola.tsx:29`, `admin/analitica/page.tsx:12` y `admin/costos-facturacion/page.tsx:65` siguen separadas |

**1 cierre de 13.** Ninguno de los otros doce estaba mal reportado.

---

## Hallazgos

### [MEDIO] FE-32C2-M1 · NUEVO — el índice de Corridas llama al traductor de rótulos con la llave equivocada: cada fila sale con el id crudo del agente, y la traza de ESA MISMA fila, un clic más allá, sale con el nombre bonito
`src/app/admin/corridas/page.tsx:120` (`{etiquetaInterruptor(c.agente)}`), contra `src/app/admin/corridas/[id]/page.tsx:89` y `:135` (`etiquetaInterruptor(\`agente:${c.agente}\`)`), contra `src/app/admin/observabilidad/etiquetas.ts:12-98` (las **60** claves: `global` y 59 `agente:*`, TODAS con prefijo) y `:116-118` (`ETIQUETA_INTERRUPTOR[id] ?? ETIQUETA_PIPELINE[id] ?? id`), y contra `src/lib/admin/corridas-cruzadas.ts:58` (`agente: String(f.agente)` — la columna `agente_corrida.agente` tal cual, sin prefijo).

Escenario, con valores. Javier abre `/admin/corridas` para hacer triage de la
mañana. La tabla trae, entre otras, una corrida del agente
`datos_instrumentacion` y una de `especialistas_incidente`.

1. `corridas-cruzadas.ts:58` entrega `c.agente = 'datos_instrumentacion'` — la
   columna de base, sin prefijo. Lo confirma el propio filtro de la página, que
   compara contra ese mismo valor (`corridas-cruzadas.ts:135`,
   `consulta.eq('agente', params.agente)`) y cuyo placeholder dice «Agente (id
   del catálogo)…» (`page.tsx:179`).
2. `page.tsx:120` llama `etiquetaInterruptor('datos_instrumentacion')`.
   `ETIQUETA_INTERRUPTOR` no tiene esa clave: **sus 60 claves son
   `'global'` y `'agente:*'`** (`etiquetas.ts:13-97`). `ETIQUETA_PIPELINE`
   tampoco (`'pipeline:*'`, `:110-114`). El `?? id` de `:117` devuelve
   **`'datos_instrumentacion'`**.
3. La columna «Agente» imprime, en las 50 filas de la página
   (`CORRIDAS_POR_PAGINA = 50`, `corridas-cruzadas.ts:107`):

   > **datos_instrumentacion** · Likida (negocio) · OK · …
   > **especialistas_incidente** · Likida (negocio) · Parcial · …

4. Javier hace clic en esa fila. `[id]/page.tsx:89` llama a la MISMA función
   con `agente:${c.agente}` y el título de la traza dice
   **«Traza — Datos e instrumentación»**, y `:135` repite **«Especialistas de
   incidente (8)»**. Dos nombres del mismo agente a un clic de distancia.

**No es una preferencia por los ids, y hay prueba escrita de que no lo es.**
El arreglo que agregó los 39 nombres que faltaban dice, por escrito y dos
veces, que lo hacía por ESTA pantalla: `etiquetas.ts:33-35` («39 se pintaban
con el id crudo … en Observabilidad, en el ⌘K y en **la columna Agente de
/admin/corridas**») y `etiquetas.test.ts:8-11`, con la misma frase. Esa prueba
existe, **está verde**, y afirma lo correcto sobre el MAPA
(`INTERRUPTORES.filter((id) => ETIQUETA_INTERRUPTOR[id] === undefined)` →
vacío, `:20-23`) — pero nadie afirmó nada sobre la LLAMADA, y la llamada pasa
la llave sin prefijo. `tsc` tampoco puede verlo: la firma es
`(id: string) => string`. La prueba de la página (`admin/corridas/page.test.tsx`)
cubre siete conductas —superadmin, vacío-real vs vacío-por-filtro, lectura
caída, `costoUsd` null, tareas ambos-o-ninguno, error en la lista, paginación—
y ninguna mira la columna Agente.

Un detalle que lo confirma: ese comentario cita el id crudo como
`agente:datos_instrumentacion`, **con** prefijo. En `/admin/corridas` lo que
se ve es `datos_instrumentacion`, **sin** prefijo — o sea, ni siquiera es el
síntoma que el arreglo creía estar mirando.

Consecuencia: la razón escrita del arreglo era «una lista de 58 filas donde 39
son jerga es una lista que no se lee: el kill switch más caro de encontrar es
el que está entre otros 57» (`etiquetas.ts:36-39`). En `/admin/corridas` —la
pantalla de triage, la que la propia prueba nombra— no son 39 de 58: son
**todas**. Y es el defecto H18 otra vez (un rótulo que cambia según la
pantalla se lee como dos cosas), en la consola desde la que se decide qué
agente está roto.

Causa raíz probable: el índice se escribió después que la traza y copió la
llamada sin el `agente:` que la traza sí arma; el tipo `string` de la función
deja pasar la llave equivocada sin ruido.

---

### [BAJO] FE-32C2-B1 · NUEVO — el CUARTO sitio de FE-M2, el que la ronda anterior declaró inexistente: `/admin/corridas` pinta el mensaje de PostgREST Y el nombre de la función interna dentro de su propio texto de error
`src/app/admin/corridas/page.tsx:75` (`error = e instanceof Error ? e.message : 'no se pudo leer'`) y `:79` (`<EstadoError mensaje={\`No se pudieron leer las corridas — ${error}. …\`} />`), contra `src/lib/admin/corridas-cruzadas.ts:144` (`throw new Error(\`corridasFiltradas: ${error.message}\`)`), y contra el sitio donde el patrón YA está cerrado, `src/app/dashboard/mapa/page.tsx:128-138` (captura, manda al `logger`, devuelve una frase nuestra).

Escenario, con valores. Se aplica una migración que renombra un índice y
PostgREST se queda con el esquema viejo. Javier abre `/admin/corridas` y lee,
en la tarjeta de error:

> No se pudieron leer las corridas — **corridasFiltradas: column
> agente_corrida.costo_usd does not exist**. La consulta falló; no es que no
> existan.

La segunda mitad de la frase es nuestra y es correcta; la primera es el mensaje
del motor más el nombre del símbolo de TypeScript que lo lanzó.

Por qué existe y el grep no lo encontró: la ronda anterior barrió los 60 usos
de la forma exacta `e instanceof Error ? e.message : String(e)` y concluyó
«busqué un cuarto y no lo hay». Aquí la cola del ternario es
`: 'no se pudo leer'`, no `: String(e)` — misma fuga, otra ortografía.

Consecuencia: BAJO porque esta pantalla es de Javier y él sabe leer un mensaje
de PostgREST. Lo que cobra factura es el número: FE-M2 se ha estado reportando
como «tres sitios exactos» y son cuatro; el criterio que lo cierra no puede ser
un grep de una sola forma.

Causa raíz probable: no hay un `mensajeParaPantalla()` obligatorio en el borde
de render — existe (`src/lib/likida/errores.ts:64`, con la frase correcta en
`:70`) y lo usan las server actions, pero las páginas que envuelven su lectura
en `try/catch` lo arman a mano cada vez.

---

### [BAJO] FE-32C2-B2 · NUEVO — la Mesa de control imprime el tipo y la prioridad de la emergencia en crudo: «emergencia medica · prioridad critica», sin acentos, en la pantalla que se abre cuando un chofer está tirado en carretera
`src/app/dashboard/asistencia/page.tsx:147` (`{inc.tipo.replace(/_/g, ' ')} · prioridad {inc.prioridad} · nivel …`), contra `supabase/migrations/0198_asistencia_siniestros.sql:23-24` (el dominio de `incidencia.tipo`) y `src/lib/likida/mesa_control.ts:90` (`.in('tipo', [...TIPOS_ASISTENCIA])`, que acota lo que puede llegar a esta línea a `siniestro · robo · emergencia_medica · varado · bloqueo`).

Escenario, con valores. Un chofer manda «me chocaron» por WhatsApp; el agente
de asistencia abre la incidencia como `emergencia_medica` con
`prioridad = 'critica'`. El jefe de tráfico abre `/dashboard/asistencia` y el
titular del expediente dice, literal:

> **emergencia medica · prioridad critica · nivel 2/4**

Dos palabras en minúscula y sin acento, encabezando el renglón más grave del
panel. El mismo componente sí trata el resto con cuidado —`:154` pinta
«⛑️ CON LESIONADOS», `:159` explica «Detectada por la cámara — el chofer NO ha
reportado nada todavía», `:170` distingue tomada de no tomada— y el
`.replace(/_/g, ' ')` demuestra que alguien vio el guion bajo y lo quitó sin
ponerle rótulo.

Segundo sitio, misma causa: `src/app/dashboard/descarga-sat/bandeja/fila.tsx:367-368`
imprime `<strong>{h.acto}</strong> {h.estatusAntes} → {h.estatusDespues}` en el
expediente de cada CFDI — «**ligado** disponible → casado» — mientras la MISMA
vista, 300 líneas arriba, ya tiene los cuatro estatus explicados en castellano
(`descarga-sat/bandeja/vista.tsx:45-60`, `COLAS: Record<EstatusCfdi, …>`). El
expediente es lo que hace que «deshacer» no sea «borrar» (lo dice su propio
comentario, `fila.tsx:358`), y está escrito en jerga de esquema.

Consecuencia: BAJO —no hay cifra mal y las palabras son legibles—, pero es la
misma clase de FE-31C2-B2 en dos pantallas más, y una de ellas es la de
emergencias. Cada dominio nuevo llega como `text` con `check` y el diccionario
se escribe sólo cuando alguien lo ve feo.

Causa raíz probable: no existe la obligación de que una constante `as const`
exportada traiga su `Record<Dominio, string>`; `TIPOS_ASISTENCIA` y
`EstatusCfdi` tienen tipo y no tienen rótulo.

---

### [BAJO] FE-32C2-B3 · NUEVO — una CUARTA copia del nombre de los roles, con su comentario apuntando a un archivo que ya no la tiene: el mismo usuario es «Encargado (jefe de tráfico)» en Equipo y «Jefe de tráfico» en las notificaciones de cada agente
`src/app/dashboard/agentes/notificaciones-forma.tsx:45-49` (`ROTULO_ROL`, 3 claves, `encargado: 'Jefe de tráfico'`), usado en `:206`, `:262` y `:285`, contra `src/lib/auth/roles.ts:34-37` (la fuente única, `encargado: { nombre: 'Encargado (jefe de tráfico)' }`) y contra sus consumidores `src/app/dashboard/usuarios/vista.tsx:179` (`nombreDeRol(u.rol)`), `usuarios/page.tsx:194` y `aviso-rol.tsx:51`.

Escenario, con valores. La flota tiene a Beto dado de alta como `encargado`.

1. El dueño abre `/dashboard/usuarios`: la píldora del renglón de Beto dice
   **«Encargado (jefe de tráfico)»** (`vista.tsx:179`).
2. En la misma sesión abre `/dashboard/agentes/cobranza`, baja a
   «A quién le llega», y la casilla dice **«Jefe de tráfico»**
   (`notificaciones-forma.tsx:206`); en la lista de destinatarios de abajo, el
   correo de Beto sale etiquetado **«Jefe de tráfico»** (`:262`).
3. Cambia el rol de Beto: el acuse dice «Rol cambiado: de Dueño de la flota a
   **Encargado (jefe de tráfico)**» (`usuarios/page.tsx:194`).

Tres rótulos del mismo rol en una sesión. `roles.ts:1-15` existe exactamente
para eso: dice que había CUATRO copias que no decían lo mismo y que «un rótulo
que cambia según la pantalla se lee como dos roles distintos».

Y el comentario que justifica esta copia ya no es cierto:
`notificaciones-forma.tsx:40-44` dice «Repetido de `dashboard/aviso-rol.tsx`
(que lo tiene privado dentro de su componente) … el día que aparezca un cuarto
sitio, el mapa se muda a un módulo compartido». `aviso-rol.tsx` **no tiene ese
mapa**: importa `ROTULOS_ROL` de `roles.ts` (`aviso-rol.tsx:6`, usado en `:51`).
El módulo compartido ya existe y esta copia no lo vio.

Consecuencia: BAJO, no hay cifra mal. Lo que cobra factura es que el mapa es
`Record<string, string>` con `?? rol` (`:206`, `:262`, `:285`): el día que
`RolAvisable` (`notificaciones.ts:62`) crezca a cuatro, `tsc` no dirá nada y la
casilla nueva saldrá como `vendedor`.

---

## Lo que revisé y está bien

Todo abierto y leído hoy; los intentos de romperlo van descritos.

- **El arreglo de FE-31C2-A1, verificado por dentro y no por el commit.** Los
  tres valores del hallazgo original, perseguidos uno por uno:
  (a) 400 en cola, reloj corta a los 40 → `cobranza.ts:294`
  (`cortadosPorReloj = 360`) → `cobranza_pura.ts:151` da `sana = false` →
  **«Parcial · 40/400»**, no «OK · 40/40»;
  (b) agente pausado entre el render y el clic → `cobranza.ts:239` devuelve
  `omitido` → el tercer eje del predicado lo atrapa → **«Parcial»**, y `omitido`
  queda en el `resumen` durable (`cobranza_pura.ts:163`), que es lo que pinta
  `/admin/corridas/[id]`;
  (c) 30 contactados y 10 sin teléfono → `tareasTotal = revisados = 40`
  (`cobranza.ts:267`, `paraContactar.length + sinTelefono.length`), así que el
  renglón durable dice **30/40** y ya coincide con el acuse en pantalla.
  El `EstadoCorrida` que la ficha sabe pintar son tres
  (`corridas.ts:72`) y `PILL` de `ficha-corridas.tsx:15-19` cubre los tres.
- **El censo de mapas, ampliado de 16 a 28.** Doce nuevos cruzados a mano
  contra su dominio real, y **once salieron exactos**:
  `ETIQUETA_INTERRUPTOR` (`admin/observabilidad/etiquetas.ts:12`, **60/60**,
  con `etiquetas.test.ts:20-36` exigiendo las dos direcciones —ninguna palanca
  sin rótulo, ningún rótulo huérfano— y además que ningún rótulo sea el propio id);
  `ETIQUETA_TOOL` del copiloto (`admin/copiloto.tsx:81`, **16/16** contra
  `TOOLS_COPILOTO_LECTURA` de `copiloto-tools.ts:36-40` más `proponer_accion` y
  `entregar_respuesta_admin` de `copiloto.ts:234` — el gemelo sano de
  FE-31C2-B1); `PILL` y `DISPARO` de `admin/corridas/[id]/page.tsx:13` y `:19`
  (3/3 y **4/4** contra `DisparoCorrida`, `corridas.ts:78`, incluidos `correo`
  y `whatsapp`); `PILL_LABEL` (`admin/corridas/page.tsx:208`, 3/3 contra
  `ESTADOS_CORRIDA`); `ESTADO` de Conexiones (`conexiones/vista.tsx:5`,
  `Record<Conector['estado'], …>`, 5/5 con `no_medible` en tono propio);
  `PILL` de Carta Porte (`carta-porte/vista.tsx:116`, **3/3** contra
  `necesita: 'si' | 'no' | 'falta_declarar'`, `carta_porte.ts:78` — por eso el
  `PILL[...]` sin `??` de `:123` no puede reventar); `MOTIVO_LEGIBLE`
  (`peajes/vista.tsx:346`, **6/6**: los seis motivos que
  `desglose_peaje.ts:436/451/480/486/496` sabe escribir);
  `EVIDENCIA_LEGIBLE` (`peajes/vista.tsx:357`, **4/4** contra
  `MotivoSinEvidencia`, `evidencia_gps.ts:42-49` — también sin `??` y también
  a salvo); `ROTULO_CUBETA` (`facturacion/vista.tsx:598`, derivado con
  `Object.fromEntries(CUBETAS_AUDITOR…)`, imposible de desincronizar);
  `ROTULO_TIPO` de Jornada (`jornada/formas.tsx:74`, 4/4) y `ROTULO_ROL` de
  notificaciones (3/3 contra `RolAvisable`, `notificaciones.ts:62` — completo,
  aunque divergente en el texto: FE-32C2-B3). El duodécimo es el de hoy
  (FE-32C2-M1), que no es un mapa incompleto sino una llave mal armada.
- **`carta-porte/vista.tsx:125` no inventa el denominador.** Sospeché del `18`
  escrito a mano (`const listos = 18 - c.faltanTransportista`, con «18» impreso
  otras tres veces en `:97`, `:163` y `:178`) y lo conté:
  `grep -c "responsable: 'transportista'" src/lib/likida/carta_porte.ts` → **18**
  (y 19 del cliente). Además `falta()` cuenta `presente !== true`
  (`carta_porte.ts:371`), así que un dato desconocido cuenta como faltante y el
  semáforo nunca se pone verde por ignorancia.
- **Las cuatro cubetas de `/dashboard/agentes/facturas` no mienten por tope.**
  El KPI «Por facturar» es `ordenados.length` (`facturas/vista.tsx:122`) y su
  fuente `getPorFacturar` (`facturacion/pendientes.ts:159-173`) usa `traerTodo`
  con `conteo(desde)`, no un `.limit()`: el comentario de `:154-158` documenta
  que ese `.limit(500)` ya existió y ya se quitó. Es la clase de FE-A2 y aquí
  está cerrada.
- **La evidencia GPS de Peajes se calcula sobre TODAS las líneas.**
  `evidencia_gps.ts:197-210` lee con `traerTodo` + `conteo` y ordena por
  `(indice, id)`; `contextoEvidenciaGps:142-152` resuelve viaje→unidad con
  `traerPorIds` en tandas *«un mapa recortado aquí produce `viaje_sin_unidad`
  FALSOS»*; y el agregado de posiciones se pagina igual (`:164-176`). El
  rótulo «X de Y cruces» (`vista.tsx:416`) es sobre el desglose entero.
- **Las alertas de `/dashboard/notificaciones` conservan la flota y respetan el
  rol.** `calcular-alertas-flota.ts:174-176` filtra por `puedeVer(a.href)`
  ANTES de pegar el sufijo y luego hace `href: \`${a.href}${sufijo}\``;
  `notificaciones/page.tsx:36` arma ese sufijo con `sufijoTenant(sp)` y `:55`
  le pasa el predicado de rol. Barrí los cuatro archivos de `/dashboard` que
  usan `next/link` sin importar `sufijo` —`notificaciones/lista.tsx:78`,
  `aviso-rol.tsx`, `sin-flota.tsx`, `descarga-sat/bandeja/fila.tsx:264/270`— y
  en los cuatro el `href` llega como prop ya armada, o es a `/admin`. **Cero
  fugas de la trampa de `requireSessionTenant`.**
- **Las cuatro fronteras de error del árbol existen y ninguna filtra stack.**
  `dashboard/error.tsx:80-84` y `global-error.tsx:109-114` pintan sólo el
  `digest` y lo registran (`:43-48` y `:32-38`); hay además
  `admin/error.tsx`, `admin/flotas`, `admin/mapa-prospectos`,
  `admin/observabilidad` y `admin/qa`. `global-error.tsx:54-56` no usa ni un
  `var(--…)` a propósito, con el porqué escrito.
- **El formato de cifras sigue viviendo en un solo sitio.** Barrí
  `toFixed`/`toLocaleString`/`Intl.NumberFormat` en todo `src/app`: los únicos
  `toFixed` son coordenadas de SVG (`charts.tsx`, `graficas.tsx`,
  `mapa/mapa-vivo.tsx:62`), grados en el mapa (`mapa/vista.tsx:221`) y el
  precio de referencia de la calculadora pública. Ni un `toLocaleString('es-MX')`
  fuera de `lib/formato.ts`; `formato-preset.ts:23-41` resuelve `mxn`/`litros`
  importándolos, y `kit.tsx:430` lleva el comentario que lo explica.
- **`key` de React: cero regresiones sobre dinero.** Re-barrí los archivos con
  `key={i}` y me quedé con los **14 que son Client Components**. Ninguno indexa
  una tabla de dinero reordenable: `kit.tsx:449` es el esqueleto de carga,
  `mapa-vivo.tsx:116` son puntos de un SVG, `chat.tsx:596/879` son bloques de
  una respuesta inmutable, `descarga-sat/bandeja/fila.tsx:366` es el historial
  de UN comprobante dentro de un `<details>`, y `cobranza/controles.tsx:90`
  indexa `r.fallos`, inmutable dentro de un resultado de acción. Las tablas de
  dinero con `key={i}` (`agentes/liquidacion/vista.tsx`,
  `cotizaciones/page.tsx`, `descarga-sat/vista.tsx`) siguen siendo Server
  Components.
- **Los tres estados de la ficha de corridas se distinguen.**
  `ficha-corridas.tsx:29-38`: `null` → «No pude leer el historial … no se pinta
  "sin corridas" sobre una consulta caída», `[]` → «Sin corridas registradas
  todavía … se anota desde el 14 de agosto», y `:72-75` pinta `—` cuando
  `tareasHechas`/`tareasTotal` es `null` en vez de `0/0`.
- **La Mesa de control no ofrece botones sobre lo que no pudo leer.**
  `asistencia/page.tsx:44-51` separa `leyoOk` de «cero incidencias», `:112-119`
  pinta el aviso sin acciones, y `:121-129` el vacío real con su explicación.
  (Su defecto es el rótulo crudo de FE-32C2-B2, no el estado.)
- **Compuerta de mi rubro, corrida por mí:** `npx vitest run src/app` → **251
  archivos / 2,286 pruebas, verdes**; `npx tsc --noEmit -p .` → **exit 0**.

---

## Lo que NO alcancé a revisar

- **Sigo sin mirar un render — quinta ronda.** `npm run build` está prohibido en
  este entorno y no hay red al sitio. Todo lo de arriba es lectura de fuente,
  aritmética y ejecución de pruebas. Siguen sin verse: el `grid-cols-3` de
  `despacho/vista.tsx:112` a 375 px (seis KPIs en 3 columnas sobre una columna
  de contenido de ~255 px, porque `marco.ts:22` deja el riel de 72 px SIEMPRE
  en pantalla), los `min-w-[190px]` de `motor-fiscal-periodo.tsx`, y si el
  renglón de `cotizacion_no_avisada` (FE-M4) se distingue del de al lado.
- **El delta de `StatCard` sigue sin cerrarse, y ahora tengo los valores.**
  `admin/ui/kit.tsx:195` imprime `{Math.abs(delta.pct)}%` en crudo y
  `pctCambio` (`lib/formato.ts:160`) devuelve `round2`: una fila de cuatro
  tarjetas de `/dashboard` (`kpi-periodo.tsx:71`) puede leer «↑ 5%»,
  «↑ 12.34%» y «↓ 8.5%» a la vez, mientras el preset `'porcentaje'`
  (`formato-preset.ts:30`) redondea a entero. **No lo reporto** porque es
  formato y no cambia el significado, y sin render no puedo decir si se nota.
  Segunda ronda anotado.
- **Tamaños de toque:** medidos sólo en el papel, no en pantalla. `BOTON_PERIODO`
  (`kit.tsx:111`) declara 24×24 con su porqué; `BTN_CHICO` de
  `asistencia/page.tsx:95` (`text-xs px-2.5 py-1`) da 24 px de alto justo en el
  mínimo de WCAG 2.2 SC 2.5.8, y los `py-0.5` del kit quedan por debajo — sin
  render no afirmo cuáles son objetivos de toque reales y cuáles son píldoras
  no interactivas. Quinta ronda sin cerrar.
- **Contraste:** no lo re-medí. `globals.css:66-113` documenta tres barridos AA
  con la fórmula de luminancia y `contraste.test.ts` los congela; me apoyé en
  esa prueba en vez de repetir la aritmética.
- **Orden de foco y navegación por teclado** más allá de los radios `sr-only`:
  sin revisar, quinta ronda.
- **`/admin` en profundidad:** abrí `corridas`, `corridas/[id]`, `copiloto`,
  `observabilidad/etiquetas`, `crons` y `ui/kit`. Quedan sin abrir
  `admin/qa/*`, `admin/vendedores/tablero.tsx`, `admin/mapa-prospectos/cerebro.tsx`
  (1,200 líneas, con cuatro mapas `Record<string,…>` sin `??` en `:848`,
  `:1011`, `:1130`, `:1197`), `admin/escalaciones`, `admin/consumo` y
  `admin/trust-safety`.
- **`/demo`, `/pago/[token]`, `/aviso/[tenant]`, `/calculadora`, `/login`,
  `/vendedor`, `/cuenta`, `/blog`, `/legal`:** sólo grepeados.
- **Ningún hallazgo lo fijé con prueba**, porque no puedo escribir en el repo
  fuera de este entregable. Los cuatro son deterministas: FE-32C2-M1 afirmando
  que el HTML de `/admin/corridas` con una corrida de `datos_instrumentacion`
  contiene «Datos e instrumentación» (el doble exacto de la aserción que
  `page.test.tsx:82` ya usa para el error); FE-32C2-B1 afirmando que ese mismo
  HTML NO contiene `corridasFiltradas:` cuando el doble rechaza;
  FE-32C2-B2 afirmando que `/dashboard/asistencia` no imprime `>emergencia
  medica<`; FE-32C2-B3 cruzando `Object.keys(ROTULO_ROL)` y sus VALORES contra
  `ROTULOS_ROL` de `roles.ts` — el mismo patrón que
  `etiquetas_sincronizadas.test.ts` ya usa para `CONCEPTO`.
