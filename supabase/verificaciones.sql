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

-- ── 21. (retirado) ──────────────────────────────────────────────────────────
-- Verificaba `foto_pendiente` (mig. 0038): unicidad por viaje y reclamo
-- atómico. AUDITORÍA 9, CRÍTICO — el mecanismo que esa tabla sostenía fusionaba
-- comprobantes DISTINTOS cuando llegaban fuera de orden (dos auditores
-- independientes, agéntico y backend); se revirtió (mig. 0041, `drop table`)
-- y este bloque ya no tiene qué comprobar. Los números 5-20 y 22+ no se
-- renumeran para no invalidar referencias existentes a ellos.

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

-- ── 23. La sala de espera no es legible por un anónimo (mig. 0040) ──────────
-- `comprobante_huerfano` guarda la EXTRACCIÓN COMPLETA de tickets que todavía
-- no tienen viaje: montos, folios, RFC del establecimiento, fechas. Es un
-- expediente de gastos de operadores de todas las flotas en una sola tabla.
--
-- Y los grants de tabla NO la protegen: `anon` y `authenticated` tienen
-- SELECT/INSERT/UPDATE/DELETE sobre ella (8 grants), porque es el default del
-- esquema `public` en Supabase. Lo ÚNICO que la cierra es el RLS sin policy.
-- O sea: la línea `alter table ... enable row level security` de la 0040 no es
-- defensa en profundidad, es la defensa.
--
-- Por eso no vale con mirar `relrowsecurity`: se comprueba LEYENDO como anon
-- con una fila sembrada. Un `enable` mal aplicado, o un `force` que falte el
-- día que la tabla cambie de dueño, se ve aquí y no en el catálogo.
--
-- Corrido el 1-ago, salida real:  anon=0 filas · service_role=1 fila
create temp table if not exists _res(quien text, filas int, nota text);
truncate _res;
do $$
declare n int; nota text;
begin
  begin
    set local role anon;
    select count(*) into n from comprobante_huerfano;
    reset role;
    nota := case when n = 0 then 'RLS lo deja a ciegas' else 'FUGA: anon LEE' end;
  exception when insufficient_privilege then
    reset role;
    n := -1; nota := 'denegado por privilegios de tabla';
  end;
  insert into _res values ('anon', n, nota);
  insert into _res select 'service_role', count(*), 've todo (BYPASSRLS)' from comprobante_huerfano;
end $$;
select * from _res order by quien;
-- anon         | 0 | RLS lo deja a ciegas      ← con una fila sembrada
-- service_role | 1 | ve todo (BYPASSRLS)
--
-- Si `anon` devuelve >0, el expediente de gastos de todas las flotas es público
-- para cualquiera con la anon key, que va en el navegador.

-- ── 24. Un UPDATE de solo `fecha` tampoco puede reescribirse tras liquidar (mig. 0042) ──
-- AUDITORÍA 9, ALTO (backend, seguridad y modelo de datos, tres auditores
-- independientes). El `when` de la 0037 (bloque 20) no incluía `fecha`;
-- `corregirFechaGasto` (repo.ts, ronda 9) hacía `UPDATE gasto SET fecha = …`
-- sin que el trigger lo viera. La fecha decide ejercicio fiscal, plazo de
-- facturación y la agrupación del tope diario de LISR 28-V — no es cosmética.
do $$
declare
  v_t uuid; v_o uuid; v_v uuid; v_g uuid;
  fecha_bloqueada boolean := false; msg text := ''; no_financiero_pasa boolean := false;
begin
  insert into tenant (nombre) values ('ZZZ VERIF FECHA TARDE') returning id into v_t;
  insert into operador (tenant_id, nombre, telefono) values (v_t,'P','520000009024') returning id into v_o;
  insert into viaje (tenant_id, operador_id) values (v_t, v_o) returning id into v_v;
  insert into gasto (tenant_id, viaje_id, concepto, monto, fecha) values (v_t, v_v, 'diesel', 850, '2026-01-08') returning id into v_g;

  perform guardar_liquidacion_tx(v_t, v_v, 850, 1000, 150, 'cuadrada', '[]'::jsonb, 0,0,0, 'https://x/liq.pdf', 0);

  -- El re-fechado que llega tarde: ESTE es el bug.
  begin
    update gasto set fecha = '2026-08-01' where id = v_g;
    fecha_bloqueada := false;
  exception when others then fecha_bloqueada := true; msg := SQLSTATE;
  end;

  -- Control: una columna que nunca debe bloquearse sigue pasando.
  begin
    update gasto set clave_prod_serv = '15101505' where id = v_g;
    no_financiero_pasa := true;
  exception when others then no_financiero_pasa := false;
  end;

  raise exception E'FECHA TARDE  bloqueada=%  sqlstate=%  no-financiero-sigue-pasando=%   (esperado t / CU001 / t)',
    fecha_bloqueada, msg, no_financiero_pasa;
end $$;

-- ── 25. La sonda de triggers dice la verdad (mig. 0043) ─────────────────────
-- AUDITORÍA 9, CRÍTICO (operabilidad) — mismo motivo exacto que el bloque 13
-- (`indices_faltantes`, mig. 0030): el arranque no podía sondear 0036/0037
-- porque PostgREST no expone `pg_trigger`. `triggers_faltantes` lo resuelve
-- mirando el catálogo; este bloque prueba que la SONDA misma dice la verdad,
-- no que los triggers existan (eso ya lo comprueban los bloques 19/20/24).
do $$
declare
  inventado text[]; real_falta text[]; ninguno text[];
begin
  inventado := triggers_faltantes(array['trigger_no_existe_jamas_zzz']);
  -- Si `trg_gasto_no_tras_liquidar` aparece aquí, la 0036 no está aplicada y
  -- es una alarma de dinero, no de esta prueba.
  real_falta := triggers_faltantes(array['trg_gasto_no_tras_liquidar']);
  ninguno := triggers_faltantes(array[]::text[]);

  raise exception E'TRIGGERS_FALTANTES  ve-el-que-falta=%  calla-el-que-existe=%  vacio-no-es-null=%   (esperado t / t / t)',
    inventado = array['trigger_no_existe_jamas_zzz'],
    real_falta = '{}'::text[],
    ninguno is not null and cardinality(ninguno) = 0;
end $$;

-- ── 26. El chofer solo ve sus propios viajes (mig. 0045) ─────────────────────
-- `tenant_data` da acceso completo al tenant a cualquier app_user, sin mirar
-- el rol — correcto para flota_admin/encargado/contador, un IDOR si se
-- repitiera para `operador`. Se siembran DOS choferes del mismo tenant, cada
-- uno con su viaje/gasto/liquidacion, se impersona al primero por
-- `request.jwt.claims` (mismo mecanismo que usa PostgREST con un JWT real) y
-- se cuenta qué ve. 1/1/1 = solo lo suyo. 2/2/2 sería la fuga.
do $$
declare
  v_t uuid; v_o1 uuid; v_o2 uuid; v_v1 uuid; v_v2 uuid; v_u1 uuid := gen_random_uuid();
  n_viaje int; n_gasto int; n_liq int; n_otro_viaje int;
begin
  insert into tenant (nombre) values ('ZZZ VERIF OPERADOR RLS') returning id into v_t;
  insert into operador (tenant_id, nombre, telefono) values (v_t, 'Chofer Uno', '520000009030') returning id into v_o1;
  insert into operador (tenant_id, nombre, telefono) values (v_t, 'Chofer Dos', '520000009031') returning id into v_o2;
  insert into viaje (tenant_id, operador_id) values (v_t, v_o1) returning id into v_v1;
  insert into viaje (tenant_id, operador_id) values (v_t, v_o2) returning id into v_v2;
  insert into gasto (tenant_id, viaje_id, concepto, monto) values (v_t, v_v1, 'diesel', 100), (v_t, v_v2, 'diesel', 200);
  insert into liquidacion (tenant_id, viaje_id) values (v_t, v_v1), (v_t, v_v2);
  insert into app_user (id, tenant_id, email, rol, operador_id)
    values (v_u1, v_t, 'zzz-verif-chofer1@likida.test', 'operador', v_o1);

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_u1)::text, true);

  select count(*) into n_viaje from viaje where tenant_id = v_t;
  select count(*) into n_gasto from gasto where tenant_id = v_t;
  select count(*) into n_liq from liquidacion where tenant_id = v_t;
  select count(*) into n_otro_viaje from viaje where id = v_v2;   -- el viaje del OTRO chofer, por id directo

  reset role;

  raise exception E'OPERADOR_RLS  viajes-del-tenant-visibles=%  gastos-visibles=%  liquidaciones-visibles=%  viaje-ajeno-por-id=%   (esperado 1 / 1 / 1 / 0 — nunca 2, que sería ver los dos choferes)',
    n_viaje, n_gasto, n_liq, n_otro_viaje;
end $$;

-- ── 27. Cada quien solo escribe SU PROPIO avatar (mig. 0046) ─────────────────
-- El bucket `avatares` es público a propósito (foto de perfil, no un
-- comprobante fiscal — bloque 22 es el caso contrario) — lo que sí tiene
-- que aislarse es la ESCRITURA: bucket público + storage.objects sin RLS
-- de escritura = cualquier autenticado pisa el avatar de cualquiera. Se
-- impersonan dos usuarios (mismo mecanismo del bloque 26): cada uno
-- intenta escribir en SU propia carpeta (debe pasar) y en la del otro
-- (debe fallar), directo contra `storage.objects` — así se prueba la
-- policy real, no un mock.
--
-- Corrido el 3-ago, salida real:  escribe-en-su-carpeta=t  escribe-en-carpeta-ajena=f
do $$
declare
  v_u1 uuid := gen_random_uuid();
  v_u2 uuid := gen_random_uuid();
  ok_propio boolean;
  ok_ajeno boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_u1)::text, true);

  begin
    insert into storage.objects (bucket_id, name, owner) values ('avatares', v_u1::text || '/avatar.jpg', v_u1);
    ok_propio := true;
  exception when others then
    ok_propio := false;
  end;

  begin
    insert into storage.objects (bucket_id, name, owner) values ('avatares', v_u2::text || '/avatar.jpg', v_u1);
    ok_ajeno := true;
  exception when others then
    ok_ajeno := false;
  end;

  reset role;
  -- `storage.objects` tiene un trigger (`protect_delete`) que bloquea el
  -- DELETE directo por SQL — hay que pedirlo explícito, o el cleanup de
  -- este mismo bloque revienta.
  set local storage.allow_delete_query = 'true';
  delete from storage.objects where bucket_id = 'avatares' and name in (v_u1::text || '/avatar.jpg', v_u2::text || '/avatar.jpg');

  raise exception E'AVATARES_RLS  escribe-en-su-carpeta=%  escribe-en-carpeta-ajena=%   (esperado true / false — ajeno=true sería la fuga)',
    ok_propio, ok_ajeno;
end $$;

-- ── 28. Las tablas de operación no se le abren al chofer (mig. 0047) ─────────
-- La 0047 mete cuatro tablas nuevas de golpe. Tres son de oficina (unidad,
-- mantenimiento, incidencia) y una es del chofer a medias (pod: la sube él,
-- pero solo la suya). El riesgo es el de siempre con una tabla nueva en un
-- esquema multi-tenant — nacer con `tenant_data` a secas, que NO mira el rol,
-- y regalarle al chofer las placas, las averías y las entregas de toda la
-- flota. Es exactamente el IDOR que la 0045 cerró para viaje/gasto/liquidacion,
-- y una tabla nueva es justo donde se vuelve a abrir sin que nadie lo note.
--
-- Se impersona a un chofer (mismo mecanismo del bloque 26) y se cuenta.
-- Esperado: 0 unidades, 0 mantenimientos, 0 incidencias, y de POD exactamente
-- 1 — el suyo — nunca 2.
--
-- Corrido el 3-ago contra la base real, salida:
--   unidades=0  mantenimientos=0  incidencias=0  pods-visibles=1  pod-ajeno-por-id=0
do $$
declare
  v_t uuid; v_o1 uuid; v_o2 uuid; v_v1 uuid; v_v2 uuid;
  v_un uuid; v_u1 uuid := gen_random_uuid();
  n_unidad int; n_mant int; n_inc int; n_pod int; n_pod_ajeno int;
begin
  insert into tenant (nombre) values ('ZZZ VERIF OPERACION RLS') returning id into v_t;
  insert into operador (tenant_id, nombre, telefono) values (v_t, 'Chofer Uno', '520000009040') returning id into v_o1;
  insert into operador (tenant_id, nombre, telefono) values (v_t, 'Chofer Dos', '520000009041') returning id into v_o2;
  insert into viaje (tenant_id, operador_id) values (v_t, v_o1) returning id into v_v1;
  insert into viaje (tenant_id, operador_id) values (v_t, v_o2) returning id into v_v2;

  insert into unidad (tenant_id, numero_economico, placas) values (v_t, 'C2-08', 'ABC-123-A') returning id into v_un;
  insert into mantenimiento (tenant_id, unidad_id, tipo, descripcion) values (v_t, v_un, 'preventivo', 'servicio 20 mil km');
  insert into incidencia (tenant_id, viaje_id, unidad_id, tipo, prioridad) values (v_t, v_v2, v_un, 'averia', 'alta');
  -- Un POD por chofer. `storage_path` va lleno porque el estado 'subido' lo
  -- exige (constraint pod_subido_tiene_archivo).
  insert into pod (tenant_id, viaje_id, operador_id, estado, storage_path)
    values (v_t, v_v1, v_o1, 'subido', 'pod/uno.jpg'), (v_t, v_v2, v_o2, 'subido', 'pod/dos.jpg');

  insert into app_user (id, tenant_id, email, rol, operador_id)
    values (v_u1, v_t, 'zzz-verif-chofer-op@likida.test', 'operador', v_o1);

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_u1)::text, true);

  select count(*) into n_unidad from unidad where tenant_id = v_t;
  select count(*) into n_mant   from mantenimiento where tenant_id = v_t;
  select count(*) into n_inc    from incidencia where tenant_id = v_t;
  select count(*) into n_pod    from pod where tenant_id = v_t;
  select count(*) into n_pod_ajeno from pod where viaje_id = v_v2;  -- el del OTRO chofer, por id directo

  reset role;

  raise exception E'OPERACION_RLS  unidades=%  mantenimientos=%  incidencias=%  pods-visibles=%  pod-ajeno-por-id=%   (esperado 0 / 0 / 0 / 1 / 0 — cualquier otra cosa es fuga al chofer)',
    n_unidad, n_mant, n_inc, n_pod, n_pod_ajeno;
end $$;

-- ── 29. El encargado NO ve dinero (mig. 0048 + 0049 + 0051) ─────────────────
-- Las tres migraciones comerciales meten seis tablas de dinero de golpe:
-- cliente, tarifa, factura_emitida, pago_recibido, factura_viaje, cotizacion.
-- El riesgo es el de la 0047 pero un escalón más arriba: ahí bastaba excluir
-- al chofer con `not is_operador()`, aquí no. El ENCARGADO (0044) es de
-- oficina —pasa ese filtro— y sin embargo no debe ver finanzas: la matriz de
-- `lib/auth/visibilidad.ts` le da 'operacion' y nada más.
--
-- Esa matriz vivía SOLO en TypeScript. Mientras el panel consulte con la
-- service role alcanza, pero cualquier usuario autenticado tiene la anon key y
-- puede pegarle a PostgREST directo: ahí la única frontera es RLS. Por eso la
-- 0048 crea `ve_finanzas()`, y esto comprueba que de verdad cierra.
--
-- Se impersona a un ENCARGADO (no a un chofer) y se cuenta. Esperado: 0 en las
-- seis. Cualquier otra cosa es una fuga de precios y saldos al jefe de tráfico.
do $$
declare
  v_t uuid; v_c uuid; v_f uuid; v_u1 uuid := gen_random_uuid();
  n_cli int; n_tar int; n_fac int; n_pag int; n_cot int; n_fv int;
