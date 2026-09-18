# Seguridad — auditoría 32 (continuación 2, 18-sep)

**Nota: 4/10** (antes 5). Razón del movimiento: **deuda que cobró factura**.
El número contable, medido hoy contra Postgres 16 con las 336 migraciones
aplicadas sobre base virgen:

- De los **12** hallazgos abiertos que me tocaban (9 del cuerpo de la 31 + los
  3 de su continuación 2), **12 siguen abiertos** y **0 se cerraron**. Los
  reabrí uno por uno con el `archivo:línea` puesto. `SEG-31-A1` cumple su
  **quinta** ronda sin un commit encima.
- Entran **2 hallazgos nuevos**: uno **ALTO** y uno **MEDIO**.
- Y baja **1** de severidad: `SEG-31-M1` pasa de MEDIO a BAJO porque por fin
  lo **medí** en vez de deducirlo (ver abajo: el grant a `anon` SÍ sobrevive,
  y la explotación SÍ está cerrada por otra capa).

La factura que cobró la deuda es concreta y es nueva: `andamio_ci.sql:99-104`
decidió **por escrito** no reproducir el `alter default privileges … on
functions` de Supabase, llamándolo «una regla redundante». Levanté las mismas
336 migraciones dos veces, con el andamio tal cual y con esa única línea
añadida, y corrí la batería contra las dos:

```
andamio de CI tal cual   → 243 bloques · 239 ok · 0 fallos   «La batería pasó.»
+ ADP fiel de funciones  → 243 bloques · 237 ok · 2 fallos
```

Los dos bloques que se ponen rojos (`verificaciones.sql:859` y `:971`) son
**exactamente** los que asientan el invariante «lo interno no es ejecutable por
un anónimo». O sea: la segunda capa de mi rubro afirma en verde una propiedad
que en producción es falsa, y lo afirma por una decisión documentada. Eso es
deuda presentando la cuenta, no una mirada más profunda sobre código quieto.

**Riesgo mayor del rubro, hoy:** sigue siendo `SEG-31-A1` — dos corridas de QA
solapadas en la misma instancia tibia se desinstalan el interceptor de salida a
Meta la una a la otra, y la que queda viva manda WhatsApp de verdad con el token
real. Quinta ronda abierto, cero commits encima.

---

## Lo que esta ronda pudo medir y las anteriores no

El MAPA dice que se puede correr Postgres. Lo corrí. Receta de `ci-postgres.yml`
sobre `/usr/lib/postgresql/16/bin`, `andamio_ci.sql` + las **336** migraciones
una por una: **336 aplicaron limpias** sobre base virgen. Con eso dejé de
deducir tres cosas que llevaban rondas en «no alcancé a revisar».

**1. Las tres migraciones nuevas (0357, 0358, 0359) están limpias.** Medido en
el catálogo, no leído del comentario:

```
proname                            secdef  proconfig                          proacl                                   anon auth svc
sumar_combustible_ejercicio          f     search_path=public, pg_catalog     {postgres=X,service_role=X}                f    f    t
gastos_fiscales_agregados_tenant     f     search_path=public, pg_catalog     {postgres=X,service_role=X}                f    f    t
```

- `SECURITY INVOKER`: correcto. Ninguna de las dos fue nunca `SECURITY
  DEFINER` (`0084:11`, `0151:64`, `0190`, `0192`, `0282`, `0305`, `0316`,
  `0317`, `0349`, `0355` — ninguna la declara), así que el `create or replace`
  sin cláusula las deja en el **default**, que es INVOKER. No hay degradación
  silenciosa.
- `search_path`: fijado en las tres (`0357:64`, `0358:57`, `0359:59`). El
  bloque E de `capa1_auditoria_estatica.sql:198-228` lo exige y sale verde.
- **Los GRANT sobreviven al replace**, tal como afirma `0359:45`. Lo confirmé:
  `proacl` sigue siendo `{postgres, service_role}` después de tres replaces
  seguidos sin repetir el `revoke/grant` que sí traían `0151:190-191`,
  `0192:150-151`, `0282:155-156`, `0316:175-176`, `0317:262-263` y
  `0355:216-217`. Omitirlo es correcto por el contrato de PostgreSQL
  («ownership and permissions do not change»), y aquí está medido.

**2. El barrido de superficie, con números en vez de memoria.** Sobre la base
con las 336 migraciones y el andamio **fiel** (el estricto):

