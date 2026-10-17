-- ═══════════════════════════════════════════════════════════════════════════
-- 0791 — Carta Porte: formato `json` y causa de rechazo.
--
-- Qué es:
--   · Algunos clientes de la flota mandan el embarque como JSON (un API propio), no como Excel/PDF. Hasta hoy el
--     CHECK de formato de la 0420 no lo admitía y el documento caía al caso `correo`/texto plano. Aquí se
--     recrean los dos CHECK de formato (documento y perfil) con la lista vigente de la 0420 + 'json'.
--   · cp_documento.rechazo_causa: la CAUSA clasificada de un rechazo (columna nueva, nullable), para medir en los
--     insights por qué se rechazan los documentos. `rechazo_motivo` (texto libre, 0420) no se toca.
--
-- No redefine ninguna función. Los eventos (cp_documento_evento.tipo) ya se ampliaron en la 0790 y no se tocan.
-- Las filas existentes siguen válidas: la lista nueva es superset de la anterior y la columna nueva es NULL.
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.cp_documento drop constraint if exists cp_documento_formato_dominio;
alter table public.cp_documento add constraint cp_documento_formato_dominio
  check (formato in ('pdf_texto', 'pdf_escaneado', 'imagen', 'excel', 'csv', 'xml', 'correo', 'json')) not valid;
alter table public.cp_documento validate constraint cp_documento_formato_dominio;

alter table public.cp_perfil drop constraint if exists cp_perfil_formato_dominio;
alter table public.cp_perfil add constraint cp_perfil_formato_dominio
  check (formato in ('pdf_texto', 'pdf_escaneado', 'imagen', 'excel', 'csv', 'xml', 'correo', 'json')) not valid;
alter table public.cp_perfil validate constraint cp_perfil_formato_dominio;

alter table public.cp_documento add column if not exists rechazo_causa text;

alter table public.cp_documento drop constraint if exists cp_documento_rechazo_causa_dominio;
alter table public.cp_documento add constraint cp_documento_rechazo_causa_dominio
  check (rechazo_causa is null or rechazo_causa in (
    'suma_no_cuadra', 'falta_dato_critico', 'formato_ilegible', 'no_es_embarque',
    'duplicado', 'cliente_desconocido', 'tms_rechazo', 'otra')) not valid;
alter table public.cp_documento validate constraint cp_documento_rechazo_causa_dominio;

comment on column public.cp_documento.rechazo_causa is
  'Causa clasificada del rechazo (dominio cerrado, nullable). rechazo_motivo sigue siendo el texto libre.';
