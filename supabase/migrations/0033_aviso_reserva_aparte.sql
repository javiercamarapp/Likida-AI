-- ═══════════════════════════════════════════════════════════════════════════
-- LA RESERVA Y LA CONSTANCIA ERAN LA MISMA FILA, Y ESO BORRABA PRUEBAS BUENAS.
--
-- La 0018 resolvió el envío duplicado del aviso de privacidad con un claim en
-- SQL: `marcar_aviso_privacidad` escribe `aviso_privacidad_en = now()` ANTES de
-- mandar el mensaje, y solo el que gana esa escritura envía. Correcto contra el
-- duplicado, y por eso se hizo así.
--
-- Pero esa MISMA fila es la constancia del art. 16 de la LFPDPPP: la prueba de
-- que a ese operador se le puso el aviso a disposición. Reservar y constar en el
-- mismo lugar significa que deshacer la reserva borra la constancia.
--
-- ── EL DAÑO, Y ESTÁ EN EL CAMINO DE ESTA SEMANA ────────────────────────────
--
-- `versionAviso` es un hash del TEXTO, y el texto sale de la razón social, el
-- domicilio y la liga del aviso integral del tenant. Cambiar cualquiera de esos
-- tres cambia la versión — y resolver la liga del aviso es una tarea abierta.
--
-- Entonces:
--   1. el operador recibió el aviso v1 hace tres meses. Constancia buena.
--   2. la flota corrige su liga → el texto cambia → v2.
--   3. llega un mensaje: `marcar_aviso_privacidad` ve versión distinta, gana el
--      claim, y PISA la constancia de v1 con `now()` y v2.
--   4. `sendText` falla — pasó el 28-jul, con Meta rechazando el destinatario.
--   5. `liberarEnvioAviso` pone las dos columnas en NULL.
--
-- Resultado: la base dice que ese operador NUNCA recibió ningún aviso. Y sí lo
-- recibió: el v1 se entregó. Ante la autoridad, la carga de probar el art. 16 es
-- del responsable; "no consta" es el peor estado posible, y se llegó a él
-- destruyendo una prueba verdadera.
--
-- La 0018 protegía contra una constancia FALSA. Esto es el reverso: destruir una
-- verdadera. Las dos salen de mezclar la reserva con el hecho.
--
-- ── EL ARREGLO: SEPARARLAS ─────────────────────────────────────────────────
--
--   `aviso_privacidad_claim_en`  → la RESERVA. Se pone al reservar, se quita al
--                                  fallar, y expira sola a los 5 minutos.
--   `aviso_privacidad_en/_version` → la CONSTANCIA. Se escribe SOLO cuando Meta
--                                  devolvió un id de mensaje. Nadie la borra.
--
-- El TTL de la reserva es la misma lección que el contador de la barrera (0031):
-- un proceso que muere entre reservar y confirmar no puede dejar a un operador
-- sin su aviso para siempre. A los 5 minutos el siguiente mensaje reintenta.
--
-- Lo que se paga: si `confirmar` falla DESPUÉS de un envío bueno, la reserva
-- expira y el operador puede recibir el aviso una segunda vez. Un aviso repetido
-- es una molestia; una constancia destruida es una multa. La elección es clara.
--
-- `marcar_aviso_privacidad` conserva firma y tipo de retorno a propósito: un
-- `create or replace` mantiene dueño y permisos, y no deja dos firmas vivas — la
-- 0022 ya enseñó lo que cuesta eso.
-- ═══════════════════════════════════════════════════════════════════════════

alter table operador add column if not exists aviso_privacidad_claim_en timestamptz;

comment on column operador.aviso_privacidad_claim_en is
  'RESERVA del envío del aviso de privacidad, no constancia. Se pone al reservar, se quita al fallar el envío y expira a los 5 minutos. La constancia del art. 16 LFPDPPP es aviso_privacidad_en, que solo se escribe cuando Meta devolvió un id.';

comment on column operador.aviso_privacidad_en is
  'CONSTANCIA del art. 16 LFPDPPP: cuándo se le puso el aviso a disposición al operador. Se escribe SOLO tras un envío confirmado (confirmar_aviso_privacidad) y no la borra nada. La reserva previa vive en aviso_privacidad_claim_en.';

