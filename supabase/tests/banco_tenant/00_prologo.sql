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

-- Valores candidatos por (tabla, columna) que cumplen los CHECK de la tabla; los arma scripts/ci/banco-tenant-siembra.mjs desde el
-- catalogo y los carga el runner justo despues de este prologo. Convencion de va/vb (flota A / flota B): '@N' = NULL,
-- '@V' = el valor generico por tipo, '=<sql>' = expresion SQL cruda, otro texto = literal.
create table ci_banco.candidatos (tabla text not null, columna text not null, ord int not null, va text not null, vb text not null);

-- Bases explicitas por (tabla, lado, columna): valores que la siembra generica no deduce (CHECK acoplados). Las arma
-- scripts/ci/banco-tenant-siembra.mjs (BASES_EXPLICITAS) y las carga el runner; lado 1 = flota A, 2 = flota B.
create table ci_banco.bases (tabla text not null, lado int not null, columna text not null, valor text not null);

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
-- sembrar (la tabla quedara como "no sembrada" y se reporta; no se finge cobertura). p_lado (1 = flota A, 2 = flota B) separa los
-- valores numericos/binarios de las dos flotas para no chocar con unicos que no incluyen el tenant.
create function ci_banco.valor_sql(p_tipo oid, p_mod int, p_lado int default 1) returns text language plpgsql stable as $f$
declare
  v_nombre name; v_tipo "char"; v_cat "char"; v_base oid; v_label text; v_len int;
begin
  select typname, typtype, typcategory, typbasetype into v_nombre, v_tipo, v_cat, v_base from pg_type where oid = p_tipo;
  if v_tipo = 'd' then return ci_banco.valor_sql(v_base, -1, p_lado); end if;
  if v_tipo = 'e' then
    select enumlabel into v_label from pg_enum where enumtypid = p_tipo order by enumsortorder limit 1;
    return quote_literal(v_label) || '::' || p_tipo::regtype::text;
  end if;
  if v_cat = 'A' then return quote_literal('{}') || '::' || p_tipo::regtype::text; end if;
  if v_cat = 'R' then return quote_literal('empty') || '::' || p_tipo::regtype::text; end if;
  v_len := case when p_mod > 4 then least(p_mod - 4, 32) else 32 end;
  return case v_nombre
    when 'uuid' then 'gen_random_uuid()'
    when 'text' then format('left(md5(random()::text), %s)', v_len)
    when 'varchar' then format('left(md5(random()::text), %s)', v_len)
    when 'citext' then format('left(md5(random()::text), %s)', v_len)
    when 'bpchar' then quote_literal('x')
    when 'name' then quote_literal('x')
    when 'int2' then p_lado::text when 'int4' then p_lado::text when 'int8' then p_lado::text
    when 'numeric' then p_lado::text when 'float4' then p_lado::text when 'float8' then p_lado::text when 'money' then p_lado::text
    when 'bool' then 'false'
    when 'timestamptz' then 'now()' when 'timestamp' then 'now()'
    when 'date' then 'current_date'
    when 'time' then quote_literal('00:00') || '::time'
    when 'timetz' then quote_literal('00:00') || '::timetz'
    when 'interval' then quote_literal('1 hour') || '::interval'
    when 'json' then quote_literal('{}') || '::json'
    when 'jsonb' then quote_literal('{}') || '::jsonb'
    when 'bytea' then quote_literal('\x0' || p_lado::text) || '::bytea'
    when 'inet' then quote_literal('127.0.0.' || p_lado::text) || '::inet'
    when 'cidr' then quote_literal('10.0.' || p_lado::text || '.0/24') || '::cidr'
    when 'macaddr' then quote_literal('08:00:2b:01:02:0' || p_lado::text) || '::macaddr'
    when 'xml' then quote_literal('<a/>') || '::xml'
    else null
  end;
end
$f$;

-- Un valor de candidato (texto) a expresion SQL para una columna: '@N' (o null) = NULL, '@V' = valor generico por tipo,
-- '=<sql>' = expresion cruda, otro = literal entrecomillado (Postgres lo convierte al tipo de la columna en el INSERT).
create function ci_banco.expr_ajuste(p_v text, p_tipo oid, p_mod int, p_lado int) returns text language plpgsql stable as $f$
begin
  if p_v is null or p_v = '@N' then return 'null'; end if;
  if p_v = '@V' then return coalesce(ci_banco.valor_sql(p_tipo, p_mod, p_lado), 'null'); end if;
  if left(p_v, 1) = '=' then return substr(p_v, 2); end if;
  return quote_literal(p_v);
end
$f$;

