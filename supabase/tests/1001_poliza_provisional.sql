\set ON_ERROR_STOP on
-- 1001 — póliza provisional: la perilla nace apagada (false) también en filas existentes, se enciende y se apaga, y no admite NULL.
begin;
insert into public.tenant (id, nombre) values ('10010000-0000-4000-8000-0000000000a1', 'Flota 1001');
insert into public.liquidacion_correo_config (tenant_id) values ('10010000-0000-4000-8000-0000000000a1');
do $$
declare t uuid := '10010000-0000-4000-8000-0000000000a1';
begin
  if (select poliza_provisional from public.liquidacion_correo_config where tenant_id = t) is distinct from false then
    raise exception '1001: la perilla no nace apagada';
  end if;
  update public.liquidacion_correo_config set poliza_provisional = true where tenant_id = t;
  if not (select poliza_provisional from public.liquidacion_correo_config where tenant_id = t) then
    raise exception '1001: no se pudo encender';
  end if;
  begin
    update public.liquidacion_correo_config set poliza_provisional = null where tenant_id = t;
    raise exception '1001: aceptó NULL';
  exception when not_null_violation then null;
  end;
end $$;
rollback;
