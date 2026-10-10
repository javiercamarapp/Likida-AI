-- ═══════════════════════════════════════════════════════════════════════════
-- 0602 — vigia_config.aviso_privacidad_url: el CHECK de la 0400 no podía evaluarse.
--
-- La 0400 declaró `aviso_privacidad_url ~ '^https://[^[:space:]]{1,480}$'`. Postgres limita el cuantificador de
-- una expresión regular a 255 repeticiones (RE_DUP_MAX): la tabla se crea, pero CUALQUIER fila con una URL
-- distinta de NULL aborta con «la expresión regular no es válida: invalid repetition count(s)». La palanca
-- quedaba inservible justo cuando la flota intentaba guardar su aviso de privacidad.
--
-- Corrección: la forma («https://» y sin espacios) en la regex y el largo (500) como `char_length`, que no
-- tiene ese tope. Idempotente: suelta y vuelve a crear el CHECK con el mismo nombre. No toca datos; si alguna
-- fila existente no cumpliera la regla nueva (no puede: con la 0400 ninguna fila con URL se pudo guardar), la
-- migración se detiene con el conteo en vez de dejar un CHECK a medias.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare n int;
begin
  if to_regclass('public.vigia_config') is null then
    return;
  end if;
  alter table public.vigia_config drop constraint if exists vigia_config_aviso_url;
  select count(*) into n from public.vigia_config
   where aviso_privacidad_url is not null
     and not (aviso_privacidad_url ~ '^https://[^[:space:]]+$' and char_length(aviso_privacidad_url) <= 500);
  if n > 0 then
    raise exception '0602: % fila(s) de vigia_config con aviso_privacidad_url fuera de la regla (https, sin espacios, <= 500)', n;
  end if;
  alter table public.vigia_config
    add constraint vigia_config_aviso_url check (
      aviso_privacidad_url is null
      or (aviso_privacidad_url ~ '^https://[^[:space:]]+$' and char_length(aviso_privacidad_url) <= 500));
end $$;
