-- REVERSA: alter table public.programa_despacho_carga drop column if exists completada_en;
-- ═══════════════════════════════════════════════════════════════════════════
-- 0894 · programa_despacho_carga.completada_en (A37-S59-05)
--
-- La carga del programa de despacho se reclamaba (insert con llave única por flota + terminal + sha256) sin arriendo ni estado: si la
-- invocación moría a medias (timeout, kill) tras registrar cambios e insertar parte de las filas, resubir el MISMO archivo respondía
-- «ya estaba cargado» y las filas restantes y los ocultamientos nunca se aplicaban, sin aviso.
--
-- `completada_en` se sella AL FINAL de la sincronización. El código (vigia/programa/sincronizar.ts) retoma una carga sin sellar con más
-- de 10 min de antigüedad al resubir el mismo archivo (escribir es idempotente: filas por clave natural, cambios sin repetir).
--
-- ADITIVA, IDEMPOTENTE y COMPATIBLE HACIA ATRÁS: columna nullable sin default; el código desplegado antes de esta migración no la toca y el
-- nuevo tolera su ausencia (42703 = se comporta como antes). Las cargas que ya existen se marcan completadas (con su created_at) UNA sola
-- vez, al crear la columna: reaplicar la migración no marca como completas las cargas nuevas que sigan a medias.
-- No cambia RLS, funciones ni privilegios (la tabla la escribe solo service_role).
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'programa_despacho_carga' and column_name = 'completada_en'
  ) then
    alter table public.programa_despacho_carga add column completada_en timestamptz;
    -- Lo ya cargado antes de esta migración se da por completo (no hay forma de saber lo contrario).
    update public.programa_despacho_carga set completada_en = created_at where completada_en is null;
  end if;
end $$;

comment on column public.programa_despacho_carga.completada_en is
  '0894: cuándo terminó de escribirse TODO lo de la carga (filas, cambios y ocultamientos). NULL = reclamada pero sin terminar: una subida posterior del mismo archivo la retoma pasados 10 min.';
