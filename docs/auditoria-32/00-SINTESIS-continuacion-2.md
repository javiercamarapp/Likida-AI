# Auditoría 32 — síntesis de la continuación 2

**18-sep-2026** · ronda de **CONTINUACIÓN**, 6 rubros rotados de 12 · rama
`claude/auditoria-32`, PR **#477** · árbol limpio al arrancar, **autofix
habilitado**.

**Global: 4.25** (antes **4.33**) · **▼0.08**. Con un decimal la cifra **no se
mueve** (4.3 → 4.3); la suma de las doce sí: **52 → 51**. Se reporta con dos
decimales a propósito, para no esconder el movimiento detrás del redondeo.

Sube 1 (modelo de datos), bajan 2 (pruebas, seguridad), se quedan 9.

---

## Lo primero: los dos CRÍTICOS de ayer cerraron, y esta vez lo dice quien no los arregló

La continuación del 17-sep metió dos migraciones (`0358`, `0359`) para cerrar
dos regresiones CRÍTICAS que había creado su propio arreglo del 16-sep. La regla
que esa ronda dejó escrita —*el rubro cuyo código tocó la auditoría anterior
entra en la rotación siguiente por derecho propio*— se aplicó hoy, y el auditor
de modelo de datos volvió a entrar con Postgres 16 propio.

**Veredicto: cerraron de verdad.** 336 migraciones limpias sobre base virgen,
`pg_get_functiondef` diffeado contra la definición anterior (la 0359 resultó ser
la 0355 con exactamente el CTE declarado: el trasplante de 190 líneas no
arrastró nada), rojo real en los dos sentidos, idempotentes, ACL intacta.

Es la primera vez en tres rondas que un arreglo del orquestador sobrevive entero
a la revisión del auditor cuyo código tocó. Las dos anteriores encontraron que
el arreglo cerraba a medias (31) o traía dos CRÍTICOS nuevos (32). **La regla se
está pagando sola, y hoy da su primer resultado positivo.**

**Pero ARQ-A3, el CRÍTICO del que nacieron las tres migraciones, sigue abierto
en su mitad más frecuente.** Con el OCR perdiendo uno de los dos RFC, motor y
panel dicen $2,500 / $344.83 donde la base tiene $5,000 / $689.66. Y el
invariante que fija la propia prueba de la 0359 —«las dos funciones dicen lo
mismo»— sigue siendo falso por el eje del folio: con `folio = ''`, el motor dice
$2,500 y el panel $5,000, porque la 0358 los lee crudos y la 0359 los pasa por
`nullif`, y la base no tiene ni un CHECK sobre `folio`, `folio_norm` ni
`rfc_emisor`. **Queda propuesto, no arreglado** — ver *pendientes*.

## El hallazgo metodológico de la ronda: el 6 de pruebas estaba sostenido por un hueco

Pruebas baja de 6 a 5 por **mirada más profunda**, y el número contable es
específico: el rubro llevaba **ocho rondas** calificándose sin haber mutado
nunca una línea de SQL. Hoy se pudo, y lo que había detrás es peor que lo
supuesto.

`gastos_fiscales_agregados_tenant` —la función de dinero del panel fiscal, 274
líneas reescritas a mano ayer— **se puede romper en cuatro sitios distintos** con
los 21 arneses SQL y los 243 bloques de la batería en verde, idénticos al
baseline las cuatro veces. Cuantitativo de la ronda: **26 mutaciones, 9 mueren
(34.6 %), 17 sobreviven.**

Lo que esto dice de la serie histórica: el 6 de pruebas de las rondas 24-32 no
medía la cobertura del repo, medía la cobertura de la mitad del repo que se
sabía mutar. **No es que las pruebas empeoraran; es que por primera vez se vieron
enteras.**

## Seguridad baja por deuda con factura, y la factura se midió dos veces

`andamio_ci.sql:99-104` omite **por escrito** el `alter default privileges … on
functions` de Supabase. El auditor levantó las mismas 336 migraciones dos veces:
con el andamio tal cual, **243 bloques · 239 ok · 0 fallos**; añadiendo esa única
línea, **237 ok · 2 fallos**. Y los dos bloques que se ponen rojos
(`verificaciones.sql:859` y `:971`) son exactamente los que certifican que
«ninguna RPC interna es ejecutable por un anónimo».

Es decir: la batería que declara cerrada esa propiedad la declara cerrada
**porque el andamio no reproduce la condición de producción**.

**Con honestidad sobre su alcance, y el auditor lo escribió él mismo:** midió la
consecuencia, no la causa. Que Supabase gestionado aplique hoy ese default
privilege lo afirman `0013:50-53` y `0315:18-20`, no una consulta a producción.
Un `select has_function_privilege('anon', 'public.try_lock_viaje(uuid,integer,uuid)', 'execute');`
contra la base real lo cierra en un minuto; **si diera `false`, el hallazgo se
cae entero.** Queda así declarado.

