-- ═══════════════════════════════════════════════════════════════════════════
-- 0801 — Conductor: perfil de seguimiento, umbrales de «sin señal de vida» y perillas de la flota.
--
-- 1. `perfil_seguimiento`: 'completo' (los 5 hitos del ciclo, el comportamiento de siempre) o 'esenciales'
--    (solo lo básico: «ya cargó», «dónde está» y «si no se ha reportado»). Los esenciales son un SUBCONJUNTO del
--    ciclo, no otro alcance. El valor de partida es 'completo'.
-- 2. Umbrales de la escalera de señal de vida, en minutos (de 5 a 720). Los valores de partida (45/60/20/20/120)
--    son SUPUESTOS, no mediciones: la flota los ajusta con sus tiempos reales.
-- 3. Perillas que otras tareas del frente leen: `mostrar_estados_frontera`, `aplicar_salida_del_tms`
--    (ambas apagadas) y la línea base de llamadas por viaje (nula hasta que se registre).
--
-- Solo aditiva e idempotente. No redefine ninguna función. El código lee la fila completa y trata una columna
-- ausente como su valor de partida: contra la base sin migrar el agente sigue funcionando como hoy.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.agente_conductor_config
  add column if not exists perfil_seguimiento text not null default 'completo',
  add column if not exists gps_obsoleto_min smallint not null default 45,
  add column if not exists detenido_min smallint not null default 60,
  add column if not exists segundo_aviso_min smallint not null default 20,
  add column if not exists escalar_senal_min smallint not null default 20,
  add column if not exists silencio_respuesta_min smallint not null default 120,
  add column if not exists mostrar_estados_frontera boolean not null default false,
  add column if not exists aplicar_salida_del_tms boolean not null default false,
  add column if not exists linea_base_llamadas_por_viaje numeric null,
  add column if not exists linea_base_registrada_en date null;

alter table public.agente_conductor_config drop constraint if exists conductor_config_perfil_seguimiento;
alter table public.agente_conductor_config add constraint conductor_config_perfil_seguimiento
  check (perfil_seguimiento in ('esenciales', 'completo'));

alter table public.agente_conductor_config drop constraint if exists conductor_config_umbrales_senal;
alter table public.agente_conductor_config add constraint conductor_config_umbrales_senal
  check (gps_obsoleto_min between 5 and 720
     and detenido_min between 5 and 720
     and segundo_aviso_min between 5 and 720
     and escalar_senal_min between 5 and 720
     and silencio_respuesta_min between 5 and 720);

alter table public.agente_conductor_config drop constraint if exists conductor_config_linea_base_llamadas;
alter table public.agente_conductor_config add constraint conductor_config_linea_base_llamadas
  check (linea_base_llamadas_por_viaje is null or (linea_base_llamadas_por_viaje >= 0 and linea_base_llamadas_por_viaje <= 1000));

comment on column public.agente_conductor_config.perfil_seguimiento is
  '0801: ''completo'' = los 5 hitos del ciclo (defecto); ''esenciales'' = solo salida de carga, dónde está y señal de vida (subconjunto del ciclo).';
comment on column public.agente_conductor_config.gps_obsoleto_min is
  '0801: minutos sin muestra de GPS para considerar la señal obsoleta. 45 por omisión (supuesto, no medición); de 5 a 720.';
comment on column public.agente_conductor_config.detenido_min is
  '0801: minutos detenido fuera de un sitio del viaje para considerar la unidad detenida. 60 por omisión (supuesto, no medición); de 5 a 720.';
comment on column public.agente_conductor_config.segundo_aviso_min is
  '0801: minutos entre el primer aviso al chofer y el segundo. 20 por omisión (supuesto, no medición); de 5 a 720.';
comment on column public.agente_conductor_config.escalar_senal_min is
  '0801: minutos tras el segundo aviso sin respuesta para avisar al jefe de tráfico. 20 por omisión (supuesto, no medición); de 5 a 720.';
comment on column public.agente_conductor_config.silencio_respuesta_min is
  '0801: minutos de silencio del chofer tras los avisos para dar el episodio por sin respuesta. 120 por omisión (supuesto, no medición); de 5 a 720.';
comment on column public.agente_conductor_config.mostrar_estados_frontera is
  '0801: mostrar los estados de frontera como hito OPCIONAL visible (no escala). Apagado por omisión.';
comment on column public.agente_conductor_config.aplicar_salida_del_tms is
  '0801: aplicar la salida que reporta el TMS como hito del viaje. Apagado por omisión.';
comment on column public.agente_conductor_config.linea_base_llamadas_por_viaje is
  '0801: llamadas de seguimiento por viaje medidas ANTES del agente (línea base para comparar). Nulo hasta que se registre.';
comment on column public.agente_conductor_config.linea_base_registrada_en is
  '0801: fecha en que se registró la línea base de llamadas por viaje.';
