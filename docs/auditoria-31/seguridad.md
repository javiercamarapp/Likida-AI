# Seguridad — auditoría 31

**Nota: 5/10** (antes 6). Razón del movimiento: **mirada más profunda — el
código no cambió y la nota anterior estaba inflada en dos afirmaciones que hoy
medí y salieron más angostas de lo que decían.**

La ventana no trajo una sola línea de `src/` ni de `supabase/` (verificado:
`git diff 5ce91b2..HEAD --name-only` → `normas/.latido-cuota-diesel` y
`normas/.latido-vigilancia`, nada más). Así que **ningún hallazgo abierto pudo
cerrarse**, y confirmo los **siete** de la 30 intactos línea por línea. Eso solo
sostiene la nota; no la mueve. Lo que la mueve son dos cosas que la 30 no midió:

1. **«El proxy es la primera capa» es verdad para tres prefijos, y hay dos
   páginas autenticadas que viven fuera de los tres.** La 30 contó las **47**
   páginas de `/dashboard` y concluyó que el ancla estructural («una sola capa»)
   era exclusiva de las 72 rutas de `/api`. Conté hoy las páginas que NO están
   bajo `/dashboard`, `/admin` ni `/vendedor`: son **15**, y **dos de ellas
   exigen sesión** (`/cuenta`, `/mcp/autorizar`). El matcher de `proxy.ts:132`
   no las toca, así que su única puerta es la que escriben adentro — y la prueba
   que existe justamente para que esa lista no se quede atrás
   (`proxy.test.ts:84`) la **fija** en tres. Ver SEG-31-M2.
2. **El veredicto de migraciones limpias estaba acotado a la ventana.** La 30
   revisó las 9 migraciones nuevas una por una y salieron limpias — lo
   reverifiqué y es cierto. Pero la misma propiedad, contada **sobre las 333**,
   deja **3 funciones vivas** cuyo `revoke … from public` no alcanza el grant
   implícito que Supabase le pone a `anon`/`authenticated`, y las **tres** redes
   que vigilan eso miran al lado. Ver SEG-31-M1.

Lo que sí levanta, y lo digo con el mismo peso: **no existe el caso de «4 o
menos»**. Lo busqué por seis superficies (abajo, con cifras): **156/156** tablas
con RLS encendida, **1/1** vista con `security_invoker`, **7/7** buckets de
Storage privados salvo `avatares` (público a propósito y acotado por
`auth.uid()`), **8/8** rutas de `/v1` con `abrir(req, area)` y área explícita,
**3/3** puertas de `/api/admin/*` con el veredicto MFA, y `npm audit` otra vez
**0 sobre 751**. La suite de mi rubro: **43 archivos, 698 pruebas, verde.**

**Riesgo mayor del rubro, hoy:** el mismo de hace dos rondas y sin una línea
encima — dos corridas de QA solapadas en la misma instancia tibia se apagan el
interceptor de salida a Meta la una a la otra, y la que sigue viva manda sus
WhatsApp de verdad a `graph.facebook.com` con el token real. Tercera ronda
abierto.

---

## Estado de los hallazgos abiertos de la 30

Verificados hoy uno por uno, con `archivo:línea` reabierto. El árbol es
idéntico al que la 30 calificó, así que el dictamen era previsible — lo que NO
era previsible es que alguno hubiera estado mal reportado, y ninguno lo estaba.

| # de la 30 | Sev. | Dictamen | Nuevo id |
|---|---|---|---|
| A1 · interceptor de Meta LIFO | ALTO | **REINCIDENTE, 3ª ronda.** `qa-motor.ts:190` (`const original = globalThis.fetch`), `:227` (`return () => { globalThis.fetch = original; }`), instalado en `:629`/`:1038`, restaurado en `:909`/`:1605`. Sin candado de corrida viva. | SEG-31-A1 |
| M1 · 13 salidas 200 sin `no-store` | MEDIO | **REINCIDENTE, 2ª ronda.** Las 12 que pude recontar dan **0** ocurrencias de `Cache-Control` cada una; `next.config.ts:246-275` sigue publicando CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy y HSTS sobre `/api/:path*` — y **ninguna** `Cache-Control`. | SEG-31-M3 |
| M2 · `enterWith` vs `run` | MEDIO | **REINCIDENTE, 3ª ronda.** `qa-motor.ts:627` y `:1036` siguen siendo `contextoQa.enterWith({…})`; cero `contextoQa.run` en producción. | SEG-31-M4 |
| B1 · `capturarBitacora` LIFO | BAJO | **REINCIDENTE, 3ª ronda.** `qa-motor.ts:150-166`; `:152` captura, `:162-164` repone, sin comprobar que el `logger` actual siga siendo el suyo. | SEG-31-B1 |
| B2 · preflight de póliza sin `no-store` | BAJO | **REINCIDENTE, 2ª ronda.** `export/poliza/route.ts:410-422` devuelve 200 sin cabecera; `:442` y `:466` sí la llevan. | SEG-31-B2 |
| B3 · `SECURITY INVOKER` implícito en `ejecutar_arco_cancelacion` | BAJO | **REINCIDENTE, 2ª ronda.** `0353:231-233` y `0356:21-24`: `LANGUAGE plpgsql` + `SET search_path` y ninguna cláusula de seguridad. | SEG-31-B3 |
| B4 · la prueba de `/dashboard/suscripcion` | BAJO | **REINCIDENTE, 2ª ronda.** `suscripcion/page.test.tsx:36` y `:102` intactos. | SEG-31-B4 |

