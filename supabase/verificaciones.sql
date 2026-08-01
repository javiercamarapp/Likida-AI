-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICACIONES DE CONCURRENCIA — lo que solo la base puede demostrar.
--
-- Estas garantías no viven en TypeScript: viven en índices únicos, en cláusulas
-- WHERE de un UPDATE y en un ON CONFLICT. Un test con Supabase mockeado no las
-- prueba, prueba el mock.
--
-- Cada bloque termina lanzando una excepción A PROPÓSITO: el DO corre en su
-- propia transacción, así que la excepción revierte todo y no queda un solo
-- registro de prueba. El resultado se lee en el mensaje de error.
--
-- CÓMO CORRERLO: pegar un bloque en el SQL editor de Supabase. Es seguro contra
-- producción — no deja nada — pero conviene correrlo de uno en uno.
--
-- Última corrida: **31-jul-2026**, contra el proyecto Likida. Los bloques 13 a 17
-- se escribieron ese día y se corrieron en cuanto se aplicaron la 0031, la 0032 y
-- la 0033. Salida REAL, copiada tal cual:
--
--   13  ve-el-que-falta=t  calla-el-que-existe=t  vacio-no-es-null=t
--   14  nunca-negativo=0  viaje-inexistente=0  huerfano-cuenta=1
--       sondeo-lo-olvida=0  sella-al-incrementar=t  reciente-sobrevive=1
--   16  rls-en-wa_mensaje=t  anon-intake=f  anon-lock=f  anon-unlock=f
--       service-role-intake=t
--   17  gana-1a=t  2do-camino-rebota=f  reenvio-por-version=t
--       CONSTANCIA-INTACTA=t  version-intacta=v1  reserva-suelta=t
--       solto=t  solto-2a-vez=f  reserva-expira=t
--
-- Y el BARRIDO DE PRODUCCIÓN del 31-jul, bloque 18 contra la base real:
--
--   18  tablas-sin-rls=—  politicas-que-dicen-true=—  rpc-abiertas-a-anon=—
--   19  entra-antes=t  rebota-despues=f  sqlstate=CU001  liquidado-sin-liq=t
--
-- Además se atacó la API REST como anónimo con la llave publicable: 14 tablas
-- leídas → 0 filas, y CINCO escrituras rechazadas (envenenar la idempotencia,
-- inventar un gasto, soltar el mutex de un viaje ajeno, mover el contador de la
-- barrera, marcar una constancia de aviso falsa). Todas con 42501.
--
-- Y el bloque 8 (0027) el mismo día, en cuanto se aplicó su migración:
--
--    8  repetido-entre-viajes-rebotado=t  sin-hash-que-entraron=2
--       msg=duplicate key value violates unique constraint "uq_gasto_img_hash"
--
-- Los cinco dieron exactamente lo esperado. El 17 es el que importa: la
-- constancia del art. 16 de un aviso v1 SOBREVIVE al reenvío fallido de un v2 —
-- que es justo lo que la implementación vieja destruía. Y el 14 confirma contra
-- Postgres, no contra un mock, que el contador huérfano se olvida en el SONDEO.
--
-- Comprobado además que los bloques no dejan basura: después de correrlos había
-- 0 tenants `ZZZ VERIF%`, 0 contadores vivos, 0 reservas de aviso abiertas, y la
-- única constancia real —la del 28-jul— intacta.
--
-- Los cuatro primeros pasaron el 28-jul. Los bloques 5 a 11 son de la auditoría 5
-- y comprueban las migraciones 0022 y 0024–0029.
--
-- ESTADO DE LAS MIGRACIONES QUE COMPRUEBAN (31-jul-2026): **TODAS APLICADAS.**
-- Por primera vez desde que existe este archivo no hay ninguna esperando.
--   · 0022, 0024, 0025, 0026, 0028 y 0029 → APLICADAS. Sus bloques (5, 6, 7,
--     9, 10, 11) tienen que dar los valores esperados; si alguno reporta `f`,
--     la base se ha ido del repo y hay que leerlo como una alarma, no como
--     "todavía no toca".
--   · 0027 (una foto = un gasto por flota) → APLICADA el 31-jul, con Javier
--     decidiendo sobre la lista del bloque 12, que daba UN grupo:
--
--       tenant 11111111-… · hash 250a4e5b34ec… · 2 gastos en 2 viajes · $398.00
--         823be0 (viaje 0000ff, $199.00, 28-Jul 21:41)   ← conserva el hash
--         e00860 (viaje 0000fe, $199.00, 28-Jul 22:48)   ← degradado
--
--     Mismo importe, misma flota demo, 67 minutos de diferencia, el día en que se
--     cerró el flujo de punta a punta por primera vez: un ENSAYO, las mismas
--     fotos mandadas dos veces. Esa lectura es de quien mira la lista, no de la
--     base, y por eso esperó tres días a que alguien la mirara.
--
--     REVERSIBLE, y comprobado después de aplicar: el SHA-256 completo del
--     degradado quedó en `ocr_extra.imgHashDuplicado`
--     (250a4e5b34ecba43d043bf63b771c384296c5a62917bf326ab2826d1e9349d98) junto
--     con `imgHashDegradadoPor`. Devolverlo es un UPDATE.
--
--     Bloque 8, corrido en cuanto se aplicó:
--       repetido-entre-viajes-rebotado=t  sin-hash-que-entraron=2
--       msg=duplicate key value violates unique constraint "uq_gasto_img_hash"
--     El mensaje NOMBRA el índice, que es de lo que depende `processor.ts` para
--     saber si un 23505 es benigno.
--   · 0030 (`indices_faltantes`) → APLICADA. El bloque 13 se escribió DESPUÉS,
--     el 31-jul: la única migración que existe para que un chequeo dejara de
--     mentir era, ella misma, la única sin comprobar.
--   · 0031 (TTL del contador de la barrera), 0032 (`politica_gasto` muerta),
--     0033 (la constancia del aviso separada de su reserva), 0034 (contacto del
--     art. 29), 0035 (`search_path` fijo) y 0036 (nada entra tras liquidar) →
--     APLICADAS el 31-jul. Sus bloques (14, 17, 18 y 19) pasaron; la salida está
--     copiada arriba.
-- Contra una base sin las migraciones, los bloques 6 a 11 reportan `f` — que es
-- justamente la lectura útil: dicen qué garantía falta.
--
-- QUÉ MIGRACIONES NO TIENEN BLOQUE, Y POR QUÉ: `migraciones_verificadas.test.ts`
-- lo mantiene honesto. Cada migración está o comprobada aquí, o exenta con una
-- razón escrita. Sin esa lista, la respuesta a "¿está cubierta la 00XX?" se
-- vuelve "creo que sí" — que fue exactamente lo que pasó con la 0030.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. Mutex del viaje (mig. 0005) ──────────────────────────────────────────
-- Dos "listo" del mismo viaje no pueden correr el agente a la vez: sería el
-- doble de costo de LLM y dos cierres.
do $$
declare v_t uuid; v_o uuid; v_v uuid; l1 boolean; l2 boolean; l3 boolean;
begin
  insert into tenant (nombre) values ('ZZZ VERIF MUTEX') returning id into v_t;
  insert into operador (tenant_id, nombre, telefono) values (v_t,'P','+520000009001') returning id into v_o;
  insert into viaje (tenant_id, operador_id) values (v_t, v_o) returning id into v_v;

  l1 := try_lock_viaje(v_v, 60000);   -- primero: toma el lease
  l2 := try_lock_viaje(v_v, 60000);   -- concurrente: rebota
  perform unlock_viaje(v_v);
  l3 := try_lock_viaje(v_v, 60000);   -- liberado: se puede volver a tomar

  raise exception E'MUTEX  1er=%  concurrente=%  tras-unlock=%   (esperado t / f / t)', l1, l2, l3;
