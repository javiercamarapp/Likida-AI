-- REVERSA: alter table public.agente_conductor_config drop column if exists poleo_min, drop column if exists poleo_por_clave_min, drop column if exists detenido_aviso_min, drop column if exists cohorte_piloto, drop column if exists exigir_sello_inicio, drop column if exists patio_entrega_activo, drop column if exists patio_que_manda, drop column if exists estadia_descarga_interactiva, drop column if exists estadia_descarga_min_por_cliente, drop column if exists estadia_descarga_sin_respuesta_min, drop column if exists reporte_llegada_activo, drop column if exists constancia_reportes_activa, drop column if exists resultado_descarga_activo, drop column if exists pedir_documentos_cierre_activo, drop column if exists asignacion_botones_activa, drop column if exists gastos_etc_activa, drop column if exists deteccion_parada_activa, drop column if exists detencion_escala_sin_respuesta_min;
-- ═══════════════════════════════════════════════════════════════════════════
-- 0927 · Ola 8 (auditoría 39) · A39-A5-01 / A5-04 / A5-06 — las perillas del Conductor que se validaban y se leían pero NO tenían columna.
--
-- ADITIVA e IDEMPOTENTE (add column if not exists); COMPATIBLE HACIA ATRÁS: el código desplegado hoy no usa nada de esto (la lectura
-- ignoraba estas columnas y `guardarConfigConductor` lanzaba si llegaba `poleoMin`/`detenidoAvisoMin`) y el código nuevo tolera su
-- ausencia (lee el valor de partida; al guardar algo distinto del valor de partida dice que falta la migración).
--
--  · Calibración de la compuerta «unidad detenida» al GPS real (A5-04): poleo_min, poleo_por_clave_min, detenido_aviso_min. Sin ellas la
--    compuerta, encendida, silencia al agente en ruta (la telemática se RECIBE cada ~15 min) y apagada no protege.
--  · Cohorte del piloto (A5-04/A5-12): cohorte_piloto (el preflight no deja encender nada sin ella).
--  · Las perillas de la fase 2 (A5-06), TODAS apagadas por omisión (fail-closed: el comportamiento de siempre): exigir sello de inicio,
--    patio de entrega, estadía de descarga interactiva y sus umbrales, reporte de llegada, constancia de reportes, resultado de descarga,
--    documentos de cierre, botones de asignación, gastos, detección de parada sin aviso y su escalamiento.
-- NO enciende nada ni toca el interruptor de habilitación del Agente 5 (0859): esas son decisiones del dueño, con aviso de privacidad.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.agente_conductor_config
  add column if not exists poleo_min integer check (poleo_min is null or poleo_min between 1 and 60),
  add column if not exists poleo_por_clave_min jsonb check (poleo_por_clave_min is null or jsonb_typeof(poleo_por_clave_min) = 'object'),
  add column if not exists detenido_aviso_min integer not null default 15 check (detenido_aviso_min between 5 and 720),
  add column if not exists cohorte_piloto text check (cohorte_piloto is null or cohorte_piloto in ('sin_tableta_ni_macros', 'voluntarios_abiertos')),
  add column if not exists exigir_sello_inicio boolean not null default false,
  add column if not exists patio_entrega_activo boolean not null default false,
  add column if not exists patio_que_manda text not null default 'entregar_en' check (patio_que_manda in ('entregar_en', 'destino')),
  add column if not exists estadia_descarga_interactiva boolean not null default false,
  add column if not exists estadia_descarga_min_por_cliente jsonb not null default '{}'::jsonb check (jsonb_typeof(estadia_descarga_min_por_cliente) = 'object'),
  add column if not exists estadia_descarga_sin_respuesta_min integer not null default 30 check (estadia_descarga_sin_respuesta_min between 5 and 720),
  add column if not exists reporte_llegada_activo boolean not null default false,
  add column if not exists constancia_reportes_activa boolean not null default false,
  add column if not exists resultado_descarga_activo boolean not null default false,
  add column if not exists pedir_documentos_cierre_activo boolean not null default false,
  add column if not exists asignacion_botones_activa boolean not null default false,
  add column if not exists gastos_etc_activa boolean not null default false,
  add column if not exists deteccion_parada_activa boolean not null default false,
  add column if not exists detencion_escala_sin_respuesta_min integer check (detencion_escala_sin_respuesta_min is null or detencion_escala_sin_respuesta_min between 5 and 720);

comment on column public.agente_conductor_config.poleo_min is
  '0927 (A39-A5-04): cadencia (min) con que se RECIBEN posiciones de la flota; null = sin calibrar (regla de 3 muestras en la ventana). 1 a 60.';
comment on column public.agente_conductor_config.deteccion_parada_activa is
  '0927 (A39-A5-06): detección de parada sin aviso (N05). false por omisión = apagada; pasa por la compuerta 0859 y la de unidad detenida.';