begin
  insert into tenant (nombre) values ('ZZZ VERIF FINANZAS RLS') returning id into v_t;
  insert into cliente (tenant_id, nombre, rfc) values (v_t, 'Cliente Uno', 'XAXX010101000') returning id into v_c;
  insert into tarifa (tenant_id, cliente_id, modo, precio) values (v_t, v_c, 'por_viaje', 18500.00);
  insert into factura_emitida (tenant_id, cliente_id, subtotal, iva, total, estatus)
    values (v_t, v_c, 10000.00, 1600.00, 11600.00, 'emitida') returning id into v_f;
  insert into pago_recibido (tenant_id, factura_id, monto) values (v_t, v_f, 5000.00);
  insert into cotizacion (tenant_id, cliente_id, origen, destino, precio)
    values (v_t, v_c, 'Silao', 'Nuevo Laredo', 21000.00);

  -- Un ENCARGADO de esa misma flota: pasa `not is_operador()` y aun así no
  -- debe ver nada de esto.
  insert into app_user (id, tenant_id, email, rol)
    values (v_u1, v_t, 'zzz-verif-encargado@likida.test', 'encargado');

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_u1)::text, true);

  select count(*) into n_cli from cliente         where tenant_id = v_t;
  select count(*) into n_tar from tarifa          where tenant_id = v_t;
  select count(*) into n_fac from factura_emitida where tenant_id = v_t;
  select count(*) into n_pag from pago_recibido   where tenant_id = v_t;
  select count(*) into n_cot from cotizacion      where tenant_id = v_t;
  select count(*) into n_fv  from factura_viaje;

  reset role;

  raise exception E'FINANZAS_RLS  clientes=%  tarifas=%  facturas=%  pagos=%  cotizaciones=%  factura_viaje=%   (esperado 0 en las seis — cualquier otra cosa le abre precios y saldos al encargado)',
    n_cli, n_tar, n_fac, n_pag, n_cot, n_fv;
end $$;

-- ── 30. El rastreo: ni el chofer ve posiciones, ni el contador ve tokens (mig. 0050) ──
-- Dos garantías distintas en la misma migración, y por eso van juntas:
--
--   · `posicion` y `geocerca` son de oficina → el chofer queda fuera. Dónde
--     va cada unidad de la flota no es asunto suyo, y devolverle "la suya"
--     por aquí abriría la puerta a leer la de los demás.
--   · `rastreo_credencial` es MÁS estricta que todo lo demás del esquema:
--     solo flota_admin y superadmin. Un token de rastreo permite ver y a veces
--     MANDAR órdenes a la flota entera, así que no cabe en `ve_finanzas()` —
--     no es dinero, es control. El CONTADOR sí ve dinero y aun así no debe
--     ver esto, y esa distinción es justo la que un `ve_finanzas()` de más
--     borraría sin que nadie lo note.
--
-- Esperado: chofer 0/0, contador 0 credenciales.
do $$
declare
  v_t uuid; v_o uuid; v_un uuid;
  v_chofer uuid := gen_random_uuid(); v_conta uuid := gen_random_uuid();
  n_pos int; n_geo int; n_cred int;
begin
  insert into tenant (nombre) values ('ZZZ VERIF RASTREO RLS') returning id into v_t;
  insert into operador (tenant_id, nombre, telefono) values (v_t, 'Chofer GPS', '520000009060') returning id into v_o;
  insert into unidad (tenant_id, numero_economico) values (v_t, 'GPS-01') returning id into v_un;
  insert into posicion (tenant_id, unidad_id, lat, lng, medida_en, proveedor)
    values (v_t, v_un, 20.9674, -89.5926, now(), 'wialon');
  insert into geocerca (tenant_id, nombre, lat, lng, radio_m)
    values (v_t, 'Patio Mérida', 20.9674, -89.5926, 250);
  insert into rastreo_credencial (tenant_id, proveedor, token_ultimos4)
    values (v_t, 'wialon', '4417');

  insert into app_user (id, tenant_id, email, rol, operador_id)
    values (v_chofer, v_t, 'zzz-verif-gps-chofer@likida.test', 'operador', v_o);
  insert into app_user (id, tenant_id, email, rol)
    values (v_conta, v_t, 'zzz-verif-gps-conta@likida.test', 'contador');

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_chofer)::text, true);
  select count(*) into n_pos from posicion where tenant_id = v_t;
  select count(*) into n_geo from geocerca where tenant_id = v_t;

  perform set_config('request.jwt.claims', json_build_object('sub', v_conta)::text, true);
  select count(*) into n_cred from rastreo_credencial where tenant_id = v_t;

  reset role;

  raise exception E'RASTREO_RLS  chofer-posiciones=%  chofer-geocercas=%  contador-credenciales=%   (esperado 0 / 0 / 0 — la tercera es la que separa "ve dinero" de "manda en la flota")',
    n_pos, n_geo, n_cred;
end $$;

-- ── 31. Ni la suscripción ni la invitación se duplican (mig. 0052 + 0053) ────
-- Dos unicidades parciales que solo la base puede garantizar, y las dos
-- cuestan dinero o permisos si fallan:
--
--   · dos suscripciones VIVAS para la misma flota cobran dos veces, y ninguna
--     de las dos parece equivocada mirándola sola.
--   · dos invitaciones VIVAS para el mismo correo dan dos roles distintos
--     según cuál se abra primero — un `encargado` y un `flota_admin` en la
--     misma bandeja.
--
-- Son índices PARCIALES a propósito: una suscripción cancelada y una
-- invitación revocada SÍ pueden convivir con la nueva, porque son historia.
-- Esta prueba comprueba las dos mitades: que el duplicado vivo truena y que
-- el histórico no.
do $$
declare
  v_t uuid; v_dup boolean := false; v_hist boolean := true;
begin
  insert into tenant (nombre) values ('ZZZ VERIF UNICIDAD') returning id into v_t;

  insert into suscripcion (tenant_id, plan_clave, estado) values (v_t, 'demo', 'activa');
  begin
    insert into suscripcion (tenant_id, plan_clave, estado) values (v_t, 'flota', 'activa');
    v_dup := true;   -- si llega aquí, el índice NO protege
  exception when unique_violation then
    v_dup := false;
  end;

  -- Una cancelada convive: es historia, no cobro.
  begin
    insert into suscripcion (tenant_id, plan_clave, estado, cancelada_en)
      values (v_t, 'empresa', 'cancelada', now());
  exception when unique_violation then
    v_hist := false;
  end;

  insert into invitacion (tenant_id, email, rol, token_hash, expira_en)
    values (v_t, 'Alguien@Flota.mx', 'encargado', 'hash-uno', now() + interval '7 days');
  begin
    -- MAYÚSCULAS distintas: el índice es sobre lower(email), así que esto es
    -- el MISMO correo. Sin el lower(), "Alguien@" y "alguien@" serían dos.
    insert into invitacion (tenant_id, email, rol, token_hash, expira_en)
      values (v_t, 'ALGUIEN@flota.mx', 'flota_admin', 'hash-dos', now() + interval '7 days');
    raise exception 'UNICIDAD  suscripcion-duplicada=%  historico-convive=%  invitacion-duplicada=SI   (la invitacion duplicada NO deberia entrar)', v_dup, v_hist;
  exception when unique_violation then
    raise exception E'UNICIDAD  suscripcion-duplicada=%  historico-convive=%  invitacion-duplicada=NO   (esperado false / true / NO)', v_dup, v_hist;
  end;
end $$;

-- ── 32. La bitácora no se corrige ni se borra (mig. 0053) ────────────────────
-- Un registro de auditoría que su propio dueño puede editar no sirve como
-- evidencia ante nadie: ni ante el INAI, ni ante un cliente que pregunta quién
-- tocó su dato. La 0053 le da a `bitacora_auditoria` policies de SELECT e
-- INSERT y NINGUNA de UPDATE ni de DELETE — sin policy, RLS los niega, que es
-- append-only sin necesidad de un trigger.
--
-- Es fácil de romper sin querer: basta que alguien añada un `for all` "para
-- que se pueda limpiar" y la tabla deja de ser prueba de nada, en silencio.
-- Esperado: 0 filas modificadas y 0 borradas por un flota_admin.
do $$
declare
  v_t uuid; v_admin uuid := gen_random_uuid();
  n_lee int; n_upd int; n_del int;
begin
  insert into tenant (nombre) values ('ZZZ VERIF BITACORA') returning id into v_t;
  insert into app_user (id, tenant_id, email, rol)
    values (v_admin, v_t, 'zzz-verif-bitacora@likida.test', 'flota_admin');
  insert into bitacora_auditoria (tenant_id, actor_id, accion, entidad)
    values (v_t, v_admin, 'liquidacion.emitida', 'liquidacion');

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);

  select count(*) into n_lee from bitacora_auditoria where tenant_id = v_t;

  with u as (update bitacora_auditoria set accion = 'BORRADO POR EL AUDITADO'
              where tenant_id = v_t returning 1)
  select count(*) into n_upd from u;

  with d as (delete from bitacora_auditoria where tenant_id = v_t returning 1)
  select count(*) into n_del from d;

  reset role;

  raise exception E'BITACORA  lee=%  modifica=%  borra=%   (esperado 1 / 0 / 0 — si modifica o borra pasan de 0, la bitacora ya no prueba nada)',
    n_lee, n_upd, n_del;
end $$;

-- ── 33. La vista de saldos respeta el RLS de quien pregunta (mig. 0054) ──────
-- LA FUGA ENTRE INQUILINOS MÁS CARA QUE PUEDE TENER ESTE PRODUCTO, y estuvo
-- abierta entre la 0049 y la 0054.
--
-- Una vista en Postgres corre por default con los permisos de QUIEN LA CREÓ.
-- Como `factura_saldo` la creó el rol de servicio, devolvía las facturas de
-- TODAS las flotas a cualquier usuario autenticado que le pegara por PostgREST
-- —aunque `factura_emitida` tuviera su RLS perfectamente puesto—. La política
-- de la tabla NO se hereda a la vista.
--
-- No lo habría encontrado ninguna prueba de TypeScript: el código estaba bien,
-- el que estaba mal era el objeto de la base. Por eso vive aquí.
--
-- Corrido antes del arreglo:  via-tabla=1  via-vista=2   ← la 2ª era de otra flota
-- Corrido después:            via-tabla=1  via-vista=1
--
-- Se comprueba de paso que `anon` ya no puede ejecutar `ve_finanzas()`: el
-- `revoke ... from anon` de la 0048 no revocaba nada, porque el permiso venía
-- de PUBLIC y anon solo lo heredaba.
do $$
declare
  tA uuid; tB uuid; cA uuid; cB uuid; uA uuid := gen_random_uuid();
  n_tabla int; n_vista int; anon_puede boolean;
begin
  insert into tenant (nombre) values ('ZZZ VERIF VISTA A') returning id into tA;
  insert into tenant (nombre) values ('ZZZ VERIF VISTA B') returning id into tB;
  insert into cliente (tenant_id, nombre) values (tA, 'Cliente A') returning id into cA;
  insert into cliente (tenant_id, nombre) values (tB, 'Cliente B') returning id into cB;
  insert into factura_emitida (tenant_id, cliente_id, subtotal, iva, total, estatus)
    values (tA, cA, 1000, 160, 1160, 'emitida');
  insert into factura_emitida (tenant_id, cliente_id, subtotal, iva, total, estatus)
    values (tB, cB, 9999, 1599.84, 11598.84, 'emitida');
  insert into app_user (id, tenant_id, email, rol)
    values (uA, tA, 'zzz-verif-vista@likida.test', 'flota_admin');

  anon_puede := has_function_privilege('anon', 'public.ve_finanzas()', 'EXECUTE');

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', uA)::text, true);
  select count(*) into n_tabla from factura_emitida;
  select count(*) into n_vista from factura_saldo;
  reset role;

  raise exception E'VISTA_SALDO  via-tabla=%  via-vista=%  anon-ejecuta-ve_finanzas=%   (esperado 1 / 1 / false — un 2 en la vista es la factura de OTRA flota)',
    n_tabla, n_vista, anon_puede;
end $$;

-- ── 34. El payload de Stripe no se le enseña a un usuario del panel (mig. 0055) ──
--
-- 0055 — el payload de Stripe no se le enseña a un usuario del panel.
--
-- `evento_stripe` guarda el evento crudo: ids de cliente, montos, correo de
-- facturación de OTRAS flotas. Es de Likida, no del cliente. La tabla tiene RLS
-- activo y UNA sola policy (superadmin), así que un flota_admin autenticado
-- tiene que ver CERO filas — no por no tener el link, sino porque la base se lo
-- niega aunque pegue directo a PostgREST.
--
-- Se comprueba de paso que el índice único del price existe: dos planes con el
-- mismo price de Stripe cobrarían lo mismo diciendo cosas distintas.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  tA uuid; uA uuid := gen_random_uuid();
  n_eventos int; hay_indice boolean;
begin
  insert into tenant (nombre) values ('ZZZ VERIF STRIPE') returning id into tA;
  insert into app_user (id, tenant_id, email, rol)
    values (uA, tA, 'zzz-verif-stripe@likida.test', 'flota_admin');
  insert into evento_stripe (id, tipo, payload)
    values ('evt_zzz_verif', 'invoice.paid', '{"secreto":"de otra flota"}'::jsonb);

  select exists(
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'plan_stripe_price_unico'
  ) into hay_indice;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', uA)::text, true);
  select count(*) into n_eventos from evento_stripe;
  reset role;

  raise exception E'EVENTO_STRIPE  filas-que-ve-flota_admin=%  indice-price-unico=%   (esperado 0 / true)',
    n_eventos, hay_indice;
end $$;

-- ── 35. Los datos fiscales del CFDI son catálogo del SAT, no texto libre (mig. 0056) ──
--
-- El CFDI 4.0 exige del receptor RFC, razón social, régimen, código postal y
-- uso. Los dos últimos son CLAVES de catálogo del SAT: una clave inventada la
-- rechaza el PAC al timbrar —cuando ya cobraste— o peor, la acepta y emite un
-- comprobante que el contador del cliente no puede usar.
--
-- Se comprueba que los CHECK rechacen de verdad, y que `factura_saas` no pueda
-- quedar "timbrada" a medias: un UUID sin fecha, o al revés, haría ver como
-- facturado un cobro que no lo está.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  t uuid; regimen_malo boolean := false; cp_malo boolean := false; timbre_malo boolean := false;
begin
  insert into tenant (nombre) values ('ZZZ VERIF FISCAL') returning id into t;

  begin
    update tenant set regimen_fiscal = '999' where id = t;
  exception when check_violation then regimen_malo := true;
  end;

  begin
    update tenant set codigo_postal_fiscal = 'CP970' where id = t;
  exception when check_violation then cp_malo := true;
  end;

  begin
    insert into factura_saas (tenant_id, periodo_inicio, periodo_fin, monto, estado, cfdi_uuid)
      values (t, current_date, current_date, 100, 'pagada', 'uuid-sin-fecha');
  exception when check_violation then timbre_malo := true;
  end;

  raise exception E'DATOS_FISCALES  regimen-invalido-rechazado=%  cp-invalido-rechazado=%  timbre-incoherente-rechazado=%   (esperado true / true / true)',
    regimen_malo, cp_malo, timbre_malo;
end $$;

-- ── 36. No se cobra dos veces el mismo mes, ni se marca pagada sin firma (mig. 0057) ──
--
-- Cobrar por transferencia no tiene webhook: alguien marca la factura a mano. Y
-- eso abre dos formas de perder dinero o credibilidad que solo la base puede
-- cerrar:
--
--   1. Apretar "emitir" dos veces le cobra el mismo mes DOS VECES a la misma
--      flota, y las dos facturas se ven legítimas. Lo impide el índice único
--      (tenant_id, periodo_inicio, periodo_fin).
--   2. Una factura "pagada" sin saber QUIÉN la marcó es la palabra de alguien
--      sin nada detrás. Lo impide el check de conciliación coherente.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  t uuid; dup boolean := false; sin_firma boolean := false;
begin
  insert into tenant (nombre) values ('ZZZ VERIF COBRO') returning id into t;

  insert into factura_saas (tenant_id, periodo_inicio, periodo_fin, monto, estado, metodo_cobro, referencia)
    values (t, '2026-08-01', '2026-08-31', 2400, 'pendiente', 'transferencia', 'LKZZZ202608');

  begin
    insert into factura_saas (tenant_id, periodo_inicio, periodo_fin, monto, estado, metodo_cobro, referencia)
      values (t, '2026-08-01', '2026-08-31', 2400, 'pendiente', 'transferencia', 'LKZZZ202608B');
  exception when unique_violation then dup := true;
  end;

  begin
    update factura_saas set conciliada_en = now() where tenant_id = t;   -- sin conciliada_por
  exception when check_violation then sin_firma := true;
  end;

  raise exception E'COBRO_TRANSFERENCIA  segundo-cobro-del-mes-rechazado=%  pagada-sin-firma-rechazada=%   (esperado true / true)',
    dup, sin_firma;
end $$;