- **0** tablas de `public` sin RLS (`relkind='r' and not relrowsecurity`).
- **1/1** vista con `security_invoker=true` (`factura_saldo`).
- **7** buckets de storage, **1** público (`avatares`) y sus 3 políticas de
  escritura ancladas a `(storage.foldername(name))[1] = auth.uid()`.
- **13** funciones de `public` ejecutables por `authenticated` que no son de
  extensión ni de trigger. Las cuatro `SECURITY DEFINER` de esa lista
  (`administra_flota`, `get_user_tenant_ids`, `is_superadmin`, `ve_finanzas`,
  `ve_operacion`) son ayudantes de política RLS y tienen que serlo. **Ninguna
  función que devuelva datos de un tenant es alcanzable por `anon` ni por
  `authenticated`.**
- **0** funciones `SECURITY DEFINER` de `public` ejecutables por `anon`, con
  el andamio fiel incluido.

**3. `npm audit`, las dos formas, sobre este `package-lock.json`:**
`{"info":0,"low":0,"moderate":0,"high":0,"critical":0,"total":0}` con y sin
`--omit=dev`, sobre **752** dependencias (216 prod, 415 dev, 161 optional, 43
peer). **No hay ningún CVE que descartar porque no hay ninguno.** Lo dejo
medido por mí, no heredado.

---

## Hallazgos

### [ALTO] SEG-32-A1 · El andamio de CI omite el `alter default privileges … on functions` de Supabase, y con eso vuelve INFALSIFICABLES los dos bloques que certifican «ninguna RPC interna es ejecutable por un anónimo» — NUEVO

`supabase/pruebas-aislamiento/andamio_ci.sql:99-104` (la omisión, con su
justificación por escrito) · `supabase/verificaciones.sql:857` (el comentario
que la contradice), `:873-874` y `:879` (bloque 16) · `:987-996` (bloque 18) ·
`supabase/migrations/0013:50-53` (la lección que el andamio ignora) ·
`supabase/migrations/0280:90-91`, `:115` (las tres funciones afectadas)

**El mecanismo, con las dos frases que se contradicen.** `andamio_ci.sql:99-104`
dice: *«Las funciones NO necesitan una regla aquí: Postgres concede EXECUTE a
PUBLIC en toda función nueva por default … Agregar una regla redundante aquí
escondería ese mecanismo real»*. Pero `0013:50-53` dice lo contrario y dice que
lo verificó contra la base de verdad: *«Supabase concede EXECUTE a
anon/authenticated de forma EXPLÍCITA por default privileges, así que `revoke
from public` NO basta (se verificó en la DB: anon/authenticated seguían con
EXECUTE)»*. Esa misma lección la citan `0159:146`, `0237:229`, `0263:148`,
`0284:111` y `0315:5-8` — la 0315 incluso trae la medición: *«Confirmado en rojo
contra Postgres real (283 migraciones): `has_function_privilege('anon',
'public.tenant_perfil_merge(uuid,jsonb,uuid)','EXECUTE')` daba `true`»*. El
andamio es el único archivo del árbol que sostiene lo contrario, y es el que
decide qué mide la batería.

**Escenario, con valores. Lo corrí dos veces hoy, misma receta, un solo
statement de diferencia:**

```
# A · andamio_ci.sql tal cual + 336 migraciones
node scripts/ci/correr-verificaciones.mjs capa1_auditoria_estatica.sql verificaciones.sql
  → 243 bloque(s) · 239 ok · 0 fallo(s)      «La batería pasó.»

# B · lo mismo + la única línea que falta, la que aplica Supabase al aprovisionar:
#     alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  → 243 bloque(s) · 237 ok · 2 fallo(s)      «La batería NO pasó.»

  x verificaciones.sql:859  PERMISOS  rls-en-wa_mensaje=t anon-intake=f
       anon-lock=t  anon-unlock=t  service-role-intake=t   (esperado t/f/f/f/t)
  x verificaciones.sql:971  AISLAMIENTO  tablas-sin-rls=—  politicas-que-dicen-true=—
       rpc-abiertas-a-anon=try_lock_viaje, unlock_viaje   (esperado — / — / —)
```

