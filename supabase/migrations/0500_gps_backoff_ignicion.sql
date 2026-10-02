-- ═══════════════════════════════════════════════════════════════════════════
-- 0500 · GPS: BACKOFF POR PROVEEDOR Y MODELO COMÚN DE POSICIÓN (ignición)
--
-- LOOP PUNTA A PUNTA, W3 «GPS/Jornada» (rango de migraciones 0500-0519).
--
-- 1. Ahora que Wialon, Geotab, Navixy y el genérico traen posiciones (como
--    Samsara), una flota con la credencial vencida o un proveedor caído NO puede
--    seguir martillando al proveedor cada 5 minutos: una contraseña de Geotab
--    mala sigue siendo mala, y 10 intentos de Authenticate por minuto bloquean la
--    cuenta del cliente. `conector_poll_estado` aprende la falla: cuántas
--    seguidas, de qué clase y desde cuándo NO se reclama de nuevo.
--      · credencial / formato → 15 min · 2^(n-1), tope 6 h (reintentar no lo arregla)
--      · proveedor            → 1 min  · 2^(n-1), tope 30 min (transitorio)
--    Un poll completo reinicia el contador. Un poll incompleto SIN falla
--    (huérfanas, backlog por presupuesto) no cuenta como falla ni espacia nada.
-- 2. `posicion.ignicion`: parte del modelo común (unidad, lat/lon, velocidad,
--    rumbo, ignición, fecha UTC). NULL = el proveedor no la reporta (no es lo
--    mismo que apagada).
--
-- Se reescriben ENTERAS `reclamar_polls_conector` y `finalizar_poll_conector`
-- (cuerpos de 0324 + lo nuevo). `finalizar` gana `p_falla` como ÚLTIMO parámetro
-- con default: las llamadas posicionales de 14 argumentos de 0324 siguen válidas.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.posicion add column if not exists ignicion boolean;
comment on column public.posicion.ignicion is
  'Ignición reportada por el proveedor. NULL = no la reporta (no equivale a apagada).';

alter table public.conector_poll_estado
  add column if not exists errores_seguidos integer not null default 0,
  add column if not exists proximo_intento_en timestamptz,
  add column if not exists ultima_falla text;
alter table public.conector_poll_estado drop constraint if exists conector_poll_falla_dominio;
alter table public.conector_poll_estado add constraint conector_poll_falla_dominio
  check (ultima_falla is null or ultima_falla in ('credencial', 'proveedor', 'formato'));
alter table public.conector_poll_estado drop constraint if exists conector_poll_errores_sanos;
alter table public.conector_poll_estado add constraint conector_poll_errores_sanos
  check (errores_seguidos >= 0 and errores_seguidos < 1000000);

comment on column public.conector_poll_estado.errores_seguidos is
  'Fallas consecutivas del proveedor (credencial/proveedor/formato). 0 tras un poll completo.';
comment on column public.conector_poll_estado.proximo_intento_en is
  'Backoff: no se reclama antes de este instante. NULL = sin espera.';
comment on column public.conector_poll_estado.ultima_falla is
  'Clase de la última falla: credencial (vencida/rechazada), proveedor (caída/límite) o formato (200 con algo distinto a lo documentado).';

create or replace function public.reclamar_polls_conector(
  p_recurso text,
  p_proveedores text[],
  p_limite integer default 20,
  p_worker text default 'gps',
  p_lease_segundos integer default 360,
  p_ahora timestamptz default clock_timestamp()
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

revoke all on function public.reclamar_polls_conector(text, text[], integer, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.reclamar_polls_conector(text, text[], integer, text, integer, timestamptz) to service_role;

drop function if exists public.finalizar_poll_conector(
  uuid, text, text, uuid, boolean, timestamptz, boolean, timestamptz, timestamptz,
  integer, integer, integer, text, timestamptz
);
create or replace function public.finalizar_poll_conector(
  p_tenant uuid,
  p_proveedor text,
  p_recurso text,
  p_claim_token uuid,
  p_completo boolean,
  p_watermark_en timestamptz default null,
  p_tail_completo boolean default false,
  p_tail_watermark_en timestamptz default null,
  p_ultima_medida_en timestamptz default null,
  p_paginas integer default 0,
  p_elementos integer default 0,
  p_invalidos integer default 0,
  p_error text default null,
  p_ahora timestamptz default clock_timestamp(),
  p_falla text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if p_paginas < 0 or p_elementos < 0 or p_invalidos < 0 then
    raise exception 'conteos de poll negativos';
  end if;
  if p_falla is not null and p_falla not in ('credencial', 'proveedor', 'formato') then
    raise exception 'clase de falla inválida';
  end if;
  update public.conector_poll_estado
     set watermark_en = case when p_completo and p_watermark_en is not null
                             then greatest(coalesce(watermark_en, '-infinity'::timestamptz), p_watermark_en)
                             else watermark_en end,
         tail_watermark_en = case when p_tail_completo and p_tail_watermark_en is not null
                                  then greatest(coalesce(tail_watermark_en, '-infinity'::timestamptz), p_tail_watermark_en)
                                  else tail_watermark_en end,
         ultimo_poll_en = p_ahora,
         ultimo_completo_en = case when p_completo then p_ahora else ultimo_completo_en end,
         ultima_medida_en = case when p_ultima_medida_en is null then ultima_medida_en
                                 else greatest(coalesce(ultima_medida_en, '-infinity'::timestamptz), p_ultima_medida_en) end,
         paginas_ultima = p_paginas,
         elementos_ultima = p_elementos,
         eventos_invalidos_ultima = p_invalidos,
         eventos_invalidos_total = eventos_invalidos_total + p_invalidos,
         backlog_pendiente = not p_completo,
         ultimo_error = case when p_completo then null else left(coalesce(p_error, 'poll incompleto'), 1000) end,
         -- 0500: contador y espera. Con falla: +1 y backoff exponencial según la
         -- clase. Sin falla (completo, o incompleto por huérfanas/backlog): se
         -- reinicia — no fue el proveedor el que falló.
         errores_seguidos = case when p_falla is null then 0 else least(errores_seguidos + 1, 1000) end,
         ultima_falla = p_falla,
         proximo_intento_en = case
           when p_falla is null then null
           when p_falla = 'proveedor'
             then p_ahora + least(interval '30 minutes', interval '1 minute' * power(2, least(errores_seguidos, 10)))
           else p_ahora + least(interval '6 hours', interval '15 minutes' * power(2, least(errores_seguidos, 10)))
         end,
         claim_token = null,
         claim_worker = null,
         claim_expires_at = null,
         actualizado_en = p_ahora
   where tenant_id = p_tenant
     and proveedor = p_proveedor
     and recurso = p_recurso
     and claim_token = p_claim_token;
  get diagnostics n = row_count;
  return n = 1;
end;
$$;

revoke all on function public.finalizar_poll_conector(uuid, text, text, uuid, boolean, timestamptz, boolean, timestamptz, timestamptz, integer, integer, integer, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.finalizar_poll_conector(uuid, text, text, uuid, boolean, timestamptz, boolean, timestamptz, timestamptz, integer, integer, integer, text, timestamptz, text) to service_role;
