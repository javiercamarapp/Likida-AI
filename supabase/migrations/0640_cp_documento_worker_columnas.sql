-- ═══════════════════════════════════════════════════════════════════════════
-- 0640 — Carta Porte: el worker que procesa la bandeja (columnas).
--
-- Hasta aquí un documento «recibido» solo se extraía si la misma petición que lo recibió alcanzaba el reloj
-- (correo, WhatsApp) o si alguien lo abría a mano; los de lease vencido y los de fallo reintentable
-- (modelo, presupuesto) se quedaban donde estaban. El cron `/api/cron/carta-porte-docs` los reclama con la
-- RPC de siempre (`cp_documento_reclamar`, 0420: lease + tope de 5 intentos) y esta migración le da:
--
--   · `avisos_oficina`: qué avisos a la oficina YA se reclamaron por documento (clave = tipo, valor = cuándo).
--     Es el candado de «avisar UNA vez por documento»: la RPC de la 0641 lo reclama con un UPDATE condicional
--     que NO sube `version` (un revisor con el documento abierto no recibe un falso conflicto de edición).
--   · un índice parcial para que el barrido del cron no recorra la tabla entera.
--
-- ESTADO TERMINAL: no se agrega un estado nuevo. Un documento `fallido` con `intentos >= 5` ya no lo reclama
-- nadie (la RPC de la 0420 lo excluye y la 0641 también): es terminal, queda visible en la bandeja con su
-- `ultimo_error` y la oficina se entera UNA vez (aviso `agotado`). Un archivo ilegible agota el contador de
-- inmediato (servicio.ts) para no pagarle al modelo por algo que no mejora reintentando.
--
-- Idempotente. El código funciona contra una base SIN esta migración (el cron cae a una consulta directa y
-- el aviso a la oficina queda apagado, con un warning, en vez de repetirse sin candado).
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.cp_documento
  add column if not exists avisos_oficina jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cp_documento_avisos_oficina_forma' and conrelid = 'public.cp_documento'::regclass) then
    alter table public.cp_documento
      add constraint cp_documento_avisos_oficina_forma check (jsonb_typeof(avisos_oficina) = 'object');
  end if;
end $$;

comment on column public.cp_documento.avisos_oficina is
  '0640: avisos a la oficina ya reclamados para este documento ({tipo: instante}; tipos: hallazgos, agotado). Candado de «una sola vez»; no sube `version`.';

-- El barrido del worker: lo que espera proceso (recibido), lo que tiene el lease vencido y lo fallido reintentable.
create index if not exists cp_documento_worker_idx
  on public.cp_documento (updated_at)
  where purgado_en is null and estado in ('recibido', 'procesando', 'fallido');
