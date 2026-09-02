-- ═══════════════════════════════════════════════════════════════════════════
-- 0234 — INGENIERÍA SE ENCIENDE: los ocho que quedaban en 'disenado' del
-- departamento que cuida la máquina por dentro.
--
--   migraciones · seguridad · rendimiento · pruebas · auditor_codigo ·
--   releases · producto · datos_instrumentacion
--
-- Los ocho existen en el catálogo desde la 0125 (blueprint escrito, cero
-- código). Hoy ganan motor (src/lib/likida/agentes/ingenieria.ts y
-- .../ingenieria_producto.ts) y esta migración hace las altas declarativas del
-- patrón 0215/0216/0218/0219/0230.
--
-- ── LA REGLA QUE GOBIERNA ESTA OLA ENTERA ─────────────────────────────────
--
-- ESTOS AGENTES CORREN EN UNA FUNCIÓN SERVERLESS DE VERCEL. No tienen el
-- repo, no pueden correr `tsc`, ni `vitest`, ni `git`, ni un linter, ni leer
-- un archivo .sql. Un agente de ingeniería que desde ahí dijera «revisé el
-- código» estaría mintiendo, y por eso los ocho motores miden EXCLUSIVAMENTE
-- lo que sí es visible desde el servidor:
--
--   · el catálogo de PostgreSQL (RLS, policies, grants, SECURITY DEFINER,
--     constraints, índices, tamaños, seq_scan) — la versión SQL de los
--     advisors de Supabase, con evidencia citable;
--   · `supabase_migrations.schema_migrations` — QUÉ migración se aplicó y
--     CUÁNDO (el `version` es el sello de tiempo UTC de la aplicación);
--   · `agente_corrida`, `cola_aprobacion`, `cron_latido`, `sitio_evento`,
--     `agente_definicion` — la conducta REAL de la compañía agente;
--   · `pg_stat_statements` cuando la extensión está (en el CI local no está,
--     y entonces el parte lo DICE en vez de callar);
--   · el SHA desplegado (`VERCEL_GIT_COMMIT_SHA`) contra el reloj de las
--     migraciones — la trampa «mergeado ≠ desplegado» que ya mordió aquí.
--
-- Y DECLARAN EN SU PROPIO CUERPO lo que NO alcanzan: la auditoría de código y
-- la suite de pruebas viven en la rutina local de la Mac de Javier
-- (`auditoria-diaria`, `scripts/mejora-diaria/auditor.mjs`, `npx vitest run`).
-- El parte de `pruebas` y el de `auditor_codigo` incluyen QUÉ habría que
-- correr allá y SOBRE QUÉ SHA — no fingen haberlo corrido.
--
-- ── LAS CUATRO PIEZAS DECLARATIVAS ────────────────────────────────────────
--
--   1. El flip en `agente_definicion`: 'vivo' + runner_habilitado + techo
--      declarado + disparador 'cron'. `releases` venía con disparador
--      'manual' desde la 0125 y pasa a 'cron': el runner solo despacha lo que
--      dispara por reloj (candado 2), y su motor ya sabe irse en silencio
--      cuando el periodo ya tiene parte.
--      `modelo_rol` dice la VERDAD del motor construido: NULL en los OCHO.
--      La 0125 les había puesto 'codigo'/'analisis'/'codigo_escritura'
--      pensando en agentes que leerían fuentes y escribirían diffs; el motor
--      que hoy existe es DETERMINISTA de punta a punta —consulta el catálogo
--      y redacta con plantilla fija— y no llama a ningún modelo. La
--      convención de la 0125 es NULL = no usa modelo de texto, y ponerle rol
--      a quien no lo gasta haría que /admin/consumo esperara un costo que
--      nunca llega.
--      El techo se declara en los ocho ($0.10, el mismo criterio de la
--      0219/0230) porque el candado 3 del runner lo exige, y porque el día
--      que alguno redacte con modelo el freno ya está puesto sin que nadie
--      tenga que acordarse.
--   2. El dominio del interruptor (0110) crece con los ocho kill switches.
--      Un agente autónomo sin palanca no corre — candado 1 del runner.
--   3. `cola_parte_ingenieria_por_periodo`: UN parte por (agente, periodo).
--      El título es determinista por semana y este índice único parcial es el
--      árbitro de la carrera entre dos pasadas del runner (estándar §7: la
--      idempotencia es un constraint, no un `if`).
--   4. `despliegue_visto` + cuatro funciones de lectura del catálogo, que son
--      el ÚNICO camino por el que el servidor puede ver lo que ve. Sin ellas,
--      `service_role` no alcanza `supabase_migrations` (comprobado: ni USAGE
--      sobre el esquema) ni el texto de `pg_stat_statements`.
--
-- LO QUE ESTA MIGRACIÓN NO HACE, A PROPÓSITO: no siembra un solo hallazgo, ni
-- una deuda, ni un pendiente de backlog. Un hallazgo sembrado desde una
-- migración es un hallazgo que nadie midió.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. El flip: vivos, con techo y con reloj ───────────────────────────────