end $$;


-- ── 2. Doble cierre (mig. 0013 + liquidacion_viaje_uidx) ────────────────────
-- Aunque el mutex se abra (fail-open ante RPC ausente), la base tiene que
-- impedir dos liquidaciones del mismo viaje. Y un re-cierre que todavía no
-- generó el PDF no puede borrar el que ya había.
do $$
declare v_t uuid; v_o uuid; v_v uuid; id1 uuid; id2 uuid; n int; est text; pdf text;
begin
  insert into tenant (nombre) values ('ZZZ VERIF CIERRE') returning id into v_t;
  insert into operador (tenant_id, nombre, telefono) values (v_t,'P','+520000009002') returning id into v_o;
  insert into viaje (tenant_id, operador_id) values (v_t, v_o) returning id into v_v;

  id1 := guardar_liquidacion_tx(v_t, v_v, 4600, 5100, 500, 'cuadrada', '[]'::jsonb, 0,0,0, 'https://storage/liq.pdf');
  id2 := guardar_liquidacion_tx(v_t, v_v, 4600, 5100, 500, 'cuadrada', '[]'::jsonb, 0,0,0, null);

  select count(*) into n from liquidacion where viaje_id = v_v;
  select pdf_url into pdf from liquidacion where viaje_id = v_v;
  select estatus into est from viaje where id = v_v;

  raise exception E'CIERRE  liquidaciones=%  mismo-id=%  pdf-sobrevive=%  viaje=%   (esperado 1 / t / la url / liquidado)',
    n, (id1 = id2), pdf, est;
end $$;


-- ── 3. Claim del acercamiento (mig. 0017) ───────────────────────────────────
-- El segundo acercamiento no pisa el folio del primero — ese folio es el que la
-- oficina teclea en el portal — y el merge conserva lo que otra foto ya había
-- puesto en ocr_extra (esto último era el lost update de B13).
do $$
declare v_t uuid; v_o uuid; v_v uuid; v_g uuid; r1 boolean; r2 boolean; extra jsonb; uu text;
begin
  insert into tenant (nombre) values ('ZZZ VERIF CLAIM') returning id into v_t;
  insert into operador (tenant_id, nombre, telefono) values (v_t,'P','+520000009003') returning id into v_o;
  insert into viaje (tenant_id, operador_id) values (v_t, v_o) returning id into v_v;
  insert into gasto (tenant_id, viaje_id, concepto, monto, ocr_extra)
    values (v_t, v_v, 'diesel', 487.50, '{"montoDiscrepante":true}'::jsonb) returning id into v_g;

  r1 := enriquecer_gasto_codigo(v_g, v_t, '{"folioPortal":"PRIMERO"}'::jsonb, 'uuid-A');
  r2 := enriquecer_gasto_codigo(v_g, v_t, '{"folioPortal":"SEGUNDO"}'::jsonb, 'uuid-B');
  select ocr_extra, cfdi_uuid into extra, uu from gasto where id = v_g;

  raise exception E'CLAIM  1er/2do=%/%  folio=%  montoDiscrepante-sobrevive=%  uuid=%   (esperado t/f / PRIMERO / true / uuid-A)',
    r1, r2, extra->>'folioPortal', extra->>'montoDiscrepante', uu;
end $$;


-- ── 4. Un CFDI, un gasto (mig. 0019) ────────────────────────────────────────
-- El mismo UUID no entra dos veces, pero los tickets SIN timbrar (cfdi_uuid
-- NULL) tienen que poder entrar todos: son la mayoría.
do $$
declare v_t uuid; v_o uuid; v_v uuid; choco boolean := false; msg text := ''; sin_uuid int;
begin
  insert into tenant (nombre) values ('ZZZ VERIF UUID') returning id into v_t;
  insert into operador (tenant_id, nombre, telefono) values (v_t,'P','+520000009004') returning id into v_o;
  insert into viaje (tenant_id, operador_id) values (v_t, v_o) returning id into v_v;

  insert into gasto (tenant_id, viaje_id, concepto, monto, cfdi_uuid) values (v_t, v_v, 'diesel', 100, 'UUID-REPETIDO');
  begin
    insert into gasto (tenant_id, viaje_id, concepto, monto, cfdi_uuid) values (v_t, v_v, 'diesel', 100, 'UUID-REPETIDO');
  exception when unique_violation then choco := true; msg := SQLERRM;
  end;

  insert into gasto (tenant_id, viaje_id, concepto, monto, cfdi_uuid)
    values (v_t,v_v,'caseta',50,null),(v_t,v_v,'caseta',50,null),(v_t,v_v,'diesel',80,null);
  select count(*) into sin_uuid from gasto where tenant_id = v_t and cfdi_uuid is null;

  -- El mensaje TIENE que nombrar uq_gasto_cfdi_uuid: el processor discrimina por
  -- ese nombre para saber si el 23505 es benigno (src/lib/cuadra/pg_errores.ts).
  raise exception E'UUID  repetido-rebotado=%  sin-uuid-que-entraron=%  msg=%   (esperado t / 3 / nombra uq_gasto_cfdi_uuid)',
    choco, sin_uuid, msg;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORÍA 5 — los bloques que faltaban.
--
-- El auditor de modelo de datos anotó dos huecos de cobertura en este archivo:
-- no había ningún bloque para la garantía de la 0022 (que la RPC de cierre sea
-- única), que era justo la que no estaba en el repo, ni ninguno de aislamiento
-- entre tenants. Estos siete los cubren, más las cuatro restricciones nuevas.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 5. Una sola firma de guardar_liquidacion_tx (mig. 0022) ─────────────────
-- 0013 la creó con 11 parámetros y 0021 la recreó con 12: `create or replace`
-- NO reemplaza una firma distinta, crea una SOBRECARGA. Con las dos vivas, toda
-- llamada de 11 argumentos falla con "function guardar_liquidacion_tx(...) is
-- not unique" y NINGUNA liquidación cierra. Este bloque es de solo lectura.
do $$
declare n int; nargs text;
begin
  select count(*), coalesce(string_agg(p.pronargs::text, ' / ' order by p.pronargs), '—')
    into n, nargs
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'guardar_liquidacion_tx';

  raise exception E'RPC ÚNICA  firmas=%  con-n-argumentos=%   (esperado 1 / 12)', n, nargs;
