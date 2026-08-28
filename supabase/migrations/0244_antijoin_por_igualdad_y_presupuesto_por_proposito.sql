-- 0244 · FRENTE D (escala): dos arreglos medidos con `explain analyze` local.
--
-- ── 1. D.20 · `anomalias_gasto_tenant`: el anti-join por `position()` ──────
--
-- El descarte de folios que en realidad son un CFDI conocido se hacía con
-- `position(u.uuid in g.concepto || '|' || g.folio) > 0` contra TODOS los
-- UUID del tenant: un Nested Loop con filtro de subcadena que ningún índice
-- puede servir y que crece con (grupos de folio × UUIDs del tenant).
--
-- MEDIDO en local (Postgres 17, 40 120 gastos de un tenant: 20 000 con UUID,
-- 20 120 sin UUID, 110 grupos de folio repetido):
--   ANTES:   Nested Loop Anti Join, `Join Filter: POSITION(...)`,
--            1 618 543 filas descartadas por el filtro — 934 ms el anti-join
--            (la función completa: 2 633 ms).
--   DESPUÉS: Index Only Scan sobre `uq_gasto_cfdi_uuid`, 110 sondas,
--            Heap Fetches: 0 — 178 ms la consulta completa (el anti-join en
--            sí: ~1.5 ms). Mismo resultado en las dos formas (50 grupos
--            reportados, 60 descartados).
--
-- La igualdad ES la pregunta original: el caso que el descarte protege es "el
-- ticket cuyo folio impreso ES el UUID" (duplicados.ts:53, literal). La
-- subcadena era un exceso de la implementación, no un requisito:
--   · `concepto` no puede contener un UUID — su CHECK (`gasto_concepto_dominio`)
--     lo limita a 9 palabras del catálogo, ninguna de 36 caracteres.
--   · el separador '|' no aparece en ningún UUID, así que una subcadena jamás
--     cruzaba la frontera concepto|folio.
--   · queda UN caso que la igualdad no cubre y la subcadena sí: un folio que
--     TRAE el UUID rodeado de texto ("REF <uuid>"). Se pierde a propósito y
--     se dice aquí: ese grupo pasaría a reportarse como folio_duplicado (un
--     aviso de más para que un humano mire), nunca como acusación falsa — y
--     no se ha visto un ticket así en el banco de QA de 91 fotos.
--
-- El índice parcial que sirve la igualdad YA EXISTE: `uq_gasto_cfdi_uuid`
-- (0065) es único parcial sobre (tenant_id, cfdi_uuid, cfdi_orden) WHERE
-- cfdi_uuid IS NOT NULL, y el CHECK `gasto_cfdi_uuid_minuscula` garantiza que
-- la columna ya está en minúsculas — `lower(g.folio)` casa directo.
--
-- Firma sin cambios; mismo molde 0150: SECURITY INVOKER, revoke/grant igual.

