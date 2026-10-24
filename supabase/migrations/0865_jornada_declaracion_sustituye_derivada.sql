-- ═══════════════════════════════════════════════════════════════════════════
-- 0865 — JORNADA: la DECLARACIÓN del chofer sustituye a la marca derivada viva
-- (hallazgo A37-S48-01, ALTO; LFT art. 132 fr. XXXIV, registro electrónico de la jornada).
--
-- DEFECTO: `asentarMarca` (jornada/repo.ts) insertaba la declaración del chofer con un INSERT simple y traducía CUALQUIER 23505
-- a «ya estaba». Pero el índice `jornada_asiento_marca_unica` (0241) permite UN solo inicio y UN solo fin vivos por expediente,
-- y el derivador (0319/0325) asienta primero el extremo desde el hito del viaje: si el chofer acepta un viaje a las 05:50 y a las
-- 06:10 manda «inicio jornada», la declaración rebotaba, se le contestaba «Ya lo tenía anotado» y la marca declarada NO se
-- guardaba (con el fin pasaba igual y además no recibía resumen ni petición de conformidad). El expediente se quedaba con la cota
-- derivada (dato insuficiente) y sin la declaración que da la prueba plena, mientras al chofer se le dijo que quedó anotado.
--
-- ARREGLO (en la BASE, molde 0325 `asentar_extremo_jornada_derivado`):
--   · `asentar_declaracion_jornada(...)`: bajo el `for update` del expediente (el mismo candado que el derivador),
--       - si NO hay marca viva del tipo → inserta la declarada ('asentado');
--       - si la viva es DERIVADA (hito_viaje / gps) → la ANULA con motivo y firma de sistema e inserta la declarada apuntándola
--         con `corrige_a` (append-only: el expediente conserva las dos versiones) ('asentado');
--       - si la viva es HUMANA (declarada o capturada por el contralor) → no pisa nada ('ya_estaba').
--     Es idempotente por `wa_message_id`: el mismo mensaje reentregado por Meta devuelve 'ya_estaba'.
--   · El derivador no cambia: ya se niega a tocar una marca humana (0325).
--   Compatible hacia atrás: no cambia tablas, índices ni firmas existentes; el código desplegado antes de esta migración sigue
--   con su INSERT (camino viejo) y el nuevo cae a él si la función aún no existe.
--
-- Aditiva e idempotente (`create or replace`). NO cambia RLS.
--
-- REVERSA:
--   drop function if exists public.asentar_declaracion_jornada(uuid, uuid, text, timestamptz, text, uuid, jsonb);
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.asentar_declaracion_jornada(
  p_jornada_id uuid,
  p_tenant_id uuid,
  p_tipo text,
  p_momento timestamptz,
  p_wa_message_id text,
  p_viaje_id uuid default null,
  p_detalle jsonb default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actual public.jornada_asiento%rowtype;
  v_nuevo_id uuid := gen_random_uuid();
  v_corrige uuid := null;
begin
  if p_jornada_id is null or p_tenant_id is null or p_momento is null then
    raise exception 'declared journey endpoint requires journey, tenant and timestamp';
  end if;
  if p_tipo not in ('inicio_jornada', 'fin_jornada') then
    raise exception 'declared journey endpoint type is invalid';
  end if;
  if nullif(btrim(p_wa_message_id), '') is null then
    raise exception 'declared journey endpoint requires the message id';
  end if;

  perform 1
    from public.jornada_dia d
   where d.id = p_jornada_id and d.tenant_id = p_tenant_id
   for update;
  if not found then raise exception 'journey day does not belong to tenant'; end if;

  -- El mismo mensaje reentregado: ya está (aunque su marca haya sido corregida después).
  if exists (
    select 1 from public.jornada_asiento a
     where a.jornada_id = p_jornada_id and a.tenant_id = p_tenant_id and a.wa_message_id = p_wa_message_id
  ) then
    return 'ya_estaba';
  end if;

  select a.* into v_actual
    from public.jornada_asiento a
   where a.jornada_id = p_jornada_id
     and a.tenant_id = p_tenant_id
     and a.tipo = p_tipo
     and a.anulado_en is null
   for update;

  if found then
    -- Una marca HUMANA viva (declarada o capturada por el contralor) no se pisa.
    if v_actual.procedencia not in ('hito_viaje', 'gps') then return 'ya_estaba'; end if;
    update public.jornada_asiento
       set anulado_en = clock_timestamp(),
           anulado_por_email = 'sistema:declaracion-operador@likida.internal',
           anulado_motivo = 'El operador declaró este extremo; su declaración prevalece sobre la marca derivada'
     where id = v_actual.id and tenant_id = p_tenant_id and anulado_en is null;
    v_corrige := v_actual.id;
  end if;

  insert into public.jornada_asiento (
    id, tenant_id, jornada_id, tipo, momento, procedencia, wa_message_id, viaje_id, detalle, corrige_a
  ) values (
    v_nuevo_id, p_tenant_id, p_jornada_id, p_tipo, p_momento, 'declarado_operador', p_wa_message_id, p_viaje_id,
    coalesce(p_detalle, '{}'::jsonb) || case when v_corrige is null then '{}'::jsonb else jsonb_build_object(
      'sustituye_marca_derivada_id', v_corrige,
      'sustituye_marca_derivada_momento', v_actual.momento
    ) end,
    v_corrige
  );
  return 'asentado';
end;
$$;

revoke all on function public.asentar_declaracion_jornada(uuid, uuid, text, timestamptz, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.asentar_declaracion_jornada(uuid, uuid, text, timestamptz, text, uuid, jsonb) to service_role;
