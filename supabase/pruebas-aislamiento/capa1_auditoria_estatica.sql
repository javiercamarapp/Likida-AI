-- ═══════════════════════════════════════════════════════════════════════════
-- CAPA 1 · AUDITORÍA ESTÁTICA DEL ESQUEMA — AUTO-DESCUBRIENTE.
--
-- `supabase/verificaciones.sql` ya tiene 88 bloques que atacan el aislamiento
-- caso por caso (un tenant B intentando leer al A) y un bloque 18
-- ("AISLAMIENTO") que ya barre el catálogo buscando (a) tablas sin RLS y
-- (b) políticas literalmente `true`. Ese archivo NO SE TOCA desde aquí —vive
-- fuera de este archivo, y el runner de CI corre los dos.
--
-- Este archivo cubre los TRES huecos que quedaban entre esos dos mecanismos,
-- los tres con la misma forma: algo que solo se nota si alguien SE ACUERDA de
-- escribir un bloque a mano para la tabla/vista/función nueva. Aquí no hace
-- falta acordarse — se lee del catálogo en cada corrida:
--
--   1. VISTAS sin `security_invoker = true`. Es la regresión más cara que ha
--      tenido este repo (0054: `factura_saldo` sin `security_invoker` leía las
--      facturas de TODAS las flotas — bloque 33 de verificaciones.sql). Ese
--      bloque prueba la vista QUE YA EXISTE; esto prueba que NINGUNA vista,
--      presente o futura, se quede sin la marca. Hoy hay una sola vista en
--      `public` (`factura_saldo`) y ya la tiene — este bloque pasa en verde
--      hoy y se pone rojo el día que exista una segunda sin la opción.
--
--   2. Funciones SECURITY DEFINER ejecutables por `anon`, leídas de
--      `pg_proc` — NO de una lista escrita a mano. El bloque 18 de
--      verificaciones.sql ya hace este chequeo, pero contra un array fijo de
--      9 nombres (`try_lock_viaje`, `unlock_viaje`, …): una función nueva
--      (hoy hay 14 SECURITY DEFINER en `public`; sólo 9 están en esa lista)
--      no entra a esa comprobación aunque naciera abierta a `anon`. Aquí se
--      leen TODAS, y se exceptúan automáticamente las que las propias
--      políticas RLS usan como ayudante —`get_user_tenant_ids()` e
--      `is_superadmin()`, hoy referenciadas por 38 y 42 políticas
--      respectivamente— porque ÉSAS tienen que poder ejecutarse bajo
--      `anon`/`authenticated`: el motor de RLS las llama con el rol de quien
--      pregunta, y revocarlas rompería el aislamiento en vez de cerrarlo
--      (ver el comentario del propio bloque 18). La excepción se detecta
--      sola —una función nueva que otra política empiece a usar se exceptúa
--      sin tocar este archivo— buscando el nombre dentro de `pg_policies`.
--
--   3. Tablas con `tenant_id` que SÍ tienen alguna política, pero NINGUNA de
--      esas políticas menciona `tenant_id` en su expresión. El bloque 18 ya
--      atrapa la política que dice literalmente `true`; esto atrapa el caso
--      más silencioso — una política que sí filtra por ALGO (`created_by =
--      auth.uid()`, por ejemplo) pero no por el tenant, que se ve tan
--      "protegida" en `pg_policies` como una correcta.
--
-- LO QUE NO CUBRE (y por qué no hace falta un cuarto bloque): una tabla con
-- `tenant_id` y CERO políticas no es un hallazgo — con RLS activo, cero
-- políticas es DENIEGA TODO a `anon`/`authenticated`, que es el lado seguro
-- (`codigo_pendiente`, `comprobante_huerfano`, `api_idempotencia` y otra
-- media docena viven así a propósito: solo el service-role las toca). El
-- riesgo de aislamiento nunca está en "de más restrictivo", está en "de más
-- permisivo" — que es exactamente lo que los tres bloques de arriba, más el
-- 18, persiguen entre los cuatro.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A. Toda vista nueva nace con `security_invoker = true` ─────────────────
do $$
declare
  sin_invoker text;
  n int;
