-- ═══════════════════════════════════════════════════════════════════════════
-- 0301 — Los agentes TEATRO se marcan `experimental` y el runner deja de
-- despacharlos por default (auditoría 24, 1-sep-2026, AGB "agentes teatro").
--
-- La auditoría del back office encontró NUEVE de los 49 agentes del runner
-- cuyo catálogo (migración 0125) promete un motor que el código NUNCA tuvo:
--
--   · cazador           — el propio texto que fabrica dice "NO buscó una
--                          sola empresa" (leads.ts); el catálogo promete
--                          "reactiva el scraper del censo" (0125:40).
--   · seo_distribucion  — audita la constante `ARTICULOS` del repo, no el
--                          sitio publicado; el catálogo promete "decide
--                          dónde se pone cada pieza" (0125:60).
--   · guiones           — plantilla determinista sobre un artículo fijo; el
--                          catálogo promete "destila hooks con whisper
--                          local" (0125:101) — no hay whisper ni LLM.
--   · noticias_mercado  — fichas del índice ESTÁTICO `NORMAS` del repo; el
--                          catálogo promete "investiga a diario el mercado"
--                          (0125:102) — no lee nada externo.
--   · promos_diarias    — copy FIJO rotando sobre una sonda fija.
--   · visuales          — texto de "encargo visual" para un humano; el motor
--                          declarado (subagente + Higgsfield) no está en el
--                          deploy.
--   · video_demo        — texto de "encargo de video demo", sin motor.
--   · video_marketing   — texto de "encargo de reel", sin motor.
--   · pruebas           — "ENCARGO PARA LA RUTINA LOCAL (esto NO lo corrió
--                          este agente)"; el catálogo promete "mantiene la
--                          suite — ESCRIBE código de prueba" (0125:77).
--
-- Los nueve siguen `vivo` + `runner_habilitado` en el catálogo hoy, así que
-- el runner los despacha cada vuelta como si fueran cualquiera de los otros
-- 40 — y cada uno de esos 40 SÍ ejecuta el motor que su fila promete (aunque
-- 35 de ellos escriban a una bandeja que nadie lee, AGB-5). Presentar los
-- nueve de este bloque junto con los 40 reales como "back office completo"
-- es la promesa que esta migración empieza a corregir: el catálogo pasa a
-- DECIR que estos nueve son experimentales, y el runner dejará de
-- despacharlos por default (candado en `src/lib/likida/agentes/runner.ts`,
-- mismo commit).
--
-- `experimental` es una columna nueva, no un `estado` nuevo: un agente
-- experimental sigue `vivo` en el organigrama (Javier lo ve, lo puede
-- graduar) — lo único que cambia es que el runner ya no lo corre solo. Igual
-- que `runner_habilitado` (0123), es apagable/prendible sin deploy: cuando
-- alguno de los nueve tenga de verdad su motor, un `update` lo gradúa.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.agente_definicion
  add column if not exists experimental boolean not null default false;

comment on column public.agente_definicion.experimental is
  'AGB (auditoría 24, 0301): true = el catálogo promete un motor que el código no tiene todavía (produce texto sin motor detrás, o su promesa no corresponde con lo que corre). El runner (runner.ts) no lo despacha por default aunque esté vivo + runner_habilitado — se gradúa quitando esta marca cuando el motor real exista.';

update public.agente_definicion
  set experimental = true
  where id in (
    'cazador', 'seo_distribucion', 'guiones', 'noticias_mercado',
    'promos_diarias', 'visuales', 'video_demo', 'video_marketing', 'pruebas'
  );
