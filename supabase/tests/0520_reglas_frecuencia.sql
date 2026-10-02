\set ON_ERROR_STOP on
-- 0520 — «MIS REGLAS»: límite de frecuencia e historial de avisos.
-- Lo que solo la base garantiza, con datos sintéticos propios (rollback):
--   (a) la CONFIRMACIÓN HUMANA es un CHECK (0229): sin confirmada_por/en una regla
--       no sale de 'pendiente', ni por UPDATE directo;
--   (b) el límite de frecuencia tiene rango (1..24 avisos/día, 0..168 h) y default;
--   (c) regla_aviso: dominio de resultado y de canal, coherencia canal↔resultado,
--       y la FK COMPUESTA: el aviso de una flota no cuelga de una regla de otra;
--   (d) borrar la regla se lleva su historial (cascade);
--   (e) RLS sin políticas: authenticated/anon no leen ni escriben; service_role sí.
begin;

insert into public.tenant (id, nombre) values
  ('52000000-0000-4000-8000-0000000000a1', 'Flota A 0520'),
  ('52000000-0000-4000-8000-0000000000b1', 'Flota B 0520');

insert into public.regla_vigilancia (id, tenant_id, plantilla, params, texto_original, frase)
values
  ('52000000-0000-4000-8000-0000000000c1', '52000000-0000-4000-8000-0000000000a1',
   'gasto_de_concepto_mayor_a', '{"concepto":"caseta","monto":3000}', 'avisa', 'Voy a avisarte…'),
  ('52000000-0000-4000-8000-0000000000c2', '52000000-0000-4000-8000-0000000000b1',
   'gasto_de_concepto_mayor_a', '{"concepto":"caseta","monto":3000}', 'avisa', 'Voy a avisarte…');

do $$
declare
  A constant uuid := '52000000-0000-4000-8000-0000000000a1';
  B constant uuid := '52000000-0000-4000-8000-0000000000b1';
  RA constant uuid := '52000000-0000-4000-8000-0000000000c1';
  RB constant uuid := '52000000-0000-4000-8000-0000000000c2';
  n int;
begin
  -- (b) defaults
  if (select max_avisos_dia from public.regla_vigilancia where id = RA) <> 4
     or (select min_horas_entre_avisos from public.regla_vigilancia where id = RA) <> 1 then
    raise exception '0520: los defaults de frecuencia no son 4/día y 1 h';
  end if;

  -- (a) la confirmación humana vive en la base
  begin
    update public.regla_vigilancia set estado = 'activa' where id = RA;
    raise exception '0520: una regla salió de pendiente SIN confirmación humana';
  exception when check_violation then null; end;
  begin
    update public.regla_vigilancia set estado = 'activa', confirmada_en = now() where id = RA;
    raise exception '0520: se activó con confirmada_en pero sin confirmada_por';
  exception when check_violation then null; end;

  -- (b) rangos del límite
  begin
    update public.regla_vigilancia set max_avisos_dia = 0 where id = RA;
    raise exception '0520: aceptó max_avisos_dia = 0';
  exception when check_violation then null; end;
  begin
    update public.regla_vigilancia set max_avisos_dia = 25 where id = RA;
    raise exception '0520: aceptó max_avisos_dia = 25';
  exception when check_violation then null; end;
  begin
    update public.regla_vigilancia set min_horas_entre_avisos = -1 where id = RA;
    raise exception '0520: aceptó min_horas_entre_avisos negativo';
  exception when check_violation then null; end;
  begin
    update public.regla_vigilancia set min_horas_entre_avisos = 169 where id = RA;
    raise exception '0520: aceptó min_horas_entre_avisos > 168';
  exception when check_violation then null; end;
  update public.regla_vigilancia set max_avisos_dia = 24, min_horas_entre_avisos = 0 where id = RA;
  update public.regla_vigilancia set max_avisos_dia = 1, min_horas_entre_avisos = 168 where id = RA;

  -- (c) regla_aviso: filas válidas
  insert into public.regla_aviso (tenant_id, regla_id, resultado, casos, via, motivo)
    values (A, RA, 'enviado', 2, 'plantilla', 'ventana_cerrada');
  insert into public.regla_aviso (tenant_id, regla_id, resultado, casos, error)
    values (A, RA, 'fallido', 1, 'La plantilla no está aprobada');

  -- dominio y coherencia
  begin
    insert into public.regla_aviso (tenant_id, regla_id, resultado, casos, via) values (A, RA, 'quizas', 1, 'texto');
    raise exception '0520: aceptó un resultado fuera de dominio';
  exception when check_violation then null; end;
  begin
    insert into public.regla_aviso (tenant_id, regla_id, resultado, casos, via) values (A, RA, 'enviado', 1, 'paloma');
    raise exception '0520: aceptó un canal fuera de dominio';
  exception when check_violation then null; end;
  begin
    insert into public.regla_aviso (tenant_id, regla_id, resultado, casos) values (A, RA, 'enviado', 1);
    raise exception '0520: un enviado sin canal';
  exception when check_violation then null; end;
  begin
    insert into public.regla_aviso (tenant_id, regla_id, resultado, casos, via) values (A, RA, 'fallido', 1, 'texto');
    raise exception '0520: un fallido con canal';
  exception when check_violation then null; end;
  begin
    insert into public.regla_aviso (tenant_id, regla_id, resultado, casos, via) values (A, RA, 'enviado', 0, 'texto');
    raise exception '0520: aceptó cero casos';
  exception when check_violation then null; end;

  -- la FK compuesta: el aviso de A no cuelga de la regla de B
  begin
    insert into public.regla_aviso (tenant_id, regla_id, resultado, casos, via) values (A, RB, 'enviado', 1, 'texto');
    raise exception '0520: un aviso de la flota A colgó de una regla de la flota B';
  exception when foreign_key_violation then null; end;

  -- (d) borrar la regla se lleva su historial
  insert into public.regla_aviso (tenant_id, regla_id, resultado, casos, via) values (B, RB, 'enviado', 1, 'texto');
  delete from public.regla_vigilancia where id = RB;
  select count(*) into n from public.regla_aviso where regla_id = RB;
  if n <> 0 then raise exception '0520: el historial sobrevivió al borrado de la regla (%)', n; end if;
  select count(*) into n from public.regla_aviso where regla_id = RA;
  if n <> 2 then raise exception '0520: el historial de A cambió (%)', n; end if;
end $$;

-- (e) RLS deny-all: authenticated no ve nada ni escribe; service_role sí
set local role authenticated;
do $$
declare n int;
begin
  begin
    select count(*) into n from public.regla_aviso;
    raise exception '0520: authenticated pudo leer regla_aviso';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.regla_aviso (tenant_id, regla_id, resultado, casos, via)
      values ('52000000-0000-4000-8000-0000000000a1', '52000000-0000-4000-8000-0000000000c1', 'enviado', 1, 'texto');
    raise exception '0520: authenticated pudo escribir regla_aviso';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role service_role;
do $$
declare n int;
begin
  select count(*) into n from public.regla_aviso where tenant_id = '52000000-0000-4000-8000-0000000000a1';
  if n <> 2 then raise exception '0520: service_role no ve su historial (%)', n; end if;
end $$;
reset role;

rollback;
select '0520_reglas_frecuencia OK' as resultado;
