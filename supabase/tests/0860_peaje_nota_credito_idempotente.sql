\set ON_ERROR_STOP on
-- 0860 — nota de crédito de peajes atómica e idempotente (A33-06), contra Postgres REAL.
--   (a) la primera llamada crea la nota y suma; (b) la segunda IDÉNTICA (misma clave) no duplica ni suma;
--   (c) otra clave suma (dos notas legítimas distintas); sin clave sigue sumando (camino compatible);
--   (d) estados: acreditado_parcial → acreditado con la regla de estadoTrasAcreditar; reclamo «preparado» se rechaza;
--   (e) aislamiento por flota: otra flota no ve ni toca el reclamo; la misma clave en otro reclamo no choca;
--   (f) el índice único parcial no choca con notas previas sin clave; monto/fecha inválidos se rechazan;
--   (g) solo service_role ejecuta; (h) la REVERSA de la cabecera funciona y la migración es reaplicable.
begin;

insert into public.tenant (id, nombre) values
  ('86000000-0000-4000-8000-0000000000a1', 'Flota A 0860'),
  ('86000000-0000-4000-8000-0000000000b1', 'Flota B 0860');

do $$
declare
  A constant uuid := '86000000-0000-4000-8000-0000000000a1';
  B constant uuid := '86000000-0000-4000-8000-0000000000b1';
  r1 uuid := '86000000-0000-4000-8000-0000000000a2';
  r2 uuid := '86000000-0000-4000-8000-0000000000a3';
  rp uuid := '86000000-0000-4000-8000-0000000000a4';
  j jsonb; n int; v_acr numeric; v_est text;
