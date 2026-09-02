-- ═══════════════════════════════════════════════════════════════════════════
-- 0303 — Gradúa los 9 agentes que 0301 marcó `experimental`, tras auditarlos
-- (2-sep-2026, a pedido de Javier: "construir los 9 agentes faltantes").
--
-- El reencuadre de la auditoría: los 9 NO estaban sin motor. Ya tenían el
-- motor honesto y acotado que 0301 describe — lo que 0301 marcó como
-- "experimental" fue precisamente ESE motor recortado frente a la promesa
-- original del catálogo (0125), no la ausencia de código. Se auditaron los
-- nueve completos, línea por línea, sobre origin/master:
--
--   · cazador, guiones, noticias_mercado, promos_diarias, seo_distribucion,
--     visuales, video_demo, video_marketing, pruebas — SIN bugs reales. Los
--     umbrales anti-alucinación (mínimos declarados antes de fabricar una
--     pieza) están bien implementados y verificados con cita de código.
--
-- Los dos hilos que la auditoría sí encontró NO son de estos 9 agentes en
-- sí, y se resuelven aparte:
--   · El símbolo `NORMAS` duplicado (`normas/indice.ts` vs `normas/corpus.ts`)
--     es DELIBERADO — dos representaciones de la misma fuente YAML, cada
--     una con su propio test de sincronización. No es un bug.
--   · La función `reservar_presupuesto_llm` con overload huérfano de 6
--     argumentos — retirada en la migración 0302, no afecta a estos 9.
--
-- Se gradúan los NUEVE, no una parte: los nueve pasaron la auditoría limpios.
-- Junto con la graduación, se corrigen dos columnas que quedaron
-- desactualizadas desde 0125 y que son, literalmente, la promesa falsa que
-- esta auditoría vino a cerrar:
--
--   · `descripcion` — 0125 la escribió ANTES del código y prometía de más
--     ("investiga a diario el mercado", "reactiva el scraper del censo",
--     "decide dónde se pone cada pieza"). Se corrige a lo que el motor
--     REAL hace hoy, verificado contra el código de
--     `src/lib/likida/agentes/{crecimiento,leads,ingenieria_producto}.ts`.
--   · `prompt_ref` — apuntaba a 9 archivos markdown que NUNCA se
--     escribieron (confirmado: no existen en el repo). El código de estos
--     nueve es determinista — no llama a un modelo con un prompt externo —
--     así que la referencia no aplica; se deja NULL en vez de una promesa
--     colgante. La frontera server/local real que reemplaza a esos
--     documentos vive, para 7 de los 9, en `scripts/mejora-diaria/encargos/`
--     (las rutinas locales de Javier con whisper/Higgsfield/ElevenLabs).
--
-- Panel: antes de esta auditoría, `experimental` no se veía en ningún
-- panel — `/admin/agentes` pintaba estos 9 como `vivo`, idéntico a uno que
-- sí corre, sin ninguna señal de por qué nunca aparecía una corrida. Mismo
-- commit que esta migración: `listarAgentes()`/`/admin/agentes` ya exponen
-- `experimental` con una etiqueta visible.
-- ═══════════════════════════════════════════════════════════════════════════

update public.agente_definicion set
  experimental = false,
  prompt_ref = null,
  descripcion = case id
    when 'cazador' then 'Mira el censo que YA está en `prospecto` y dice dónde cazar (perfil de quién convierte, celdas giro×ciudad sin tocar, nuevos sin contactar) — no navega la web ni da de alta prospectos; el scraper del censo vive en otro repo.'
    when 'guiones' then 'Guion semanal de video destilado de un artículo ya publicado, con hooks citados — no transcribe audio con whisper (sin motor local en el servidor); la rutina local guiones-semanal sigue siendo el motor real de esa parte.'
    when 'noticias_mercado' then 'Carrusel de noticias del mercado con fuente citada por dato, sobre el índice normativo verificado (`NORMAS`) — no investiga la web a diario; la rutina local noticias-diaria cubre esa parte.'
    when 'promos_diarias' then 'La promo del día con un beneficio real, verificado contra el motor de la calculadora en cada corrida — no fabrica una promo sin respaldo medido, ni compone la pieza gráfica.'
    when 'seo_distribucion' then 'Audita título, meta-descripción y slugs de los artículos ya publicados contra el sitemap — no decide posiciones ni rankings (Likida no tiene Search Console conectado).'
    when 'visuales' then 'Brief + copy verificado contra el motor + prompt listo para la skill likida-post — no genera la imagen; el pipeline con Higgsfield vive en el flujo local de Javier.'
    when 'video_demo' then 'Guion de 45 segundos para el video de demo, con marcas de tiempo — no genera el video; ElevenLabs y seedance viven en el flujo local de Javier.'
    when 'video_marketing' then 'Guion de 30 segundos por artículo para el reel de marketing — no genera el video; mismo flujo local que video_demo.'
    when 'pruebas' then 'Vigía de corridas fallidas y patrones de error repetidos, con un encargo textual para la rutina local — no corre la suite: desde una función serverless no hay repo, vitest ni tsc.'
    else descripcion
  end
where id in (
  'cazador', 'seo_distribucion', 'guiones', 'noticias_mercado',
  'promos_diarias', 'visuales', 'video_demo', 'video_marketing', 'pruebas'
);
