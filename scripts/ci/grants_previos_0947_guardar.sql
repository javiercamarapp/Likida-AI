-- CI efímero (ci-postgres): guarda los privilegios de anon/authenticated/PUBLIC JUSTO ANTES de la 0947, que los revoca de golpe.
-- `grants_previos_0947_restaurar.sql` los devuelve DESPUÉS de capa0, para que la batería de aislamiento siga viendo exactamente el estado
-- de grants que las migraciones anteriores dejaron (revokes puntuales por tabla incluidos) y pruebe RLS como capa independiente.
-- Vive fuera de `public` para no contaminar las auditorías. NUNCA se corre contra producción.
drop schema if exists ci_grants_previos cascade;
create schema ci_grants_previos;
create table ci_grants_previos.acl (kind text, ident text, relkind "char", col text, grantee text, priv text);

insert into ci_grants_previos.acl
select 'rel', c.oid::regclass::text, c.relkind, null, case when a.grantee = 0 then 'public' else a.grantee::regrole::text end, a.privilege_type
  from pg_class c cross join lateral aclexplode(c.relacl) a
 where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','f','S')
   and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole));

insert into ci_grants_previos.acl
select 'col', c.oid::regclass::text, c.relkind, t.attname, case when a.grantee = 0 then 'public' else a.grantee::regrole::text end, a.privilege_type
  from pg_attribute t join pg_class c on c.oid = t.attrelid cross join lateral aclexplode(t.attacl) a
 where c.relnamespace = 'public'::regnamespace and not t.attisdropped and t.attacl is not null
   and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole));

insert into ci_grants_previos.acl
select 'fn', p.oid::regprocedure::text, null, null, case when a.grantee = 0 then 'public' else a.grantee::regrole::text end, a.privilege_type
  from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
 where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
   and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole))
   and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');