-- Los ocho son deterministas: sin modelo, techo formal de $0.10 (el mismo
-- criterio de la 0219 y la 0230 — deterministas de punta a punta, pero el
-- candado 3 se declara igual).
update public.agente_definicion
set estado              = 'vivo',
    runner_habilitado   = true,
    disparador          = 'cron',
    presupuesto_dia_usd = 0.10,
    modelo_rol          = null,
    actualizado_en      = now()
where id in ('migraciones', 'seguridad', 'rendimiento', 'pruebas',
             'auditor_codigo', 'releases', 'producto', 'datos_instrumentacion');

-- Las descripciones del catálogo pasan de decir el DISEÑO a decir lo
-- CONSTRUIDO — que es justo el drift que el agente de documentación caza: un
-- flip de estado sin nota deja el catálogo contando lo de antes. Cada una
-- nombra también lo que el agente NO alcanza desde el servidor, porque un
-- catálogo que promete más de lo que el motor hace es la primera mentira.
update public.agente_definicion set
  descripcion = 'Compara las migraciones APLICADAS en la base (supabase_migrations.schema_migrations, cuyo `version` es el sello UTC de cuándo se aplicó) contra el contrato que este despliegue exige (0234). Caza: huecos de numeración, nombres repetidos, ORDEN DE APLICACIÓN ANÓMALO (el incidente 0218/0219 y 0231/0232), migraciones exigidas por el bundle que la base no tiene, agentes vivos ausentes del CHECK del interruptor, tablas con tenant_id sin RLS y FK de una sola columna entre tablas con tenant_id (el hueco que la auditoría 19 dejó sin verificación). NO lee un solo archivo .sql: desde Vercel no hay repo — solo los NOMBRES que la base registró.',
  actualizado_en = now()
where id = 'migraciones';

update public.agente_definicion set
  descripcion = 'La versión SQL de los advisors de Supabase, con evidencia citable (0234): tablas de public sin RLS, grants de lectura o escritura a anon/authenticated sobre tablas sin RLS, funciones SECURITY DEFINER ejecutables por anon o authenticated que ninguna policy usa como ayudante, SECURITY DEFINER sin search_path fijo, vistas sin security_invoker y columnas cuyo NOMBRE parece un secreto guardado en claro. Cada hallazgo cita el objeto exacto. Lo que NO hace desde el servidor: no lee el código, no audita dependencias ni busca secretos en el repo — eso es la rutina local, y el parte lo dice.',
  actualizado_en = now()
where id = 'seguridad';

update public.agente_definicion set
  descripcion = 'Mide el peso y el patrón de acceso REALES de la base (0234): tamaño por tabla y su CRECIMIENTO contra el censo que este mismo agente dejó la semana pasada, tablas con seq_scan dominante y volumen (índice faltante), consultas lentas de pg_stat_statements CUANDO la extensión está —y si no está lo dice en vez de callar—, y el costo de IA por corrida como proxy de eficiencia. Sin censo previo el parte es LÍNEA BASE y no inventa un delta. Lo que NO mide: tiempos de build, bundle ni Lighthouse — el runner corre en la función, no en el pipeline.',
  actualizado_en = now()
where id = 'rendimiento';

update public.agente_definicion set
  descripcion = 'Vigila los RESULTADOS que sí llegan a la base (0234): corridas en fallo por agente, PATRONES de error repetidos (firma normalizada del texto del error), verde vacío, agentes vivos sin una sola corrida y la racha de latidos del cron. Con eso arma el ENCARGO de la rutina local: qué correr en la Mac (npx tsc --noEmit, npx vitest run, --coverage, la batería SQL) y SOBRE QUÉ SHA. NO corre la suite: desde Vercel no hay repo ni vitest, y el parte lo declara en su propio cuerpo en vez de fingir una corrida verde.',
  actualizado_en = now()
