\set ON_ERROR_STOP on
-- 0656 + 0657 — EDICIÓN DE CONVENIOS EN PANTALLA (P7 «convenios-edicion»). Datos sintéticos; termina en rollback.
--
-- Lo que SOLO la base puede demostrar, contra Postgres real:
--   (a) la versión del convenio sube sola en cada UPDATE (también el del importador y el de archivar);
--   (b) guardar_convenio crea (con sus instrucciones) y devuelve la versión; editar con la versión vigente funciona y con
--       una vieja devuelve `conflicto` SIN escribir nada;
--   (c) la lista de instrucciones se REEMPLAZA entera en la misma transacción (las que ya no vienen se borran, la repetida
--       es una, `null` = no tocarlas, `[]` = dejarlas vacías);
--   (d) un fallo a medias revierte TODO (una instrucción inválida no deja el convenio a medio editar);
--   (e) nombre duplicado → `duplicado`; cliente o sitio de otra flota → `referencia_invalida`; convenio de otra flota →
--       `no_existe`; la edición no cambia el cliente;
--   (f) refrescar_viajes_de_convenio retoma la foto SOLO de los viajes no liquidados de ESE convenio que de verdad cambian,
--       con `p_reenviar` reabre el despacho de los que ya lo habían recibido y no toca el sello del acercamiento, es
--       idempotente y no cruza flotas;
--   (g) las dos funciones solo las ejecuta service_role.
begin;

insert into public.tenant (id, nombre) values
  ('65600000-0000-4000-8000-0000000000a1', 'Flota A 0656'),
  ('65600000-0000-4000-8000-0000000000b1', 'Flota B 0656');
insert into public.cliente (id, tenant_id, nombre) values
  ('65600000-0000-4000-8000-0000000000a2', '65600000-0000-4000-8000-0000000000a1', 'Cliente A'),
  ('65600000-0000-4000-8000-0000000000a6', '65600000-0000-4000-8000-0000000000a1', 'Cliente A2'),
  ('65600000-0000-4000-8000-0000000000b2', '65600000-0000-4000-8000-0000000000b1', 'Cliente B');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('65600000-0000-4000-8000-0000000000a3', '65600000-0000-4000-8000-0000000000a1', 'Chofer A', '525500006561'),
  ('65600000-0000-4000-8000-0000000000a9', '65600000-0000-4000-8000-0000000000a1', 'Chofer A2', '525500006562');
insert into public.geocerca (id, tenant_id, nombre, tipo, lat, lng, radio_m) values
  ('65600000-0000-4000-8000-0000000000a5', '65600000-0000-4000-8000-0000000000a1', 'Planta A', 'punto_interes', 20.72, -103.39, 300),
  ('65600000-0000-4000-8000-0000000000b5', '65600000-0000-4000-8000-0000000000b1', 'Planta B', 'punto_interes', 25.67, -100.31, 300);
insert into public.viaje (id, tenant_id, operador_id, folio, estatus, cliente_id) values
  ('65600000-0000-4000-8000-0000000000a4', '65600000-0000-4000-8000-0000000000a1', '65600000-0000-4000-8000-0000000000a3', 'A-1', 'abierto', '65600000-0000-4000-8000-0000000000a2'),
  ('65600000-0000-4000-8000-0000000000a7', '65600000-0000-4000-8000-0000000000a1', '65600000-0000-4000-8000-0000000000a9', 'A-2', 'abierto', '65600000-0000-4000-8000-0000000000a2'),
  ('65600000-0000-4000-8000-0000000000a8', '65600000-0000-4000-8000-0000000000a1', '65600000-0000-4000-8000-0000000000a3', 'A-3', 'liquidado', '65600000-0000-4000-8000-0000000000a2');

do $$
declare
  ta constant uuid := '65600000-0000-4000-8000-0000000000a1';
  tb constant uuid := '65600000-0000-4000-8000-0000000000b1';
  ca constant uuid := '65600000-0000-4000-8000-0000000000a2';
  ca2 constant uuid := '65600000-0000-4000-8000-0000000000a6';
  cb constant uuid := '65600000-0000-4000-8000-0000000000b2';
  sa constant uuid := '65600000-0000-4000-8000-0000000000a5';
  sb constant uuid := '65600000-0000-4000-8000-0000000000b5';
  r jsonb; conv uuid; v int; v0 int; n int; foto jsonb; rf record; cuantos int;
  ins1 constant jsonb := '[{"categoria":"puerta","texto":"Puerta 1","momento":"ambos","lugar":"origen","orden":1},
                           {"categoria":"reportarse","texto":"Con el guardia","momento":"acercamiento","lugar":"origen","orden":2}]';
