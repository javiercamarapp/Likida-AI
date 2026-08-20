-- ═══════════════════════════════════════════════════════════════════════════
-- 0141 · EL TERCER MENSAJE NO TENÍA DÓNDE VIVIR (20-ago-2026).
--
-- La 0129 guardó `mensaje_wa` y `mensaje_correo` para el primer toque del
-- agente experto, pero la prospección siempre redactó TRES variantes
-- (WhatsApp, correo, LinkedIn DM) — el DM de LinkedIn se quedaba solo en los
-- archivos `.md` de la cola de marketing, nunca en la base. El Cerebro de
-- ventas no puede abrir un botón de LinkedIn con un mensaje que no existe
-- en la fila.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.prospecto
  add column if not exists mensaje_linkedin text;

comment on column public.prospecto.mensaje_linkedin is
  'DM de LinkedIn (<=400 caracteres) del primer toque, hermano de mensaje_wa/mensaje_correo (0129). NULL = no generado aun.';

-- Coherencia con la 0129: si hay generacion, puede o no haber LinkedIn (no
-- todo prospecto tiene URL de LinkedIn localizada), asi que NO se agrega al
-- constraint prospecto_mensajes_coherentes existente — ese sigue exigiendo
-- WhatsApp+correo, LinkedIn es opcional encima de esos dos.
