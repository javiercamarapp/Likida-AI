-- 0280 · El mutex del viaje tiene DUEÑO, y el inbox ordena por la hora del
--        mensaje, no por la de nuestro servidor.
--
-- AUDITORÍA 24 (1-sep-2026). Dos hallazgos que comparten el mismo tema: la
-- base decidía un orden y una propiedad que en realidad no comprobaba.
--
-- ── BE-11 (MEDIO) · `unlock_viaje` borraba el lease de quien fuera ──────────
--
-- `viaje_lock` (0005) es un lease sin dueño: `unlock_viaje(p_viaje)` hace
-- `delete where viaje_id = p_viaje`, sin mirar QUIÉN lo tiene. Escenario
-- medido: el XML del chofer toma el lock a t0 con TTL 60 s; `consultarCFDI` +
-- `getGastos` + `updateGastoCfdiXml` + `saveCfdiXmlRaw` bajo carga (cada uno
-- hasta 8 s de tope) pasan de los 60. A t0+61 el «listo» toma el lock ya
-- expirado y empieza a cuadrar. A t0+70 el XML termina y su `finally` BORRA EL
-- LOCK DEL CIERRE. Un segundo «listo» entra, `getOpenViaje` todavía devuelve
-- el viaje (el primer cierre no ha commiteado) y corre el agente completo otra
-- vez: dos cuadres, dos juegos de PDF, dos «tu liquidación quedó cerrada» y
-- dos veces el costo del LLM. La 0187 le puso fencing tokens al claim del
-- mensaje; a este lock no.
--
-- Se le pone token: quien lo toma lo trae, y solo quien lo trae lo suelta. Un
-- lease VENCIDO se puede seguir tomando (es lo que lo hace un lease y no un
-- candado), pero soltarlo ya no lo puede hacer un tercero.
--
-- ── AGEN-6 (MEDIO) · el inbox ordena por la hora de NUESTRO servidor ───────
--
-- `wa_evento_pendiente.recibido_en` es `clock_timestamp()` del INSERT (0261),
-- o sea cuándo llegó el POST a Vercel. Meta entrega los mensajes de una ráfaga
-- en POSTs distintos y NO garantiza el orden entre ellos: con un reintento de
-- por medio, la foto que el chofer mandó a las 10:40:00.2 puede aterrizar a
-- las 10:40:03 y el «listo» que escribió a las 10:40:01.1 a las 10:40:01.4.
-- El orden y el candado causal de la 0187 —`(recibido_en, id)`— los ponen al
-- revés, el «listo» cierra sin la última foto, y esa foto cae después en «tu
-- viaje ya estaba cerrado». La liquidación es irreversible (0036/0037).
--
-- La hora del mensaje SÍ la tenemos: `evento->>'timestampMs'` (DAT-38, el
-- webhook ya la guarda). Se ordena por ella y `recibido_en` queda de
-- desempate para los eventos que no la traigan (QA, simulador, un timestamp
-- ilegible). El `id` sigue cerrando el orden total: sin él habría empates y el
-- candado causal de la 0187 podría dejar dos filas esperándose entre sí.
--
-- Idempotente. No borra datos. Las funciones se recrean con `create or
-- replace` salvo las dos que cambian de firma, que se dejan caer primero.

-- ── 1. El lock con dueño ───────────────────────────────────────────────────

alter table public.viaje_lock
  add column if not exists token uuid;

-- Cambia la firma (tercer parámetro), así que la vieja se retira: dejar las
-- dos vivas haría ambigua la llamada de dos argumentos.
drop function if exists public.try_lock_viaje(uuid, integer);
drop function if exists public.unlock_viaje(uuid);

-- Adquiere el lease de forma atómica y lo firma. Devuelve true si se obtuvo
-- (nuevo o lease expirado tomado), false si otro proceso lo tiene vigente.
create or replace function public.try_lock_viaje(
  p_viaje uuid,
  p_ttl_ms integer,
  p_token uuid default null
)
returns boolean
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  insert into public.viaje_lock (viaje_id, locked_until, token)
  values (p_viaje, now() + make_interval(secs => p_ttl_ms / 1000.0), p_token)
  on conflict (viaje_id) do update
    set locked_until = excluded.locked_until,
        token        = excluded.token
    where viaje_lock.locked_until < now();   -- sólo si el lease previo expiró
  return found;                              -- true = insertado o actualizado
end $$;

-- Libera el lease (best-effort; si no libera, expira por TTL) SOLO si el token
-- coincide. `is not distinct from` para que un lease sin token —los que ya
-- estén vivos cuando esto se aplique— lo siga soltando quien lo tomó sin él,
-- que era el contrato anterior; esas filas mueren solas por TTL.
create or replace function public.unlock_viaje(p_viaje uuid, p_token uuid default null)
returns void
language sql
set search_path = public, pg_catalog
as $$
  delete from public.viaje_lock
   where viaje_id = p_viaje
     and token is not distinct from p_token;
$$;

revoke execute on function public.try_lock_viaje(uuid, integer, uuid) from public;
revoke execute on function public.unlock_viaje(uuid, uuid) from public;
grant execute on function public.try_lock_viaje(uuid, integer, uuid) to service_role;
grant execute on function public.unlock_viaje(uuid, uuid) to service_role;