-- ── 37. Un viaje no se puede aceptar sin haberse avisado (mig. 0058) ──
--
-- `avisado_en` no es un dato informativo: es lo ÚNICO que hace visible un viaje
-- para la escalación de las 5 h (`viajesSinAceptar` filtra por "avisado_en no es
-- null"). Un viaje con `aceptado_en` puesto y `avisado_en` vacío significa que
-- alguien marcó la aceptación a mano, y a partir de ahí el reloj no tiene origen:
-- ni escala ni se puede auditar cuánto tardó el chofer en contestar.
--
-- Se comprueba también que el índice parcial exista. Sin él la escalación hace
-- un recorrido completo de `viaje` en cada corrida del cron — invisible con
-- ocho viajes de prueba, caro con el histórico de una flota de 700 unidades.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  t uuid; o uuid; v uuid; rechazado boolean := false; hay_indice boolean;
begin
  insert into tenant (nombre) values ('ZZZ VERIF AVISO') returning id into t;
  -- `viaje.operador_id` es NOT NULL: un viaje sin chofer no existe en este
  -- modelo. Se descubrió corriendo este mismo bloque, que fue para lo que se
  -- escribió.
  insert into operador (tenant_id, nombre, telefono)
    values (t, 'ZZZ Verif', '5215559999999') returning id into o;
  insert into viaje (tenant_id, operador_id, estatus) values (t, o, 'abierto') returning id into v;

  begin
    update viaje set aceptado_en = now() where id = v;   -- sin avisado_en
  exception when check_violation then rechazado := true;
  end;

  select exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'viaje' and indexname = 'viaje_sin_aceptar_idx'
  ) into hay_indice;

  delete from tenant where id = t;

  raise exception E'CONFIRMACION_VIAJE  aceptar-sin-aviso-rechazado=%  indice-parcial=%   (esperado true / true)',
    rechazado, hay_indice;
end $$;

-- ── 38. El teléfono de una cuenta es único GLOBAL, no por flota (mig. 0059) ──
--
-- Es la llave con la que se enruta un mensaje entrante: WhatsApp trae solo el
-- número, y es ese número el que determina de qué flota se está hablando. Si dos
-- tenants pudieran registrar el mismo teléfono, el agente tendría que adivinar —
-- y adivinar aquí escribe la operación de una flota en la de otra, en silencio.
--
-- Ojo con la asimetría deliberada frente a `operador`, que sí es único POR flota:
-- ahí el desempate existe (`resolveOperador` se niega ante dos filas y lanza
-- OperadorAmbiguo). Para las cuentas de oficina se prefirió que la base lo haga
-- imposible en vez de detectarlo tarde.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  t1 uuid; t2 uuid; u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid();
  rechazado boolean := false; dos_nulos boolean := true;
begin
  insert into tenant (nombre) values ('ZZZ VERIF TEL A') returning id into t1;
  insert into tenant (nombre) values ('ZZZ VERIF TEL B') returning id into t2;

  insert into app_user (id, tenant_id, email, rol, telefono)
    values (u1, t1, 'zzz-verif-a@likida.test', 'flota_admin', '5215550000001');

  begin
    -- mismo número, OTRA flota: tiene que reventar
    insert into app_user (id, tenant_id, email, rol, telefono)
      values (u2, t2, 'zzz-verif-b@likida.test', 'flota_admin', '5215550000001');
  exception when unique_violation then rechazado := true;
  end;

  -- ...pero el índice es PARCIAL: dos cuentas sin teléfono conviven sin problema,
  -- que es el caso normal (se entra por correo, el teléfono es opcional).
  begin
    insert into app_user (id, tenant_id, email, rol) values (gen_random_uuid(), t1, 'zzz-verif-c@likida.test', 'contador');
    insert into app_user (id, tenant_id, email, rol) values (gen_random_uuid(), t2, 'zzz-verif-d@likida.test', 'contador');
  exception when unique_violation then dos_nulos := false;
  end;

  delete from tenant where id in (t1, t2);

  raise exception E'TELEFONO_CUENTA  duplicado-entre-flotas-rechazado=%  dos-sin-telefono-permitido=%   (esperado true / true)',
    rechazado, dos_nulos;
end $$;

-- ── 39. La cola de facturación NO recorre la tabla entera (mig. 0060) ──
--
-- El cron de facturación busca `cfdi_uuid is null`. El único índice que tocaba
-- esa columna era PARCIAL sobre lo contrario (`where cfdi_uuid is not null`),
-- así que Postgres no lo podía usar para los nulos: cada corrida recorría la
-- tabla completa y la ordenaba por fecha para quedarse con ocho filas.
--
-- ESTE BLOQUE NO COMPRUEBA QUE EL ÍNDICE EXISTA — comprueba que el PLANEADOR LO
-- ELIJA, que es lo único que importa. Un índice que está y no se usa se ve igual
-- de bien en `pg_indexes` y cuesta lo mismo de mantener.
--
-- Por eso se cargan 3,000 filas y se hace ANALYZE antes del EXPLAIN: sobre una
-- tabla vacía el planeador siempre prefiere el recorrido completo —es más
-- barato de verdad— y la verificación pasaría en verde sin probar nada. Es el
-- mismo modo de falla que el falso verde del `curl` que miraba el código HTTP y
-- no el cuerpo. Todo se revierte con el `raise`.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  t uuid; o uuid; v uuid; r record; plan text := ''; usa_indice boolean;
begin
  insert into tenant (nombre) values ('ZZZ VERIF INDICE') returning id into t;
  insert into operador (tenant_id, nombre, telefono)
    values (t, 'ZZZ Indice', '5215558888888') returning id into o;
  insert into viaje (tenant_id, operador_id, estatus) values (t, o, 'abierto') returning id into v;

  -- 3,000 pendientes y 3,000 ya facturados: la mezcla importa, porque el indice
  -- es parcial y su ventaja esta justo en no cargar con los facturados.
  insert into gasto (tenant_id, viaje_id, concepto, monto, created_at, cfdi_uuid, ocr_extra)
  select t, v, 'diesel', 100,
         now() - (g || ' minutes')::interval,
         case when g % 2 = 0 then null else gen_random_uuid()::text end,
         '{}'::jsonb
  from generate_series(1, 6000) g;

  analyze gasto;

  -- EXPLAIN devuelve VARIAS filas: hay que recorrerlas. Un `execute ... into`
  -- se queda con la primera, que suele ser el `Limit` y no dice que scan hubo.
  for r in execute 'explain select id, tenant_id from gasto
                    where cfdi_uuid is null and ocr_extra is not null
                    order by created_at asc limit 9'
  loop
    plan := plan || r."QUERY PLAN" || ' | ';
  end loop;

  usa_indice := plan ilike '%gasto_por_facturar_idx%';

  delete from tenant where id = t;

  raise exception E'INDICE_FACTURACION  el-planeador-usa-el-indice=%   plan=%   (esperado true)',
    usa_indice, plan;
end $$;

-- ── 40. Los índices de paginación se USAN, no solo existen (mig. 0061) ──
--
-- `traerTodo()` (src/lib/cuadra/pg.ts) pagina SIEMPRE con `.order('id')`, en 50
-- llamadas del repo. No existía un solo índice `(tenant_id, id)`: los que había
-- sirven para filtrar por tenant, no para entregar ordenado por id dentro de él
-- (`gasto_id_tenant_key` es `(id, tenant_id)`, con las columnas al revés). El
-- planeador filtraba y luego ORDENABA todas las filas del tenant para devolver
-- una página de mil — repetido en cada una de las 100 páginas.
--
-- Igual que el bloque 39, ESTE BLOQUE NO COMPRUEBA QUE LOS ÍNDICES EXISTAN.
-- Comprueba que el planeador los ELIJA. Un índice que está y no se usa se ve
-- idéntico en `pg_indexes` y cuesta lo mismo de mantener en cada insert.
--
-- Se piden DOS condiciones por caso, no una: que el plan nombre el índice Y que
-- no quede ningún `Sort Key`. Solo la primera no basta — el planeador puede
-- tomar el índice únicamente para filtrar y dejar el sort en pie, que es
-- exactamente el defecto que la 0061 vino a quitar.
--
-- DOS TRAMPAS QUE ESTE BLOQUE ESQUIVA A PROPÓSITO:
--
--  1. Volumen. Sobre tabla vacía el recorrido completo es de verdad más barato
--     y el planeador lo prefiere: la verificación pasaría en verde sin probar
--     nada. Por eso se cargan ~75 mil filas y se hace ANALYZE antes del EXPLAIN.
--
--  2. Tenant único. Si un solo tenant tiene el 100% de las filas, el filtro por
--     tenant_id no descarta nada y el planeador se conforma con recorrer la PK
--     filtrando — sin `Sort`, en verde, y sin usar el índice nuevo. Se midió:
--     con un tenant el plan sale limpio solo. Por eso se siembran DIEZ tenants
--     y se consulta el primero, que es la forma real de la base multi-tenant.
--
-- Falsificado: corriendo este mismo bloque con los 9 índices tirados dentro de
-- la transacción da 0/9. Con ellos, 9/9. Todo se revierte con el `raise`.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  t uuid; o uuid; v uuid; objetivo uuid; i int;
  r record; chk record;
  plan text; usados int := 0; total int := 0; fallos text := '';
begin
  for i in 1..10 loop
    insert into tenant (nombre) values ('ZZZ VERIF PAG '||i) returning id into t;
    if i = 1 then objetivo := t; end if;
    insert into operador (tenant_id, nombre, telefono)
      values (t, 'ZZZ Pag '||i, '52155577700'||lpad(i::text,2,'0')) returning id into o;

    insert into viaje (tenant_id, operador_id, estatus, created_at)
      select t, o, 'liquidado', now() - (g||' minutes')::interval from generate_series(1,800) g;

    -- Un viaje se queda SIN liquidación a propósito: es el que hospeda los
    -- gastos, porque `trg_gasto_no_tras_liquidar` (mig. 0036) rechaza cualquier
    -- gasto sobre un viaje ya liquidado.
    select id into v from viaje where tenant_id = t limit 1;
    insert into liquidacion (tenant_id, viaje_id)
      select tenant_id, id from viaje where tenant_id = t and id <> v;
    insert into pod (tenant_id, viaje_id, estado)
      select tenant_id, id, 'pendiente' from viaje where tenant_id = t and id <> v;

    insert into gasto (tenant_id, viaje_id, concepto, monto, created_at, ocr_extra)
      select t, v, 'diesel', 100, now() - (g||' minutes')::interval, '{}'::jsonb
      from generate_series(1,2000) g;
    insert into llm_costo (tenant_id, fase, modelo, tokens_in, tokens_out, costo_usd)
      select t, 'ocr', 'haiku', 100, 50, 0.001 from generate_series(1,2500) g;
    insert into comprobante_huerfano (tenant_id, operador_id, gasto, motivo)
      select t, o, '{}'::jsonb, 'sin_viaje' from generate_series(1,300) g;
    insert into incidencia (tenant_id, tipo, prioridad, estado)
      select t, 'retraso', 'media', 'abierta' from generate_series(1,300) g;
  end loop;

  analyze gasto; analyze viaje; analyze liquidacion; analyze llm_costo;
  analyze pod; analyze incidencia; analyze comprobante_huerfano;

  for chk in
    select * from (values
      ('gasto/id',       'gasto_paginacion_idx',
       format('select id from gasto where tenant_id=%L order by id limit 1000 offset 1000', objetivo)),
      ('viaje/id',       'viaje_paginacion_idx',
       format('select id from viaje where tenant_id=%L order by id limit 1000 offset 500', objetivo)),
      ('liquidacion/id', 'liquidacion_paginacion_idx',
       format('select id from liquidacion where tenant_id=%L order by id limit 1000 offset 500', objetivo)),
      ('llm_costo/id',   'llm_costo_paginacion_idx',
       format('select fase from llm_costo where tenant_id=%L order by id limit 1000 offset 1000', objetivo)),
      ('huerfano/id',    'comprobante_huerfano_paginacion_idx',
       format('select resuelto_en from comprobante_huerfano where tenant_id=%L order by id limit 1000 offset 0', objetivo)),
      ('pod/id',         'pod_paginacion_idx',
       format('select estado from pod where tenant_id=%L order by id limit 1000 offset 500', objetivo)),
      ('incidencia/id',  'incidencia_paginacion_idx',
       format('select estado from incidencia where tenant_id=%L order by id limit 1000 offset 0', objetivo)),
      -- Las dos bandejas que NO paginan: ordenan por fecha para enseñar 100.
      ('gasto/created',  'gasto_reciente_idx',
       format('select id, concepto, monto from gasto where tenant_id=%L order by created_at desc limit 100', objetivo)),
      ('viaje/created',  'viaje_reciente_idx',
       format('select id, folio, estatus from viaje where tenant_id=%L order by created_at desc limit 100', objetivo))
    ) as v(caso, indice, consulta)
  loop
    total := total + 1;
    plan := '';
    -- EXPLAIN devuelve VARIAS filas: hay que recorrerlas. Un `execute ... into`
    -- se queda con la primera, que suele ser el `Limit` y no dice qué scan hubo.
    for r in execute 'explain ' || chk.consulta loop
      plan := plan || r."QUERY PLAN" || ' | ';
    end loop;

    -- `position()` y no `like`: el nombre del índice lleva guiones bajos, que en
    -- LIKE son comodín de un carácter y harían pasar un índice parecido.
    if position(chk.indice in plan) > 0 and position('Sort Key' in plan) = 0 then
      usados := usados + 1;
    else
      fallos := fallos || E'\n  · ' || chk.caso || ' NO usa ' || chk.indice || ' -> ' || plan;
    end if;
  end loop;

  delete from tenant where nombre like 'ZZZ VERIF PAG %';

  raise exception E'INDICES_PAGINACION  el-planeador-los-usa=%/%   %   (esperado 9/9)',
    usados, total, coalesce(nullif(fallos, ''), '- todos');
end $$;

