-- ═══════════════════════════════════════════════════════════════════════════
-- 0421 — ModelRole gana los tres peldaños del extractor de Carta Porte.
--
-- Mismo caso que la 0311: `agente_definicion_modelo_rol_dominio` tiene que
-- espejar `ModelRole` (src/lib/llm/models.ts) EXACTO, en las dos direcciones
-- (agente_definicion_modelo_rol_dominio.test.ts lo cruza). Esta migración
-- recrea el CHECK con la lista completa: los 14 de la 0311 más
-- `cartaporte_extractor`, `cartaporte_extractor_escala` y
-- `cartaporte_extractor_escala2` (Gemini 3.5 Flash-Lite → Gemini 3.8 Flash →
-- Sonnet 5.5, por confianza de campo).
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
       'piloto', 'transcripcion', 'contador',
       'cartaporte_extractor', 'cartaporte_extractor_escala', 'cartaporte_extractor_escala2'));
end $$;

comment on constraint agente_definicion_modelo_rol_dominio on public.agente_definicion is
  'Espeja ModelRole (src/lib/llm/models.ts) exacto (auditoría 25, DATOS-B1). La 0421 añade los tres roles del extractor de Carta Porte multi-formato. agente_definicion_modelo_rol_dominio.test.ts cruza las dos listas y falla si divergen.';