Y el catálogo dice por qué: en B, `proacl` de `try_lock_viaje`, `unlock_viaje`
y `wa_orden_evento` es
`{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}`
— sin la entrada de PUBLIC, porque el `revoke … from public` de `0280:90-91`
y `:115` **sí** funcionó, y con `anon=X` intacto, porque ese revoke nunca lo
tocó. `intake_delta`, que está en la misma lista del bloque 18, sale `f` en las
dos corridas: `0031:83` la revoca `from public, anon, authenticated` — la forma
correcta. La diferencia entre las dos funciones es una coma.

**Consecuencia.** Para el equipo que mantiene esto: el bloque 18 de
`verificaciones.sql` existe, textualmente, para detectar «**una función interna
ejecutable por `anon`**» (`:962`), y hoy no puede detectarla nunca, porque el
andamio le quita el mecanismo por el que ocurre. La próxima función que se
escriba con el molde de `0012`/`0280` (`revoke … from public` a secas) va a
nacer abierta a `anon` en producción y a salir verde en CI, igual que estas tres
llevan dos años saliendo. Y es la única capa automática que hay: el ancla «dos
capas independientes» se apoya en esta batería, y sobre esta clase de defecto
la batería es una sola capa que además mira al lado equivocado.

**Causa raíz probable:** el andamio modeló los `default privileges` de Supabase
para TABLAS y decidió que para FUNCIONES el default nativo de PostgreSQL ya era
equivalente; no lo es, y la diferencia es justo la que el `revoke from public`
no alcanza.

---

### [ALTO] SEG-31-A1 · Dos corridas de QA solapadas se desinstalan el interceptor de salida a Meta — REINCIDENTE, 5ª ronda, cero commits encima

`src/lib/admin/qa-motor.ts:190` (`const original = globalThis.fetch;`) y `:227`
(`return () => { globalThis.fetch = original; };`) · instalado en `:629` y
`:1038` · sin candado de corrida viva en
`src/app/api/admin/qa/lanzar/route.ts:82-108` ni en
`src/app/api/admin/qa/[id]/continuar/route.ts`

Reabierto y releído hoy: `:190` y `:227` están **idénticos**, sin comprobar que
el `globalThis.fetch` actual siga siendo el que este instalador puso.
`lanzar/route.ts` crea la corrida (`:82`) y la lanza (`:103-106`) sin preguntar
si hay otra viva.

**Y la guardia nueva de `:197` no lo cubre, que es lo que hay que mirar antes de
darlo por cerrado.** `if (contextoQa.getStore()?.corridaId !== corridaId) return
original(input, init);` impide **sobre**-interceptar (que la corrida A capture
lo de B). No impide **sub**-interceptar, que es el hallazgo: A instala en `t=0`
con `originalA = realFetch`; B instala en `t=5 s` con `originalB =
interceptorA`; A restaura en `t=110 s` poniendo `globalThis.fetch = realFetch`,
y con eso **borra a interceptorB del global**. B sigue viva ~190 s más y sus
POST salen por `realFetch` a
`https://graph.facebook.com/v21.0/<WHATSAPP_PHONE_NUMBER_ID>/messages` con el
token real y `to: "5215559900001"`, sin una sola fila `QA:` en `wa_outbox`.

**Consecuencia.** Un número de prueba del guion de QA recibe WhatsApp reales
durante una demo, y el registro de la corrida dice que no se mandó nada. Si el
número resulta ser el de un contralor del piloto, el mensaje llega a él.

**Causa raíz probable:** un parche de `globalThis` con restauración LIFO en un
runtime donde dos invocaciones comparten el mismo módulo; falta el candado de
«una corrida viva» y falta comprobar identidad antes de restaurar.

---

### [MEDIO] SEG-32-M1 · La guardia que impide mandar la contraseña HEREDADA del PAC a un host ajeno no mira el ESQUEMA, así que `http://` la deja salir en claro — NUEVO

`src/lib/likida/sat_descarga/index.ts:70-78` (`hostSwSinVerificar`, la guardia)
· `:132` (la herencia: `(process.env.LIKIDA_SAT_PASSWORD ||
process.env.LIKIDA_PAC_PASSWORD) ?? ''`) · `src/lib/likida/sat_descarga/sw.ts:79-82`
(dónde viaja) · `src/lib/likida/pac/index.ts:41-47` (el mismo hueco sin guardia)

**El mecanismo.** La guardia se escribió en la auditoría 25 exactamente contra
«un valor mal escrito, o apuntado a otro lado» (`index.ts:59-69`). Compara
`new URL(urlBase).hostname` contra `api.sw.com.mx` y **nada más**. El esquema no
entra en la comparación, y ningún punto posterior lo revisa: `sw.ts:79` hace
`fetch(`${cfg.urlBase}/security/authenticate`, { headers: { user, password } })`
con la contraseña en una cabecera plana.

