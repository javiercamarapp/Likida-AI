-- CI efímero: restituye lo guardado por `grants_previos_0947_guardar.sql` (ver ese archivo) y el default ACL de la plataforma que el
-- andamio replica, DESPUÉS de capa0 (que prueba el estado real tras la 0947). NUNCA se corre contra producción.
do $$
declare r record;
begin
  for r in select * from ci_grants_previos.acl where kind = 'rel' loop
    execute format('grant %s on %s %s to %s', r.priv, case when r.relkind = 'S' then 'sequence' else 'table' end, r.ident,
                   case when r.grantee = 'public' then 'public' else quote_ident(r.grantee) end);
  end loop;
  for r in select * from ci_grants_previos.acl where kind = 'col' loop
    execute format('grant %s (%I) on table %s to %s', r.priv, r.col, r.ident,
                   case when r.grantee = 'public' then 'public' else quote_ident(r.grantee) end);
  end loop;
  for r in select * from ci_grants_previos.acl where kind = 'fn' loop
    execute format('grant execute on function %s to %s', r.ident, case when r.grantee = 'public' then 'public' else quote_ident(r.grantee) end);
  end loop;
end $$;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated, service_role;
