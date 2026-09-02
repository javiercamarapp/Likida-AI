-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORÍA 24 · DAT-4 (ALTO) + DAT-12 (MEDIO, reincidente DATOS-22-2)
-- — lo que ya se imprimió en un papel firmado deja de moverse, y el
--   complemento de pago gana piso y forma.
--
-- ── DAT-4 · el WHEN de la 0037 se quedó en las columnas de 2026-07 ────────
-- Con la liquidación YA emitida (PDF descargado), el escenario S21 corrió:
--   update gasto set monto = 1                  → CU001  (el trigger SÍ está)
--   update gasto set viaje_id = <otro viaje>    → ACEPTADO
--   update gasto set iva_retenido = 99999,
--                    isr_retenido = 99999,
--                    descuento    = 99999       → ACEPTADO
-- `descuento` nació en la 0171, las retenciones en la 0063 y la 0272 las
-- empezó a leer para la póliza: mover un gasto de viaje deja la póliza de
-- agosto reportando $0 de diésel en VJ-0001 y $99,999 de retenciones donde el
-- PDF firmado dice $640. El papel y la base divergen SIN TRAZA.
--
-- Dos cosas, no una:
--   (a) el WHEN gana `viaje_id`, `tenant_id`, `descuento`, `iva_retenido`,
--       `isr_retenido`, `img_hash` (la llave anti-duplicado de la foto) —
--       `cfdi_orden`, `concepto`, `forma_pago` y `clave_prod_serv` ya
--       entraron con la 0158;
--   (b) la FUNCIÓN mira las DOS puntas del movimiento. La de la 0036 solo
--       consultaba `new.viaje_id`: mover un gasto DESDE un viaje liquidado
--       HACIA uno abierto pasaba limpio, y es justo la mitad que rompe la
--       póliza ya emitida.
--
-- Y el mismo criterio para `viaje`: `fecha_inicio`, `fecha_fin`, `origen`,
-- `destino` y `cliente_id` están IMPRESOS en el PDF (S20: hoy se cambian
-- libremente después de liquidar).
--   · `unidad_id` queda FUERA a propósito: `operacion.ts:827` asigna la unidad
--     desde el tablero del encargado y ese dato se captura tarde de rutina
--     (los viajes que entran por WhatsApp nacen sin unidad, mig. 0047).
--     Trabarlo convertiría una captura normal en un CU004 sin que ninguna
--     cifra del papel cambie.
--   · `estatus` también queda fuera: pasa a `liquidado` DESPUÉS de insertar la
--     liquidación, en el mismo flujo de cierre.
--
-- ── DAT-12 · `cfdi_pago` sin piso ni forma ───────────────────────────────
-- Escenario S13: `cfdi_pago (imp_pagado = -500, cfdi_uuid 'AAAA…')` aceptado.
-- `uq_cfdi_pago_docto` existe (la 0199 lo puso), así que la unicidad está —
-- pero sin la forma en minúsculas `aaaa…` y `AAAA…` son DOS complementos
-- distintos para el índice y el mismo REP libera el IVA dos veces. La 0158
-- puso esta forma en cuatro tablas de CFDI; `cfdi_pago` nació después.
-- Un `imp_pagado` negativo, además, es un pago que resta: `pagado_en` se sella
-- con `ImpSaldoInsoluto = 0` y un saldo negativo lo dispararía al revés.
-- S27: `codigo_pendiente.monto = -100` aceptado — misma familia, mismo piso.
--
-- Idempotente en las dos mitades: `drop trigger if exists`, `create or
-- replace function`, y cada constraint bajo `if not exists (pg_constraint)`
-- con su normalización previa (el mismo molde de la 0158 §4, que NO fusiona
-- filas: si dos solo se distinguen por MAYÚSCULAS, se levanta y lo dice).
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · DAT-4 — el gasto de un viaje liquidado no se mueve ni se reescribe
-- ═══════════════════════════════════════════════════════════════════════════

