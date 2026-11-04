-- ═══════════════════════════════════════════════════════════════════════════
-- [BANCO:POLITICAS] (a) Toda tabla de los esquemas expuestos con columna de tenant tiene RLS habilitada, y ninguna politica
-- permisiva abre lectura o escritura con una expresion literalmente verdadera a anon/authenticated/public.
-- Auto-descubriente: se lee de pg_class/pg_policy, no de una lista escrita a mano.
-- ═══════════════════════════════════════════════════════════════════════════
insert into ci_banco.hallazgos
select 'sin_rls', format('%s.%s', n.nspname, c.relname), 'critica',
       'tabla con columna de tenant (' || array_to_string(ci_banco.tenant_cols(c.oid), ',') || ') y RLS deshabilitada'
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = any (ci_banco.esquemas())
   and c.relkind in ('r', 'p')
   and not c.relrowsecurity
   and ci_banco.tenant_cols(c.oid) is not null
   and not exists (select 1 from pg_depend d where d.objid = c.oid and d.classid = 'pg_class'::regclass and d.deptype = 'e');

-- Politica permisiva abierta (USING true / WITH CHECK true) para un rol de cliente. Una fila por tabla.
insert into ci_banco.hallazgos
select 'politica_abierta', format('%s.%s', n.nspname, c.relname),
       case when ci_banco.tenant_cols(c.oid) is not null then 'critica' else 'alta' end,
       'politicas abiertas: ' || string_agg(p.polname || ' (' || p.polcmd || ')', ', ' order by p.polname)
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = any (ci_banco.esquemas())
   and p.polpermissive
   and (0::oid = any (p.polroles)
        or 'anon'::regrole::oid = any (p.polroles)
        or 'authenticated'::regrole::oid = any (p.polroles))
   and ((p.polcmd in ('r', 'w', 'd', '*') and ci_banco.es_verdadero(pg_get_expr(p.polqual, p.polrelid)))
        or (p.polcmd in ('a', 'w', '*') and ci_banco.es_verdadero(pg_get_expr(p.polwithcheck, p.polrelid))))
 group by n.nspname, c.relname, c.oid;
