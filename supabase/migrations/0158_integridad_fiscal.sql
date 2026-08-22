-- ═══════════════════════════════════════════════════════════════════════════
-- 0158 — INTEGRIDAD FISCAL: el cierre atómico de verdad, el dinero que no se
--        borra ni se reedita, y los dominios que le faltaban a las columnas
--        que deciden un número fiscal.
--        (auditoría 18 «qué tira producción», rubro DATOS:
--         DAT-02, DAT-03, DAT-07, DAT-14, DAT-26, DAT-27, DAT-28, DAT-29,
--         DAT-30, DAT-36, DAT-39). IDEMPOTENTE: segura de re-correr.
--
-- NADA DE ESTE ARCHIVO SE APLICÓ A PRODUCCIÓN. Cada CHECK nuevo va precedido
-- de la consulta que CUENTA las filas que lo violarían, y la migración se
-- detiene diciendo cuántas son (patrón 0145): una restricción de dinero que
-- se aplica «a ver si pasa» es una que alguien va a quitar con prisa a media
-- noche. Si esta migración truena, el mensaje ya trae el número y la tabla.
--
-- ── 1 · DAT-02 + DAT-14 · EL CIERRE NO ERA ATÓMICO CONTRA LOS GASTOS ──────
--
-- `guardar_liquidacion_tx` (0013/0021) INSERTA la liquidación y DESPUÉS toca
-- `viaje`. La 0036 razonó bien —«tomar el candado del viaje obliga a esperar
-- al cierre»— pero el candado lo toma el TRIGGER DEL GASTO, no el cierre: la
-- transacción que cierra nunca bloquea el viaje antes de leer los gastos.
-- Entre `computeCuadre` (tools.ts:256), los dos PDF (:316) y el
-- `saveLiquidacion` (:321) pasan segundos, y las fotos NO toman el mutex del
-- viaje (processor.ts). Un diésel de $800 que entra en esa ventana queda
-- FUERA del PDF que se archiva y del que ve el operador, y huérfano para
-- siempre: el viaje ya está liquidado y la 0036 no deja meterlo después.
--
-- Se cierra con las dos piezas que faltaban, las dos dentro de la MISMA
-- transacción del cierre:
--   (a) `select … from viaje … for update` AL INICIO, con tenant. Serializa
--       contra el trigger de la 0036 —que toma el mismo candado— así que el
--       gasto tardío espera al cierre y rebota con su CU001, en vez de
--       colarse. Y `if not found` cierra DAT-14: la 0021 no comprobaba que
--       `p_viaje` fuera de `p_tenant`; el UPDATE final lo filtraba, pero el
--       INSERT de la liquidación ya había pasado, así que una liquidación de
--       la flota A podía escribirse contra el viaje de B (0 filas
--       actualizadas, cero ruido).
--   (b) `p_n_gastos`: el llamador dice CUÁNTOS comprobantes hay en la
--       fotografía que imprimió, y la base compara contra los que ve DENTRO
--       del candado. Si difieren, SQLSTATE CU003 y la transacción se cae
--       entera. El TS recalcula UNA vez (tools.ts) y vuelve a intentar: el
--       papel y la base siempre cuentan lo mismo, o no hay cierre.
--       `default null` = «no me lo digas, no lo compruebo», que es lo que
--       necesitan las llamadas posicionales viejas de verificaciones.sql.
--
-- ── 2 · DAT-03 · EL DINERO SE PODÍA BORRAR POR PostgREST ──────────────────
--
-- `viaje → gasto/liquidacion` es DELETE CASCADE (0001:60,70) y las policies
-- eran `for all`: un `contador` (o un `encargado`, antes de la 0146) hacía
-- DELETE /rest/v1/viaje?id=eq.… con su propia sesión y se llevaba por
-- delante los gastos Y la liquidación de un viaje ya cerrado, sin una sola
-- fila en `bitacora_auditoria` porque nunca pasó por la app. No hay
-- `deleted_at` ni papelera: el dato no vuelve.
--
-- Dos capas, a propósito:
--   · Las policies se PARTEN en select/insert/update. `for all` incluye
--     DELETE, y ninguna pantalla borra dinero: todo el borrado legítimo
--     (reabrirViaje, purgas, ARCO) corre con service role, que no pasa por
--     RLS. Sin política de DELETE, `authenticated` borra 0 filas.
--   · Un trigger BEFORE DELETE por si la policy vuelve a nacer `for all` —
--     que es EXACTAMENTE lo que pasó: la 0045 escribió policies finas y la
--     0086 las recreó `for all` de un `foreach` sin mirar. El trigger solo
--     frena a las sesiones de la app (`authenticated`/`anon`), nunca al
--     service role ni al superusuario: si frenara a todos, `delete from
--     tenant` (baja de cuenta, ARCO, limpieza de las cargas) reventaría al
--     cascada, y `reabrirViaje` —el camino auditado para deshacer un
--     cierre— dejaría de existir.
--
-- ── 3 · DAT-07 · LO QUE SEGUÍA SIENDO EDITABLE TRAS LIQUIDAR ──────────────
--
-- El `when` del trigger de la 0042 mira 6 columnas. `concepto` decide la
-- política de gasto y el tope; `forma_pago` decide el 28-V (efectivo) y el
-- estímulo del diésel; `clave_prod_serv` decide si un litro es diésel
-- acreditable; `cfdi_orden` decide qué caseta de un CFDI consolidado cuenta.
-- Un UPDATE de cualquiera de ellas después de emitida la liquidación
-- reescribe la base del papel archivado sin tocar el papel. Y `viaje`: el
-- `anticipo` es el MINUENDO de la diferencia («pusiste $650 de tu bolsa») y
-- `operador_id` es A QUIÉN se le cobra — los dos editables con el viaje ya
-- liquidado.
--
-- ── 4 · DAT-26 · `cfdi_uuid` DISTINGUÍA MAYÚSCULAS ────────────────────────
--
-- El SAT imprime el UUID en MAYÚSCULAS en el XML y en el PDF; el timbre lo
-- entrega igual. `uq_gasto_cfdi_uuid` y `factura_cfdi_unico` son índices
-- sobre `text`: el MISMO comprobante entra dos veces si una vez llega del
-- XML (mayúsculas) y otra del OCR o del portal (minúsculas). Dos veces el
-- mismo IVA acreditable. Se normaliza el dato existente y se fija la forma
-- con un CHECK, para que el índice único vuelva a significar lo que dice.
--
-- ── 5 · DAT-27 · CASCADE DONDE DEBÍA HABER FRENO ──────────────────────────
--
-- `factura_emitida → pago_recibido` y `cliente → tarifa` eran CASCADE: al
-- borrar una factura se iban SUS ABONOS (dinero que entró al banco y del que
-- no queda registro) y al borrar un cliente, su tarifario histórico.
--
-- NO ACTION y no RESTRICT, y la diferencia importa: RESTRICT se comprueba en
-- el acto y reventaría `delete from tenant` (baja de cuenta), donde factura y
-- pago son los dos hijos del MISMO tenant y ambos van a desaparecer en la
-- misma sentencia. NO ACTION comprueba al final de la sentencia — para
-- entonces los pagos ya se fueron por su propio cascade y el borrado de la
-- flota pasa limpio. Contra el caso que importa —borrar UNA factura que
-- tiene abonos— las dos se comportan igual: 23503 y no se borra nada.
--
-- ── 6 · DAT-28 · FECHAS SIN DOMINIO ───────────────────────────────────────
--
-- `fecha_fin < fecha_inicio` entraba (un viaje que termina antes de empezar
-- descuadra todo agregado por periodo), y `gasto.fecha` admitía cualquier
-- año: el OCR ha leído «0202» y «2024» en tickets de 2026. Lo IMPOSIBLE se
-- rechaza aquí; lo SOSPECHOSO —una fecha de ayer fuera de la ventana del
-- viaje— lo sigue marcando `fecha_dudosa.ts`, que pide otra foto en vez de
-- perder el comprobante. No se confunden los dos: un CHECK que rechace lo
-- meramente sospechoso convierte «te marco esto» en «perdí tu ticket».
--
-- ── 7 · DAT-29 · TABLAS QUE NO ERAN DE QUIEN LAS LEÍA ─────────────────────
--
-- `cfdi_xml` (el XML crudo, con RFC y domicilio fiscal), `llm_costo` (lo que
-- cuesta cada flota, dato de negocio de Likida) y `wa_conversacion` (el
-- historial de WhatsApp del chofer, dato personal LFPDPPP) colgaban de la
-- `tenant_data` genérica: cualquier rol de oficina con sesión los leía Y los
-- escribía por PostgREST. Los dos primeros pasan a `ve_finanzas()`, como
-- `gasto` (0146) y `liquidacion` (0144). `wa_conversacion` pasa a
-- deniega-todo: NINGUNA pantalla la lee con sesión (todo el intake y la
-- consola usan service role), así que no hay a quién dejar entrar. Y
-- `viaje_lock` —el mutex, que ya era deniega-todo por no tener policy— se le
-- retiran además los GRANT por defecto: RLS era su única puerta.
--
-- ── 8 · DAT-30 · `liquidacion.diferencias` sin forma ──────────────────────
--
-- `jsonb` a secas. Un `{}` o un `"texto"` en esa columna revienta
-- `kpis_liquidacion_tenant` (que hace `jsonb_array_elements`) y con él el
-- panel entero del contralor, no solo la fila mala.
--
-- ── 9 · DAT-36 · FOLIOS CON ESPACIOS Y CON DOS ORTOGRAFÍAS ────────────────
--
-- `viaje_folio_unico` (0092) y `factura_folio_unico` (0049) son únicos sobre
-- el texto crudo: «VJ-1 », «vj-1» y «VJ-1» son tres folios distintos para la
-- base y UNO SOLO para la flota. El import de TMS pega folios con espacio
-- final y el alta manual los teclea en minúsculas.
--
-- ── 10 · DAT-39 · LO QUE SE QUEDÓ A MEDIAS ────────────────────────────────
--
-- Dos CHECK `NOT VALID` permanentes (0099): Postgres los aplica a lo nuevo
-- pero nunca comprobó lo viejo, así que el catálogo no puede afirmar que la
-- tabla los cumpla. `incidencia.monto_estimado` (0107) sin `>= 0` — es un
-- monto que llega a un gasto. `agente_cobranza_config.tiers` sin forma: un
-- `{}` o un `[0]` deja al agente de cobranza sin insistir jamás, en silencio.
-- Y `get_user_tenant_ids`/`is_superadmin` (0001) con `search_path = public`
-- sin `pg_temp`: en una SECURITY DEFINER, `pg_temp` NO nombrado se busca
-- PRIMERO, y una tabla temporal `app_user` del atacante contesta por la real.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · DAT-02 + DAT-14 — el cierre toma el candado del viaje y cuenta gastos
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function guardar_liquidacion_tx(
  p_tenant uuid, p_viaje uuid, p_total_comprobado numeric, p_total_anticipo numeric,
  p_diferencia numeric, p_estatus text, p_diferencias jsonb, p_ieps numeric,
  p_iva numeric, p_peaje numeric, p_pdf_url text, p_litros_diesel numeric default 0,
  p_n_gastos integer default null
)
returns uuid
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
declare v_id uuid; v_viaje uuid; v_n int;
begin
  -- EL CANDADO, ANTES DE MIRAR NADA. No se usa el valor: se usa el candado.
  -- El trigger de la 0036 toma este MISMO candado antes de insertar un gasto,
  -- así que a partir de aquí ninguna foto puede entrar a este viaje sin
  -- esperar a que este cierre confirme (y entonces rebota con CU001).
  select id into v_viaje from viaje
   where id = p_viaje and tenant_id = p_tenant
   for update;

  -- DAT-14: el viaje TIENE que ser de esta flota. Antes, un p_viaje ajeno
  -- insertaba la liquidación y el UPDATE final no encontraba a quién tocar:
  -- cero filas, cero error, una liquidación colgada del viaje de otra flota.
  if not found then
    raise exception 'el viaje % no existe o no es de la flota %: no hay liquidación que emitir', p_viaje, p_tenant
      using errcode = 'CU002';
  end if;

  -- DAT-02: ¿el papel y la base cuentan los mismos comprobantes? Dentro del
  -- candado, así que la respuesta ya no puede cambiar en esta transacción.
  if p_n_gastos is not null then
    select count(*) into v_n from gasto where viaje_id = p_viaje;
    if v_n <> p_n_gastos then
      raise exception 'el viaje % tenía % comprobante(s) al calcular el cuadre y ahora tiene %: el PDF y la base contarían distinto', p_viaje, p_n_gastos, v_n
        using errcode = 'CU003';
    end if;
  end if;

  insert into liquidacion (
    tenant_id, viaje_id, total_comprobado, total_anticipo, diferencia,
    estatus, diferencias, ieps_acreditable, iva_acreditable, peaje_acreditable,
    pdf_url, litros_diesel_acreditables
  ) values (
    p_tenant, p_viaje, p_total_comprobado, p_total_anticipo, p_diferencia,
    p_estatus, p_diferencias, p_ieps, p_iva, p_peaje, p_pdf_url, p_litros_diesel
  )
  on conflict (viaje_id) do update set
    total_comprobado  = excluded.total_comprobado,
    total_anticipo    = excluded.total_anticipo,
    diferencia        = excluded.diferencia,
    estatus           = excluded.estatus,
    diferencias       = excluded.diferencias,
    ieps_acreditable  = excluded.ieps_acreditable,
    iva_acreditable   = excluded.iva_acreditable,
    peaje_acreditable = excluded.peaje_acreditable,
    litros_diesel_acreditables = excluded.litros_diesel_acreditables,
    -- Un re-cierre que todavía no generó el PDF no puede borrar el que ya había.
    pdf_url           = coalesce(excluded.pdf_url, liquidacion.pdf_url)
  returning id into v_id;

  update viaje set estatus = 'liquidado' where id = p_viaje and tenant_id = p_tenant;
  return v_id;