**Escenario, con valores. Reproduje la función tal cual:**

```
LIKIDA_SAT_PROVEEDOR = sw
LIKIDA_SAT_URL       = http://api.sw.com.mx      ← el typo de una letra
LIKIDA_SAT_PASSWORD  = (vacía → hereda)
LIKIDA_PAC_PASSWORD  = la que timbra los CFDI de la flota

hostSwSinVerificar('sw','http://api.sw.com.mx')          -> false  (no bloquea)
hostSwSinVerificar('sw','https://api.sw.com.mx')         -> false  (no bloquea)
hostSwSinVerificar('sw','http://evil.com')               -> true   (bloquea)
hostSwSinVerificar('sw','https://api.sw.com.mx.evil.com')-> true   (bloquea)
```

Entra `http://api.sw.com.mx` → `estadoDescargaSat()` contesta
`configurado: true`, `resolverDescargaSat()` devuelve el proveedor, y el primer
ciclo manda `POST http://api.sw.com.mx/security/authenticate` con
`headers: { user: <usuario del PAC>, password: <contraseña del PAC> }` **en
texto plano**.

**Consecuencia.** Cualquiera en el camino entre Vercel y ese host se queda con
la credencial que **timbra y cancela CFDI a nombre del RFC de la flota** — la
misma que el comentario de `:59-69` dice estar protegiendo. El daño no es leer
una descarga: es emitir o cancelar comprobantes fiscales de un cliente.

**Y lo que me obliga a dejarlo en MEDIO, no más arriba:** la precondición es un
error de captura de Javier, hoy no hay nada configurado (pre-revenue, cero
clientes) y con `LIKIDA_SAT_PASSWORD` propia la guardia ni siquiera aplica por
diseño declarado. No es un camino que un tercero abra por su cuenta.

**Causa raíz probable:** la guardia se escribió sobre `hostname` cuando lo que
protege es el canal; `new URL()` separa esquema y host y solo se leyó uno de los
dos.

---

### [MEDIO] SEG-31-M2 · Dos páginas autenticadas viven fuera del matcher del proxy, y la prueba que vigila esa frontera la fija en tres — REINCIDENTE, 3ª ronda

`src/proxy.ts:123` (`RUTAS_CON_SESION = ['/dashboard','/admin','/vendedor']`),
`:132`, `:170` · `src/proxy.test.ts:84-86` · `src/app/cuenta/page.tsx:16` ·
`src/app/mcp/autorizar/page.tsx:145`

Reabierto línea por línea hoy: `:123` sigue siendo la tupla de tres; `:170`
(`res.headers.set('Cache-Control','no-store, no-cache, must-revalidate')`) sigue
**dentro** del `if` de `:132`; `cuenta/page.tsx:16` sigue siendo
`await requireSessionTenant('/cuenta', sp)` con el `supabaseAdmin()` de `:18-19`
debajo; `mcp/autorizar/page.tsx:145` sigue siendo `await getSessionTenant()`.
`ls src/app/cuenta src/app/mcp/autorizar` devuelve **solo `page.tsx`** en las
dos: no hay `layout.tsx` que pudiera ser la segunda capa. Y `proxy.test.ts:84-86`
sigue siendo la igualdad exacta contra los tres literales, o sea que **agregar
`/cuenta` a la lista rompe la suite**. Es el punto del árbol donde el ancla «dos
capas independientes» se queda en una.

---

### [MEDIO] SEG-31-M3 · 13 salidas 200 con datos de un tenant, autenticadas por cookie, siguen sin `no-store` — REINCIDENTE, 4ª ronda

`src/app/api/v1/{liquidaciones,viajes,clientes,operadores,unidades}/route.ts` y
compañía · `next.config.ts:246-275` · `src/proxy.ts:177` (el matcher que excluye
`api`)

Medido hoy, no heredado: `grep -l no-store` sobre las **7** rutas de
`src/app/api/v1/**/route.ts` devuelve **cero archivos**, y el bloque
`headers()` de `next.config.ts:246-275` pone CSP, `X-Frame-Options`, `nosniff`,
`Referrer-Policy`, `Permissions-Policy` y HSTS sobre `/api/:path*` — y **ningún
`Cache-Control`**. El camino de la llave (`Authorization: Bearer lk_live_…`)
queda fuera por RFC 9111 §3.5, como se refutó en la 30; el que vive es el de la
cookie, que `_comun.ts:230-287` sí acepta.