-- ── 41. El resumen de costo de IA suma lo MISMO que sumaba JavaScript (mig. 0062) ──
--
-- La 0062 movió a SQL la agregación de `llm_costo` que `getResumenNegocio` hacía
-- trayendo la tabla entera a memoria. Mover una suma de dinero de un lenguaje a
-- otro es exactamente el cambio que puede salir mal SIN QUE NADA FALLE: la
-- consola sigue pintando una cifra, solo que otra. Y es la cifra con la que se
-- pone el precio del producto.
--
-- ESTE BLOQUE NO COMPRUEBA QUE LA FUNCIÓN EXISTA. Comprueba que sus seis partes
-- cuadran, y por TRES caminos independientes:
--
--   1. la función (un `Seq Scan` + `MixedAggregate` con `grouping sets`),
--   2. seis `group by` sueltos —otro plan, otro algoritmo— con el mismo filtro,
--   3. la identidad aritmética `Σ(1..N)·0.000001 = N(N+1)/2 · 0.000001`, que no
--      depende de Postgres ni de JavaScript y por eso es la única capaz de
--      atrapar un error que los DOS caminos de SQL cometieran igual.
--
-- Se siembran 124,000 filas A PROPÓSITO: 120,000 pasan el techo de `traerTodo`
-- (100,000 filas, `src/lib/cuadra/pg.ts`), o sea que este bloque agrega en SQL
-- justo la lectura que el camino viejo ya no puede completar. Con mil filas la
-- verificación pasaría en verde sin tocar el motivo de la migración.
--
-- Los valores son conocidos, no aleatorios: `costo_usd = g × 0.000001` para
-- g = 1..120,000. Así el total tiene forma cerrada (7,200.060000) y un error de
-- una millonésima se ve.
--
-- DE REGALO, LA MEDIDA DE LO QUE SE GANÓ: se reporta `deriva-float`, la
-- diferencia entre sumar esas mismas filas en `float8` —lo que hacía el
-- JavaScript, `costoIaUsd += Number(f.costo_usd)`— y el total exacto. No es una
-- aserción (el tamaño del error depende del orden en que el planeador sume), es
-- la evidencia de por qué la suma se quedó en `numeric` de punta a punta.
--
-- LA TRAMPA DE `viaje.operador_id` NO APLICA AQUÍ: la única FK NOT NULL de
-- `llm_costo` es `tenant_id` (mig. 0003); `viaje_id` y `liquidacion_id` son
-- nullables. Con crear los dos tenants basta — no hace falta operador ni viaje.
--
-- Los permisos se leen del CATÁLOGO y no atacando la API, por lo mismo que el
-- bloque 16: un `do $$` corre como el dueño y probar con un INSERT probaría el
-- privilegio de quien corre la prueba, no la garantía.
--
-- Todo se revierte con el `raise`. Deja ~124 mil tuplas muertas que autovacuum
-- recoge; es el mismo precio que ya paga el bloque 40.
--
-- ── CORRIDO EL 5-AGO-2026 CONTRA EL PROYECTO LIKIDA. SALIDA REAL: ───────────
--
--   41  total-cerrado=t  tokens=t  fase=t  modelo=t  fase+modelo=t  dia=t
--       tenant=t  sin-ventana=t  ventana-vacia=t  borde-semiabierto=t
--       hay-filas-en-el-borde=28000
--       es-definer=f  anon=f  authenticated=f  service_role=t
--       esperado-cerrado=7202.0600000000000000   deriva-float8=0.0000000004100000
--
-- `deriva-float8` es la evidencia, no una aserción: sumar esas 124,000 filas en
-- punto flotante se aleja 4.1 × 10⁻¹⁰ del total exacto. Con 790 mil filas al año
-- ese error crece y siempre en la misma dirección; por eso la suma se quedó en
-- `numeric` hasta el final.
--
-- ── FALSIFICADO, que es lo que separa esto de un verde de adorno ────────────
-- Se corrió el mismo bloque con la función ROTA a propósito, dentro de la misma
-- transacción que lo revierte todo (`create or replace function` es
-- transaccional, así que la rotura se deshace con el `raise`):
--
--   · función que suma solo un SUBCONJUNTO de la tabla (el recorte silencioso)
--       → total-cerrado=f   devolvió 1542.882858 donde esperaba 1800.030000
--   · `porFase` sin el guardia `g_modelo = 1`, así que las filas del corte
--     (fase, modelo) se cuelan y cada fase se cuenta dos veces
--       → fase=f   `porFase` con 6 entradas donde debía haber 2
--   · corte de fecha CERRADO (`<=` en vez de `<`)
--       → borde-semiabierto=f   devolvió n=12000 donde esperaba n=8000
--
-- Y una rotura que este bloque NO atrapa, dicha en voz alta para que nadie la
-- crea cubierta: sumar en `float8` con 60,000 filas devuelve exactamente
-- 1800.03 —el `::numeric` redondea la deriva— y el bloque pasa en verde. La
-- suma en punto flotante no falla en pequeño: falla en grande, que es donde
-- este bloque siembra 124,000 filas y donde `deriva-float8` deja de ser cero.
--
-- ── Y COMPROBADO CONTRA EL CAMINO VIEJO, CON DATOS REALES ──────────────────
-- Aparte del bloque, se trajeron las 131 filas reales de `llm_costo` y se
-- sumaron en JavaScript con el código EXACTO que la 0062 sustituye (`costoIaUsd
-- += Number(f.costo_usd)`, los cuatro `Map`, el mismo `round2`). Las nueve
-- partes salieron idénticas —total, tokens, porFase, porModelo, porFaseModelo,
-- porDia y porTenant— con el mismo total, 1.832202000000. Es la prueba que un
-- bloque de SQL no puede darse solo: que el lenguaje al que se mudó la suma
-- devuelve lo mismo que el que la hacía.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  ta uuid; tb uuid;
  filas_a int := 120000;   -- > 100,000: el techo donde `traerTodo` ya lanza
  filas_b int := 4000;
  d0 timestamptz := timestamptz '2099-01-01 00:00:00+00';  -- lejos de los datos reales
  ventana_fin timestamptz;
  j jsonb; j_todo jsonb; j_vacia jsonb; j_borde jsonb;
  cerrado numeric; deriva numeric;
  ok_cerrado boolean; ok_fase boolean; ok_modelo boolean; ok_fasemodelo boolean;
  ok_dia boolean; ok_tenant boolean; ok_tokens boolean;
  ok_todo boolean; ok_vacia boolean; ok_borde boolean;
  hay_borde bigint;
  anon_ok boolean; auth_ok boolean; svc_ok boolean; definer boolean;
begin
  ventana_fin := d0 + interval '30 days';

  insert into tenant (nombre) values ('ZZZ VERIF AGG A') returning id into ta;
  insert into tenant (nombre) values ('ZZZ VERIF AGG B') returning id into tb;

  -- Valores CONOCIDOS: costo = g millonésimas, cinco días, dos fases, dos modelos.
  insert into llm_costo (tenant_id, fase, modelo, tokens_in, tokens_out, costo_usd, created_at)
  select ta,
         case when g % 2 = 0 then 'ocr' else 'cuadre' end,
         case when g % 3 = 0 then 'zzz-caro' else 'zzz-barato' end,
         g % 7, g % 11,
         (g * 0.000001)::numeric(10,6),
         d0 + ((g % 5) || ' days')::interval
  from generate_series(1, filas_a) g;

  -- Segunda flota, para que `porTenant` tenga contra qué separar.
  insert into llm_costo (tenant_id, fase, modelo, tokens_in, tokens_out, costo_usd, created_at)
  select tb, 'router', 'zzz-barato', 1, 1, 0.000500, d0 + interval '2 days'
  from generate_series(1, filas_b) g;

  analyze llm_costo;

  j := resumen_costo_ia(d0, ventana_fin);

  -- ── CAMINO 3: la aritmética, que no sabe de motores ───────────────────────
  cerrado := 0.000001::numeric * filas_a::numeric * (filas_a + 1)::numeric / 2
             + filas_b::numeric * 0.000500::numeric;
  ok_cerrado := (j -> 'totales' ->> 'costoUsd')::numeric = cerrado
                and (j -> 'totales' ->> 'n')::bigint = (filas_a + filas_b)::bigint;

  -- Lo que el JavaScript hacía: acumular en punto flotante. Se reporta, no se afirma.
  deriva := (select sum(costo_usd::float8) from llm_costo
              where created_at >= d0 and created_at < ventana_fin)::numeric - cerrado;

  ok_tokens := (j -> 'totales' ->> 'tokensIn')::bigint
                 = (select sum(tokens_in) from llm_costo where created_at >= d0 and created_at < ventana_fin)
             and (j -> 'totales' ->> 'tokensOut')::bigint
                 = (select sum(tokens_out) from llm_costo where created_at >= d0 and created_at < ventana_fin);

  -- ── CAMINO 2: seis `group by` sueltos, mismo filtro, otro plan ────────────
  ok_fase := (j -> 'porFase') = coalesce((
    select jsonb_agg(jsonb_build_object('fase', s.fase, 'n', s.cuantas, 'costoUsd', s.costo)
                     order by s.costo desc, s.fase)
      from (select fase, count(*) cuantas, sum(costo_usd) costo from llm_costo
             where created_at >= d0 and created_at < ventana_fin group by fase) s), '[]'::jsonb);

  ok_modelo := (j -> 'porModelo') = coalesce((
    select jsonb_agg(jsonb_build_object('modelo', s.modelo, 'n', s.cuantas, 'costoUsd', s.costo)
                     order by s.costo desc, s.modelo)
      from (select modelo, count(*) cuantas, sum(costo_usd) costo from llm_costo
             where created_at >= d0 and created_at < ventana_fin group by modelo) s), '[]'::jsonb);

  ok_fasemodelo := (j -> 'porFaseModelo') = coalesce((
    select jsonb_agg(jsonb_build_object('fase', s.fase, 'modelo', s.modelo, 'n', s.cuantas, 'costoUsd', s.costo)
                     order by s.costo desc, s.fase, s.modelo)
      from (select fase, modelo, count(*) cuantas, sum(costo_usd) costo from llm_costo
             where created_at >= d0 and created_at < ventana_fin group by fase, modelo) s), '[]'::jsonb);

  ok_dia := (j -> 'porDia') = coalesce((
    select jsonb_agg(jsonb_build_object('dia', to_char(s.d, 'YYYY-MM-DD'),
                                        'costoUsd', s.costo, 'tokens', s.t_in + s.t_out)
                     order by s.d)
      from (select (created_at at time zone 'UTC')::date d, sum(costo_usd) costo,
                   sum(tokens_in) t_in, sum(tokens_out) t_out
              from llm_costo where created_at >= d0 and created_at < ventana_fin
             group by 1) s), '[]'::jsonb);

  ok_tenant := (j -> 'porTenant') = coalesce((
    select jsonb_agg(jsonb_build_object('tenantId', s.tid, 'costoUsd', s.costo) order by s.costo desc)
      from (select tenant_id tid, sum(costo_usd) costo from llm_costo
             where created_at >= d0 and created_at < ventana_fin group by tenant_id) s), '[]'::jsonb);

  -- ── Sin ventana: tiene que cuadrar contra la tabla ENTERA, datos reales incluidos ──
  j_todo := resumen_costo_ia(null, null);
  ok_todo := (j_todo -> 'totales' ->> 'costoUsd')::numeric = (select sum(costo_usd) from llm_costo)
         and (j_todo -> 'totales' ->> 'n')::bigint = (select count(*) from llm_costo);

  -- ── Una ventana sin filas da CEROS MEDIDOS y arreglos vacíos, no null ──────
  -- Es el estado "Likida recién arrancando": el panel tiene que pintar $0, no
  -- reventar ni enseñar un hueco.
  j_vacia := resumen_costo_ia(d0 + interval '100 years', d0 + interval '101 years');
  ok_vacia := (j_vacia -> 'totales' ->> 'n')::bigint = 0
          and (j_vacia -> 'totales' ->> 'costoUsd')::numeric = 0
          and j_vacia -> 'porFase' = '[]'::jsonb
          and j_vacia -> 'porDia' = '[]'::jsonb
          and j_vacia -> 'porTenant' = '[]'::jsonb;

  -- ── El corte es SEMIABIERTO: la fila del borde no se cuenta dos veces ──────
  -- Sin filas exactamente en el borde esto pasaría por vacío, así que primero se
  -- comprueba que las hay (`hay-filas-en-el-borde`).
  hay_borde := (select count(*) from llm_costo where created_at = d0 + interval '2 days');
  j_borde := resumen_costo_ia(d0, d0 + interval '2 days');
  ok_borde := (j_borde -> 'totales' ->> 'n')::bigint =
              (select count(*) from llm_costo where created_at >= d0 and created_at < d0 + interval '2 days');

  -- ── Permisos, leídos del catálogo ─────────────────────────────────────────
  select p.prosecdef,
         has_function_privilege('anon', p.oid, 'execute'),
         has_function_privilege('authenticated', p.oid, 'execute'),
         has_function_privilege('service_role', p.oid, 'execute')
    into definer, anon_ok, auth_ok, svc_ok
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'resumen_costo_ia';

  delete from tenant where nombre like 'ZZZ VERIF AGG %';

  raise exception E'RESUMEN_COSTO_IA  total-cerrado=%  tokens=%  fase=%  modelo=%  fase+modelo=%  dia=%  tenant=%  sin-ventana=%  ventana-vacia=%  borde-semiabierto=%  hay-filas-en-el-borde=%\n                  es-definer=%  anon=%  authenticated=%  service_role=%\n                  esperado-cerrado=%   deriva-float8=%\n                  (esperado t×10 / borde>0 / f / f / f / t)',
    ok_cerrado, ok_tokens, ok_fase, ok_modelo, ok_fasemodelo, ok_dia, ok_tenant,
    ok_todo, ok_vacia, ok_borde, hay_borde,
    definer, anon_ok, auth_ok, svc_ok,
    cerrado, deriva;
end $$;

-- ── 42. Lo que faltaba para operar de verdad (mig. 0063) ──
--
-- Tres huecos de tres auditorías distintas. Ninguno se nota con 8 viajes de
-- prueba; los tres muerden el primer día con una flota real.
--
-- 1. LA COLA DE FACTURACIÓN SE BLOQUEABA A SÍ MISMA. El cron elegía los 8 más
--    viejos sin CFDI, y `facturarAlVuelo` no marcaba nada cuando la decisión
--    era "no procede". Esos 8 se re-elegían para siempre: a 660 comprobantes
--    diarios, la facturación automática dejaba de alcanzar comprobantes NUEVOS
--    en la primera hora. Se marca el INTENTO, no el resultado — un ticket que
--    no procede hoy puede proceder mañana, así que la marca ordena la cola en
--    vez de sacarlo de ella. Se comprueba que el planeador USE el índice nuevo.
--
-- 2. Retenciones: `gasto` solo guardaba impuestos trasladados, así que el 4%
--    de IVA del autotransporte no se podía mostrar sin inventarlo.
--
-- 3. `portal_credencial` guarda USUARIO y REFERENCIA al secreto, jamás el
--    secreto. El check no es criptografía, es un pasamanos contra el error
--    honesto: el día que alguien pegue la contraseña real en `secreto_ref`, la
--    base lo rechaza. Y la tabla queda con RLS y SIN políticas a propósito —
--    solo la toca el proceso de facturación con service-role; ni el contador
--    ni el dueño tienen por qué ver con qué usuario entra el robot.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  t uuid; o uuid; v uuid; r record; plan text := '';
  rechaza_secreto boolean := false; sin_politicas boolean; rls_on boolean; usa_indice boolean;
begin
  insert into tenant (nombre) values ('ZZZ VERIF 0063') returning id into t;
  insert into operador (tenant_id, nombre, telefono) values (t,'ZZZ','5215557777777') returning id into o;
  insert into viaje (tenant_id, operador_id, estatus) values (t,o,'abierto') returning id into v;

  begin
    insert into portal_credencial (tenant_id, comercio, usuario, secreto_ref)
      values (t, 'oxxo_gas', 'flota@x.mx', 'MiC0ntra$ena!');
  exception when check_violation then rechaza_secreto := true;
  end;
  insert into portal_credencial (tenant_id, comercio, usuario, secreto_ref)
    values (t, 'oxxo_gas', 'flota@x.mx', 'PORTAL_OXXOGAS_PASS');

  select relrowsecurity into rls_on from pg_class where oid='public.portal_credencial'::regclass;
  select count(*)=0 into sin_politicas from pg_policies where tablename='portal_credencial';

  insert into gasto (tenant_id, viaje_id, concepto, monto, created_at, cfdi_uuid, autofactura_intentada_en)
  select t, v, 'diesel', 100, now()-(g||' minutes')::interval,
         case when g%3=0 then gen_random_uuid()::text else null end,
         case when g%5=0 then now()-(g||' hours')::interval else null end
  from generate_series(1,9000) g;
  analyze gasto;

  for r in execute 'explain select id from gasto where cfdi_uuid is null
                    order by autofactura_intentada_en nulls first, created_at limit 8'
  loop plan := plan || r."QUERY PLAN" || ' | '; end loop;
  usa_indice := plan ilike '%gasto_por_facturar_idx%';

  delete from tenant where id = t;
  raise exception E'FALTA_PARA_OPERAR  rechaza-contrasena=%  rls=%  sin-politicas=%  cola-usa-indice=%   (esperado 4x true)',
    rechaza_secreto, rls_on, sin_politicas, usa_indice;
end $$;

