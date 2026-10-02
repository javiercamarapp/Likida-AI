-- 0562 — Retención de datos personales de los Agentes 1 y 2 que nadie purgaba.
--
-- Las RPC de purga de `wa_ventana_contacto` y `wa_envio_registro` existen desde
-- la 0368 pero ningún cron las llamaba; `liquidacion_externa` (nombre del chofer
-- vía operador, importes, PDF en Storage) y los archivos de peajes que FALLARON
-- (la 0376 conserva su contenido hasta 4 MB «para reintentar») no tenían ninguna.
-- Esta migración añade las dos que faltan; el cron `purgar` llama las cuatro.
--
-- ── purgar_liquidacion_externa ───────────────────────────────────────────────
-- Borra liquidaciones externas en estado TERMINAL con más de `p_meses` meses
-- (default 60 = cinco años: CFF art. 30 para la documentación de pago, y por
-- encima del plazo laboral). Piso de 24 meses: ninguna llamada puede acortarlo
-- por debajo de lo que un contralor todavía cruza contra su contabilidad. Una
-- liquidación NO terminal (pendiente/en_cola) jamás se purga. El PDF que vive en
-- el bucket `liquidaciones` se ENCOLA en `storage_huerfano_candidato` (Supabase
-- prohíbe borrar objetos desde SQL; el cron `purgar` los borra por la API). La
-- bitácora de eventos se va por cascada.
-- NOTA DE POLÍTICA: la cancelación ARCO del operador NO anonimiza estas filas
-- (retención fiscal/laboral); caducan aquí.
--
-- ── purgar_peaje_archivos_fallidos ───────────────────────────────────────────
-- Un archivo de desglose que quedó `fallida` conserva su `contenido` (el CHECK
-- `peaje_ingesta_archivo_contenido_coherente` lo permite). Pasados `p_dias` (30)
-- el contenido se pone en NULL: la fila queda de constancia (huella, nombre,
-- error) y deja de acumular hasta 4 MB por archivo. Un `fallida` sin contenido ya
-- no se puede reprocesar: hay que volver a subir el archivo.
-- Solo service_role.

create or replace function public.purgar_liquidacion_externa(
  p_meses integer default 60, p_limite integer default 500, p_ahora timestamptz default now()
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_n integer; v_pdfs integer;
begin
  if p_meses < 24 or p_limite < 1 or p_limite > 5000 then
    raise exception 'parámetros de purga inválidos (p_meses >= 24, p_limite 1..5000)' using errcode = 'PU001';
  end if;
  with viejas as (
    select id, pdf_ruta from public.liquidacion_externa
     where estado in ('enviada', 'acusada', 'fallida')
       and created_at < p_ahora - make_interval(months => p_meses)
     order by created_at, id limit p_limite for update skip locked
  ), encoladas as (
    insert into public.storage_huerfano_candidato (bucket, nombre, motivo)
    select 'liquidaciones', pdf_ruta, 'retencion_liquidacion_externa' from viejas where pdf_ruta is not null
    on conflict (bucket, nombre) do nothing
    returning nombre
  ), borradas as (
    delete from public.liquidacion_externa l using viejas v where l.id = v.id returning l.id
  )
  select (select count(*) from borradas), (select count(*) from encoladas) into v_n, v_pdfs;
  return jsonb_build_object('borradas', v_n, 'pdfsEncolados', v_pdfs, 'parcial', v_n >= p_limite);
end $$;
revoke all on function public.purgar_liquidacion_externa(integer, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.purgar_liquidacion_externa(integer, integer, timestamptz) to service_role;
grant delete on table public.liquidacion_externa to service_role;
comment on function public.purgar_liquidacion_externa(integer, integer, timestamptz) is
  '0562: retención de liquidaciones externas terminales (60 meses por defecto, piso 24). Encola el PDF en storage_huerfano_candidato; la bitácora cae por cascada. Solo service_role.';

create or replace function public.purgar_peaje_archivos_fallidos(
  p_dias integer default 30, p_limite integer default 500, p_ahora timestamptz default now()
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_n integer;
begin
  if p_dias < 7 or p_limite < 1 or p_limite > 5000 then
    raise exception 'parámetros de purga inválidos (p_dias >= 7, p_limite 1..5000)' using errcode = 'PU001';
  end if;
  with viejos as (
    select id from public.peaje_ingesta_archivo
     where estado = 'fallida' and contenido is not null
       and recibida_en < p_ahora - make_interval(days => p_dias)
     order by recibida_en, id limit p_limite for update skip locked
  )
  update public.peaje_ingesta_archivo a set contenido = null
    from viejos v where a.id = v.id;
  get diagnostics v_n = row_count;
  return jsonb_build_object('vaciados', v_n, 'parcial', v_n >= p_limite);
end $$;
revoke all on function public.purgar_peaje_archivos_fallidos(integer, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.purgar_peaje_archivos_fallidos(integer, integer, timestamptz) to service_role;
comment on function public.purgar_peaje_archivos_fallidos(integer, integer, timestamptz) is
  '0562: vacía el contenido de los archivos de peajes fallidos con más de 30 días (la fila queda de constancia). Solo service_role.';
