-- REVERSA: drop function if exists public.reclamar_polls_conector(text, text[], integer, text, integer, timestamptz, timestamptz); y volver a aplicar el cuerpo de reclamar_polls_conector de supabase/migrations/0500_gps_backoff_ignicion.sql (create or replace + revoke/grant). Ninguna tabla cambia.
-- ═══════════════════════════════════════════════════════════════════════════
-- 0866 · reclamar_polls_conector: reparto justo en rondas (A37-S38-02)
--
-- El cron reclamaba solo 4 flotas por corrida de 5 min: con N flotas cada una
-- se sondeaba cada 5*ceil(N/4) min. El código ahora reclama en RONDAS dentro
-- de la misma corrida hasta agotar elegibles o reloj; para no volver a reclamar
-- a las ya iniciadas necesita `p_no_iniciados_desde`. ADITIVA: parámetro nuevo
-- al FINAL con default NULL (= 0500). Se reemplaza la firma de 6 args por la de
-- 7 (si convivieran, una llamada por nombre con 6 sería ambigua).
-- Idempotente: drop if exists + create or replace.
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists public.reclamar_polls_conector(text, text[], integer, text, integer, timestamptz);

create or replace function public.reclamar_polls_conector(
  p_recurso text,
  p_proveedores text[],
  p_limite integer default 20,
  p_worker text default 'gps',
  p_lease_segundos integer default 360,
  p_ahora timestamptz default clock_timestamp(),
  p_no_iniciados_desde timestamptz default null
)
returns table (
  tenant_id uuid,
  proveedor text,
  valores_cifrados text,
  claim_token uuid,
  watermark_en timestamptz,
  tail_watermark_en timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_recurso not in ('posiciones', 'eventos') then
    raise exception 'recurso de poll inválido';
  end if;
  if coalesce(array_length(p_proveedores, 1), 0) = 0 then
    return;
  end if;
  if p_limite < 1 or p_limite > 200 then
    raise exception 'p_limite fuera de 1..200';
  end if;
  if p_lease_segundos < 30 or p_lease_segundos > 600 then
    raise exception 'p_lease_segundos fuera de 30..600';
  end if;
  if btrim(coalesce(p_worker, '')) = '' or length(p_worker) > 120 then
    raise exception 'p_worker inválido';
  end if;

  return query
  with elegibles as materialized (
    select s.tenant_id, s.proveedor, s.recurso
      from public.conector_poll_estado s
      join public.conector_credencial c
        on c.tenant_id = s.tenant_id
       and c.conector_id = s.proveedor
       and c.activo
     where s.recurso = p_recurso
       and s.proveedor = any (p_proveedores)
       and (s.claim_token is null or s.claim_expires_at <= p_ahora)
       -- 0500: el backoff por falla. Un proveedor en espera NO se reclama y
       -- tampoco consume el límite del lote.
       and (s.proximo_intento_en is null or s.proximo_intento_en <= p_ahora)
       -- 0866 (A37-S38-02): reparto justo en rondas. Con p_no_iniciados_desde la
       -- ronda N+1 NO vuelve a reclamar una flota ya iniciada en esta corrida:
       -- sin esto, tras agotar a las nuevas reclamaría de nuevo a las ya
       -- sondeadas. NULL = comportamiento de la 0500.
       and (p_no_iniciados_desde is null
            or s.ultimo_inicio_en is null
            or s.ultimo_inicio_en < p_no_iniciados_desde)
     order by s.ultimo_inicio_en asc nulls first, s.tenant_id, s.proveedor
     limit p_limite
     for update of s skip locked
  ), reclamados as (
    update public.conector_poll_estado s
       set claim_token = gen_random_uuid(),
           claim_worker = p_worker,
           claim_expires_at = p_ahora + make_interval(secs => p_lease_segundos),
           ultimo_inicio_en = p_ahora,
           actualizado_en = p_ahora
      from elegibles e
     where s.tenant_id = e.tenant_id
       and s.proveedor = e.proveedor
       and s.recurso = e.recurso
    returning s.tenant_id, s.proveedor, s.claim_token, s.watermark_en, s.tail_watermark_en
  )
  select r.tenant_id, r.proveedor, c.valores_cifrados, r.claim_token, r.watermark_en, r.tail_watermark_en
    from reclamados r
    join public.conector_credencial c
      on c.tenant_id = r.tenant_id and c.conector_id = r.proveedor
   order by r.tenant_id, r.proveedor;
end;
$$;

revoke all on function public.reclamar_polls_conector(text, text[], integer, text, integer, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.reclamar_polls_conector(text, text[], integer, text, integer, timestamptz, timestamptz) to service_role;