begin
  insert into public.peaje_reclamo (id, tenant_id, categoria, estado, monto_reclamado, enviado_en, fecha_cobro_mas_antiguo) values
    (r1, A, 'extemporaneo', 'enviado', 1000, '2026-09-01', '2026-08-01'),
    (r2, A, 'duplicado_exacto', 'enviado', 500, '2026-09-01', '2026-08-01'),
    (rp, A, 'tag_dado_de_baja', 'preparado', 500, null, '2026-08-01');
  -- una nota PREVIA sin clave (como las de antes de la migración): el índice parcial no debe estorbar.
  insert into public.peaje_reclamo_nota (tenant_id, reclamo_id, monto, fecha) values (A, r2, 10, '2026-09-02');
  insert into public.peaje_reclamo_nota (tenant_id, reclamo_id, monto, fecha) values (A, r2, 10, '2026-09-02');

  -- (a) primera llamada: crea y suma.
  j := public.peaje_nota_credito_registrar(A, r1, 300, '2026-09-10', 'NC-1', 'k1');
  if not (j->>'ok')::boolean or (j->>'duplicada')::boolean or (j->>'monto_acreditado')::numeric <> 300 or j->>'estado' <> 'acreditado_parcial' then
    raise exception '0860 a: primera llamada mal: %', j; end if;

  -- (b) segunda IDÉNTICA: no duplica ni suma otra vez.
  j := public.peaje_nota_credito_registrar(A, r1, 300, '2026-09-10', 'NC-1', 'k1');
  if not (j->>'ok')::boolean or not (j->>'duplicada')::boolean then raise exception '0860 b: la repetida no se marcó duplicada: %', j; end if;
  select count(*) into n from public.peaje_reclamo_nota where reclamo_id = r1;
  select monto_acreditado into v_acr from public.peaje_reclamo where id = r1;
  if n <> 1 or v_acr <> 300 then raise exception '0860 b: duplicó (% notas, acreditado %)', n, v_acr; end if;

  -- (c) otra clave suma; completa el reclamo → acreditado.
  j := public.peaje_nota_credito_registrar(A, r1, 700, '2026-09-11', null, 'k2');
  select monto_acreditado, estado into v_acr, v_est from public.peaje_reclamo where id = r1;
  if v_acr <> 1000 or v_est <> 'acreditado' then raise exception '0860 c: esperaba 1000/acreditado, hay %/%', v_acr, v_est; end if;
  -- sin clave (camino compatible): suma, sin idempotencia.
  j := public.peaje_nota_credito_registrar(A, r2, 50, '2026-09-12', null, null);
  j := public.peaje_nota_credito_registrar(A, r2, 50, '2026-09-12', null, null);
  select count(*) into n from public.peaje_reclamo_nota where reclamo_id = r2;
  if n <> 4 then raise exception '0860 c: sin clave debían ser 4 notas (2 previas + 2), hay %', n; end if;

  -- (d) reclamo preparado: se rechaza y no escribe nada.
  j := public.peaje_nota_credito_registrar(A, rp, 10, '2026-09-12', null, 'kp');
  if (j->>'ok')::boolean or j->>'codigo' <> 'sin_enviar' then raise exception '0860 d: preparado debía rechazarse: %', j; end if;
  if exists (select 1 from public.peaje_reclamo_nota where reclamo_id = rp) then raise exception '0860 d: escribió una nota en un reclamo preparado'; end if;

  -- (e) aislamiento por flota.
  j := public.peaje_nota_credito_registrar(B, r2, 10, '2026-09-12', null, 'kb');
  if (j->>'ok')::boolean or j->>'codigo' <> 'no_existe' then raise exception '0860 e: otra flota tocó el reclamo: %', j; end if;
  -- la misma clave en OTRO reclamo no choca.
  j := public.peaje_nota_credito_registrar(A, r2, 20, '2026-09-13', null, 'k1');
  if not (j->>'ok')::boolean or (j->>'duplicada')::boolean then raise exception '0860 e: la clave k1 en otro reclamo debía registrarse: %', j; end if;

  -- (f) entradas inválidas.
  j := public.peaje_nota_credito_registrar(A, r2, 0, '2026-09-13', null, 'kz');
  if (j->>'ok')::boolean or j->>'codigo' <> 'monto_invalido' then raise exception '0860 f: monto 0 debía rechazarse: %', j; end if;
  j := public.peaje_nota_credito_registrar(A, r2, 5, null, null, 'kz');
  if (j->>'ok')::boolean or j->>'codigo' <> 'fecha_invalida' then raise exception '0860 f: fecha nula debía rechazarse: %', j; end if;

  -- el índice único parcial choca ante un INSERT directo con clave repetida (red de último recurso).
  begin
    insert into public.peaje_reclamo_nota (tenant_id, reclamo_id, monto, fecha, clave_idempotencia) values (A, r1, 1, '2026-09-13', 'k1');
    raise exception '0860 f: el índice único parcial no chocó';
  exception when unique_violation then null; end;

  -- (g) privilegios: solo service_role.
  if has_function_privilege('anon', 'public.peaje_nota_credito_registrar(uuid,uuid,numeric,date,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.peaje_nota_credito_registrar(uuid,uuid,numeric,date,text,text)', 'execute')
     or not has_function_privilege('service_role', 'public.peaje_nota_credito_registrar(uuid,uuid,numeric,date,text,text)', 'execute') then
    raise exception '0860 g: privilegios de ejecución incorrectos';
  end if;
end $$;

rollback;

-- (h) la REVERSA de la cabecera de la migración (exacta) funciona; todo dentro de una transacción que se descarta.
begin;
drop function if exists public.peaje_nota_credito_registrar(uuid, uuid, numeric, date, text, text);
drop index if exists public.peaje_reclamo_nota_clave_unica;
alter table public.peaje_reclamo_nota drop column if exists clave_idempotencia;
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'peaje_reclamo_nota' and column_name = 'clave_idempotencia')
     or exists (select 1 from pg_proc where proname = 'peaje_nota_credito_registrar') then
    raise exception '0860 h: la reversa no dejó limpio';
  end if;
end $$;
rollback;