create or replace function public.anomalias_gasto_tenant(p_tenant uuid)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  with filas as (
    select
      id, viaje_id, monto,
      lower(coalesce(concepto, 'otro')) as concepto,
      nullif(folio, '') as folio,
      nullif(lower(cfdi_uuid), '') as uuid,
      case when cfdi_orden is not null and cfdi_orden > 0 then cfdi_orden::int else 1 end as orden
    from gasto
    where tenant_id = p_tenant
  ),
  -- a) mismo (uuid, orden) en 2+ viajes
  cfdi_grupos as (
    select uuid, orden,
      count(distinct viaje_id) as n_viajes,
      (array_agg(monto order by id))[1] as monto,
      (array_agg(id order by id))[1] as primer_id
    from filas
    where uuid is not null
    group by uuid, orden
    having count(distinct viaje_id) > 1
  ),
  cfdi_anomalias as (
    select
      g.primer_id,
      jsonb_build_object(
        'tipo', 'cfdi_duplicado',
        'detalle', 'CFDI ' || left(g.uuid, 8) || '…'
          || case when g.orden = 1 then '' else ' (partida ' || g.orden || ')' end
          || ' liquidado en ' || g.n_viajes || ' viajes',
        'monto', g.monto,
        'viajes', (
          select jsonb_agg(v.viaje_id order by v.primer)
          from (
            select f.viaje_id, min(f.id::text) as primer
            from filas f
            where f.uuid = g.uuid and f.orden = g.orden
            group by f.viaje_id
          ) v
        )
      ) as anomalia
    from cfdi_grupos g
  ),
  -- b) mismo (concepto, folio, monto) sin uuid en 2+ viajes
  folio_grupos as (
    select concepto, folio, monto as monto_llave,
      count(distinct viaje_id) as n_viajes,
      (array_agg(monto order by id))[1] as monto,
      (array_agg(id order by id))[1] as primer_id
    from filas
    where folio is not null and uuid is null
    group by concepto, folio, monto
    having count(distinct viaje_id) > 1
  ),
  folio_anomalias as (
    select
      g.primer_id,
      jsonb_build_object(
        'tipo', 'folio_duplicado',
        'detalle', 'Folio ' || g.folio || ' (' || g.concepto || ') liquidado en ' || g.n_viajes || ' viajes',
        'monto', g.monto,
        'viajes', (
          select jsonb_agg(v.viaje_id order by v.primer)
          from (
            select f.viaje_id, min(f.id::text) as primer
            from filas f
            where f.uuid is null and f.folio = g.folio and f.concepto = g.concepto and f.monto = g.monto_llave
            group by f.viaje_id
          ) v
        )
      ) as anomalia
    from folio_grupos g
    -- D.20 (0244): IGUALDAD contra el índice parcial `uq_gasto_cfdi_uuid`, ya
    -- sin barrer subcadenas contra todos los UUID del tenant. Ver cabecera:
    -- números del explain analyze y el único caso (UUID incrustado con texto
    -- alrededor) que se deja de descartar a propósito.
    where not exists (
      select 1 from gasto u
      where u.tenant_id = p_tenant
        and u.cfdi_uuid = lower(g.folio)
    )
  )
  select coalesce(jsonb_agg(anomalia order by bloque, primer_id), '[]'::jsonb)
  from (
    select 1 as bloque, primer_id, anomalia from cfdi_anomalias
    union all
    select 2 as bloque, primer_id, anomalia from folio_anomalias
  ) todas;
$$;

comment on function public.anomalias_gasto_tenant(uuid) is
  'Comprobantes repetidos ENTRE viajes de UNA flota (cfdi_duplicado por (uuid, orden); folio_duplicado por (concepto, folio, monto) sin uuid), jsonb array [{tipo, detalle, monto, viajes}] — misma regla que detectarDuplicadosEntreViajes (duplicados.ts). 0244 (D.20): el descarte de "folio que ES un UUID conocido" es igualdad contra uq_gasto_cfdi_uuid, ya no position() sobre texto — un folio con el UUID incrustado entre más texto deja de descartarse (se reporta de más, nunca acusación falsa). SECURITY INVOKER; p_tenant sin default.';

revoke all on function public.anomalias_gasto_tenant(uuid) from public, anon, authenticated;
grant execute on function public.anomalias_gasto_tenant(uuid) to service_role;