-- ── 43. Las agregaciones del panel del CLIENTE cuadran y NO cruzan flotas (mig. 0064) ──
--
-- La 0064 movió a SQL dos lecturas que se traían la tabla entera de una flota.
-- Una de ellas —`getResumenCosto`— no esperaba a crecer: iba SIN paginar, así
-- que PostgREST la recortaba a `max_rows` (1,000) en silencio y el resultado
-- salía con `estado: 'medido'`. Una cifra incompleta con la etiqueta de medida.
--
-- Este bloque comprueba TRES cosas, y la primera es la que no tenía la 0062:
--
--  1. **AISLAMIENTO.** Estas funciones las llama `service_role`, que salta RLS.
--     El `where tenant_id = p_tenant` es lo ÚNICO que separa a una flota de
--     otra. Se siembran DOS flotas con números distintos y se exige que las
--     cifras de la primera no contengan ni un centavo ni una fase de la
--     segunda. Con una sola flota esta comprobación pasaría siempre sin probar
--     nada — es la misma trampa del tenant único que ya esquiva el bloque 40.
--
--  2. **QUE CUADRAN**, por tres caminos como el bloque 41: la función, unos
--     `group by` sueltos, y la identidad aritmética `Σ(1..N)·10⁻⁶`.
--
--  3. **QUE EL RECORTE ESTABA AHÍ.** Se reproduce el bug: se suma lo que
--     devolvía la consulta vieja (las primeras 1,000 filas) y se comprueba que
--     NO es el total. `recorte-daba-menos=t` es la prueba de que esto no era
--     una mejora de rendimiento sino un número equivocado en pantalla.
--
-- TRAMPAS DE SIEMBRA: `viaje.operador_id` es NOT NULL, así que para poner
-- gastos hace falta tenant → operador → viaje. El viaje se deja ABIERTO porque
-- `trg_gasto_no_tras_liquidar` (mig. 0036) rechaza gastos sobre uno liquidado.
-- `llm_costo.fase` tiene dominio (mig. 0025): solo ocr | cuadre | escalacion |
-- chat | router | whatsapp. `gasto.concepto` también.
--
-- Los permisos se leen del CATÁLOGO, por lo mismo que el bloque 16.
-- Todo se revierte con el `raise`.
--
-- ── CORRIDO EL 5-AGO-2026 CONTRA EL PROYECTO LIKIDA. SALIDA REAL: ───────────
--
--   RESUMEN_POR_TENANT
--     costo: cerrado=t  fase=t  viajes=t  tokens=t  AISLADO=t  sin-fase-ajena=t
--     docs:  procesados=t  porMes=t  AISLADO=t  solo-ocr=t
--     ventana-vacia=t  borde-semiabierto=t  hay-filas-en-el-borde=1250
--     EL-RECORTE-DABA-MENOS=t   (1000 filas: 0.500500  ·  total real: 12.5025)
--     permisos costo: definer=f anon=f auth=f svc=t
--     permisos docs:  definer=f anon=f auth=f svc=t
--
-- **0.500500 de 12.502500 — el 4%.** Ese es el tamaño del bug que había: con
-- 5,000 llamadas al modelo, el panel del cliente enseñaba el 4% de su costo de
-- IA, con `estado: 'medido'`. No hacía falta esperar a nada; solo pasar de mil.
--
-- ── FALSIFICADO ────────────────────────────────────────────────────────────
-- Se corrió el mismo bloque con las DOS funciones rotas a propósito, dentro de
-- la transacción que lo revierte todo (`create or replace function` es
-- transaccional, así que la rotura se deshace con el `raise`):
--
--   · se cae el `where tenant_id = p_tenant` de la función de costo
--       → AISLADO=f          devolvió $3.501000 (A+B) donde A sola vale $2.001000
--       → sin-fase-ajena=f   la fase 'router', que solo existe en la flota B,
--                            apareció en el desglose de la flota A
--   · `count(viaje_id)` en vez de `count(distinct viaje_id)`
--       → viajes=f           devolvió 1333 donde debía decir 2
--   · se cae el `ocr_confianza is not null` de la de documentos
--       → procesados=f       devolvió 900 donde debía decir 600
--       → solo-ocr=f         los 300 capturados a mano contados como trabajo del
--                            Agente OCR
--
-- Las dos primeras son la razón por la que este bloque siembra DOS flotas: con
-- una sola, quitar el filtro por tenant no cambia ni un número y la
-- verificación pasa en verde sobre una función que ya no aísla nada.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  ta uuid; tb uuid; oa uuid; ob uuid; v1 uuid; v2 uuid; v3 uuid; vb uuid;
  filas_a int := 5000;    -- > 1,000: pasa el recorte silencioso de PostgREST
  filas_b int := 4000;
  gastos_a int := 3000;
  j_a jsonb; j_b jsonb; d_a jsonb; d_b jsonb; j_vacia jsonb; j_borde jsonb;
  cerrado numeric; recortado numeric;
  ok_cerrado boolean; ok_fase boolean; ok_viajes boolean; ok_tokens boolean;
  ok_aislado boolean; ok_sin_fase_ajena boolean;
  ok_docs boolean; ok_mes boolean; ok_docs_aislado boolean; ok_solo_ocr boolean;
  ok_vacia boolean; ok_borde boolean; recorte_daba_menos boolean;
  hay_borde bigint;
  def_a boolean; def_d boolean;
  anon_a boolean; auth_a boolean; svc_a boolean;
  anon_d boolean; auth_d boolean; svc_d boolean;
  d0 timestamptz := timestamptz '2099-01-01 00:00:00+00';
begin
  -- ── FLOTA A: la que se mide ───────────────────────────────────────────────
  insert into tenant (nombre) values ('ZZZ VERIF T63 A') returning id into ta;
  insert into operador (tenant_id, nombre, telefono)
    values (ta, 'ZZZ T63 A', '5215559990001') returning id into oa;
  insert into viaje (tenant_id, operador_id, estatus) values (ta, oa, 'abierto') returning id into v1;
  insert into viaje (tenant_id, operador_id, estatus) values (ta, oa, 'liquidado') returning id into v2;
  insert into viaje (tenant_id, operador_id, estatus) values (ta, oa, 'liquidado') returning id into v3;

  -- costo = g millonésimas → total con forma cerrada. Dos fases. Y el viaje se
  -- reparte entre v1, v2 y NULL: `count(distinct viaje_id)` tiene que dar 2,
  -- porque una fila sin viaje no es una liquidación a la que atribuirle costo.
  insert into llm_costo (tenant_id, viaje_id, fase, modelo, tokens_in, tokens_out, costo_usd, created_at)
  select ta,
         case g % 3 when 0 then v1 when 1 then v2 else null end,
         case when g % 2 = 0 then 'ocr' else 'cuadre' end,
         'zzz-modelo', g % 7, g % 11,
         (g * 0.000001)::numeric(10,6),
         d0 + ((g % 4) || ' days')::interval
  from generate_series(1, filas_a) g;

  -- 2 de cada 3 comprobantes pasaron por OCR; el tercio restante entró a mano y
  -- NO se cuenta. Repartidos en tres meses.
  insert into gasto (tenant_id, viaje_id, concepto, monto, created_at, ocr_confianza, ocr_extra)
  select ta, v1, 'diesel', 100,
         d0 + ((g % 3) || ' months')::interval,
         case when g % 3 = 0 then null else 0.90 end,
         '{}'::jsonb
  from generate_series(1, gastos_a) g;

  -- ── FLOTA B: el ruido que NO puede aparecer en las cifras de A ────────────
  insert into tenant (nombre) values ('ZZZ VERIF T63 B') returning id into tb;
  insert into operador (tenant_id, nombre, telefono)
    values (tb, 'ZZZ T63 B', '5215559990002') returning id into ob;
  insert into viaje (tenant_id, operador_id, estatus) values (tb, ob, 'abierto') returning id into vb;
  insert into llm_costo (tenant_id, viaje_id, fase, modelo, tokens_in, tokens_out, costo_usd, created_at)
    select tb, vb, 'router', 'zzz-ajeno', 1, 1, 0.001000, d0
    from generate_series(1, filas_b) g;
  insert into gasto (tenant_id, viaje_id, concepto, monto, created_at, ocr_confianza, ocr_extra)
    select tb, vb, 'caseta', 50, d0, 0.99, '{}'::jsonb
    from generate_series(1, 1000) g;

  analyze llm_costo; analyze gasto;

  j_a := resumen_costo_ia_tenant(ta);
  j_b := resumen_costo_ia_tenant(tb);
  d_a := resumen_documentos_tenant(ta);
  d_b := resumen_documentos_tenant(tb);

  -- ── CAMINO 3: la aritmética ───────────────────────────────────────────────
  cerrado := 0.000001::numeric * filas_a::numeric * (filas_a + 1)::numeric / 2;
  ok_cerrado := (j_a -> 'totales' ->> 'costoUsd')::numeric = cerrado
                and (j_a -> 'totales' ->> 'n')::bigint = filas_a::bigint;

  -- ── 1. AISLAMIENTO: lo de A es SOLO de A ─────────────────────────────────
  -- Si el filtro por tenant faltara, esto traería A+B y ninguna de las dos
  -- igualdades se cumpliría.
  ok_aislado := (j_a -> 'totales' ->> 'costoUsd')::numeric
                  = (select sum(costo_usd) from llm_costo where tenant_id = ta)
            and (j_b -> 'totales' ->> 'costoUsd')::numeric
                  = (select sum(costo_usd) from llm_costo where tenant_id = tb)
            and (j_a -> 'totales' ->> 'costoUsd')::numeric
                 <> (select sum(costo_usd) from llm_costo where tenant_id in (ta, tb));
  -- Y la fase que solo existe en B no puede asomar en el desglose de A.
  ok_sin_fase_ajena := not exists (
    select 1 from jsonb_array_elements(j_a -> 'porFase') f where f ->> 'fase' = 'router');

  ok_docs_aislado := (d_a ->> 'procesados')::bigint
                       = (select count(*) from gasto where tenant_id = ta and ocr_confianza is not null)
                 and (d_b ->> 'procesados')::bigint
                       = (select count(*) from gasto where tenant_id = tb and ocr_confianza is not null);

  -- ── 2. CAMINO 2: `group by` sueltos, mismo filtro, otro plan ─────────────
  ok_fase := (j_a -> 'porFase') = coalesce((
    select jsonb_agg(jsonb_build_object('fase', s.fase, 'n', s.cuantas, 'costoUsd', s.costo)
                     order by s.costo desc, s.fase)
      from (select fase, count(*) cuantas, sum(costo_usd) costo from llm_costo
             where tenant_id = ta group by fase) s), '[]'::jsonb);

  ok_viajes := (j_a -> 'totales' ->> 'viajes')::bigint =
               (select count(distinct viaje_id) from llm_costo where tenant_id = ta);

  ok_tokens := (j_a -> 'totales' ->> 'tokensIn')::bigint
                 = (select sum(tokens_in) from llm_costo where tenant_id = ta)
             and (j_a -> 'totales' ->> 'tokensOut')::bigint
                 = (select sum(tokens_out) from llm_costo where tenant_id = ta);

  ok_docs := (d_a ->> 'procesados')::bigint = (gastos_a - gastos_a / 3)::bigint;

  ok_mes := (d_a -> 'porMes') = coalesce((
    select jsonb_agg(jsonb_build_object('mes', s.mes, 'n', s.cuantas) order by s.mes)
      from (select to_char(created_at at time zone 'UTC', 'YYYY-MM') mes, count(*) cuantas
              from gasto where tenant_id = ta and ocr_confianza is not null
             group by 1) s), '[]'::jsonb);

  -- Los comprobantes SIN `ocr_confianza` no se cuentan: son captura manual, no
  -- trabajo del Agente OCR. Si el filtro se cayera, `procesados` sería 3,000.
  ok_solo_ocr := (d_a ->> 'procesados')::bigint
                 < (select count(*) from gasto where tenant_id = ta);

  -- ── 3. EL RECORTE QUE HABÍA: las primeras 1,000 filas no son el total ─────
  recortado := (select sum(costo_usd) from (
                 select costo_usd from llm_costo where tenant_id = ta limit 1000) x);
  recorte_daba_menos := recortado < cerrado;

  -- ── Ventana vacía: ceros MEDIDOS, no null ────────────────────────────────
  j_vacia := resumen_costo_ia_tenant(ta, d0 + interval '100 years', d0 + interval '101 years');
  ok_vacia := (j_vacia -> 'totales' ->> 'n')::bigint = 0
          and (j_vacia -> 'totales' ->> 'costoUsd')::numeric = 0
          and (j_vacia -> 'totales' ->> 'viajes')::bigint = 0
          and j_vacia -> 'porFase' = '[]'::jsonb;

  -- ── El corte de fecha es SEMIABIERTO ─────────────────────────────────────
  hay_borde := (select count(*) from llm_costo where tenant_id = ta and created_at = d0 + interval '2 days');
  j_borde := resumen_costo_ia_tenant(ta, d0, d0 + interval '2 days');
  ok_borde := (j_borde -> 'totales' ->> 'n')::bigint =
              (select count(*) from llm_costo
                where tenant_id = ta and created_at >= d0 and created_at < d0 + interval '2 days');

  -- ── Permisos, del catálogo ───────────────────────────────────────────────
  select p.prosecdef, has_function_privilege('anon', p.oid, 'execute'),
         has_function_privilege('authenticated', p.oid, 'execute'),
         has_function_privilege('service_role', p.oid, 'execute')
    into def_a, anon_a, auth_a, svc_a
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'resumen_costo_ia_tenant';

  select p.prosecdef, has_function_privilege('anon', p.oid, 'execute'),
         has_function_privilege('authenticated', p.oid, 'execute'),
         has_function_privilege('service_role', p.oid, 'execute')
    into def_d, anon_d, auth_d, svc_d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'resumen_documentos_tenant';

  delete from tenant where nombre like 'ZZZ VERIF T63 %';

  raise exception E'RESUMEN_POR_TENANT\n  costo: cerrado=%  fase=%  viajes=%  tokens=%  AISLADO=%  sin-fase-ajena=%\n  docs:  procesados=%  porMes=%  AISLADO=%  solo-ocr=%\n  ventana-vacia=%  borde-semiabierto=%  hay-filas-en-el-borde=%\n  EL-RECORTE-DABA-MENOS=%   (1000 filas: %  ·  total real: %)\n  permisos costo: definer=% anon=% auth=% svc=%   docs: definer=% anon=% auth=% svc=%\n  (esperado t en todo, f en los definer y en anon/auth)',
    ok_cerrado, ok_fase, ok_viajes, ok_tokens, ok_aislado, ok_sin_fase_ajena,
    ok_docs, ok_mes, ok_docs_aislado, ok_solo_ocr,
    ok_vacia, ok_borde, hay_borde,
    recorte_daba_menos, recortado, cerrado,
    def_a, anon_a, auth_a, svc_a, def_d, anon_d, auth_d, svc_d;
end $$;


-- ── 44. Un CFDI ampara VARIAS casetas, y lo bloqueado sale de la cola (mig. 0065) ──
--
-- Las dos garantías de la 0065, y la de la 0019 que NO se pudo perder al
-- tocarla.
--
-- CAPUFE emite UNA factura con N códigos, así que N gastos comparten
-- `cfdi_uuid`. El índice de la 0019 —`unique (tenant_id, cfdi_uuid)`— lo
-- impedía: la segunda caseta reventaba con 23505 y las otras siete se quedaban
-- sin folio, volvían a la cola y la hora siguiente se emitía un SEGUNDO CFDI
-- por el mismo cruce. Fuera de plazo, eso ya no se cancela.
--
-- El índice NO se borró: se le agregó `cfdi_orden` como tercera columna. La
-- garantía que queda es "a lo sumo un gasto por (flota, CFDI) puede ser el
-- orden 1", y como TODO camino que inserta un gasto con folio usa el default
-- 1, el caso de la 0019 —el mismo XML entrando dos veces— sigue rebotando. Este
-- bloque lo comprueba en las dos direcciones, y comprueba también que el
-- mensaje siga nombrando `uq_gasto_cfdi_uuid`: `processor.ts` discrimina por
-- ese nombre para saber si el 23505 es benigno, así que renombrarlo tumbaría el
-- procesamiento de la foto en vez de ignorarla.
--
-- Y la cola: los bloqueados —CAPTCHA, emisión sin confirmar— no se reintentan.
-- El índice parcial lleva el MISMO predicado que la consulta del cron, o se
-- estarían leyendo cada hora los que ya se sabe que no se pueden.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  t uuid; o uuid; v uuid; r record; plan text := '';
  choco_orden boolean := false; choco_ingesta boolean := false; msg text := '';
  n_lote int; sin_motivo boolean := false; usa_indice boolean; en_cola int;
begin
  insert into tenant (nombre) values ('ZZZ VERIF 0065') returning id into t;
  insert into operador (tenant_id, nombre, telefono) values (t,'ZZZ','5215557770065') returning id into o;
  insert into viaje (tenant_id, operador_id, estatus) values (t,o,'abierto') returning id into v;

  -- 1. UNA factura de 8 casetas: 8 gastos, un uuid, orden 1..8.
  insert into gasto (tenant_id, viaje_id, concepto, monto) select t, v, 'caseta', 50 from generate_series(1,8);
  update gasto g set cfdi_uuid = 'UUID-CAPUFE-LOTE', cfdi_orden = x.n
    from (select id, row_number() over (order by id) n from gasto where tenant_id = t) x
   where g.id = x.id;
  select count(*) into n_lote from gasto where tenant_id = t and cfdi_uuid = 'UUID-CAPUFE-LOTE';

  -- 2. El mismo (uuid, orden) NO entra dos veces.
  begin
    insert into gasto (tenant_id, viaje_id, concepto, monto, cfdi_uuid, cfdi_orden)
      values (t, v, 'caseta', 50, 'UUID-CAPUFE-LOTE', 3);
  exception when unique_violation then choco_orden := true;
  end;

  -- 3. LA GARANTÍA DE LA 0019: el XML del mismo CFDI llegando por ingesta —que
  --    siempre escribe el default 1— sigue rebotando, y con el NOMBRE que
  --    `processor.ts` discrimina.
  begin
    insert into gasto (tenant_id, viaje_id, concepto, monto, cfdi_uuid)
      values (t, v, 'caseta', 400, 'UUID-CAPUFE-LOTE');
  exception when unique_violation then choco_ingesta := true; msg := SQLERRM;
  end;

  -- 4. Una marca de bloqueo sin motivo no se guarda: mandaría a una persona a
  --    facturar algo sin decirle por qué falló solo.
  begin
    update gasto set autofactura_bloqueada_en = now() where tenant_id = t and cfdi_orden = 2;
  exception when check_violation then sin_motivo := true;
  end;

  -- 5. La cola del cron: usa el índice y NO devuelve los bloqueados.
  insert into gasto (tenant_id, viaje_id, concepto, monto, created_at, autofactura_bloqueada_en, autofactura_bloqueo)
  select t, v, 'diesel', 100, now()-(g||' minutes')::interval,
         case when g%4=0 then now() else null end,
         case when g%4=0 then 'el portal pidió CAPTCHA' else null end
  from generate_series(1,9000) g;
  analyze gasto;

  select count(*) into en_cola from gasto
    where tenant_id = t and cfdi_uuid is null and autofactura_bloqueada_en is null;

  for r in execute 'explain select id from gasto where cfdi_uuid is null and autofactura_bloqueada_en is null
                    order by autofactura_intentada_en nulls first, created_at limit 8'
  loop plan := plan || r."QUERY PLAN" || ' | '; end loop;
  usa_indice := plan ilike '%gasto_por_facturar_idx%';

  delete from tenant where id = t;
  raise exception E'CFDI_LOTE  gastos-con-el-mismo-uuid=%  mismo-orden-rebota=%  ingesta-repetida-rebota=%  bloqueo-sin-motivo-rebota=%  cola-usa-indice=%  en-cola=%  msg=%   (esperado 8 / t / t / t / t / 6750 / nombra uq_gasto_cfdi_uuid)',
    n_lote, choco_orden, choco_ingesta, sin_motivo, usa_indice, en_cola, msg;
