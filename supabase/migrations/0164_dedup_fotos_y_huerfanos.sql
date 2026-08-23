-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORÍA PROD (22-ago-2026) · DAT-01 y DAT-37 — EL MISMO COMPROBANTE NO SE
-- COBRA DOS VECES, NI SIQUIERA CUANDO EL REINTENTO ES NUESTRO.
--
-- ── QUÉ PASABA (DAT-01, CRÍTICO) ──────────────────────────────────────────
--
-- El único candado real contra el gasto duplicado era `uq_gasto_img_hash`
-- (0027), y ese índice sólo protege a los gastos que TIENEN `img_hash`. El
-- hash se calculaba `if (process.env.LIKIDA_DEDUP_FOTOS === '1')` — una
-- bandera que producción NO tiene puesta. O sea: en producción, ningún gasto
-- que entró por foto lleva hash, y el índice está indexando el vacío.
--
-- Con el hash apagado, el camino de duplicación es corto y ocurre solo:
--   1. la foto entra, `addGasto` inserta el gasto;
--   2. el `say()` de después (acuse, aviso de fecha, resumen de ráfaga) lanza
--      —Meta 500, red— y el `catch` general suelta el claim;
--   3. la fila durable se reintenta (webhook o cron `wa-pendientes`);
--   4. el mismo `waMessageId` vuelve a correr el OCR y a insertar. Nada lo
--      frena: sin hash, sin UUID (un ticket de gasolinera no trae CFDI), el
--      mismo diésel de $8,000 queda comprobado dos veces contra un anticipo.
--
-- El código pasa a calcular el hash SIEMPRE (se retira la bandera), y esta
-- migración agrega la llave que cierra el caso que el hash no cubre: el
-- REINTENTO DEL MISMO MENSAJE. `wa_message_id` es el identificador que Meta le
-- da al mensaje; dos gastos con el mismo wamid en la misma flota son siempre
-- el mismo comprobante contado dos veces, venga o no la foto con hash.
--
-- Los dos candados son complementarios y ninguno sustituye al otro:
--   · `img_hash`       → el operador REENVÍA la misma foto (otro wamid).
--   · `wa_message_id`  → NOSOTROS reprocesamos el mismo mensaje (mismo wamid,
--                        otro OCR, otro `randomUUID()` de gasto).
--
-- ── LOS HUÉRFANOS (mismo hallazgo) ────────────────────────────────────────
--
-- La sala de espera (`comprobante_huerfano`, 0040) guardaba el `gasto`
-- extraído SIN hash y sin ninguna unicidad. El mismo reintento que duplicaba
-- el gasto duplicaba la fila de la sala de espera, y ahí duele en el otro
-- extremo: cuando el operador contesta «sí» al ofrecimiento, `adjuntar`
-- inserta TODAS las filas pendientes — N copias del mismo ticket, cada una con
-- su `randomUUID()`. Sin hash en el jsonb, el `uq_gasto_img_hash` tampoco las
-- ataja. Con el hash escrito, el índice parcial de abajo impide la segunda
-- fila EN ESPERA y el índice de `gasto` impide la segunda alta.
--
-- ── DAT-37 · `codigo_pendiente` no tenía ninguna unicidad ─────────────────
--
-- Mismo patrón, un piso más abajo: el acercamiento al código de barras se
-- guarda en la bandeja de la 0016, y el reintento (o el operador que manda dos
-- veces el mismo acercamiento) deja dos filas idénticas. La segunda nunca se
-- empareja con nada —`pegarCodigoEnEspera` consume una— y se queda en la
-- bandeja para siempre, contando como «hay un código sin ticket».
--
-- La llave NO es el monto: dos tickets distintos del mismo total en un viaje
-- son perfectamente posibles (dos casetas iguales) y colapsarlos perdería un
-- folio real. La llave es el CÓDIGO: `folio_portal` y `codigo_barras` son
-- exactos —salieron de un QR/EAN, no de visión— y el mismo papel produce
-- siempre el mismo valor.
--
-- ── IDEMPOTENCIA ──────────────────────────────────────────────────────────
-- Todo con `if not exists`. Los índices únicos se crean tras un barrido que
-- FALLA RUIDOSO si ya hay duplicados: preferimos no aplicar a aplicar dejando
-- fuera del índice filas que son justamente las que había que ver.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. `gasto.wa_message_id` ────────────────────────────────────────────────
-- `text` y no `uuid`: un wamid de Meta es una cadena opaca
-- (`wamid.HBgMNTIx…=`), no un UUID. Nullable a propósito: los gastos que NO
-- nacen de un mensaje de WhatsApp (alta manual desde el panel, importación,
-- huérfano adjuntado) no tienen ninguno, y los NULL no colisionan entre sí en
-- un índice único de Postgres.
alter table gasto add column if not exists wa_message_id text;

comment on column gasto.wa_message_id is
  'wamid del mensaje de WhatsApp que dio de alta este gasto. Es la llave de idempotencia del REPROCESO (DAT-01): la bandeja durable reintenta el mismo mensaje y sin esto el mismo comprobante entraba dos veces. NULL en gastos que no vienen de un mensaje.';

