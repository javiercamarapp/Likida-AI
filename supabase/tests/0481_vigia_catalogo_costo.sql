\set ON_ERROR_STOP on
-- 0481 — El Vigía en el catálogo de agentes y su fase de costo propia, contra Postgres REAL.
--
-- Lo que solo la base puede demostrar:
--   (a) `llm_costo_fase_dominio` (reescrito ENTERO) admite `vigia` y `conductor` y TODAS las de antes, y rechaza una inventada;
--   (b) el Vigía de servicio al cliente es una fila de `agente_definicion` con su rol de modelo, y NO pisó al `vigia` de leads;
--       el Agente 5 declara su rol en la fila `conductores`;
begin;

insert into public.tenant (id, nombre) values ('48100000-0000-4000-8000-0000000000a1', 'Flota A 0481');

-- (a) fases de costo
do $$ declare f text; begin
  foreach f in array array['ocr','cuadre','escalacion','chat','router','whatsapp','transcripcion','copiloto','runner','vigia','conductor'] loop
    insert into public.llm_costo (tenant_id, fase, modelo, tokens_in, tokens_out, costo_usd) values ('48100000-0000-4000-8000-0000000000a1', f, 'm', 1, 1, 0.0001);
  end loop;
  begin
    insert into public.llm_costo (tenant_id, fase, modelo, tokens_in, tokens_out, costo_usd) values ('48100000-0000-4000-8000-0000000000a1', 'inventada', 'm', 1, 1, 0.0001);
    raise exception '0481: llm_costo aceptó una fase inventada';
  exception when check_violation then null; end;
end $$;

-- (b) catálogo
do $$ begin
  if not exists (select 1 from public.agente_definicion where id = 'vigia_cliente' and modelo_rol = 'vigia_cliente' and departamento = 'exito_cliente' and disparador = 'whatsapp' and estado = 'vivo') then
    raise exception '0481: el Vigía de servicio al cliente no quedó en el catálogo con su rol';
  end if;
  if not exists (select 1 from public.agente_definicion where id = 'vigia' and departamento = 'leads') then
    raise exception '0481: se perdió el Vigía de leads fríos';
  end if;
  if not exists (select 1 from public.agente_definicion where id = 'conductores' and modelo_rol = 'conductor_hito') then
    raise exception '0481: el Agente 5 no declaró su rol de modelo';
  end if;
  if exists (select 1 from public.agente_definicion where id = 'vigia_cliente' and presupuesto_dia_usd is not null) then
    raise exception '0481: se declaró un tope de gasto que nadie decidió';
  end if;
end $$;

rollback;
\echo 0481_vigia_catalogo_costo: PASS
