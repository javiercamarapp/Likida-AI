\set ON_ERROR_STOP on
-- 0847 — Candado de idempotencia de `peaje_reclamo`, contra Postgres REAL (hallazgo alto de la
-- auditoría adversarial, 21-oct-2026). Lo que solo la base garantiza: un segundo reclamo ACTIVO
-- (no rechazado) por flota+desglose+categoría choca con 23505 en vez de crear una fila gemela;
-- un reclamo YA RECHAZADO no cuenta para el candado (se puede volver a reclamar); un `desglose_id`
-- en NULL (desglose anulado) nunca choca con otro NULL.
begin;

insert into public.tenant (id, nombre) values
  ('84700000-0000-4000-8000-0000000000a1', 'Flota A 0847');
insert into public.desglose_peaje (id, tenant_id, proveedor) values
  ('84700000-0000-4000-8000-0000000000a2', '84700000-0000-4000-8000-0000000000a1', 'Proveedor Ejemplo');

do $$
declare
  A constant uuid := '84700000-0000-4000-8000-0000000000a1';
  DA constant uuid := '84700000-0000-4000-8000-0000000000a2';
  r1 uuid; r2 uuid; r3 uuid; r4 uuid;
begin
  -- (a) el primer reclamo activo entra sin problema.
  insert into public.peaje_reclamo (id, tenant_id, desglose_id, categoria, fecha_cobro_mas_antiguo)
    values (gen_random_uuid(), A, DA, 'extemporaneo', '2026-09-01') returning id into r1;

  -- (b) un segundo reclamo ACTIVO de la MISMA flota+desglose+categoría choca.
  begin
    insert into public.peaje_reclamo (id, tenant_id, desglose_id, categoria, fecha_cobro_mas_antiguo)
      values (gen_random_uuid(), A, DA, 'extemporaneo', '2026-09-02');
    raise exception '0847 b: el segundo reclamo activo NO chocó — el candado no está funcionando';
  exception when unique_violation then null; end;

  -- (c) rechazar el primero LIBERA el candado: ahora sí se puede reclamar otra vez.
  update public.peaje_reclamo set estado = 'rechazado', enviado_en = '2026-09-03' where id = r1;
  insert into public.peaje_reclamo (id, tenant_id, desglose_id, categoria, fecha_cobro_mas_antiguo)
    values (gen_random_uuid(), A, DA, 'extemporaneo', '2026-09-04') returning id into r2;

  -- (d) con r2 activo, un tercero de la misma categoría vuelve a chocar.
  begin
    insert into public.peaje_reclamo (id, tenant_id, desglose_id, categoria, fecha_cobro_mas_antiguo)
      values (gen_random_uuid(), A, DA, 'extemporaneo', '2026-09-05');
    raise exception '0847 d: el candado no protegió tras liberarse y volver a ocuparse';
  exception when unique_violation then null; end;

  -- (e) otra CATEGORÍA del mismo desglose no choca (el candado es por categoría, no por desglose entero).
  insert into public.peaje_reclamo (id, tenant_id, desglose_id, categoria, fecha_cobro_mas_antiguo)
    values (gen_random_uuid(), A, DA, 'duplicado_exacto', '2026-09-06') returning id into r3;

  -- (f) desglose_id NULL (desglose anulado) nunca choca entre sí — dos reclamos con NULL son ambos activos.
  update public.peaje_reclamo set desglose_id = null where id = r2;
  insert into public.peaje_reclamo (id, tenant_id, desglose_id, categoria, fecha_cobro_mas_antiguo)
    values (gen_random_uuid(), A, null, 'extemporaneo', '2026-09-07') returning id into r4;
  if r4 is null then raise exception '0847 f: un desglose_id NULL chocó con otro NULL'; end if;
end $$;

rollback;
