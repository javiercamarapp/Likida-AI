-- ═══════════════════════════════════════════════════════════════════════════
-- 0636 — Conductor: «sin señal de vida» en tránsito (episodios).
--
-- Si el GPS de un tractor en tránsito queda obsoleto o detenido, el Conductor le pregunta al chofer «¿sigues bien?» con
-- tres botones; si no contesta, un segundo aviso, y después al jefe de tráfico. Un EPISODIO es esa cadena de avisos:
--
--   nivel_enviado   0 = abierto sin avisos · 1 = primer aviso al chofer · 2 = segundo aviso · 3 = escalado al jefe
--
-- Cada paso se RECLAMA con un UPDATE condicional (`nivel_enviado = k-1`): dos corridas solapadas del cron no mandan el
-- mismo aviso dos veces. Un episodio abierto por viaje como máximo (índice único parcial). Cuando el chofer contesta,
-- o el GPS se recupera, el episodio se cierra y `silenciado_hasta` evita que el mismo GPS mudo abra otro enseguida.
--
-- Sin coordenadas ni textos del chofer: solo estados, horas y la respuesta de botón. Lo escribe el servidor.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.viaje_senal_vida (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  viaje_id uuid not null,
  motivo text not null,
  abierto_en timestamptz not null default now(),
  nivel_enviado smallint not null default 0,
  aviso_1_en timestamptz,
  aviso_2_en timestamptz,
  escalado_en timestamptz,
  respondido_en timestamptz,
  respuesta text,
  cerrado_en timestamptz,
  cierre_motivo text,
  silenciado_hasta timestamptz,
  ultimo_error text,
  constraint viaje_senal_vida_viaje_fkey
    foreign key (viaje_id, tenant_id) references public.viaje (id, tenant_id) on delete cascade,
  constraint viaje_senal_vida_motivo_dominio check (motivo in ('gps_obsoleto', 'gps_detenido')),
  constraint viaje_senal_vida_nivel check (nivel_enviado between 0 and 3),
  constraint viaje_senal_vida_respuesta_dominio check (respuesta is null or respuesta in ('estoy', 'voy_a_cargar', 'estoy_bien')),
  constraint viaje_senal_vida_cierre_dominio check (cierre_motivo is null or cierre_motivo in ('respondio', 'senal_recuperada', 'viaje_cerrado', 'atendido_por_jefe')),
  constraint viaje_senal_vida_cierre_completo check ((cerrado_en is null) = (cierre_motivo is null)),
  constraint viaje_senal_vida_error_corto check (ultimo_error is null or char_length(ultimo_error) <= 200)
);
comment on table public.viaje_senal_vida is
  '0636: episodio de «sin señal de vida» de un tractor en tránsito: aviso al chofer (2 niveles) y escalación al jefe de tráfico. Un episodio abierto por viaje; cada nivel se reclama con UPDATE condicional. Sin coordenadas.';

create unique index if not exists viaje_senal_vida_abierto_uq on public.viaje_senal_vida (viaje_id) where cerrado_en is null;
create index if not exists viaje_senal_vida_tenant_idx on public.viaje_senal_vida (tenant_id, abierto_en desc);
create index if not exists viaje_senal_vida_viaje_idx on public.viaje_senal_vida (viaje_id, abierto_en desc);

alter table public.viaje_senal_vida enable row level security;
drop policy if exists tenant_lee on public.viaje_senal_vida;
create policy tenant_lee on public.viaje_senal_vida for select
  using (
    (tenant_id = any(public.get_user_tenant_ids()) and (select public.ve_operacion()))
    or (select public.is_superadmin())
  );
revoke all on table public.viaje_senal_vida from public, anon, authenticated;
grant select on table public.viaje_senal_vida to authenticated;
grant select, insert, update, delete on table public.viaje_senal_vida to service_role;