where id = 'pruebas';

update public.agente_definicion set
  descripcion = 'Audita el ARTEFACTO DESPLEGADO contra la base (0234), que es la única auditoría de código honesta desde una función serverless: agentes que la base declara vivos y que el bundle NO sabe despachar (correrían a la nada), ramas de despacho del bundle que la base no tiene vivas, y el drift entre la lista INTERRUPTORES del código y el dominio del CHECK en la base — las tres formas del «mergeado no es desplegado» que ya mordieron aquí. NO lee las fuentes, no corre linters y no propone diffs: la auditoría de código vive en la rutina local (scripts/mejora-diaria/auditor.mjs, launchd 05:30) y el parte dice qué toca correr allá.',
  actualizado_en = now()
where id = 'auditor_codigo';

update public.agente_definicion set
  descripcion = 'Contesta qué está DESPLEGADO de verdad (0234): el SHA de VERCEL_GIT_COMMIT_SHA, desde cuándo lo ve este servidor (tabla despliegue_visto — es la primera VISTA del SHA, no la hora del deploy, y el parte lo aclara), qué migraciones se aplicaron DESPUÉS de esa marca (el esquema se movió y el código no) y qué migraciones exige el bundle que la base todavía no tiene (el código espera un esquema que no existe). Sin SHA —corriendo fuera de Vercel— lo dice y no inventa uno.',
  actualizado_en = now()
where id = 'releases';

update public.agente_definicion set
  descripcion = 'Traduce señal REAL en backlog priorizado (0234): lo que un humano RECHAZÓ en la bandeja y por qué, incidencias abiertas por tipo, agentes vivos que nadie usa (sin corridas o sin una sola pieza aprobada), y la bandeja que se acumula sin resolver. Cada punto del backlog cita la evidencia que lo pide. PROPONE, NO DECIDE: no cierra incidencias, no apaga agentes y no toca prioridades — deja la lista en la bandeja y quien decide es Javier.',
  actualizado_en = now()
where id = 'producto';

update public.agente_definicion set
  descripcion = 'Dice qué pregunta del negocio NO tiene dato hoy (0234): recorre un catálogo declarado de preguntas (embudo, activación, cohortes, retención, uso del producto), verifica CONTRA LA BASE si la fuente que la contestaría existe y tiene filas, y para cada hueco propone el EVENTO MÍNIMO a instrumentar — nombre, dónde se emite, campos y qué pregunta desbloquea. Hoy sitio_evento solo cubre el sitio público (pageview/conversion, sin nada del visitante) y el parte lo nombra tal cual. Propone la spec; no instrumenta nada.',
  actualizado_en = now()
where id = 'datos_instrumentacion';