end $$;


-- ── 6. Un teléfono, un operador (mig. 0024) ─────────────────────────────────
-- El mismo número mexicano circula como '52…', '521…' y '+52…', y hasta la 0024
-- las tres formas eran tres operadores distintos para la base. Con dos filas
-- activas, `resolveOperador` (.in(variantes).limit(1)) devuelve una arbitraria y
-- el gasto se escribe en la flota que salga primero.
--
-- Lo que NO puede romper: un operador dado de baja en una flota tiene que poder
-- aparecer en otra. Eso es rotación, no ambigüedad.
do $$
declare
  t_a uuid; t_b uuid;
  misma_flota boolean := false; otra_flota boolean := false; rotacion boolean := false;
begin
  insert into tenant (nombre) values ('ZZZ VERIF TEL A') returning id into t_a;
  insert into tenant (nombre) values ('ZZZ VERIF TEL B') returning id into t_b;

  insert into operador (tenant_id, nombre, telefono) values (t_a, 'P', '529990009005');

  -- La misma flota, el mismo número CON el "1" que agrega Meta al entregar.
  begin
    insert into operador (tenant_id, nombre, telefono) values (t_a, 'P', '5219990009005');
  exception when unique_violation then misma_flota := true;
  end;

  -- Otra flota, el mismo número con espacios y "+". Este es el que corrompe el
  -- tenant del gasto, y por eso la unicidad de activos es GLOBAL.
  begin
    insert into operador (tenant_id, nombre, telefono) values (t_b, 'P', '+52 999 000 9005');
  exception when unique_violation then otra_flota := true;
  end;

  -- Dado de baja en la otra flota: tiene que PASAR.
  begin
    insert into operador (tenant_id, nombre, telefono, activo)
      values (t_b, 'P', '5219990009005', false);
    rotacion := true;
  exception when unique_violation then rotacion := false;
  end;

  raise exception E'TELÉFONO  misma-flota-rebota=%  otra-flota-rebota=%  baja-en-otra-flota-pasa=%   (esperado t / t / t)',
    misma_flota, otra_flota, rotacion;
end $$;


-- ── 7. tenant.config no puede apagar un tope de dinero (mig. 0026) ──────────
-- Las tres formas que el auditor midió contra el motor real: `{"politica":[]}`
-- se lleva el tope de la flota, `viaticosTopeFiscalDiarioMxn: null` se lleva el
-- de $750/día de LISR 28-V —las dos sin un log y sin un error—, y
-- `{"politica":"si"}` revienta el cuadre con "pol.filter is not a function".
-- Un override legítimo tiene que seguir pasando.
do $$
declare
  v_t uuid;
  vacia text := 'PASÓ'; nulo text := 'PASÓ'; texto text := 'PASÓ'; typo text := 'PASÓ';
  legitimo boolean := false;
begin
  insert into tenant (nombre) values ('ZZZ VERIF CONFIG') returning id into v_t;

  begin update tenant set config = '{"politica": []}'::jsonb where id = v_t;
  exception when others then vacia := 'REBOTÓ'; end;

  begin update tenant set config = '{"estimulos":{"viaticosTopeFiscalDiarioMxn": null}}'::jsonb where id = v_t;
  exception when others then nulo := 'REBOTÓ'; end;

  begin update tenant set config = '{"politica": "si"}'::jsonb where id = v_t;
  exception when others then texto := 'REBOTÓ'; end;

  -- La "s" de más: hoy se guarda tan campante y la flota corre con DEMO_CONFIG.
  begin update tenant set config = '{"politicas": [{"concepto":"diesel","topeMonto":4000}]}'::jsonb where id = v_t;
  exception when others then typo := 'REBOTÓ'; end;

  begin
    update tenant set config = '{"estimulos":{"viaticosTopeFiscalDiarioMxn": 900}}'::jsonb where id = v_t;
    legitimo := true;
  exception when others then legitimo := false; end;

  raise exception E'CONFIG  politica-vacía=%  tope-en-null=%  politica-texto=%  llave-mal-escrita=%  override-legítimo-pasa=%   (esperado REBOTÓ / REBOTÓ / REBOTÓ / REBOTÓ / t)',
    vacia, nulo, texto, typo, legitimo;
end $$;


-- ── 8. La misma foto no se comprueba en dos viajes (mig. 0027) ──────────────
-- Un SHA-256 igual es el mismo archivo. Hasta la 0027 el índice llevaba el
-- viaje en medio, así que el mismo ticket entraba una vez por viaje y se
-- comprobaba contra dos anticipos. Y los tickets SIN hash tienen que seguir
-- entrando todos.
--
-- El segundo viaje se crea ya 'liquidado' a propósito: desde la 0029 un
-- operador no puede tener dos abiertos a la vez.
--
-- El mensaje TIENE que nombrar `uq_gasto_img_hash`: `processor.ts:356`
-- discrimina por ese nombre para saber si el 23505 es benigno.
do $$
declare
  v_t uuid; v_o uuid; v_a uuid; v_b uuid;
  choco boolean := false; msg text := ''; sin_hash int;
begin
  insert into tenant (nombre) values ('ZZZ VERIF HASH') returning id into v_t;
  insert into operador (tenant_id, nombre, telefono) values (v_t,'P','520000009006') returning id into v_o;
  insert into viaje (tenant_id, operador_id) values (v_t, v_o) returning id into v_a;
  insert into viaje (tenant_id, operador_id, estatus) values (v_t, v_o, 'liquidado') returning id into v_b;

  insert into gasto (tenant_id, viaje_id, concepto, monto, img_hash)
    values (v_t, v_a, 'alimentacion', 199, 'HASH-REPETIDO');
  begin
    insert into gasto (tenant_id, viaje_id, concepto, monto, img_hash)
      values (v_t, v_b, 'alimentacion', 199, 'HASH-REPETIDO');
  exception when unique_violation then choco := true; msg := SQLERRM;
  end;

  insert into gasto (tenant_id, viaje_id, concepto, monto, img_hash)
    values (v_t,v_a,'caseta',50,null),(v_t,v_b,'caseta',50,null);
  select count(*) into sin_hash from gasto where tenant_id = v_t and img_hash is null;

  raise exception E'HASH  repetido-entre-viajes-rebotado=%  sin-hash-que-entraron=%  msg=%   (esperado t / 2 / nombra uq_gasto_img_hash)',
    choco, sin_hash, msg;