-- ── Reservar. Ya NO escribe la constancia. ─────────────────────────────────
create or replace function marcar_aviso_privacidad(
  p_operador uuid,
  p_tenant uuid,
  p_version text
)
returns boolean
language plpgsql
as $$
declare tocadas int;
begin
  update operador
  set aviso_privacidad_claim_en = now()
  where id = p_operador
    and tenant_id = p_tenant
    -- Se envía si nunca se envió, o si el texto de la flota cambió desde la
    -- última vez (art. 15 fr. VI: hay que comunicar los cambios).
    and (aviso_privacidad_en is null or aviso_privacidad_version is distinct from p_version)
    -- Y no si otro camino lo está mandando ahora mismo. La reserva expira sola:
    -- un proceso que muere entre reservar y confirmar no puede dejar a un
    -- operador sin su aviso para siempre.
    and (aviso_privacidad_claim_en is null or aviso_privacidad_claim_en < now() - interval '5 minutes');

  get diagnostics tocadas = row_count;
  return tocadas > 0;
end $$;

comment on function marcar_aviso_privacidad(uuid, uuid, text) is
  'Reserva el envío del aviso (no lo hace constar). Devuelve true si esta llamada ganó la reserva. La constancia la escribe confirmar_aviso_privacidad, y solo tras un envío confirmado. Ver 0018 y 0033.';

-- ── Constar. Solo después de que Meta devolvió un id. ──────────────────────
create or replace function confirmar_aviso_privacidad(
  p_operador uuid,
  p_tenant uuid,
  p_version text
)
returns boolean
language plpgsql
as $$
declare tocadas int;
begin
  update operador
  set aviso_privacidad_en = now(),
      aviso_privacidad_version = p_version,
      aviso_privacidad_claim_en = null
  where id = p_operador and tenant_id = p_tenant;

  get diagnostics tocadas = row_count;
  return tocadas > 0;
end $$;

comment on function confirmar_aviso_privacidad(uuid, uuid, text) is
  'Escribe la constancia del art. 16 LFPDPPP tras un envío CONFIRMADO por Meta, y libera la reserva. Es lo único que escribe aviso_privacidad_en.';

-- ── Soltar la reserva. NUNCA toca la constancia. ───────────────────────────
create or replace function liberar_aviso_privacidad(
  p_operador uuid,
  p_tenant uuid
)
returns boolean
language plpgsql
as $$
declare tocadas int;
begin
  -- `is not null` en el WHERE para que el booleano signifique "solté una reserva
  -- que existía". Sin él, un UPDATE que no cambia nada cuenta como fila tocada y
  -- la función diría que sí en todos los casos, incluido el que hay que ver: que
  -- se intente liberar algo que ya no está reservado.
  update operador
  set aviso_privacidad_claim_en = null
  where id = p_operador and tenant_id = p_tenant
    and aviso_privacidad_claim_en is not null;

  get diagnostics tocadas = row_count;
  return tocadas > 0;
end $$;

comment on function liberar_aviso_privacidad(uuid, uuid) is
  'Suelta la RESERVA cuando el envío no salió, para que el siguiente mensaje reintente. No toca la constancia: borrarla destruiría la prueba del art. 16 de un aviso anterior que sí se entregó.';

revoke all on function confirmar_aviso_privacidad(uuid, uuid, text) from public, anon, authenticated;
revoke all on function liberar_aviso_privacidad(uuid, uuid) from public, anon, authenticated;
grant execute on function confirmar_aviso_privacidad(uuid, uuid, text) to service_role;
grant execute on function liberar_aviso_privacidad(uuid, uuid) to service_role;

-- ── Las reservas que la 0018 dejó escritas como si fueran constancias ──────
--
-- Hasta hoy toda reserva se escribía en `aviso_privacidad_en`. Las que
-- corresponden a envíos buenos son constancias legítimas y se quedan. Las que
-- quedaron de un envío fallido ya se pusieron en NULL por el camino viejo. No
-- hay forma de distinguir a posteriori una tercera clase —reservada, enviada mal
-- y nunca liberada— y por eso NO se toca nada: borrar una constancia por si
-- acaso es exactamente el daño que esta migración viene a impedir.
