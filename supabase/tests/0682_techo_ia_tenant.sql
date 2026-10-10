\set ON_ERROR_STOP on
-- 0682 — fijar_techo_ia_tenant contra Postgres REAL (sintético, rollback).
--   (a) fija con jsonb_set SIN pisar las otras llaves de `tenant.config` y redondea a centavos; devuelve antes/después;
--   (b) null quita SOLO esa llave; una flota sin config (null) también funciona;
--   (c) rango validado EN LA BASE (0.10–1000): 0.09, 1000.01 y negativos rebotan sin tocar nada;
--   (d) flota inexistente → {ok:false, motivo:flota_inexistente}, no lanza;
--   (e) la constraint tenant_config_valida (0278) acepta la llave que la RPC escribe;
--   (f) solo service_role ejecuta.
begin;

insert into public.tenant (id, nombre, config) values
  ('68200000-0000-4000-8000-0000000000a1', 'Flota A 0682', '{"empresa": {"nombre": "Flota A"}}'),
  ('68200000-0000-4000-8000-0000000000b1', 'Flota B 0682', null);

set local role service_role;
do $$
declare r jsonb; c jsonb;
begin
  r := public.fijar_techo_ia_tenant('68200000-0000-4000-8000-0000000000a1', 25.555);
  if r <> '{"ok": true, "antes": null, "despues": 25.56}'::jsonb then raise exception '0682(a): respuesta %', r; end if;
  select config into c from public.tenant where id = '68200000-0000-4000-8000-0000000000a1';
  if c->'presupuestoLlmUsdDia' <> '25.56'::jsonb or c->'empresa'->>'nombre' <> 'Flota A' then raise exception '0682(a): config %', c; end if;
  r := public.fijar_techo_ia_tenant('68200000-0000-4000-8000-0000000000a1', 40);
  if (r->>'antes')::numeric <> 25.56 or (r->>'despues')::numeric <> 40 then raise exception '0682(a): antes/después %', r; end if;

  -- (b) quitar
  r := public.fijar_techo_ia_tenant('68200000-0000-4000-8000-0000000000a1', null);
  select config into c from public.tenant where id = '68200000-0000-4000-8000-0000000000a1';
  if c ? 'presupuestoLlmUsdDia' or c->'empresa'->>'nombre' <> 'Flota A' or (r->>'ok')::boolean is not true then raise exception '0682(b): quitar %, %', r, c; end if;
  -- flota sin config
  r := public.fijar_techo_ia_tenant('68200000-0000-4000-8000-0000000000b1', 12);
  select config into c from public.tenant where id = '68200000-0000-4000-8000-0000000000b1';
  if c <> '{"presupuestoLlmUsdDia": 12}'::jsonb then raise exception '0682(b): flota sin config %', c; end if;

  -- (c) rango
  begin perform public.fijar_techo_ia_tenant('68200000-0000-4000-8000-0000000000b1', 0.09); raise exception '0682(c): aceptó 0.09'; exception when sqlstate 'PU001' then null; end;
  begin perform public.fijar_techo_ia_tenant('68200000-0000-4000-8000-0000000000b1', 1000.01); raise exception '0682(c): aceptó 1000.01'; exception when sqlstate 'PU001' then null; end;
  begin perform public.fijar_techo_ia_tenant('68200000-0000-4000-8000-0000000000b1', -3); raise exception '0682(c): aceptó un negativo'; exception when sqlstate 'PU001' then null; end;
  perform public.fijar_techo_ia_tenant('68200000-0000-4000-8000-0000000000b1', 0.10);
  perform public.fijar_techo_ia_tenant('68200000-0000-4000-8000-0000000000b1', 1000);
  select config into c from public.tenant where id = '68200000-0000-4000-8000-0000000000b1';
  if c->'presupuestoLlmUsdDia' <> '1000'::jsonb then raise exception '0682(c): los extremos válidos no se guardaron: %', c; end if;

  -- (d) flota inexistente
  r := public.fijar_techo_ia_tenant('68200000-0000-4000-8000-0000000000ff', 10);
  if r <> '{"ok": false, "motivo": "flota_inexistente"}'::jsonb then raise exception '0682(d): %', r; end if;
end $$;

reset role;
set local role authenticated;
do $$ begin
  begin perform public.fijar_techo_ia_tenant('68200000-0000-4000-8000-0000000000a1', 10); raise exception '0682(f): authenticated ejecutó la RPC'; exception when insufficient_privilege then null; end;
end $$;
set local role anon;
do $$ begin
  begin perform public.fijar_techo_ia_tenant('68200000-0000-4000-8000-0000000000a1', 10); raise exception '0682(f): anon ejecutó la RPC'; exception when insufficient_privilege then null; end;
end $$;

rollback;
