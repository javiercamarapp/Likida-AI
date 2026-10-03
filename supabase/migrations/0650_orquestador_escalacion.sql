-- ═══════════════════════════════════════════════════════════════════════════
-- 0650 · ORQUESTADOR: LAS ESCALACIONES A UNA PERSONA.
--
-- El asistente del panel (el «orquestador») NO decide temas delicados: una
-- emergencia, una diferencia de liquidación, un cliente molesto, una falla de un
-- agente. Cuando la pregunta cae ahí, deja una TAREA para la persona que sí
-- decide (mesa de control, liquidación, jefe de tráfico, contador) y se lo dice
-- a quien preguntó. Esta tabla es esa tarea: auditable, sin efectos laterales
-- (no manda mensajes, no cambia un viaje, no toca dinero).
--
--   · destino/motivo: dominios CERRADOS (el modelo elige de una lista; el texto
--     libre solo es el `resumen`, acotado y ya sin números largos).
--   · UNA tarea ABIERTA por (flota, destino, motivo, viaje): el índice único
--     parcial hace que preguntar tres veces lo mismo no abra tres tareas; al
--     atenderla, el siguiente incidente SÍ abre una nueva.
--   · FK compuesta (viaje_id, tenant_id): la tarea de una flota no cuelga del
--     viaje de otra (regla 0028/0145, barrida por el bloque 112).
--   · RLS deny-all: solo service_role (el panel lee y escribe con el tenant que
--     la sesión ya fijó; el modelo nunca elige de qué flota).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.orquestador_escalacion (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  creada_en    timestamptz not null default now(),
  destino      text not null,
  motivo       text not null,
  viaje_id     uuid,
  viaje_folio  text,
  resumen      text not null,
  -- Quién le preguntó al asistente (rol de la sesión y su usuario); el modelo no lo elige.
  pedida_por_rol     text not null,
  pedida_por_usuario uuid,
  dedupe_key   text not null,
  estado       text not null default 'abierta',
  atendida_en  timestamptz,
  atendida_por uuid,
  nota_atencion text,

  constraint orquestador_escalacion_id_tenant_key unique (id, tenant_id),
  constraint orquestador_escalacion_destino_dominio
    check (destino in ('mesa_de_control', 'liquidacion', 'jefe_de_trafico', 'contador')),
  constraint orquestador_escalacion_motivo_dominio
    check (motivo in ('operador_sin_respuesta', 'posible_emergencia', 'diferencia_liquidacion', 'cliente_molesto', 'falla_de_agente', 'duda_fiscal', 'otro')),
  constraint orquestador_escalacion_estado_dominio check (estado in ('abierta', 'atendida')),
  constraint orquestador_escalacion_resumen_acotado check (char_length(resumen) between 1 and 300),
  constraint orquestador_escalacion_folio_acotado check (viaje_folio is null or char_length(viaje_folio) <= 40),
  constraint orquestador_escalacion_nota_acotada check (nota_atencion is null or char_length(nota_atencion) <= 300),
  constraint orquestador_escalacion_dedupe_acotado check (char_length(dedupe_key) between 1 and 120),
  -- Atendida ⇔ trae su fecha: una tarea no queda a medias.
  constraint orquestador_escalacion_atencion_coherente check ((estado = 'atendida') = (atendida_en is not null))
);

comment on table public.orquestador_escalacion is
  'Tareas que el asistente del panel deja para una PERSONA (0650). Sin efectos laterales: no manda mensajes ni cambia viajes. Una abierta por (flota, destino, motivo, viaje).';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orquestador_escalacion_viaje_tenant_fkey') then
    alter table public.orquestador_escalacion
      add constraint orquestador_escalacion_viaje_tenant_fkey
      foreign key (viaje_id, tenant_id) references public.viaje (id, tenant_id) on delete set null (viaje_id);
  end if;
end $$;

create unique index if not exists orquestador_escalacion_abierta_idx
  on public.orquestador_escalacion (tenant_id, dedupe_key) where estado = 'abierta';
create index if not exists orquestador_escalacion_por_flota_idx
  on public.orquestador_escalacion (tenant_id, estado, creada_en desc, id);

alter table public.orquestador_escalacion enable row level security;
revoke all on table public.orquestador_escalacion from public, anon, authenticated;
grant select, insert, update, delete on table public.orquestador_escalacion to service_role;
