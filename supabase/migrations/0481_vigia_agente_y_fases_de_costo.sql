-- ═══════════════════════════════════════════════════════════════════════════
-- 0481 — El Vigía de servicio al cliente entra al catálogo de agentes y su costo
-- de IA deja de mezclarse con el del chat «con tus datos».
--
-- 1. FASES DE COSTO `vigia` y `conductor`. El Vigía (0400) registraba lo que gasta
--    el modelo con fase `chat`, y el freno diario del chat (`app/api/dashboard/chat/
--    tope.ts`: `.eq('fase', 'chat')`) suma TODO lo de esa fase: cada clasificación
--    de un mensaje de un cliente final le restaba presupuesto al dueño que conversa
--    con sus datos. El respaldo con modelo del Conductor (0380) usaba `router`, que
--    tampoco es suyo. Cada agente cuenta su gasto en su fase.
--    El CHECK se reescribe ENTERO desde el vigente (0351: ocr, cuadre, escalacion,
--    chat, router, whatsapp, transcripcion, copiloto, runner) más las dos nuevas.
--    La forma `fase in (...)` es la que `costos_dominio.test.ts` lee.
-- 2. EL CATÁLOGO `agente_definicion`: el Vigía de servicio al cliente es una fila
--    (`vigia_cliente`; ya existe `vigia` = el de leads fríos, otro agente) y el
--    Agente 5 declara su rol de modelo (`conductor_hito`) en la fila `conductores`
--    que ya estaba. Ambos con el rol de la 0400 ya admitido por el CHECK de
--    `modelo_rol` (la 0400/0421 lo reescribieron entero).
--    `vivo` = el código corre dentro del producto; para cada flota nace APAGADO
--    (`vigia_config.habilitado = false`, `agente_conductor_config.activo`) y exige
--    número de WhatsApp real y plantillas aprobadas por Meta: ver docs/operacion.
--    `presupuesto_dia_usd` queda en NULL a propósito (sin tope declarado, y el
--    panel lo dice así; jamás se pinta como «sin gasto»).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.llm_costo drop constraint if exists llm_costo_fase_dominio;
alter table public.llm_costo add constraint llm_costo_fase_dominio
  check (fase in ('ocr', 'cuadre', 'escalacion', 'chat', 'router', 'whatsapp', 'transcripcion', 'copiloto', 'runner', 'vigia', 'conductor'));
comment on constraint llm_costo_fase_dominio on public.llm_costo is
  'Dominio de fases de costo de IA (0025, 0304, 0351 y 0481: vigia, conductor). Debe coincidir con FaseCosto de costos.ts (lo cruza costos_dominio.test.ts).';

insert into public.agente_definicion (id, nombre, departamento, disparador, estado, descripcion, modelo_rol) values
  ('vigia_cliente', 'Vigía de servicio al cliente', 'exito_cliente', 'whatsapp', 'vivo',
   'Atiende por WhatsApp a los clientes de la flota (autorizados con consentimiento): clasifica, contesta con datos reales del viaje (último hito del Conductor, cita/ETA, POD), el gerente aprueba con un toque y lo molesto o sin respuesta escala por niveles. Apagado por omisión en cada flota; fuera de 24 h solo plantillas aprobadas.',
   'vigia_cliente')
on conflict (id) do nothing;

update public.agente_definicion
   set modelo_rol = 'conductor_hito',
       descripcion = 'Agente 5 «Conductor»: pide, persigue, valida y registra los hitos del viaje por WhatsApp (llegada/salida de carga y descarga, regreso), escala al jefe de tráfico y alimenta estadías, jornada y al Vigía. Su respaldo con modelo (rol conductor_hito) cuenta su gasto en la fase conductor.',
       actualizado_en = now()
 where id = 'conductores';