---

### [MEDIO] SEG-31-M4 · El aislamiento de la corrida entra con `enterWith` y las ocho pruebas que lo certifican usan `run` — REINCIDENTE, 5ª ronda

`src/lib/admin/qa-motor.ts:627` y `:1036`

Releídos hoy: `:627` es `contextoQa.enterWith({ corridaId: corrida.id })` y
`:1036` es `contextoQa.enterWith({ corridaId })`. `grep -n 'contextoQa.run'`
sobre `src/lib/` devuelve **0**; las ocho pruebas de `qa-motor.test.ts` siguen
usando `run`. Importa más que antes, porque la guardia nueva del interceptor
(`:197`) **depende** de que `contextoQa.getStore()` diga la verdad, y ese store
es el que `enterWith` propaga distinto de como lo propaga `run`.

---

### [BAJO] SEG-31-M1 · `0280` revoca tres funciones solo `from public` y el grant implícito a `anon`/`authenticated` sigue vivo — REINCIDENTE, 3ª ronda · **BAJA de MEDIO a BAJO, medido**

`supabase/migrations/0280:90`, `:91`, `:115` contra `:158` del mismo archivo ·
`supabase/migrations/0158:562` (la capa que lo cierra)

**El mecanismo queda CONFIRMADO.** Dos rondas lo dieron por «veredicto
estático». Hoy lo medí sobre Postgres real con el andamio fiel: `proacl` de
`try_lock_viaje(uuid,integer,uuid)`, `unlock_viaje(uuid,uuid)` y
`wa_orden_evento(jsonb,timestamptz)` es
`{postgres=X,anon=X,authenticated=X,service_role=X}`, y
`has_function_privilege('anon', …, 'execute')` da **true** en las tres. Es
cierto lo que se venía afirmando.

**Y la explotación queda REFUTADA, también medida.** Corrí el ataque:

```
set role anon; select public.try_lock_viaje('1111…'::uuid, 600000, gen_random_uuid());
  → ERROR: permission denied for table viaje_lock
set role anon; select public.unlock_viaje('1111…'::uuid, null);
  → ERROR: permission denied for table viaje_lock
set role anon; select public.wa_orden_evento('{"timestampMs":"1"}'::jsonb, now());
  → 1
```

Las dos del mutex son `SECURITY INVOKER` (`prosecdef = f`), y `viaje_lock`
tiene `relacl = {postgres=arwdDxt,service_role=arwd}` porque `0158:562` hace
`revoke all on table public.viaje_lock from anon, authenticated`. La tercera sí
corre, pero es aritmética pura sobre un `jsonb` que el llamante trae: no lee ni
escribe una fila. **No hay DoS del mutex del viaje ni cuadre duplicado por esta
vía.** Baja a BAJO: lo que queda vivo es el defecto de higiene y el hecho de que
la única red que lo tapa es un `revoke` de tabla de otra migración — exactamente
el argumento con el que `0315:11-20` justificó arreglar el caso gemelo.

---

### [BAJO] SEG-31-B1 · `capturarBitacora` tiene el mismo defecto LIFO y le corta la evidencia a la corrida viva — REINCIDENTE, 5ª ronda

`src/lib/admin/qa-motor.ts:150-166`, instalada en `:628` y `:1037`. Intacta:
`:152` es `const originales = { info: logger.info, warn: logger.warn, error:
logger.error }` y `:161-165` repone los tres sin comprobar identidad, pegada a
los `enterWith` de M4 y a los `instalarInterceptorSalidaMeta` de A1.

---

### [BAJO] SEG-31-B2 · El preflight de la póliza es la única salida 200 de `export/` sin `no-store` — REINCIDENTE, 4ª ronda

`src/app/api/export/poliza/route.ts:410-422` (el `if (preflight)`, un
`NextResponse.json` sin cabeceras) contra `:442` y `:466`, que sí llevan
`'Cache-Control': 'no-store'`. Archivo no tocado en la ventana.

---

### [BAJO] SEG-31-B3 · `0353` y `0356` dejan de declarar `SECURITY INVOKER`, y `0357`/`0358`/`0359` repiten el patrón — REINCIDENTE, 4ª ronda, ahora con la medición que faltaba

