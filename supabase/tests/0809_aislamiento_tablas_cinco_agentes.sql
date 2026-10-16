\set ON_ERROR_STOP on
-- 0809 — aislamiento entre flotas de las 35 tablas creadas por las migraciones 0770–0804 (cinco agentes), contra Postgres REAL.
-- Complementa la auditoría estática de la capa 1 (que se auto-descubre) con un contrato EXPLÍCITO por tabla, para que
-- cambiar el modo de una tabla (deny-all ↔ lectura por flota) sea una decisión visible en el diff y no un descuido:
--   · DENY-ALL (17): RLS encendida y CERO políticas — solo service_role (BYPASSRLS) las toca.
--   · LECTURA POR FLOTA (18): RLS encendida y todas sus políticas son SELECT, con `tenant_id = ANY (get_user_tenant_ids())`
--     (o superadmin) en el USING y sin WITH CHECK — jamás una política que dé INSERT/UPDATE/DELETE a la app.
--   · Todas: columna tenant_id NOT NULL; anon (sin sesión) no lee ninguna fila; una sesión `authenticated` NO puede insertar
--     (el RLS/privilegio rebota con 42501 ANTES de cualquier restricción de columna: nunca llega a 23502).
-- Si una migración nueva crea una tabla y no se añade aquí, la capa 1 la sigue vigilando; si se añade aquí mal clasificada,
-- esta prueba la reprueba.
begin;

insert into public.tenant (id, nombre) values
  ('80900000-0000-4000-8000-0000000000a1', 'Flota A 0809'),
  ('80900000-0000-4000-8000-0000000000b1', 'Flota B 0809');
insert into public.app_user (id, tenant_id, email, rol) values
  ('80900000-0000-4000-8000-000000000401', '80900000-0000-4000-8000-0000000000a1', 'admin-0809@test.invalid', 'flota_admin');

create temp table _t0809 (tabla text primary key, modo text not null) on commit drop;
insert into _t0809 values
  ('cp_catalogo_parte', 'deny'), ('cp_catalogo_producto', 'deny'), ('cp_cliente_numero', 'deny'), ('cp_envio_tms', 'deny'),
  ('cp_salida_config', 'deny'),
  ('peaje_atipico', 'deny'), ('peaje_atipico_config', 'deny'), ('peaje_caseta_excepcion_unidad', 'deny'),
  ('peaje_caseta_nombre', 'deny'), ('peaje_cruce_justificado', 'deny'), ('peaje_reclamo', 'deny'),
  ('peaje_reclamo_nota', 'deny'), ('peaje_tag_baja', 'deny'),
  ('tenant_perfil', 'deny'), ('tms_ingesta', 'deny'), ('tms_mapeo', 'deny'), ('tms_sincronizacion', 'deny'),
  ('liquidacion_coordinador', 'lee'), ('liquidacion_correo_config', 'lee'), ('liquidacion_desglose', 'lee'),
  ('liquidacion_entrega_correo', 'lee'), ('liquidacion_excepcion', 'lee'), ('liquidacion_pull_estado', 'lee'),
  ('programa_despacho_cambio', 'lee'), ('programa_despacho_carga', 'lee'), ('programa_despacho_fila', 'lee'),
  ('sitio_equivalencia', 'lee'),
  ('vigia_aviso', 'lee'), ('vigia_aviso_config', 'lee'), ('vigia_caja', 'lee'), ('vigia_dato_viaje_manual', 'lee'),
  ('vigia_estatus_importacion', 'lee'), ('vigia_festivo', 'lee'), ('vigia_politica_datos', 'lee'),
  ('vigia_servicio_cliente', 'lee');
grant select on _t0809 to anon, authenticated;

do $$
declare
  r record; p record; n int;
begin
  select count(*) into n from _t0809;
  if n <> 35 then raise exception '0809: la lista debe tener 35 tablas (hay %)', n; end if;

  for r in select tabla, modo from _t0809 order by tabla loop
    if to_regclass('public.' || r.tabla) is null then raise exception '0809: la tabla % no existe', r.tabla; end if;
    if not (select relrowsecurity from pg_class where oid = ('public.' || r.tabla)::regclass) then
      raise exception '0809: % sin RLS', r.tabla;
    end if;
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = r.tabla and column_name = 'tenant_id' and is_nullable = 'NO') then
      raise exception '0809: % sin tenant_id NOT NULL', r.tabla;
    end if;

    select count(*) into n from pg_policies where schemaname = 'public' and tablename = r.tabla;
    if r.modo = 'deny' and n <> 0 then raise exception '0809: % es deny-all y tiene % política(s)', r.tabla, n; end if;
    if r.modo = 'lee' and n = 0 then raise exception '0809: % es de lectura por flota y no tiene política', r.tabla; end if;

    for p in select policyname, cmd, qual, with_check from pg_policies where schemaname = 'public' and tablename = r.tabla loop
      if p.cmd <> 'SELECT' then raise exception '0809: % tiene la política % para % (solo SELECT)', r.tabla, p.policyname, p.cmd; end if;
      if p.with_check is not null then raise exception '0809: % política % con WITH CHECK', r.tabla, p.policyname; end if;
      if p.qual is null or p.qual !~ 'tenant_id = ANY' or p.qual !~ 'get_user_tenant_ids' then
        raise exception '0809: % política % no filtra por get_user_tenant_ids(): %', r.tabla, p.policyname, p.qual;
      end if;
    end loop;
  end loop;
end $$;

-- anon (sin sesión): ninguna fila legible; sin privilegio también cuenta como negado.
set local role anon;
do $$ declare r record; n int;
begin
  for r in select tabla from pg_temp._t0809 order by tabla loop
    begin
      execute format('select count(*) from public.%I', r.tabla) into n;
      if n <> 0 then raise exception '0809: anon leyó % filas de %', n, r.tabla; end if;
    exception when insufficient_privilege then null; end;
  end loop;
end $$;
reset role;

-- authenticated de la flota A: no puede insertar en ninguna (ni en la suya). El rechazo debe ser 42501 (RLS o privilegio),
-- NO una restricción de columna: eso significaría que la política de escritura dejó pasar la fila.
set local role authenticated;
select set_config('request.jwt.claim.sub', '80900000-0000-4000-8000-000000000401', true);
do $$ declare r record;
begin
  for r in select tabla from pg_temp._t0809 order by tabla loop
    begin
      execute format('insert into public.%I (tenant_id) values (%L)', r.tabla, '80900000-0000-4000-8000-0000000000a1');
      raise exception '0809: authenticated insertó en %', r.tabla;
    exception
      when insufficient_privilege then null;
      when others then
        raise exception '0809: authenticated llegó a % (%) al insertar en % — el RLS no lo bloqueó antes', sqlstate, sqlerrm, r.tabla;
    end;
  end loop;
end $$;
reset role;

rollback;