-- ── 2. Los ocho kill switches (candado 1 del runner) ───────────────────────
-- La lista recrea el dominio COMPLETO a propósito (mismo razonamiento que la
-- 0215/0216/0217/0218/0219/0230 y la correctiva 0227): las migraciones corren
-- en orden numérico, así que la recreación más alta define el dominio final —
-- enumerar solo los míos borraría del CHECK las palancas de los agentes
-- anteriores. Un valor de más no enciende nada (SIN FILA = ENCENDIDO); uno de
-- menos rompe la palanca de otro agente en silencio, que es el fallo caro.
--
-- Los 41 primeros son la lista de la 0231 copiada TAL CUAL —la recreación más
-- alta que hay en master, porque ni la 0232 ni la 0233 tocaron el CHECK—:
-- global + 8 de flota/redactor + 4 financieros + 4 de dirección + 3 de
-- prospección + 6 de éxito + 4 de back office + 10 de crecimiento + la
-- descarga masiva del SAT. Los 8 de abajo son los de esta migración.
-- Total: 49.
alter table public.interruptor drop constraint interruptor_id_dominio;
alter table public.interruptor add constraint interruptor_id_dominio check (
  id in (
    'global',
    -- Los agentes de flota (0102/0105) y el Redactor (0122).
    'agente:liquidacion', 'agente:facturas', 'agente:cobranza',
    'agente:conductores', 'agente:peajes', 'agente:proveedores',
    'agente:ventas', 'agente:redactor',
    -- Los 4 financieros (0215).
    'agente:analista_metricas', 'agente:control_costos',
    'agente:tesoreria', 'agente:cierre_mensual',
    -- Los 4 de dirección (0216).
    'agente:kpi_whatsapp', 'agente:desempeno_startup',
    'agente:orquestador', 'agente:orquestador_semanal',
    -- La máquina de prospección (0217).
    'agente:enriquecedor', 'agente:sdr', 'agente:enviador',
    -- Los 6 de éxito del cliente (0218).
    'agente:soporte', 'agente:onboarding_cliente', 'agente:exito_cliente',
    'agente:atencion_faq', 'agente:cobranza_saas', 'agente:retencion',
    -- Los 4 del back office restante (0219).
    'agente:vigilante_calidad', 'agente:documentacion',
    'agente:legal_compliance', 'agente:talento',
    -- Los 10 de crecimiento (0230).
    'agente:contenido_fiscal', 'agente:lead_magnet', 'agente:seo_distribucion',
    'agente:guiones', 'agente:noticias_mercado', 'agente:promos_diarias',
    'agente:visuales', 'agente:video_demo', 'agente:video_marketing',
    'agente:alianzas',
    -- La descarga masiva del SAT (0231).
    'agente:descarga_sat',
    -- Los 8 de ingeniería (0234). Ninguno escribe fuera de la bandeja, y aun
    -- así llevan palanca: son los que MIRAN el catálogo entero de la base en
    -- cada pasada, y el día que una de esas consultas pese de más apagar al
    -- que la lanza tiene que ser un click, no un deploy.
    'agente:migraciones', 'agente:seguridad', 'agente:rendimiento',
    'agente:pruebas', 'agente:auditor_codigo', 'agente:releases',
    'agente:producto', 'agente:datos_instrumentacion'
  )
);

comment on constraint interruptor_id_dominio on public.interruptor is
  'El dominio COMPLETO de palancas (49 al 0234). Cada migración que enciende agentes lo RECREA enumerando todo el catálogo: la recreación más alta gana, y una que enumere solo los suyos borraría en silencio las palancas anteriores (el incidente que la 0227 corrigió). El espejo en código es INTERRUPTORES en src/lib/likida/interruptores.ts.';

-- ── 3. Un parte por periodo — el árbitro de la carrera ─────────────────────
create unique index if not exists cola_parte_ingenieria_por_periodo
  on public.cola_aprobacion (agente, titulo)
  where agente in ('migraciones', 'seguridad', 'rendimiento', 'pruebas',
                   'auditor_codigo', 'releases', 'producto', 'datos_instrumentacion');

comment on index public.cola_parte_ingenieria_por_periodo is
  'UN parte por (agente, periodo) para los 8 de ingeniería (0234): el título es determinista por semana y dos pasadas del runner que compitan por el mismo lo resuelve la base — gana exactamente una. Parcial a estos ocho: las piezas del Redactor titulan por asunto y pueden repetirse entre prospectos.';

-- ── 4a. El SHA que este servidor ha visto correr ───────────────────────────
--
-- Vercel expone `VERCEL_GIT_COMMIT_SHA` en la función, pero NO expone la hora
-- del despliegue. Sin un registro propio, «desde cuándo corre este código» no
-- se puede contestar — y esa pregunta es la mitad de la trampa «mergeado ≠
-- desplegado». Esta tabla la contesta con lo único honesto que hay: la
-- primera vez que una corrida del agente `releases` VIO este SHA. No es la
-- hora del deploy (puede haber pasado hasta un ciclo de cron entre una y
-- otra) y el parte lo dice con esas palabras.
create table if not exists public.despliegue_visto (
  sha            text primary key
                   constraint despliegue_visto_sha_forma check (sha ~ '^[0-9a-f]{7,40}$'),
  -- 'production' | 'preview' | 'development' | 'local' — lo que diga
  -- VERCEL_ENV, o 'local' cuando no hay ninguno. Dominio abierto a propósito:
  -- si Vercel inventa un entorno nuevo, prefiero registrarlo que rebotarlo.
  entorno        text not null
                   constraint despliegue_visto_entorno_no_vacio check (length(btrim(entorno)) > 0),
  -- NULL = la rama no consta (VERCEL_GIT_COMMIT_REF ausente). No se lee como
  -- 'master': afirmar una rama que nadie declaró sería inventar el origen del
  -- código que está corriendo.
  rama           text,
  primera_vista  timestamptz not null default now(),
  ultima_vista   timestamptz not null default now(),
  -- Cuántas corridas de `releases` han visto este SHA. Sirve para distinguir
  -- «acaba de desplegarse» de «lleva semanas» sin depender del reloj.
  vistas         bigint not null default 1
                   constraint despliegue_visto_vistas_positivas check (vistas > 0),
  constraint despliegue_visto_orden_del_reloj check (ultima_vista >= primera_vista)
);