`supabase/migrations/0353:230-233` · `0356:21-24` · y ahora también
`0357:59-64`, `0358:52-57`, `0359:55-59`

Las cinco hacen `CREATE OR REPLACE FUNCTION` sin la cláusula `SECURITY`,
mientras que el historial de esas mismas funciones sí la escribía
(`0173:50`, `0262:52`, `0264:58`, `0273:40`, `0286:45` para
`ejecutar_arco_cancelacion`; `0151:59-60`, `0192:19`, `0282:15` para la fiscal).

**Lo que puedo afirmar hoy y antes no:** medido en el catálogo, `prosecdef = f`
para `ejecutar_arco_cancelacion`, `sumar_combustible_ejercicio` y
`gastos_fiscales_agregados_tenant` — **el comportamiento es el correcto**,
porque el default de PostgreSQL es INVOKER y ninguna de las tres fue DEFINER.
El defecto es de red, no de efecto: el día que este molde se aplique sobre una
función que **sí** es `SECURITY DEFINER` (`revisar_liquidacion`, por ejemplo,
que `0353:19-22` sí declara), el replace la degrada a INVOKER en silencio, y
ningún bloque de `capa1_auditoria_estatica.sql` mira que `prosecdef` no cambie
entre migraciones — el bloque B (`:95-124`) solo mira quién puede ejecutar las
que **son** DEFINER.

---

### [BAJO] SEG-31-B4 · La prueba de `/dashboard/suscripcion` afirma «renderiza para cualquier rol» tras doblar el único gate de vista — REINCIDENTE, 4ª ronda

`src/app/dashboard/suscripcion/page.test.tsx:38` (el doble:
`vi.mock('@/lib/auth/guard', () => ({ requireSessionTenant: async () => sesion }))`)
contra `:102` (`it('la página renderiza para cualquier rol …')`). Archivo no
tocado.

---

### [BAJO] SEG-31C2-B1 · La inyección de ARGUMENTO de `deriva-sin-desplegar.mjs` sigue viva — REINCIDENTE, 2ª ronda

`scripts/ci/deriva-sin-desplegar.mjs:68-71`, `:79-86` ·
`.github/workflows/salud-produccion.yml:178` (el único guardarraíl de hoy).
`git diff origin/master..HEAD --stat` no toca `scripts/` ni `.github/`: el
archivo está tal cual quedó en `8c0e7df`. El escenario con valores (`--output=`
creando un archivo) está entero en `docs/auditoria-31/seguridad-continuacion-2.md`
y lo suscribo sin cambiar una cifra.

---

### [BAJO] SEG-31C2-B2 · La prueba que debía impedir la vuelta del shell se satisface con un COMENTARIO — REINCIDENTE, 2ª ronda

`scripts/ci/deriva_sin_desplegar.test.ts:86-92` ·
`scripts/ci/deriva-sin-desplegar.mjs:61` (la prosa del JSDoc que satisface el
assert) y `:29` (la única línea que importa). Sin cambios en la ventana.

---

### [BAJO] SEG-31C2-B3 · El paso «avisa, no bloquea» sí puede poner el pulso en rojo — REINCIDENTE, 2ª ronda

`scripts/ci/deriva-sin-desplegar.mjs:86` (sin `try`/`catch`) ·
`.github/workflows/salud-produccion.yml:172-179` y `:228-229` ·
`scripts/ci/deriva_sin_desplegar.test.ts:111-117`. Sin cambios en la ventana.

---

## Descartados por escrito

**No hay CRÍTICO y no hay camino sin autenticar a datos de un tenant.** Esta vez
no es un veredicto heredado: es lo que dice el catálogo de una base con las 336
migraciones aplicadas y con los default privileges de Supabase reproducidos
fielmente. 0 tablas sin RLS, 0 funciones `SECURITY DEFINER` alcanzables por
`anon`, 0 funciones que devuelvan datos de tenant alcanzables por `anon` o por
`authenticated`, 1/1 vista con `security_invoker`, 6/7 buckets privados.

**CVEs: ninguno que descartar, porque no hay ninguno.** `npm audit` y
`npm audit --omit=dev` sobre este `package-lock.json`: `{info:0, low:0,
moderate:0, high:0, critical:0, total:0}` sobre 752 dependencias. **No existe en
este árbol un CVE con o sin camino de explotación en esta app.**

