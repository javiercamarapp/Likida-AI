-- ═══════════════════════════════════════════════════════════════════════════
-- BANCO MULTI-TENANT (X-02) · prologo compartido. Lo arma `scripts/ci/banco-tenant.mjs`, que abre la transaccion, fija
-- `ci_banco.esquemas` (esquemas expuestos por la API, de la allowlist) y cierra siempre con rollback: nada de esto persiste.
-- Todo vive en el esquema efimero `ci_banco`, fuera de `public`, para no contaminar las auditorias de las otras capas.
-- ═══════════════════════════════════════════════════════════════════════════
create schema ci_banco;
grant usage on schema ci_banco to public;

-- Hallazgos: una fila por (tipo, objeto). El runner los compara contra scripts/ci/banco-tenant-allowlist.json.
create table ci_banco.hallazgos (tipo text not null, objeto text not null, severidad text not null, detalle text);
grant select, insert on ci_banco.hallazgos to public;

-- Estado de siembra por tabla (solo la fase dinamica la llena) y resumen numerico que el epilogo imprime.
create table ci_banco.cobertura (tabla text primary key, estado text not null, error text);
grant select, insert, update on ci_banco.cobertura to public;
create table ci_banco.resumen (datos jsonb not null);
grant select, insert on ci_banco.resumen to public;

-- Esquemas expuestos que existen de verdad en esta base (graphql_public no existe en el Postgres efimero).
create function ci_banco.esquemas() returns text[] language sql stable as $f$
  select coalesce(array_agg(nspname::text), array[]::text[])
    from pg_namespace
   where nspname = any (string_to_array(current_setting('ci_banco.esquemas'), ','))
$f$;

-- Columnas que identifican la flota de una fila: `tenant_id` o cualquier FK hacia tenant(id); para `tenant` misma, `id`.
-- Devuelve null si el objeto no tiene ninguna (tabla o vista de catalogo global).
create function ci_banco.tenant_cols(p_rel oid) returns text[] language sql stable as $f$
  select case
    when p_rel = to_regclass('public.tenant')::oid then array['id']::text[]
    else (
      select array_agg(distinct a.attname::text order by a.attname::text)
        from pg_attribute a
       where a.attrelid = p_rel and a.attnum > 0 and not a.attisdropped
         and (a.attname = 'tenant_id'
              or exists (select 1 from pg_constraint k
                          where k.conrelid = p_rel and k.contype = 'f'
                            and k.confrelid = to_regclass('public.tenant')::oid
                            and k.conkey = array[a.attnum]))
    )
  end
$f$;

-- Un hallazgo por (tipo, objeto), aunque varias pruebas lo vean.
create function ci_banco.hallazgo(p_tipo text, p_objeto text, p_sev text, p_detalle text) returns void language sql as $f$
  insert into ci_banco.hallazgos
  select p_tipo, p_objeto, p_sev, p_detalle
   where not exists (select 1 from ci_banco.hallazgos h where h.tipo = p_tipo and h.objeto = p_objeto)
$f$;

-- ¿La expresion de una politica es literalmente verdadera? (`true`, `(true)`, `1 = 1`)
create function ci_banco.es_verdadero(p_expr text) returns boolean language sql immutable as $f$
  select lower(regexp_replace(coalesce(p_expr, ''), '[\s()]', '', 'g')) in ('true', '1=1')
$f$;

-- Expresion SQL con un valor valido para un tipo, para sembrar columnas NOT NULL sin default. null = tipo que no sabemos
-- sembrar (la tabla quedara como "no sembrada" y se reporta; no se finge cobertura).
create function ci_banco.valor_sql(p_tipo oid, p_mod int) returns text language plpgsql stable as $f$
declare
  v_nombre name; v_tipo "char"; v_cat "char"; v_base oid; v_label text; v_len int;
begin
  select typname, typtype, typcategory, typbasetype into v_nombre, v_tipo, v_cat, v_base from pg_type where oid = p_tipo;
  if v_tipo = 'd' then return ci_banco.valor_sql(v_base, -1); end if;
  if v_tipo = 'e' then
    select enumlabel into v_label from pg_enum where enumtypid = p_tipo order by enumsortorder limit 1;
    return quote_literal(v_label) || '::' || p_tipo::regtype::text;
  end if;
  if v_cat = 'A' then return quote_literal('{}') || '::' || p_tipo::regtype::text; end if;
  v_len := case when p_mod > 4 then least(p_mod - 4, 32) else 32 end;
  return case v_nombre
    when 'uuid' then 'gen_random_uuid()'
    when 'text' then format('left(md5(random()::text), %s)', v_len)
    when 'varchar' then format('left(md5(random()::text), %s)', v_len)
    when 'citext' then format('left(md5(random()::text), %s)', v_len)
    when 'bpchar' then quote_literal('x')
    when 'name' then quote_literal('x')
    when 'int2' then '1' when 'int4' then '1' when 'int8' then '1'
    when 'numeric' then '1' when 'float4' then '1' when 'float8' then '1' when 'money' then '1'
    when 'bool' then 'false'
    when 'timestamptz' then 'now()' when 'timestamp' then 'now()'
    when 'date' then 'current_date'
    when 'time' then quote_literal('00:00') || '::time'
    when 'timetz' then quote_literal('00:00') || '::timetz'
    when 'interval' then quote_literal('1 hour') || '::interval'
    when 'json' then quote_literal('{}') || '::json'
    when 'jsonb' then quote_literal('{}') || '::jsonb'
    when 'bytea' then quote_literal('\x00') || '::bytea'
    when 'inet' then quote_literal('127.0.0.1') || '::inet'
    else null
  end;
end
$f$;

-- Siembra una fila de la flota p_tenant en p_rel: llena las columnas de tenant, las NOT NULL sin default y las que pida
-- p_over. Devuelve null si inserto, o "sqlstate: mensaje" si no pudo (la fila se deshace sola: subtransaccion implicita).
create function ci_banco.sembrar(p_rel regclass, p_tenant uuid, p_over jsonb default '{}'::jsonb) returns text language plpgsql as $f$
declare
  v_tc text[] := coalesce(ci_banco.tenant_cols(p_rel::oid), array[]::text[]);
  v_cols text; v_vals text;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum),
         string_agg(case
           when a.attname::text = any (v_tc) then quote_literal(p_tenant::text) || '::uuid'
           when p_over ? a.attname::text then quote_literal(p_over ->> a.attname::text)
           else coalesce(ci_banco.valor_sql(a.atttypid, a.atttypmod), 'null')
         end, ', ' order by a.attnum)
    into v_cols, v_vals
    from pg_attribute a
   where a.attrelid = p_rel and a.attnum > 0 and not a.attisdropped
     and a.attgenerated = '' and a.attidentity = ''
     and (a.attname::text = any (v_tc) or p_over ? a.attname::text or (a.attnotnull and not a.atthasdef));
  if v_cols is null then
    execute format('insert into %s default values', p_rel);
  else
    execute format('insert into %s (%s) values (%s)', p_rel, v_cols, v_vals);
  end if;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end
$f$;