comment on table public.despliegue_visto is
  'El registro de qué SHA ha visto correr este servidor (0234). Lo escribe SOLO el agente `releases`, una fila por SHA. `primera_vista` NO es la hora del despliegue —Vercel no la expone en la función— sino la primera corrida que vio ese SHA; el parte de releases lo declara con esas palabras. Sin tenant: es de la empresa. Deny-all.';
comment on column public.despliegue_visto.primera_vista is
  'La primera corrida que vio este SHA, NUNCA la hora del deploy. Entre el despliegue y la primera pasada del cron puede pasar un ciclo entero, y el parte compara migraciones contra esta marca diciendo exactamente eso.';
comment on column public.despliegue_visto.rama is
  'NULL = la rama no consta. No se rellena con «master»: el origen del código que corre no se adivina.';

alter table public.despliegue_visto enable row level security;
revoke all on table public.despliegue_visto from public, anon, authenticated;
grant select, insert, update on table public.despliegue_visto to service_role;

-- La consulta del parte: los despliegues más recientes primero.
create index if not exists despliegue_visto_reciente_idx
  on public.despliegue_visto (ultima_vista desc);

-- ── 4b. Las cuatro lecturas del catálogo ───────────────────────────────────
--
-- Son el ÚNICO camino por el que la función serverless puede ver lo que ve.
-- PostgREST no expone `pg_catalog` ni el esquema `supabase_migrations`, y
-- `service_role` no tiene ni USAGE sobre ese esquema (comprobado contra el
-- proyecto real el 27-ago-2026). Las cuatro:
--
--   · devuelven jsonb de una pieza (un viaje, no N) porque el llamador las
--     usa enteras y el runner tiene presupuesto de tiempo;
--   · están acotadas por dentro (`limit`) para que una base que crezca no
--     convierta un parte semanal en una respuesta de megabytes;
--   · degradan DICIENDO: si la fuente no existe (CI local sin
--     `supabase_migrations`, sin `pg_stat_statements`) devuelven
--     `disponible = false` con motivo, jamás una lista vacía que se lea como
--     «no hay nada»;
--   · están revocadas de public/anon/authenticated y solo `service_role` las
--     ejecuta. Dos son SECURITY DEFINER —las únicas que lo necesitan— y por
--     eso llevan `search_path` fijo; las otras dos son INVOKER porque
--     `pg_catalog` ya es legible por cualquier rol.

-- (1) Qué migraciones se aplicaron y CUÁNDO. `version` es el sello de tiempo
-- UTC 'YYYYMMDDHHMMSS' que puso quien la aplicó, y `name` es el basename del
-- archivo del repo ('0230_agentes_crecimiento'). Con esas dos columnas se
-- contesta el orden REAL de aplicación, que es distinto del orden numérico de
-- los archivos — y esa diferencia es el incidente 0218/0219.
--
-- SECURITY DEFINER: `service_role` no tiene USAGE sobre `supabase_migrations`.
create or replace function public.migraciones_aplicadas()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  filas jsonb;
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    return jsonb_build_object(
      'disponible', false,
      'motivo', 'supabase_migrations.schema_migrations no existe en esta base (pasa en el CI local, que aplica las migraciones con psql y sin el registro de Supabase). No se afirma nada sobre qué está aplicado.',
      'filas', jsonb_build_array());
  end if;
  -- `execute` porque la tabla puede no existir en tiempo de compilación del
  -- plan (el CI local ni siquiera tiene el esquema) y un plpgsql con la
  -- referencia estática fallaría al PARSEAR, no al ejecutar — el `if` de
  -- arriba nunca llegaría a protegerlo.
  execute $q$
    select coalesce(jsonb_agg(jsonb_build_object('version', version, 'nombre', name)
                              order by version desc), '[]'::jsonb)
      from (select version, name
              from supabase_migrations.schema_migrations
             order by version desc
             limit 2000) t
  $q$ into filas;
  return jsonb_build_object('disponible', true, 'motivo', null, 'filas', coalesce(filas, '[]'::jsonb));