end $$;

-- La firma vieja SE VA en la misma migración: `create or replace` con una
-- lista de parámetros distinta no reemplaza, SOBRECARGA — y con dos vivas,
-- toda llamada posicional falla con «is not unique» y NINGUNA liquidación
-- cierra. Es la lección literal de la 0022 y la que vigila el bloque 5 de
-- verificaciones.sql.
drop function if exists public.guardar_liquidacion_tx(uuid, uuid, numeric, numeric, numeric, text, jsonb, numeric, numeric, numeric, text, numeric);

revoke all on function guardar_liquidacion_tx(uuid, uuid, numeric, numeric, numeric, text, jsonb, numeric, numeric, numeric, text, numeric, integer) from public, anon, authenticated;

comment on function guardar_liquidacion_tx(uuid, uuid, numeric, numeric, numeric, text, jsonb, numeric, numeric, numeric, text, numeric, integer) is
  'Cierre atómico. Toma `for update` del viaje ANTES de leer nada (serializa contra el trigger de la 0036), exige que el viaje sea de la flota (DAT-14) y, si el llamador dice cuántos comprobantes imprimió, exige que la base cuente lo mismo (CU003, DAT-02). p_n_gastos NULL = sin comprobación, para las llamadas posicionales viejas.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · DAT-03 — el dinero no se borra desde una sesión de la app
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 2.a · Las policies, partidas: select/insert/update, nunca delete ───────
-- `gasto` y `liquidacion` mantienen su compuerta de dinero (ve_finanzas);
-- `viaje` mantiene la suya de flota. Lo único que se pierde es el DELETE.
do $$
declare r record;
begin
  for r in select * from (values
      ('gasto',       'tenant_finanzas', '(tenant_id = any (get_user_tenant_ids()) and ve_finanzas()) or is_superadmin()'),
      ('liquidacion', 'tenant_finanzas', '(tenant_id = any (get_user_tenant_ids()) and ve_finanzas()) or is_superadmin()'),
      ('viaje',       'tenant_data',     'tenant_id = any (get_user_tenant_ids()) or is_superadmin()')
    ) as t(tabla, nombre, regla)
  loop
    execute format('drop policy if exists %I on public.%I', r.nombre, r.tabla);
    execute format('drop policy if exists %I on public.%I', r.nombre || '_select', r.tabla);
    execute format('drop policy if exists %I on public.%I', r.nombre || '_insert', r.tabla);
    execute format('drop policy if exists %I on public.%I', r.nombre || '_update', r.tabla);

    execute format('create policy %I on public.%I for select using (%s)',
                   r.nombre || '_select', r.tabla, r.regla);
    execute format('create policy %I on public.%I for insert with check (%s)',
                   r.nombre || '_insert', r.tabla, r.regla);
    execute format('create policy %I on public.%I for update using (%s) with check (%s)',
                   r.nombre || '_update', r.tabla, r.regla, r.regla);
  end loop;