-- MISMA función que la 0036 (la comparten el trigger de INSERT y el de
-- UPDATE), con la punta que faltaba. En INSERT `old` no está asignado, así que
-- la segunda mitad va bajo `tg_op = 'UPDATE'` — leer `old.viaje_id` en un
-- INSERT levanta «record "old" is not assigned yet», no null.
create or replace function gasto_no_tras_liquidar()
returns trigger
language plpgsql
as $$
declare ya boolean;
begin
  -- Serializa contra el cierre. No se usa el valor: se usa el candado.
  perform 1 from viaje where id = new.viaje_id for update;

  select exists (select 1 from liquidacion where viaje_id = new.viaje_id) into ya;
  if ya then
    raise exception 'el viaje % ya tiene liquidación emitida: el gasto llegó tarde', new.viaje_id
      using errcode = 'CU001';
  end if;

  -- AUDITORÍA 24, DAT-4: la punta DE DONDE SALE. Un gasto que se va de un
  -- viaje ya liquidado deja ese papel diciendo una cifra que la base ya no
  -- puede reproducir — el daño es idéntico al de agregarlo tarde.
  if tg_op = 'UPDATE' and old.viaje_id is distinct from new.viaje_id then
    perform 1 from viaje where id = old.viaje_id for update;
    select exists (select 1 from liquidacion where viaje_id = old.viaje_id) into ya;
    if ya then
      raise exception 'el viaje % ya tiene liquidación emitida: su gasto no se puede mover a otro viaje', old.viaje_id
        using errcode = 'CU001';
    end if;
  end if;

  return new;
end $$;

comment on function gasto_no_tras_liquidar() is
  'Impide agregar gastos a un viaje cuya liquidación YA se emitió, y (0283, DAT-4) MOVER un gasto fuera de uno liquidado: las dos puntas dejan el PDF firmado diciendo una cifra que la base ya no reproduce. Ver 0036 y 0283.';

-- El WHEN, con las columnas que la 0272 volvió parte de la póliza.
drop trigger if exists trg_gasto_no_tras_liquidar_update on gasto;
create trigger trg_gasto_no_tras_liquidar_update
  before update on gasto
  for each row
  when (
    new.monto is distinct from old.monto
    or new.sub_total is distinct from old.sub_total
    or new.iva_traslado is distinct from old.iva_traslado
    or new.ieps_traslado is distinct from old.ieps_traslado
    or new.cfdi_uuid is distinct from old.cfdi_uuid
    or new.fecha is distinct from old.fecha
    -- 0158 (DAT-07): concepto → política y tope; forma_pago → 28-V y el
    -- estímulo; clave_prod_serv → si el litro es diésel acreditable;
    -- cfdi_orden → qué caseta del CFDI consolidado cuenta.
    or new.concepto is distinct from old.concepto
    or new.forma_pago is distinct from old.forma_pago
    or new.clave_prod_serv is distinct from old.clave_prod_serv
    or new.cfdi_orden is distinct from old.cfdi_orden
    -- 0283 (DAT-4): a qué viaje pertenece y de qué flota es; el descuento
    -- (0171, base del estímulo de peaje); las retenciones (0063), que la 0272
    -- asienta como cuenta POR PAGAR; y el hash de la foto, que es la llave
    -- anti-duplicado (uq_gasto_img_hash, 0027) — reescribirlo deja entrar la
    -- misma foto otra vez.
    or new.viaje_id is distinct from old.viaje_id
    or new.tenant_id is distinct from old.tenant_id
    or new.descuento is distinct from old.descuento
    or new.iva_retenido is distinct from old.iva_retenido
    or new.isr_retenido is distinct from old.isr_retenido
    or new.img_hash is distinct from old.img_hash
  )
  execute function gasto_no_tras_liquidar();

-- `pagado_en` / `pagado_forma` NO entran al WHEN, y es deliberado: el
-- complemento de pago llega DESPUÉS del cierre por definición (un CFDI PPD se
-- cobra semanas más tarde) y `intake/rep.ts` los sella entonces. Trabarlos
-- cerraría el único camino por el que el IVA de un '99' se libera (LIVA 5-III).

-- El viaje: lo que el PDF ya imprimió.
drop trigger if exists trg_viaje_no_tras_liquidar on viaje;
create trigger trg_viaje_no_tras_liquidar
  before update of anticipo, operador_id, fecha_inicio, fecha_fin, origen, destino, cliente_id on viaje
  for each row
  when (
    new.anticipo is distinct from old.anticipo
    or new.operador_id is distinct from old.operador_id
    -- 0283 (DAT-4, S20): el encabezado del papel — cuándo, de dónde a dónde y
    -- para qué cliente. `unidad_id` y `estatus` quedan fuera; ver la cabecera.
    or new.fecha_inicio is distinct from old.fecha_inicio
    or new.fecha_fin is distinct from old.fecha_fin
    or new.origen is distinct from old.origen
    or new.destino is distinct from old.destino
    or new.cliente_id is distinct from old.cliente_id
  )
  execute function viaje_no_tras_liquidar();