---

## Hallazgos

### SEG-31-C0 — no hay CRÍTICO, y lo digo con el barrido que lo descarta

No hay un camino sin autenticar a datos de un tenant. Las seis superficies que
abrí hoy, con la cifra de cada una, están en «Lo que revisé y está bien». La que
más me costó descartar fue el portal público de pago (`/pago/<token>`, que corre
sobre `supabaseAdmin()` y por tanto bypassa RLS): toda consulta de
`portal_pago_lectura.ts` va anclada al `factura_id` y al `tenant_id` de la liga
YA resuelta, el segundo segmento de la ruta (`/complemento/<uuid>`) no es llave
de alcance, y el token se compara en tiempo constante recorriendo todas las
candidatas del prefijo (`portal_pago_lectura.ts:56-64`, `:130-136`). No abre
nada.

---

### [MEDIO] SEG-31-M1 — `0280` crea tres funciones y las revoca solo `from public`: el grant implícito de Supabase a `anon`/`authenticated` sigue vivo, y las tres redes que lo vigilan miran al lado — NUEVO

`supabase/migrations/0280_mutex_viaje_con_dueno_y_orden_por_hora_del_mensaje.sql:90`,
`:91` y `:115` · contra `:158` del **mismo archivo** ·
`supabase/verificaciones.sql:857-858` (la premisa) y `:873-874` (la consulta que
lo probaría) · `supabase/pruebas-aislamiento/capa1_auditoria_estatica.sql:107` ·
`supabase/migrations/0234_agentes_ingenieria.sql:364`

**El mecanismo.** Supabase instala en su bootstrap
`alter default privileges in schema public grant all on functions to postgres,
anon, authenticated, service_role`. Una función nueva creada por `postgres`
nace entonces con **dos clases** de permiso: el `=X/postgres` de PUBLIC que pone
Postgres, y **grants EXPLÍCITOS** a `anon` y a `authenticated`.
`REVOKE … FROM PUBLIC` quita el primero y **no toca** los otros dos.

`0280:52-53` **DROPea** `try_lock_viaje(uuid,integer)` y `unlock_viaje(uuid)`
(cambian de firma para llevar el token del dueño) y `:57`/`:80`/`:102` crean
tres funciones **nuevas**. Las tres se revocan así:

```sql
90: revoke execute on function public.try_lock_viaje(uuid, integer, uuid) from public;
91: revoke execute on function public.unlock_viaje(uuid, uuid)            from public;
115: revoke execute on function public.wa_orden_evento(jsonb, timestamptz) from public;
158: revoke all on function public.listar_wa_pendientes(integer) from public, anon, authenticated;   ← el mismo archivo, 43 líneas después, bien
```

**Lo conté, y el contraste es el argumento.** Agrupé los 274 `revoke … on
function` de las 333 migraciones por su cláusula `FROM`: **271** nombran
`public, anon, authenticated`. Cruzando historial por firma exacta, las
funciones cuyo **último** revoke no nombra `anon` **y** `authenticated` son
diez, y siete son explicables: cinco son ayudantes de RLS
(`get_user_tenant_ids`, `is_superadmin`, `administra_flota`, `ve_finanzas`,
`ve_operacion` — TIENEN que ser ejecutables por `authenticated`, el motor de RLS
las llama con el rol de quien pregunta) y dos son las firmas viejas que `0280`
dropeó. **Quedan exactamente tres, y las tres son las de `0280`.** Y el repo ya
corrigió este mismo error una vez: `0031:83` reescribió el revoke de
`intake_delta` de `from public` (que traía de `0012:15`) a
`from public, anon, authenticated`.

**Escenario, con valores.**
`POST https://<proyecto>.supabase.co/rest/v1/rpc/wa_orden_evento` con
`apikey: <NEXT_PUBLIC_SUPABASE_ANON_KEY>` (la llave publicable, que cualquiera
lee del bundle) y cuerpo
`{"p_evento":{"timestampMs":"1"},"p_recibido_en":"2026-09-13T00:00:00Z"}`
→ **200** con `1`. La función es `immutable` y no toca tabla, así que no fuga
nada: **es la prueba de que la revocación no tomó.** El mismo camino contra
`try_lock_viaje`/`unlock_viaje` sí entra a la función y muere un renglón
adentro, en `insert into public.viaje_lock` / `delete from public.viaje_lock`,
con **42501** — pero por el grant de TABLA (`0158:562`,
`revoke all on table public.viaje_lock from anon, authenticated`) y la RLS de
`0158:561`, no por la revocación de la función. **El daño de hoy es cero y lo
escribo así.** Lo que está roto es la defensa: la próxima función que se escriba
copiando estas tres y que toque una tabla con grants menos estrictos nace
abierta a `anon`.

**Por qué nada de lo que ya hay lo atrapa — las tres redes, una por una.**

