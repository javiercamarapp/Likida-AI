-- ═══════════════════════════════════════════════════════════════════════════
-- [BANCO:VISTAS] (e) Toda vista de los esquemas expuestos es security_invoker=true o filtra por la sesion en su definicion
-- (get_user_tenant_ids, auth.uid, ayudantes de rol). Una vista sin ninguna de las dos corre con los permisos de su dueno y
-- salta la RLS de las tablas base (0054: factura_saldo leia las facturas de TODAS las flotas). Las vistas materializadas no
-- admiten RLS ni security_invoker: con columna de tenant, o con SELECT para anon/authenticated, son un hallazgo.
-- ═══════════════════════════════════════════════════════════════════════════
insert into ci_banco.hallazgos
select 'vista_sin_invoker', format('%s.%s', n.nspname, c.relname),
       case when has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select')
            then 'critica' else 'media' end,
       'vista sin security_invoker=true y sin filtro por sesion en su definicion; con_grant_select_cliente='
         || (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select'))
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = any (ci_banco.esquemas())
   and c.relkind = 'v'
   and not exists (select 1 from pg_depend d where d.objid = c.oid and d.classid = 'pg_class'::regclass and d.deptype = 'e')
   and not exists (select 1 from unnest(coalesce(c.reloptions, array[]::text[])) o
                    where o in ('security_invoker=true', 'security_invoker=on', 'security_invoker=1'))
   and pg_get_viewdef(c.oid) !~* '(get_user_tenant_ids|auth\.uid|is_superadmin|es_dueno_flota|administra_flota|ve_finanzas|ve_operacion|ve_atencion_cliente|current_setting)';

insert into ci_banco.hallazgos
select 'matview_expuesta', format('%s.%s', n.nspname, c.relname),
       case when has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select')
            then 'critica' else 'media' end,
       'vista materializada sin RLS posible; con_columna_tenant=' || (ci_banco.tenant_cols(c.oid) is not null)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = any (ci_banco.esquemas())
   and c.relkind = 'm'
   and (ci_banco.tenant_cols(c.oid) is not null
        or has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select'));
