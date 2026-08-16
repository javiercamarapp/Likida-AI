-- ═══════════════════════════════════════════════════════════════════════════
-- 0124 — La cadencia se vuelve ATÓMICA y el envío aprende «entregado».
-- (Auditoría externa 2, 16-ago-2026 — los puntos 2 y 3 de su prioridad.)
--
-- 1) LA CARRERA REAL: la guardia de 48h hacía SELECT historial → enviar →
--    INSERT historial, con el claim sobre la PIEZA, no sobre el PROSPECTO.
--    Dos piezas distintas aprobadas para el MISMO prospecto podían correr a
--    la vez, ver ambas «cero contactos recientes» y salir las dos. El fix es
--    `reservar_envio_prospecto`: un advisory lock TRANSACCIONAL por
--    prospecto serializa la decisión, y la verificación + el INSERT del
--    contacto (la reserva) ocurren en la MISMA transacción — la segunda
--    pieza ya VE la reserva de la primera y rebota.
--
--    La ventana honesta que queda: si el proceso muere entre la reserva y el
--    proveedor, el contacto reservado BLOQUEA la cadencia 48h de ese
--    prospecto aunque el correo no saliera. Es el lado seguro a propósito
--    (censo finito: mejor un toque de menos que uno de más), y la
--    compensación del código borra la reserva cuando el proveedor rechaza.
--
-- 2) ENTREGA: `provider_message_id` demuestra ACEPTADO por Resend, no
--    entregado. El webhook /api/correo/eventos (Resend → svix) escribe aquí
--    el estado REAL: entregado / rebotado / queja, con su fecha. NULL = sin
--    noticia del proveedor todavía — y la pantalla lo dice así.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.reservar_envio_prospecto(
  p_prospecto uuid,
  p_pieza uuid,
  p_actor uuid,
  p_resumen text,
  p_horas int default 48
) returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  -- El candado POR PROSPECTO, transaccional: se suelta solo al commit/abort.
  -- hashtextextended para 64 bits — menos colisiones que hashtext en un
  -- espacio de uuids (una colisión solo serializa de más, jamás de menos).
  perform pg_advisory_xact_lock(hashtextextended(p_prospecto::text, 0));
  if exists (
    select 1 from public.prospecto_contacto
    where prospecto_id = p_prospecto
      and direccion = 'salida'
      and ocurrio_en >= now() - make_interval(hours => p_horas)
  ) then
    return null;  -- la cadencia lo protege: NO se reserva.
  end if;
  insert into public.prospecto_contacto (prospecto_id, canal, direccion, pieza_id, resumen, actor_id)
    values (p_prospecto, 'correo', 'salida', p_pieza, p_resumen, p_actor)
    returning id into v_id;
  return v_id;
end
$$;

alter function public.reservar_envio_prospecto(uuid, uuid, uuid, text, int)
  set search_path = public;

comment on function public.reservar_envio_prospecto is
  'La decisión de cadencia, atómica (0124): advisory xact lock por prospecto + verificación 48h + INSERT de la reserva en una transacción. NULL = la cadencia bloquea. La compensación (proveedor rechazó) es del código: borra la reserva por id.';

alter table public.cola_aprobacion
  add column if not exists entrega_estado text
    constraint cola_entrega_dominio check (entrega_estado is null or entrega_estado in ('entregado', 'rebotado', 'queja')),
  add column if not exists entrega_evento_en timestamptz;

comment on column public.cola_aprobacion.entrega_estado is
  'Lo que el PROVEEDOR reportó después de aceptar (webhook Resend, 0124): entregado/rebotado/queja. NULL = aceptado sin noticia de entrega todavía — la pantalla lo distingue de "entregado".';