- `verificaciones.sql` bloque 16 **es exactamente esta prueba**: `:873-874`
  pregunta `has_function_privilege('anon','public.try_lock_viaje(uuid,integer,uuid)','execute')`
  y su gemela de `unlock_viaje(uuid,uuid)`, esperando `f`. **Y nunca se ha
  corrido con esas firmas.** El comentario de `:868-872` dice que las actualizó
  «porque el bloque dejaría de compilar contra la firma vieja», y la salida real
  registrada en la cabecera del archivo (`:22`, `anon-lock=f anon-unlock=f`) es
  del **31-jul-2026** — un mes antes de que `0280` existiera, o sea sobre dos
  funciones que hoy ya no están. La prueba se reescribió y se dejó sin correr.
  Peor: `:857-858` escribe la premisa al revés —«`revoke … from anon` NO basta y
  por eso se revoca de PUBLIC: las funciones se otorgan a PUBLIC por defecto, y
  `anon` hereda de ahí»—, que es la mitad del cuadro; y `wa_orden_evento` no
  está en el bloque ni con la firma nueva ni con ninguna.
- `capa1_auditoria_estatica.sql:107` filtra `and p.prosecdef`: solo mira
  funciones **SECURITY DEFINER**. Las tres de `0280` son INVOKER (`:57-64`,
  `:80-83`, `:102-106` declaran `language`/`set search_path` y ninguna cláusula
  de seguridad), así que son invisibles para ese bloque.
- `postura_seguridad()` (`0234:364`) tiene el mismo `where … and p.prosecdef`.
  El advisor consultable que el agente `seguridad` cita objeto por objeto
  tampoco las ve.

**Consecuencia.** Para el equipo que mantiene esto: hay tres funciones que el
repo cree cerradas a `anon`, un bloque de verificación que preguntaría
justamente eso y que lleva mes y medio sin correrse contra las firmas que
vigila, y dos auditores automáticos que por construcción no pueden encontrarlo.
La garantía está escrita en tres sitios y no existe en ninguno.

**Causa raíz probable:** el revoke se copió de `0012:13-14` —la versión de 2026
anterior a la corrección de `0031`— en vez de del patrón de las 271; y las tres
redes se escribieron para vigilar `SECURITY DEFINER`, que es la vía de escalada,
no la exposición de una función INVOKER a un rol que no debería poder llamarla.

**Cómo se cierra la duda que me queda:** `select has_function_privilege('anon',
'public.wa_orden_evento(jsonb,timestamptz)','execute');` contra la base real.
No hay base aquí; lo escribo como el paso de verificación, no como un supuesto
que me ahorré.

---

### [MEDIO] SEG-31-M2 — dos páginas autenticadas viven fuera del matcher del proxy: una sola capa, y la prueba que existe para que la lista no se quede atrás la fija en tres — NUEVO

`src/proxy.ts:123` (`RUTAS_CON_SESION = ['/dashboard','/admin','/vendedor']`),
`:132` (el `if` que la usa) y `:170` (el `no-store`, **dentro** de ese `if`) ·
`src/proxy.test.ts:84-86` · `src/app/cuenta/page.tsx:16` ·
`src/app/mcp/autorizar/page.tsx:144`

**Lo que la 30 midió y lo que faltaba.** La 30 escaneó las **47** páginas de
`/dashboard` y verificó que 46 tienen puerta propia. Correcto — y es la mitad
del mapa. Conté hoy los `page.tsx` que **no** están bajo ninguno de los tres
prefijos: son **15**. Trece son públicas de verdad (`/`, `/login`, `/blog`,
`/calculadora`, `/privacidad`, `/terminos`, `/seguridad`, `/demo`,
`/sin-acceso`, `/aviso/[tenant]`, `/aviso/prospectos`, `/pago/[token]`,
`/blog/[slug]`). **Dos exigen sesión:**

- `src/app/cuenta/page.tsx:16` — `await requireSessionTenant('/cuenta', sp)`.
  Pinta el **nombre de la flota** (leído con `supabaseAdmin()` en `:18-19`, que
  bypassa RLS) y el nombre/`userId` de la persona (`:35`, `:39`).
- `src/app/mcp/autorizar/page.tsx:144` — `await getSessionTenant()`. Es la
  pantalla que **emite el código de autorización OAuth** atado a
  (tenant, usuario, rol).

Ninguna tiene `layout.tsx` propio (`ls src/app/cuenta/` y `src/app/mcp/autorizar/`
devuelven solo `page.tsx`), y el layout raíz no importa nada de `auth/`. Así que
para las dos hay **una** capa, no dos. La cabecera de `guard.ts:1-23` dice
textualmente que «las dos tienen que fallar a la vez para que una página del
panel se sirva sin autorización»; para estas dos basta con que falle una.

**Escenario, con valores.** No es «hoy se puede entrar sin sesión» — hoy no se
puede, `requireSessionTenant` muerde. Es el escenario que el diseño de dos capas
existe para cubrir, y que aquí no está cubierto: alguien reordena
`cuenta/page.tsx` y mueve la lectura de `supabaseAdmin()` (`:18`) arriba de la
línea `:16`, o envuelve el `requireSessionTenant` en un `try/catch` para que la
página no reviente cuando `tenant` no se pueda leer — dos ediciones de una línea
que en `/dashboard` serían inofensivas porque el proxy ya rebotó a `/login`
antes de que el componente corra. En `/cuenta` no hay nadie antes.
`GET https://app.likida.ai/cuenta` sin cookie devolvería 200 con
`<dd>Transportes Innovativos</dd>`. Y **ninguna prueba se pondría roja**: la
única que vigila esta frontera es `proxy.test.ts:84-86`, que afirma
`expect([...RUTAS_CON_SESION].sort()).toEqual(['/admin','/dashboard','/vendedor'].sort())`
— o sea que **agregar `/cuenta` a la lista haría fallar la suite**. El
comentario de `:79-83` plantea el hueco en futuro («si mañana nace `/taller` o
`/cliente` con su `requireX` en el layout, esta prueba no lo va a atrapar
sola»); el mañana ya pasó dos veces.

