-- ═══════════════════════════════════════════════════════════════════════════
-- 0129 · LOS MENSAJES DEL AGENTE EXPERTO — orden del 17-ago: "los mensajes
-- que ya estén hechos los haga un agente experto según toda la info".
--
-- El Cerebro guarda AQUÍ el primer toque redactado por LLM (rol marketing,
-- models.ts) con toda la info del prospecto: empresa, decisor, la CAUSA
-- (su vacante textual, su giro, su plaza). El botón de WhatsApp/correo abre
-- con ESTE mensaje; la plantilla determinista queda de respaldo para los
-- aún no trabajados. Regenerar sobreescribe — el historial fino no vale una
-- tabla: el mensaje bueno es el vigente y Javier lo edita al mandar.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.prospecto
  add column if not exists mensaje_wa            text,
  add column if not exists mensaje_correo_asunto text,
  add column if not exists mensaje_correo        text,
  add column if not exists mensajes_generados_en timestamptz,
  add column if not exists mensajes_modelo       text;

-- Coherencia: hay fecha de generación si y solo si hay al menos un mensaje,
-- y el modelo solo existe con la generación — un mensaje sin fecha ni firma
-- no dice quién lo pensó ni cuándo caducó.
alter table public.prospecto
  add constraint prospecto_mensajes_coherentes
    check ((mensajes_generados_en is null) = (mensaje_wa is null and mensaje_correo is null)),
  add constraint prospecto_mensajes_con_modelo
    check (mensajes_modelo is null or mensajes_generados_en is not null);
