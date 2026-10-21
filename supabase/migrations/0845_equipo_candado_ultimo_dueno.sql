-- ═══════════════════════════════════════════════════════════════════════════
-- 0845 · AUDITORÍA ADVERSARIAL (21-oct-2026), HALLAZGO ALTO #2 — TOCTOU en la
-- protección del «último dueño activo».
--
-- ── EL HALLAZGO ────────────────────────────────────────────────────────────
-- `cambiarRolUsuario` y `desactivarUsuario` (usuarios_escritura.ts) protegen
-- a la flota de quedarse sin ningún `flota_admin` activo con un patrón de DOS
-- pasos hechos desde el cliente (supabase-js), cada uno su PROPIA petición a
-- PostgREST y por tanto su PROPIA transacción:
--   1. SELECT count(*) de otros flota_admin activos (`otrosDuenosActivos`);
--   2. si > 0, UPDATE anclado al rol/activo leído antes (optimista).
--
-- Entre el paso 1 de una llamada y el paso 1 de OTRA llamada concurrente no
-- hay ningún candado: con exactamente DOS dueños activos (A y B), degradar a
-- A (excluyendo A, cuenta a B: 1, pasa) y degradar a B (excluyendo B, cuenta
-- a A: 1, pasa) PUEDEN correr A LA VEZ, cada una viendo al otro todavía
-- activo porque ninguna de las dos transacciones de UPDATE ya confirmó. Las
-- dos pasan el candado, las dos actualizan — la flota se queda sin ningún
-- `flota_admin` activo, exactamente lo que el candado existía para evitar.
--
-- Mover el SELECT a dentro de la función no basta por sí solo: cada llamada
-- RPC de supabase-js es, igual, SU PROPIA transacción — un SELECT y un UPDATE
-- en la MISMA función SQL comparten transacción entre ellos, pero NO con la
-- transacción de otra llamada RPC concurrente, así que la misma ventana
-- seguiría abierta sin algo que las serialice entre sí.
--
-- ── EL CIERRE ──────────────────────────────────────────────────────────────
-- `pg_advisory_xact_lock(hashtextextended('equipo:' || p_tenant::text, 0))`,
-- el mismo patrón que ya usan `cierre_tenant_lock_key`, `vigia_servicio_guardar`
-- (0798) y media docena más de este repo para «un candado por flota, de
-- transacción, liberado solo al terminar»: la SEGUNDA llamada para la MISMA
-- flota se queda esperando a que la PRIMERA haga commit o rollback antes de
-- correr su propio SELECT — así que cuando por fin corre, ve el conteo YA
-- actualizado por la primera, nunca el viejo. Dos llamadas para FLOTAS
-- distintas no se tocan (hashes distintos, cero espera).
--
-- Cada función hace TODO en una sola transacción: candado → recuento →
-- UPDATE condicional (ancla también al rol/activo leído por el llamador, el
-- mismo patrón optimista de antes, ahora con el recuento adentro de la
-- MISMA transacción que el UPDATE). Devuelve 'ok' | 'ultimo_dueno' |
-- 'conflicto' en vez de filas — así el llamador TypeScript distingue el
-- mensaje correcto sin adivinar por qué no hubo fila (antes esa distinción
-- vivía en dos consultas separadas de TS; ahora la decide la misma
-- transacción que hizo el cambio, no una lectura previa que pudo quedar
-- vieja).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.equipo_cambiar_rol(
  p_tenant uuid, p_usuario uuid, p_rol_actual text, p_rol_nuevo text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_otros int;
  v_filas int;
begin
  -- Candado por FLOTA: serializa esta operación contra cualquier otra
  -- llamada concurrente a equipo_cambiar_rol/equipo_desactivar_usuario para
  -- el MISMO tenant (comparten el prefijo 'equipo:' a propósito — las dos
  -- protegen el mismo invariante).
  perform pg_advisory_xact_lock(hashtextextended('equipo:' || p_tenant::text, 0));

  if p_rol_actual = 'flota_admin' then
    select count(*) into v_otros
      from public.app_user
     where tenant_id = p_tenant and rol = 'flota_admin' and activo = true and id <> p_usuario;
    if v_otros = 0 then
      return 'ultimo_dueno';
    end if;
  end if;

  update public.app_user u
     set rol = p_rol_nuevo
   where u.id = p_usuario and u.tenant_id = p_tenant and u.rol = p_rol_actual;
  get diagnostics v_filas = row_count;
  if v_filas = 0 then
    return 'conflicto';
  end if;
  return 'ok';
end;
$$;
comment on function public.equipo_cambiar_rol is
  '0845: cambia el rol de alguien del equipo, con el recuento del "último dueño activo" y el UPDATE condicional EN LA MISMA transacción, bajo un candado de transacción por flota (TOCTOU, auditoría adversarial 21-oct-2026). Devuelve ok | ultimo_dueno | conflicto.';
revoke all on function public.equipo_cambiar_rol(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.equipo_cambiar_rol(uuid, uuid, text, text) to service_role;

create or replace function public.equipo_desactivar_usuario(
  p_tenant uuid, p_usuario uuid, p_rol_actual text, p_actor uuid
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_otros int;
  v_filas int;
begin
  perform pg_advisory_xact_lock(hashtextextended('equipo:' || p_tenant::text, 0));

  if p_rol_actual = 'flota_admin' then
    select count(*) into v_otros
      from public.app_user
     where tenant_id = p_tenant and rol = 'flota_admin' and activo = true and id <> p_usuario;
    if v_otros = 0 then
      return 'ultimo_dueno';
    end if;
  end if;

  update public.app_user u
     set activo = false, desactivado_en = now(), desactivado_por = p_actor
   where u.id = p_usuario and u.tenant_id = p_tenant and u.activo = true;
  get diagnostics v_filas = row_count;
  if v_filas = 0 then
    return 'conflicto';
  end if;
  return 'ok';
end;
$$;
comment on function public.equipo_desactivar_usuario is
  '0845: da de baja (activo=false) a alguien del equipo, con el mismo candado y recuento atómico que equipo_cambiar_rol (TOCTOU, auditoría adversarial 21-oct-2026). El ban de Auth y la bitácora siguen viviendo en TypeScript (usuarios_escritura.ts) — esta función solo cierra la ventana de carrera de la fila. Devuelve ok | ultimo_dueno | conflicto.';
revoke all on function public.equipo_desactivar_usuario(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.equipo_desactivar_usuario(uuid, uuid, text, uuid) to service_role;
