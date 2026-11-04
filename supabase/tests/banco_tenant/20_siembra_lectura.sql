-- ═══════════════════════════════════════════════════════════════════════════
-- [BANCO:SIEMBRA] (b) Siembra dos flotas (A y B) con una fila en cada tabla de los esquemas expuestos que tenga columna de tenant
-- y comprueba, con Postgres real y las consultas generadas desde el catalogo (no una lista fija):
--   · como usuario `authenticated` de la flota A, ninguna tabla ni vista devuelve filas de B (y viceversa, B contra A);
--   · como usuario de A, un UPDATE sobre filas de B no toca nada (si la politica deja pasar el USING y solo falla el WITH CHECK
--     tambien es fuga: la fila era visible);
--   · como `anon`, ninguna tabla ni vista devuelve filas de ninguna de las dos flotas.
-- Corre DESPUES de restituir los grants previos a la 0947, para que los privilegios no oculten un hueco de RLS (misma razon que
-- la capa 1). Una tabla que no se pudo sembrar NO se da por probada: queda en cobertura.no_sembradas con su error, y el runner
-- exige una cobertura minima (scripts/ci/banco-tenant-allowlist.json) y que cada no sembrada tenga motivo escrito
-- (scripts/ci/banco-tenant-no-sembrables.json). Todo se deshace con el rollback del epilogo.
-- ═══════════════════════════════════════════════════════════════════════════
do $banco$
declare
  v_ta uuid := 'ba000000-0000-4000-8000-0000000000a1';
  v_tb uuid := 'ba000000-0000-4000-8000-0000000000b1';
  v_ua uuid := 'ba000000-0000-4000-8000-0000000000a2';
  v_ub uuid := 'ba000000-0000-4000-8000-0000000000b2';
  r record;
  e1 text; e2 text;
  v_lado int; v_yo uuid; v_otro uuid; v_uid uuid;
  c_yo text; c_otro text; c_ambos text;
  n_otro bigint; n_yo bigint; n_anon bigint; n_upd bigint;
  n_tablas int := 0; n_sembradas int := 0;
  n_sin_priv int := 0; n_error int := 0; n_con_propias int := 0; n_objetivos int := 0;
  v_errores jsonb := '[]'::jsonb;
  v_no jsonb := '[]'::jsonb;