**Y hay un segundo efecto en el mismo `if`.** `proxy.ts:170`
(`res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')`) vive
**dentro** del bloque de `RUTAS_CON_SESION`. `/cuenta` es la misma URL para
todos los usuarios de todas las flotas —sin query string que la distinga, a
diferencia de `/api/v1/liquidaciones?limite=50` de SEG-31-M3— y lo único que
cambia la respuesta es la cookie, de la que no hay `Vary`. Es la clase exacta de
SEG-31-M3 con la colisión garantizada en vez de condicional. **Lo dejo como
observación y no como el hallazgo**, porque no pude medir si el camino de
render de una *página* de Next 16.3.4 emite por su cuenta
`private, no-cache, no-store, max-age=0, must-revalidate`
(`node_modules/next/dist/server/lib/cache-control.js:15`, que se aplica cuando
hay metadatos de `cacheControl` con `revalidate: 0`): lo que la 30 verificó en
el `dist` fue el camino de **route handler**, y no es el mismo. Sin build ni
servidor aquí, afirmarlo sería inventar.

**Consecuencia.** Para el equipo: la frase «el proxy es la primera capa» es
cierta para el 76 % de las páginas del producto (47 de 62) y falsa para las dos
que más caro salen — la que nombra la flota y la que firma un acceso OAuth. Y la
red que debía avisar cuando eso pasara está escrita como una igualdad exacta
contra tres literales, así que el modo de falla no es «la prueba no lo atrapa»,
es «la prueba castiga al que lo arregle».

**Causa raíz probable:** `RUTAS_CON_SESION` se pensó como «las secciones del
producto» (tres paneles) y no como «las rutas con puerta propia»; `/cuenta` y
`/mcp/autorizar` son páginas sueltas, no secciones, y por eso cayeron fuera de
la categoría con la que se escribió la lista y su prueba.

---

### [ALTO] SEG-31-A1 — dos corridas de QA solapadas se desinstalan el interceptor de salida a Meta la una a la otra — REINCIDENTE, 3ª ronda, cero commits encima

`src/lib/admin/qa-motor.ts:190` y `:227` · instalado en `:629` y `:1038` ·
restaurado en `:909` y `:1605` · `src/app/api/admin/qa/lanzar/route.ts` y
`src/app/api/admin/qa/[id]/continuar/route.ts` (ninguna con candado de corrida
viva)

Releído hoy, línea por línea. `instalarInterceptorSalidaMeta` sigue capturando
`const original = globalThis.fetch` (`:190`) y devolviendo
`() => { globalThis.fetch = original; }` (`:227`) **sin comprobar que el
`globalThis.fetch` actual siga siendo el suyo**, y sigue sin existir candado
alguno que impida dos corridas vivas en la misma instancia.

**Escenario, con los valores de hoy.** `t=0`: se lanza la corrida A (carril
`rapido`, techo `TECHO_CORRIDA_MS = 110_000`); `:629` instala **interceptorA**
con `originalA = realFetch`. `t=5 s`: «Continuar» sobre la corrida B (carril
`completo`, `maxDuration = 300`); `:1038` instala **interceptorB** con
`originalB = interceptorA`. `t=110 s`: A termina y su `finally` (`:909`) hace
`globalThis.fetch = originalA = realFetch` — **el interceptor de B queda
desinstalado con B viva otros ~190 s**. `t=110…300 s`: cada respuesta de B sale
por `fetch` sin interceptar:
`POST https://graph.facebook.com/v21.0/<WHATSAPP_PHONE_NUMBER_ID>/messages` con
el `WHATSAPP_ACCESS_TOKEN` real y `to: "5215559900001"`, y **cero** filas nuevas
en `wa_outbox` con `estado='dead'` y `ultimo_error LIKE 'QA:%'`. `t≈300 s`: B
repone `originalB = interceptorA` y la instancia queda vestida con el
interceptor de una corrida muerta, para siempre.

**Consecuencia.** Hoy, con la WABA en modo prueba, la corrida B queda **sin
evidencia**: los oráculos leen `wa_outbox` buscando filas `QA:` que nunca se
escribieron y juzgan una corrida que gastó dinero de modelo contra una base
incompleta, sin que nada avise. El día que la WABA pase a producción —el día del
piloto— el mismo par de clics manda WhatsApp reales. Es exactamente el desastre
que la cabecera de `:177-186` declara como su razón de existir.

**Causa raíz probable:** la contención es estado global mutable del proceso con
restauración LIFO por captura; el guardia de `AsyncLocalStorage` (`:195`)
resolvió *quién* se intercepta, nunca *cuántos parches* pueden estar apilados
sobre `globalThis` a la vez.

---

### [MEDIO] SEG-31-M3 — 13 salidas 200 con datos de un tenant, autenticadas por cookie, siguen sin `no-store` — REINCIDENTE, 2ª ronda