-- Barrido previo: si producción YA trae el duplicado, el índice no puede
-- nacer. Se grita con los ids en vez de fallar con un 23505 sin contexto.
do $$
declare r record; msg text := '';
begin
  if exists (select 1 from information_schema.columns
             where table_name = 'gasto' and column_name = 'wa_message_id') then
    for r in
      select tenant_id, wa_message_id, count(*) n, array_agg(id) gastos
      from gasto
      where wa_message_id is not null
      group by tenant_id, wa_message_id
      having count(*) > 1
    loop
      msg := msg || format(E'\n  tenant %s · wamid %s · %s gastos: %s',
                           r.tenant_id, r.wa_message_id, r.n, r.gastos);
    end loop;
    if msg <> '' then
      raise exception E'Hay gastos que comparten wa_message_id:%\n\nCada grupo es EL MISMO mensaje contado más de una vez. Decide cuál se queda antes de volver a aplicar.', msg;
    end if;
  end if;
end $$;

create unique index if not exists uq_gasto_wa_message_id
  on gasto (tenant_id, wa_message_id)
  where wa_message_id is not null;

comment on index uq_gasto_wa_message_id is
  'Un mensaje de WhatsApp = un gasto POR FLOTA. Cierra el reproceso de la bandeja durable (DAT-01): el say() posterior al alta puede lanzar y el turno se reintenta con el mismo wamid. El nombre importa: processor.ts discrimina el 23505 por él.';

-- ── 2. El huérfano guarda su hash, y no se guarda dos veces ─────────────────
--
-- El hash vive DENTRO del jsonb `gasto` (llave `imgHash`), que es exactamente
-- la forma en la que el processor ya construye la extracción y la que
-- `addGasto` lee al adjuntarla. Una columna aparte obligaría a mantener dos
-- copias del mismo dato y a decidir cuál manda cuando difieran.
--
-- El índice es PARCIAL sobre los que siguen esperando (`resuelto_en is null`):
-- un huérfano ya resuelto —adjuntado o descartado— es historia y no puede
-- impedir que el mismo papel vuelva a entrar a la sala de espera más adelante
-- (el operador que descartó por error y reenvía la foto).
do $$
declare r record; msg text := '';
begin
  for r in
    select tenant_id, gasto->>'imgHash' h, count(*) n, array_agg(id) filas
    from comprobante_huerfano
    where resuelto_en is null and gasto->>'imgHash' is not null
    group by tenant_id, gasto->>'imgHash'
    having count(*) > 1
  loop
    msg := msg || format(E'\n  tenant %s · hash %s · %s filas: %s',
                         r.tenant_id, left(r.h, 16) || '…', r.n, r.filas);
  end loop;
  if msg <> '' then
    raise exception E'La sala de espera tiene el mismo comprobante repetido:%\n\nAdjuntarlos cobraría el mismo papel N veces. Resuelve las copias antes de volver a aplicar.', msg;
  end if;
end $$;

create unique index if not exists uq_huerfano_img_hash
  on comprobante_huerfano (tenant_id, (gasto->>'imgHash'))
  where resuelto_en is null and gasto->>'imgHash' is not null;

comment on index uq_huerfano_img_hash is
  'Un comprobante = una fila EN ESPERA por flota (DAT-01). Sin esto, el reintento del mismo mensaje dejaba N copias en la sala de espera y el «sí» del operador las adjuntaba todas.';

-- ── 3. `codigo_pendiente`: el mismo acercamiento no se apunta dos veces ─────
do $$
declare r record; msg text := '';
begin
  for r in
    select tenant_id, viaje_id, coalesce(folio_portal, codigo_barras) k,
           count(*) n, array_agg(id) filas
    from codigo_pendiente
    where folio_portal is not null or codigo_barras is not null
    group by tenant_id, viaje_id, coalesce(folio_portal, codigo_barras)
    having count(*) > 1
  loop
    msg := msg || format(E'\n  tenant %s · viaje %s · código %s · %s filas: %s',
                         r.tenant_id, r.viaje_id, r.k, r.n, r.filas);
  end loop;
  if msg <> '' then
    raise exception E'La bandeja de códigos tiene acercamientos repetidos:%\n\nSólo uno se empareja con su ticket; el resto se queda ahí para siempre. Límpialos antes de volver a aplicar.', msg;
  end if;
end $$;

-- DOS índices y no uno compuesto: un acercamiento trae folio del portal, o
-- código de barras, o los dos, y un índice sobre `(folio_portal,
-- codigo_barras)` dejaría pasar la pareja (A, null) / (A, B) — que es el mismo
-- papel leído dos veces, una con el EAN decodificado y otra sin él.
create unique index if not exists uq_codigo_pendiente_folio
  on codigo_pendiente (tenant_id, viaje_id, folio_portal)
  where folio_portal is not null;

create unique index if not exists uq_codigo_pendiente_barras
  on codigo_pendiente (tenant_id, viaje_id, codigo_barras)
  where codigo_barras is not null;

comment on index uq_codigo_pendiente_folio is
  'Un acercamiento = una fila por viaje (DAT-37). La llave es el CÓDIGO y no el monto: dos casetas del mismo importe son dos papeles distintos, y colapsarlas perdería un folio real.';