end $$;

comment on policy tenant_finanzas_select on public.gasto is
  'Partida en select/insert/update por la 0158 (DAT-03): `for all` incluía DELETE y ninguna pantalla borra gastos — el borrado legítimo (reabrirViaje, purgas, ARCO) corre con service role y no pasa por RLS.';

-- ── 2.b · El trigger, por si la policy vuelve a nacer `for all` ────────────
-- SECURITY DEFINER porque tiene que VER la liquidación aunque la sesión que
-- borra no pueda (un `encargado` no pasa `ve_finanzas()`: sin definer, el
-- `exists` daría false y el trigger dejaría pasar justo al atacante).
-- El rol se lee del GUC `role` —que `set role` fija y que la definer NO
-- cambia— con `current_user` de respaldo para el caso invoker.
create or replace function borrado_de_dinero_prohibido()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare v_rol text; v_viaje uuid; v_ya boolean;
begin
  v_rol := coalesce(nullif(current_setting('role', true), 'none'), current_user);
  -- service_role, el dueño y el superusuario pasan: son los caminos auditados
  -- (reabrirViaje), las purgas de retención y el cascade de `delete from
  -- tenant` que ejecuta una baja de cuenta.
  if v_rol not in ('authenticated', 'anon') then
    return old;
  end if;

  if tg_table_name = 'liquidacion' then
    raise exception 'la liquidación % no se borra desde una sesión de la app: reabrir el viaje es el camino auditado y deja rastro', old.id
      using errcode = 'CU004';
  end if;

  v_viaje := case tg_table_name when 'viaje' then old.id else old.viaje_id end;
  select exists (select 1 from liquidacion where viaje_id = v_viaje) into v_ya;
  if v_ya then
    raise exception 'el viaje % ya tiene liquidación emitida: no se puede borrar su % desde una sesión de la app', v_viaje, tg_table_name
      using errcode = 'CU004';
  end if;
  return old;