Lo que **no** hay, y también se midió: 0 tablas de `public` sin RLS, 0 funciones
`SECURITY DEFINER` alcanzables por `anon`, 1/1 vista con `security_invoker`, 6/7
buckets privados, `npm audit` 0/0/0/0/0 sobre 752 dependencias. **Ningún CRÍTICO
y ningún camino sin autenticar a datos de un tenant.**

---

## Las doce notas

| Rubro | 32·c1 | Hoy | Δ | Porqué |
|---|---|---|---|---|
| Modelo de datos y esquema | 5 | **6** | ▲1 | **Se atacó y subió.** Los dos CRÍTICOS de ayer cerraron, verificado contra Postgres por quien no los arregló. Contra eso, ARQ-A3 sigue abierto en su mitad más frecuente. |
| Backend y API | 6 | **6** | = | No auditado esta ronda. |
| Frontend | 5 | **5** | = | **Ninguna neta**, dos formas se cancelan con su número: primer cierre en cuatro rondas (FE-31C2-A1) contra FE-C1 en su **8ª ronda** y los abiertos de 13 → 15. |
| Pruebas | 6 | **5** | ▼1 | **Mirada más profunda.** Ocho rondas sin mutar SQL; hoy se pudo y la función de dinero del panel se rompe en **4** sitios con todo en verde. 26 mutaciones, 9 mueren. |
| Seguridad | 5 | **4** | ▼1 | **Deuda que cobró factura**, medida dos veces: `andamio_ci.sql:99-104` omite el default privilege de Supabase y los 2 bloques que se ponen rojos son los que certifican el aislamiento del anónimo. |
| Operabilidad y DX | 4 | **4** | = | **Dos formas se cancelan.** OP-A6 cerró tras seis rondas (issues #474/#476) y ese mismo arreglo trajo OP-32C2-C1, con factura fechada. |
| Tool calling | 4 | **4** | = | No auditado esta ronda. |
| Rendimiento y costo | 4 | **4** | = | **Ninguna neta.** 4 de 6 abiertos cerraron de verdad; el ancla se cumple hoy en **nueve** cadenas contra ocho, dos nunca sumadas por nadie. |
| Arquitectura y mantenibilidad | 4 | **4** | = | No auditado. ARQ-C1 abierto, **11ª aparición**. |
| Sistema agéntico | 3 | **3** | = | No auditado esta ronda. |
| Cumplimiento fiscal | 3 | **3** | = | No auditado esta ronda. |
| Cumplimiento legal | 3 | **3** | = | No auditado esta ronda. |

**Suma 51/12 = 4.25.** Los seis no auditados conservan su nota por regla y van
marcados `no auditado esta ronda`.

**Las notas que NO subí, y por qué lo digo:** los tres arreglos de hoy son de
*operabilidad*, *rendimiento* y *pruebas*. Ninguno de los tres rubros sube por
ellos — sería calificar mi propio arreglo con su auditor ya ido. Los califican
sus auditores en la 33.

---

## Los tres arreglos, con su rojo medido y su mutación

Tope de 3 vueltas **gastado**. Revertidos: **0**.

### `2c38766` — OP-32C2-C1 (CRÍTICO, nuevo)

`.github/workflows/salud-produccion.yml:226`

El paso que **cierra** el issue de deriva no repetía la guarda del paso que la
**mide**. La corrida **#671** (push de `69becdb` a master, 16-sep 08:21:57Z) lo
cerró con el comentario «Producción ya corre todo el código de master» mientras
producción corría `cfa00ab` y master llevaba `8b01aec` y `5ce91b2` sin publicar.
El detector había salido `skipped` y no midió nada: la salida de un paso saltado
es `null`, y GitHub convierte ambos lados a número, así que **`null == '0'` es
verdadera**. Ventana ciega de **1 h 47 min** (ver la corrección al final: el auditor dijo 2 h 54 y esa es otra cosa), episodio partido en dos issues.

Es el defecto que la auditoría 27 ya documentó en el paso hermano (issue #339).
La lección quedó escrita en `:292` y **nunca se copió** al cierre de la deriva.

**Prueba.** No es un `grep` del fuente: evalúa la condición real del paso bajo
las reglas de coerción documentadas de GitHub, para los tres estados en que
puede quedar la salida del detector, y afirma además el invariante estructural
de la 27 (quien declara la recuperación repite las guardas de quien la mide).
Rojo medido sobre el caso real de #671. **Mutación en los dos sentidos:** quitar
la guarda de evento y quitar el `format()` ponen roja la prueba por separado.

**Lo que la prueba prueba y lo que no:** aquí no se puede ejecutar GitHub
Actions. La evidencia de comportamiento es la corrida #671 medida y el
precedente de la 27 sobre el paso hermano.

### `fc811a0` — REN-30-C2 (CRÍTICO, reincidente desde la 29)

`pg.ts` · `intake/consolidado.ts` · `sat_descarga/ciclo.ts`

`ciclo.ts` mira la hora una vez por XML (`:277`) y despachaba
`guardarYConciliarConsolidado` **sin reloj**. Dentro, `candidatosDeGasto` lee
`gasto` con un techo estructural de `MAX_PAGINAS × PAGINA` = 100,000 filas:
**30.0 s nominales y hasta 950 s a techos**, contra `maxDuration = 300` y los
43.5 s que la ruta reservó para esa unidad. La invocación moría con los sellos a
medio escribir y **sin `registrarLatido`**: el tablero decía «no late» para el
cron que recoge los CFDI del SAT, cada seis horas, sin decir por qué.

El corte **lanza** y no devuelve lo leído: media lista de candidatos concilia de
menos y sella el CFDI como si se hubiera revisado entero — cambiar una caída
ruidosa por una cifra fiscal equivocada y silenciosa sería el peor intercambio
posible en este producto. Como ocurre **antes** del primer avance durable, el
`try/catch` que ya estaba en `ciclo.ts:344` lo anota y el comprobante queda sin
sellar: la vuelta siguiente lo retoma entero.

**Rojo medido pidiendo 100 páginas donde deben ser 0.** Tres pruebas, y la
tercera es la que importa: **el cableado**. Se escribió porque las otras dos
pasaban en verde con el cableado desconectado — que es exactamente lo que
`PRU-31C-A1` lleva dos rondas reportando.

### `e47f974` — PRU-31C-A1 (ALTO, reincidente)

`src/app/dashboard/agentes/peajes/reloj-cableado.test.ts`

Borrar `{ venceEn: … }` de la única llamada de producción de
`barrerPorConciliar` **compila** y devuelve el barrido a ~914 s contra 300 de
techo, con **613 pruebas en verde**.

**Dos mutaciones medidas**, y la segunda justifica la segunda aserción: la del
auditor (2 rojas) y `venceEn: 0`, que desarma el corte igual de bien y que una
sola aserción de presencia habría dejado pasar (1 roja).

Se afirma sobre el fuente y **el porqué está escrito en el encabezado**: la
acción es un cierre `'use server'` dentro del componente de `page.tsx`, así que
no hay nada importable que invocar — el mismo trato que le da
`cobranza/reloj-corte.test.ts` a su acción hermana. El corte se hace sobre la
expresión de la llamada equilibrando paréntesis, no sobre el archivo entero.
**Lo que no hace es ejecutar el barrido**; eso exige extraer la acción del
componente, que es un refactor y no un parche.

---

## Pendientes, con la razón escrita

- **FE-C1 (CRÍTICO, 8ª ronda)** — el encargado despacha sin campo de Anticipo y
  el servidor escribe `0`; el comprador ve `Anticipo $0.00 · entregado al
  operador`. **No se arregló a propósito:** las dos salidas son una decisión de
  producto, no un parche. O `encargado` captura dinero (`visibilidad.ts:41`,
  cambio de permisos), o el 0 deja de escribirse y la pantalla declara «no
  capturado» (cambio de esquema + servidor + vista). **Un hallazgo en su octava
  ronda no necesita un noveno reporte, necesita que el dueño elija.**
- **OP-C1 (CRÍTICO, 8ª ronda)** — las dos degradaciones rojas de la ventana
  dejaron una palabra, `degraded`, y ningún identificador. Misma clase: exige
  decidir qué identificador publica `/api/health`.
- **PRU32C2-C1 (CRÍTICO, nuevo)** — los cuatro sitios por donde se rompe la
  función de dinero del panel con todo en verde. Cerrarlo es escribir arneses
  SQL nuevos, no un parche: **merece una ronda dedicada**, y el auditor ya dejó
  enumerados los cuatro puntos.
- **PRU-C1 (CRÍTICO, 5ª ronda)** — la cifra que la pantalla imprime sigue en
  **0 de 18** pruebas. Causa raíz escrita: la puerta de cobertura mide donde el
  dinero se *calcula* y excluye por configuración donde se *imprime*.
- **DAT32C2-A1/A2/A3 (ALTO)** — el espejo motor↔panel roto por el eje del folio.
  Es el mismo rediseño que DAT32C-A1: tocar `copiasDeComprobante`, que corre
  sobre UN viaje donde su criterio es el correcto.
- **REN-32C2-A1/A2/A3 (ALTO, nuevos y medidos)** — `cron/jornada` 83.0/60,
  `cron/portales-vivos` 154.2/120, `encolarOtraVuelta` hasta 1,804 s dentro de
  una ruta de 120. **Tope de 3 vueltas gastado**; van a la 33 con sus sumas
  hechas.
- **ARQ-C1 (11ª aparición)** y **SEG-31-A1 (5ª)**: abiertos, sin auditar su
  rubro hoy en el caso de ARQ-C1.

---

## Lo que urge y no es código — SEXTO día consecutivo

```
último [deploy] en asunto                        →  cfa00ab (10-sep, hace 8 días)
git diff --name-only cfa00ab..origin/master -- src/ supabase/ | wc -l  →  21
```

**21 archivos** de `src/`/`supabase/` en `master` que nunca llegaron a
producción, entre ellos el cubo del 15 % (ARQ-C2: $90,600 impresos donde lo
correcto son $95,300). El pulso sale verde igual porque mide «¿aterrizó lo
último que se pidió publicar?», no «¿producción está al día?».

**Se arregla con Redeploy en Vercel.** No es un hallazgo de ningún rubro: es una
acción del dueño, y lleva seis días pedida.

Novedad de hoy, y es la que lo empeora: hasta ayer el único artefacto que lo
gritaba era el issue #476 — y `OP-32C2-C1` demuestra que **ese issue se apaga
solo con el primer push a `master`**, dejando escrita una afirmación falsa. El
merge de esta misma rama habría sido ese push. Con `2c38766` ya no.

---

## Compuerta, sobre el árbol final

```
npx vitest run       989 archivos · 12,990 pasan · 6 saltadas · 0 fallan · exit 0
npx tsc --noEmit -p . exit 0, sin salida
npm run lint          0 errores · 154 avisos
npm run lint:ratchet  0 nuevos · 154/194 heredados
```

Línea base al arrancar: **988 / 12,976 / 6 / 0**, idéntica cifra por cifra al
cierre de ayer — lo que confirma que el árbol no se había movido. `npm run
build` no se corre en la nube: pide Supabase, OpenRouter, Facturapi y Upstash.

El intermitente de `cron/asistencia/route.test.ts` **no reapareció** en ninguna
de las cuatro pasadas completas de la ronda: `4b84716` lo cerró ayer.

**Tablero:** `tablero-continuacion-2.html` + `.png`, capturado **y mirado** —
mirarlo encontró que el eje de la serie global traía **dos etiquetas `c·1`**
(la continuación de la 31 y la de la 32), que hacía la serie ilegible. Corregido
a `31·c1` / `32·c1` y recapturado. Verificado en la imagen: 12 rubros, 6 pastillas
«auditado hoy», suma 51, global 4.25.

## Corrección del orquestador, sobre una cifra de esta misma síntesis

El auditor de operabilidad escribió «la ventana ciega fue de **2 h 54 min**» y
yo la propagué al commit `2c38766`, a esta síntesis y al cuerpo del PR. **Está
mal, y la verifiqué contra la fuente primaria** (`list_issues` con etiqueta
`deriva-sin-desplegar`):

```
#474  creado  2026-09-16T05:27:22Z   cerrado (falsamente) 2026-09-16T08:21:57Z
#476  creado  2026-09-16T10:09:12Z   sigue ABIERTO, nombra los mismos 2 commits
```

- **2 h 54 min 35 s** es lo que el issue estuvo **correctamente abierto** antes
  del cierre falso (05:27:22 → 08:21:57).
- **La ventana ciega —sin ningún issue abierto pese a haber deriva real— es de
  1 h 47 min 15 s** (08:21:57 → 10:09:12).

El hallazgo no cambia: el cierre fue falso, y que `#476` reabriera el episodio
con los **mismos dos commits** (`8b01aec` y `5ce91b2`) es la prueba
independiente de que la deriva seguía ahí cuando se declaró resuelta. Lo que
cambia es la magnitud, y se corrige porque la regla que define este producto es
no dar por buena una cifra que no se midió. El commit `2c38766` quedó con la
cifra vieja en su mensaje; no se reescribe el historial por eso — se corrige
aquí, que es donde se lee.

## INFRA de esta corrida

- El clon llegó **sin `node_modules`** (`npm ci`, exit 0, 614 paquetes, 0
  vulnerabilidades).
- No hay `gh` en la imagen: todo lo de GitHub salió del MCP.
- `docs/auditoria-*/` está en `.gitignore:36` y se commitea con `git add -f`.
- `git ls-remote origin master` **primero**, como dejó escrito la continuación 2
  de la 31: hoy el ref vino fresco y no hubo borrados falsos.
- Los seis auditores respetaron el contrato: ninguno tocó código. Tres de ellos
  reportaron por su cuenta que veían archivos modificados que no eran suyos —
  eran mis arreglos en vuelo — y los dejaron intactos.