end $$;


-- ── 9. Aislamiento entre flotas en la clave, no en la app (mig. 0028) ───────
-- Hasta la 0028 ninguna FK llevaba el tenant: un autenticado de la flota A podía
-- colgar un gasto SUYO del viaje de la flota B. El WITH CHECK de la policy pasa
-- (el tenant_id es el suyo) y la FK pasa (el viaje existe). La fila queda
-- invisible para B y contada en el 15% de combustible de A.
do $$
declare
  t_a uuid; t_b uuid; o_a uuid; o_b uuid; vi_b uuid;
  choco boolean := false; msg text := ''; propio boolean := false;
begin
  insert into tenant (nombre) values ('ZZZ VERIF AISLA A') returning id into t_a;
  insert into tenant (nombre) values ('ZZZ VERIF AISLA B') returning id into t_b;
  insert into operador (tenant_id, nombre, telefono) values (t_a,'PA','520000009007') returning id into o_a;
  insert into operador (tenant_id, nombre, telefono) values (t_b,'PB','520000009008') returning id into o_b;
  insert into viaje (tenant_id, operador_id) values (t_b, o_b) returning id into vi_b;

  begin
    insert into gasto (tenant_id, viaje_id, concepto, monto) values (t_a, vi_b, 'diesel', 50000);
  exception when foreign_key_violation then choco := true; msg := SQLERRM;
  end;

  -- Y el camino normal —gasto en el viaje de tu propia flota— tiene que pasar.
  begin
    insert into gasto (tenant_id, viaje_id, concepto, monto) values (t_b, vi_b, 'diesel', 4200);
    propio := true;
  exception when foreign_key_violation then propio := false;
  end;

  raise exception E'AISLAMIENTO  gasto-de-A-en-viaje-de-B-rebotado=%  gasto-propio-pasa=%  msg=%   (esperado t / t / nombra gasto_viaje_tenant_fkey)',
    choco, propio, msg;
end $$;


-- ── 10. Un operador, un viaje abierto (mig. 0029) ───────────────────────────
-- Con dos abiertos, todas las fotos se cuelgan del más nuevo y el viejo cierra
-- con el anticipo entero en contra del operador. Cerrar el primero tiene que
-- liberar el hueco: si no, el operador no podría empezar nunca otro viaje.
do $$
declare
  v_t uuid; v_o uuid; v1 uuid;
  segundo boolean := false; tras_cierre boolean := false;
begin
  insert into tenant (nombre) values ('ZZZ VERIF ABIERTO') returning id into v_t;
  insert into operador (tenant_id, nombre, telefono) values (v_t,'P','520000009009') returning id into v_o;
  insert into viaje (tenant_id, operador_id) values (v_t, v_o) returning id into v1;

  begin
    insert into viaje (tenant_id, operador_id) values (v_t, v_o);
  exception when unique_violation then segundo := true;
  end;

  update viaje set estatus = 'liquidado' where id = v1;

  begin
    insert into viaje (tenant_id, operador_id) values (v_t, v_o);
    tras_cierre := true;
  exception when unique_violation then tras_cierre := false;
  end;

  raise exception E'VIAJE ABIERTO  segundo-rebota=%  tras-cerrar-el-primero-pasa=%   (esperado t / t)',
    segundo, tras_cierre;
end $$;


-- ── 11. Dominios: lo que el motor no sabe manejar ya no entra (mig. 0025) ───
-- 'combustible' en vez de 'diesel' se salta el tope de política, la regla de
-- combustible en efectivo y el contador del 15%, y suma a totalComprobado como
-- si fuera deducible. Un `estatus = 'activo'` deja al operador sin viaje para
-- siempre. Un `forma_pago = 'efectivo'` apaga LISR 27-III.
do $$
declare
  v_t uuid; v_o uuid; v_v uuid;
  concepto boolean := false; estatus boolean := false; pago boolean := false; rol boolean := false;
begin
  insert into tenant (nombre) values ('ZZZ VERIF DOMINIO') returning id into v_t;
  insert into operador (tenant_id, nombre, telefono) values (v_t,'P','520000009010') returning id into v_o;
  insert into viaje (tenant_id, operador_id) values (v_t, v_o) returning id into v_v;

  begin
    insert into gasto (tenant_id, viaje_id, concepto, monto, forma_pago)
      values (v_t, v_v, 'combustible', 9000, '01');
  exception when check_violation then concepto := true;
  end;

  begin
    update viaje set estatus = 'activo' where id = v_v;
  exception when check_violation then estatus := true;
  end;

  begin
    insert into gasto (tenant_id, viaje_id, concepto, monto, forma_pago)
      values (v_t, v_v, 'diesel', 9000, 'efectivo');
  exception when check_violation then pago := true;
  end;

  -- De este depende is_superadmin(), o sea la RLS de las 7 tablas de negocio.
  begin
    insert into app_user (id, tenant_id, email, rol)
      values (gen_random_uuid(), v_t, 'zzz-verif@likida.test', 'super_admin');
  exception when check_violation then rol := true;
  end;

  raise exception E'DOMINIOS  concepto-inventado=%  estatus-inventado=%  forma_pago-texto=%  rol-mal-escrito=%   (esperado t / t / t / t)',
    concepto, estatus, pago, rol;
end $$;


-- ── 12. Qué va a tocar la 0027 antes de aplicarla ───────────────────────────
-- SOLO LECTURA: no inserta, no actualiza, no borra. Es el paso previo a
-- `supabase db push` de la 0027, que degrada a NULL el `img_hash` del duplicado
-- más nuevo de cada grupo (conservando el valor en `ocr_extra.imgHashDuplicado`).
--
-- Correrlo ANTES importa porque la base no puede distinguir un ENSAYO del demo
-- —las mismas 17 fotos mandadas dos veces— de un fraude —el mismo ticket cobrado
-- contra dos anticipos—. Son el mismo archivo en dos viajes. Esa distinción es
-- de quien mira la lista, y esta es la lista.
--
-- Medido el 28-jul-2026: 1 grupo, el hash 250a4e5b… en los gastos
-- 26fd8543-… (viaje …00ff) y 19299f03-… (viaje …00fe), $199.00 los dos.
do $$
declare r record; msg text := ''; n int := 0;
begin
  for r in
    select g.tenant_id,
           g.img_hash,
           count(*) as veces,
           count(distinct g.viaje_id) as viajes,
           sum(g.monto) as monto_sumado,
           string_agg(g.id::text || ' (viaje ' || right(g.viaje_id::text, 6) ||
                      ', $' || g.monto::text || ')', E'\n      ' order by g.created_at) as filas
    from gasto g
    where g.img_hash is not null
    group by g.tenant_id, g.img_hash
    having count(*) > 1
  loop
    n := n + 1;
    msg := msg || format(E'\n  · tenant %s · hash %s… · %s gastos en %s viajes · suma $%s\n      %s',
                         r.tenant_id, left(r.img_hash, 12), r.veces, r.viajes, r.monto_sumado, r.filas);
  end loop;

  if n = 0 then
    raise exception 'FOTOS REPETIDAS  grupos=0 → la 0027 se puede aplicar tal cual, no degrada ningún hash.';
  end if;

  raise exception E'FOTOS REPETIDAS  grupos=%  → la 0027 degradará a NULL el img_hash del MÁS NUEVO de cada grupo (el valor se guarda en ocr_extra.imgHashDuplicado):%\n\nRevísalos uno por uno: la base no sabe si es un ensayo del demo o el mismo ticket cobrado dos veces.', n, msg;
