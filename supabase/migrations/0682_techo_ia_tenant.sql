-- 0682 — EL TECHO DIARIO DE IA POR FLOTA, EDITABLE DESDE LA PANTALLA (Ola 9, seguridad; pantalla /admin/techo-ia).
--
-- El techo diario de gasto de IA de una flota se declara en `tenant.config.presupuestoLlmUsdDia` (0278) y
-- hasta hoy solo se podía mover a mano en SQL. La pantalla del superadmin lo escribe por esta RPC, que:
--   · valida el rango EN LA BASE (0.10 a 1,000 USD/día; null quita la declaración y la flota vuelve a su
--     plan o al piso), así que un cliente que se salte la validación de la pantalla no puede fijar 1e9;
--   · cambia SOLO esa llave con `jsonb_set` / `-` (atómico: no pisa otras llaves de `config` que otra
--     escritura concurrente haya tocado, que es lo que haría un leer-modificar-escribir desde el servidor);
--   · devuelve el valor anterior y el nuevo para que la bitácora diga qué cambió.
-- Solo service_role (el servidor, tras exigir superadmin con MFA). Idempotente.
begin;

create or replace function public.fijar_techo_ia_tenant(p_tenant uuid, p_usd numeric)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_antes jsonb;
begin
  if p_usd is not null and (p_usd < 0.10 or p_usd > 1000) then
    raise exception 'el techo diario de IA debe estar entre 0.10 y 1000 USD (o null para quitarlo)' using errcode = 'PU001';
  end if;
  select config -> 'presupuestoLlmUsdDia' into v_antes from tenant where id = p_tenant for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'flota_inexistente');
  end if;
  if p_usd is null then
    update tenant set config = coalesce(config, '{}'::jsonb) - 'presupuestoLlmUsdDia' where id = p_tenant;
  else
    update tenant set config = jsonb_set(coalesce(config, '{}'::jsonb), '{presupuestoLlmUsdDia}', to_jsonb(round(p_usd, 2)), true) where id = p_tenant;
  end if;
  return jsonb_build_object('ok', true, 'antes', v_antes, 'despues', case when p_usd is null then null else to_jsonb(round(p_usd, 2)) end);
end $$;

comment on function public.fijar_techo_ia_tenant(uuid, numeric) is
  '0682: fija (0.10-1000 USD/día) o quita (null) tenant.config.presupuestoLlmUsdDia con jsonb_set atómico, sin pisar otras llaves. Devuelve {ok, antes, despues}. Solo service_role; la pantalla /admin/techo-ia la llama tras exigir superadmin con MFA.';
revoke all on function public.fijar_techo_ia_tenant(uuid, numeric) from public, anon, authenticated;
grant execute on function public.fijar_techo_ia_tenant(uuid, numeric) to service_role;

commit;