-- ── 2. D.23 · Presupuesto de IA con dimensión de PROPÓSITO ─────────────────
--
-- Hoy todo el gasto de modelo de un tenant sale de la misma bolsa diaria
-- (`p_tope_tenant_usd`): el OCR de un lote grande de fondo puede vaciar el
-- techo antes de que el chofer mande su ticket, y el camino interactivo — el
-- que tiene a una persona esperando en WhatsApp — se queda sin servicio por
-- culpa de un proceso que nadie está mirando.
--
-- Tres propósitos, dominio CERRADO con CHECK (completo, no hay más):
--   · 'interactivo' — hay una persona esperando la respuesta AHORA: el turno
--     de WhatsApp del chofer (agente + OCR de SU ticket + su audio), los chats
--     del dashboard (copiloto, onboarding, entrevista) y las subidas manuales.
--   · 'ocr_lote'    — extracción de comprobantes en fondo (piloto de visión
--     de facturación y lo que venga en lotes).
--   · 'fondo'       — agentes de back office (runner, analista, redactor).
--
-- LA RESERVA: los propósitos de fondo ('ocr_lote' y 'fondo') solo pueden
-- gastar hasta (tope_tenant − reserva_interactivo). El camino interactivo
-- puede usar el techo completo, incluida la reserva. Cuando un propósito de
-- fondo toca su parte, la RPC devuelve 'tope_proposito' y el llamador FALLA
-- CERRADO Y LO DICE (LlmBudgetExceededError scope 'proposito') — no se
-- encola ni se degrada en silencio: el trabajo de fondo se reintenta en su
-- siguiente corrida, que es su naturaleza.
--
-- La función de 6 argumentos (0186/0193) SE QUEDA INTACTA: el bloque 154 de
-- verificaciones.sql fija su cuerpo por regprocedure, y durante la ventana de
-- deploy el código viejo la sigue llamando — sus inserts caen en el default
-- 'fondo', que es el lado conservador (no pueden comerse la reserva del
-- chofer vía la función nueva). El TS nuevo llama SOLO la de 8 argumentos;
-- PostgREST resuelve el overload por nombres de argumento, sin ambigüedad.

alter table public.llm_presupuesto_reserva
  add column if not exists proposito text not null default 'fondo'
    check (proposito in ('interactivo', 'ocr_lote', 'fondo'));

-- La suma del día por (tenant, propósito) que hace la RPC en cada reserva.
create index if not exists llm_presupuesto_tenant_proposito_dia_idx
  on public.llm_presupuesto_reserva (tenant_id, proposito, created_at);

create or replace function public.reservar_presupuesto_llm(
  p_reserva_id uuid,
  p_tenant_id uuid,
  p_run_id uuid,
  p_reserva_usd numeric,
  p_tope_run_usd numeric,
  p_tope_tenant_usd numeric,
  p_proposito text,
  p_reserva_interactivo_usd numeric
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  usado_tenant numeric;
  usado_run numeric;
  usado_fondo numeric;
  inicio_dia_mx timestamptz;
begin
  -- Argumentos inválidos LANZAN (error de programación, no de presupuesto):
  -- la versión de 6 args devolvía false y eso se leía como "tope del tenant",
  -- que es una mentira sobre dinero.
  if p_reserva_usd is null or p_reserva_usd <= 0
     or p_tope_run_usd is null or p_tope_run_usd <= 0
     or p_tope_tenant_usd is null or p_tope_tenant_usd <= 0 then
    raise exception 'reservar_presupuesto_llm: montos inválidos (reserva=%, tope_run=%, tope_tenant=%)',
      p_reserva_usd, p_tope_run_usd, p_tope_tenant_usd;
  end if;
  if p_proposito is null or p_proposito not in ('interactivo', 'ocr_lote', 'fondo') then
    raise exception 'reservar_presupuesto_llm: propósito desconocido: %', p_proposito;
  end if;
  if p_reserva_interactivo_usd is null or p_reserva_interactivo_usd < 0
     or p_reserva_interactivo_usd > p_tope_tenant_usd then
    raise exception 'reservar_presupuesto_llm: reserva de interactivo fuera de rango: % (tope %)',
      p_reserva_interactivo_usd, p_tope_tenant_usd;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));
  -- Medianoche de HOY en hora de México, no en UTC (0193, ver 0161).
  inicio_dia_mx := date_trunc('day', now() at time zone 'America/Mexico_City') at time zone 'America/Mexico_City';

  select coalesce(sum(reservado_usd), 0) into usado_tenant
    from public.llm_presupuesto_reserva
   where tenant_id = p_tenant_id
     and created_at >= inicio_dia_mx
     and (estado = 'liquidado' or (estado = 'reservado' and expira_en > now()));
  if usado_tenant + p_reserva_usd > p_tope_tenant_usd then return 'tope_tenant'; end if;

  -- La RESERVA del camino interactivo: el fondo solo llega hasta
  -- (tope − reserva); el interactivo puede usar el techo completo.
  if p_proposito <> 'interactivo' then
    select coalesce(sum(reservado_usd), 0) into usado_fondo
      from public.llm_presupuesto_reserva
     where tenant_id = p_tenant_id
       and proposito <> 'interactivo'
       and created_at >= inicio_dia_mx
       and (estado = 'liquidado' or (estado = 'reservado' and expira_en > now()));
    if usado_fondo + p_reserva_usd > p_tope_tenant_usd - p_reserva_interactivo_usd then
      return 'tope_proposito';
    end if;
  end if;

  select coalesce(sum(reservado_usd), 0) into usado_run
    from public.llm_presupuesto_reserva
   where tenant_id = p_tenant_id
     and run_id = p_run_id
     and (estado = 'liquidado' or (estado = 'reservado' and expira_en > now()));
  if usado_run + p_reserva_usd > p_tope_run_usd then return 'tope_run'; end if;

  insert into public.llm_presupuesto_reserva(id, tenant_id, run_id, reservado_usd, estado, proposito)
  values (p_reserva_id, p_tenant_id, p_run_id, p_reserva_usd, 'reservado', p_proposito);
  return 'ok';
