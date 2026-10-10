\set ON_ERROR_STOP on
-- 0660 — «MIS REGLAS»: reclamo atómico ANTES de mandar, contra Postgres REAL (datos sintéticos, rollback).
-- Lo que solo la base garantiza:
--   (a) la llave nueva nace `enviando` con token y arriendo; las filas anteriores a la migración son `enviado`;
--   (b) quien pierde el insert no reclama nada (segunda llamada = cero llaves; mezcla = solo las nuevas);
--   (c) un arriendo vencido se retoma con OTRO token, y el token viejo ya no confirma ni libera;
--   (d) confirmar deja `enviado` sin token y lo sellado no se vuelve a reclamar;
--   (e) liberar borra solo lo que aún lleva ese token (rechazo de Meta) y la llave se puede reclamar de nuevo;
--   (f) una llave duplicada dentro del mismo lote no revienta; la FK compuesta impide reclamar con la flota equivocada;
--   (g) el CHECK de coherencia estado/token/arriendo y el dominio del estado;
--   (h) solo service_role ejecuta las tres funciones.
begin;

insert into public.tenant (id, nombre) values
  ('66000000-0000-4000-8000-0000000000a1', 'Flota A 0660'),
  ('66000000-0000-4000-8000-0000000000b1', 'Flota B 0660');
insert into public.regla_vigilancia (id, tenant_id, plantilla, params, texto_original, frase) values
  ('66000000-0000-4000-8000-0000000000c1', '66000000-0000-4000-8000-0000000000a1',
   'gasto_de_concepto_mayor_a', '{"concepto":"caseta","monto":3000}', 'avisa', 'Voy a avisarte…');
-- Un sello anterior a la migración (insertado sin las columnas nuevas): ya se mandó.
insert into public.regla_disparo (tenant_id, regla_id, objeto, objeto_id, clave, evidencia) values
  ('66000000-0000-4000-8000-0000000000a1', '66000000-0000-4000-8000-0000000000c1', 'gasto',
   '66000000-0000-4000-8000-0000000000f0', '', 'sello viejo');

set local role service_role;

do $$
declare
  A constant uuid := '66000000-0000-4000-8000-0000000000a1';
  B constant uuid := '66000000-0000-4000-8000-0000000000b1';
  R constant uuid := '66000000-0000-4000-8000-0000000000c1';
  k1 constant text := '66000000-0000-4000-8000-0000000000f1';
  k2 constant text := '66000000-0000-4000-8000-0000000000f2';
  k3 constant text := '66000000-0000-4000-8000-0000000000f3';
  k4 constant text := '66000000-0000-4000-8000-0000000000f4';
  k0 constant text := '66000000-0000-4000-8000-0000000000f0';
  lote3 jsonb;
  t1 uuid; t2 uuid; t3 uuid;
  n int; n1 int; n2 int;