end;
$$;

comment on function public.migraciones_aplicadas() is
  'Las migraciones REGISTRADAS como aplicadas (0234): `version` = sello UTC YYYYMMDDHHMMSS de cuándo se aplicó, `nombre` = basename del archivo del repo. El agente `migraciones` compara ese orden REAL contra el orden numérico de los nombres, que es donde vive el incidente 0218/0219. SECURITY DEFINER porque service_role no tiene USAGE sobre supabase_migrations. Devuelve disponible=false —jamás una lista vacía— cuando el esquema no existe.';
revoke all on function public.migraciones_aplicadas() from public, anon, authenticated;
grant execute on function public.migraciones_aplicadas() to service_role;

-- (2) La postura de seguridad del esquema, leída del catálogo. Es la versión
-- SQL de los advisors: no reemplaza a los de Supabase, los hace consultables
-- desde la función — que es lo que hacía falta para que el agente cite.
--
-- SECURITY INVOKER: pg_class, pg_policies, pg_proc y has_*_privilege son
-- legibles por cualquier rol. Una DEFINER aquí sería permiso de más.
create or replace function public.postura_seguridad()
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  with tablas as (
    select c.oid, c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
  ),
  t as (
    select
      tb.relname as tabla,
      (select relrowsecurity from pg_class where oid = tb.oid) as rls,
      (select count(*) from pg_policy p where p.polrelid = tb.oid) as politicas,
      exists (select 1 from pg_attribute a
               where a.attrelid = tb.oid and a.attname = 'tenant_id'
                 and a.attnum > 0 and not a.attisdropped) as tiene_tenant_id,
      has_table_privilege('anon', tb.oid, 'SELECT') as anon_lee,
      has_table_privilege('authenticated', tb.oid, 'SELECT') as auth_lee,
      (has_table_privilege('anon', tb.oid, 'INSERT')
        or has_table_privilege('anon', tb.oid, 'UPDATE')
        or has_table_privilege('anon', tb.oid, 'DELETE')) as anon_escribe,
      (has_table_privilege('authenticated', tb.oid, 'INSERT')
        or has_table_privilege('authenticated', tb.oid, 'UPDATE')
        or has_table_privilege('authenticated', tb.oid, 'DELETE')) as auth_escribe
    from tablas tb
  ),
  f as (
    select
      p.proname as funcion,
      p.prosecdef as definer,
      has_function_privilege('anon', p.oid, 'EXECUTE') as anon_ejecuta,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_ejecuta,
      -- `proconfig` trae los `SET` de la función; sin search_path fijo, una
      -- DEFINER resuelve nombres con el search_path de QUIEN la llama.
      exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) o
               where o like 'search_path=%') as search_path_fijo,
      -- Se exceptúa sola: si alguna policy la nombra, TIENE que poder correr
      -- bajo anon/authenticated — el motor de RLS la evalúa con el rol de
      -- quien pregunta (mismo criterio que capa1_auditoria_estatica.sql §B).
      exists (select 1 from pg_policies pol
               where pol.schemaname = 'public'
                 and (coalesce(pol.qual, '') like '%' || p.proname || '%'
                   or coalesce(pol.with_check, '') like '%' || p.proname || '%')) as ayudante_rls
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
  ),
  v as (
    select c.relname as vista,
           exists (select 1 from unnest(coalesce(c.reloptions, array[]::text[])) o
                    where o = 'security_invoker=true') as security_invoker
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'v'
  ),
  cols as (
    -- HEURÍSTICA DE NOMBRE, y el parte lo dice así: una columna que se llama
    -- `token` o `password` y guarda texto es sospechosa, no culpable. Lo que
    -- ESTO sí prueba es que nadie tuvo que acordarse de revisarla.
    select c.relname as tabla, a.attname as columna,
           format_type(a.atttypid, a.atttypmod) as tipo
      from pg_attribute a
      join tablas c on c.oid = a.attrelid
     where a.attnum > 0 and not a.attisdropped
       and a.attname ~ '(password|contrase|secret|secreto|token|api_key|apikey|llave_privada|private_key|credencial|cookie)'
       -- Por OID y no por `format_type`: un varchar(255) se imprime
       -- 'character varying(255)' y un `in (...)` de nombres lo dejaría
       -- fuera en silencio. 25=text 1043=varchar 3802=jsonb 114=json.
       and a.atttypid in (25, 1043, 3802, 114)
     limit 200
  )
  select jsonb_build_object(
    'tablas',   (select coalesce(jsonb_agg(to_jsonb(t) order by t.tabla), '[]'::jsonb) from t),
    'funciones',(select coalesce(jsonb_agg(to_jsonb(f) order by f.funcion), '[]'::jsonb) from f),
    'vistas',   (select coalesce(jsonb_agg(to_jsonb(v) order by v.vista), '[]'::jsonb) from v),
    'columnas_sensibles', (select coalesce(jsonb_agg(to_jsonb(cols) order by cols.tabla, cols.columna), '[]'::jsonb) from cols)
  );