begin
  -- (b) alta con instrucciones
  r := public.guardar_convenio(ta, null, ca, 'Ruta norte', 'Zapopan', 'Tlaquepaque', sa, null, null, null, 'nota', null, ins1);
  if r->>'estado' <> 'ok' or (r->>'creado')::boolean is not true then raise exception '0656(b): el alta debía ser ok y creada: %', r; end if;
  conv := (r->>'id')::uuid; v0 := (r->>'version')::int;
  select count(*) into n from public.convenio_instruccion where convenio_id = conv;
  if n <> 2 then raise exception '0656(b): el alta debía dejar 2 instrucciones, hay %', n; end if;

  -- (a) la versión sube sola con cualquier UPDATE
  update public.cliente_convenio set activo = false where id = conv;
  update public.cliente_convenio set activo = true where id = conv;
  select version into v from public.cliente_convenio where id = conv;
  if v <> v0 + 2 then raise exception '0656(a): la versión debía subir con cada UPDATE (era %, ahora %)', v0, v; end if;

  -- (b) versión vieja → conflicto y NO escribe
  r := public.guardar_convenio(ta, conv, null, 'Ruta norte 2', null, null, null, null, null, null, null, v0, '[]');
  if r->>'estado' <> 'conflicto' or (r->>'version')::int <> v then raise exception '0656(b): la versión vieja debía dar conflicto: %', r; end if;
  select count(*) into n from public.cliente_convenio where id = conv and nombre = 'Ruta norte';
  if n <> 1 then raise exception '0656(b): el conflicto no debía escribir'; end if;
  select count(*) into n from public.convenio_instruccion where convenio_id = conv;
  if n <> 2 then raise exception '0656(b): el conflicto no debía tocar las instrucciones'; end if;

  -- (b)+(c) versión vigente: edita y reemplaza la lista (una se queda con otro texto de momento, una nueva, una se va)
  r := public.guardar_convenio(ta, conv, null, 'Ruta norte', 'Zapopan', 'Tlaquepaque', sa, sa, null, null, 'nota 2', v,
    '[{"categoria":"puerta","texto":"Puerta 1","momento":"despacho","lugar":"origen","orden":5},
      {"categoria":"documentos","texto":"Carta porte","momento":"despacho","lugar":"ambos","orden":6},
      {"categoria":"documentos","texto":"Carta porte","momento":"ambos","lugar":"ambos","orden":7}]');
  if r->>'estado' <> 'ok' or (r->>'creado')::boolean then raise exception '0656(c): la edición debía ser ok: %', r; end if;
  select count(*) into n from public.convenio_instruccion where convenio_id = conv;
  if n <> 2 then raise exception '0656(c): debían quedar 2 (la puerta y UNA carta porte), hay %', n; end if;
  select count(*) into n from public.convenio_instruccion where convenio_id = conv and categoria = 'reportarse';
  if n <> 0 then raise exception '0656(c): la instrucción que ya no viene debía borrarse'; end if;
  select count(*) into n from public.convenio_instruccion where convenio_id = conv and texto = 'Puerta 1' and momento = 'despacho' and orden = 5;
  if n <> 1 then raise exception '0656(c): la instrucción repetida debía actualizarse, no duplicarse'; end if;
  select count(*) into n from public.cliente_convenio where id = conv and notas = 'nota 2' and destino_sitio_id = sa;
  if n <> 1 then raise exception '0656(c): los datos del convenio debían actualizarse'; end if;

  -- (c) null = no tocar la lista; [] = vaciarla
  v := (r->>'version')::int;
  r := public.guardar_convenio(ta, conv, null, 'Ruta norte', null, null, null, null, null, null, null, v, null);
  select count(*) into n from public.convenio_instruccion where convenio_id = conv;
  if r->>'estado' <> 'ok' or n <> 2 then raise exception '0656(c): null debía dejar la lista intacta (%, %)', r, n; end if;
  r := public.guardar_convenio(ta, conv, null, 'Ruta norte', null, null, null, null, null, null, null, (r->>'version')::int, '[]');
  select count(*) into n from public.convenio_instruccion where convenio_id = conv;
  if r->>'estado' <> 'ok' or n <> 0 then raise exception '0656(c): [] debía vaciar la lista (%, %)', r, n; end if;

  -- (d) una instrucción inválida a media lista revierte TODO (incluido el cambio de nombre)
  perform public.guardar_convenio(ta, conv, null, 'Ruta norte', null, null, null, null, null, null, null, (r->>'version')::int, ins1);
  select version into v from public.cliente_convenio where id = conv;
  r := public.guardar_convenio(ta, conv, null, 'Nombre que no debe quedar', null, null, null, null, null, null, null, v,
    '[{"categoria":"puerta","texto":"Buena"},{"categoria":"inventada","texto":"Mala"}]');
  if r->>'estado' <> 'invalida' then raise exception '0656(d): una categoría inventada debía dar invalida: %', r; end if;
  select count(*) into n from public.cliente_convenio where id = conv and nombre = 'Ruta norte' and version = v;
  if n <> 1 then raise exception '0656(d): el fallo debía revertir el cambio de nombre y la versión'; end if;
  select count(*) into n from public.convenio_instruccion where convenio_id = conv and texto = 'Buena';
  if n <> 0 then raise exception '0656(d): el fallo no debía dejar la instrucción buena a medias'; end if;
  select count(*) into n from public.convenio_instruccion where convenio_id = conv;
  if n <> 2 then raise exception '0656(d): el fallo debía conservar las 2 de antes, hay %', n; end if;

  -- (e) duplicado, referencias ajenas, convenio ajeno, el cliente no cambia
  r := public.guardar_convenio(ta, null, ca, 'Ruta norte', null, null, null, null, null, null, null, null, null);
  if r->>'estado' <> 'duplicado' then raise exception '0656(e): el mismo nombre del mismo cliente debía dar duplicado: %', r; end if;
  r := public.guardar_convenio(ta, null, ca2, 'Ruta norte', null, null, null, null, null, null, null, null, null);
  if r->>'estado' <> 'ok' then raise exception '0656(e): el mismo nombre en OTRO cliente sí es válido: %', r; end if;
  r := public.guardar_convenio(ta, null, cb, 'Con cliente ajeno', null, null, null, null, null, null, null, null, null);
  if r->>'estado' <> 'referencia_invalida' then raise exception '0656(e): un cliente de otra flota debía dar referencia_invalida: %', r; end if;
  r := public.guardar_convenio(ta, null, ca, 'Con sitio ajeno', null, null, sb, null, null, null, null, null, null);
  if r->>'estado' <> 'referencia_invalida' then raise exception '0656(e): un sitio de otra flota debía dar referencia_invalida: %', r; end if;
  select version into v from public.cliente_convenio where id = conv;
  r := public.guardar_convenio(tb, conv, null, 'Robado', null, null, null, null, null, null, null, v, null);
  if r->>'estado' <> 'no_existe' then raise exception '0656(e): el convenio de otra flota debía dar no_existe: %', r; end if;
  r := public.guardar_convenio(ta, conv, ca2, 'Ruta norte', null, null, null, null, null, null, null, v, null);
  select count(*) into n from public.cliente_convenio where id = conv and cliente_id = ca;
  if r->>'estado' <> 'ok' or n <> 1 then raise exception '0656(e): editar no debía cambiar el cliente (%, %)', r, n; end if;
  r := public.guardar_convenio(ta, null, ca, 'Vigencia mala', null, null, null, null, '2026-12-01', '2026-01-01', null, null, null);
  if r->>'estado' <> 'invalida' then raise exception '0656(e): una vigencia al revés debía dar invalida: %', r; end if;

  -- (f) refrescar_viajes_de_convenio
  select jsonb_agg(jsonb_build_object('categoria', categoria, 'texto', texto, 'momento', momento, 'lugar', lugar, 'orden', orden) order by orden, id)
    into foto from public.convenio_instruccion where convenio_id = conv;
  insert into public.viaje_convenio (viaje_id, tenant_id, convenio_id, cliente_id, instrucciones, despacho_enviado_en, despacho_canal, acercamiento_origen_enviado_en, acercamiento_origen_canal)
    values ('65600000-0000-4000-8000-0000000000a4', ta, conv, ca, '[{"categoria":"puerta","texto":"Vieja","momento":"ambos","lugar":"ambos","orden":0}]', now(), 'texto', now(), 'texto');
  insert into public.viaje_convenio (viaje_id, tenant_id, convenio_id, cliente_id, instrucciones)
    values ('65600000-0000-4000-8000-0000000000a7', ta, conv, ca, '[{"categoria":"puerta","texto":"Vieja","momento":"ambos","lugar":"ambos","orden":0}]');
  insert into public.viaje_convenio (viaje_id, tenant_id, convenio_id, cliente_id, instrucciones)
    values ('65600000-0000-4000-8000-0000000000a8', ta, conv, ca, '[{"categoria":"puerta","texto":"Vieja","momento":"ambos","lugar":"ambos","orden":0}]');

  select count(*) into cuantos from public.refrescar_viajes_de_convenio(ta, conv, false);
  select count(*) into n from public.refrescar_viajes_de_convenio(tb, conv, true);
  if n <> 0 then raise exception '0656(f): otra flota no debía refrescar el convenio (%)', n; end if;
  select count(*) into n from public.viaje_convenio where convenio_id = conv and instrucciones = foto;
  if cuantos <> 2 or n <> 2 then raise exception '0656(f): debían refrescarse los 2 abiertos y no el liquidado (cuantos %, con foto nueva %)', cuantos, n; end if;
  select count(*) into n from public.viaje_convenio where viaje_id = '65600000-0000-4000-8000-0000000000a4' and despacho_enviado_en is not null;
  if n <> 1 then raise exception '0656(f): sin p_reenviar el despacho no debía reabrirse'; end if;
  if (select count(*) from public.refrescar_viajes_de_convenio(ta, conv, true)) <> 0 then raise exception '0656(f): una segunda llamada no encuentra nada que cambiar (idempotente)'; end if;

  -- con p_reenviar: cambia el convenio de nuevo; el viaje ya despachado reabre SOLO el despacho, el acercamiento queda sellado
  select version into v from public.cliente_convenio where id = conv;
  perform public.guardar_convenio(ta, conv, null, 'Ruta norte', null, null, null, null, null, null, null, v,
    '[{"categoria":"puerta","texto":"Puerta 9","momento":"ambos","lugar":"ambos","orden":1}]');
  select count(*) filter (where reenviar), count(*) into n, cuantos from public.refrescar_viajes_de_convenio(ta, conv, true);
  if cuantos <> 2 or n <> 1 then raise exception '0656(f): 2 cambian y solo 1 (el ya despachado) reenvía (cambian %, reenvían %)', cuantos, n; end if;
  select * into rf from public.viaje_convenio where viaje_id = '65600000-0000-4000-8000-0000000000a4';
  if rf.despacho_enviado_en is not null or rf.despacho_canal is not null then raise exception '0656(f): el despacho debía quedar reabierto'; end if;
  if rf.acercamiento_origen_enviado_en is null then raise exception '0656(f): el sello del acercamiento NO debía tocarse'; end if;
  select count(*) into n from public.viaje_convenio where viaje_id = '65600000-0000-4000-8000-0000000000a8' and instrucciones::text like '%Vieja%';
  if n <> 1 then raise exception '0656(f): el viaje liquidado no debía refrescarse'; end if;
