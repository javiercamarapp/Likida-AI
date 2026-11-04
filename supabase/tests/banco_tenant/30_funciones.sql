-- ═══════════════════════════════════════════════════════════════════════════
-- [BANCO:FUNCIONES] (c) Ninguna funcion SECURITY DEFINER de los esquemas expuestos es ejecutable por anon (ni por PUBLIC, que
-- has_function_privilege cuenta) salvo la allowlist explicita. (d) Las funciones solo-sistema (service_role) no son
-- ejecutables por authenticated: toda SECURITY DEFINER ejecutable por authenticated debe estar en la allowlist con su razon
-- (hoy: los ayudantes de RLS que las politicas llaman con el rol de quien consulta).
-- Corre ANTES de restituir los grants previos a la 0947: mide el estado real de produccion.
-- ═══════════════════════════════════════════════════════════════════════════
insert into ci_banco.hallazgos
select 'funcion_anon', format('%s.%s(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), 'alta',
       'SECURITY DEFINER ejecutable por anon/PUBLIC; usada_por_politica=' || exists (
         select 1 from pg_depend d where d.classid = 'pg_policy'::regclass and d.refclassid = 'pg_proc'::regclass and d.refobjid = p.oid)
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = any (ci_banco.esquemas())
   and p.prokind in ('f', 'p')
   and p.prosecdef
   and not exists (select 1 from pg_depend d where d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e')
   and has_function_privilege('anon', p.oid, 'execute');

insert into ci_banco.hallazgos
select 'funcion_authenticated', format('%s.%s(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)),
       case when u.usada then 'info' else 'alta' end,
       'SECURITY DEFINER ejecutable por authenticated; usada_por_politica=' || u.usada
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 cross join lateral (select exists (
         select 1 from pg_depend d where d.classid = 'pg_policy'::regclass and d.refclassid = 'pg_proc'::regclass and d.refobjid = p.oid) as usada) u
 where n.nspname = any (ci_banco.esquemas())
   and p.prokind in ('f', 'p')
   and p.prosecdef
   and not exists (select 1 from pg_depend d where d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e')
   and has_function_privilege('authenticated', p.oid, 'execute');