end $$;

-- SECURITY DEFINER + `proacl` por defecto = ejecutable por PUBLIC, que es lo
-- que el bloque 76 (0098) y la capa 1 estática vigilan desde la 0054. Un
-- trigger NO necesita el EXECUTE en tiempo de disparo —Postgres lo comprueba
-- al CREAR el trigger—, así que revocarlo no lo desarma.
revoke all on function borrado_de_dinero_prohibido() from public, anon, authenticated;

comment on function borrado_de_dinero_prohibido() is
  'Segunda capa de DAT-03 (0158). La primera son las policies sin DELETE; ésta cubre el día que alguien recree una `for all` de un foreach —que es lo que hizo la 0086 con las policies finas de la 0045—. Solo frena a authenticated/anon: si frenara a todos, el cascade de `delete from tenant` y `reabrirViaje` reventarían.';

drop trigger if exists trg_no_borrar_gasto on gasto;
create trigger trg_no_borrar_gasto
  before delete on gasto for each row execute function borrado_de_dinero_prohibido();

drop trigger if exists trg_no_borrar_viaje on viaje;
create trigger trg_no_borrar_viaje
  before delete on viaje for each row execute function borrado_de_dinero_prohibido();

drop trigger if exists trg_no_borrar_liquidacion on liquidacion;
create trigger trg_no_borrar_liquidacion
  before delete on liquidacion for each row execute function borrado_de_dinero_prohibido();