end $$;


-- ── 13. La sonda de índices dice la verdad (mig. 0030) ──────────────────────
-- La 0030 existe porque el arranque AFIRMABA verificar el unique de
-- `gasto.cfdi_uuid` y no podía: sondeaba `select cfdi_uuid from gasto limit 1`,
-- y esa columna es de `0001_init.sql` — responde igual de bien en una base donde
-- la 0019 nunca se aplicó. Se cambió por `indices_faltantes`, que mira
-- `pg_indexes`, y ese cambio se quedó SIN bloque aquí: la única migración que
-- existe para que un chequeo deje de mentir era la única sin comprobar.
--
-- Un falso negativo aquí no rompe nada visible: deja que el arranque diga `ok`
-- sobre una base que liquida el mismo CFDI dos veces y acredita su IVA doble.
do $$
declare
  inventado text[]; real_falta text[]; ninguno text[];
begin
  -- Un índice que NO existe tiene que salir en la lista.
  inventado := indices_faltantes(array['uq_no_existe_jamas_zzz']);
  -- Uno que SÍ existe no puede salir. Si `uq_gasto_cfdi_uuid` aparece aquí, la
  -- 0019 no está aplicada y es una alarma de dinero, no de esta prueba.
  real_falta := indices_faltantes(array['uq_gasto_cfdi_uuid']);
  -- La lista vacía devuelve vacío, no null: el TS hace `faltantes.length`.
  ninguno := indices_faltantes(array[]::text[]);

  raise exception E'INDICES_FALTANTES  ve-el-que-falta=%  calla-el-que-existe=%  vacio-no-es-null=%   (esperado t / t / t)',
    inventado = array['uq_no_existe_jamas_zzz'],
    real_falta = '{}'::text[],
    ninguno is not null and cardinality(ninguno) = 0;
end $$;


-- ── 14. El contador de la barrera (mig. 0011 + 0031) ───────────────────────
-- La 0011 tampoco tenía bloque, y salió a la luz al escribir la lista de
-- `migraciones_verificadas.test.ts` — la cuarta que aparece por escribirla.
-- El `-1` del OCR vive en un `finally` (processor.ts) y un `finally` no corre si
-- el proceso no vuelve. Con `maxDuration = 120` en el webhook, una función que
-- Vercel mata por tope, por memoria o por un despliegue a media ráfaga deja el
-- `+1` escrito para siempre.
--
-- Desde ese momento ese viaje queda averiado de forma permanente: cada "listo"
-- espera los 20s completos de la barrera y le avisa al operador que se cuadró
-- con gastos parciales sobre una liquidación que estaba entera.
--
-- El olvido tiene que ocurrir también en el SONDEO (`p_delta = 0`), que es como
-- lo llama `esperarIntake`: si solo ocurriera al incrementar, la barrera no se
-- abriría hasta que llegara una foto nueva — y después de una caída puede que no
-- llegue ninguna.
do $$
declare
  v_t uuid; v_o uuid; v_v uuid;
  huerfano int; tras_sondeo int; vivo int; sellado boolean;
  nunca_negativo int; inexistente int;
begin
  insert into tenant (nombre) values ('ZZZ VERIF BARRERA') returning id into v_t;
  insert into operador (tenant_id, nombre, telefono) values (v_t,'P','520000009013') returning id into v_o;
  insert into viaje (tenant_id, operador_id) values (v_t, v_o) returning id into v_v;

  -- ── La garantía propia de la 0011 ────────────────────────────────────────
  -- El contador NO puede bajar de 0. Un `-1` de más —un reintento de Meta que
  -- reprocesa un intake ya contado— dejaría el contador en negativo, y entonces
  -- las fotos siguientes tendrían que subirlo desde ahí: la barrera se abriría
  -- con OCR todavía en vuelo, que es exactamente lo que la 0011 vino a impedir.
  nunca_negativo := intake_delta(v_v, -3);
  -- Y un viaje que no existe devuelve 0, no null: `intakeDelta` distingue null
  -- ("no pude preguntar", fail-closed) de 0 ("no hay nada en vuelo").
  inexistente := intake_delta('00000000-0000-0000-0000-000000000000'::uuid, 0);

  -- ── El TTL, que es lo que agrega la 0031 ─────────────────────────────────
  -- Una foto entra y su proceso muere: queda el +1 sin su -1.
  huerfano := intake_delta(v_v, 1);
  -- Se envejece el sello a mano para no esperar diez minutos reales.
  update viaje set intake_pendientes_en = now() - interval '11 minutes' where id = v_v;

  -- El sondeo de `esperarIntake`. Tiene que ver 0 y abrir la barrera.
  tras_sondeo := intake_delta(v_v, 0);

  -- Y un contador RECIÉN sellado no se puede tirar: eso reabriría la barrera
  -- sobre fotos que sí están en vuelo, que es el bug que la 0011 vino a cerrar.
  vivo := intake_delta(v_v, 1);
  select intake_pendientes_en > now() - interval '1 minute' into sellado
    from viaje where id = v_v;
  vivo := intake_delta(v_v, 0);

  raise exception E'BARRERA  nunca-negativo=%  viaje-inexistente=%  huerfano-cuenta=%  sondeo-lo-olvida=%  sella-al-incrementar=%  reciente-sobrevive=%   (esperado 0 / 0 / 1 / 0 / t / 1)',
    nunca_negativo, inexistente, huerfano, tras_sondeo, sellado, vivo;
end $$;


-- ── 15. Un mensaje de Meta se procesa una vez (mig. 0002) ───────────────────
-- Meta reintenta el webhook. El `insert ... on conflict` sobre la llave primaria
-- de `wa_mensaje_procesado` ES el claim atómico: sin el unique, dos entregas del
-- mismo mensaje en paralelo pasan las dos y el gasto se duplica.
--
-- No tenía bloque. Se descubrió al escribir la lista de
-- `migraciones_verificadas.test.ts`, que es justo para lo que sirve la lista.
do $$
declare
  segundo_rebota boolean := false;
  claim_ok boolean;
