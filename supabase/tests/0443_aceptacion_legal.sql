\set ON_ERROR_STOP on
-- 0443 — REGISTRO DE ACEPTACIÓN LEGAL (Términos, Aviso, MANDATO por flota).
-- Lo que solo la base garantiza, con datos sintéticos propios (rollback):
--   (a) idempotencia por persona; el mandato es UNO por (flota, versión);
--   (b) solo un flota_admin ACTIVO de la flota otorga el mandato, y con huella;
--   (c) el mandato vigente es por versión y por flota (otra flota, otra versión,
--       revocado → false); revocar conserva la fila;
--   (d) aislamiento: un usuario de otra flota no registra nada en esta;
--   (e) la cuenta cancelada (user_id → NULL) deja la evidencia sin dato personal;
--   (f) CHECKs: documento, huella, versión; el mandato sin huella no entra;
--   (g) permisos solo service_role, RLS sin políticas.
begin;

insert into public.tenant (id, nombre) values
  ('44300000-0000-4000-8000-0000000000a1', 'Flota A 0443'),
  ('44300000-0000-4000-8000-0000000000b1', 'Flota B 0443');
insert into public.app_user (id, tenant_id, email, nombre, rol, activo, desactivado_en) values
  ('44300000-0000-4000-8000-0000000000c1', '44300000-0000-4000-8000-0000000000a1', 'dueno-0443@test.invalid',  'Dueño',    'flota_admin', true,  null),
  ('44300000-0000-4000-8000-0000000000c2', '44300000-0000-4000-8000-0000000000a1', 'conta-0443@test.invalid',   'Contador', 'contador',    true,  null),
  ('44300000-0000-4000-8000-0000000000c3', '44300000-0000-4000-8000-0000000000a1', 'baja-0443@test.invalid',    'De baja',  'flota_admin', false, now()),
  ('44300000-0000-4000-8000-0000000000d1', '44300000-0000-4000-8000-0000000000b1', 'dueno-b-0443@test.invalid', 'Dueño B',  'flota_admin', true,  null);

set local role service_role;
do $$
declare
  r jsonb;
  h constant text := repeat('a', 64);
  A constant uuid := '44300000-0000-4000-8000-0000000000a1';
  B constant uuid := '44300000-0000-4000-8000-0000000000b1';
  dueno constant uuid := '44300000-0000-4000-8000-0000000000c1';
  conta constant uuid := '44300000-0000-4000-8000-0000000000c2';
  baja  constant uuid := '44300000-0000-4000-8000-0000000000c3';
  dueno_b constant uuid := '44300000-0000-4000-8000-0000000000d1';
