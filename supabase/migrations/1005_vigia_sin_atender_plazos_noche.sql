-- REVERSA: alter table public.vigia_sin_atender_config drop constraint if exists vigia_sin_atender_config_plazos, drop constraint if exists vigia_sin_atender_config_noche, drop constraint if exists vigia_sin_atender_config_umbral_min, drop constraint if exists vigia_sin_atender_config_umbral_critico_min, drop constraint if exists vigia_sin_atender_config_noche_desde, drop constraint if exists vigia_sin_atender_config_noche_hasta, drop column if exists umbral_min, drop column if exists umbral_critico_min, drop column if exists noche_desde_hora, drop column if exists noche_hasta_hora;  -- pierde los plazos y la ventana de noche guardados; el código vuelve a vigia_config y a 20:00-07:00
-- ═══════════════════════════════════════════════════════════════════════════
-- 1005 — Vigía «sin atender»: plazos normal y crítico propios y ventana de noche configurable (piloto, 12-nov-2026).
--
-- La 0999 dejó la tabla `vigia_sin_atender_config` sin dónde guardar (A4) los plazos de espera normal y de clientes críticos de «sin atender»
-- (hoy solo salen de `vigia_config`, la 1:1 del Vigía en vivo) ni (A6) la ventana de noche que decide qué director recibe el aviso
-- (hoy fija en 20:00-07:00, `NOCHE_POR_OMISION`). Esta migración añade cuatro columnas NULAS por omisión:
--
--     umbral_min           1-1440  minutos de espera normal       (null = se usa `vigia_config.sla_respuesta_min`)
--     umbral_critico_min   1-1440  minutos en grupos críticos     (null = se usa `vigia_config.sla_critico_min`)
--     noche_desde_hora     0-23    hora local en que empieza la noche (null = 20)
--     noche_hasta_hora     0-23    hora local en que termina la noche (null = 7)
--
-- CON LAS COLUMNAS NULAS NADA CAMBIA: los plazos siguen saliendo de `vigia_config` y la noche sigue de 20:00 a 07:00. El plazo crítico no
-- puede ser MAYOR que el normal cuando los dos existen (lo crítico se atiende antes, nunca después). La ventana de noche se guarda completa
-- o nula: o están las dos horas o ninguna (desde = hasta significa «sin noche», igual que `esNoche`).
--
-- ADITIVA E IDEMPOTENTE (add column if not exists; drop constraint if exists + add). No toca filas existentes, no crea funciones, no cambia
-- RLS ni permisos de la tabla (siguen solo service_role). Va ANTES del [deploy] que lee y guarda las columnas; el código tolera su ausencia
-- (42703 / PGRST204): sin migrar guarda y lee como antes.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.vigia_sin_atender_config add column if not exists umbral_min integer;
alter table public.vigia_sin_atender_config add column if not exists umbral_critico_min integer;
alter table public.vigia_sin_atender_config add column if not exists noche_desde_hora integer;
alter table public.vigia_sin_atender_config add column if not exists noche_hasta_hora integer;

alter table public.vigia_sin_atender_config drop constraint if exists vigia_sin_atender_config_umbral_min;
alter table public.vigia_sin_atender_config add constraint vigia_sin_atender_config_umbral_min check (umbral_min is null or umbral_min between 1 and 1440);
alter table public.vigia_sin_atender_config drop constraint if exists vigia_sin_atender_config_umbral_critico_min;
alter table public.vigia_sin_atender_config add constraint vigia_sin_atender_config_umbral_critico_min check (umbral_critico_min is null or umbral_critico_min between 1 and 1440);
alter table public.vigia_sin_atender_config drop constraint if exists vigia_sin_atender_config_noche_desde;
alter table public.vigia_sin_atender_config add constraint vigia_sin_atender_config_noche_desde check (noche_desde_hora is null or noche_desde_hora between 0 and 23);
alter table public.vigia_sin_atender_config drop constraint if exists vigia_sin_atender_config_noche_hasta;
alter table public.vigia_sin_atender_config add constraint vigia_sin_atender_config_noche_hasta check (noche_hasta_hora is null or noche_hasta_hora between 0 and 23);
alter table public.vigia_sin_atender_config drop constraint if exists vigia_sin_atender_config_plazos;
alter table public.vigia_sin_atender_config add constraint vigia_sin_atender_config_plazos check (umbral_min is null or umbral_critico_min is null or umbral_critico_min <= umbral_min);
alter table public.vigia_sin_atender_config drop constraint if exists vigia_sin_atender_config_noche;
alter table public.vigia_sin_atender_config add constraint vigia_sin_atender_config_noche check ((noche_desde_hora is null) = (noche_hasta_hora is null));

comment on column public.vigia_sin_atender_config.umbral_min is '1005: minutos de espera normal de «sin atender»; null = el de vigia_config.sla_respuesta_min.';
comment on column public.vigia_sin_atender_config.umbral_critico_min is '1005: minutos de espera en clientes críticos (no mayor que umbral_min si ambos existen); null = el de vigia_config.sla_critico_min.';
comment on column public.vigia_sin_atender_config.noche_desde_hora is '1005: hora local (0-23) en que empieza la noche de los directores; null = 20. Va con noche_hasta_hora (ambas o ninguna).';
comment on column public.vigia_sin_atender_config.noche_hasta_hora is '1005: hora local (0-23) en que termina la noche; null = 7. Si cruza la medianoche (desde > hasta) la noche abarca dos días.';