comment on function viaje_no_tras_liquidar() is
  'DAT-07 (0158) + DAT-4 (0283). `anticipo` es el minuendo de `diferencia` y `operador_id` es a quién se le cobra; `fecha_inicio`/`fecha_fin`/`origen`/`destino`/`cliente_id` son el encabezado que el PDF ya imprimió. Editarlos con la liquidación emitida cambia la base del papel archivado sin tocar el papel.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · DAT-12 — el complemento de pago con piso y con forma
-- ═══════════════════════════════════════════════════════════════════════════

-- (a) La forma del UUID. Mismo molde que la 0158 §4: se comprueba primero que
--     bajar a minúsculas NO fusionaría dos filas distintas — eso no lo decide
--     una migración, son dos registros del mismo REP y alguien tiene que
--     mirar cuál se queda.
do $$
declare colisiones bigint; n bigint;
begin
  if not exists (select 1 from pg_constraint where conname = 'cfdi_pago_uuid_minuscula') then
    select count(*) into colisiones from (
      select tenant_id, lower(cfdi_uuid) u, lower(docto_relacionado_uuid) d
      from public.cfdi_pago group by 1, 2, 3 having count(*) > 1) x;
    if colisiones > 0 then
      raise exception
        'No se puede normalizar cfdi_pago: hay % par(es) que solo se distinguen por MAYÚSCULAS. Es el mismo complemento de pago registrado dos veces (IVA liberado dos veces). Decide cuál se queda antes de volver a aplicar.', colisiones;
    end if;

    update public.cfdi_pago
       set cfdi_uuid = lower(cfdi_uuid),
           docto_relacionado_uuid = lower(docto_relacionado_uuid)
     where cfdi_uuid is distinct from lower(cfdi_uuid)
        or docto_relacionado_uuid is distinct from lower(docto_relacionado_uuid);

    select count(*) into n from public.cfdi_pago
     where cfdi_uuid <> lower(cfdi_uuid) or docto_relacionado_uuid <> lower(docto_relacionado_uuid);
    if n > 0 then
      raise exception 'No se puede fijar cfdi_pago en minúsculas: quedan % fila(s) que no lo cumplen.', n;
    end if;

    alter table public.cfdi_pago
      add constraint cfdi_pago_uuid_minuscula
      check (cfdi_uuid = lower(cfdi_uuid) and docto_relacionado_uuid = lower(docto_relacionado_uuid));
  end if;
end $$;

comment on constraint cfdi_pago_uuid_minuscula on public.cfdi_pago is
  'DAT-12 (0283). Los dos UUID del REP en minúsculas, como en las otras cuatro tablas de CFDI (0158 §4). Sin esta forma, `uq_cfdi_pago_docto` deja entrar el MISMO complemento con el UUID en mayúsculas y el IVA del docto se libera dos veces (LIVA 5-III).';

-- (b) El piso. `imp_pagado` es cuánto se pagó y `imp_saldo_insoluto` cuánto
--     queda: ninguno de los dos puede ser negativo. `iva_pagado` tampoco —
--     `null` sigue siendo válido (el REP puede no desglosarlo).
alter table public.cfdi_pago drop constraint if exists cfdi_pago_importes_no_negativos;
alter table public.cfdi_pago
  add constraint cfdi_pago_importes_no_negativos check (
    imp_pagado >= 0
    and (imp_saldo_insoluto is null or imp_saldo_insoluto >= 0)
    and (iva_pagado is null or iva_pagado >= 0)
    and (num_parcialidad is null or num_parcialidad >= 1)
  ) not valid;

comment on constraint cfdi_pago_importes_no_negativos on public.cfdi_pago is
  'DAT-12 (0283). `intake/rep.ts` sella `gasto.pagado_en` cuando `imp_saldo_insoluto = 0`; un saldo negativo lo dispararía al revés y un `imp_pagado` negativo sería un pago que resta. `not valid`: aplica de aquí en adelante, no se afirma nada sobre lo ya ingerido.';

-- (c) El mismo piso para la cola de códigos: `codigo_pendiente` empareja por
--     (viaje, monto) y un monto negativo no empareja con ningún gasto real.
alter table public.codigo_pendiente drop constraint if exists codigo_pendiente_monto_no_negativo;
alter table public.codigo_pendiente
  add constraint codigo_pendiente_monto_no_negativo check (monto >= 0) not valid;

comment on constraint codigo_pendiente_monto_no_negativo on public.codigo_pendiente is
  'DAT-12 (0283). El emparejamiento de la cola es (viaje, monto) — un monto negativo no corresponde a ningún gasto. `not valid` por la misma razón que arriba.';
