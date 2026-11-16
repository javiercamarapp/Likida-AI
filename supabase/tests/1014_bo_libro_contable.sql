\set ON_ERROR_STOP on
-- 1014 — libro contable de partida doble del Back-office: plan de cuentas, asentar idempotente, cuadre diferido, solo-inserción, reversas,
-- cadena de hash, folio sin huecos, periodos contables, comprobaciones por dos vías y grants.
-- Datos sintéticos; corre en ci-postgres tras todas las migraciones y termina en rollback.
begin;

do $$
declare
  n bigint; err text; v_a uuid; v_b uuid; v_r uuid; v_c uuid; v_folio text; v_seq integer; v_seq2 integer; v_ultimo integer; v_ultimo2 integer;
  v_hash text; v_recalc text; v_canon text; v_estado text; v_x numeric; v_rota text;
  actor constant uuid := '99100000-0000-4000-8000-0000000000a1';
  l2 constant jsonb := jsonb_build_array(
    jsonb_build_object('cuenta', '1110', 'debe', 100.50, 'nota', 'Banco'),
    jsonb_build_object('cuenta', '4100', 'haber', 100.50));
begin
  -- 1. Plan de cuentas: sembrado, todas «propuesta», códigos de 4 dígitos, y las clave del plan existen.
  select count(*) into n from public.bo_cuenta;
  if n < 25 then raise exception '1014(1): esperaba al menos 25 cuentas y hay %', n; end if;
  select count(*) into n from public.bo_cuenta where not propuesta;
  if n <> 0 then raise exception '1014(1): % cuentas sembradas no estan marcadas como propuesta', n; end if;
  select count(*) into n from public.bo_cuenta where codigo in ('1110', '1210', '2210', '2310', '4100', '5100', '5200', '6110', '7900');
  if n <> 9 then raise exception '1014(1): faltan cuentas clave del plan (hay %)', n; end if;
  begin
    insert into public.bo_cuenta (codigo, nombre, tipo, naturaleza) values ('12A4', 'Codigo con letra', 'A', 'D');
    raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1014(1): un codigo no numerico debia fallar'; end if; end;

  -- 2. Asentar: devuelve el id, asigna folio y seq, deja el hash encadenado con el canónico reproducible.
  v_a := public.bo_asentar('prueba-1014-a', date '2026-10-05', 'Cobro de prueba', 'manual', null, 'ninguno', null, actor, l2);
  select folio, seq, hash, hash_anterior into v_folio, v_seq, v_hash, v_canon from public.bo_asiento where id = v_a;
  if v_folio !~ '^A-[0-9]{4,}$' then raise exception '1014(2): folio con formato inesperado %', v_folio; end if;
  if v_folio <> 'A-' || lpad(v_seq::text, 4, '0') then raise exception '1014(2): el folio % no corresponde al seq %', v_folio, v_seq; end if;
  select public.bo_lineas_canon(v_a) into v_canon;
  if v_canon <> '1:1110:10050:0;2:4100:0:10050' then raise exception '1014(2): canon de lineas inesperado %', v_canon; end if;
  select encode(sha256(convert_to(a.hash_anterior || '|' || concat_ws('|', a.folio, a.clave_idem, to_char(a.fecha_neg, 'YYYY-MM-DD'), a.origen_tipo, coalesce(a.reversa_de::text, ''), public.bo_lineas_canon(a.id)), 'UTF8')), 'hex')
    into v_recalc from public.bo_asiento a where a.id = v_a;
  if v_recalc <> v_hash then raise exception '1014(2): el hash guardado no coincide con el recalculado'; end if;
  if (select es_manual from public.bo_asiento where id = v_a) is not true then raise exception '1014(2): un asiento manual debia marcar es_manual'; end if;

  -- 3. Idempotencia: la misma clave devuelve el mismo asiento y no duplica nada.
  v_b := public.bo_asentar('prueba-1014-a', date '2026-10-05', 'Cobro de prueba', 'manual', null, 'ninguno', null, actor, l2);
  if v_b is distinct from v_a then raise exception '1014(3): repetir la clave debia devolver el mismo asiento'; end if;
  select count(*) into n from public.bo_asiento where clave_idem = 'prueba-1014-a';
  if n <> 1 then raise exception '1014(3): la clave debia dar una sola fila y dio %', n; end if;
  select count(*) into n from public.bo_asiento_linea where asiento_id = v_a;
  if n <> 2 then raise exception '1014(3): el asiento debia tener 2 lineas y tiene %', n; end if;

  -- 4. La función rechaza lo inválido (y nada se escribe).
  begin  -- descuadrado
    perform public.bo_asentar('prueba-1014-desc', date '2026-10-05', 'Descuadrado', 'manual', null, 'ninguno', null, actor,
      jsonb_build_array(jsonb_build_object('cuenta', '1110', 'debe', 100), jsonb_build_object('cuenta', '4100', 'haber', 99.99)));
    raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1014(4): un asiento descuadrado debia fallar'; end if; end;
  begin  -- debe y haber en la misma línea
    perform public.bo_asentar('prueba-1014-ambos', date '2026-10-05', 'Ambos lados', 'manual', null, 'ninguno', null, actor,
      jsonb_build_array(jsonb_build_object('cuenta', '1110', 'debe', 100, 'haber', 100), jsonb_build_object('cuenta', '4100', 'haber', 100)));
    raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1014(4): una linea con debe y haber debia fallar'; end if; end;
  begin  -- una sola línea
    perform public.bo_asentar('prueba-1014-una', date '2026-10-05', 'Una linea', 'manual', null, 'ninguno', null, actor,
      jsonb_build_array(jsonb_build_object('cuenta', '1110', 'debe', 100)));
    raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1014(4): una sola linea debia fallar'; end if; end;
  begin  -- cuenta inexistente
    perform public.bo_asentar('prueba-1014-nocta', date '2026-10-05', 'Cuenta inexistente', 'manual', null, 'ninguno', null, actor,
      jsonb_build_array(jsonb_build_object('cuenta', '9999', 'debe', 10), jsonb_build_object('cuenta', '4100', 'haber', 10)));
    raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1014(4): una cuenta inexistente debia fallar'; end if; end;
  begin  -- cuenta inactiva (7100 nace inactiva)
    perform public.bo_asentar('prueba-1014-inact', date '2026-10-05', 'Cuenta inactiva', 'manual', null, 'ninguno', null, actor,
      jsonb_build_array(jsonb_build_object('cuenta', '7100', 'debe', 10), jsonb_build_object('cuenta', '4100', 'haber', 10)));
    raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1014(4): una cuenta inactiva debia fallar'; end if; end;
  begin  -- tres decimales
    perform public.bo_asentar('prueba-1014-dec', date '2026-10-05', 'Tres decimales', 'manual', null, 'ninguno', null, actor,
      jsonb_build_array(jsonb_build_object('cuenta', '1110', 'debe', 10.005), jsonb_build_object('cuenta', '4100', 'haber', 10.005)));
    raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1014(4): montos con tres decimales debian fallar'; end if; end;
  begin  -- sin clave de idempotencia
    perform public.bo_asentar('x', date '2026-10-05', 'Sin clave', 'manual', null, 'ninguno', null, actor, l2);
    raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1014(4): una clave corta debia fallar'; end if; end;
  begin  -- una reversa no entra por bo_asentar
    perform public.bo_asentar('prueba-1014-rev-directa', date '2026-10-05', 'Reversa directa', 'reversa', null, 'ninguno', null, actor, l2);
    raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1014(4): origen reversa por bo_asentar debia fallar'; end if; end;
  select count(*) into n from public.bo_asiento where clave_idem like 'prueba-1014-%' and clave_idem <> 'prueba-1014-a';
  if n <> 0 then raise exception '1014(4): los rechazos no debian dejar asientos (hay %)', n; end if;

  -- 5. Cuadre DIFERIDO al commit: un camino de escritura directo con líneas descuadradas falla al exigirlo.
  begin
    insert into public.bo_asiento (seq, folio, clave_idem, fecha_neg, periodo, descripcion, hash_anterior, hash)
    values (900001, 'A-900001', 'prueba-1014-directo', date '2026-10-06', date '2026-10-01', 'Directo descuadrado', repeat('0', 64), repeat('1', 64));
    insert into public.bo_asiento_linea (asiento_id, n, cuenta, debe, haber)
      select id, 1, '1110', 10, 0 from public.bo_asiento where clave_idem = 'prueba-1014-directo';
    insert into public.bo_asiento_linea (asiento_id, n, cuenta, debe, haber)
      select id, 2, '4100', 0, 9 from public.bo_asiento where clave_idem = 'prueba-1014-directo';
    set constraints all immediate;
    raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1014(5): el trigger de cuadre diferido debia rechazar el asiento descuadrado'; end if; end;
  set constraints all deferred;
  begin  -- y un asiento sin líneas tampoco pasa
    insert into public.bo_asiento (seq, folio, clave_idem, fecha_neg, periodo, descripcion, hash_anterior, hash)
    values (900002, 'A-900002', 'prueba-1014-vacio', date '2026-10-06', date '2026-10-01', 'Sin lineas', repeat('0', 64), repeat('1', 64));
    set constraints all immediate;
    raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1014(5): un asiento sin lineas debia fallar'; end if; end;
  set constraints all deferred;

  -- 6. Solo inserción: UPDATE, DELETE y TRUNCATE se rechazan en el libro y en las reaperturas.
  begin update public.bo_asiento set descripcion = 'cambiada' where id = v_a; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1014(6): UPDATE de bo_asiento debia fallar'; end if; end;
  begin delete from public.bo_asiento where id = v_a; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1014(6): DELETE de bo_asiento debia fallar'; end if; end;
  begin truncate public.bo_asiento_linea; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1014(6): TRUNCATE de bo_asiento_linea debia fallar'; end if; end;
  begin update public.bo_asiento_linea set debe = 1 where asiento_id = v_a and n = 1; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1014(6): UPDATE de bo_asiento_linea debia fallar'; end if; end;
  begin delete from public.bo_asiento_linea where asiento_id = v_a; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1014(6): DELETE de bo_asiento_linea debia fallar'; end if; end;

  -- 7. Reversa: enlazada, con motivo, invertida, neutraliza; una sola vez; no de reversas ni de asientos no manuales.
  begin
    perform public.bo_reversar_asiento(v_a, '   ', actor, 'prueba-1014-rev-sin-motivo', date '2026-10-07');
    raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1014(7): una reversa sin motivo debia fallar'; end if; end;
  v_r := public.bo_reversar_asiento(v_a, 'Captura duplicada', actor, 'prueba-1014-rev-a', date '2026-10-07');
  if (select reversa_de from public.bo_asiento where id = v_r) is distinct from v_a then raise exception '1014(7): la reversa debia enlazar al original'; end if;
  if (select motivo_reversa from public.bo_asiento where id = v_r) <> 'Captura duplicada' then raise exception '1014(7): la reversa debia guardar el motivo'; end if;
  if (select es_manual from public.bo_asiento where id = v_r) then raise exception '1014(7): una reversa no es manual'; end if;
  select coalesce(sum(l.debe - l.haber), 0) into v_x from public.bo_asiento_linea l where l.asiento_id in (v_a, v_r) and l.cuenta = '1110';
  if v_x <> 0 then raise exception '1014(7): la reversa debia neutralizar la cuenta 1110 y deja %', v_x; end if;
  select coalesce(sum(l.debe - l.haber), 0) into v_x from public.bo_asiento_linea l where l.asiento_id in (v_a, v_r) and l.cuenta = '4100';
  if v_x <> 0 then raise exception '1014(7): la reversa debia neutralizar la cuenta 4100 y deja %', v_x; end if;
  -- idempotente por clave
  if public.bo_reversar_asiento(v_a, 'Captura duplicada', actor, 'prueba-1014-rev-a', date '2026-10-07') is distinct from v_r then
    raise exception '1014(7): repetir la clave de la reversa debia devolver la misma';
  end if;
  begin  -- segunda reversa del mismo original con otra clave
    perform public.bo_reversar_asiento(v_a, 'Otra vez', actor, 'prueba-1014-rev-a2', date '2026-10-07');
    raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1014(7): reversar dos veces debia fallar'; end if; end;
  begin  -- reversa de una reversa
    perform public.bo_reversar_asiento(v_r, 'Reversa de reversa', actor, 'prueba-1014-rev-r', date '2026-10-07');
    raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1014(7): reversar una reversa debia fallar'; end if; end;
  -- asiento no manual: se crea con otro origen y no se reversa
  v_c := public.bo_asentar('prueba-1014-auto', date '2026-10-08', 'Asiento automatico', 'factura_saas', null, 'cfdi', 'UUID-CFDI-1', actor, l2);
  if (select es_manual from public.bo_asiento where id = v_c) then raise exception '1014(7): origen factura_saas no es manual'; end if;
  begin
    perform public.bo_reversar_asiento(v_c, 'Intento', actor, 'prueba-1014-rev-auto', date '2026-10-08');
    raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1014(7): solo los manuales se reversan'; end if; end;
  -- reversa sin motivo directo en la tabla: el check lo impide
  begin
    insert into public.bo_asiento (seq, folio, clave_idem, fecha_neg, periodo, descripcion, reversa_de, hash_anterior, hash)
    values (900003, 'A-900003', 'prueba-1014-rev-sin-motivo-directa', date '2026-10-06', date '2026-10-01', 'Reversa sin motivo', v_c, repeat('0', 64), repeat('1', 64));
    raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1014(7): reversa_de sin motivo_reversa debia fallar'; end if; end;

  -- 8. Cadena de hash: íntegra; una alteración (con el trigger apagado a propósito) se detecta y se nombra el folio.
  if public.bo_verificar_cadena() is not null then raise exception '1014(8): la cadena debia estar integra y marca %', public.bo_verificar_cadena(); end if;
  select hash_anterior into v_hash from public.bo_asiento where id = v_r;
  if v_hash <> (select hash from public.bo_asiento where id = v_a) then raise exception '1014(8): la reversa debia encadenar con el asiento anterior'; end if;
  if exists (select 1 from public.bo_comprobaciones_libro() where not ok) then raise exception '1014(8): con el libro sano todas las comprobaciones debian estar en verde'; end if;
  -- Los eventos diferidos pendientes (cuadre) impiden ALTER TABLE: se fuerzan ahora, y se vuelve a diferir.
  set constraints all immediate;
  set constraints all deferred;
  alter table public.bo_asiento disable trigger bo_asiento_solo_insercion;
  update public.bo_asiento set fecha_neg = date '2026-10-06' where id = v_a;
  alter table public.bo_asiento enable trigger bo_asiento_solo_insercion;
  v_rota := public.bo_verificar_cadena();
  select folio into v_folio from public.bo_asiento where id = v_a;
  if v_rota is distinct from v_folio then raise exception '1014(8): la alteracion debia romper la cadena en % y marca %', v_folio, v_rota; end if;
  select count(*) into n from public.bo_comprobaciones_libro() where codigo = 'C21' and not ok;
  if n <> 1 then raise exception '1014(8): C21 debia ponerse en rojo con la cadena rota'; end if;
  alter table public.bo_asiento disable trigger bo_asiento_solo_insercion;
  update public.bo_asiento set fecha_neg = date '2026-10-05' where id = v_a;
  alter table public.bo_asiento enable trigger bo_asiento_solo_insercion;
  if public.bo_verificar_cadena() is not null then raise exception '1014(8): al restaurar la cadena debia volver a estar integra'; end if;

  -- 9. Folio sin huecos: una operación que se deshace no consume folio.
  select ultimo into v_ultimo from public.bo_folio_contador where serie = 'A';
  begin
    perform public.bo_asentar('prueba-1014-deshecho', date '2026-10-09', 'Se deshace', 'manual', null, 'ninguno', null, actor, l2);
    raise exception 'forzado';
  exception when others then null; end;
  select ultimo into v_ultimo2 from public.bo_folio_contador where serie = 'A';
  if v_ultimo2 <> v_ultimo then raise exception '1014(9): un asiento deshecho no debia consumir folio (% -> %)', v_ultimo, v_ultimo2; end if;
  if public.bo_folios_con_huecos() <> 0 then raise exception '1014(9): no debia haber huecos y hay %', public.bo_folios_con_huecos(); end if;
  select seq into v_seq from public.bo_asiento where id = v_a;
  select seq into v_seq2 from public.bo_asiento where id = v_r;
  if v_seq2 <> v_seq + 1 then raise exception '1014(9): los folios debian ser consecutivos (% y %)', v_seq, v_seq2; end if;

  -- 10. Periodos contables: nacen abiertos; solo avanzan en orden; aprobado no admite asientos; reabrir exige motivo y deja huella.
  select estado into v_estado from public.bo_periodo_contable where periodo = date '2026-10-01';
  if v_estado is distinct from 'abierto' then raise exception '1014(10): el periodo debia nacer abierto y es %', v_estado; end if;
  begin update public.bo_periodo_contable set estado = 'aprobado' where periodo = date '2026-10-01'; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1014(10): abierto -> aprobado debia fallar'; end if; end;
  update public.bo_periodo_contable set estado = 'preparado', preparado_en = now() where periodo = date '2026-10-01';
  update public.bo_periodo_contable set estado = 'aprobado', aprobado_en = now(), aprobado_por = actor where periodo = date '2026-10-01';
  begin
    perform public.bo_asentar('prueba-1014-en-aprobado', date '2026-10-10', 'En periodo aprobado', 'manual', null, 'ninguno', null, actor, l2);
    raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1014(10): un periodo aprobado no admite asientos'; end if; end;
  begin update public.bo_periodo_contable set estado = 'abierto' where periodo = date '2026-10-01'; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1014(10): reabrir a mano debia fallar'; end if; end;
  begin perform public.bo_reabrir_periodo(date '2026-10-01', '', actor); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1014(10): reabrir sin motivo debia fallar'; end if; end;
  perform public.bo_reabrir_periodo(date '2026-10-01', 'Correccion de una captura', actor);
  select estado into v_estado from public.bo_periodo_contable where periodo = date '2026-10-01';
  if v_estado <> 'abierto' then raise exception '1014(10): tras reabrir debia quedar abierto y es %', v_estado; end if;
  select count(*) into n from public.bo_periodo_reapertura where periodo = date '2026-10-01' and motivo = 'Correccion de una captura';
  if n <> 1 then raise exception '1014(10): la reapertura debia dejar una fila con su motivo'; end if;
  begin delete from public.bo_periodo_reapertura; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1014(10): la reapertura es solo insercion'; end if; end;
  begin delete from public.bo_periodo_contable where periodo = date '2026-10-01'; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1014(10): los periodos no se borran'; end if; end;
  begin perform public.bo_reabrir_periodo(date '2026-10-01', 'Ya esta abierto', actor); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1014(10): reabrir un periodo abierto debia fallar'; end if; end;
  -- Un periodo «preparado» vuelve a abierto cuando entra un asiento nuevo.
  update public.bo_periodo_contable set estado = 'preparado', preparado_en = now() where periodo = date '2026-10-01';
  perform public.bo_asentar('prueba-1014-en-preparado', date '2026-10-11', 'En periodo preparado', 'manual', null, 'ninguno', null, actor, l2);
  select estado into v_estado from public.bo_periodo_contable where periodo = date '2026-10-01';
  if v_estado <> 'abierto' then raise exception '1014(10): un asiento nuevo debia reabrir el periodo preparado y es %', v_estado; end if;

  -- 11. Cuentas: nombre sí, tipo/naturaleza con movimientos no, y no se borran.
  update public.bo_cuenta set nombre = 'Bancos de la sociedad' where codigo = '1110';
  begin update public.bo_cuenta set tipo = 'P', naturaleza = 'A' where codigo = '1110'; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1014(11): cambiar el tipo de una cuenta con movimientos debia fallar'; end if; end;
  begin delete from public.bo_cuenta where codigo = '8100'; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1014(11): borrar una cuenta debia fallar'; end if; end;

  -- 12. Comprobaciones por dos vías con el libro sano: las cuatro en verde y con sus dos vías iguales.
  select count(*) into n from public.bo_comprobaciones_libro() where codigo in ('C3', 'C10', 'C21', 'CU1') and ok and via_a_cent = via_b_cent;
  if n <> 4 then raise exception '1014(12): las cuatro comprobaciones debian estar en verde y lo estan % ', n; end if;

  -- 13. Privilegios: RLS, y solo service_role llama a las funciones; el libro no se escribe directo.
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relname in ('bo_cuenta', 'bo_periodo_contable', 'bo_periodo_reapertura', 'bo_folio_contador', 'bo_asiento', 'bo_asiento_linea') and c.relrowsecurity;
  if n <> 6 then raise exception '1014(13): las seis tablas deben tener RLS y hay %', n; end if;
  begin
    set local role authenticated;
    perform public.bo_asentar('prueba-1014-auth', date '2026-10-12', 'Auth', 'manual', null, 'ninguno', null, actor, l2);
    reset role;
    raise exception 'authenticated pudo llamar';
  exception when insufficient_privilege then reset role;
  end;
  begin
    set local role anon;
    perform count(*) from public.bo_asiento;
    reset role;
    raise exception 'anon pudo leer';
  exception when insufficient_privilege then reset role;
  end;
  begin
    set local role service_role;
    insert into public.bo_asiento_linea (asiento_id, n, cuenta, debe, haber) values (v_a, 9, '1110', 1, 0);
    reset role;
    raise exception 'service_role pudo escribir directo';
  exception when insufficient_privilege then reset role;
  end;
  set local role service_role;
  perform public.bo_asentar('prueba-1014-svc', date '2026-10-12', 'Por service_role', 'manual', null, 'ninguno', null, actor, l2);
  perform count(*) from public.bo_asiento;
  reset role;
  begin
    set local role service_role;
    perform public.bo_asentar_interno('prueba-1014-int', date '2026-10-12', 'Interna', 'manual', null, 'ninguno', null, actor, l2, null, null);
    reset role;
    raise exception 'service_role pudo llamar la funcion interna';
  exception when insufficient_privilege then reset role;
  end;
end $$;

rollback;