**La firma del webhook de WhatsApp.** La abrí buscando el hueco clásico y no
está: `route.ts:136` corta el cuerpo por `content-length` **antes** de leerlo,
`:138-139` lo lee acotado con `leerCuerpoAcotado`, y `:140` verifica el HMAC
**antes** de parsear el JSON, y `client.ts:87-94` falla cerrado si `WHATSAPP_APP_SECRET`
falta y compara con `timingSafeEqual` tras igualar longitudes. El `GET` de
verificación (`client.ts:78-84`) es igual de cerrado.

**El `url`/`sub` de la firma de QStash NO se verifica, y aun así no es
hallazgo.** `src/app/api/cron/facturar/cola/route.ts:63-67` llama
`receiver.verify({ signature, body })` sin `url`, y el propio SDK
(`node_modules/@upstash/qstash/h3.js:1487`) solo comprueba el `sub` cuando se le
pasa: `if (request.url !== void 0 && p.sub !== request.url)`. O sea, una firma
emitida por QStash para OTRO endpoint de la misma cuenta se acepta aquí.
**Descartado:** publicar un mensaje firmado exige el token de la cuenta, y con
ese token ya se puede llamar a los dos endpoints de cola directamente. No hay
primitiva que gane nada. Lo anoto porque el día que se agregue un tercer
callback con un cuerpo de otra forma, el binding faltante deja de ser inocuo.

**La puerta de los crons.** Los 13 `route.ts` de `src/app/api/cron/**`: 11 pasan
por `puertaCron` (`salud.ts:78-95`: 500 + alerta si falta `CRON_SECRET`, 401
timing-safe con `autorizaCron` si no autoriza) y los 2 que no
(`facturar/cola`, `wa-pendientes/cola`) son callbacks de QStash con verificación
de firma y tope de cuerpo antes de verificarla. **Ninguna ruta de cron queda sin
puerta.** Lo conté ruta por ruta, no por el nombre del archivo.

**El CSRF de las escrituras por cookie.** `src/lib/auth/csrf.ts:58-69`:
`Sec-Fetch-Site` manda (cabecera prohibida para JS, no falsificable desde una
página), `Origin` contra el host propio como respaldo, y «sin ninguna de las
dos, pasa» — que parece el hueco y **no lo es**, porque un CSRF *es* un
navegador y un navegador siempre manda `Origin` en un POST cross-site. Está
cableado en las 12 rutas que escriben por cookie (`/v1/*` vía `_comun.ts:242`,
los 5 de `/api/admin/*`, los 5 de `/api/dashboard/*`).

**El gate de área de `/v1`.** `_comun.ts:188-290` es una sola puerta con dos
formas de identificarse, y la llave manda sobre la cookie (`:206`) para que el
área acotada de la llave no la desborde el rol de la persona. Límite por IP
antes de identificar (`:190`), por flota después (`:218` y `:272`),
`areaDeLlaveAlcanza` (`:179-183`) y `puedeVerArea` (`:276`) aplicando el mismo
orden. Falla cerrado con cuerpo, nunca con un 200 vacío (`:265-271`).

**`env.ts` no tiene un solo fallback de privilegio.** Los buscué con el patrón
`process.env.X_SECRET|TOKEN|KEY ?? process.env.Y`: el único que existe en todo
`src/` es el del PAC/SAT (SEG-32-M1, arriba). El de Supabase lo veta una prueba
dedicada (`src/lib/env_no_fallback_privilegios.test.ts`). Y `MARCADOR`
(`env.ts:50`) rechaza `[SENSITIVE]`/`changeme`/`tu-…` por CONTENIDO, no por
presencia.

**TTL de URLs firmadas.** Los cuatro valores del árbol: 60 s
(`export/pdf/[id]/route.ts:125`, `qa-storage.ts:435`/`:466`), 300 s
(`oficina_wa.ts:163`), 900 s (`processor.ts:1307`, el PDF que va por WhatsApp) y
3600 s (`admin/bus.ts:99`, la media de la consola de Javier). Ninguno es más
largo que su necesidad: el de 900 s es el que le da al chofer tiempo de abrir el
documento en su teléfono, y el de 3600 s es media de una consola que solo abre
el superadmin. No hay aquí un hallazgo.

**El desalojo del límite de tasa por inundación de llaves** y **la falta de
límite por CORREO en el login**: los dos siguen descartados por las razones
escritas en `docs/auditoria-31/seguridad-continuacion-2.md`, y ninguno de los
dos archivos cambió en la ventana.

