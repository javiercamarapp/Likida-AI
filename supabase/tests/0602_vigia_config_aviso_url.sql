-- 0602 — el CHECK de aviso_privacidad_url se evalúa (la 0400 usaba {1,480}, tope de Postgres 255).
-- Datos sintéticos; corre en ci-postgres tras todas las migraciones y termina en rollback.
begin;

insert into public.tenant (id, nombre) values ('60200000-0000-4000-8000-0000000000a1', 'Flota A 0602');

-- una URL válida SE GUARDA (con la 0400 abortaba con «invalid repetition count(s)»)
insert into public.vigia_config (tenant_id, aviso_privacidad_url)
values ('60200000-0000-4000-8000-0000000000a1', 'https://ejemplo.com/aviso-de-privacidad');

do $$
declare rechazada boolean;
begin
  -- larga pero dentro del tope: pasa (500)
  update public.vigia_config set aviso_privacidad_url = 'https://e.com/' || repeat('a', 486)
   where tenant_id = '60200000-0000-4000-8000-0000000000a1';
  -- pasa de 500: rechazada
  rechazada := false;
  begin
    update public.vigia_config set aviso_privacidad_url = 'https://e.com/' || repeat('a', 487)
     where tenant_id = '60200000-0000-4000-8000-0000000000a1';
  exception when check_violation then rechazada := true; end;
  if not rechazada then raise exception '0602: una URL de más de 500 caracteres debía rechazarse'; end if;
  -- http a secas: rechazada
  rechazada := false;
  begin
    update public.vigia_config set aviso_privacidad_url = 'http://ejemplo.com/a'
     where tenant_id = '60200000-0000-4000-8000-0000000000a1';
  exception when check_violation then rechazada := true; end;
  if not rechazada then raise exception '0602: http:// debía rechazarse'; end if;
  -- con espacio: rechazada
  rechazada := false;
  begin
    update public.vigia_config set aviso_privacidad_url = 'https://ejemplo.com/a b'
     where tenant_id = '60200000-0000-4000-8000-0000000000a1';
  exception when check_violation then rechazada := true; end;
  if not rechazada then raise exception '0602: una URL con espacio debía rechazarse'; end if;
  -- NULL sigue permitido
  update public.vigia_config set aviso_privacidad_url = null where tenant_id = '60200000-0000-4000-8000-0000000000a1';
end $$;

rollback;
