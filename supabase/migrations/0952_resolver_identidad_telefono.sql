-- REVERSA: `drop function if exists public.resolver_identidad_telefono(text);` El código (src/lib/likida/identidad_telefono.ts) trata la función ausente (42883 / PGRST202) como «base sin migrar» y sigue por el camino anterior; no hay datos que reponer.
-- ═══════════════════════════════════════════════════════════════════════════
-- 0952 — F1 lote B, L1H (CT-SEG-07 / X-01): resolutor de identidad por teléfono que NO adivina.
--
-- Hoy el bot resuelve primero `operador` y, si no hay, `app_user`: cada una con su propio `.limit(2)` y sin ver a la otra.
-- Un número que es operador activo en la flota A y cuenta de oficina en la flota B resolvía en silencio a la flota A.
-- Esta función mira LAS TRES tablas a la vez y devuelve SIEMPRE una sola fila con el veredicto:
--
--   ninguna      0 identidades activas con ese número.
--   unica        exactamente 1: tipo, tenant_id y ref_id vienen llenos.
--   misma_flota  varias identidades pero TODAS de una sola flota: tenant_id viene lleno, ref_id no (el llamador decide el
--                rol con su orden de siempre; la flota no está en duda).
--   ambigua      identidades en más de una flota: NADA viene lleno (ni tenant ni ref). El llamador falla cerrado.
--
-- Solo lectura. SECURITY INVOKER (la ejecuta service_role, que no pasa por RLS) con search_path fijo; EXECUTE solo a
-- service_role. Sin tabla nueva ni fila escrita.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.resolver_identidad_telefono(p_telefono text)
returns table (resultado text, tipo text, tenant_id uuid, ref_id uuid, filas integer, flotas integer)
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  v_canon text := public.telefono_canonico(p_telefono);
  v_filas integer;
  v_flotas integer;
  v_tenant uuid;
  v_tipo text;
  v_ref uuid;
begin
  if v_canon is null then
    return query select 'ninguna'::text, null::text, null::uuid, null::uuid, 0, 0;
    return;
  end if;

  select count(*)::integer,
         count(distinct coalesce(i.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid))::integer,
         min(i.tenant_id::text)::uuid,
         min(i.tabla),
         min(i.ref_id::text)::uuid
    into v_filas, v_flotas, v_tenant, v_tipo, v_ref
    from public.telefono_identidades(v_canon) i;

  if v_filas = 0 then
    return query select 'ninguna'::text, null::text, null::uuid, null::uuid, 0, 0;
  elsif v_flotas > 1 then
    return query select 'ambigua'::text, null::text, null::uuid, null::uuid, v_filas, v_flotas;
  elsif v_filas = 1 then
    return query select 'unica'::text, v_tipo, v_tenant, v_ref, v_filas, v_flotas;
  else
    return query select 'misma_flota'::text, null::text, v_tenant, null::uuid, v_filas, v_flotas;
  end if;
end;
$$;

comment on function public.resolver_identidad_telefono(text) is
  '0952: veredicto de identidad por teléfono sobre operador, app_user y vigia_contacto activos: ninguna | unica | misma_flota | ambigua. Nunca elige entre flotas: ante ambigüedad no devuelve ni tenant ni ref. Solo lectura, solo service_role.';

revoke all on function public.resolver_identidad_telefono(text) from public, anon, authenticated;
grant execute on function public.resolver_identidad_telefono(text) to service_role;
