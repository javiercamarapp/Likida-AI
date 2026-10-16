-- ═══════════════════════════════════════════════════════════════════════════
-- 0810 — PEAJES: el catálogo de casetas con COORDENADAS OPCIONALES (T-A2-05).
--
-- (La ficha lo nombraba «0777 parte A»; esa numeración ya está usada. Va en el
-- bloque 0810–0819 asignado a A2.)
--
-- Hasta hoy `peaje_caseta.lat/lng` eran NOT NULL (0375): para dar de alta una
-- caseta había que inventar una coordenada, y una coordenada inventada acusaría a
-- un chofer con un dato de mentira. Ahora una caseta vive por NOMBRE (+ alias) y
-- las coordenadas llegan cuando haya una fuente defendible (los puntos de interés
-- del sistema GPS del cliente, el IMT/OSM o la lista del dueño).
--
--   · `lat` y `lng` admiten NULL, pero SIEMPRE en pareja: o las dos o ninguna.
--     Una coordenada a medias no se puede medir y delata un error de captura.
--   · Cuando existen, siguen validadas en rango (-90..90 / -180..180).
--   · `por_pasada boolean not null default false`: la caseta cobra una tarifa fija
--     por pasada (no por clase de vehículo); la usa el tarifario (T-A2-06/07).
--
-- NO SE SIEMBRA NINGUNA COORDENADA NI NINGUNA CASETA: la tabla sigue naciendo
-- vacía y las filas existentes conservan las suyas. Aditiva e idempotente; la RLS
-- deny-all de la 0375 no cambia.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.peaje_caseta alter column lat drop not null;
alter table public.peaje_caseta alter column lng drop not null;

alter table public.peaje_caseta add column if not exists por_pasada boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'peaje_caseta_coordenadas_en_pareja'
                   and conrelid = 'public.peaje_caseta'::regclass) then
    alter table public.peaje_caseta
      add constraint peaje_caseta_coordenadas_en_pareja
      check ((lat is null and lng is null) or (lat is not null and lng is not null));
  end if;
end $$;

-- Los CHECK de rango de la 0375 (`lat between -90 and 90`) ya admiten NULL (un CHECK
-- con NULL no se viola), así que se conservan tal cual: NULL pasa, un valor fuera de rango no.

comment on column public.peaje_caseta.lat is
  'Latitud en grados decimales. NULL = caseta conocida solo por nombre (sin coordenadas); siempre en pareja con lng (0810).';
comment on column public.peaje_caseta.lng is
  'Longitud en grados decimales. NULL = caseta conocida solo por nombre; siempre en pareja con lat (0810).';
comment on column public.peaje_caseta.por_pasada is
  'La caseta cobra tarifa fija por pasada, no por clase de vehículo (0810). Default false.';