`src/app/api/v1/liquidaciones/route.ts`, `v1/viajes/route.ts`,
`v1/viajes/[id]/route.ts`, `v1/viajes/[id]/contribucion/route.ts`,
`v1/clientes/route.ts`, `v1/operadores/route.ts`, `v1/unidades/route.ts`,
`api/dashboard/conversaciones/route.ts` y `[id]/route.ts`,
`api/admin/copiloto/conversaciones/route.ts` y `[id]/route.ts`,
`api/admin/qa/[id]/estado/route.ts` · `src/proxy.ts:177` (el matcher que excluye
`api`) · `next.config.ts:246-275`

Recontado hoy: `grep -c 'no-store\|Cache-Control'` devuelve **0** en cada uno de
los doce archivos que pude enumerar. `next.config.ts` sigue publicando sobre
`/api/:path*` exactamente cinco cabeceras —CSP, X-Frame-Options, nosniff,
Referrer-Policy, Permissions-Policy— más HSTS en producción, y **ninguna**
`Cache-Control`. El sitio que gobierna a todas sigue sin la marca.

El escenario con valores está escrito entero en `docs/auditoria-30/seguridad.md`
(SEG-30-M1) y lo suscribo sin cambios, incluida la mitad que la 30 se refutó a
sí misma: por el camino de la **llave** (`Authorization: Bearer lk_live_…`) no
aplica, RFC 9111 §3.5. Vive por el camino de la **cookie**, que
`v1/_comun.ts:29-36` declara soportado, y que para `dashboard/conversaciones` y
`admin/copiloto/*` es el único que hay.

**Consecuencia.** La transcripción de WhatsApp de una flota, o su lista de
liquidaciones con importes, servida dentro de la sesión de otra.

---

### [MEDIO] SEG-31-M4 — el aislamiento de la corrida entra con `enterWith` y las ocho pruebas que lo certifican usan `run` — REINCIDENTE, 3ª ronda

`src/lib/admin/qa-motor.ts:627` y `:1036` (`contextoQa.enterWith({ corridaId })`)
· `:193` (el comentario que dice `contextoQa.run`) ·
`src/lib/admin/qa-motor.test.ts:804`, `:863`, `:870`, `:886`, `:907`, `:920`,
`:935`, `:952` (todas `contextoQa.run(...)`)

Verificado hoy: producción sigue sin llamar `contextoQa.run` ni una vez.
`run(store, fn)` abre y cierra el contexto; `enterWith` no se puede cerrar —
persiste hasta el final de la cadena async, más allá del `finally` que restaura
los parches (`:907-910`, `:1603-1606`)— y se propaga a hermanos esperados desde
el mismo `Promise.all`. El escenario está en SEG-30-M2 y sigue siendo cierto
palabra por palabra: el repo cree tener una garantía verificada y tiene un
guardia verificado (`:195`) más un mecanismo de entrada que ninguna prueba toca.

---

### [BAJO] SEG-31-B1 — la captura de bitácora tiene el mismo defecto LIFO y le corta la evidencia a la corrida que sigue viva — REINCIDENTE, 3ª ronda

`src/lib/admin/qa-motor.ts:150-166` (`:152` captura `originales`, `:162-164` los
repone) · instalada en `:628` y `:1037`, restaurada en `:909` y `:1604`

Con las dos corridas solapadas de SEG-31-A1: en `t=110 s` A repone el logger
real y `bit.eventos` de B deja de recibir nada con B viva 190 s más; en
`t≈300 s` B repone `wrapperA` y el logger de módulo queda envuelto para siempre
por el wrapper de una corrida terminada. `corrida.memoria.eventos` de B se corta
a la mitad sin decirlo, que es la evidencia que se le enseña a los oráculos. No
afecta a ningún cliente — por eso es BAJO.

---

### [BAJO] SEG-31-B2 — el preflight de la póliza es la única salida 200 de `export/` sin `no-store` — REINCIDENTE, 2ª ronda

`src/app/api/export/poliza/route.ts:410-422` (`if (preflight) { return
NextResponse.json({ … }) }`), contra `:442` (contpaqi) y `:466` (sap_b1), que sí
la llevan — reverificado hoy leyendo las tres salidas.

`GET /api/export/poliza?formato=contpaqi&desde=2026-08-01&hasta=2026-08-31&preflight=1`
contesta 200 con `{ listo: true, polizas: 47, plantillaConfirmadaEn: "…" }` y sin
directivas: mismo mecanismo que SEG-31-M3. Ninguna pantalla llama al preflight
hoy, y `rutas_export.test.ts:195-200` afirma «la respuesta exitosa nunca es
cacheable» sobre una lista (`:134-139`) en la que `poliza` no está.

---

### [BAJO] SEG-31-B3 — `0353` y `0356` dejan de declarar `SECURITY INVOKER` en `ejecutar_arco_cancelacion` — REINCIDENTE, 2ª ronda

`supabase/migrations/0353_revisar_liquidacion_arco_cuerpos_completos.sql:231-233`
y `supabase/migrations/0356_arco_borra_contacto_emergencia.sql:21-24`

Releídas hoy: las dos escriben `LANGUAGE plpgsql` + `SET search_path` y ninguna
cláusula de seguridad, contra las cinco definiciones anteriores (`0173`, `0262`,
`0264`, `0273`, `0286`) que escribían `security invoker` explícito. **No es
escalada** — el default es INVOKER y la función se comporta igual. Se perdió el
marcador, en la función que anonimiza RFC y licencia del operador y borra sus
conversaciones, 40 líneas debajo de un `revisar_liquidacion` con
`SECURITY DEFINER` (`0353:22`) del que es fácil copiar. Nota adicional de esta
ronda: la red que miraría eso —`capa1_auditoria_estatica.sql:107` y
`postura_seguridad()` (`0234:364`)— solo inspecciona funciones que **ya** son
DEFINER, así que el día que la copia ocurra el auditor la vería como una DEFINER
más, no como un cambio.