-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · DAT-07 — lo que ya no se reedita después de liquidar
-- ═══════════════════════════════════════════════════════════════════════════

-- Las cuatro columnas que faltaban en el `when` de la 0042. MISMA función y
-- MISMO trigger: no hace falta uno nuevo (misma decisión que la 0042).
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
  )
  execute function gasto_no_tras_liquidar();

-- El viaje: el anticipo es el minuendo de la diferencia y operador_id es a
-- quién se le cobra. Función propia (la de la 0036 mira `new.viaje_id`, que
-- aquí no existe) y SQLSTATE propio: esto no es «tu foto llegó tarde», es
-- «esta fila ya se convirtió en un papel».
create or replace function viaje_no_tras_liquidar()
returns trigger
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
declare ya boolean;
begin
  select exists (select 1 from liquidacion where viaje_id = new.id) into ya;
  if ya then
    raise exception 'el viaje % ya tiene liquidación emitida: su anticipo y su operador son la base de ese papel y no se reeditan', new.id
      using errcode = 'CU004';
  end if;
  return new;
end $$;

comment on function viaje_no_tras_liquidar() is
  'DAT-07 (0158). `anticipo` es el minuendo de `diferencia` («pusiste $650 de tu bolsa») y `operador_id` es a quién se le cobra: editarlos con la liquidación ya emitida cambia la base del PDF archivado sin tocar el PDF.';

drop trigger if exists trg_viaje_no_tras_liquidar on viaje;
create trigger trg_viaje_no_tras_liquidar
  before update of anticipo, operador_id on viaje
  for each row
  when (new.anticipo is distinct from old.anticipo or new.operador_id is distinct from old.operador_id)
  execute function viaje_no_tras_liquidar();


-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · DAT-26 — `cfdi_uuid` en minúsculas, en las cuatro tablas
-- ═══════════════════════════════════════════════════════════════════════════
-- `factura_saas` y `codigo_pendiente` quedan fuera a propósito: la primera es
-- la facturación de Likida a sus clientes (un solo escritor, sin índice
-- cruzado con estas cuatro) y la segunda es una cola que se borra al
-- reclamarse. Ninguna de las dos participa del acreditamiento.
do $$
declare r record; n bigint; colisiones bigint;
begin
  for r in select * from (values
      ('gasto',             'gasto_cfdi_uuid_minuscula'),
      ('cfdi_xml',          'cfdi_xml_cfdi_uuid_minuscula'),
      ('factura_emitida',   'factura_emitida_cfdi_uuid_minuscula'),
      ('factura_proveedor', 'factura_proveedor_cfdi_uuid_minuscula')
    ) as t(tabla, nombre)
  loop
    if exists (select 1 from pg_constraint where conname = r.nombre) then
      continue;   -- idempotente
    end if;

    -- (a) ¿Bajar a minúsculas juntaría dos filas que hoy son distintas? Eso NO
    --     lo decide una migración: son dos registros del mismo CFDI y alguien
    --     tiene que mirar cuál se queda.
    execute format(
      'select count(*) from (select tenant_id, lower(cfdi_uuid) u
         from public.%I where cfdi_uuid is not null
        group by 1, 2 having count(*) > 1) x', r.tabla) into colisiones;
    if colisiones > 0 then
      raise exception
        'No se puede normalizar %.cfdi_uuid: hay % par(es) que solo se distinguen por MAYÚSCULAS. Es el mismo CFDI registrado dos veces (IVA acreditado dos veces). Decide cuál se queda antes de volver a aplicar.',
        r.tabla, colisiones;
    end if;

    -- (b) La normalización, idempotente.
    execute format(
      'update public.%I set cfdi_uuid = lower(cfdi_uuid) where cfdi_uuid is distinct from lower(cfdi_uuid)',
      r.tabla);

    -- (c) Y la cuenta de lo que aún violaría el CHECK, por si (b) no alcanzó.
    execute format(
      'select count(*) from public.%I where cfdi_uuid is not null and cfdi_uuid <> lower(cfdi_uuid)',
      r.tabla) into n;
    if n > 0 then
      raise exception 'No se puede fijar %.cfdi_uuid en minúsculas: quedan % fila(s) que no lo cumplen.', r.tabla, n;
    end if;

    execute format(
      'alter table public.%I add constraint %I check (cfdi_uuid is null or cfdi_uuid = lower(cfdi_uuid))',
      r.tabla, r.nombre);
  end loop;
end $$;

comment on constraint gasto_cfdi_uuid_minuscula on public.gasto is
  'El UUID se guarda SIEMPRE en minúsculas (0158, DAT-26). El SAT lo imprime en mayúsculas y el OCR lo lee en minúsculas: sin esta forma única, `uq_gasto_cfdi_uuid` deja entrar el mismo comprobante dos veces y su IVA se acredita dos veces.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 5 · DAT-27 — el abono no se va con la factura, ni la tarifa con el cliente
