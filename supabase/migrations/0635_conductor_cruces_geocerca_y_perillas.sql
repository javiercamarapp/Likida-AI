-- ═══════════════════════════════════════════════════════════════════════════
-- 0635 — Conductor: hitos detectados por geocerca (cruces) y las perillas de P2 por flota.
--
-- El pedido del cliente: que el sistema detecte por geocerca que el tractor llegó o salió SIN que el chofer escriba nada.
-- El barrido del cron compara las posiciones del GPS contra el sitio del viaje y, cuando el tractor entra o sale, registra el
-- hito con fuente `sistema` (la 0380 ya la admite) y lo valida con el GPS.
--
-- 1. `viaje_cruce_geocerca`: UNA detección por (viaje, hito). Es el claim anti-duplicado y la bitácora de por qué el sistema
--    dio ese hito por hecho (sitio, hora de la muestra que lo prueba, distancia). Si una persona corrige después ese hito,
--    el barrido NO lo vuelve a detectar: la fila sigue ahí. Sin coordenadas: solo el sitio, la hora y la distancia.
--    `completado_en` NULL = reclamado y todavía sin registrar el hito (la corrida murió a media): el barrido lo retoma
--    pasado un rato.
-- 2. `detectar_hitos_gps` (ENCENDIDO por omisión: solo actúa donde el viaje tiene sitio y la unidad reporta GPS) y
--    `avisar_senal_vida` (APAGADO por omisión: manda mensajes a personas; lo enciende cada flota).
--
-- Aditiva e idempotente. El código lee la fila completa y trata una columna o tabla ausente como el valor por omisión:
-- contra la base sin migrar la detección sigue funcionando (la transición condicional del hito es el candado) y el aviso
-- de señal de vida queda apagado.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.agente_conductor_config
  add column if not exists detectar_hitos_gps boolean not null default true,
  add column if not exists avisar_senal_vida boolean not null default false;

comment on column public.agente_conductor_config.detectar_hitos_gps is
  '0635: registrar por GPS que el tractor llegó o salió del sitio del viaje (hito con fuente sistema, validado por gps) sin esperar al chofer. Encendido por omisión; solo actúa con sitio asignado y GPS de la unidad.';
comment on column public.agente_conductor_config.avisar_senal_vida is
  '0635: si el GPS de un tractor en tránsito queda obsoleto o detenido, preguntarle al chofer «¿sigues bien?» (dos avisos) y después al jefe de tráfico. Apagado por omisión.';

create table if not exists public.viaje_cruce_geocerca (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  viaje_id uuid not null,
  geocerca_id uuid,
  hito_tipo text not null,
  tipo text not null,
  /** La hora de la muestra de GPS que prueba el cruce (no la de la corrida). */
  detectado_en timestamptz not null,
  distancia_m integer,
  registrado_en timestamptz not null default now(),
  /** NULL = reclamado y sin terminar. */
  completado_en timestamptz,
  constraint viaje_cruce_geocerca_unico unique (viaje_id, hito_tipo),
  constraint viaje_cruce_geocerca_viaje_fkey
    foreign key (viaje_id, tenant_id) references public.viaje (id, tenant_id) on delete cascade,
  constraint viaje_cruce_geocerca_sitio_fkey
    foreign key (geocerca_id, tenant_id) references public.geocerca (id, tenant_id) on delete set null (geocerca_id),
  constraint viaje_cruce_geocerca_hito_dominio check (hito_tipo in ('llegada_carga', 'salida_carga', 'llegada_descarga', 'salida_descarga')),
  constraint viaje_cruce_geocerca_tipo_dominio check (tipo in ('entrada', 'salida')),
  constraint viaje_cruce_geocerca_tipo_pareja check ((tipo = 'entrada') = (hito_tipo like 'llegada%')),
  constraint viaje_cruce_geocerca_distancia check (distancia_m is null or distancia_m >= 0)
);
comment on table public.viaje_cruce_geocerca is
  '0635: un hito dado por hecho porque el GPS entró o salió del sitio del viaje. Una fila por (viaje, hito): es el claim anti-duplicado y la bitácora de la detección. Sin coordenadas.';
create index if not exists viaje_cruce_geocerca_tenant_idx on public.viaje_cruce_geocerca (tenant_id, registrado_en desc);

alter table public.viaje_cruce_geocerca enable row level security;
drop policy if exists tenant_lee on public.viaje_cruce_geocerca;
create policy tenant_lee on public.viaje_cruce_geocerca for select
  using (
    (tenant_id = any(public.get_user_tenant_ids()) and (select public.ve_operacion()))
    or (select public.is_superadmin())
  );
revoke all on table public.viaje_cruce_geocerca from public, anon, authenticated;
grant select on table public.viaje_cruce_geocerca to authenticated;
grant select, insert, update, delete on table public.viaje_cruce_geocerca to service_role;