end $$;

-- ── 45. Ni un peso negativo en el camino del dinero (mig. 0070) ──────────────
--
-- El único check que tenían `gasto.monto` y `viaje.anticipo` era contra `NaN`.
-- Comprobado ANTES de la 0070: `monto = -99999` ENTRABA. Un comprobante negativo
-- no suma de menos, RESTA del comprobado, así que infla la diferencia al doble y
-- el PDF le dice al chofer que debe dinero que no debe.
--
-- ESTE BLOQUE SE FALSIFICA A SÍ MISMO. Después de comprobar en verde, TIRA los
-- dos checks dentro de la misma transacción y vuelve a intentar el -99999. Si el
-- bloque no puede enseñar el defecto con los checks caídos, es que no estaba
-- comprobando los checks. Todo se revierte con la excepción final.
--
-- OJO con la trampa que este bloque esquiva: hay que usar un OPERADOR DISTINTO
-- por cada `insert into viaje`, porque `uq_viaje_abierto_por_operador` (0029)
-- rebota el segundo viaje vivo del mismo chofer — y ese rechazo se leería como
-- "el check de anticipo funcionó" cuando en realidad el check ni se evaluó.
--
-- Corrida REAL contra la base, salida copiada tal cual:
--
--   45  rechaza-monto-negativo=t  acepta-monto-cero=t  rechaza-anticipo-negativo=t
--       acepta-anticipo-cero=t
--       FALSIFICADO (checks caidos): entra-monto-negativo=t  entra-anticipo-negativo=t
--
-- `acepta-monto-cero` y `acepta-anticipo-cero` son `t` A PROPÓSITO: el piso es
-- `>= 0`, no `> 0`. En `anticipo` el cero es el DEFAULT del esquema —un viaje sin
-- adelanto es el caso normal— así que un `> 0` habría roto la inserción de la
-- mitad de los viajes. Ver la 0070 para el argumento de `monto`.

do $$
declare
  t uuid; o uuid; v uuid; o2 uuid; o3 uuid; o4 uuid;
  rechaza_neg bool; acepta_cero bool; rechaza_ant_neg bool; acepta_ant_cero bool;
  sin_check_entra_neg bool; sin_check_entra_ant bool; msg text;
begin
  insert into tenant(nombre) values ('ZZZ VERIF B45 '||gen_random_uuid()) returning id into t;
  insert into operador(tenant_id,nombre,telefono) values (t,'Op1','5215500000001') returning id into o;
  insert into operador(tenant_id,nombre,telefono) values (t,'Op2','5215500000002') returning id into o2;
  insert into operador(tenant_id,nombre,telefono) values (t,'Op3','5215500000003') returning id into o3;
  insert into operador(tenant_id,nombre,telefono) values (t,'Op4','5215500000004') returning id into o4;
  insert into viaje(tenant_id,operador_id,estatus) values (t,o,'en_cuadre') returning id into v;

  begin
    insert into gasto(tenant_id,viaje_id,concepto,monto) values (t,v,'diesel',-99999);
    rechaza_neg := false;
  exception when check_violation then rechaza_neg := true; msg := sqlerrm;
  end;
  begin
    insert into gasto(tenant_id,viaje_id,concepto,monto) values (t,v,'diesel',0);
    acepta_cero := true;
  exception when others then acepta_cero := false;
  end;
  begin   -- operador NUEVO: aislar de uq_viaje_abierto_por_operador (0029)
    insert into viaje(tenant_id,operador_id,estatus,anticipo) values (t,o2,'en_cuadre',-1);
    rechaza_ant_neg := false;
  exception when check_violation then rechaza_ant_neg := true;
  end;
  begin
    insert into viaje(tenant_id,operador_id,estatus,anticipo) values (t,o3,'en_cuadre',0);
    acepta_ant_cero := true;
  exception when others then acepta_ant_cero := false;
  end;

  -- ═══ FALSIFICACIÓN ═══
  alter table gasto drop constraint gasto_monto_no_negativo;
  alter table viaje drop constraint viaje_anticipo_no_negativo;
  begin
    insert into gasto(tenant_id,viaje_id,concepto,monto) values (t,v,'diesel',-99999);
    sin_check_entra_neg := true;
  exception when others then sin_check_entra_neg := false;
  end;
  begin
    insert into viaje(tenant_id,operador_id,estatus,anticipo) values (t,o4,'en_cuadre',-99999);
    sin_check_entra_ant := true;
  exception when others then sin_check_entra_ant := false;
  end;

  raise exception E'45  rechaza-monto-negativo=%  acepta-monto-cero=%  rechaza-anticipo-negativo=%  acepta-anticipo-cero=%\n    FALSIFICADO (checks caidos): entra-monto-negativo=%  entra-anticipo-negativo=%\n    (esperado: t t t t  /  t t)\n    msg=%',
    rechaza_neg, acepta_cero, rechaza_ant_neg, acepta_ant_cero,
    sin_check_entra_neg, sin_check_entra_ant, msg;
end $$;


-- ── 46. Borrar una flota dejó de ser O(n²) (mig. 0071) ───────────────────────
--
-- Postgres NO indexa el lado que REFERENCIA de una FK. Al borrar una fila padre
-- el trigger busca a sus hijos, y sin índice eso es un `Seq Scan` de la tabla
-- hija COMPLETA — una vez POR CADA FILA PADRE. Es `filas_padre × tamaño_hijo`:
-- cuadrático, invisible con la base vacía, y devastador con datos.
--
-- Igual que los bloques 39 y 40, ESTE BLOQUE NO COMPRUEBA QUE LOS ÍNDICES
-- EXISTAN. Comprueba tres cosas que sí importan:
--   1. que el PLANEADOR los use (un índice que existe y no se usa es peso muerto),
--   2. que NO QUEDE ni una FK contra un padre numeroso sin índice utilizable —
--      leído del catálogo, no de una lista escrita a mano que se desactualiza,
--   3. que los TRES que se descartaron a propósito sigan descartados.
--
-- El punto 2 es el que de verdad cierra el defecto: la auditoría nombró 9
-- índices, pero el sondeo del catálogo encontró 43 FK sin índice utilizable, y
-- con solo esos 9 el borrado SEGUÍA siendo cuadrático porque quedaban 10 FK
-- contra `viaje` sin cubrir.
--
-- El criterio del descarte: el costo de un borrado es `(filas del PADRE) ×
-- (tamaño del HIJO)`. Las FK contra `tenant` tienen UNA fila padre, así que su
-- trigger corre UNA vez por borrado — un solo `Seq Scan` de una tabla acotada es
-- correcto, y un índice de más se paga en cada insert para siempre.
--
-- Corrida REAL, salida copiada tal cual:
--
--   46  plan-con-indice=llm_costo_liquidacion_id_idx   FK-de-padre-numeroso-sin-indice=—
--       descartados-siguen-sin-indice(a proposito)=campania, terminal, codigo_pendiente
--       FALSIFICADO: plan-sin-indice=Seq Scan
--       200 sondeos (75k filas):  con=3.9 ms   sin=1902.6 ms   factor=491.8x
--
-- Y la medición de punta a punta, con una flota sembrada de 2,000 viajes y
-- ~34,000 filas hijas:  `delete from tenant` = 4,696.5 ms → 900.5 ms  (5.2×).

do $$
declare
  t uuid; j jsonb; nodo_con text; nodo_sin text; faltan text; descartados text; d timestamptz;
  ms_con numeric; ms_sin numeric; i int; x int; liq uuid[];
begin
  insert into tenant(nombre) values ('ZZZ VERIF B46 '||gen_random_uuid()) returning id into t;
  insert into llm_costo(tenant_id,liquidacion_id,fase,modelo)
    select t,null,'ocr','haiku' from generate_series(1,75000);
  analyze llm_costo;
  liq := array(select gen_random_uuid() from generate_series(1,200));

  -- 1. EL PLANEADOR LO USA (no solo "existe")
  execute 'explain (format json) select 1 from only llm_costo where liquidacion_id = $1'
    using liq[1] into j;
  nodo_con := coalesce(j->0->'Plan'->>'Index Name', j->0->'Plan'->'Plans'->0->>'Index Name', j->0->'Plan'->>'Node Type');
  d := clock_timestamp();
  for i in 1..200 loop select count(*) into x from llm_costo where liquidacion_id = liq[i]; end loop;
  ms_con := extract(epoch from clock_timestamp()-d)*1000;

  -- 2. NINGUNA FK de padre numeroso se quedó sin índice utilizable.
  -- Se lee del CATÁLOGO: `indkey` es 0-based, y una FK compuesta cuya PRIMERA
  -- columna ya está indexada sola tampoco cuenta (el planner entra por ahí).
  select coalesce(string_agg(tabla||'('||cols||')', ', '), '—') into faltan from (
    select c.conrelid::regclass::text tabla,
           (select string_agg(a.attname,',' order by x2.ord)
              from unnest(c.conkey) with ordinality x2(att,ord)
              join pg_attribute a on a.attrelid=c.conrelid and a.attnum=x2.att) cols
      from pg_constraint c
     where c.connamespace='public'::regnamespace and c.contype='f'
       and c.confrelid::regclass::text in ('viaje','gasto','liquidacion','operador','unidad','cliente','terminal')
       and not exists (
         select 1 from pg_index i where i.indrelid=c.conrelid and i.indpred is null
            and i.indnatts >= array_length(c.conkey,1)
            and (select array_agg(i.indkey[k] order by i.indkey[k]) from generate_series(0,array_length(c.conkey,1)-1) k)
              = (select array_agg(a2 order by a2) from unnest(c.conkey) a2))
       and not exists (
         select 1 from pg_index i where i.indrelid=c.conrelid and i.indpred is null
            and i.indkey[0] = c.conkey[1])
  ) s;

  -- 3. Los tres DESCARTADOS a propósito siguen sin índice
  select coalesce(string_agg(t2,', '),'—') into descartados from (
    select unnest(array['campania','terminal','codigo_pendiente']) t2) z
   where not exists (select 1 from pg_index i where i.indrelid=z.t2::regclass
                       and i.indnatts=1 and i.indkey[0]=(select attnum from pg_attribute
                         where attrelid=z.t2::regclass and attname='tenant_id'));

  -- ═══ FALSIFICACIÓN: sin el índice, el plan cae a Seq Scan ═══
  drop index llm_costo_liquidacion_id_idx;
  analyze llm_costo;
  execute 'explain (format json) select 1 from only llm_costo where liquidacion_id = $1'
    using liq[1] into j;
  nodo_sin := j->0->'Plan'->>'Node Type';
  d := clock_timestamp();
  for i in 1..200 loop select count(*) into x from llm_costo where liquidacion_id = liq[i]; end loop;
  ms_sin := extract(epoch from clock_timestamp()-d)*1000;

  raise exception E'46  plan-con-indice=%   FK-de-padre-numeroso-sin-indice=%\n    descartados-siguen-sin-indice(a proposito)=%\n    FALSIFICADO: plan-sin-indice=%\n    200 sondeos (75k filas):  con=% ms   sin=% ms   factor=%x',
    nodo_con, faltan, descartados, nodo_sin,
    round(ms_con,1), round(ms_sin,1), round(ms_sin/greatest(ms_con,0.001),1);
end $$;


-- ── 47. Se purga lo efímero y NO se purga la historia de negocio (mig. 0072) ──
--
-- Hasta la 0072 no se purgaba NADA. Este bloque comprueba las dos mitades de la
-- decisión, y la segunda importa más que la primera:
--
--   · `wa_mensaje_procesado` SÍ se purga a los 30 días. Es idempotencia pura:
--     no tiene `tenant_id`, no se puede atribuir a una flota, no responde
--     ninguna pregunta de negocio.
--   · `llm_costo` NO se purga. `resumen_costo_ia_tenant()` (0062/0064) suma sus
--     filas CRUDAS, así que borrarlas haría que esa función contestara —sin
--     avisar— una cifra MENOR para cualquier periodo purgado. El panel enseñaría
--     un número distinto del mismo mes según cuándo se mire, que es justo lo que
--     "nunca inventar una cifra" prohíbe. Se CONSOLIDA a mensual en su lugar.
--
-- El bloque comprueba que `llm_costo` sigue INTACTA después de la corrida. Esa
-- afirmación en negativo es la que hay que sostener: es la que se rompería sola
-- el día que alguien "complete" la purga sin mirar quién lee la tabla.
--
-- Comprueba además que el mes EN CURSO no se consolida (un consolidado parcial
-- es la cifra engañosa que se quiere evitar), que la consolidación es
-- IDEMPOTENTE, y que un plazo demasiado corto falla CERRADO con SQLSTATE PU001.
--
-- Corrida REAL, salida copiada tal cual:
--
--   47  wa: viejos-antes=100  purgados=100  quedan=10
--       llm_costo INTACTA=87  consolidado=2.000000 == crudo-de-meses-cerrados=2.000000
--       mes-en-curso-NO-consolidado=t  idempotente=t
--       plazo-minimo-falla-cerrado=t sqlstate=PU001
--       json={"diasWa":30,"waPurgados":100,"iaConsolidados":2,"llmCostoPurgado":false}
--
-- SOBRE `idx_wa_msg_created`: la auditoría lo dio por muerto. Su forma es
-- exactamente la de un `delete where created_at < …` — era el índice de ESTA
-- purga, que no estaba escrita. Medido aparte, en estado ESTACIONARIO (1,000
-- filas vencidas de 31,000, que es lo que el cron ve cada día) el delete entra
-- por `idx_wa_msg_created`; en la PRIMERA corrida, que barre casi todo, cae a
-- `Seq Scan` — y ahí el Seq Scan es lo correcto. Borrarlo habría sido el error.

do $$
declare
  t uuid; ahora timestamptz := '2026-08-04 12:00:00+00'; j jsonb; j2 jsonb;
  quedan_wa int; viejos_antes int; guarda_minimo bool; sqlst text;
  llm_intactas int; consol_suma numeric; cruda_suma numeric; mes_curso int; idempotente bool;