begin
  -- (a) el sello anterior es 'enviado' sin token
  if (select count(*) from public.regla_disparo where regla_id = R and estado = 'enviado' and reclamo_token is null) <> 1 then
    raise exception '0660: el sello anterior a la migración no quedó enviado/sin token';
  end if;

  lote3 := jsonb_build_array(
    jsonb_build_object('objeto', 'gasto', 'objeto_id', k1, 'clave', '', 'evidencia', 'uno'),
    jsonb_build_object('objeto', 'gasto', 'objeto_id', k2, 'clave', '', 'evidencia', 'dos'),
    jsonb_build_object('objeto', 'gasto', 'objeto_id', k3, 'clave', '', 'evidencia', 'tres'),
    jsonb_build_object('objeto', 'gasto', 'objeto_id', k3, 'clave', '', 'evidencia', 'tres repetido'));

  -- (a)+(f) reclamo del lote: ganó 3 llaves (el repetido no revienta), todas con el mismo token
  select count(*), min(o_token::text)::uuid into n, t1 from public.reclamar_disparos_regla(A, R, lote3);
  if n <> 3 or t1 is null then raise exception '0660: el primer reclamo ganó % llaves (se esperaban 3)', n; end if;
  if (select count(*) from public.regla_disparo where regla_id = R and estado = 'enviando' and reclamo_token = t1 and reclamo_expira_en > now()) <> 3 then
    raise exception '0660: las llaves reclamadas no quedaron enviando con token y arriendo';
  end if;

  -- (b) el segundo reclamo del mismo lote no gana nada; la mezcla solo gana la nueva y NO el sello viejo
  select count(*) into n from public.reclamar_disparos_regla(A, R, lote3);
  if n <> 0 then raise exception '0660: un segundo reclamo ganó % llaves en vez de 0 (dos corridas mandarían doble)', n; end if;
  select count(*) into n from public.reclamar_disparos_regla(A, R, jsonb_build_array(
    jsonb_build_object('objeto', 'gasto', 'objeto_id', k1, 'clave', '', 'evidencia', 'uno'),
    jsonb_build_object('objeto', 'gasto', 'objeto_id', k4, 'clave', '', 'evidencia', 'cuatro'),
    jsonb_build_object('objeto', 'gasto', 'objeto_id', k0, 'clave', '', 'evidencia', 'sello viejo')));
  if n <> 1 then raise exception '0660: la mezcla ganó % llaves (solo la k4 era nueva)', n; end if;
  -- la k4 la libero para dejar el escenario simple
  perform public.liberar_disparos_regla(A, R, (select reclamo_token from public.regla_disparo where regla_id = R and objeto_id = k4::uuid));

  -- (c) el arriendo vence: otra corrida retoma las 3 con otro token; el token viejo ya no confirma ni libera
  select count(*), min(o_token::text)::uuid into n, t2 from public.reclamar_disparos_regla(A, R, lote3, 300, now() + interval '10 minutes');
  if n <> 3 or t2 = t1 then raise exception '0660: no se retomó el arriendo vencido (n=%, mismo token=%)', n, t2 = t1; end if;
  if public.confirmar_disparos_regla(A, R, t1) <> 0 then raise exception '0660: el token viejo confirmó llaves ajenas'; end if;
  if public.liberar_disparos_regla(A, R, t1) <> 0 then raise exception '0660: el token viejo liberó llaves ajenas'; end if;
  if (select count(*) from public.regla_disparo where regla_id = R and reclamo_token = t2) <> 3 then
    raise exception '0660: las llaves retomadas no pertenecen al token nuevo';
  end if;

  -- (d) confirmar: las 3 quedan enviado sin token; no se reclaman otra vez ni con el reloj adelantado
  if public.confirmar_disparos_regla(A, R, t2) <> 3 then raise exception '0660: confirmar no selló las 3 llaves'; end if;
  if (select count(*) from public.regla_disparo where regla_id = R and estado = 'enviado' and reclamo_token is null and reclamo_expira_en is null) <> 4 then
    raise exception '0660: tras confirmar deben ser 4 sellos enviado (3 + el viejo)';
  end if;
  select count(*) into n from public.reclamar_disparos_regla(A, R, lote3, 300, now() + interval '1 day');
  if n <> 0 then raise exception '0660: una llave ya enviada se volvió a reclamar (% llaves)', n; end if;
  if public.liberar_disparos_regla(A, R, t2) <> 0 then raise exception '0660: liberar borró un sello ya enviado'; end if;

  -- (e) rechazo de Meta: liberar borra solo lo del token y la llave se reclama de nuevo
  select count(*), min(o_token::text)::uuid into n, t3 from public.reclamar_disparos_regla(A, R, jsonb_build_array(
    jsonb_build_object('objeto', 'gasto', 'objeto_id', k4, 'clave', 'ciclo2', 'evidencia', 'cuatro')));
  if n <> 1 then raise exception '0660: no reclamó la llave nueva'; end if;
  if public.liberar_disparos_regla(A, R, t3) <> 1 then raise exception '0660: liberar no borró la llave reclamada'; end if;
  select count(*) into n from public.reclamar_disparos_regla(A, R, jsonb_build_array(
    jsonb_build_object('objeto', 'gasto', 'objeto_id', k4, 'clave', 'ciclo2', 'evidencia', 'cuatro')));
  if n <> 1 then raise exception '0660: la llave liberada no se pudo reclamar de nuevo'; end if;

  -- (f) la FK compuesta: reclamar con la flota equivocada falla
  begin
    perform public.reclamar_disparos_regla(B, R, jsonb_build_array(
      jsonb_build_object('objeto', 'gasto', 'objeto_id', k1, 'clave', 'otra', 'evidencia', 'x')));
    raise exception '0660: reclamó una llave de la regla de OTRA flota';
  exception when foreign_key_violation then null; end;
  -- lease fuera de rango
  begin
    perform public.reclamar_disparos_regla(A, R, lote3, 5);
    raise exception '0660: aceptó un arriendo de 5 s';
  exception when raise_exception then
    if sqlerrm like '0660:%' then raise; end if;
  end;

  -- (g) coherencia estado/token/arriendo y dominio
  begin
    update public.regla_disparo set estado = 'enviando', reclamo_token = null where regla_id = R and objeto_id = k1::uuid;
    raise exception '0660: aceptó enviando sin token';
  exception when check_violation then null; end;
  begin
    update public.regla_disparo set reclamo_token = gen_random_uuid() where regla_id = R and objeto_id = k1::uuid;
    raise exception '0660: aceptó enviado con token';
  exception when check_violation then null; end;
  begin
    update public.regla_disparo set estado = 'otro' where regla_id = R and objeto_id = k1::uuid;
    raise exception '0660: aceptó un estado inventado';
  exception when check_violation then null; end;
end $$;

-- (h) solo service_role
reset role;
set local role authenticated;
do $$
begin
  begin
    perform public.reclamar_disparos_regla('66000000-0000-4000-8000-0000000000a1', '66000000-0000-4000-8000-0000000000c1', '[]'::jsonb);
    raise exception '0660: authenticated ejecutó reclamar_disparos_regla';
  exception when insufficient_privilege then null; end;
  begin
    perform public.confirmar_disparos_regla('66000000-0000-4000-8000-0000000000a1', '66000000-0000-4000-8000-0000000000c1', gen_random_uuid());
    raise exception '0660: authenticated ejecutó confirmar_disparos_regla';
  exception when insufficient_privilege then null; end;
  begin
    perform public.liberar_disparos_regla('66000000-0000-4000-8000-0000000000a1', '66000000-0000-4000-8000-0000000000c1', gen_random_uuid());
    raise exception '0660: authenticated ejecutó liberar_disparos_regla';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

rollback;
