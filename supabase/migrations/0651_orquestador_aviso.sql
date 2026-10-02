-- ═══════════════════════════════════════════════════════════════════════════
-- 0651 · ORQUESTADOR VIVO (1/2): LA ESCALACIÓN AHORA AVISA.
--
-- Hasta la 0650 la tarea que el asistente deja para una persona solo existía en una
-- tabla: nadie se enteraba si no abría el tablero. Ahora hay un aviso saliente
-- (correo, apagado por defecto, por flota) y esta migración le da dónde guardarse:
--
--   · `agente_definicion` ya conoce al agente `orquestador` (la FK de las tablas de
--     notificaciones lo exige, igual que carta_porte en la 0204).
--   · `orquestador_escalacion` lleva el ESTADO DEL AVISO por tarea: pendiente → enviado,
--     omitido (apagado, sin canal o sin destinatario: se dice y no se reintenta) o
--     agotado (3 intentos fallidos). El claim es un UPDATE condicional sobre
--     (aviso_estado, aviso_reclamado_en): dos procesos no mandan dos correos.
--   · Un índice parcial para el barrido: solo lo abierto y pendiente.
--
-- Idempotente. Sin esta migración el código lo dice (columna inexistente → no avisa y
-- lo registra) y la tarea sigue funcionando como hasta hoy.
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.agente_definicion (id, nombre, departamento, disparador, estado, descripcion) values
  ('orquestador', 'Asistente del panel', 'producto', 'cron', 'vivo',
   'Responde preguntas de solo lectura sobre la operación y, si algo es delicado, deja una tarea para una persona. Barre la salud de los agentes y avisa (apagado por defecto) cuando una tarea espera. No decide, no manda mensajes a terceros y no toca dinero.')
on conflict (id) do nothing;

alter table public.orquestador_escalacion add column if not exists aviso_estado text not null default 'pendiente';
alter table public.orquestador_escalacion add column if not exists aviso_intentos integer not null default 0;
alter table public.orquestador_escalacion add column if not exists aviso_reclamado_en timestamptz;
alter table public.orquestador_escalacion add column if not exists avisada_en timestamptz;
alter table public.orquestador_escalacion add column if not exists aviso_detalle text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orquestador_escalacion_aviso_estado_dominio') then
    alter table public.orquestador_escalacion
      add constraint orquestador_escalacion_aviso_estado_dominio check (aviso_estado in ('pendiente', 'enviado', 'omitido', 'agotado'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orquestador_escalacion_aviso_intentos_rango') then
    alter table public.orquestador_escalacion
      add constraint orquestador_escalacion_aviso_intentos_rango check (aviso_intentos between 0 and 10);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orquestador_escalacion_aviso_detalle_acotado') then
    alter table public.orquestador_escalacion
      add constraint orquestador_escalacion_aviso_detalle_acotado check (aviso_detalle is null or char_length(aviso_detalle) <= 200);
  end if;
  -- Enviado ⇔ trae su fecha: un aviso no queda a medias.
  if not exists (select 1 from pg_constraint where conname = 'orquestador_escalacion_aviso_coherente') then
    alter table public.orquestador_escalacion
      add constraint orquestador_escalacion_aviso_coherente check ((aviso_estado = 'enviado') = (avisada_en is not null));
  end if;
end $$;

create index if not exists orquestador_escalacion_aviso_pendiente_idx
  on public.orquestador_escalacion (creada_en, id) where estado = 'abierta' and aviso_estado = 'pendiente';

comment on column public.orquestador_escalacion.aviso_estado is
  '0651: estado del aviso saliente de la tarea. pendiente → enviado | omitido (apagado, sin canal o sin destinatario) | agotado (3 intentos). El claim es un UPDATE condicional.';