begin
  insert into wa_mensaje_procesado (wa_message_id) values ('ZZZ_VERIF_IDEMP_0002');

  begin
    insert into wa_mensaje_procesado (wa_message_id) values ('ZZZ_VERIF_IDEMP_0002');
  exception when unique_violation then segundo_rebota := true;
  end;

  -- Y la forma que usa el código: `on conflict do nothing` no inserta y no truena.
  with i as (
    insert into wa_mensaje_procesado (wa_message_id) values ('ZZZ_VERIF_IDEMP_0002')
    on conflict do nothing returning 1
  ) select count(*) = 0 into claim_ok from i;

  raise exception E'IDEMPOTENCIA  segundo-rebota=%  on-conflict-no-inserta=%   (esperado t / t)',
    segundo_rebota, claim_ok;
end $$;


-- ── 16. Lo interno no es ejecutable por un anónimo (mig. 0012) ──────────────
-- Este NO inserta nada: se lee el catálogo, porque un `do $$` corre como el
-- dueño y bypasea RLS — comprobarlo insertando probaría el privilegio de quien
-- corre la prueba, no la garantía.
--
-- Lo que protege: sin RLS en `wa_mensaje_procesado`, un anónimo puede INSERTAR
-- ids falsos por PostgREST y hacer que mensajes reales se descarten como
-- duplicados. Los gastos de ese operador desaparecen sin un solo error. Y sin
-- revocar las RPC, un anónimo suelta el mutex de un viaje ajeno o le mueve el
-- contador de la barrera.
--
-- `revoke ... from anon` NO basta y por eso se revoca de PUBLIC: las funciones
-- se otorgan a PUBLIC por defecto, y `anon` hereda de ahí.
do $$
declare
  rls_on boolean; anon_intake boolean; anon_lock boolean; anon_unlock boolean;
  svc_intake boolean;
begin
  select relrowsecurity into rls_on
    from pg_class where oid = 'public.wa_mensaje_procesado'::regclass;

  anon_intake := has_function_privilege('anon', 'public.intake_delta(uuid,integer)', 'execute');
  anon_lock   := has_function_privilege('anon', 'public.try_lock_viaje(uuid,integer)', 'execute');
  anon_unlock := has_function_privilege('anon', 'public.unlock_viaje(uuid)', 'execute');
  -- Y el pipeline SÍ tiene que poder: una revocación de más rompe la barrera
  -- entera, que es un fallo tan caro como el hueco que cierra.
  svc_intake  := has_function_privilege('service_role', 'public.intake_delta(uuid,integer)', 'execute');

  raise exception E'PERMISOS  rls-en-wa_mensaje=%  anon-intake=%  anon-lock=%  anon-unlock=%  service-role-intake=%   (esperado t / f / f / f / t)',
    rls_on, anon_intake, anon_lock, anon_unlock, svc_intake;
end $$;


-- ── 17. La constancia del aviso sobrevive a un envío fallido (mig. 0033) ────
-- La 0018 puso la RESERVA y la CONSTANCIA en la misma fila:
-- `marcar_aviso_privacidad` escribía `aviso_privacidad_en = now()` antes de
-- mandar el mensaje. Correcto contra el envío duplicado — y por eso se hizo así.
--
-- Pero esa fila es la prueba del art. 16 de la LFPDPPP, así que deshacer la
-- reserva borraba la constancia. Con un aviso que cambia de versión el camino
-- completo es:
--
--   v1 entregado hace tres meses → la flota corrige la liga de su aviso integral
--   → el texto cambia → v2 → llega un mensaje → la reserva gana porque la
--   versión es distinta y PISA la constancia de v1 → Meta rechaza el envío
--   (pasó el 28-jul) → liberar ponía las dos columnas en NULL.
--
-- La base terminaba diciendo que ese operador nunca recibió ningún aviso. Y sí
-- lo recibió. Ante la autoridad la carga de probar el art. 16 es del
-- responsable: "no consta" es el peor estado posible, y se llegaba a él
-- destruyendo una prueba verdadera.
--
-- Esto es lo único que puede demostrarlo: el TS prueba que se llama a la RPC
-- correcta, no lo que la RPC hace con la fila.
do $$
declare
  v_t uuid; v_o uuid;
  gano_v1 boolean; gano_repetido boolean; gano_v2 boolean;
  constancia_v1 timestamptz; constancia_tras_fallo timestamptz;
  version_tras_fallo text; reserva_tras_fallo timestamptz;
  solto boolean; solto_de_nuevo boolean; gano_tras_ttl boolean;
begin
  insert into tenant (nombre) values ('ZZZ VERIF AVISO') returning id into v_t;
  insert into operador (tenant_id, nombre, telefono) values (v_t,'P','520000009017') returning id into v_o;

  -- 1. Primer aviso: se reserva, sale, y se hace constar.
  gano_v1 := marcar_aviso_privacidad(v_o, v_t, 'v1');
  gano_repetido := marcar_aviso_privacidad(v_o, v_t, 'v1');  -- otro camino, misma ráfaga
  perform confirmar_aviso_privacidad(v_o, v_t, 'v1');
  select aviso_privacidad_en into constancia_v1 from operador where id = v_o;

  -- 2. Cambia el texto de la flota. Se reserva el reenvío…
  gano_v2 := marcar_aviso_privacidad(v_o, v_t, 'v2');
  -- …y el envío FALLA, así que se suelta la reserva.
  solto := liberar_aviso_privacidad(v_o, v_t);
  solto_de_nuevo := liberar_aviso_privacidad(v_o, v_t);  -- ya no hay nada que soltar

  select aviso_privacidad_en, aviso_privacidad_version, aviso_privacidad_claim_en
    into constancia_tras_fallo, version_tras_fallo, reserva_tras_fallo
    from operador where id = v_o;

  -- 3. La reserva expira sola: un proceso que muera entre reservar y confirmar
  --    no puede dejar a un operador sin su aviso para siempre.
  perform marcar_aviso_privacidad(v_o, v_t, 'v2');
  update operador set aviso_privacidad_claim_en = now() - interval '6 minutes' where id = v_o;
  gano_tras_ttl := marcar_aviso_privacidad(v_o, v_t, 'v2');

  raise exception E'AVISO  gana-1a=%   2do-camino-rebota=%  reenvio-por-version=%  CONSTANCIA-INTACTA=%  version-intacta=%  reserva-suelta=%  solto=%  solto-2a-vez=%  reserva-expira=%   (esperado t / f / t / t / v1 / t / t / f / t)',
    gano_v1,
    gano_repetido,
    gano_v2,
    constancia_tras_fallo = constancia_v1,   -- ← EL HALLAZGO: no se borró
    version_tras_fallo,
    reserva_tras_fallo is null,
    solto, solto_de_nuevo, gano_tras_ttl;