---

### [BAJO] SEG-31-B4 — la prueba de `/dashboard/suscripcion` afirma «renderiza para cualquier rol» después de doblar el único gate de vista — REINCIDENTE, 2ª ronda

`src/app/dashboard/suscripcion/page.test.tsx:36` y `:102`

El gate de vista de esa página vive en `tenant-efectivo.ts:171`
(`if (!puedeVerRuta(sesion.rol, destino)) redirect(...)`) con `visibilidad.ts`
clasificando la ruta como área `dinero`; la prueba sustituye esa función por una
que devuelve la sesión sin mirar la ruta y luego declara el resultado como el
diseño. Intacta.

---

## CVEs revisados y descartados por escrito

**No hay ninguno que descartar, porque no hay ninguno.** Corrí `npm audit` yo
mismo, las dos formas, sobre el `package-lock.json` de `claude/auditoria-31`:

```
npm audit --json            → {"info":0,"low":0,"moderate":0,"high":0,"critical":0,"total":0}
npm audit --omit=dev --json → {"info":0,"low":0,"moderate":0,"high":0,"critical":0,"total":0}
dependencias: 751 total (215 prod, 415 dev, 161 optional, 43 peer)
```

Mismas **751** que la 29 y la 30, mismo cero. `next` sigue en **16.3.4**
(`node_modules/next/package.json`). El egreso al registro funcionó. **No existe
en este árbol un CVE con o sin camino de explotación**, así que la sección de
descartarlos uno por uno no tiene sujeto. Lo digo por escrito, como la 30
descartó el bypass de middleware de Next, para que la ausencia conste medida y
no supuesta.

---

## Lo que revisé y está bien

Cada línea es un camino que abrí hoy y cerré, con la cifra que lo cierra.

**RLS, vistas y grants de tabla — el barrido completo, no el de la ventana.**
Parseé las 333 migraciones cruzando `create table` contra
`enable row level security`, incluyendo los cinco `do $$ … foreach t in array`
que encienden RLS en lote (`0001:110-112` para
`terminal/operador/politica_gasto/viaje/gasto/liquidacion/wa_conversacion`,
`0047:160-162` para `unidad/mantenimiento/incidencia/pod`). Resultado:
**156 tablas, 0 sin RLS.** Vistas en `public`: **una**, `factura_saldo`, y lleva
`with (security_invoker = true)` en su definición vigente (`0161:104`) más un
`alter view … set` de refuerzo (`:131`) — con la advertencia escrita de por qué
un `create or replace view` sin la cláusula resetea las reloptions (`0161:92-97`).

**Storage.** Siete buckets declarados: `liquidaciones` (`0008`), `comprobantes`
(`0039`), `bus` (`0127`), `agente-insumos` (`0267`), `marketing_hooks_video` y
`marketing_referencias` (`0266`) — **los seis privados y sin policy sobre
`storage.objects`**, o sea deniega-todo a `anon`/`authenticated` y solo firma el
service_role. El séptimo, `avatares` (`0046:17-19`), es **público a propósito** y
lo verifiqué: las tres policies de escritura anclan la carpeta a
`(storage.foldername(name))[1] = auth.uid()::text` (`:29`, `:35`, `:40`), y me
detuve en que `avatares_propio_update` (`:33-36`) trae `USING` y **no**
`WITH CHECK` — en Postgres, para `UPDATE`, la ausencia de `WITH CHECK` hace que
la expresión de `USING` valga también para la fila nueva, así que **no se puede
mover un archivo a la carpeta de otro**. Lo escribo porque parecía un hallazgo y
no lo es. Tipo y peso los hace cumplir el bucket (`0147:113-117` para avatares,
`0155:426-429` para comprobantes).

**Las URL firmadas y su TTL.** Todas las que existen están declaradas y acotadas
a la necesidad: **60 s** para el PDF de la liquidación
(`export/pdf/[id]/route.ts:125`, sobre un 302 que sí lleva `no-store` en `:177`)
y para la evidencia de QA (`qa-storage.ts:435`, `:466`); **300 s** para el
informe que se manda por WhatsApp (`oficina_wa.ts:163`); **3600 s** para las
previsualizaciones dentro del panel (`intake/almacen.ts:155`, `bus.ts:99`,
`insumos.ts:287`), cada una con el comentario que dice por qué una hora y por
qué el bucket es privado. No encontré ninguna firma cuyo TTL exceda la necesidad
que la motiva.

**Las 8 rutas de `/v1`, por la propiedad que de verdad importa.** `abrir(req,
area)` **no tiene default** para `area` a propósito (`_comun.ts:166-168`), y
verifiqué las **once** llamadas una por una contra la ruta que las hace:
`liquidaciones` y `clientes` y `viajes/[id]/contribucion` → `dinero`; `viajes`,
`viajes/[id]`, `operadores`, `unidades` → `operacion`; los tres `POST` de alta
→ `administracion`. Cero rutas sin gateo de área. Y la puerta borra el
`?tenant=` en el borde (`urlSinTenant`, `:146-154`) antes de dárselo a
`resolverTenantApi` — que sí lo honraría para un superadmin.

