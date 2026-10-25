\set ON_ERROR_STOP on
-- 0927 · A39-A5-01/04/06 contra Postgres REAL. Datos sintéticos; todo en una transacción que se revierte.
--   (a) una fila de config sin tocar las columnas nuevas nace con TODAS las perillas apagadas y la calibración en su valor de partida;
--   (b) los CHECK rechazan poleo fuera de 1–60, umbral de detención fuera de 5–720, cohorte fuera del catálogo, patio inválido y
--       jsonb que no es objeto;
--   (c) se guardan y se leen valores válidos.
begin;

insert into public.tenant (id, nombre) values ('92700000-0000-4000-8000-0000000000a1', 'Flota A 0927');

do $$
declare
  A constant uuid := '92700000-0000-4000-8000-0000000000a1';
  f record; n int;
begin
  insert into public.agente_conductor_config (tenant_id) values (A);
  select * into f from public.agente_conductor_config where tenant_id = A;
  if f.poleo_min is not null or f.poleo_por_clave_min is not null or f.cohorte_piloto is not null or f.detencion_escala_sin_respuesta_min is not null then
    raise exception '(a1) la calibración debía nacer sin valor';
  end if;
  if f.detenido_aviso_min <> 15 or f.estadia_descarga_sin_respuesta_min <> 30 or f.patio_que_manda <> 'entregar_en' then
    raise exception '(a2) valores de partida incorrectos';
  end if;
  if f.exigir_sello_inicio or f.patio_entrega_activo or f.estadia_descarga_interactiva or f.reporte_llegada_activo or f.constancia_reportes_activa
     or f.resultado_descarga_activo or f.pedir_documentos_cierre_activo or f.asignacion_botones_activa or f.gastos_etc_activa or f.deteccion_parada_activa then
    raise exception '(a3) toda perilla de la fase 2 debía nacer APAGADA (fail-closed)';
  end if;
  if f.estadia_descarga_min_por_cliente <> '{}'::jsonb then raise exception '(a4) umbrales por cliente debían nacer vacíos'; end if;

  -- (b) CHECK
  begin update public.agente_conductor_config set poleo_min = 0 where tenant_id = A; raise exception '(b1) poleo 0'; exception when check_violation then null; end;
  begin update public.agente_conductor_config set poleo_min = 61 where tenant_id = A; raise exception '(b2) poleo 61'; exception when check_violation then null; end;
  begin update public.agente_conductor_config set detenido_aviso_min = 4 where tenant_id = A; raise exception '(b3) aviso 4'; exception when check_violation then null; end;
  begin update public.agente_conductor_config set detenido_aviso_min = 721 where tenant_id = A; raise exception '(b4) aviso 721'; exception when check_violation then null; end;
  begin update public.agente_conductor_config set cohorte_piloto = 'todos' where tenant_id = A; raise exception '(b5) cohorte'; exception when check_violation then null; end;
  begin update public.agente_conductor_config set patio_que_manda = 'otro' where tenant_id = A; raise exception '(b6) patio'; exception when check_violation then null; end;
  begin update public.agente_conductor_config set poleo_por_clave_min = '[1,2]'::jsonb where tenant_id = A; raise exception '(b7) jsonb arreglo'; exception when check_violation then null; end;
  begin update public.agente_conductor_config set estadia_descarga_sin_respuesta_min = 4 where tenant_id = A; raise exception '(b8) espera 4'; exception when check_violation then null; end;
  begin update public.agente_conductor_config set detencion_escala_sin_respuesta_min = 3 where tenant_id = A; raise exception '(b9) escala 3'; exception when check_violation then null; end;

  -- (c) valores válidos
  update public.agente_conductor_config
     set poleo_min = 15, poleo_por_clave_min = '{"lenta": 15, "rapida": 2}'::jsonb, detenido_aviso_min = 20, cohorte_piloto = 'voluntarios_abiertos',
         deteccion_parada_activa = true, reporte_llegada_activo = true, patio_que_manda = 'destino',
         estadia_descarga_min_por_cliente = '{"11111111-1111-4111-8111-111111111111": 240}'::jsonb, detencion_escala_sin_respuesta_min = 30
   where tenant_id = A;
  select count(*) into n from public.agente_conductor_config
   where tenant_id = A and poleo_min = 15 and (poleo_por_clave_min ->> 'lenta')::int = 15 and detenido_aviso_min = 20
     and cohorte_piloto = 'voluntarios_abiertos' and deteccion_parada_activa and reporte_llegada_activo and patio_que_manda = 'destino'
     and detencion_escala_sin_respuesta_min = 30;
  if n <> 1 then raise exception '(c1) los valores válidos no se guardaron'; end if;
end $$;

rollback;