begin
  -- Siembra sin disparadores ni FKs (rol de replica): el banco prueba aislamiento, no reglas de integridad.
  set local session_replication_role = replica;

  e1 := ci_banco.sembrar('public.tenant', v_ta, '{}'::jsonb, 1);
  e2 := ci_banco.sembrar('public.tenant', v_tb, '{}'::jsonb, 2);
  if e1 is not null or e2 is not null then
    raise exception 'banco: no se pudieron sembrar las dos flotas en public.tenant (%, %)', e1, e2;
  end if;
  -- ids de las flotas: la columna `id` de tenant ES la columna de tenant (tenant_cols), asi que ya valen v_ta / v_tb.
  insert into ci_banco.cobertura values ('public.tenant', 'sembrada', null);

  for r in
    select c.oid, c.oid::regclass as rel, n.nspname || '.' || c.relname as nombre
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = any (ci_banco.esquemas())
       and c.relkind in ('r', 'p')
       and not c.relispartition
       and ci_banco.tenant_cols(c.oid) is not null
       and not exists (select 1 from pg_depend d where d.objid = c.oid and d.classid = 'pg_class'::regclass and d.deptype = 'e')
     order by 2
  loop
    n_tablas := n_tablas + 1;
    if r.nombre = 'public.tenant' then
      n_sembradas := n_sembradas + 1;
      continue;
    end if;
    -- Siembra el PAR (flota A + flota B) o ninguna: la generica por tipo y, si un CHECK/unico la rechaza, la busqueda entre los
    -- candidatos que arma el runner desde los CHECK del catalogo (ver scripts/ci/banco-tenant-siembra.mjs).
    if r.nombre = 'public.app_user' then
      e1 := ci_banco.sembrar_buscando(r.rel, v_ta, v_tb,
        jsonb_build_object('id', v_ua, 'email', 'banco-a@ejemplo.test', 'rol', 'flota_admin', 'activo', true),
        jsonb_build_object('id', v_ub, 'email', 'banco-b@ejemplo.test', 'rol', 'flota_admin', 'activo', true));
    else
      e1 := ci_banco.sembrar_buscando(r.rel, v_ta, v_tb);
    end if;
    if e1 is null then
      n_sembradas := n_sembradas + 1;
      insert into ci_banco.cobertura values (r.nombre, 'sembrada', null);
    else
      insert into ci_banco.cobertura values (r.nombre, 'no_sembrada', left(e1, 400));
      v_no := v_no || jsonb_build_object('tabla', r.nombre, 'error', left(e1, 400));
    end if;
  end loop;

  set local session_replication_role = origin;

  -- Objetivos de lectura: tablas sembradas + toda vista con columna de tenant.
  for r in
    select c.oid, c.oid::regclass as rel, n.nspname || '.' || c.relname as nombre, c.relkind,
           ci_banco.tenant_cols(c.oid) as tc
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = any (ci_banco.esquemas())
       and c.relkind in ('r', 'p', 'v')
       and not c.relispartition
       and ci_banco.tenant_cols(c.oid) is not null
       and not exists (select 1 from pg_depend d where d.objid = c.oid and d.classid = 'pg_class'::regclass and d.deptype = 'e')
       and (c.relkind = 'v'
            or exists (select 1 from ci_banco.cobertura k
                        where k.tabla = n.nspname || '.' || c.relname and k.estado = 'sembrada'))
     order by 2
  loop
    n_objetivos := n_objetivos + 1;
    for v_lado in 1..2 loop
      v_yo := case v_lado when 1 then v_ta else v_tb end;
      v_otro := case v_lado when 1 then v_tb else v_ta end;
      v_uid := case v_lado when 1 then v_ua else v_ub end;
      select string_agg(format('%I = %L::uuid', col, v_yo), ' or ') into c_yo from unnest(r.tc) col;
      select string_agg(format('%I = %L::uuid', col, v_otro), ' or ') into c_otro from unnest(r.tc) col;

      -- Lectura como usuario autenticado de la flota `yo`.
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
        set local role authenticated;
        execute format('select count(*) from %s where %s', r.rel, c_otro) into n_otro;
        execute format('select count(*) from %s where %s', r.rel, c_yo) into n_yo;
        reset role;
        if n_yo > 0 then n_con_propias := n_con_propias + 1; end if;
        if n_otro > 0 then
          perform ci_banco.hallazgo('fuga_lectura', r.nombre, 'critica',
            format('como usuario de la flota %s se leyeron %s fila(s) de la otra flota', case v_lado when 1 then 'A' else 'B' end, n_otro));
        end if;
      exception
        when insufficient_privilege then n_sin_priv := n_sin_priv + 1;
        when others then
          n_error := n_error + 1;
          v_errores := v_errores || jsonb_build_object('objeto', r.nombre, 'fase', 'lectura', 'error', left(sqlstate || ': ' || sqlerrm, 160));
      end;

      -- Escritura sin efecto como usuario autenticado de `yo` contra filas de la otra flota (solo tablas).
      if r.relkind in ('r', 'p') then
        begin
          perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
          set local role authenticated;
          execute format('update %s set %I = %I where %s', r.rel, r.tc[1], r.tc[1], c_otro);
          get diagnostics n_upd = row_count;
          reset role;
          if n_upd > 0 then
            perform ci_banco.hallazgo('fuga_escritura', r.nombre, 'critica',
              format('como usuario de la flota %s un UPDATE alcanzo %s fila(s) de la otra flota', case v_lado when 1 then 'A' else 'B' end, n_upd));
          end if;
        exception
          when insufficient_privilege then
            -- 42501 por privilegio de tabla = cerrado. 42501 "new row violates row-level security" = el USING SI dejo pasar la fila ajena.
            if sqlerrm like 'new row violates row-level security%' then
              perform ci_banco.hallazgo('fuga_escritura', r.nombre, 'critica',
                'el USING de la politica dejo ver filas de la otra flota al UPDATE (solo el WITH CHECK lo freno)');
            end if;
          when others then null;
        end;
      end if;
    end loop;

    -- Lectura anonima: ninguna fila de ninguna flota.
    select string_agg(format('%I = %L::uuid or %I = %L::uuid', col, v_ta, col, v_tb), ' or ') into c_ambos from unnest(r.tc) col;
    begin
      set local role anon;
      execute format('select count(*) from %s where %s', r.rel, c_ambos) into n_anon;
      reset role;
      if n_anon > 0 then
        perform ci_banco.hallazgo('fuga_anon', r.nombre, 'critica', format('anon leyo %s fila(s) con columna de tenant', n_anon));
      end if;
    exception
      when insufficient_privilege then null;
      when others then null;
    end;
  end loop;

  insert into ci_banco.resumen values (jsonb_build_object(
    'tablas', n_tablas,
    'sembradas', n_sembradas,
    'objetivos_lectura', n_objetivos,
    'objetivos_con_filas_propias_visibles', n_con_propias,
    'lecturas_sin_privilegio', n_sin_priv,
    'lecturas_con_error', n_error,
    'no_sembradas', v_no,
    'errores_lectura', v_errores));
end
$banco$;
