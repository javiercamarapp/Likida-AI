\set ON_ERROR_STOP on
-- 0844 — Candado del aviso "comercio sin adaptador" (fallback de autofactura), contra Postgres REAL.
-- Lo que solo la base garantiza:
--   (a) un gasto que ya existía nace con la columna nueva en NULL (no se inventa un valor);
--   (b) se puede marcar con una fecha (el "ya se avisó una vez") sin tocar NINGUNA otra columna del
--       gasto, en particular autofactura_bloqueada_en/autofactura_bloqueo (que son las que enrutar()
--       lee para el TEXTO del mensaje — este candado tiene que poder vivir sin pisarlas);
--   (c) la migración es idempotente (correrla otra vez no falla ni borra la marca ya puesta).
begin;

insert into public.tenant (id, nombre) values ('84400000-0000-4000-8000-0000000000a1', 'Flota A 0844');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('84400000-0000-4000-8000-0000000000e1', '84400000-0000-4000-8000-0000000000a1', 'OpA', '5210000008441');
insert into public.viaje (id, tenant_id, operador_id) values
  ('84400000-0000-4000-8000-0000000000f1', '84400000-0000-4000-8000-0000000000a1', '84400000-0000-4000-8000-0000000000e1');

set local role service_role;

do $$
declare
  A constant uuid := '84400000-0000-4000-8000-0000000000a1';
  V constant uuid := '84400000-0000-4000-8000-0000000000f1';
  g1 uuid;
  v_aviso timestamptz;
  v_bloqueada timestamptz;
  v_bloqueo text;
begin
  -- (a) nace NULL
  insert into public.gasto (tenant_id, viaje_id, concepto, monto) values (A, V, 'diesel', 500) returning id into g1;
  select autofactura_aviso_sin_robot_en into v_aviso from public.gasto where id = g1;
  if v_aviso is not null then raise exception '0844 a: un gasto nuevo nació con el candado puesto (%)', v_aviso; end if;

  -- (b) se marca sin tocar las columnas del bloqueo de verdad
  update public.gasto set autofactura_aviso_sin_robot_en = now() where id = g1;
  select autofactura_aviso_sin_robot_en, autofactura_bloqueada_en, autofactura_bloqueo
    into v_aviso, v_bloqueada, v_bloqueo
    from public.gasto where id = g1;
  if v_aviso is null then raise exception '0844 b1: la marca no se guardó'; end if;
  if v_bloqueada is not null or v_bloqueo is not null then
    raise exception '0844 b2: marcar el candado del fallback tocó autofactura_bloqueada_en/autofactura_bloqueo (% / %)', v_bloqueada, v_bloqueo;
  end if;
end $$;

-- (c) idempotente: repetir la migración no borra la marca ya puesta.
\i supabase/migrations/0844_gasto_aviso_sin_robot.sql

do $$
declare v timestamptz;
begin
  select autofactura_aviso_sin_robot_en into v
    from public.gasto
    where tenant_id = '84400000-0000-4000-8000-0000000000a1' and concepto = 'diesel';
  if v is null then raise exception '0844 c: la migración repetida borró la marca ya puesta'; end if;
end $$;

reset role;
rollback;