begin
  insert into tenant(nombre) values ('ZZZ VERIF B47 '||gen_random_uuid()) returning id into t;

  insert into wa_mensaje_procesado(wa_message_id, created_at)
    select 'v'||gen_random_uuid(), ahora - interval '60 days' from generate_series(1,100);
  insert into wa_mensaje_procesado(wa_message_id, created_at)
    select 'r'||gen_random_uuid(), ahora - interval '2 days' from generate_series(1,10);
  select count(*) into viejos_antes from wa_mensaje_procesado where created_at < ahora - interval '30 days';

  -- Dos meses CERRADOS y el mes EN CURSO
  insert into llm_costo(tenant_id,fase,modelo,tokens_in,tokens_out,costo_usd,created_at)
    select t,'ocr','haiku',10,5,0.01, '2026-06-15 00:00:00+00' from generate_series(1,50);
  insert into llm_costo(tenant_id,fase,modelo,tokens_in,tokens_out,costo_usd,created_at)
    select t,'cuadre','sonnet',20,10,0.05,'2026-07-15 00:00:00+00' from generate_series(1,30);
  insert into llm_costo(tenant_id,fase,modelo,tokens_in,tokens_out,costo_usd,created_at)
    select t,'ocr','haiku',10,5,0.01,'2026-08-02 00:00:00+00' from generate_series(1,7);

  j := mantenimiento_de_datos(30, ahora);

  select count(*) into quedan_wa from wa_mensaje_procesado;
  select count(*) into llm_intactas from llm_costo where tenant_id=t;   -- NADA se borró
  select coalesce(sum(costo_usd),0) into consol_suma from llm_costo_mensual where tenant_id=t;
  select coalesce(sum(costo_usd),0) into cruda_suma  from llm_costo
   where tenant_id=t and created_at < date_trunc('month', ahora at time zone 'UTC');
  select count(*) into mes_curso from llm_costo_mensual where tenant_id=t and mes='2026-08-01';

  j2 := mantenimiento_de_datos(30, ahora);      -- idempotencia
  idempotente := (j2->>'iaConsolidados')::int = (j->>'iaConsolidados')::int
                 and (select count(*) from llm_costo_mensual where tenant_id=t)
                     = (select count(distinct (date_trunc('month',created_at at time zone 'UTC'), fase, modelo))
                          from llm_costo where tenant_id=t and created_at < date_trunc('month', ahora at time zone 'UTC'));

  begin
    perform purgar_wa_mensaje_procesado(3, ahora);
    guarda_minimo := false;
  exception when others then guarda_minimo := true; sqlst := sqlstate;
  end;

  raise exception E'47  wa: viejos-antes=%  purgados=%  quedan=%  (esperado 100 / 100 / 10)\n    llm_costo INTACTA=%  (87, no se purga)   consolidado=% == crudo-de-meses-cerrados=%\n    mes-en-curso-NO-consolidado=%  idempotente=%\n    plazo-minimo-falla-cerrado=% sqlstate=%\n    json=%',
    viejos_antes, (j->>'waPurgados'), quedan_wa,
    llm_intactas, consol_suma, cruda_suma, (mes_curso=0), idempotente,
    guarda_minimo, sqlst, j::text;
end $$;


-- ── 48. Un comprobante huérfano no cruza de flota, ni inventa estado (mig. 0073) ──
--
-- La 0028 documentó como CRÍTICA la clase de defecto: con una FK simple contra
-- `operador(id)`, nada impide que una fila lleve el `tenant_id` de la flota A y
-- el `operador_id` de la flota B. `comprobante_huerfano` nació en la 0040 —
-- DESPUÉS de la 0028 — y se saltó el patrón. Comprobado antes de arreglarlo: la
-- fila cruzada ENTRABA.
--
-- Y `motivo`/`resolucion` eran las DOS únicas columnas de estado del esquema sin
-- su check, aunque la 0040 las documenta y el código ramifica sobre ellas.
--
-- LOS VALORES SE TOMARON DEL CÓDIGO DE HOY, NO DE LA 0040. `repo.ts:257` declara
-- TRES motivos, no los dos que la migración vieja documenta:
--     export type MotivoHuerfano = 'sin_viaje' | 'tras_liquidar' | 'fallo_ocr';
-- `fallo_ocr` es reciente —separa "se cayó NUESTRO OCR" de "no aterrizó en
-- ninguna liquidación", que antes se guardaban los dos como `sin_viaje`— y
-- cerrar el dominio contra la migración habría roto el camino que lo escribe.
-- Por eso el bloque prueba los TRES uno por uno: si mañana el código agrega un
-- cuarto y no toca el check, este bloque se pone rojo antes que producción.
--
-- Corrida REAL, salida copiada tal cual:
--
--   48  cruza-flotas-rebota=t  los-3-motivos-entran=t  motivo-inventado-rebota=t
--       resolucion-inventada-rebota=t  cierre-a-medias-rebota=t
--       FALSIFICADO (FK compuesta caida): cruza-flotas-ENTRA=t

do $$
declare
  ta uuid; tb uuid; oa uuid; ob uuid;
  cruza_rebota bool; sin_fk_cruza_entra bool;
  motivos_validos bool := true; motivo_malo_rebota bool; resol_mala_rebota bool;
  cierre_a_medias_rebota bool; m text;
begin
  insert into tenant(nombre) values ('ZZZ VERIF B48 A '||gen_random_uuid()) returning id into ta;
  insert into tenant(nombre) values ('ZZZ VERIF B48 B '||gen_random_uuid()) returning id into tb;
  insert into operador(tenant_id,nombre,telefono) values (ta,'A','5215500001001') returning id into oa;
  insert into operador(tenant_id,nombre,telefono) values (tb,'B','5215500001002') returning id into ob;

  -- tenant_id de A con operador_id de B
  begin
    insert into comprobante_huerfano(tenant_id,operador_id,gasto,motivo)
      values (ta, ob, '{}'::jsonb, 'sin_viaje');
    cruza_rebota := false;
  exception when foreign_key_violation then cruza_rebota := true;
  end;

  -- Los TRES motivos del código de HOY (incluido fallo_ocr)
  foreach m in array array['sin_viaje','tras_liquidar','fallo_ocr'] loop
    begin
      insert into comprobante_huerfano(tenant_id,operador_id,gasto,motivo)
        values (ta, oa, '{}'::jsonb, m);
    exception when others then motivos_validos := false;
    end;
  end loop;

  begin
    insert into comprobante_huerfano(tenant_id,operador_id,gasto,motivo)
      values (ta, oa, '{}'::jsonb, 'inventado');
    motivo_malo_rebota := false;
  exception when check_violation then motivo_malo_rebota := true;
  end;
  begin
    insert into comprobante_huerfano(tenant_id,operador_id,gasto,motivo,resuelto_en,resolucion)
      values (ta, oa, '{}'::jsonb, 'sin_viaje', now(), 'inventada');
    resol_mala_rebota := false;
  exception when check_violation then resol_mala_rebota := true;
  end;
  begin  -- resuelto_en sin resolucion = fila a medias
    insert into comprobante_huerfano(tenant_id,operador_id,gasto,motivo,resuelto_en)
      values (ta, oa, '{}'::jsonb, 'sin_viaje', now());
    cierre_a_medias_rebota := false;
  exception when check_violation then cierre_a_medias_rebota := true;
  end;

  -- ═══ FALSIFICACIÓN ═══
  alter table comprobante_huerfano drop constraint comprobante_huerfano_operador_tenant_fkey;
  begin
    insert into comprobante_huerfano(tenant_id,operador_id,gasto,motivo)
      values (ta, ob, '{}'::jsonb, 'sin_viaje');
    sin_fk_cruza_entra := true;
  exception when others then sin_fk_cruza_entra := false;
  end;

  raise exception E'48  cruza-flotas-rebota=%  los-3-motivos-entran=%  motivo-inventado-rebota=%\n    resolucion-inventada-rebota=%  cierre-a-medias-rebota=%\n    FALSIFICADO (FK compuesta caida): cruza-flotas-ENTRA=%\n    (esperado t t t t t / t)',
    cruza_rebota, motivos_validos, motivo_malo_rebota, resol_mala_rebota,
    cierre_a_medias_rebota, sin_fk_cruza_entra;
end $$;


-- ── 49. Las funciones que resuelven TODO el RLS tienen pg_temp (mig. 0074) ───
--
-- `is_superadmin`, `get_user_tenant_ids`, `is_operador` y `get_user_operador_id`
-- son `SECURITY DEFINER` y son las que TODA política RLS del esquema llama para
-- decidir qué flota ve cada quien. Tenían `search_path=public` a secas.
--
-- Cuando `pg_temp` no está NOMBRADO, Postgres lo antepone igual de forma
-- implícita: cualquier rol puede crear un objeto temporal en su sesión y ganarle
-- la resolución de nombre a `public`. En una función que corre con los permisos
-- de su dueño, eso es un camino a suplantar la respuesta de "¿de qué flotas es
-- este usuario?". Nombrarlo AL FINAL lo fija en último lugar.
--
-- Que `ve_finanzas` y `administra_flota` (0048) SÍ lo tuvieran es la prueba de
-- que era olvido y no decisión.
--
-- CORRECCIÓN A LA AUDITORÍA: `gasto_no_tras_liquidar` NO es `SECURITY DEFINER`
-- —`prosecdef = false` en el catálogo—, así que corre con los permisos de quien
-- dispara el INSERT y el riesgo es mucho menor. Pero no tenía NINGÚN
-- `search_path` (`proconfig` vacío), que es un hueco distinto y más ancho del
-- que la auditoría describió. Se le fija igual: es el trigger que la 0036 llama
-- "el peor bug histórico del camino del dinero".
--
-- Corrida REAL, salida copiada tal cual:
--
--   49  CON pg_temp: administra_flota, gasto_no_tras_liquidar, get_user_operador_id,
--       get_user_tenant_ids, is_operador, is_superadmin, ve_finanzas
--       SIN pg_temp: —
--       FALSIFICADO (se le quita a is_superadmin): sin-pg_temp = is_superadmin

do $$
declare con_pg_temp text; sin_pg_temp text; tras_falsificar text;
begin
  select coalesce(string_agg(proname,', ' order by proname),'—') into con_pg_temp
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and p.proname in ('is_superadmin','get_user_tenant_ids','is_operador','get_user_operador_id',
                       've_finanzas','administra_flota','gasto_no_tras_liquidar')
     and array_to_string(p.proconfig,',') like '%pg_temp%';

  select coalesce(string_agg(proname,', ' order by proname),'—') into sin_pg_temp
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and p.proname in ('is_superadmin','get_user_tenant_ids','is_operador','get_user_operador_id',
                       've_finanzas','administra_flota','gasto_no_tras_liquidar')
     and coalesce(array_to_string(p.proconfig,','),'') not like '%pg_temp%';

  -- ═══ FALSIFICACIÓN: se le quita a una y el bloque tiene que verla ═══
  alter function public.is_superadmin() set search_path = public;
  select coalesce(string_agg(proname,', ' order by proname),'—') into tras_falsificar
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and p.proname in ('is_superadmin','get_user_tenant_ids','is_operador','get_user_operador_id',
                       've_finanzas','administra_flota','gasto_no_tras_liquidar')
     and coalesce(array_to_string(p.proconfig,','),'') not like '%pg_temp%';

  raise exception E'49  CON pg_temp: %\n    SIN pg_temp: %   (esperado —)\n    FALSIFICADO (se le quita a is_superadmin): sin-pg_temp = %',
    con_pg_temp, sin_pg_temp, tras_falsificar;
end $$;


-- ── 50. El candado se va con su viaje, y las NOT VALID quedaron validadas (mig. 0075) ──
--
-- `viaje_lock` es el mutex de un viaje y no tenía FK contra `viaje`: un proceso
-- que muere entre tomar el candado y soltarlo dejaba una fila permanente, y la
-- tabla del mutex acumulaba basura que nada limpiaba. Con `ON DELETE CASCADE` el
-- candado se va con su viaje — que es la única semántica que tiene sentido: un
-- candado sobre algo que ya no existe no protege nada.
--
-- OJO: esto NO arregla el candado colgado de un viaje que SÍ existe. De eso se
-- encarga `locked_until`, que es el TTL. Arregla la fila huérfana, que es otra
-- cosa, y decirlo importa para que nadie lea este bloque como más de lo que es.
--
-- Y las dos restricciones que llevaban meses en `NOT VALID` —`convalidated =
-- false` en el catálogo— se validaron: con la base vacía, `VALIDATE` no lee ni
-- una fila y no puede fallar. Con 240 mil viajes al año, dentro de unos meses ya
-- no habría sido gratis.
--
-- Corrida REAL, salida copiada tal cual:
--
--   50  candado-borrado-con-el-viaje=0
--       constraints: viaje_ingreso_no_negativo=true  viaje_km_sanos=true
--       FALSIFICADO sin FK: candado-huerfano-que-queda-para-siempre=1
--       FALSIFICADO not-valid: viaje_km_sanos.convalidated=f

do $$
declare
  t uuid; o uuid; v uuid; quedan int; quedan_sin_fk int; validadas text; tras_falsificar bool;
begin
  insert into tenant(nombre) values ('ZZZ VERIF B50 '||gen_random_uuid()) returning id into t;
  insert into operador(tenant_id,nombre,telefono) values (t,'Op','5215500002001') returning id into o;
  insert into viaje(tenant_id,operador_id,estatus) values (t,o,'en_cuadre') returning id into v;

  insert into viaje_lock(viaje_id, locked_until) values (v, now() + interval '5 min');
  delete from viaje where id = v;
  select count(*) into quedan from viaje_lock where viaje_id = v;

  select coalesce(string_agg(conname||'='||convalidated::text, '  '), '—') into validadas
    from pg_constraint
   where conrelid='viaje'::regclass and conname in ('viaje_ingreso_no_negativo','viaje_km_sanos');

  -- ═══ FALSIFICACIÓN 1: sin la FK, el candado sobrevive al viaje ═══
  alter table viaje_lock drop constraint viaje_lock_viaje_id_fkey;
  insert into viaje(tenant_id,operador_id,estatus) values (t,o,'en_cuadre') returning id into v;
  insert into viaje_lock(viaje_id, locked_until) values (v, now() + interval '5 min');
  delete from viaje where id = v;
  select count(*) into quedan_sin_fk from viaje_lock where viaje_id = v;

  -- ═══ FALSIFICACIÓN 2: re-agregada como NOT VALID, el catálogo lo delata ═══
  alter table viaje drop constraint viaje_km_sanos;
  alter table viaje add constraint viaje_km_sanos
    check (km_recorridos is null or (km_recorridos > 0 and km_recorridos < 20000)) not valid;
  select convalidated into tras_falsificar from pg_constraint
   where conrelid='viaje'::regclass and conname='viaje_km_sanos';

  raise exception E'50  candado-borrado-con-el-viaje=%  (esperado 0)\n    constraints: %  (esperado las dos =true)\n    FALSIFICADO sin FK: candado-huerfano-que-queda-para-siempre=%  (esperado 1)\n    FALSIFICADO not-valid: viaje_km_sanos.convalidated=%  (esperado f)',
    quedan, validadas, quedan_sin_fk, tras_falsificar;
end $$;

-- ── 51. El desglose de la mensualidad no se puede desincronizar (mig. 0066) ──
--
-- `factura_saas.subtotal` y `.iva` se guardan al emitir, no se recalculan al
-- timbrar (entre emitir y timbrar el precio del plan puede cambiar, y lo que
-- se timbra tiene que ser lo que se cobró). El CHECK `factura_saas_
-- desglose_cuadra` es lo único que impide que las tres columnas de dinero
-- —monto, subtotal, iva— se desincronicen sin que nada avise; los otros dos
-- (`_coherente`, `_no_negativo`) cierran los bordes: medio desglose guardado,
-- o un negativo colado.
--
-- ESTE BLOQUE EXISTE POR UNA COLISIÓN, no solo por la migración. El archivo
-- que la trae se llamó primero `0065_iva_de_la_mensualidad.sql`, con el mismo
-- prefijo que `0065_cfdi_de_varias_casetas.sql` (otro agente, mismo día,
-- ambos sin commitear). `migraciones_verificadas.test.ts` indexa las
-- migraciones por los 4 primeros caracteres del nombre de archivo, así que
-- ambos archivos compartían la misma llave — y el bloque 44 de aquí abajo
-- (título "...mig. 0065", que SÍ prueba la de CFDI) le prestaba cobertura
-- FALSA a ésta: el test pasaba en verde sin que ninguna de las tres CHECK de
-- abajo se hubiera probado nunca. Renumerada a 0066 (auditoría 10, rubro
-- datos, 4-ago-2026) y este bloque es la cobertura real que faltaba.
--
-- Corrida REAL contra el proyecto Likida, 4-ago-2026 (`factura_saas` sin
-- filas antes y después — la excepción revirtió todo, 0 tenants ZZZ que
-- quedaron):
--
--   51  desglose-a-medias-rechazado=t  negativo-rechazado=t
--       descuadrado-rechazado=t  borde-de-tolerancia-acepta=t  exacto-acepta=t
--       (esperado t/t/t/t/t)
do $$
declare
  t uuid;
  incoherente boolean := false;
  negativo boolean := false;
  descuadrado boolean := false;
  ok_borde_tolerancia boolean := false;
  ok_exacto boolean := false;