end $$;

-- (h) 0658 (adversarial ronda 10, ALTA): el viaje que nunca recibió el despacho porque su convenio no traía instrucciones de
-- despacho TAMBIÉN se marca para reenviar (si tiene operador y la foto nueva sí despacha); sin operador o sin despacho nuevo, no.
do $$
declare
  ta constant uuid := '65600000-0000-4000-8000-0000000000a1';
  ca constant uuid := '65600000-0000-4000-8000-0000000000a2';
  op constant uuid := '65600000-0000-4000-8000-000000000ab1';
  op2 constant uuid := '65600000-0000-4000-8000-000000000ab2';
  op3 constant uuid := '65600000-0000-4000-8000-000000000ab3';
  conv uuid; r jsonb; v int; n int; cuantos int;
  vcon constant uuid := '65600000-0000-4000-8000-000000000aa1';
  vsin constant uuid := '65600000-0000-4000-8000-000000000aa2';
  vacer constant uuid := '65600000-0000-4000-8000-000000000aa3';
begin
  r := public.guardar_convenio(ta, null, ca, 'Ruta 0658', null, null, null, null, null, null, null, null,
    '[{"categoria":"reportarse","texto":"Con el guardia","momento":"acercamiento","lugar":"origen","orden":1}]');
  conv := (r->>'id')::uuid;
  insert into public.operador (id, tenant_id, nombre, telefono) values (op, ta, 'Chofer H1', '525500006581'), (op2, ta, 'Chofer H2', '525500006582'), (op3, ta, 'Chofer H3', '525500006583');
  insert into public.viaje (id, tenant_id, operador_id, folio, estatus, cliente_id) values
    (vcon, ta, op, 'H-1', 'abierto', ca), (vsin, ta, op3, 'H-2', 'abierto', ca), (vacer, ta, op2, 'H-3', 'abierto', ca);
  insert into public.viaje_convenio (viaje_id, tenant_id, convenio_id, cliente_id, instrucciones) values
    (vcon, ta, conv, ca, '[]'),
    (vsin, ta, conv, ca, '[{"categoria":"puerta","texto":"Vieja","momento":"ambos","lugar":"origen","orden":0}]'),
    (vacer, ta, conv, ca, '[{"categoria":"reportarse","texto":"Con el guardia","momento":"acercamiento","lugar":"origen","orden":1}]');

  -- la edición agrega una instrucción de despacho
  select version into v from public.cliente_convenio where id = conv;
  perform public.guardar_convenio(ta, conv, null, 'Ruta 0658', null, null, null, null, null, null, null, v,
    '[{"categoria":"reportarse","texto":"Con el guardia","momento":"acercamiento","lugar":"origen","orden":1},
      {"categoria":"puerta","texto":"Puerta 9","momento":"despacho","lugar":"origen","orden":2}]');
  select count(*) filter (where reenviar), count(*) into n, cuantos from public.refrescar_viajes_de_convenio(ta, conv, true);
  if cuantos <> 3 or n <> 2 then raise exception '0658(h): cambian 3 y reenvían 2 (los que no tenían despacho en la foto vieja), no el que ya tenía despacho en la foto y sigue por su cuenta (cambian %, reenvían %)', cuantos, n; end if;
  if (select count(*) from public.refrescar_viajes_de_convenio(ta, conv, true)) <> 0 then raise exception '0658(h): idempotente'; end if;

  -- sin p_reenviar nada se marca; y si la foto nueva NO despacha, tampoco
  update public.viaje_convenio set instrucciones = '[]' where convenio_id = conv;
  if (select count(*) from public.refrescar_viajes_de_convenio(ta, conv, false) where reenviar) <> 0 then raise exception '0658(h): sin p_reenviar no se marca nada'; end if;
  update public.viaje_convenio set instrucciones = '[]' where convenio_id = conv;
  select version into v from public.cliente_convenio where id = conv;
  perform public.guardar_convenio(ta, conv, null, 'Ruta 0658', null, null, null, null, null, null, null, v,
    '[{"categoria":"reportarse","texto":"Con el guardia","momento":"acercamiento","lugar":"origen","orden":1}]');
  if (select count(*) from public.refrescar_viajes_de_convenio(ta, conv, true) where reenviar) <> 0 then raise exception '0658(h): una foto nueva sin despacho no marca reenvíos'; end if;
end $$;

-- (g) solo service_role ejecuta
do $$
begin
  if has_function_privilege('anon', 'public.guardar_convenio(uuid, uuid, uuid, text, text, text, uuid, uuid, date, date, text, integer, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.guardar_convenio(uuid, uuid, uuid, text, text, text, uuid, uuid, date, date, text, integer, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.refrescar_viajes_de_convenio(uuid, uuid, boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.refrescar_viajes_de_convenio(uuid, uuid, boolean)', 'execute') then
    raise exception '0656(g): anon/authenticated no deben ejecutar las funciones de edición de convenios';
  end if;
  if not has_function_privilege('service_role', 'public.guardar_convenio(uuid, uuid, uuid, text, text, text, uuid, uuid, date, date, text, integer, jsonb)', 'execute')
     or not has_function_privilege('service_role', 'public.refrescar_viajes_de_convenio(uuid, uuid, boolean)', 'execute') then
    raise exception '0656(g): service_role debía poder ejecutarlas';
  end if;
end $$;
rollback;
