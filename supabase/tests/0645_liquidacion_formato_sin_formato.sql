\set ON_ERROR_STOP on
-- 0645 — la fila de la flota puede guardar SOLO los teléfonos (formato nulo). Datos sintéticos; termina en rollback.
--   (a) se inserta una fila con formato NULL y teléfonos válidos;
--   (b) con formato nulo siguen vigentes los CHECK de teléfonos (forma y tope de 3);
--   (c) con formato NO nulo sigue exigiéndose que sea un objeto (la 0564 no se debilitó);
--   (d) la migración es idempotente (aplicarla otra vez no falla).
begin;
insert into public.tenant (id, nombre) values ('64500000-0000-4000-8000-0000000000a1', 'Flota 0645');

do $$
declare
  t constant uuid := '64500000-0000-4000-8000-0000000000a1';
  rechazado boolean := false; n int;
begin
  insert into public.liquidacion_formato_flota (tenant_id, formato, copia_telefonos, discrepancia_telefonos)
  values (t, null, array['525512345678'], array['525512345679']);
  select count(*) into n from public.liquidacion_formato_flota where tenant_id = t and formato is null;
  if n <> 1 then raise exception '0645(a): la fila sin formato debía guardarse'; end if;

  begin
    update public.liquidacion_formato_flota set copia_telefonos = array['123'] where tenant_id = t;
  exception when check_violation then rechazado := true; end;
  if not rechazado then raise exception '0645(b): un teléfono corto debía seguir rechazándose'; end if;
  rechazado := false;
  begin
    update public.liquidacion_formato_flota set copia_telefonos = array['525512345678','525512345679','525512345670','525512345671'] where tenant_id = t;
  exception when check_violation then rechazado := true; end;
  if not rechazado then raise exception '0645(b): más de 3 teléfonos debía seguir rechazándose'; end if;

  rechazado := false;
  begin
    update public.liquidacion_formato_flota set formato = '[1,2]'::jsonb where tenant_id = t;
  exception when check_violation then rechazado := true; end;
  if not rechazado then raise exception '0645(c): un formato que no es objeto debía seguir rechazándose'; end if;
end $$;

alter table public.liquidacion_formato_flota alter column formato drop not null; -- (d)
rollback;