-- Siembra una fila de la flota p_tenant en p_rel: llena las columnas de tenant, las NOT NULL sin default y las que pida
-- p_over (columna -> candidato, ver expr_ajuste). LEVANTA el error si no puede insertar (sembrar_par y sembrar lo recogen).
create function ci_banco.sembrar_fila(p_rel regclass, p_tenant uuid, p_over jsonb default '{}'::jsonb, p_lado int default 1) returns void language plpgsql as $f$
declare
  v_tc text[] := coalesce(ci_banco.tenant_cols(p_rel::oid), array[]::text[]);
  v_cols text; v_vals text;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum),
         string_agg(case
           when a.attname::text = any (v_tc) then quote_literal(p_tenant::text) || '::uuid'
           when p_over ? a.attname::text then ci_banco.expr_ajuste(p_over ->> a.attname::text, a.atttypid, a.atttypmod, p_lado)
           else coalesce(ci_banco.valor_sql(a.atttypid, a.atttypmod, p_lado), 'null')
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
end
$f$;

-- Una fila de la flota p_tenant; devuelve null si inserto, o "sqlstate: mensaje" si no pudo (la fila se deshace sola).
create function ci_banco.sembrar(p_rel regclass, p_tenant uuid, p_over jsonb default '{}'::jsonb, p_lado int default 1) returns text language plpgsql as $f$
begin
  perform ci_banco.sembrar_fila(p_rel, p_tenant, p_over, p_lado);
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end
$f$;

-- Las DOS filas (flota A y flota B) o ninguna: si la B falla (p. ej. un unico global), la A tambien se deshace (subtransaccion).
create function ci_banco.sembrar_par(p_rel regclass, p_ta uuid, p_tb uuid, p_oa jsonb, p_ob jsonb) returns text language plpgsql as $f$
begin
  perform ci_banco.sembrar_fila(p_rel, p_ta, p_oa, 1);
  perform ci_banco.sembrar_fila(p_rel, p_tb, p_ob, 2);
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end
$f$;

-- Siembra el par de filas; si la siembra generica falla, BUSCA entre las combinaciones de ci_banco.candidatos de la tabla (la
-- primera columna varia mas rapido) hasta p_tope intentos. Devuelve null si sembro, o el primer error + el ultimo intento.
create function ci_banco.sembrar_buscando(p_rel regclass, p_ta uuid, p_tb uuid, p_base_a jsonb default '{}'::jsonb,
                                          p_base_b jsonb default '{}'::jsonb, p_tope int default 600) returns text language plpgsql as $f$
declare
  v_nombre text; v_err0 text; v_err text := null;
  v_cols text[]; v_la jsonb[]; v_lb jsonb[]; v_n int[];
  v_total numeric := 1; v_div bigint; v_idx int; v_oa jsonb; v_ob jsonb; i int; j int; n_int int; v_hasta int;
begin
  v_err0 := ci_banco.sembrar_par(p_rel, p_ta, p_tb, p_base_a, p_base_b);
  if v_err0 is null then return null; end if;
  select n.nspname || '.' || c.relname into v_nombre from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.oid = p_rel::oid;
  select array_agg(columna order by columna), array_agg(la order by columna), array_agg(lb order by columna), array_agg(n order by columna)
    into v_cols, v_la, v_lb, v_n
    from (select columna, jsonb_agg(va order by ord) as la, jsonb_agg(vb order by ord) as lb, count(*)::int as n
            from ci_banco.candidatos where tabla = v_nombre group by columna) s;
  if v_cols is null then return v_err0; end if;
  foreach n_int in array v_n loop v_total := v_total * n_int; end loop;
  v_hasta := least(v_total, p_tope::numeric)::int - 1;
  for i in 0..v_hasta loop
    v_oa := '{}'::jsonb; v_ob := '{}'::jsonb; v_div := 1;
    for j in 1..array_length(v_cols, 1) loop
      v_idx := ((i / v_div) % v_n[j])::int;
      v_div := v_div * v_n[j];
      v_oa := v_oa || jsonb_build_object(v_cols[j], v_la[j] ->> v_idx);
      v_ob := v_ob || jsonb_build_object(v_cols[j], v_lb[j] ->> v_idx);
    end loop;
    -- la base (p. ej. id/email de app_user) manda sobre los candidatos
    v_err := ci_banco.sembrar_par(p_rel, p_ta, p_tb, v_oa || p_base_a, v_ob || p_base_b);
    if v_err is null then return null; end if;
  end loop;
  return left(v_err0 || ' [' || (v_hasta + 1) || ' intentos con candidatos; ultimo: ' || coalesce(v_err, '-') || ']', 400);
end
$f$;