begin
  select coalesce(string_agg(c.relname, ', ' order by c.relname), '—'), count(*)
    into sin_invoker, n
    from pg_class c
    join pg_namespace nsp on nsp.oid = c.relnamespace
   where nsp.nspname = 'public'
     and c.relkind = 'v'
     and not (
       -- `reloptions` es un array `text[]` tipo `{security_invoker=true}`.
       -- `unnest` + `=` es exacto; un `ilike` sobre el array concatenado se
       -- confundiría con una vista futura que tuviera OTRA opción cuyo
       -- nombre contenga la palabra.
       exists (
         select 1 from unnest(coalesce(c.reloptions, array[]::text[])) o
          where o = 'security_invoker=true'
       )
     );

  if n > 0 then
    raise notice 'vistas sin security_invoker: %', sin_invoker;
  end if;

  raise exception E'VISTAS_INVOKER  sin_security_invoker=%   (esperado 0)', n;
end $$;

-- ── B. Ninguna función SECURITY DEFINER de `public` queda abierta a `anon`,
--       salvo las que las propias políticas RLS necesitan como ayudante ─────
do $$
declare
  abiertas text;
  n int;
begin
  select coalesce(string_agg(p.proname, ', ' order by p.proname), '—'), count(*)
    into abiertas, n
    from pg_proc p
    join pg_namespace nsp on nsp.oid = p.pronamespace
   where nsp.nspname = 'public'
     and p.prosecdef                                   -- SECURITY DEFINER
     and has_function_privilege('anon', p.oid, 'EXECUTE')
     and not exists (
       -- La excepción se detecta sola: si alguna política RLS de `public` la nombra en su
       -- USING o su WITH CHECK, es un ayudante de RLS y TIENE que poder
       -- correr como `anon` — el motor evalúa la política con el rol de
       -- quien pregunta, sesión anónima incluida.
       select 1 from pg_policies pol
        where pol.schemaname = 'public'
          and (coalesce(pol.qual, '') ilike '%' || p.proname || '%'
               or coalesce(pol.with_check, '') ilike '%' || p.proname || '%')
     );

  if n > 0 then
    raise notice 'SECURITY DEFINER abiertas a anon y sin usar en ninguna política: %', abiertas;
  end if;

  raise exception E'DEFINER_ANON  abiertas_sin_exencion=%   (esperado 0)', n;
end $$;

-- ── C. Toda tabla con `tenant_id` y AL MENOS una política tiene, entre sus
--       políticas, una que de verdad mencione `tenant_id` ──────────────────
do $$
declare
  huerfanas text;
  n int;
begin
  select coalesce(string_agg(t.table_name, ', ' order by t.table_name), '—'), count(*)
    into huerfanas, n
    from (select distinct table_name from information_schema.columns
           where table_schema = 'public' and column_name = 'tenant_id') t
   where exists (
           select 1 from pg_policies p
            where p.schemaname = 'public' and p.tablename = t.table_name
         )
     and not exists (
           select 1 from pg_policies p
            where p.schemaname = 'public' and p.tablename = t.table_name
              and (coalesce(p.qual, '') ilike '%tenant_id%'
                   or coalesce(p.with_check, '') ilike '%tenant_id%')
         );

  if n > 0 then
    raise notice 'tablas con tenant_id, con política, pero ninguna filtra por tenant_id: %', huerfanas;
  end if;

  raise exception E'POLITICA_SIN_TENANT  tablas=%   (esperado 0)', n;
end $$;

-- ── D. Las cinco tablas que la ronda de auditoría nombró explícitamente
--       siguen siendo deniega-todo (RLS activa, cero políticas) ────────────
-- No es redundante con el bloque 18 de verificaciones.sql (ese mira TODA
-- tabla sin RLS; esto fija la lista nombrada en el encargo y avisa si alguna
-- de esas cinco cambia de forma — de deniega-todo a algo con política, que
-- sería el momento de escribirle su propio ataque dinámico).
do $$
declare
  esperadas text[] := array['prospecto','interruptor','impersonacion_dia','factura_proveedor','desglose_peaje'];
  sin_rls text; con_politica text;
begin
  select coalesce(string_agg(t, ', ' order by t), '—') into sin_rls
    from unnest(esperadas) t
   where not coalesce((select relrowsecurity from pg_class where relname = t), false);

  select coalesce(string_agg(t, ', ' order by t), '—') into con_politica
    from unnest(esperadas) t
   where exists (select 1 from pg_policies where schemaname = 'public' and tablename = t);

  raise exception E'DENY_ALL_NOMBRADAS  sin_rls=%  con_alguna_politica=%   (esperado — / —)',
    sin_rls, con_politica;
end $$;
