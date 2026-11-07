-- 0984 — Guía de onboarding: eventos de aprendizaje SIN datos personales (SPEC-ONBOARDING-GUIA 2.8).
--
-- `actor` es un seudónimo (HMAC de 16 hex calculado en el servidor con un secreto que ya existe): no es reversible sin el secreto.
-- NO hay correo, nombre, IP, user agent ni texto libre; `tipo` es una lista cerrada por CHECK; `valor_*` son numéricos.
-- La tabla nace vacía. El envío de eventos está apagado en el código (constante GUIA_EVENTOS) hasta que el aviso de privacidad
-- lo mencione (D-OB-8), así que esta migración por sí sola no recibe datos.
-- Retención: 180 días; la función `podar_onboarding_evento` la ejecuta el cron diario o, mientras no esté cableada, una sentencia
-- manual (`select public.podar_onboarding_evento();`).
--
-- SEGURIDAD: RLS prendida sin políticas, `revoke all` a public/anon/authenticated, `grant` solo a service_role; la función es
-- security definer con search_path fijo y ejecutable solo por service_role.
--
-- REVERSA: drop function if exists public.podar_onboarding_evento(integer);
--          drop table if exists public.onboarding_evento;
begin;

create table if not exists public.onboarding_evento (
  id        bigint generated always as identity primary key,
  tenant_id uuid    not null references public.tenant(id) on delete cascade,
  actor     text    not null,
  pista     text    not null,
  rol       text    not null,
  perfil    text,
  tipo      text    not null,
  recorrido text,
  paso_id   text,
  valor_ms  integer,
  valor_n   integer,
  canal     text    not null,
  reducido  boolean not null default false,
  creado_en timestamptz not null default now(),
  constraint onboarding_evento_tipo check (tipo in (
    'invitacion_vista', 'invitacion_ahora_no', 'invitacion_descartada', 'guia_inicio', 'paso_visto', 'paso_hecho_senal',
    'paso_hecho_confirmado', 'paso_ya_hecho', 'paso_omitido', 'paso_sin_dato', 'guia_abandono', 'guia_terminada', 'tarea_lograda',
    'repeticion', 'retomar', 'ayuda_abierta', 'demo_vista', 'demo_pausa', 'simulacro_enviado')),
  constraint onboarding_evento_canal check (canal in ('movil', 'escritorio')),
  constraint onboarding_evento_actor check (actor ~ '^[0-9a-f]{16}$'),
  constraint onboarding_evento_largos check (
    char_length(pista) <= 40 and char_length(rol) <= 40 and char_length(coalesce(perfil, '')) <= 40
    and char_length(coalesce(recorrido, '')) <= 80 and char_length(coalesce(paso_id, '')) <= 40),
  constraint onboarding_evento_valores check (coalesce(valor_ms, 0) >= 0 and coalesce(valor_n, 0) >= 0)
);

create index if not exists onboarding_evento_tenant_creado_idx on public.onboarding_evento (tenant_id, creado_en);
create index if not exists onboarding_evento_paso_tipo_idx on public.onboarding_evento (paso_id, tipo);

comment on table public.onboarding_evento is
  '0984: medición de uso de la guía con actor seudónimo (hmac, 16 hex). Sin PII ni texto libre. Retención 180 días. Solo service_role.';

alter table public.onboarding_evento enable row level security;
revoke all on table public.onboarding_evento from public, anon, authenticated;
grant select, insert, delete on table public.onboarding_evento to service_role;

create or replace function public.podar_onboarding_evento(p_dias integer default 180)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_n integer;
begin
  delete from public.onboarding_evento where creado_en < now() - make_interval(days => greatest(coalesce(p_dias, 180), 30));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.podar_onboarding_evento(integer) from public, anon, authenticated;
grant execute on function public.podar_onboarding_evento(integer) to service_role;

commit;
