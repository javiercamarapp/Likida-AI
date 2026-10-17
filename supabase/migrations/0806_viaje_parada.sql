-- ═══════════════════════════════════════════════════════════════════════════
-- 0806 — CONDUCTOR (T-A5-38): la PARADA que inicia el chofer, con su motivo.
--
-- Hasta hoy el módulo solo conocía los cinco hitos del ciclo. Una parada (tráfico, descanso, pernocta, retén, avería) NO es un hito:
-- es un episodio con inicio, fin y motivo que el chofer abre con el botón/texto «parada» y cierra con «ya continúo». Esta tabla es
-- su registro; no cambia el ciclo de hitos ni dispara escalamiento por sí sola.
--
--   · `motivo` es un vocabulario cerrado (CHECK): trafico, descanso, pernocta, reten, averia, otro.
--   · `origen` es quién escribió el estado actual de la fila: `chofer` (botón o texto) o `sistema` (cierre automático al liquidar
--     el viaje). Un episodio abierto por una detección propia del sistema lo abre el chofer al contestar el motivo: no hay un
--     origen «gps».
--   · UNA parada abierta por viaje como máximo (índice único parcial `fin is null`): «parada» dos veces no abre dos.
--   · `fin >= inicio` (CHECK).
--   · Al pasar el viaje a `liquidado`, un trigger cierra la parada abierta con `fin = now()` (nunca antes de `inicio`) y
--     `origen = 'sistema'`: así una parada olvidada no queda abierta para siempre, la cierre quien la cierre.
--
-- Solo aditiva e idempotente (create ... if not exists, drop ... if exists). Sin datos personales: ni teléfonos ni coordenadas ni
-- texto libre del chofer. FK compuesta (viaje_id, tenant_id) como el resto de las tablas del módulo (0380); RLS con la misma
-- política de lectura que `sitio_equivalencia` (0803); la escritura solo la hace el servidor.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.viaje_parada (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  viaje_id uuid not null,
  inicio timestamptz not null default now(),
  fin timestamptz,
  motivo text not null,
  origen text not null default 'chofer',
  created_at timestamptz not null default now(),
  constraint viaje_parada_viaje_tenant_fkey
    foreign key (viaje_id, tenant_id) references public.viaje (id, tenant_id) on delete cascade,
  constraint viaje_parada_motivo_dominio check (motivo in ('trafico', 'descanso', 'pernocta', 'reten', 'averia', 'otro')),
  constraint viaje_parada_origen_dominio check (origen in ('chofer', 'sistema')),
  constraint viaje_parada_fin_posterior check (fin is null or fin >= inicio)
);
comment on table public.viaje_parada is
  '0806: parada iniciada por el chofer con motivo (trafico|descanso|pernocta|reten|averia|otro). No es un hito del ciclo ni escala por sí sola. Una abierta (fin nulo) por viaje. Sin datos personales.';
comment on column public.viaje_parada.origen is
  'Quién escribió el estado actual: chofer (botón o texto) o sistema (cierre automático al liquidar el viaje).';

-- Una sola parada abierta por viaje.
create unique index if not exists viaje_parada_abierta_unica
  on public.viaje_parada (viaje_id) where fin is null;
create index if not exists viaje_parada_tenant_idx
  on public.viaje_parada (tenant_id, inicio desc);

alter table public.viaje_parada enable row level security;
drop policy if exists tenant_lee on public.viaje_parada;
create policy tenant_lee on public.viaje_parada for select
  using (
    (tenant_id = any(public.get_user_tenant_ids()) and (select public.ve_operacion()))
    or (select public.is_superadmin())
  );
revoke all on table public.viaje_parada from public, anon, authenticated;
grant select on table public.viaje_parada to authenticated;
grant select, insert, update, delete on table public.viaje_parada to service_role;

-- Al liquidar el viaje, la parada que siguiera abierta se cierra sola (origen sistema).
create or replace function public.viaje_parada_cerrar_al_liquidar()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.estatus = 'liquidado' and old.estatus is distinct from 'liquidado' then
    update public.viaje_parada
       set fin = greatest(inicio, clock_timestamp()), origen = 'sistema'
     where viaje_id = new.id and tenant_id = new.tenant_id and fin is null;
  end if;
  return new;
end;
$$;
revoke all on function public.viaje_parada_cerrar_al_liquidar() from public, anon, authenticated;

drop trigger if exists viaje_parada_cerrar_al_liquidar on public.viaje;
create trigger viaje_parada_cerrar_al_liquidar
  after update of estatus on public.viaje
  for each row execute function public.viaje_parada_cerrar_al_liquidar();
