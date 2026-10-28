\set ON_ERROR_STOP on
-- 0938 — CARTA PORTE: modo primer mes y revisores por departamento (OLA1-A3).
--
-- Lo que SOLO la base puede demostrar, contra Postgres real (todo en una transacción revertida):
--   (a) las columnas nuevas nacen apagadas (primer_mes_hasta NULL, revisores []), también en filas que ya existían;
--   (b) el CHECK rechaza un valor que no es arreglo y uno de más de 20 elementos;
--   (c) el permiso sigue siendo solo de service_role (anon/authenticated sin acceso).
-- Datos sintéticos (dominio .invalid).
begin;

insert into public.tenant (id, nombre) values ('93800000-0000-4000-8000-0000000000a1', 'Flota A 0938');
insert into public.cp_salida_config (tenant_id) values ('93800000-0000-4000-8000-0000000000a1');

do $$
declare
  fila record; malo_tipo boolean := false; malo_tope boolean := false;
begin
  select primer_mes_hasta, revisores_departamento into fila from public.cp_salida_config where tenant_id = '93800000-0000-4000-8000-0000000000a1';
  if fila.primer_mes_hasta is not null or fila.revisores_departamento <> '[]'::jsonb then
    raise exception 'PRIMER_MES_0938 las columnas debían nacer apagadas';
  end if;

  update public.cp_salida_config set primer_mes_hasta = date '2026-12-01',
    revisores_departamento = '[{"departamento":"Captura","correo":"revisor@flota.invalid"}]'::jsonb
    where tenant_id = '93800000-0000-4000-8000-0000000000a1';

  begin
    update public.cp_salida_config set revisores_departamento = '{"departamento":"x"}'::jsonb where tenant_id = '93800000-0000-4000-8000-0000000000a1';
  exception when check_violation then malo_tipo := true; end;
  begin
    update public.cp_salida_config set revisores_departamento = (select jsonb_agg(jsonb_build_object('departamento', 'd' || g, 'correo', 'u' || g || '@flota.invalid')) from generate_series(1, 21) g)
      where tenant_id = '93800000-0000-4000-8000-0000000000a1';
  exception when check_violation then malo_tope := true; end;
  if not malo_tipo then raise exception 'PRIMER_MES_0938 un objeto no debía pasar el CHECK'; end if;
  if not malo_tope then raise exception 'PRIMER_MES_0938 21 revisores no debían pasar el CHECK'; end if;
end $$;

do $$
begin
  if has_table_privilege('anon', 'public.cp_salida_config', 'select') or has_table_privilege('authenticated', 'public.cp_salida_config', 'select') then
    raise exception 'PRIMER_MES_0938 anon/authenticated no deben leer cp_salida_config';
  end if;
  if not has_table_privilege('service_role', 'public.cp_salida_config', 'update') then
    raise exception 'PRIMER_MES_0938 service_role debe poder actualizar cp_salida_config';
  end if;
end $$;

rollback;
