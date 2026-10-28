\set ON_ERROR_STOP on
-- 0932 — A1 por correo: un operador se da de alta solo con número de empleado y correo. Contra Postgres REAL, en una transacción
-- revertida. Demuestra: el marcador «sin-tel:…» entra (varios por flota), la forma del teléfono sigue exigida para todo lo demás, la
-- unicidad de teléfonos REALES no se debilitó (global entre activos y por flota) y el número de empleado es único entre los sin teléfono.
begin;

insert into public.tenant (id, nombre) values
  ('09320000-0000-4000-8000-0000000000a1', 'Flota 0932 A'),
  ('09320000-0000-4000-8000-0000000000b1', 'Flota 0932 B');

-- ── 1. Varios operadores SIN teléfono en la misma flota ─────────────────────
insert into public.operador (tenant_id, nombre, telefono, numero_empleado, correo) values
  ('09320000-0000-4000-8000-0000000000a1', 'Operador Uno', 'sin-tel:abcdefghijklmnopqrst', 'E-1', 'uno@ejemplo.test'),
  ('09320000-0000-4000-8000-0000000000a1', 'Operador Dos', 'sin-tel:tsrqponmlkjihgfedcba', 'E-2', 'dos@ejemplo.test'),
  ('09320000-0000-4000-8000-0000000000b1', 'Operador Otra Flota', 'sin-tel:aaaaaaaaaaaaaaaaaaab', 'E-1', 'otro@ejemplo.test');

do $$
begin
  -- el marcador no tiene dígitos: normaliza a '' (no es marcable)
  if (select count(*) from public.operador where telefono like 'sin-tel:%' and public.telefono_normalizado(telefono) <> '') <> 0 then
    raise exception '0932: el marcador produjo dígitos (sería marcable)';
  end if;

  -- mismo número de empleado entre los sin teléfono de LA MISMA flota: choca
  begin
    insert into public.operador (tenant_id, nombre, telefono, numero_empleado)
    values ('09320000-0000-4000-8000-0000000000a1', 'Repetido', 'sin-tel:zzzzzzzzzzzzzzzzzzzz', 'E-1');
    raise exception 'FALLO: dos operadores sin teléfono con el mismo número de empleado en la misma flota';
  exception when unique_violation then null; end;

  -- forma inválida del marcador o texto libre: sigue rechazado por la forma del teléfono
  begin
    insert into public.operador (tenant_id, nombre, telefono) values ('09320000-0000-4000-8000-0000000000a1', 'Malo 1', 'sin-tel:abc');
    raise exception 'FALLO: marcador corto aceptado';
  exception when check_violation then null; end;
  begin
    insert into public.operador (tenant_id, nombre, telefono) values ('09320000-0000-4000-8000-0000000000a1', 'Malo 2', 'abc');
    raise exception 'FALLO: texto libre aceptado como teléfono';
  exception when check_violation then null; end;
  begin
    insert into public.operador (tenant_id, nombre, telefono) values ('09320000-0000-4000-8000-0000000000a1', 'Malo 3', 'sin-tel:abcdefghijklmnopqrs1');
    raise exception 'FALLO: marcador con dígito aceptado';
  exception when check_violation then null; end;
end $$;

-- ── 2. La unicidad de los teléfonos REALES no se debilitó ───────────────────
insert into public.operador (tenant_id, nombre, telefono, numero_empleado)
values ('09320000-0000-4000-8000-0000000000a1', 'Con Teléfono', '525500009321', 'E-1');   -- mismo n.º de empleado que un sin-teléfono: permitido

do $$
begin
  -- mismo teléfono activo en OTRA flota: choca (índice global)
  begin
    insert into public.operador (tenant_id, nombre, telefono) values ('09320000-0000-4000-8000-0000000000b1', 'Mismo Tel', '5215500009321');
    raise exception 'FALLO: el mismo teléfono activo en dos flotas';
  exception when unique_violation then null; end;
  -- mismo teléfono (variante) en la MISMA flota: choca
  begin
    insert into public.operador (tenant_id, nombre, telefono, activo) values ('09320000-0000-4000-8000-0000000000a1', 'Mismo Tel 2', '5215500009321', false);
    raise exception 'FALLO: el mismo teléfono en la misma flota (aunque esté inactivo)';
  exception when unique_violation then null; end;
  -- teléfono sin forma sigue rechazado
  begin
    insert into public.operador (tenant_id, nombre, telefono) values ('09320000-0000-4000-8000-0000000000a1', 'Corto', '123');
    raise exception 'FALLO: teléfono sin forma aceptado';
  exception when check_violation then null; end;
end $$;

-- ── 3. Los índices son los esperados ────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_operador_telefono_activo' and indexdef like '%sin-tel%' and indexdef like '%activo%') then
    raise exception '0932: uq_operador_telefono_activo no excluye el marcador (o perdió el predicado de activos)';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_operador_tenant_telefono_norm' and indexdef like '%sin-tel%') then
    raise exception '0932: uq_operador_tenant_telefono_norm no excluye el marcador';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_operador_tenant_numero_empleado_sin_tel') then
    raise exception '0932: falta el índice de número de empleado de los sin teléfono';
  end if;
end $$;

rollback;