end;
$$;

comment on function public.reservar_presupuesto_llm(uuid, uuid, uuid, numeric, numeric, numeric, text, numeric) is
  'Reserva presupuesto de IA con dimensión de propósito (0244, D.23): interactivo | ocr_lote | fondo. El fondo solo gasta hasta (tope_tenant − reserva_interactivo); el interactivo usa el techo completo. Devuelve ok | tope_tenant | tope_proposito | tope_run — el llamador falla cerrado y le dice al usuario CUÁL techo, en español. La de 6 args (0186/0193) queda para la ventana de deploy; sus inserts caen en proposito=fondo.';

revoke all on function public.reservar_presupuesto_llm(uuid, uuid, uuid, numeric, numeric, numeric, text, numeric) from public, anon, authenticated;
grant execute on function public.reservar_presupuesto_llm(uuid, uuid, uuid, numeric, numeric, numeric, text, numeric) to service_role;

-- ── 3. D.23 · La PUERTA del panel: cuánto lleva HOY cada propósito ─────────
--
-- Invariante de la casa: lo que se construye se VE en un dashboard. Este
-- agregado alimenta /admin/consumo — cuánto lleva cada (flota, propósito)
-- hoy (día de MÉXICO, mismo corte que la RPC de reserva), partido en lo ya
-- liquidado y lo reservado vivo. El dinero no se muestrea (FE-8): se agrega
-- en la base y cruza la red un arreglo del tamaño flotas × 3 propósitos.

create or replace function public.presupuesto_ia_por_proposito()
returns jsonb
language sql
stable
set search_path = public, pg_catalog
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'tenantId', tenant_id,
    'tenantNombre', nombre,
    'proposito', proposito,
    'liquidadoUsd', liquidado,
    'reservadoVivoUsd', reservado_vivo,
    'n', n
  ) order by nombre, proposito), '[]'::jsonb)
  from (
    select r.tenant_id, t.nombre, r.proposito,
           coalesce(sum(r.reservado_usd) filter (where r.estado = 'liquidado'), 0) as liquidado,
           coalesce(sum(r.reservado_usd) filter (where r.estado = 'reservado' and r.expira_en > now()), 0) as reservado_vivo,
           count(*) as n
    from llm_presupuesto_reserva r
    join tenant t on t.id = r.tenant_id
    where r.created_at >= date_trunc('day', now() at time zone 'America/Mexico_City') at time zone 'America/Mexico_City'
    group by r.tenant_id, t.nombre, r.proposito
  ) s;
$$;

comment on function public.presupuesto_ia_por_proposito() is
  'El gasto de IA de HOY (día MX, mismo corte que reservar_presupuesto_llm) por (flota, propósito), partido en liquidado y reservado vivo — alimenta /admin/consumo (0244, D.23). SECURITY INVOKER; solo service_role.';

revoke all on function public.presupuesto_ia_por_proposito() from public, anon, authenticated;
grant execute on function public.presupuesto_ia_por_proposito() to service_role;
