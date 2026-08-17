-- ═══════════════════════════════════════════════════════════════════════════
-- 0128 · COORDENADAS DEL PROSPECTO — el mapa de leads (Fase D, orden del
-- 17-ago: "un Google Maps de leads y prospectos").
--
-- La DENUE entrega Latitud/Longitud del establecimiento cruzado y las
-- estábamos tirando. Con ellas el mapa de /admin pinta cada prospecto en su
-- calle real. Nullable a propósito: un prospecto sin cruce no tiene punto y
-- el mapa lo dice (aparece en la lista de su plaza, no se le inventa lugar).
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.prospecto
  add column if not exists lat double precision
    constraint prospecto_lat_rango check (lat is null or (lat >= 14 and lat <= 33)),
  add column if not exists lng double precision
    constraint prospecto_lng_rango check (lng is null or (lng >= -119 and lng <= -86));

-- Un punto a medias no dice nada: o las dos, o ninguna.
alter table public.prospecto
  add constraint prospecto_geo_completa check ((lat is null) = (lng is null));
