\set ON_ERROR_STOP on
-- 0970 (MX-004) — tenant.interno: a lo más un tenant interno y solo el servidor lo escribe.
-- Datos sintéticos; corre en ci-postgres tras todas las migraciones y termina en rollback.
begin;

insert into public.tenant (id, nombre) values
  ('97000000-0000-4000-8000-0000000000a1', 'Flota A 0970'),
  ('97000000-0000-4000-8000-0000000000b1', 'Flota B 0970');

-- Para que el disparador sea la UNICA barrera (sin RLS ni privilegios que oculten la prueba), todo dentro de la transaccion.
alter table public.tenant disable row level security;
grant update, insert on public.tenant to authenticated;

do $$
declare n int; err text; v boolean;
begin
  -- 1. Por omisión ninguna flota es interna.
  select count(*) into n from public.tenant where id in ('97000000-0000-4000-8000-0000000000a1', '97000000-0000-4000-8000-0000000000b1') and interno;
  if n <> 0 then raise exception '0970(1): una flota nueva no debia nacer interna (%)', n; end if;

  -- 2. El servidor puede marcar UNA.
  update public.tenant set interno = true where id = '97000000-0000-4000-8000-0000000000a1';
  select interno into v from public.tenant where id = '97000000-0000-4000-8000-0000000000a1';
  if v is not true then raise exception '0970(2): el servidor debia poder marcar el tenant interno'; end if;

  -- 3. No puede haber dos.
  begin
    update public.tenant set interno = true where id = '97000000-0000-4000-8000-0000000000b1';
    raise exception '0970(3): dos tenants internos debian chocar con el indice unico';
  exception when unique_violation then null;
  end;

  -- 4. Una flota (authenticated) no puede declararse interna ni quitar la marca.
  begin
    set local role authenticated;
    update public.tenant set interno = true where id = '97000000-0000-4000-8000-0000000000b1';
    reset role;
    raise exception '0970(4): authenticated no debia poder marcar interno';
  exception when insufficient_privilege then
    reset role;
  end;
  begin
    set local role authenticated;
    update public.tenant set interno = false where id = '97000000-0000-4000-8000-0000000000a1';
    reset role;
    raise exception '0970(4b): authenticated no debia poder quitar la marca interno';
  exception when insufficient_privilege then
    reset role;
  end;
  select interno into v from public.tenant where id = '97000000-0000-4000-8000-0000000000a1';
  if v is not true then raise exception '0970(4c): la marca debia seguir puesta'; end if;
end $$;

rollback;
