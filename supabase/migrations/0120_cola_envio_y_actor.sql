-- ═══════════════════════════════════════════════════════════════════════════
-- 0120 — La cola aprende a ENVIAR de verdad, y la resolución exige actor.
--
-- Dos hallazgos de la auditoría externa (16-ago-2026) sobre la 0117:
--
--  P1: "aprobada" era el final del camino — marcarEnviada solo estampaba la
--      fecha, ningún código mandaba el correo. Estas columnas son el rastro
--      del envío REAL: `provider_message_id` es la prueba de que Resend lo
--      aceptó (que NO es "el prospecto lo recibió" — el tracking de
--      delivery/bounce es la siguiente capa, declarada, no fingida), y
--      `envio_error` el porqué cuando no salió.
--
--  P2: el comentario de la 0117 prometía "fecha y actor" pero el CHECK solo
--      exigía fecha — a nivel esquema podía existir una pieza aprobada por
--      nadie. El actor ahora es un SNAPSHOT inmutable del email (el mismo
--      patrón que bitacora_auditoria.actor_email): sobrevive al borrado de
--      la cuenta (la FK resuelto_por sigue SET NULL para ARCO) y el CHECK
--      lo exige en los dos sentidos.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.cola_aprobacion
  add column if not exists provider_message_id text,
  add column if not exists envio_error text,
  add column if not exists resuelto_por_email text;

comment on column public.cola_aprobacion.provider_message_id is
  'El id que Resend devolvió al ACEPTAR el envío. Prueba de "salió", no de "llegó": delivery/bounce es la capa siguiente. NULL con enviado_en puesto = inconsistencia visible (el envío se estampó y el guardado del id falló) — se grita en el log, no se esconde.';
comment on column public.cola_aprobacion.resuelto_por_email is
  'SNAPSHOT del email de quien resolvió (patrón bitacora_auditoria.actor_email): inmutable ante el borrado de la cuenta. El CHECK cola_resolucion_con_actor lo exige — una pieza aprobada por nadie no puede existir.';

-- Resolución ⟺ actor, en los dos sentidos (la tabla está vacía en
-- producción: el CHECK entra sin backfill).
alter table public.cola_aprobacion
  add constraint cola_resolucion_con_actor
    check ((estado = 'pendiente') = (resuelto_por_email is null));