$$;

comment on function public.postura_seguridad() is
  'La postura de seguridad del esquema public leída del catálogo (0234): RLS y policies por tabla, grants de lectura/escritura a anon/authenticated, funciones SECURITY DEFINER con su exposición y su search_path, vistas sin security_invoker y columnas cuyo NOMBRE parece un secreto. Es la versión consultable de los advisors — el agente `seguridad` la cita objeto por objeto. SECURITY INVOKER: el catálogo ya es legible por cualquier rol.';
revoke all on function public.postura_seguridad() from public, anon, authenticated;
grant execute on function public.postura_seguridad() to service_role;

-- (3) El peso y el patrón de acceso de la base. `pg_stat_statements` es la
-- única parte que puede faltar (extensión), y entonces se DICE.
--
-- SECURITY DEFINER solo por `pg_stat_statements`: para un rol sin
-- `pg_read_all_stats`, PG devuelve el texto de las consultas ajenas como
-- '<insufficient privilege>' — o sea, la lectura existiría pero no diría nada.
create or replace function public.perfil_almacenamiento(p_top int default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  tablas jsonb;
  consultas jsonb;
  hay_pgss boolean := to_regclass('extensions.pg_stat_statements') is not null;
  tope int := greatest(1, least(coalesce(p_top, 20), 50));
begin
  select coalesce(jsonb_agg(x order by x->>'tabla'), '[]'::jsonb) into tablas
    from (
      select jsonb_build_object(
               'tabla', c.relname,
               'bytes', pg_total_relation_size(c.oid),
               -- `reltuples` es un ESTIMADO del último analyze, y −1 en una
               -- tabla nunca analizada. Se pasa tal cual y el lector decide:
               -- convertirlo a 0 aquí sería exactamente el null≠0 que la casa
               -- prohíbe.
               'filas_estimadas', (select reltuples from pg_class where oid = c.oid),
               -- Sin `coalesce`: si el colector de estadísticas no tiene fila
               -- para esta tabla, el contador va NULL y el lector lo lee como
               -- «no consta», no como «cero escaneos secuenciales».
               'seq_scan', s.seq_scan,
               'seq_tup_read', s.seq_tup_read,
               'idx_scan', s.idx_scan,
               'indices', (select count(*) from pg_index i where i.indrelid = c.oid)
             ) as x
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        left join pg_stat_user_tables s on s.relid = c.oid
       where n.nspname = 'public' and c.relkind = 'r'
       limit 500
    ) q;

  if hay_pgss then
    execute format($q$
      select coalesce(jsonb_agg(jsonb_build_object(
               'consulta', left(query, 300),
               'llamadas', calls,
               'ms_total', round(total_exec_time::numeric, 1),
               'ms_media', round(mean_exec_time::numeric, 2),
               'filas', rows) order by total_exec_time desc), '[]'::jsonb)
        from (select query, calls, total_exec_time, mean_exec_time, rows
                from extensions.pg_stat_statements
               order by total_exec_time desc
               limit %s) t
    $q$, tope) into consultas;
  end if;

  return jsonb_build_object(
    'tablas', tablas,
    'consultas', jsonb_build_object(
      'disponible', hay_pgss,
      'motivo', case when hay_pgss then null
                     else 'la extensión pg_stat_statements no está instalada en esta base: no hay consultas lentas que citar. NO se afirma que no las haya.' end,
      'filas', coalesce(consultas, '[]'::jsonb)));
end;
$$;

comment on function public.perfil_almacenamiento(int) is
  'El peso y el patrón de acceso de public (0234): bytes totales, filas estimadas (reltuples tal cual — −1 = nunca analizada, y NO se convierte a 0), seq_scan/idx_scan e índices por tabla, más el top de consultas por tiempo total de pg_stat_statements CUANDO la extensión está. Si no está, devuelve disponible=false con motivo — nunca una lista vacía que se lea como «no hay consultas lentas». SECURITY DEFINER solo por pg_stat_statements: sin pg_read_all_stats el texto ajeno sale como <insufficient privilege>.';
revoke all on function public.perfil_almacenamiento(int) from public, anon, authenticated;
grant execute on function public.perfil_almacenamiento(int) to service_role;

-- (4) El contrato de esquema que el despliegue da por hecho. Tres cosas que
-- solo el catálogo sabe y que el código no puede deducir de sus propias
-- constantes.
create or replace function public.contrato_de_esquema()
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  with tenantizadas as (
    select c.oid, c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and exists (select 1 from pg_attribute a
                    where a.attrelid = c.oid and a.attname = 'tenant_id'
                      and a.attnum > 0 and not a.attisdropped)
  ),
  fks as (
    -- FK de UNA sola columna entre dos tablas con tenant_id, cuando entre ese
    -- par NO existe además una FK compuesta. Es el hueco que la 0028 y la
    -- 0145 fueron cerrando tabla por tabla y que la auditoría 19 dejó
    -- anotado como «ninguna verificación ni prueba que cuente FK compuestas»:
    -- sin la columna del tenant en la FK, nada en Postgres impide que una
    -- fila de la flota A cuelgue de una fila de la flota B.
    select o.relname as origen, d.relname as destino, k.conname as constraint_
      from pg_constraint k
      join tenantizadas o on o.oid = k.conrelid
      join tenantizadas d on d.oid = k.confrelid
     where k.contype = 'f'
       and array_length(k.conkey, 1) = 1
       and not exists (
         select 1 from pg_constraint k2
          where k2.contype = 'f' and k2.conrelid = k.conrelid
            and k2.confrelid = k.confrelid and array_length(k2.conkey, 1) > 1)
     limit 200
  )
  select jsonb_build_object(
    -- El texto del CHECK del interruptor. El agente `auditor_codigo` compara
    -- la lista INTERRUPTORES del bundle contra ESTE texto: si el código trae
    -- una palanca que el dominio no admite, apagarla rebota con
    -- check_violation el día del incidente — el peor día para descubrirlo.
    'interruptor_check', (select pg_get_constraintdef(oid) from pg_constraint
                           where conname = 'interruptor_id_dominio'
                             and conrelid = to_regclass('public.interruptor')),
    -- Tabla con tenant_id y RLS APAGADA. No es lo mismo que «sin policies»:
    -- con RLS activa, cero policies es DENIEGA TODO (la casa lo usa a
    -- propósito). Sin RLS, cualquier grant a anon/authenticated es lectura
    -- cruzada entre flotas.
    'tenant_sin_rls', (select coalesce(jsonb_agg(t.relname order by t.relname), '[]'::jsonb)
                         from tenantizadas t
                        where not (select relrowsecurity from pg_class where oid = t.oid)),
    'fks_simples_entre_tenantizadas',
      (select coalesce(jsonb_agg(to_jsonb(fks) order by fks.origen, fks.constraint_), '[]'::jsonb) from fks),
    'indices_unicos_parciales_cola',
      (select coalesce(jsonb_agg(i.indexname order by i.indexname), '[]'::jsonb)
         from pg_indexes i
        where i.schemaname = 'public' and i.tablename = 'cola_aprobacion'
          and i.indexdef like '%UNIQUE%')
  );
$$;

comment on function public.contrato_de_esquema() is
  'Lo que el catálogo sabe y el código no puede deducir de sus constantes (0234): el texto del CHECK interruptor_id_dominio (para cazar el drift contra INTERRUPTORES del bundle), las tablas con tenant_id y RLS APAGADA (distinto de «sin policies», que con RLS activa es deniega-todo a propósito), las FK de una sola columna entre tablas con tenant_id sin FK compuesta hermana (el hueco que la auditoría 19 dejó sin verificación) y los índices únicos de cola_aprobacion. SECURITY INVOKER.';
revoke all on function public.contrato_de_esquema() from public, anon, authenticated;
grant execute on function public.contrato_de_esquema() to service_role;
