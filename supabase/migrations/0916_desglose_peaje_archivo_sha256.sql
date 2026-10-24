-- REVERSA: drop index if exists public.desglose_peaje_archivo_sha256_unico; alter table public.desglose_peaje drop constraint if exists desglose_peaje_archivo_sha256_forma; alter table public.desglose_peaje drop column if exists archivo_sha256; (los desgloses ya importados no se tocan; el código tolera la ausencia de la columna)
-- ═══════════════════════════════════════════════════════════════════════════
-- 0916 · desglose_peaje.archivo_sha256: la subida manual del MISMO archivo es idempotente (A37-S47-02)
--
-- La subida manual de un desglose (`app/dashboard/agentes/peajes/page.tsx`) llamaba a `importarDesglose` sin `ingestaArchivoId`, y
-- el único candado de idempotencia (`desglose_peaje_ingesta_unica`, 0376) solo existe para los archivos de la cola. Un doble clic en
-- «Subir», o resubir el mismo Excel con otro nombre, creaba DOS desgloses; cada uno cuadraba los mismos gastos y producía su propia
-- bitácora RMF 9.1.8: si el contador sumaba ambas, el monto conciliado y el estímulo de peaje se duplicaban.
--
-- ADITIVA E IDEMPOTENTE: una columna nullable (los desgloses previos quedan en NULL: no compiten) y un índice único PARCIAL por
-- (flota, huella) sobre los desgloses vigentes. Anular un desglose (`anulado_en`, 0563) libera la huella: re-subir tras anular es el
-- flujo normal de corrección. Compatible hacia atrás: el código desplegado hoy no conoce la columna y sigue insertando sin ella.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.desglose_peaje
  add column if not exists archivo_sha256 text;

do $$ begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'desglose_peaje_archivo_sha256_forma' and conrelid = 'public.desglose_peaje'::regclass
  ) then
    alter table public.desglose_peaje
      add constraint desglose_peaje_archivo_sha256_forma
      check (archivo_sha256 is null or archivo_sha256 ~ '^[0-9a-f]{64}$');
  end if;
end $$;

create unique index if not exists desglose_peaje_archivo_sha256_unico
  on public.desglose_peaje (tenant_id, archivo_sha256)
  where archivo_sha256 is not null and anulado_en is null;

comment on column public.desglose_peaje.archivo_sha256 is
  'SHA-256 (hex) de los bytes del archivo subido. NULL = desglose anterior a la 0916. Único por flota entre los desgloses vigentes (no anulados): el mismo archivo no se importa dos veces.';