**MFA del superadmin en la superficie de API, que es donde la 25 lo encontró
abierto.** `sesionSuperadmin` (`api-superadmin.ts:36-45`) es hoy **un solo
archivo** reexportado por las tres puertas
(`api/admin/{copiloto,mapa-prospectos,qa}/puerta.ts`, once líneas cada una), y
`resolverTenantApi` (`tenant-api.ts:55-62`) —la puerta de `/api/export/*` y de
`/v1` por cookie— trae el mismo veredicto con el mismo fail-cerrado ante
`no_verificable`. Las cuatro superficies que `mfa.ts:97` nombra como el radio de
daño del superadmin están cubiertas.

**El `?tenant=` de superadmin, sus catorce llamadores.** `resolverTenantPedido`
(`tenant-api.ts:104-118`) **no comprueba el rol por dentro** — es la función que
podría ser un IDOR si alguien la llamara sin gatear. Abrí sus **doce** llamadas
de producción (`dashboard/[id]/page.tsx:85`, `:120`, `:154`, `:188`, `:237`,
`:285`; `politicas:97`; `combustible-casetas:72`; `suscripcion:45`;
`arco:78`, `:109`, `:142`) y **las doce** están dentro de un
`if (rol === 'superadmin' && …)`. Cero excepciones. Nota fina que sí comprobé:
`dashboard/[id]/page.tsx:84` usa `rolReal`, no el `rol` efectivo que devuelve
`rolEfectivo(rolReal, sp.rol)` — que es lo correcto, porque `?rol=` es
previsualización y no debe abrir el `?tenant=`.

**`rolEfectivo` solo puede estrechar.** `visibilidad.ts:335-339`: un rol distinto
de superadmin devuelve su propio rol antes de mirar `?rol=`, y
`PREVISUALIZABLES` (`:317`) es `{flota_admin, encargado, contador}` — no
contiene `superadmin` ni `vendedor`. No hay escalada por query string.

**Las dos verificaciones de firma HMAC.** WhatsApp: `meta/client.ts:87-94`,
`timingSafeEqual` con comparación de largo previa, sobre el cuerpo **crudo**
leído con contador (`webhook/whatsapp/route.ts:27-44`) y con el tope de 256 KB
aplicado **antes** del HMAC (`:137-140`). Cal.com: `calcom.ts:78-84`, mismo
patrón más un `/^[a-f0-9]{64}$/` que evita que `Buffer.from(hex)` acorte el
buffer; el secreto pasa por `secretoEntornoSeguro` (≥32 caracteres y ≥10
distintos, `env.ts:62-66`) y sin él la ruta contesta **503, no 200**
(`calcom_webhook.ts:137-139`). Resend: `correo/eventos/route.ts:37-50`, svix
verificado a mano con tolerancia de ±300 s contra replay y lectura acotada a
64 KB **antes** de la firma. La ruta plural `/api/webhooks/calcom` es un
re-export del mismo handler y redeclara `runtime`/`dynamic` literalmente, que es
lo que Next exige.

**La puerta de los crons.** `auth/cron.ts:41-47`: los dos lados pasan por SHA-256
antes del `timingSafeEqual` —dos digests siempre miden 32 bytes, así que el
largo del secreto deja de ser observable y la excepción de buffers desiguales no
puede ocurrir— y se compara la cabecera **completa**, no el secreto recortado.

**Límites de cuerpo y de tasa, por ruta pública.** Todas las que aceptan cuerpo
lo cortan **mientras leen**, no después: `leerTextoAcotado`/`cuerpoAcotado` en
`marketing/prospecto` (10 KB + 5/10 min + honeypot), `marketing/evento` (1 KB +
30/min + catálogo cerrado de páginas), `demo` (64 KB + 30/min), `lead` (8 KB +
10/min + 1 cada 10 s por llave natural), `client-error` (4 KB + 20/min),
`mcp/oauth/token` (8 KB + 30/min), `mcp/oauth/registro` (16 KB + 10/min),
`dashboard/archivo` y `dashboard/ingesta` (tope propio + tasa por **usuario** +
`vieneDeNuestroSitio`). `bodyExcede` se usa solo como preselección por
`content-length` y su propio comentario (`ratelimit.ts:322-330`) dice que no
basta.

**El motor OAuth del MCP, leído entero.** Códigos y tokens guardados por
SHA-256 con CHECK en la 0260; PKCE **S256 obligatorio** y `plain` rechazado;
`redirect_uri` comparada exacta salvo el puerto de loopback (RFC 8252 §7.3,
`oauth.ts:106-124`); reuso de código y de refresco **tumban la familia entera**;
el marcado de «usado» va con la condición en la base (`is('usado_en', null)`) y
el perdedor de la carrera se niega; el 503 de un insert fallido **deshace** el
quemado del código solo si sigue siendo su propio sello. Y el camino caliente
(`validarAcceso`, `:519-605`) revalida `tipo`, `revocado_en`, `expira_en`,
`app_user.activo === false` **y** que `(tenant_id, rol)` del token sigan
cuadrando con `app_user` hoy — en la misma consulta, sin viaje extra. El registro
dinámico de clientes es abierto por diseño (RFC 7591) y la pantalla de
consentimiento lo dice en pantalla: «El nombre «X» lo declaró quien se registró,
no Likida».