---

## Lo que revisé y está bien

- **Las 336 migraciones aplican limpias sobre base virgen.** Corridas una por
  una con `ON_ERROR_STOP=1` (más el preflight de índices de `0332`), con el
  andamio de CI y otra vez con el andamio fiel. **336 / 336** en las dos.
- **La batería completa contra Postgres real:** `243 bloques · 239 ok · 0
  fallos · 4 reportes` con el andamio de CI. Los 2 fallos con el andamio fiel
  son SEG-32-A1 y nada más.
- **`supabase/migrations/0357`, `0358`, `0359`** (el encargo especial de esta
  ronda): `SECURITY INVOKER` correcto, `search_path` fijado en las tres, ACL
  intacta tras el `create or replace`. Medido en `pg_proc`, no leído del
  comentario. El único pero es de higiene y está en SEG-31-B3.
- **`revisar_liquidacion`** (`0353:19-23`), la única `SECURITY DEFINER` del
  camino del dinero que tocaron las migraciones recientes:
  `search_path TO 'public','pg_catalog','pg_temp'` con `pg_temp` **al final**,
  que es la disposición segura que recomienda PostgreSQL para DEFINER, y
  `proacl = {postgres, service_role}` — medido. `0306:78` hace el
  `drop function` de la firma vieja **antes** del create, y `0306:297-298`
  repone el `revoke … from public, anon, authenticated` que el drop se llevó;
  `0353` ya no lo necesita porque no dropea.
- **La suite del rubro:** `npx vitest run src/lib/auth src/proxy.test.ts
  src/lib/ratelimit.test.ts src/lib/mcp src/app/api/webhook src/lib/env.test.ts`
  → **43 archivos, 702 pruebas, verde**, 7.42 s.
- **`puertaCron` va primero** en el cron que cambió en la ventana:
  `src/app/api/cron/asistencia/route.ts:43`, primera sentencia del handler, antes
  del interruptor y antes de tocar la base. `4b84716` entró debajo de ella.

---

## Lo que NO alcancé a revisar

- **Que Supabase gestionado aplique HOY el `alter default privileges … on
  functions`.** SEG-32-A1 se apoya en dos cosas: el comentario de `0013:50-53`
  («se verificó en la DB») y la medición de `0315:18-20` («confirmado en rojo
  contra Postgres real»). **Yo no tengo credenciales contra el proyecto real**,
  así que lo que medí es la consecuencia (2 bloques rojos), no la causa. Se
  cierra con un `select has_function_privilege('anon',
  'public.try_lock_viaje(uuid,integer,uuid)','execute');` contra la base de
  producción. Si diera `false`, SEG-32-A1 se cae entero y hay que borrarlo.
- **El borde de Vercel con `x-forwarded-for`.** `ratelimit.ts:310-313` sigue
  tomando el PRIMER elemento y `login/page.tsx:80` tiene su propia copia. Si el
  borde APPEND-ea en vez de sobrescribir, todo límite por IP se evade rotando la
  cabecera. **Abierto sin verificar desde la 25, octava ronda.** Se cierra con
  `curl -H 'x-forwarded-for: 1.2.3.4' https://app.likida.ai/api/health`.
- **Qué checks exige de verdad la protección de `master`.** Sé que
  `protected: true`; no sé si exige `Migraciones + aislamiento (Postgres
  efímero)`, que es el job que corre la batería. Necesita cuenta admin.
- **Si el render de PÁGINA de Next 16.3.4 emite `no-store` por su cuenta.** Es
  la mitad no verificada de SEG-31-M2 y afecta a `/cuenta`, `/mcp/autorizar`,
  `/login` y `/pago/[token]`.
- **El comportamiento REAL del caché de Vercel sobre las 13 rutas de
  SEG-31-M3.** Igual que en la 30, la 31 y ahora la 32.
- **La concurrencia real de dos corridas de QA en la MISMA instancia de
  Vercel.** SEG-31-A1 está verificado sobre el mecanismo del módulo, no sobre
  el modelo de reutilización de instancias de Vercel.
- **`NEXT_PUBLIC_*` marcadas Sensitive en Vercel.** Abierto desde la 28; se
  resuelve con un `vercel env ls`.
- **CodeQL.** No corre en este contenedor (sin GHAS ni red al servicio).
