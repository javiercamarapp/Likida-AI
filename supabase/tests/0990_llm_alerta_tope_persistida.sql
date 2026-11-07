\set ON_ERROR_STOP on
-- 0990 (CT-IA-01) — alertas de tope de IA persistidas: dedup por flota/día/nivel, uso del día por flota y retención.
-- Datos sintéticos; corre en ci-postgres tras todas las migraciones y termina en rollback.
begin;

insert into public.tenant (id, nombre) values
  ('99000000-0000-4000-8000-0000000000a1', 'Flota A 0990'),
  ('99000000-0000-4000-8000-0000000000b1', 'Flota B 0990');

do $$
declare
  a constant uuid := '99000000-0000-4000-8000-0000000000a1';
  b constant uuid := '99000000-0000-4000-8000-0000000000b1';
  hoy constant date := (now() at time zone 'America/Mexico_City')::date;
  r boolean; n int; u numeric; err text;
begin
  -- 1. La primera vez avisa; la segunda, desde cualquier "instancia", no.
  r := public.registrar_alerta_tope_llm(a, hoy, 80::smallint, 4.1, 5, 'piso');
  if r is not true then raise exception '0990(1): la primera alerta debia dar true, dio %', r; end if;
  r := public.registrar_alerta_tope_llm(a, hoy, 80::smallint, 4.3, 5, 'piso');
  if r is not false then raise exception '0990(1): la segunda alerta del mismo nivel/dia debia dar false, dio %', r; end if;

  -- 2. El otro nivel, otra flota y otro dia son alertas distintas.
  if public.registrar_alerta_tope_llm(a, hoy, 100::smallint, 5, 5, 'plan') is not true then raise exception '0990(2): el nivel 100 debia avisar'; end if;
  if public.registrar_alerta_tope_llm(b, hoy, 80::smallint, 8, 10, 'tenant') is not true then raise exception '0990(2): otra flota debia avisar'; end if;
  if public.registrar_alerta_tope_llm(a, hoy - 1, 80::smallint, 4, 5, 'piso') is not true then raise exception '0990(2): otro dia debia avisar'; end if;
  select count(*) into n from public.llm_alerta_tope where tenant_id in (a, b);
  if n <> 4 then raise exception '0990(2): esperaba 4 filas y hay %', n; end if;

  -- 3. Un origen desconocido no rompe: queda como piso.
  perform public.registrar_alerta_tope_llm(b, hoy, 100::smallint, 10, 10, 'inventado');
  select count(*) into n from public.llm_alerta_tope where tenant_id = b and nivel = 100 and origen_tope = 'piso';
  if n <> 1 then raise exception '0990(3): el origen inventado debia quedar como piso'; end if;

  -- 4. Argumentos invalidos LANZAN (no se confunden con "ya avisado").
  begin perform public.registrar_alerta_tope_llm(a, hoy, 50::smallint, 1, 5, 'piso'); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '0990(4): un nivel 50 debia lanzar'; end if; end;
  begin perform public.registrar_alerta_tope_llm(a, hoy, 80::smallint, 1, 0, 'piso'); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '0990(4): un tope 0 debia lanzar'; end if; end;
  begin perform public.registrar_alerta_tope_llm(null, hoy, 80::smallint, 1, 5, 'piso'); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '0990(4): una flota nula debia lanzar'; end if; end;

  -- 5. uso_llm_dia_por_flota: suma liquidado y reservado vivo de HOY; ignora vencidos y de ayer.
  insert into public.llm_presupuesto_reserva(id, tenant_id, run_id, reservado_usd, estado, proposito)
  values (gen_random_uuid(), a, gen_random_uuid(), 1.5, 'liquidado', 'interactivo'),
         (gen_random_uuid(), a, gen_random_uuid(), 0.5, 'reservado', 'interactivo');
  insert into public.llm_presupuesto_reserva(id, tenant_id, run_id, reservado_usd, estado, proposito, expira_en)
  values (gen_random_uuid(), a, gen_random_uuid(), 9, 'reservado', 'interactivo', now() - interval '1 hour');
  update public.llm_presupuesto_reserva set created_at = now() - interval '2 days'
   where tenant_id = a and reservado_usd = 9;
  select usado_usd into u from public.uso_llm_dia_por_flota(hoy) where tenant_id = a;
  if u is distinct from 2.0 then raise exception '0990(5): el uso de hoy debia ser 2.0 y dio %', u; end if;
  select count(*) into n from public.uso_llm_dia_por_flota(hoy) where tenant_id = b;
  if n <> 0 then raise exception '0990(5): una flota sin gasto no debia aparecer'; end if;

  -- 6. Purga: respeta el minimo y borra solo lo viejo.
  begin perform public.purgar_llm_alerta_tope(3); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '0990(6): una retencion de 3 dias debia lanzar'; end if; end;
  perform public.registrar_alerta_tope_llm(a, hoy - 200, 80::smallint, 4, 5, 'piso');
  n := public.purgar_llm_alerta_tope(90);
  if n <> 1 then raise exception '0990(6): debia purgar 1 fila vieja y purgo %', n; end if;

  -- 7. Solo service_role: un rol de aplicacion no puede ni leer ni llamar.
  begin
    set local role authenticated;
    perform public.registrar_alerta_tope_llm(a, hoy, 80::smallint, 1, 5, 'piso');
    reset role;
    raise exception 'authenticated pudo llamar';
  exception when insufficient_privilege then reset role;
  end;
end $$;

rollback;