end $$;


-- ── 18. El aislamiento entre flotas, mirado en el catálogo (barrido 31-jul) ──
-- SOLO LECTURA. Nace del barrido de producción del 31-jul, en el que se atacó la
-- API REST como anónimo con la llave publicable: 14 tablas leídas → 0 filas, y
-- cinco escrituras rechazadas (envenenar la idempotencia, inventar un gasto,
-- soltar el mutex de un viaje ajeno, mover el contador de la barrera, marcar una
-- constancia de aviso falsa).
--
-- Aquello fue una foto de ese momento. Esto es lo que se puede volver a correr, y
-- comprueba las tres formas de perder el aislamiento SIN que nada falle:
--
--   1. una tabla nueva SIN RLS — el default de Postgres es permitir,
--   2. una política que diga `true` — se ve igual de segura en la lista y no
--      filtra nada,
--   3. una función interna ejecutable por `anon`.
--
-- LO QUE NO ES UN HALLAZGO, para que nadie lo "arregle": `codigo_pendiente`,
-- `viaje_lock` y `wa_mensaje_procesado` tienen RLS y CERO políticas. Eso es
-- denegación total a anon/authenticated y es exactamente lo que la 0012 buscaba;
-- solo el service-role escribe ahí. Y `get_user_tenant_ids()`/`is_superadmin()`
-- son SECURITY DEFINER ejecutables por anon a propósito: las usan las once
-- políticas, y resuelven contra `auth.uid()`, que para un anónimo es NULL —
-- devuelven vacío y false. Revocarlas rompe el aislamiento en vez de cerrarlo.
do $$
declare
  sin_rls text; con_true text; rpc_abierta text;
begin
  select coalesce(string_agg(c.relname, ', ' order by c.relname), '—') into sin_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

  -- Una política permisiva cuya expresión sea literalmente `true` deja pasar
  -- todo con RLS encendido: el peor estado, porque el tablero dice "protegida".
  select coalesce(string_agg(tablename || '.' || policyname, ', '), '—') into con_true
    from pg_policies
   where schemaname = 'public' and permissive = 'PERMISSIVE'
     and btrim(coalesce(qual, with_check, '')) in ('true', '(true)');

  -- Las RPC internas del pipeline. Ninguna puede ser ejecutable por `anon`.
  select coalesce(string_agg(p.proname, ', ' order by p.proname), '—') into rpc_abierta
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('try_lock_viaje','unlock_viaje','intake_delta','enriquecer_gasto_codigo',
                       'guardar_liquidacion_tx','marcar_aviso_privacidad','confirmar_aviso_privacidad',
                       'liberar_aviso_privacidad','indices_faltantes')
     and has_function_privilege('anon', p.oid, 'execute');

  raise exception E'AISLAMIENTO  tablas-sin-rls=%  politicas-que-dicen-true=%  rpc-abiertas-a-anon=%   (esperado — / — / —)',
    sin_rls, con_true, rpc_abierta;
end $$;


-- ── 19. Un gasto no entra después de emitida la liquidación (mig. 0036) ─────
-- Cierra el ÚLTIMO crítico de código de las siete rondas de auditoría.
--
-- `guardar_liquidacion` genera los dos PDF en T1; segundos después
-- `guardiaCifras` VUELVE A CALCULAR para armar el texto de WhatsApp (T2). Entre
-- los dos, la tabla `gasto` seguía abierta: las fotos corren en su propio
-- `processInbound`, no toman el mutex del viaje, y `addGasto` no miraba nada.
--
--   T1  5 gastos, $4,850 → PDF: "Sobró $150.00 (a favor de la empresa)"
--   T2  6 gastos, $5,650 → WhatsApp: "Pusiste $650.00 de tu bolsa"
--
-- Las dos cosas seguidas, con $800 de diferencia y de SIGNO CONTRARIO, y el
-- sexto gasto huérfano de por vida.
--
-- El `for update` del trigger es lo que lo cierra de verdad: sin él, en READ
-- COMMITTED el trigger no vería la liquidación aún sin confirmar y dejaría pasar
-- el gasto — el mismo bug, movido de sitio.
--
-- Corrido el 31-jul, salida real:  t / f / CU001 / t
do $$
declare
  v_t uuid; v_o uuid; v_v uuid; v_o2 uuid; v_x uuid;
  antes boolean := false; tarde boolean := false; msg text := ''; sin_liq boolean := false;
begin
  insert into tenant (nombre) values ('ZZZ VERIF TARDE') returning id into v_t;
  insert into operador (tenant_id, nombre, telefono) values (v_t,'P','520000009019') returning id into v_o;
  insert into viaje (tenant_id, operador_id) values (v_t, v_o) returning id into v_v;

  begin
    insert into gasto (tenant_id, viaje_id, concepto, monto) values (v_t, v_v, 'diesel', 850);
    antes := true;
  exception when others then antes := false;
  end;

  perform guardar_liquidacion_tx(v_t, v_v, 4850, 5000, 150, 'cuadrada', '[]'::jsonb, 0,0,0, 'https://x/liq.pdf', 0);

  -- La foto que llegó tarde. ESTE es el bug.
  begin
    insert into gasto (tenant_id, viaje_id, concepto, monto) values (v_t, v_v, 'diesel', 800);
    tarde := true;
  exception when others then tarde := false; msg := SQLSTATE;
  end;

  -- Un viaje marcado `liquidado` SIN liquidación emitida sigue aceptando gastos:
  -- es lo que hace el bloque 8, que con la 0029 no puede tener dos abiertos del
  -- mismo operador. La regla se ancla a la liquidación, no al estatus.
  begin
    insert into operador (tenant_id, nombre, telefono) values (v_t,'Q','520000009020') returning id into v_o2;
    insert into viaje (tenant_id, operador_id, estatus) values (v_t, v_o2, 'liquidado') returning id into v_x;
    insert into gasto (tenant_id, viaje_id, concepto, monto) values (v_t, v_x, 'caseta', 50);
    sin_liq := true;
  exception when others then sin_liq := false;
  end;

  raise exception E'TARDE  entra-antes=%  rebota-despues=%  sqlstate=%  liquidado-sin-liquidacion-sigue=%   (esperado t / f / CU001 / t)',
    antes, tarde, msg, sin_liq;
end $$;

