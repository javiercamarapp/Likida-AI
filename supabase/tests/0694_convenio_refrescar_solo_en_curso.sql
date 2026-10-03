\set ON_ERROR_STOP on
-- 0694 — R10-1 (adversarial ronda 10): llevar la edición de un convenio a los viajes SOLO toca los viajes en curso (`abierto`).
-- Un viaje `en_cuadre` (ya entregó) o `liquidado` no recibe la foto nueva ni se le reabre el despacho: su operador no recibe
-- «actualizamos las instrucciones» de un viaje terminado. Datos sintéticos; termina en rollback.
begin;

insert into public.tenant (id, nombre) values ('69100000-0000-4000-8000-0000000000a1', 'Flota A 0694');
insert into public.cliente (id, tenant_id, nombre) values ('69100000-0000-4000-8000-0000000000a2', '69100000-0000-4000-8000-0000000000a1', 'Cliente A 0694');

do $$
declare
  ta constant uuid := '69100000-0000-4000-8000-0000000000a1';
  ca constant uuid := '69100000-0000-4000-8000-0000000000a2';
  op constant uuid := '69100000-0000-4000-8000-000000000ab1';
  op2 constant uuid := '69100000-0000-4000-8000-000000000ab2';
  op3 constant uuid := '69100000-0000-4000-8000-000000000ab3';
  v_abierto constant uuid := '69100000-0000-4000-8000-000000000aa1';
  v_cuadre constant uuid := '69100000-0000-4000-8000-000000000aa2';
  v_liquidado constant uuid := '69100000-0000-4000-8000-000000000aa3';
  conv uuid; r jsonb; v int; n int; reenvian int; vivos int;
  vieja constant jsonb := '[{"categoria":"puerta","texto":"Vieja","momento":"despacho","lugar":"origen","orden":0}]';
begin
  r := public.guardar_convenio(ta, null, ca, 'Ruta 0694', null, null, null, null, null, null, null, null, vieja);
  conv := (r->>'id')::uuid;
  insert into public.operador (id, tenant_id, nombre, telefono) values (op, ta, 'Chofer 0694', '525500069401'), (op2, ta, 'Chofer 0694 b', '525500069402'), (op3, ta, 'Chofer 0694 c', '525500069403');
  insert into public.viaje (id, tenant_id, operador_id, folio, estatus, cliente_id) values
    (v_abierto, ta, op, 'A-1', 'abierto', ca), (v_cuadre, ta, op2, 'A-2', 'en_cuadre', ca), (v_liquidado, ta, op3, 'A-3', 'liquidado', ca);
  insert into public.viaje_convenio (viaje_id, tenant_id, convenio_id, cliente_id, instrucciones, despacho_enviado_en, despacho_canal)
    select vv, ta, conv, ca, vieja, now(), 'texto' from unnest(array[v_abierto, v_cuadre, v_liquidado]) vv;

  select version into v from public.cliente_convenio where id = conv;
  perform public.guardar_convenio(ta, conv, null, 'Ruta 0694', null, null, null, null, null, null, null, v,
    '[{"categoria":"puerta","texto":"Puerta nueva","momento":"despacho","lugar":"origen","orden":0}]');

  select count(*) filter (where reenviar), count(*) into reenvian, vivos from public.refrescar_viajes_de_convenio(ta, conv, true);
  if vivos <> 1 or reenvian <> 1 then raise exception '0694: solo el viaje abierto debía refrescarse y reenviar (refrescados %, reenvían %)', vivos, reenvian; end if;
  select count(*) into n from public.viaje_convenio where viaje_id = v_abierto and instrucciones::text like '%Puerta nueva%' and despacho_enviado_en is null;
  if n <> 1 then raise exception '0694: el viaje abierto debía tener la foto nueva y el despacho reabierto'; end if;
  select count(*) into n from public.viaje_convenio where viaje_id in (v_cuadre, v_liquidado) and instrucciones::text like '%Vieja%' and despacho_enviado_en is not null;
  if n <> 2 then raise exception '0694: los viajes en cuadre y liquidado no debían tocarse (intactos: %)', n; end if;
end $$;

rollback;