-- ═══════════════════════════════════════════════════════════════════════════
-- Se leen del catálogo (no por nombre) las FK CASCADE de esas dos relaciones
-- —la simple de la 0048/0049 y la compuesta con tenant de la 0145— y se
-- recrean con su MISMA definición cambiando la acción. Idempotente: en la
-- segunda corrida ya no hay ninguna con confdeltype='c' y el bucle no entra.
do $$
declare r record; def text;
begin
  for r in
    select c.conname, c.conrelid::regclass::text as tabla, pg_get_constraintdef(c.oid) as def
      from pg_constraint c
     where c.contype = 'f' and c.confdeltype = 'c'
       and ((c.conrelid = 'public.pago_recibido'::regclass and c.confrelid = 'public.factura_emitida'::regclass)
         or (c.conrelid = 'public.tarifa'::regclass       and c.confrelid = 'public.cliente'::regclass))
  loop
    def := replace(r.def, 'ON DELETE CASCADE', 'ON DELETE NO ACTION');
    execute format('alter table %s drop constraint %I', r.tabla, r.conname);
    execute format('alter table %s add constraint %I %s', r.tabla, r.conname, def);
  end loop;
end $$;

comment on constraint pago_recibido_factura_id_fkey on public.pago_recibido is
  'NO ACTION desde la 0158 (DAT-27): borrar una factura con abonos registrados rebota con 23503 en vez de llevarse el dinero que entró al banco. NO ACTION y no RESTRICT para que `delete from tenant` (baja de cuenta) siga funcionando: la comprobación es al final de la sentencia, cuando los pagos ya se fueron por su propio cascade.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 6 · DAT-28 — fechas con dominio (lo IMPOSIBLE, no lo sospechoso)
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare n bigint;
begin
  if not exists (select 1 from pg_constraint where conname = 'viaje_fechas_coherentes') then
    select count(*) into n from public.viaje
     where fecha_inicio is not null and fecha_fin is not null and fecha_fin < fecha_inicio;
    if n > 0 then
      raise exception 'No se puede aplicar viaje_fechas_coherentes: % viaje(s) terminan ANTES de empezar. Cada uno descuadra todo agregado por periodo. Corrígelos antes de volver a aplicar.', n;
    end if;
    alter table public.viaje add constraint viaje_fechas_coherentes
      check (fecha_inicio is null or fecha_fin is null or fecha_fin >= fecha_inicio);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'gasto_fecha_no_prehistorica') then
    select count(*) into n from public.gasto where fecha is not null and fecha < date '2000-01-01';
    if n > 0 then
      raise exception 'No se puede aplicar gasto_fecha_no_prehistorica: % gasto(s) con fecha anterior al año 2000 (el OCR ha leído «0202»). Revísalos antes de volver a aplicar.', n;
    end if;
    alter table public.gasto add constraint gasto_fecha_no_prehistorica
      check (fecha is null or fecha >= date '2000-01-01');
  end if;
end $$;

comment on constraint viaje_fechas_coherentes on public.viaje is
  'Un viaje no termina antes de empezar (0158, DAT-28). Sin esto, la fila entra y descuadra toda agregación por periodo — y nada la señala.';

-- El futuro no se puede poner en un CHECK: `current_date` es STABLE, no
-- IMMUTABLE, y Postgres rechaza la restricción. Va como trigger, con el
-- horizonte MUY holgado a propósito: un año. Lo que está entre mañana y ese
-- horizonte NO se rechaza —lo marca `fecha_dudosa.ts` como `fuera_de_rango` y
-- se le pide otra foto al operador—; lo que está más allá es un OCR roto, y
-- perder ese ticket es preferible a archivarlo con una fecha imposible.
create or replace function gasto_fecha_posible()
returns trigger
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
declare tope date;
begin
  if new.fecha is null then return new; end if;
  -- El día de México, no el UTC: a las 19:00 de Mérida, UTC ya es mañana.
  tope := ((now() at time zone 'America/Mexico_City')::date + 366);
  if new.fecha > tope then
    raise exception 'la fecha % del comprobante es imposible (más de un año en el futuro): revisa la lectura del ticket', new.fecha
      using errcode = 'CU005';
  end if;
  return new;
end $$;

drop trigger if exists trg_gasto_fecha_posible on gasto;
create trigger trg_gasto_fecha_posible
  before insert or update of fecha on gasto
  for each row execute function gasto_fecha_posible();


