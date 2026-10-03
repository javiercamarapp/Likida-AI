-- ═══════════════════════════════════════════════════════════════════════════
-- 0462 — Constancia del FALLO de la invitación al operador.
--
-- LOOP PUNTA A PUNTA, W2 «producto». La 0460 dejó `invitacion_enviada_en` como
-- la constancia del ÉXITO y el envío masivo toma «los pendientes» (enviada NULL).
-- Faltaba el otro lado: un teléfono que Meta rechaza para siempre (número
-- inválido, sin WhatsApp) volvía a ser «pendiente» y, como el envío recorre de a
-- 40, los primeros 40 con fallo permanente bloqueaban para siempre a los demás.
--
-- `invitacion_fallo` guarda el MOTIVO corto y `invitacion_fallo_en` cuándo: un
-- operador con fallo sale de «pendientes» (no se reintenta solo) y aparece en su
-- propia lista con el motivo, para corregir el teléfono o reintentar a mano.
-- O los dos o ninguno (CHECK). Sin teléfono completo ni texto libre del usuario:
-- es el mensaje que Likida arma de la respuesta de Meta.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.operador
  add column if not exists invitacion_fallo text,
  add column if not exists invitacion_fallo_en timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'operador_invitacion_fallo_coherente' and conrelid = 'public.operador'::regclass
  ) then
    alter table public.operador
      add constraint operador_invitacion_fallo_coherente
      check (
        (invitacion_fallo is null) = (invitacion_fallo_en is null)
        and (invitacion_fallo is null or length(invitacion_fallo) between 1 and 200)
        -- un envío exitoso no convive con un fallo vigente
        and (invitacion_fallo is null or invitacion_enviada_en is null)
      );
  end if;
end $$;

comment on column public.operador.invitacion_fallo is
  'Motivo corto por el que Meta rechazó la invitación (0462). NULL = sin fallo. Un operador con fallo no vuelve a «pendientes» solo: se reintenta a mano tras corregir el teléfono.';
comment on column public.operador.invitacion_fallo_en is
  'Cuándo falló la última invitación (0462). Va junto con invitacion_fallo.';

-- Los pendientes de verdad: activos, sin enviar y sin fallo vigente.
drop index if exists public.operador_invitacion_pendiente_idx;
create index if not exists operador_invitacion_pendiente_idx
  on public.operador (tenant_id)
  where activo and invitacion_enviada_en is null and invitacion_fallo_en is null;
