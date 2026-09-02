-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORÍA 24 · BE-3 (ALTO, reincidente desde la 23) + DAT-7 (MEDIO)
-- CANCELAR UNA FACTURA Y ABONARLE SE SERIALIZAN EN LA BASE; LA COBRANZA
-- TIENE TECHO.
--
-- ── BE-3 · `cancelarFactura` contaba y cancelaba en dos viajes ─────────────
--
-- `facturacion_escritura.ts` hacía `count` de `pago_recibido` y DESPUÉS
-- `update factura_emitida set estatus='cancelada'`. Entre los dos cabe un
-- abono: el contralor pulsa Cancelar sobre F-100 ($34,800, cero pagos);
-- en esa ventana el contador concilia $10,000 (`registrar_pago_tx` traba la
-- factura, inserta, la deja `emitida` porque no salda); el UPDATE encuentra
-- `emitida` y cancela. Resultado: $10,000 conciliados contra un CFDI que
-- ante el SAT ya no existe, y la liga de pago revocada sobre dinero real.
--
-- Es el mismo patrón select-luego-update que `registrarPago` abandonó en la
-- 0159 por un RPC con `for update`. Aquí se hace lo mismo:
-- `cancelar_factura_tx` traba la factura, cuenta los pagos CON LA FILA
-- TRABADA y cancela en la misma transacción. Un abono concurrente espera a
-- que la cancelación termine y entonces lo rechaza el trigger de abajo (la
-- factura ya está cancelada); o entra antes, y entonces la cancelación cuenta
-- 1 y rebota. No hay intercalado posible.
--
-- ── DAT-7 · `pago_recibido` aceptaba cualquier cosa ────────────────────────
--
-- Ejecutado en la auditoría: factura A-1 total 1,160, pago 999,999 →
-- aceptado (`factura_saldo.saldo = -998,839`); pago sobre una CANCELADA →
-- aceptado; `factura_emitida.estatus='pagada'` con cero pagos → aceptado. El
-- RPC `registrar_pago_tx` sí aplica las reglas, pero es UN escritor: un
-- insert directo (script, consola, un escritor futuro) se las salta enteras y
-- el dashboard de cobranza del piloto puede enseñar saldos negativos y
-- «pagadas» sin dinero. El REP (`rep_emitido`) se construye sobre esta tabla.
--
-- Dos triggers, con errcode 23514 (check_violation) para que se lean como lo
-- que son —una regla de dominio— y `constraint` con nombre, como un CHECK:
--
--   · `pago_recibido_techo`: la suma de abonos no rebasa el total (+0.01 de
--     redondeo) y no se abona una factura CANCELADA. Toma la factura `for
--     update` ANTES de sumar, así que dos inserts directos simultáneos se
--     serializan igual que en el RPC — y se serializan también contra
--     `cancelar_factura_tx`. Un `borrador` NO se rechaza aquí a propósito: el
--     RPC ya lo rechaza (CU011) y hay bloques de verificación anteriores que
--     abonan facturas con el estatus por defecto; romperlos no compra nada.
--   · `factura_pagada_con_pagos`: nadie deja `estatus='pagada'` sin que los
--     abonos cubran el total (−0.01). `registrar_pago_tx` inserta el abono y
--     DESPUÉS marca `pagada` en la misma transacción, así que pasa; un UPDATE
--     suelto, no. (Aviso: `scripts/demo-5k.sql` inserta facturas ya `pagada`
--     y sus abonos después — ese script tiene que invertir los dos bloques.)
--
-- La regla «fecha del pago ≥ fecha de la factura» que proponía DAT-7 NO se
-- pone: un anticipo cobrado antes de timbrar es un caso real en flotas y
-- rechazarlo inventaría una regla que el SAT no impone.
--
-- Todo idempotente: `create or replace`, `drop trigger if exists` antes de
-- cada `create trigger`. `security invoker` y `search_path = public, pg_temp`,
-- iguales a `registrar_pago_tx` (0237), su hermana.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. cancelar_factura_tx: contar y cancelar con la factura trabada ────────
create or replace function public.cancelar_factura_tx(
  p_tenant  uuid,
  p_factura uuid
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_estatus text;
  v_pagos   integer;
begin
  -- El tenant SIEMPRE en el where: el id de una factura ajena no puede
  -- trabarla ni cancelarla (mismo CU010 que registrar_pago_tx).
  select estatus into v_estatus
    from factura_emitida
   where id = p_factura and tenant_id = p_tenant
     for update;

  if not found then
    raise exception 'factura % fuera de la flota %', p_factura, p_tenant
      using errcode = 'CU010';
  end if;

  -- Ya con la fila trabada: ningún abono puede estar entrando sobre ESTA
  -- factura mientras se cuenta (registrar_pago_tx y el trigger de abajo
  -- toman el mismo candado).
  select count(*) into v_pagos
    from pago_recibido
   where factura_id = p_factura and tenant_id = p_tenant;

  if v_pagos > 0 then
    raise exception 'motivo=con_pagos pagos=%', v_pagos using errcode = 'CU016';
  end if;

  -- Solo borrador o emitida se cancelan desde aquí. Una `pagada` tiene dinero
  -- (el trigger de abajo lo garantiza) y una `cancelada` ya lo está.
  if v_estatus not in ('borrador', 'emitida') then
    raise exception 'motivo=estatus estatus=%', v_estatus using errcode = 'CU016';
  end if;

  update factura_emitida set estatus = 'cancelada'
   where id = p_factura and tenant_id = p_tenant;

  return jsonb_build_object('factura_id', p_factura, 'estatus_previo', v_estatus);
end $$;

comment on function public.cancelar_factura_tx(uuid, uuid) is
  'Cancela una factura SIN pagos con la fila trabada (for update): el conteo de abonos y el cambio de estatus ocurren en una transacción, así que un abono concurrente no puede dejar un CFDI cancelado con dinero encima (BE-3, auditoría 24). CU010 = factura fuera de la flota; CU016 motivo=con_pagos|estatus = rechazo de negocio. La revocación de las ligas de pago sigue del lado de la app, DESPUÉS de esto.';

-- Solo service_role. El `revoke from public` NO basta: Supabase concede EXECUTE
-- explícito a anon/authenticated por default privileges (lección de la 0013).
revoke execute on function public.cancelar_factura_tx(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.cancelar_factura_tx(uuid, uuid) to service_role;

-- ── 2. El techo de los abonos ───────────────────────────────────────────────
create or replace function public.pago_recibido_techo()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_total   numeric;
  v_estatus text;
  v_pagado  numeric;
begin
  -- Se busca SOLO por id: si la factura no existe o es de otra flota, la FK
  -- (0049/0145) lo dice con sus propias palabras (23503), no este trigger.
  select total, estatus into v_total, v_estatus
    from factura_emitida
   where id = new.factura_id
     for update;
  if not found then
    return new;
  end if;

  if v_estatus = 'cancelada' then
    raise exception 'pago_recibido: la factura % está cancelada; un abono sobre un CFDI cancelado es dinero contra nada', new.factura_id
      using errcode = '23514', constraint = 'pago_sobre_factura_viva';
  end if;

  if tg_op = 'UPDATE' then
    select coalesce(sum(monto), 0) into v_pagado
      from pago_recibido
     where factura_id = new.factura_id and id <> old.id;
  else
    select coalesce(sum(monto), 0) into v_pagado
      from pago_recibido
     where factura_id = new.factura_id;
  end if;

  if v_pagado + new.monto > v_total + 0.01 then
    raise exception 'pago_recibido: el abono de % deja la factura % sobrepagada (pagado %, total %)', new.monto, new.factura_id, v_pagado, v_total
      using errcode = '23514', constraint = 'pago_dentro_de_saldo';
  end if;

  return new;
end $$;

drop trigger if exists pago_recibido_techo on public.pago_recibido;
create trigger pago_recibido_techo
  before insert or update of monto, factura_id on public.pago_recibido
  for each row execute function public.pago_recibido_techo();

comment on function public.pago_recibido_techo() is
  'DAT-7 (auditoría 24): la suma de abonos no rebasa el total de la factura (+0.01) y no se abona una factura cancelada. Toma la factura for update antes de sumar: dos abonos directos simultáneos se serializan, y también contra cancelar_factura_tx. errcode 23514 con constraint nombrada, como un CHECK.';

-- ── 3. «pagada» solo con el dinero encima ──────────────────────────────────
create or replace function public.factura_pagada_con_pagos()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_pagado numeric;
begin
  if new.estatus <> 'pagada' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.estatus = 'pagada' then
    return new;   -- ya lo estaba: no es esta escritura la que lo afirma
  end if;

  select coalesce(sum(monto), 0) into v_pagado
    from pago_recibido
   where factura_id = new.id;

  if v_pagado < new.total - 0.01 then
    raise exception 'factura_emitida: la factura % no puede quedar «pagada» con % abonados de %', new.id, v_pagado, new.total
      using errcode = '23514', constraint = 'factura_pagada_con_pagos';
  end if;

  return new;
end $$;

drop trigger if exists factura_pagada_con_pagos on public.factura_emitida;
create trigger factura_pagada_con_pagos
  before insert or update of estatus, total on public.factura_emitida
  for each row execute function public.factura_pagada_con_pagos();

comment on function public.factura_pagada_con_pagos() is
  'DAT-7 (auditoría 24): una factura no queda «pagada» sin abonos que cubran su total (−0.01). registrar_pago_tx inserta el abono y marca pagada en la misma transacción, así que pasa; un UPDATE suelto o un INSERT ya «pagada» sin dinero, no.';