-- ── 20. Un UPDATE tampoco puede reescribir el dinero tras liquidar (mig. 0037) ──
-- AUDITORÍA 8, ALTO (modelo de datos). La 0036 (bloque 19) blindaba el INSERT;
-- `updateGastoCfdiXml` (repo.ts:198) es un UPDATE que pega un XML a un gasto ya
-- existente y puede reescribir `monto`, `sub_total`, `iva_traslado` e
-- `ieps_traslado` — las cifras que ya se imprimieron si el viaje se liquidó
-- entre medias. Nada lo veía.
--
-- El `when` del trigger solo mira los campos financieros/UUID: un UPDATE que no
-- toque ninguno de esos (p. ej. solo `clave_prod_serv`) sigue pasando, y eso
-- también se comprueba aquí para no bloquear de más.
do $$
declare
  v_t uuid; v_o uuid; v_v uuid; v_g uuid;
  monto_bloqueado boolean := false; msg text := ''; no_financiero_pasa boolean := false;
begin
  insert into tenant (nombre) values ('ZZZ VERIF UPDATE TARDE') returning id into v_t;
  insert into operador (tenant_id, nombre, telefono) values (v_t,'P','520000009020') returning id into v_o;
  insert into viaje (tenant_id, operador_id) values (v_t, v_o) returning id into v_v;
  insert into gasto (tenant_id, viaje_id, concepto, monto) values (v_t, v_v, 'diesel', 850) returning id into v_g;

  perform guardar_liquidacion_tx(v_t, v_v, 850, 1000, 150, 'cuadrada', '[]'::jsonb, 0,0,0, 'https://x/liq.pdf', 0);

  -- El XML que llega tarde intentando corregir el monto. ESTE es el bug.
  begin
    update gasto set monto = 800, cfdi_uuid = gen_random_uuid()::text where id = v_g;
    monto_bloqueado := false;
  exception when others then monto_bloqueado := true; msg := SQLSTATE;
  end;

  -- Control: un campo no financiero (aquí, clave_prod_serv) sigue pudiendo
  -- corregirse después de liquidar — el trigger no bloquea de más.
  begin
    update gasto set clave_prod_serv = '15101505' where id = v_g;
    no_financiero_pasa := true;
  exception when others then no_financiero_pasa := false;
  end;

  raise exception E'UPDATE TARDE  bloqueado=%  sqlstate=%  no-financiero-sigue-pasando=%   (esperado t / CU001 / t)',
    monto_bloqueado, msg, no_financiero_pasa;
end $$;

-- ── 21. Como mucho UNA foto pendiente por viaje, y el reclamo es atómico (mig. 0038) ──
-- AUDITORÍA 8, ALTO REINCIDENTE (rendimiento). `foto_pendiente` retiene el
-- ticket sin código por si le sigue el acercamiento, para pagar UNA visión en
-- vez de dos. La garantía que solo Postgres puede demostrar es el `unique
-- (viaje_id)`: sin ella, dos fotos SIN código del mismo viaje podrían quedar
-- ambas esperando, y el acercamiento que llegue después emparejaría con
-- CUALQUIERA de las dos — arriesgando fusionar dos tickets DISTINTOS en uno,
-- perdiendo un gasto real entero. El unique hace que la segunda simplemente no
-- pueda esperar: se procesa sola, como hoy.
--
-- También se comprueba que el reclamo (`delete ... returning`) es lo que hace
-- imposible que dos llamadores —el acercamiento y la propia foto venciendo su
-- plazo— se lleven la misma fila los dos.
do $$
declare
  v_t uuid; v_o uuid; v_v uuid;
  primera_ok boolean := false; segunda_bloqueada boolean := false; msg text := '';
  fila_id uuid; media text;
  reclamo1_ok boolean; reclamo2_ok boolean;
begin
  insert into tenant (nombre) values ('ZZZ VERIF FOTO PENDIENTE') returning id into v_t;
  insert into operador (tenant_id, nombre, telefono) values (v_t,'P','520000009021') returning id into v_o;
  insert into viaje (tenant_id, operador_id) values (v_t, v_o) returning id into v_v;

  insert into foto_pendiente (tenant_id, viaje_id, media_id) values (v_t, v_v, 'media-1');
  primera_ok := true;

  -- La SEGUNDA foto sin código del MISMO viaje: el unique la rechaza.
  begin
    insert into foto_pendiente (tenant_id, viaje_id, media_id) values (v_t, v_v, 'media-2');
    segunda_bloqueada := false;
  exception when others then segunda_bloqueada := true; msg := SQLSTATE;
  end;

  -- El reclamo (lo que hace `reclamarFotoPendiente`): el primero que llega se
  -- la lleva, y ahí ya no queda nada que un segundo pueda reclamar.
  delete from foto_pendiente where viaje_id = v_v returning id, media_id into fila_id, media;
  reclamo1_ok := fila_id is not null and media = 'media-1';

  begin
    delete from foto_pendiente where viaje_id = v_v returning id into fila_id;
    reclamo2_ok := fila_id is not null; -- debería quedar en NULL: no hay fila
  exception when others then reclamo2_ok := false;
  end;

  raise exception E'FOTO PENDIENTE  primera=%  segunda-bloqueada=%  sqlstate=%  reclamo1=%  reclamo2-nada-que-tomar=%   (esperado t / t / 23505 / t / f)',
    primera_ok, segunda_bloqueada, msg, reclamo1_ok, reclamo2_ok;
end $$;

-- ── 22. La foto del ticket no es pública (mig. 0039) ────────────────────────
-- Un ticket no es un dato inocuo: trae RFC y domicilio del establecimiento, a
-- veces el nombre del titular de la tarjeta, y —en una farmacia— el nombre del
-- medicamento, que es dato SENSIBLE del art. 2 fr. VI de la LFPDPPP.
--
-- Un bucket público no falla ruidosamente: sirve. La liquidación se ve bien, el
-- panel enseña las fotos, y el expediente de gastos de toda la flota queda
-- accesible para quien adivine el nombre de un archivo, sin que nada avise. Es
-- exactamente la clase de garantía que solo la base puede demostrar y que una
-- prueba en TS con Supabase mockeado probaría contra el mock.
--
-- Se comprueba `buckets_publicos = 0` y no solo el de comprobantes: el modo de
-- falla real es que alguien cree el siguiente bucket con el default equivocado,
-- y ese día esto tiene que ponerse rojo aunque la 0039 siga bien.
--
-- Corrido el 1-ago, salida real:  1 / f / 0 / t / 0
select
  (select count(*) from storage.buckets where id='comprobantes')                    as existe,
  (select bool_or(public) from storage.buckets where id='comprobantes')             as publico,
  (select count(*) from storage.buckets where public)                               as buckets_publicos,
  (select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='storage' and c.relname='objects')                              as rls_objects,
  (select count(*) from pg_policies
    where schemaname='storage' and tablename='objects'
      and (qual like '%comprobantes%' or with_check like '%comprobantes%'))         as policies_comprobantes;
-- existe=1 · publico=f · buckets_publicos=0 · rls_objects=t · policies=0
-- (sin policy sobre storage.objects, RLS deniega a anon/authenticated; solo el
--  service-role escribe y firma. Mismo criterio que la 0008 y la 0038.)