**El open redirect, por sus dos puertas.** `auth/callback/route.ts:21-22` y
`login/page.tsx:107-109` usan la **misma** allowlist de prefijos de ruta propios
(`/dashboard`, `/mcp/autorizar`), nunca URLs completas, y el destino se
construye con `new URL(dest, req.url)`. Probé mentalmente `//evil.com/dashboard`
(no empieza con `/dashboard`), `/dashboard@evil.com` y `/dashboard\@evil.com`
(siguen siendo rutas del mismo origen bajo WHATWG). No hay salida.

**CSRF con capa propia.** `auth/csrf.ts` no descansa en `SameSite=Lax`: prefiere
`Sec-Fetch-Site` (cabecera prohibida para JS, no falsificable desde una página
atacante), cae a `Origin` contra el host propio, y deja pasar solo cuando no hay
ninguna de las dos —que es un `curl`, no un navegador—, con el razonamiento
escrito. Se aplica a toda escritura por cookie de `/v1` (`_comun.ts:232-241`) y
a las dos rutas de subida del panel.

**Ningún secreto con fallback derivado de otro, salvo el conocido.** Rebarrí el
patrón `process.env.X || process.env.Y` en todo `src/`: siete coincidencias, y
**seis** son `VERCEL_ENV`/`NODE_ENV` (entorno, no secreto). La única real sigue
siendo `sat_descarga/index.ts:132`
(`LIKIDA_SAT_PASSWORD || LIKIDA_PAC_PASSWORD`), acotada por
`hostSwSinVerificar` (`:69-78`), que ante contraseña heredada exige que
`LIKIDA_SAT_URL` apunte a `api.sw.com.mx` y falla cerrado ante una URL ilegible.
Y ningún secreto con default literal: los tres `?? ''` que existen
(`meta/client.ts:79`, `sat_descarga:71`, `pac/index.ts:44`) son centinelas de
ausencia que hacen fallar cerrado, no valores de repuesto. `env.ts` rechaza por
**contenido** además de por presencia (`MARCADOR`, `:50`), que es lo que cerró el
incidente de `[SENSITIVE]` del 20-ago.

**La suite del rubro.** `npx vitest run src/lib/auth src/proxy.test.ts
src/lib/ratelimit.test.ts src/lib/mcp src/app/api/webhook src/lib/worker` →
**43 archivos, 698 pruebas, verde**, 13.67 s.

---

## Lo que NO alcancé a revisar

- **La prueba definitiva de SEG-31-M1.** Mi veredicto es **estático**: leí los
  `revoke`, conté las 274 cláusulas y crucé el historial por firma, pero no
  ejecuté `has_function_privilege('anon','public.wa_orden_evento(jsonb,timestamptz)','execute')`
  contra la base. No hay base aquí. Un solo `select` en el editor SQL de Supabase
  convierte este MEDIO en confirmado o en descartado, y correr el bloque **16**
  de `verificaciones.sql` entero lo hace para dos de las tres funciones.
- **Si el camino de render de página de Next 16.3.4 emite `no-store` por su
  cuenta.** Es la mitad no verificada de SEG-31-M2 y afecta también a
  `/mcp/autorizar`, `/login` y `/pago/[token]`. La 30 midió el camino de **route
  handler** en el `dist`; el de página pasa por
  `base-server.js:1088-1120` y depende de que el payload traiga metadatos de
  `cacheControl`, que no pude resolver leyendo. Se cierra con un
  `curl -i https://app.likida.ai/cuenta` con cookie válida.
- **`supabase/verificaciones.sql` no se ejecutó** (no hay base). El bloque **16**
  —permisos de `anon` sobre las RPC— sigue con su última salida real del
  **31-jul-2026**, hoy dos rondas más vieja y, como documenta SEG-31-M1,
  **anterior a las firmas que el propio bloque vigila**. El bloque 18 (barrido de
  producción, `tablas-sin-rls`/`rpc-abiertas-a-anon`) tampoco.
- **El borde de Vercel con `x-forwarded-for`.** `ratelimit.ts:313-316` sigue
  tomando el PRIMER elemento. Si el borde APPEND-ea en vez de sobrescribir, todo
  límite por IP (login, `/api/lead`, `/api/demo`, `mcp/oauth/*`, `export-pdf`) se
  evade rotando la cabecera. **Abierto sin verificar desde la 25, sexta ronda.**
  Se cierra con un `curl -H 'x-forwarded-for: 1.2.3.4'` contra `/api/health` en
  producción mirando qué llave se cuenta.
- **El comportamiento REAL del caché de Vercel sobre las 13 rutas de
  SEG-31-M3.** Mismo estado que en la 30: el escenario está construido sobre la
  semántica HTTP y sobre el código; lo que falta es saber qué `Cache-Control`
  pone el borde cuando la función no pone ninguno.
- **`NEXT_PUBLIC_*` marcadas Sensitive en Vercel.** Abierto desde la 28. Se
  resuelve con un `vercel env ls`.
- **La concurrencia real de dos corridas de QA en la MISMA instancia de
  Vercel.** SEG-31-A1 está verificado sobre el mecanismo (restauración LIFO
  determinista), no sobre Vercel.
- **El pipeline de OCR y LLM como frontera de confianza** (`intake/`, `agents/`):
  lo miré solo desde el gateo de las rutas. La inyección de prompt es del auditor
  agéntico.
