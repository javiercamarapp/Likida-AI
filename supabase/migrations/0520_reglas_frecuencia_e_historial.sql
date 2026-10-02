-- ═══════════════════════════════════════════════════════════════════════════
-- 0520 · «MIS REGLAS» (Agente 13): LÍMITE DE FRECUENCIA POR REGLA E HISTORIAL
--       DE AVISOS (loop punta a punta, ola 3).
--
-- Lo que faltaba tras la 0229 (auditoría 6-7-9-10-12-13, §6):
--
--   1. FRECUENCIA. El barrido corre cada hora y manda UN mensaje por regla con
--      los casos nuevos; nada impedía que una regla con casos nuevos cada hora
--      mandara 24 WhatsApps al día, que es la forma más rápida de entrenar al
--      jefe a ignorar el canal. Ahora cada regla trae su propio techo: máximo
--      de avisos en 24 h y separación mínima entre dos avisos. Lo que no se
--      avisa por frecuencia NO se sella: se acumula y sale en el siguiente
--      aviso permitido (un caso diferido no es un caso perdido).
--
--   2. HISTORIAL DE DISPAROS. `regla_disparo` guarda qué OBJETOS ya se avisaron
--      (el sello anti-spam) pero no los MENSAJES: no decía cuándo salió cada
--      aviso, por qué canal (texto o plantilla), ni cuándo FALLÓ uno. `regla_aviso`
--      es esa bitácora: una fila por intento de aviso, enviado o fallido. Es la
--      fuente del tope de frecuencia y de la pantalla «Historial».
--
-- CHECK: esta migración NO reescribe ningún CHECK existente (solo agrega los
-- suyos), así que no pisa valores de otras ramas (cron_latido, modelo_rol).
-- RLS: igual que la 0229 — deny-all con service_role; el servidor filtra por
-- tenant en cada consulta.
-- RETENCIÓN: `regla_aviso` es bitácora de operación (cuántos avisos y cuándo, el
-- error de Meta en palabras); el barrido de reglas borra lo de más de 365 días
-- (`purgarAvisosViejos`, en la misma corrida que lo escribe).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. El límite de frecuencia, en la regla ────────────────────────────────
alter table public.regla_vigilancia
  add column if not exists max_avisos_dia smallint not null default 4,
  add column if not exists min_horas_entre_avisos smallint not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'regla_vigilancia_max_avisos_dia_rango') then
    alter table public.regla_vigilancia
      add constraint regla_vigilancia_max_avisos_dia_rango
      check (max_avisos_dia between 1 and 24);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'regla_vigilancia_min_horas_rango') then
    alter table public.regla_vigilancia
      add constraint regla_vigilancia_min_horas_rango
      check (min_horas_entre_avisos between 0 and 168);
  end if;
end $$;

comment on column public.regla_vigilancia.max_avisos_dia is
  'Tope de AVISOS (mensajes de WhatsApp, no casos) que esta regla puede mandar en una ventana móvil de 24 h. Entre 1 y 24. Lo que excede NO se pierde: no se sella y sale en el siguiente aviso permitido.';
comment on column public.regla_vigilancia.min_horas_entre_avisos is
  'Separación mínima, en horas, entre dos avisos de esta regla. 0 = sin separación (solo manda el tope diario). Máximo 168 (una semana).';

-- ── 2. La bitácora de avisos ───────────────────────────────────────────────
create table if not exists public.regla_aviso (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  regla_id    uuid not null,
  enviado_en  timestamptz not null default now(),
  -- 'enviado' = Meta ACEPTÓ el mensaje (aceptado ≠ entregado). 'fallido' = no
  -- salió; el motivo va en `error` y los casos NO se sellaron (se reintentan).
  resultado   text not null,
  -- Cuántos casos nuevos traía el aviso.
  casos       integer not null,
  -- Por qué canal salió: texto/botones dentro de la ventana de 24 h, plantilla fuera.
  via         text,
  -- El motivo del selector (`ventana_cerrada`, `ventana_abierta`, …) o el error.
  motivo      text,
  error       text,

  constraint regla_aviso_regla_tenant_fkey
    foreign key (regla_id, tenant_id) references public.regla_vigilancia (id, tenant_id)
    on delete cascade,
  constraint regla_aviso_resultado_dominio check (resultado in ('enviado', 'fallido')),
  constraint regla_aviso_via_dominio check (via is null or via in ('texto', 'botones', 'plantilla')),
  constraint regla_aviso_casos_sanos check (casos >= 1 and casos <= 100000),
  constraint regla_aviso_textos_acotados check (
    (motivo is null or char_length(motivo) <= 300) and (error is null or char_length(error) <= 300)
  ),
  -- Un aviso enviado dice por qué canal salió; uno fallido no tiene canal.
  constraint regla_aviso_via_coherente check (
    (resultado = 'enviado' and via is not null) or (resultado = 'fallido' and via is null)
  )
);

comment on table public.regla_aviso is
  'Historial de avisos de «Mis reglas» (0520): una fila por intento de aviso de una regla, enviado o fallido. Alimenta el tope de frecuencia (cuántos avisos salieron en 24 h) y la pantalla «Historial». Distinta de regla_disparo, que sella QUÉ OBJETOS ya se avisaron.';
comment on column public.regla_aviso.resultado is
  'enviado = Meta aceptó el mensaje; fallido = no salió y los casos quedaron sin sellar para reintentarse. Solo los enviados cuentan para el tope de frecuencia.';

create index if not exists regla_aviso_por_regla_idx
  on public.regla_aviso (tenant_id, regla_id, enviado_en desc);
create index if not exists regla_aviso_retencion_idx
  on public.regla_aviso (enviado_en);

alter table public.regla_aviso enable row level security;
revoke all on table public.regla_aviso from public, anon, authenticated;
grant select, insert, update, delete on table public.regla_aviso to service_role;