begin
  -- (a) términos: la primera se registra, la repetida no duplica
  r := public.registrar_aceptacion_legal(A, dueno, 'terminos', 'v1');
  if not ((r->>'ok')::boolean and (r->>'registrada')::boolean) then raise exception '0443: no registró términos: %', r; end if;
  r := public.registrar_aceptacion_legal(A, dueno, 'terminos', 'v1');
  if not (r->>'ok')::boolean or (r->>'registrada')::boolean then raise exception '0443: duplicó la aceptación: %', r; end if;
  if (select count(*) from public.aceptacion_legal where tenant_id = A and documento = 'terminos') <> 1 then raise exception '0443: hay más de una fila'; end if;
  -- otra persona de la misma flota sí acepta la misma versión; y otra versión también
  r := public.registrar_aceptacion_legal(A, conta, 'terminos', 'v1');
  if not (r->>'registrada')::boolean then raise exception '0443: el contador no pudo aceptar: %', r; end if;
  r := public.registrar_aceptacion_legal(A, dueno, 'terminos', 'v2');
  if not (r->>'registrada')::boolean then raise exception '0443: la versión nueva no se registró: %', r; end if;

  -- (b) el mandato: solo flota_admin, con huella
  r := public.registrar_aceptacion_legal(A, conta, 'mandato_autofacturacion', 'm1', h);
  if (r->>'ok')::boolean then raise exception '0443: un contador otorgó el mandato'; end if;
  r := public.registrar_aceptacion_legal(A, baja, 'mandato_autofacturacion', 'm1', h);
  if (r->>'ok')::boolean then raise exception '0443: un dueño de baja otorgó el mandato'; end if;
  r := public.registrar_aceptacion_legal(A, dueno, 'mandato_autofacturacion', 'm1');
  if (r->>'ok')::boolean then raise exception '0443: el mandato entró sin huella'; end if;
  r := public.registrar_aceptacion_legal(A, dueno, 'mandato_autofacturacion', 'm1', 'no-es-hex');
  if (r->>'ok')::boolean then raise exception '0443: el mandato entró con huella inválida'; end if;
  if public.mandato_autofacturacion_vigente(A, 'm1') then raise exception '0443: vigente sin haberse otorgado'; end if;
  r := public.registrar_aceptacion_legal(A, dueno, 'mandato_autofacturacion', 'm1', h, 'abc123');
  if not (r->>'registrada')::boolean then raise exception '0443: no registró el mandato: %', r; end if;

  -- (d) aislamiento
  r := public.registrar_aceptacion_legal(A, dueno_b, 'mandato_autofacturacion', 'm1', h);
  if (r->>'ok')::boolean then raise exception '0443: un usuario de OTRA flota registró en esta'; end if;
  r := public.registrar_aceptacion_legal(B, dueno, 'terminos', 'v1');
  if (r->>'ok')::boolean then raise exception '0443: el dueño de A registró en B'; end if;

  -- (c) vigencia por flota y por versión
  if not public.mandato_autofacturacion_vigente(A, 'm1') then raise exception '0443: no vigente tras otorgarlo'; end if;
  if public.mandato_autofacturacion_vigente(A, 'm2') then raise exception '0443: vigente para otra versión del texto'; end if;
  if public.mandato_autofacturacion_vigente(B, 'm1') then raise exception '0443: el mandato de A vale para B'; end if;
  -- el mandato es UNO por (flota, versión): un segundo dueño no lo duplica
  insert into public.app_user (id, tenant_id, email, nombre, rol) values
    ('44300000-0000-4000-8000-0000000000c4', A, 'dueno2-0443@test.invalid', 'Dueño 2', 'flota_admin');
  r := public.registrar_aceptacion_legal(A, '44300000-0000-4000-8000-0000000000c4', 'mandato_autofacturacion', 'm1', h);
  if (r->>'registrada')::boolean then raise exception '0443: se duplicó el mandato de la flota'; end if;

  -- revocar: solo el dueño, conserva la fila, y deja de ser vigente
  r := public.revocar_mandato_autofacturacion(A, conta);
  if (r->>'ok')::boolean then raise exception '0443: un contador retiró el mandato'; end if;
  if not public.mandato_autofacturacion_vigente(A, 'm1') then raise exception '0443: el mandato se perdió al intentar revocarlo el contador'; end if;
  r := public.revocar_mandato_autofacturacion(A, dueno);
  if not (r->>'ok')::boolean or (r->>'revocadas')::int <> 1 then raise exception '0443: no revocó: %', r; end if;
  if public.mandato_autofacturacion_vigente(A, 'm1') then raise exception '0443: sigue vigente tras revocarlo'; end if;
  if (select count(*) from public.aceptacion_legal where tenant_id = A and documento = 'mandato_autofacturacion' and revocado_en is not null and revocado_por = dueno) <> 1 then
    raise exception '0443: la fila revocada no se conservó con quién la retiró';
  end if;
  -- re-otorgar tras revocar vuelve a ser posible (nueva fila)
  r := public.registrar_aceptacion_legal(A, dueno, 'mandato_autofacturacion', 'm1', h);
  if not (r->>'registrada')::boolean then raise exception '0443: no se pudo volver a otorgar: %', r; end if;
  if not public.mandato_autofacturacion_vigente(A, 'm1') then raise exception '0443: no vigente tras re-otorgar'; end if;

  -- (f) CHECKs / validaciones
  r := public.registrar_aceptacion_legal(A, dueno, 'otra_cosa', 'v1');
  if (r->>'ok')::boolean then raise exception '0443: aceptó un documento inventado'; end if;
  r := public.registrar_aceptacion_legal(A, dueno, 'terminos', '  ');
  if (r->>'ok')::boolean then raise exception '0443: aceptó versión vacía'; end if;
  begin
    insert into public.aceptacion_legal (tenant_id, user_id, documento, version) values (A, dueno, 'mandato_autofacturacion', 'zz');
    raise exception '0443: el CHECK dejó entrar un mandato sin huella';
  exception when check_violation then null;
  end;
  begin
    insert into public.aceptacion_legal (tenant_id, user_id, documento, version, hash_sha256) values (A, dueno, 'terminos', 'zz', 'xyz');
    raise exception '0443: el CHECK dejó entrar una huella inválida';
  exception when check_violation then null;
  end;

  -- (e) cuenta cancelada: la evidencia queda sin dato personal
  delete from public.app_user where id = conta;
  if not exists (select 1 from public.aceptacion_legal where tenant_id = A and documento = 'terminos' and version = 'v1' and user_id is null) then
    raise exception '0443: la evidencia se perdió o conservó al usuario tras borrar la cuenta';
  end if;
end $$;
reset role;

-- (g) permisos y RLS
do $$
declare f text;
begin
  foreach f in array array[
    'public.registrar_aceptacion_legal(uuid,uuid,text,text,text,text)',
    'public.revocar_mandato_autofacturacion(uuid,uuid)',
    'public.mandato_autofacturacion_vigente(uuid,text)'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception '0443: % ejecutable por anon/authenticated', f;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.aceptacion_legal', 'select') or has_table_privilege('authenticated', 'public.aceptacion_legal', 'select') then
    raise exception '0443: anon/authenticated leen aceptacion_legal';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.aceptacion_legal'::regclass) then
    raise exception '0443: aceptacion_legal sin RLS';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'aceptacion_legal') then
    raise exception '0443: aceptacion_legal tiene políticas — debe ser deny-all';
  end if;
end $$;

rollback;
\echo '0443 OK'
