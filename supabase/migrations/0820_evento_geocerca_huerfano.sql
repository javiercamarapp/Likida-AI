-- ═══════════════════════════════════════════════════════════════════════════
-- 0820 — CONDUCTOR (T-A5-66): eventos de geocerca SIN viaje abierto, guardados como huérfanos y reconciliados después.
--
-- Hoy el barrido por geocerca parte de los viajes abiertos: si el viaje ya se cerró (o todavía no existe) cuando la unidad entra o
-- sale de un sitio conocido, la llegada o la salida se pierde («el sistema ya no encuentra un viaje abierto»). Esta tabla guarda ese
-- cruce —unidad, sitio, entrada|salida, hora de la muestra de GPS y, si el proveedor la etiquetó, la referencia de despacho— para
-- que, al aparecer o reabrirse el viaje, los hitos se creen sin duplicar (la reconciliación reutiliza el claim `viaje_cruce_geocerca`).
--
--   · Una fila por (flota, unidad, sitio, tipo, hora): guardar dos veces el mismo cruce no duplica.
--   · `reconciliado_en` / `viaje_id` quedan puestos cuando el evento ya se aplicó a un viaje; la fila sigue como constancia hasta
--     que vence la retención (30 días por omisión, mínimo 7): `purgar_eventos_geocerca_huerfanos` la borra.
--   · SIN coordenadas: solo el sitio del catálogo, la hora y el sentido. Nunca envía mensajes a nadie.
--   · Por flota nace APAGADO: `registrar_geocerca_huerfana` (false) en `agente_conductor_config`.
--
-- Solo aditiva e idempotente (create … if not exists, drop … if exists). Nace vacía. RLS con la misma política de lectura que
-- `viaje_cruce_geocerca` (0635); la escritura solo la hace el servidor.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.agente_conductor_config
  add column if not exists registrar_geocerca_huerfana boolean not null default false;
comment on column public.agente_conductor_config.registrar_geocerca_huerfana is
  '0820: guardar como huerfanos los cruces de geocerca de unidades sin viaje abierto y reconciliarlos cuando el viaje aparece. Apagado por omision.';

create table if not exists public.evento_geocerca_huerfano (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  unidad_id uuid not null,
  geocerca_id uuid not null,
  tipo text not null,
  /** La hora de la muestra de GPS que prueba el cruce (no la de la corrida). */
  en timestamptz not null,
  /** Distancia (m) de esa muestra al centro del sitio; con ella el hito reconciliado se valida como el detectado en vivo. */
  distancia_m integer,
  /** La referencia de despacho (0802, ya normalizada) con la que el proveedor etiquetó la posición, si la trae. */
  despacho_ref text,
  reconciliado_en timestamptz,
  viaje_id uuid,
  created_at timestamptz not null default now(),
  constraint evento_geocerca_huerfano_unidad_fkey
    foreign key (unidad_id, tenant_id) references public.unidad (id, tenant_id) on delete cascade,
  constraint evento_geocerca_huerfano_sitio_fkey
    foreign key (geocerca_id, tenant_id) references public.geocerca (id, tenant_id) on delete cascade,
  constraint evento_geocerca_huerfano_viaje_fkey
    foreign key (viaje_id, tenant_id) references public.viaje (id, tenant_id) on delete set null (viaje_id),
  constraint evento_geocerca_huerfano_tipo_dominio check (tipo in ('entrada', 'salida')),
  constraint evento_geocerca_huerfano_distancia check (distancia_m is null or distancia_m >= 0),
  constraint evento_geocerca_huerfano_ref_largo check (despacho_ref is null or char_length(despacho_ref) between 1 and 80),
  constraint evento_geocerca_huerfano_unico unique (tenant_id, unidad_id, geocerca_id, tipo, en)
);
comment on table public.evento_geocerca_huerfano is
  '0820: cruce de geocerca de una unidad sin viaje abierto que lo ligue. Se reconcilia al aparecer el viaje (hitos sin duplicar). Retencion 30 dias. Sin coordenadas.';
create index if not exists evento_geocerca_huerfano_pendientes
  on public.evento_geocerca_huerfano (tenant_id, unidad_id, en) where reconciliado_en is null;
create index if not exists evento_geocerca_huerfano_retencion
  on public.evento_geocerca_huerfano (en);

alter table public.evento_geocerca_huerfano enable row level security;
drop policy if exists tenant_lee on public.evento_geocerca_huerfano;
create policy tenant_lee on public.evento_geocerca_huerfano for select
  using (
    (tenant_id = any(public.get_user_tenant_ids()) and (select public.ve_operacion()))
    or (select public.is_superadmin())
  );
revoke all on table public.evento_geocerca_huerfano from public, anon, authenticated;
grant select on table public.evento_geocerca_huerfano to authenticated;
grant select, insert, update, delete on table public.evento_geocerca_huerfano to service_role;

-- Retención: borra los eventos cuya hora de cruce es más vieja que `p_dias` (mínimo 7). Devuelve cuántos borró.
create or replace function public.purgar_eventos_geocerca_huerfanos(
  p_dias integer default 30, p_limite integer default 5000
) returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_n integer;
begin
  if p_dias is null or p_dias < 7 or p_limite is null or p_limite < 1 then
    raise exception 'parámetros de retención inválidos';
  end if;
  with viejos as (
    select id from public.evento_geocerca_huerfano
     where en < now() - make_interval(days => p_dias)
     order by en limit p_limite for update
  )
  delete from public.evento_geocerca_huerfano e using viejos v where e.id = v.id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.purgar_eventos_geocerca_huerfanos(integer, integer) from public, anon, authenticated;
grant execute on function public.purgar_eventos_geocerca_huerfanos(integer, integer) to service_role;