-- ═══════════════════════════════════════════════════════════════════════════
-- 7 · DAT-29 — cada tabla bajo el rol que le toca
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  -- El XML crudo y el costo de LLM son dinero/negocio: misma compuerta que
  -- gasto (0146) y liquidacion (0144). Partidas ya sin DELETE (DAT-03).
  foreach t in array array['cfdi_xml', 'llm_costo']
  loop
    execute format('drop policy if exists tenant_data on public.%I', t);
    execute format('drop policy if exists tenant_finanzas on public.%I', t);
    execute format('drop policy if exists tenant_finanzas_select on public.%I', t);
    execute format('drop policy if exists tenant_finanzas_insert on public.%I', t);
    execute format('drop policy if exists tenant_finanzas_update on public.%I', t);
    execute format($p$create policy tenant_finanzas_select on public.%I for select
      using ((tenant_id = any (get_user_tenant_ids()) and ve_finanzas()) or is_superadmin())$p$, t);
    execute format($p$create policy tenant_finanzas_insert on public.%I for insert
      with check ((tenant_id = any (get_user_tenant_ids()) and ve_finanzas()) or is_superadmin())$p$, t);
    execute format($p$create policy tenant_finanzas_update on public.%I for update
      using ((tenant_id = any (get_user_tenant_ids()) and ve_finanzas()) or is_superadmin())
      with check ((tenant_id = any (get_user_tenant_ids()) and ve_finanzas()) or is_superadmin())$p$, t);
  end loop;
end $$;

-- `wa_conversacion`: deniega-todo. No queda ninguna policy, y RLS activa sin
-- policy es «nadie con sesión». Verificado con grep antes de escribirlo:
-- conv.ts, asignar_wa.ts, despacho_wa.ts y la consola la leen TODAS con
-- service role (supabaseAdmin), que no pasa por RLS.
drop policy if exists tenant_data on public.wa_conversacion;
drop policy if exists tenant_finanzas on public.wa_conversacion;
alter table public.wa_conversacion enable row level security;
comment on table public.wa_conversacion is
  'Historial de WhatsApp del chofer (dato personal, LFPDPPP). DENIEGA-TODO desde la 0158 (DAT-29): RLS activa y CERO policies. Ninguna pantalla la lee con sesión; todo el intake y la consola usan service role.';

-- `viaje_lock`: ya era deniega-todo por no tener policy (0005), pero los
-- GRANT por defecto de Supabase seguían ahí y RLS era su única puerta. Dos
-- puertas cuestan lo mismo que una.
alter table public.viaje_lock enable row level security;
revoke all on table public.viaje_lock from anon, authenticated;
revoke all on table public.wa_conversacion from anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 8 · DAT-30 — `liquidacion.diferencias` es un arreglo o no es nada
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare n bigint;
begin
  if exists (select 1 from pg_constraint where conname = 'liquidacion_diferencias_arreglo') then
    return;
  end if;
  select count(*) into n from public.liquidacion
   where diferencias is not null and jsonb_typeof(diferencias) <> 'array';
  if n > 0 then
    raise exception 'No se puede aplicar liquidacion_diferencias_arreglo: % liquidación(es) tienen `diferencias` que no es un arreglo. Cada una revienta kpis_liquidacion_tenant y con él el panel entero. Revísalas antes de volver a aplicar.', n;
  end if;
  alter table public.liquidacion add constraint liquidacion_diferencias_arreglo
    check (diferencias is null or jsonb_typeof(diferencias) = 'array');
end $$;

comment on constraint liquidacion_diferencias_arreglo on public.liquidacion is
  'Un `{}` o un `"texto"` aquí revienta `jsonb_array_elements` en kpis_liquidacion_tenant, y con él TODO el panel del contralor — no solo la fila mala (0158, DAT-30).';


