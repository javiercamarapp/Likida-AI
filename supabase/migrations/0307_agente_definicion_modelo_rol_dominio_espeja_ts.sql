-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORÍA 25 · DATOS-B1 (BAJO) — `agente_definicion_modelo_rol_dominio` y
-- `ModelRole` (src/lib/llm/models.ts) divergieron en las DOS direcciones.
--
-- El CHECK admitía 13 (0125:25-27): ocr, cuadre, cuadre_fallback, chat,
-- chat_ligero, router, back_office, analisis, extraccion, marketing, codigo,
-- codigo_escritura, qa.
--
-- `ModelRole` (models.ts:39) tiene 14: los MISMOS menos `chat_ligero` y
-- `router`, MÁS `piloto`, `transcripcion` y `contador`.
--
--   · `chat_ligero`/`router` NO son un descuido: el comentario de
--     `models.ts:175-179` los marca «RETIRADOS el 23-ago-2026, no volver a
--     añadirlos sin llamador» — el conserje del chat del panel se colapsó y
--     la clasificación de mensajes es 100% regex. Retirarlos del CHECK cierra
--     el otro sentido del hallazgo: hoy una migración podría escribir
--     `modelo_rol = 'chat_ligero'` sin que la base se queje, y
--     `/admin/agentes` pintaría un rol que `models.ts` ya no sabe resolver.
--   · `piloto`/`transcripcion`/`contador` SÍ tienen llamador hoy
--     (models.ts:161-164: piloto en producción; contador en el examen dorado
--     E.26) — una migración que declarara `modelo_rol = 'piloto'` rebotaba
--     con 23514 y abortaba el deploy.
--
-- Se recrea el CHECK con la lista COMPLETA de `ModelRole`, mismo mecanismo
-- que 0044/0086/0105/0304 sobre otros dominios: soltar si existe y recrear.
-- Idempotente. Nadie escribe `modelo_rol` desde la app hoy (`darDeAltaAgente`
-- no lo incluye) y solo lo tocan migraciones (0125 misma), así que no hay
-- fila viva que quede fuera de la lista nueva al aplicarse.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'agente_definicion_modelo_rol_dominio' and conrelid = 'public.agente_definicion'::regclass
  ) then
    alter table public.agente_definicion drop constraint agente_definicion_modelo_rol_dominio;
  end if;

  alter table public.agente_definicion
    add constraint agente_definicion_modelo_rol_dominio check (modelo_rol is null or modelo_rol in
      ('ocr', 'cuadre', 'cuadre_fallback', 'chat', 'back_office', 'analisis',
       'extraccion', 'marketing', 'codigo', 'codigo_escritura', 'qa',
       'piloto', 'transcripcion', 'contador'));
end $$;

comment on constraint agente_definicion_modelo_rol_dominio on public.agente_definicion is
  'Espeja ModelRole (src/lib/llm/models.ts) exacto (auditoría 25, DATOS-B1): quita chat_ligero/router (retirados de TS el 23-ago-2026, sin llamador), agrega piloto/transcripcion/contador (con llamador en TS desde antes de esta migración). agente_definicion_modelo_rol_dominio.test.ts cruza las dos listas y falla si divergen.';