-- ── 2. El orden del inbox: la hora del MENSAJE ─────────────────────────────

-- La llave de orden de un evento, en milisegundos. IMMUTABLE para poder
-- indexarla y para que el planner la trate como constante dentro de la
-- consulta. El `~` es la guardia: `evento->>'timestampMs'` es texto que viene
-- de Meta, y un `::bigint` sobre algo que no es un número TUMBA el inbox
-- entero (no una fila: la función).
create or replace function public.wa_orden_evento(p_evento jsonb, p_recibido_en timestamptz)
returns bigint
language sql
immutable
set search_path = public, pg_catalog
as $$
  select case
           when p_evento ->> 'timestampMs' ~ '^[0-9]{1,15}$'
             then (p_evento ->> 'timestampMs')::bigint
           else (extract(epoch from p_recibido_en) * 1000)::bigint
         end;
$$;

revoke execute on function public.wa_orden_evento(jsonb, timestamptz) from public;
grant execute on function public.wa_orden_evento(jsonb, timestamptz) to service_role;

-- La firma vigente es la de la 0194 (lleva `tipo`), no la de la 0187.
create or replace function public.listar_wa_pendientes(p_limite integer)
returns table (id text, intentos integer, remitente text, tipo text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limite < 1 or p_limite > 200 then
    raise exception 'wa inbox list size must be between 1 and 200';
  end if;
  return query
  select w.id,
         w.intentos,
         coalesce(nullif(w.evento ->> 'from', ''), w.id) as remitente,
         w.evento ->> 'type' as tipo
    from public.wa_evento_pendiente w
   where w.procesado_en is null
     and w.intentos < 5
     and (w.lease_expires_at is null or w.lease_expires_at <= clock_timestamp())
     -- Si A1 del mismo chofer sigue vivo en otra instancia, A2 no debe ni
     -- aparecer como trabajo disponible. El claim repite la invariante abajo
     -- porque el listado es solo una optimización, no una frontera de verdad.
     -- AUDITORÍA 24 · AGEN-6: «anterior» es por la hora del MENSAJE.
     and not exists (
       select 1
         from public.wa_evento_pendiente anterior
        where anterior.procesado_en is null
          and anterior.intentos < 5
          and coalesce(nullif(anterior.evento ->> 'from', ''), anterior.id)
              = coalesce(nullif(w.evento ->> 'from', ''), w.id)
          and (public.wa_orden_evento(anterior.evento, anterior.recibido_en), anterior.recibido_en, anterior.id)
            < (public.wa_orden_evento(w.evento, w.recibido_en), w.recibido_en, w.id)
          and anterior.lease_expires_at > clock_timestamp()
     )
   order by public.wa_orden_evento(w.evento, w.recibido_en), w.recibido_en, w.id
   limit p_limite;
end;
$$;

revoke all on function public.listar_wa_pendientes(integer) from public, anon, authenticated;
grant execute on function public.listar_wa_pendientes(integer) to service_role;

create or replace function public.reclamar_wa_pendiente(
  p_id text,
  p_intentos integer,
  p_owner text,
  p_lease_seconds integer default 180
) returns table (id text, evento jsonb, intentos integer, claim_token uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.wa_evento_pendiente%rowtype;
  v_token uuid := gen_random_uuid();
begin
  if nullif(btrim(p_id), '') is null then return; end if;
  if nullif(btrim(p_owner), '') is null then
    raise exception 'wa inbox lease owner is required';
  end if;
  if p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception 'wa inbox lease seconds must be between 30 and 900';
  end if;

  select w.* into v_row
    from public.wa_evento_pendiente w
   where w.id = p_id
     and w.procesado_en is null
     and w.intentos < 5
     and w.intentos = p_intentos
     and (w.lease_expires_at is null or w.lease_expires_at <= clock_timestamp())
     -- Orden causal por chofer, impuesto en la base. Esto también cubre el
     -- caso en que un caller reclama A2 directamente y A1 no formó parte de
     -- su lote por estar arrendado a otra instancia.
     -- AUDITORÍA 24 · AGEN-6: «anterior» es por la hora del MENSAJE.
     and not exists (
       select 1
         from public.wa_evento_pendiente anterior
        where anterior.procesado_en is null
          and anterior.intentos < 5
          and coalesce(nullif(anterior.evento ->> 'from', ''), anterior.id)
              = coalesce(nullif(w.evento ->> 'from', ''), w.id)
          and (public.wa_orden_evento(anterior.evento, anterior.recibido_en), anterior.recibido_en, anterior.id)
            < (public.wa_orden_evento(w.evento, w.recibido_en), w.recibido_en, w.id)
     )
   for update skip locked;
  if not found then return; end if;

  return query
  update public.wa_evento_pendiente w
     set intentos = v_row.intentos + 1,
         claim_token = v_token,
         claim_owner = left(p_owner, 100),
         lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds)
   where w.id = v_row.id
   returning w.id, w.evento, w.intentos, w.claim_token;
end;
$$;
