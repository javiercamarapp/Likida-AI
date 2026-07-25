-- Campos ricos del OCR de tickets (calibración con corpus real): folio
-- normalizado (sin padding, lo que piden los portales) + datos extra en jsonb.

alter table gasto add column if not exists folio_norm text;
alter table gasto add column if not exists ocr_extra jsonb;
