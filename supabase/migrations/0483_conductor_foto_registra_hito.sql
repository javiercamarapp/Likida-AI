-- ═══════════════════════════════════════════════════════════════════════════
-- 0483 — Agente 5 «Conductor»: la foto del chofer puede REGISTRAR el hito por sí sola.
--
-- Hasta hoy una foto con el pie «sello» / «andén» / «recibido» solo se colgaba de un hito YA
-- registrado; sin hito, el chofer recibía «primero dime ya llegué». Con esta perilla la foto es
-- también el aviso: un «andén» sin llegada registra la llegada (a cargar o a descargar, según lo
-- que el viaje ya lleva), un «sello» registra la salida de la carga y un «recibido» la salida de
-- la descarga, con fuente `foto` y la HORA DEL MENSAJE del chofer (no la del procesamiento).
--
-- Por flota y ENCENDIDA por omisión: es el mismo aviso que el chofer ya mandaba por texto, con
-- evidencia. Una flota que no la quiera la apaga desde /dashboard/agentes/conductores/configuracion
-- o por PUT /v1/conductor/config (`fotoRegistraHito`).
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.agente_conductor_config
  add column if not exists foto_registra_hito boolean not null default true;
comment on column public.agente_conductor_config.foto_registra_hito is
  '0483: una foto con pie «sello», «andén» o «recibido» sin hito al que colgarla registra el hito (fuente foto, hora del mensaje) con la foto como evidencia. Apagada, la foto solo se cuelga de un hito ya registrado.';
