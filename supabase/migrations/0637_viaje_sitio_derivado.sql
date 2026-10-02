-- ═══════════════════════════════════════════════════════════════════════════
-- 0637 — Sitio del viaje derivado del cliente o del texto de origen/destino.
--
-- La única liga automática viaje→sitio era la del convenio. Un viaje sin convenio quedaba sin sitio, y sin sitio no hay
-- geocerca contra la cual detectar ni validar nada. El Conductor ahora deriva el sitio cuando el nombre del origen o del
-- destino coincide con UN solo sitio activo del catálogo (si hay duda no asigna). Esta tabla guarda QUÉ derivó y por qué:
--
--   · una fila por (viaje, lado): derivar es una sola vez; si la oficina quita o cambia después el sitio, no se vuelve a
--     derivar encima de su decisión;
--   · el criterio queda a la vista (`nombre_exacto`, `nombre_contenido`, `codigo`).
--
-- Sin coordenadas ni datos de personas. Lo escribe el servidor.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.viaje_sitio_derivado (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  viaje_id uuid not null,
  lado text not null,
  geocerca_id uuid,
  criterio text not null,
  derivado_en timestamptz not null default now(),
  constraint viaje_sitio_derivado_unico unique (viaje_id, lado),
  constraint viaje_sitio_derivado_viaje_fkey
    foreign key (viaje_id, tenant_id) references public.viaje (id, tenant_id) on delete cascade,
  constraint viaje_sitio_derivado_sitio_fkey
    foreign key (geocerca_id, tenant_id) references public.geocerca (id, tenant_id) on delete set null (geocerca_id),
  constraint viaje_sitio_derivado_lado_dominio check (lado in ('origen', 'destino')),
  constraint viaje_sitio_derivado_criterio_dominio check (criterio in ('codigo', 'nombre_exacto', 'nombre_contenido'))
);
comment on table public.viaje_sitio_derivado is
  '0637: el sitio que el Conductor asignó solo a un viaje sin convenio (por el texto de origen/destino) y con qué criterio. Una vez por (viaje, lado): no se re-deriva sobre la decisión de la oficina.';
create index if not exists viaje_sitio_derivado_tenant_idx on public.viaje_sitio_derivado (tenant_id, derivado_en desc);

alter table public.viaje_sitio_derivado enable row level security;
drop policy if exists tenant_lee on public.viaje_sitio_derivado;
create policy tenant_lee on public.viaje_sitio_derivado for select
  using (
    (tenant_id = any(public.get_user_tenant_ids()) and (select public.ve_operacion()))
    or (select public.is_superadmin())
  );
revoke all on table public.viaje_sitio_derivado from public, anon, authenticated;
grant select on table public.viaje_sitio_derivado to authenticated;
grant select, insert, update, delete on table public.viaje_sitio_derivado to service_role;