-- ═══════════════════════════════════════════════════════════════════════════
-- 9 · DAT-36 — folios sin espacios y con una sola ortografía
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare r record; n bigint; colisiones bigint;
begin
  for r in select * from (values
      ('viaje',           'viaje_folio_btrim',           'viaje_folio_upper_uidx'),
      ('factura_emitida', 'factura_emitida_folio_btrim', 'factura_emitida_folio_upper_uidx')
    ) as t(tabla, nombre, indice)
  loop
    if exists (select 1 from pg_constraint where conname = r.nombre) then
      continue;   -- idempotente
    end if;

    -- ¿Normalizar juntaría dos folios que hoy la base cree distintos? Son el
    -- mismo folio de la flota escrito de dos formas: lo decide un humano.
    execute format(
      'select count(*) from (select tenant_id, upper(btrim(folio)) f
         from public.%I where btrim(coalesce(folio, '''')) <> ''''
        group by 1, 2 having count(*) > 1) x', r.tabla) into colisiones;
    if colisiones > 0 then
      raise exception
        'No se puede normalizar %.folio: hay % grupo(s) de folios que solo se distinguen por espacios o mayúsculas. Para la flota son el MISMO folio. Decide cuál se queda antes de volver a aplicar.',
        r.tabla, colisiones;
    end if;

    -- Un folio de puros espacios NO es un folio: pasa a NULL, que es lo que
    -- ya significa «este viaje nació por WhatsApp, sin folio de TMS».
    execute format(
      'update public.%I set folio = nullif(btrim(folio), '''') where folio is distinct from nullif(btrim(folio), '''')',
      r.tabla);

    execute format(
      'select count(*) from public.%I where folio is not null and (folio <> btrim(folio) or folio = '''')',
      r.tabla) into n;
    if n > 0 then
      raise exception 'No se puede fijar %.folio sin espacios: quedan % fila(s) que no lo cumplen.', r.tabla, n;
    end if;

    execute format(
      'alter table public.%I add constraint %I check (folio is null or (folio = btrim(folio) and folio <> ''''))',
      r.tabla, r.nombre);

    execute format(
      'create unique index if not exists %I on public.%I (tenant_id, upper(folio)) where folio is not null',
      r.indice, r.tabla);
  end loop;
end $$;

comment on constraint viaje_folio_btrim on public.viaje is
  'El folio se guarda tal como se compara (0158, DAT-36). El import de TMS pega folios con espacio final: «VJ-1 » y «VJ-1» pasaban los dos por `viaje_folio_unico` y eran dos viajes para la base y uno para la flota.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 10 · DAT-39 — lo que se quedó a medias
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 10.a · Las dos NOT VALID permanentes de la 0099 ───────────────────────
-- Se validan SOLO si de verdad pasan; si no, se dice cuántas filas lo
-- impiden en vez de dejar la restricción mintiendo en el catálogo.
do $$
declare r record; n bigint;
begin
  for r in select * from (values
      ('unidad', 'unidad_peso_bruto_sano', 'peso_bruto_ton is not null and not (peso_bruto_ton > 0 and peso_bruto_ton < 100)'),
      ('viaje',  'viaje_ccp_radio_sano',   'ccp_radio_federal_km is not null and not (ccp_radio_federal_km >= 0 and ccp_radio_federal_km < 5000)')
    ) as t(tabla, nombre, violan)
  loop
    if not exists (select 1 from pg_constraint where conname = r.nombre and not convalidated) then
      continue;   -- ya validada (o no existe): idempotente
    end if;
    execute format('select count(*) from public.%I where %s', r.tabla, r.violan) into n;
    if n > 0 then
      raise exception 'No se puede validar %: % fila(s) de % la violan. Mientras siga NOT VALID el catálogo no puede afirmar que la tabla la cumpla.', r.nombre, n, r.tabla;
    end if;
    execute format('alter table public.%I validate constraint %I', r.tabla, r.nombre);
  end loop;
end $$;

-- ── 10.b · incidencia.monto_estimado ──────────────────────────────────────
do $$
declare n bigint;
begin
  if not exists (select 1 from pg_constraint where conname = 'incidencia_monto_estimado_no_negativo') then
    select count(*) into n from public.incidencia where monto_estimado is not null and monto_estimado < 0;
    if n > 0 then
      raise exception 'No se puede aplicar incidencia_monto_estimado_no_negativo: % incidencia(s) con monto negativo. Ese monto llega a un gasto (0107). Revísalas antes de volver a aplicar.', n;
    end if;
    alter table public.incidencia add constraint incidencia_monto_estimado_no_negativo
      check (monto_estimado is null or monto_estimado >= 0);
  end if;
end $$;

-- ── 10.c · agente_cobranza_config.tiers ───────────────────────────────────
-- Un CHECK no admite subconsultas: la forma se comprueba con una función
-- IMMUTABLE, que sí puede llevarlas dentro.
create or replace function tiers_de_cobranza_validos(p jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select jsonb_typeof(p) = 'array'
     and jsonb_array_length(p) > 0
     and not exists (
           select 1 from jsonb_array_elements(p) e
            where jsonb_typeof(e) <> 'number' or (e #>> '{}')::numeric <= 0
         );
$$;

comment on function tiers_de_cobranza_validos(jsonb) is
  'Los días a los que el agente insiste: arreglo NO vacío de números positivos (0158, DAT-39). Un `{}` o un `[0]` dejaban al agente sin insistir jamás, en silencio y sin una sola línea en los registros.';

do $$
declare n bigint;
begin
  if not exists (select 1 from pg_constraint where conname = 'agente_cobranza_tiers_sanos') then
    select count(*) into n from public.agente_cobranza_config where not tiers_de_cobranza_validos(tiers);
    if n > 0 then
      raise exception 'No se puede aplicar agente_cobranza_tiers_sanos: % flota(s) tienen `tiers` que no es un arreglo de números positivos. Esas flotas NO están cobrando y nadie se ha enterado. Revísalas antes de volver a aplicar.', n;
    end if;
    alter table public.agente_cobranza_config add constraint agente_cobranza_tiers_sanos
      check (tiers_de_cobranza_validos(tiers));
  end if;
end $$;

-- ── 10.d · `pg_temp` al final del search_path de las SECURITY DEFINER ──────
-- `set search_path = public` deja a `pg_temp` implícito y PRIMERO: una tabla
-- temporal `app_user` creada por el atacante contestaría en lugar de la real,
-- dentro de una función que corre como su dueño. Nombrarlo al final lo manda
-- al último lugar. Solo toca el atributo: los cuerpos no se reescriben.
alter function public.get_user_tenant_ids() set search_path = public, pg_temp;
alter function public.is_superadmin()       set search_path = public, pg_temp;
alter function public.ve_finanzas()         set search_path = public, pg_temp;
alter function public.administra_flota()    set search_path = public, pg_temp;