begin
  insert into tenant (nombre) values ('ZZZ VERIF B51 '||gen_random_uuid()) returning id into t;

  -- 1. Medio desglose (subtotal sin iva) no se guarda.
  begin
    insert into factura_saas (tenant_id, periodo_inicio, periodo_fin, monto, subtotal, iva)
      values (t, '2026-09-01', '2026-09-30', 10000, 8620.69, null);
  exception when check_violation then incoherente := true;
  end;

  -- 2. Un negativo no se guarda, aunque el resto del desglose cuadre.
  begin
    insert into factura_saas (tenant_id, periodo_inicio, periodo_fin, monto, subtotal, iva)
      values (t, '2026-09-01', '2026-09-30', 8000, 9000, -1000);
  exception when check_violation then negativo := true;
  end;

  -- 3. subtotal+iva lejos de monto (mucho más que el centavo del redondeo):
  --    no se guarda. Suma 9000, faltan 1000 contra el monto de 10000.
  begin
    insert into factura_saas (tenant_id, periodo_inicio, periodo_fin, monto, subtotal, iva)
      values (t, '2026-09-01', '2026-09-30', 10000, 8000, 1000);
  exception when check_violation then descuadrado := true;
  end;

  -- 4. EN EL BORDE de la tolerancia (diff = 0.01, el límite `<=`): SÍ se
  --    guarda. 8620.69 + 1379.30 = 9999.99, un centavo menos que 10000 — el
  --    resto exacto de dividir 10000/1.16 y redondear el subtotal a centavos.
  insert into factura_saas (tenant_id, periodo_inicio, periodo_fin, monto, subtotal, iva)
    values (t, '2026-09-01', '2026-09-30', 10000, 8620.69, 1379.30);
  ok_borde_tolerancia := true;

  -- 5. Exacto, sin redondeo de por medio: también se guarda.
  insert into factura_saas (tenant_id, periodo_inicio, periodo_fin, monto, subtotal, iva)
    values (t, '2026-10-01', '2026-10-31', 5000, 4310.34, 689.66);
  ok_exacto := true;

  raise exception E'51  desglose-a-medias-rechazado=%  negativo-rechazado=%  descuadrado-rechazado=%  borde-de-tolerancia-acepta=%  exacto-acepta=%   (esperado t/t/t/t/t)',
    incoherente, negativo, descuadrado, ok_borde_tolerancia, ok_exacto;
end $$;

-- ── 52. La cola del CFDI consolidado: única por línea, y cerrada a un anónimo (mig. 0076) ──
--
-- Dos garantías nuevas de `cfdi_consolidado_linea`, la tabla donde vive el JOIN
-- de auditoría 10 (diésel por monedero y peaje por TAG, ~54% del gasto real de
-- una flota, INEGI EAT 2024 — ver `docs/auditoria-10/fiscal.md`).
--
--   1. `unique (cfdi_xml_id, indice)`. WhatsApp/Meta SÍ reintenta el webhook, y
--      un reenvío del mismo XML no puede duplicar una línea: dos filas por el
--      mismo movimiento inflarían el conteo de "conciliadas" que ve el
--      contador en el panel, y le mentiría dos veces sobre el mismo peso.
--      `intake/consolidado.ts` además depende de esto para su idempotencia:
--      `guardarYConciliarConsolidado` usa `upsert(..., onConflict:
--      'cfdi_xml_id,indice')`, así que sin el índice el upsert haría un
--      INSERT liso y duplicaría en silencio.
--   2. RLS sin policy para `anon` — misma clase de fuga que la 0040
--      (`comprobante_huerfano`, bloque 23): esta tabla guarda folios de
--      operación, montos y el RFC de estaciones de servicio REALES (no el del
--      monedero) de TODAS las flotas.
--
-- Corrida REAL contra el proyecto Likida, 5-ago-2026 (0 tenants ZZZ y 0 filas
-- de sobra después — la excepción final revirtió todo):
--
--   52  mismo-indice-rebota=t  anon=0  service_role=1
--       FALSIFICADO (sin indice): duplicado-entra=t   (esperado t / 0 / 1 / t)
do $$
declare
  t uuid; x uuid;
  choco_indice boolean := false;
  sin_indice_entra boolean := false;
  n_anon int; n_service int;
begin
  insert into tenant (nombre) values ('ZZZ VERIF B52 '||gen_random_uuid()) returning id into t;
  insert into cfdi_xml (tenant_id, cfdi_uuid, xml, tiene_multiples_conceptos, total_conceptos)
    values (t, 'UUID-VERIF-0076', '<cfdi/>', true, 2) returning id into x;

  insert into cfdi_consolidado_linea (tenant_id, cfdi_xml_id, indice, fuente, monto, estatus)
    values (t, x, 1, 'ecc12', 100, 'conciliada');

  -- 1. La MISMA línea (cfdi_xml_id, indice) no entra dos veces.
  begin
    insert into cfdi_consolidado_linea (tenant_id, cfdi_xml_id, indice, fuente, monto, estatus)
      values (t, x, 1, 'ecc12', 999, 'por_conciliar');
  exception when unique_violation then choco_indice := true;
  end;

  -- 2. Cerrada a un anónimo.
  begin
    set local role anon;
    select count(*) into n_anon from cfdi_consolidado_linea where tenant_id = t;
    reset role;
  exception when insufficient_privilege then
    reset role;
    n_anon := -1;
  end;
  select count(*) into n_service from cfdi_consolidado_linea where tenant_id = t;

  -- ═══ FALSIFICACIÓN: sin el índice único, el duplicado SÍ entraría ═══
  alter table cfdi_consolidado_linea drop constraint cfdi_consolidado_linea_cfdi_xml_id_indice_key;
  begin
    insert into cfdi_consolidado_linea (tenant_id, cfdi_xml_id, indice, fuente, monto, estatus)
      values (t, x, 1, 'ecc12', 999, 'por_conciliar');
    sin_indice_entra := true;
  exception when others then sin_indice_entra := false;
  end;

  delete from tenant where id = t;
  raise exception E'52  mismo-indice-rebota=%  anon=%  service_role=%  FALSIFICADO (sin indice): duplicado-entra=%   (esperado t / 0 / 1 / t)',
    choco_indice, n_anon, n_service, sin_indice_entra;
end $$;

-- ── 53. cfdi_consolidado_linea admite 'sin_match', y solo eso — nada más (mig. 0077) ──
--
-- La 0077 amplía el check constraint de `estatus` para admitir un tercer
-- valor: 'sin_match' (un humano ya revisó la línea, vía `resolverLineaAMano`
-- en `intake/consolidado.ts`, y ningún gasto capturado le corresponde). La
-- garantía que solo la base puede demostrar es doble: que el valor NUEVO
-- entra, y que el constraint sigue siendo una LISTA CERRADA — que al
-- reescribirlo no se abrió por accidente a cualquier texto.
--
-- Corrida REAL contra el proyecto Likida, 5-ago-2026 (0 tenants ZZZ de sobra
-- después — la excepción final revirtió todo):
--
--   53  sin_match-entra=t  basura-rebota=t  (esperado t / t)
do $$
declare
  t uuid; x uuid;
  sin_match_entra boolean := false;
  basura_rebota boolean := false;
begin
  insert into tenant (nombre) values ('ZZZ VERIF B53 '||gen_random_uuid()) returning id into t;
  insert into cfdi_xml (tenant_id, cfdi_uuid, xml, tiene_multiples_conceptos, total_conceptos)
    values (t, 'UUID-VERIF-0077', '<cfdi/>', true, 1) returning id into x;

  -- 1. 'sin_match' SÍ entra — la garantía que trae esta migración.
  begin
    insert into cfdi_consolidado_linea (tenant_id, cfdi_xml_id, indice, fuente, monto, estatus)
      values (t, x, 1, 'ecc12', 100, 'sin_match');
    sin_match_entra := true;
  exception when others then sin_match_entra := false;
  end;

  -- 2. Un valor cualquiera SIGUE rebotando — el constraint es una lista
  --    cerrada, no se abrió al reescribirlo.
  begin
    insert into cfdi_consolidado_linea (tenant_id, cfdi_xml_id, indice, fuente, monto, estatus)
      values (t, x, 2, 'ecc12', 100, 'basura');
  exception when check_violation then basura_rebota := true;
  end;

  delete from tenant where id = t;
  raise exception '53  sin_match-entra=%  basura-rebota=%  (esperado t / t)', sin_match_entra, basura_rebota;
end $$;

-- ── 54. El chofer no ve ni escribe lo que no es suyo (mig. 0078) ────────────
-- La 0045 cerró viaje/gasto/liquidacion; la 0078 cierra las que quedaron:
-- operador, terminal, politica_gasto, wa_conversacion, llm_costo, cfdi_xml,
-- cfdi_consolidado_linea — y deja `tenant` en SOLO lectura por RLS (la app
-- escribe por service_role). Se siembran filas en las tablas, se impersona
-- a un chofer (mismo mecanismo del bloque 26/28) y se cuenta: esperado 0 en
-- las siete (leer lo de la flota = fuga) y 0 filas afectadas al intentar
-- editar el tenant (la regla que lo juzga). De paso se verifica que un
-- flota_admin SIGUE viendo lo suyo (no se rompió la oficina).
--
-- Corrida real esperada:
--   operador=0 terminal=0 politica=0 wa=0 llm=0 cfdi_xml=0 cola=0
--   tenant-update=0 (un UPDATE que no toca nada)  tenant-select=1
--   admin-ve-operador=2
do $$
declare
  v_t uuid; v_o1 uuid; v_o2 uuid; v_v uuid; v_x uuid; v_u1 uuid := gen_random_uuid(); v_admin uuid := gen_random_uuid();
  n_operador int; n_terminal int; n_politica int; n_wa int; n_llm int; n_xml int; n_cola int;
  n_tenant_updated int; n_tenant_visibles int; n_admin_operador int;
begin
  insert into tenant (nombre) values ('ZZZ VERIF RLS 0078 '||gen_random_uuid()) returning id into v_t;
  insert into terminal (tenant_id, nombre) values (v_t, 'Terminal ZZZ');
  insert into operador (tenant_id, nombre, telefono) values (v_t, 'Chofer Uno', '520000009050') returning id into v_o1;
  insert into operador (tenant_id, nombre, telefono) values (v_t, 'Chofer Dos', '520000009051') returning id into v_o2;
  insert into viaje (tenant_id, operador_id) values (v_t, v_o1) returning id into v_v;
  insert into wa_conversacion (tenant_id, operador_id, telefono) values (v_t, v_o1, '520000009050');
  insert into llm_costo (tenant_id, viaje_id, fase, modelo, costo_usd) values (v_t, v_v, 'cuadre', 'zzz', 0.01);
  insert into cfdi_xml (tenant_id, cfdi_uuid, xml, tiene_multiples_conceptos, total_conceptos)
    values (v_t, 'ZZZ-0078-1', '<cfdi/>', true, 1) returning id into v_x;
  insert into cfdi_consolidado_linea (tenant_id, cfdi_xml_id, indice, fuente, monto, estatus)
    values (v_t, v_x, 1, 'ecc12', 100, 'por_conciliar');
  insert into politica_gasto (tenant_id, concepto, tope_monto) values (v_t, 'diesel', 4000);
  insert into app_user (id, tenant_id, email, rol, operador_id)
    values (v_u1, v_t, 'zzz-verif-chofer@likida.test', 'operador', v_o1);
  insert into app_user (id, tenant_id, email, rol)
    values (v_admin, v_t, 'zzz-verif-admin@likida.test', 'flota_admin');

  -- ── El chofer, impersonado ─────────────────────────────────────────────
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_u1)::text, true);

  select count(*) into n_operador from operador where tenant_id = v_t;
  select count(*) into n_terminal from terminal where tenant_id = v_t;
  select count(*) into n_politica from politica_gasto where tenant_id = v_t;
  select count(*) into n_wa from wa_conversacion where tenant_id = v_t;
  select count(*) into n_llm from llm_costo where tenant_id = v_t;
  select count(*) into n_xml from cfdi_xml where tenant_id = v_t;
  select count(*) into n_cola from cfdi_consolidado_linea where tenant_id = v_t;
  select count(*) into n_tenant_visibles from tenant where id = v_t;

  -- Editar el tenant (rfc/politica de la flota) tiene que tocar CERO filas:
  -- `tenant_self` ahora es for select, no hay policy de escritura.
  update tenant set rfc = 'XAXX010101000' where id = v_t;
  GET DIAGNOSTICS n_tenant_updated = ROW_COUNT;

  reset role;

  -- ── Regresión: el flota_admin sigue viendo a su flota ──────────────────
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  select count(*) into n_admin_operador from operador where tenant_id = v_t;
  reset role;

  delete from tenant where id = v_t;   -- cascade limpia el resto
  raise exception E'RLS_0078  operador=% terminal=% politica=% wa=% llm=% cfdi_xml=% cola=% tenant-update=% tenant-select=% admin-ve-operador=%   (esperado 0/0/0/0/0/0/0/0/1/2)',
    n_operador, n_terminal, n_politica, n_wa, n_llm, n_xml, n_cola, n_tenant_updated, n_tenant_visibles, n_admin_operador;
end $$;

-- ── 55. Las ESCRITURAS del chofer y la familia de la 0079 (migs. 0078+0079) ─
-- El bloque 54 probó las lecturas del chofer en cero; este prueba las
-- ESCRITURAS —el escenario titular de la 0078 (modificar teléfonos de la
-- flota) que el 54 no ejercitaba— y la 0079: el chofer ya no lee `app_user`
-- de su flota ni inserta en `bitacora_auditoria`. Un UPDATE del chofer sobre
-- `operador` de SU flota tiene que tocar CERO filas; un UPDATE de su propio
-- `app_user` (cambiarse el operador_id para robar identidad) también; un
-- INSERT en `bitacora_auditoria` tiene que rebotar; y la lectura de
-- `app_user` ajena da 0. El flota_admin sigue insertando bitácora (regresión).
--
-- Corrida real esperada:
--   update-operador=0  update-app_user=0  insert-bitacora=f
--   lee-app_user-ajeno=0  admin-inserta-bitacora=t
do $$
declare
  v_t uuid; v_o1 uuid; v_o2 uuid; v_v uuid; v_u1 uuid := gen_random_uuid(); v_admin uuid := gen_random_uuid();
  n_operador_updated int; n_self_updated int; n_appuser_visibles int;
  bitacora_chofer_ok boolean := false; bitacora_admin_ok boolean := false;
begin
  insert into tenant (nombre) values ('ZZZ VERIF RLS 0079 '||gen_random_uuid()) returning id into v_t;
  insert into operador (tenant_id, nombre, telefono) values (v_t, 'Chofer Uno', '520000009060') returning id into v_o1;
  insert into operador (tenant_id, nombre, telefono) values (v_t, 'Chofer Dos', '520000009061') returning id into v_o2;
  insert into viaje (tenant_id, operador_id) values (v_t, v_o1) returning id into v_v;
  insert into app_user (id, tenant_id, email, rol, operador_id)
    values (v_u1, v_t, 'zzz-verif-chofer2@likida.test', 'operador', v_o1);
  insert into app_user (id, tenant_id, email, rol)
    values (v_admin, v_t, 'zzz-verif-admin2@likida.test', 'flota_admin');

  -- ── El chofer, impersonado ─────────────────────────────────────────────
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_u1)::text, true);

  -- El escenario titular de la 0078: modificar el teléfono de un compañero.
  update operador set telefono = '520000009099' where tenant_id = v_t;
  GET DIAGNOSTICS n_operador_updated = ROW_COUNT;

  -- Robo de identidad por la puerta de la app: ligar su cuenta a OTRO operador.
  update app_user set operador_id = v_o2 where id = v_u1;
  GET DIAGNOSTICS n_self_updated = ROW_COUNT;

  -- Ya no lee a los usuarios de su flota (0079).
  select count(*) into n_appuser_visibles from app_user where tenant_id = v_t;

  -- Ya no siembra la bitácora (0079).
  begin
    insert into bitacora_auditoria (tenant_id, accion, entidad, entidad_id, detalle, actor_email)
      values (v_t, 'flota.politica.cambiada', 'tenant', v_t, '{"tope_diesel":20000}'::jsonb, 'zzz@likida.test');
    bitacora_chofer_ok := true;
  exception when insufficient_privilege then bitacora_chofer_ok := false;
  end;

  reset role;

  -- ── Regresión: el flota_admin sigue insertando su bitácora ─────────────
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  begin
    insert into bitacora_auditoria (tenant_id, accion, entidad, entidad_id, detalle, actor_email)
      values (v_t, 'flota.politica.cambiada', 'tenant', v_t, '{"tope_diesel":15000}'::jsonb, 'zzz-admin@likida.test');
    bitacora_admin_ok := true;
  exception when others then bitacora_admin_ok := false;
  end;
  reset role;

  delete from tenant where id = v_t;
  raise exception E'RLS_0079  update-operador=% update-app_user=% insert-bitacora=% lee-app_user-ajeno=% admin-inserta-bitacora=%   (esperado 0/0/f/0/t)',
    n_operador_updated, n_self_updated, bitacora_chofer_ok, n_appuser_visibles, bitacora_admin_ok;
end $$;
