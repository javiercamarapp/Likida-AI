-- ═══════════════════════════════════════════════════════════════════════════
-- 0861 — OLEADA 4: tres candados que la oleada 3 dejó solo en TypeScript
-- (auditoría 36: A36-R03-05, A36-R03-01, A36-R03-03).
--
-- (a) A36-R03-05 — `peaje_nota_credito_registrar` (0860) ahora VETA un reclamo
--     `rechazado` y TOPA lo acreditado contra lo reclamado (en centavos), DENTRO
--     del `for update` que ya existía: el veto deja de ser una lectura previa
--     del llamador (no atómica frente a otra sesión). Misma firma que la 0860;
--     solo hay dos códigos nuevos en el jsonb: `rechazado` y `excede_reclamado`
--     (este último trae `monto_acreditado` y `monto_reclamado`). El reintento
--     idéntico (misma clave) sigue contestando `duplicada=true` ANTES del veto.
--
-- (b) A36-R03-01 — `peaje_archivo_rearmar(tenant, archivo, contenido, max)`:
--     el reenvío de un archivo `fallida` pasa por el MISMO candado por flota y
--     el MISMO tope de 50 pendientes/procesando que la 0850, y lo rearma a
--     `pendiente` SIN reiniciar `intentos` y solo si `intentos < max` (5 =
--     MAX_INTENTOS de ingesta.ts). Antes era un UPDATE del llamador sin candado.
--
-- (c) A36-R03-03 — ARCO y las entregas por correo de liquidaciones:
--     · `arco_anonimizar_entregas_correo(tenant, operador)`: para las entregas
--       rol='operador' de las liquidaciones de un operador YA anonimizado,
--       correo -> 'purgado' (valor que admite la 0788), xlsx_ruta -> NULL (el
--       archivo se encola en `storage_huerfano_candidato`, como la purga de 13
--       meses) y las vivas (pendiente/enviando) pasan a `omitida`. Idempotente.
--       NO toca la liquidación (`liquidacion_externa`), su PDF ni `xlsx_sha256`:
--       la evidencia fiscal se conserva. Solo toca rol='operador' de ESE
--       operador en ESA flota.
--     · Disparador AFTER UPDATE sobre `operador`: cuando `anonimizado_en` pasa
--       de NULL a un valor (lo que hace `ejecutar_arco_cancelacion`), llama a
--       la función. Así el ejecutor ARCO la invoca sin redefinirlo.
--     · Disparador BEFORE INSERT sobre `liquidacion_entrega_correo`: una entrega
--       rol='operador' que nace DESPUÉS de la cancelación (la liquidación
--       externa sigue llegando por clave) nace ya `omitida`, con correo
--       'purgado' y sin xlsx. No redefine `recibir_desglose_atomico` (0857).
--
-- COMPATIBILIDAD HACIA ATRÁS: ninguna firma cambia (la de (a) es idéntica a la
-- 0860); el código de producción (332c055) sigue funcionando sin esta
-- migración y con ella (trata un `ok:false` desconocido como error genérico).
-- Las funciones nuevas y los disparadores son aditivos.
--
-- Aditiva e idempotente (create or replace, drop trigger if exists).
-- NO cambia RLS (tablas deny-all/solo service_role; funciones solo service_role).
--
-- REVERSA (ejecutar en este orden):
--   drop trigger if exists liquidacion_entrega_correo_omitir_operador_cancelado on public.liquidacion_entrega_correo;
--   drop trigger if exists operador_anonimiza_entregas_correo on public.operador;
--   drop function if exists public.liquidacion_entrega_correo_omitir_operador_cancelado();
--   drop function if exists public.operador_anonimiza_entregas_correo();
--   drop function if exists public.arco_anonimizar_entregas_correo(uuid, uuid, timestamptz);
--   drop function if exists public.peaje_archivo_rearmar(uuid, uuid, bytea, integer);
--   -- (a) restaurar peaje_nota_credito_registrar a la definición de la 0860: volver a
--   --     ejecutar el bloque «create or replace function public.peaje_nota_credito_registrar(...)»
--   --     de supabase/migrations/0860_peaje_nota_credito_idempotente.sql, copiado literal
--   --     (misma firma; los grants se conservan con create or replace).
--   -- Lo ya anonimizado por (c) NO se restaura (el dato se purgó a propósito).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── (a) nota de crédito: veto de `rechazado` y tope contra lo reclamado ─────
create or replace function public.peaje_nota_credito_registrar(
  p_tenant uuid, p_reclamo uuid, p_monto numeric, p_fecha date, p_referencia text default null, p_clave text default null
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_estado text;
  v_reclamado numeric;
  v_acreditado numeric;
  v_nuevo numeric;
  v_estado_nuevo text;
  v_monto numeric := round(p_monto, 2);
begin
  if p_tenant is null or p_reclamo is null then raise exception 'flota y reclamo requeridos' using errcode = '22023'; end if;
  if v_monto is null or v_monto <= 0 or v_monto > 1000000000 then
    return jsonb_build_object('ok', false, 'codigo', 'monto_invalido');
  end if;
  if p_fecha is null then return jsonb_build_object('ok', false, 'codigo', 'fecha_invalida'); end if;

  -- Candado de fila: serializa notas simultáneas del MISMO reclamo (otros reclamos y flotas no se esperan).
  select r.estado, r.monto_reclamado, r.monto_acreditado
    into v_estado, v_reclamado, v_acreditado
    from public.peaje_reclamo r
   where r.tenant_id = p_tenant and r.id = p_reclamo
     for update;
  if not found then return jsonb_build_object('ok', false, 'codigo', 'no_existe'); end if;
  if v_estado = 'preparado' then return jsonb_build_object('ok', false, 'codigo', 'sin_enviar'); end if;

  -- Idempotencia, ya bajo el candado: la misma clave no suma dos veces (y se contesta ANTES del veto: un reintento
  -- de una nota que sí se registró no debe convertirse en error si el reclamo cambió después).
  if p_clave is not null and exists (
    select 1 from public.peaje_reclamo_nota n
     where n.tenant_id = p_tenant and n.reclamo_id = p_reclamo and n.clave_idempotencia = p_clave
  ) then
    return jsonb_build_object('ok', true, 'duplicada', true, 'monto_acreditado', v_acreditado, 'estado', v_estado);
  end if;

  -- A36-R03-05: un reclamo que el proveedor rechazó no recibe notas (revivirlo a `acreditado` choca con el único
  -- parcial `peaje_reclamo_activo_unico` de la 0847 si hay otro reclamo activo, o lo revive en silencio si no).
  if v_estado = 'rechazado' then return jsonb_build_object('ok', false, 'codigo', 'rechazado'); end if;

  -- A36-R03-05: lo acreditado no puede pasar de lo reclamado. Comparación en CENTAVOS enteros (sin tolerancia de flotantes).
  if round(coalesce(v_acreditado, 0) * 100) + round(v_monto * 100) > round(v_reclamado * 100) then
    return jsonb_build_object('ok', false, 'codigo', 'excede_reclamado',
                              'monto_acreditado', coalesce(v_acreditado, 0), 'monto_reclamado', v_reclamado);
  end if;

  insert into public.peaje_reclamo_nota (tenant_id, reclamo_id, monto, fecha, referencia, clave_idempotencia)
  values (p_tenant, p_reclamo, v_monto, p_fecha, nullif(left(btrim(coalesce(p_referencia, '')), 120), ''), p_clave);

  v_nuevo := round(coalesce(v_acreditado, 0) + v_monto, 2);
  -- Misma regla que `estadoTrasAcreditar` (reclamos_seguimiento.ts).
  v_estado_nuevo := case when v_nuevo <= 0 then v_estado
                         when v_nuevo + 0.004 >= v_reclamado then 'acreditado'
                         else 'acreditado_parcial' end;
  update public.peaje_reclamo
     set monto_acreditado = v_nuevo, estado = v_estado_nuevo, actualizado_en = now()
   where tenant_id = p_tenant and id = p_reclamo;

  return jsonb_build_object('ok', true, 'duplicada', false, 'monto_acreditado', v_nuevo, 'estado', v_estado_nuevo);
end $$;

revoke all on function public.peaje_nota_credito_registrar(uuid, uuid, numeric, date, text, text) from public, anon, authenticated;
grant execute on function public.peaje_nota_credito_registrar(uuid, uuid, numeric, date, text, text) to service_role;

comment on function public.peaje_nota_credito_registrar(uuid, uuid, numeric, date, text, text) is
  '0860/0861: registra una nota de crédito de peajes de forma atómica (for update sobre el reclamo) e idempotente (clave por reclamo); 0861 veta reclamos rechazados y topa lo acreditado contra lo reclamado (centavos). Solo service_role.';

-- ── (b) rearmar un archivo de peajes `fallida` bajo el candado y el tope de la 0850 ──
create or replace function public.peaje_archivo_rearmar(
  p_tenant uuid, p_archivo uuid, p_contenido bytea, p_max_intentos integer default 5
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_estado text;
  v_intentos integer;
  v_n integer;
begin
  if p_tenant is null or p_archivo is null then raise exception 'flota y archivo requeridos' using errcode = '22023'; end if;
  if p_contenido is null or length(p_contenido) < 1 or length(p_contenido) > 4194304 then
    return jsonb_build_object('ok', false, 'codigo', 'contenido_invalido');
  end if;
  if p_max_intentos is null or p_max_intentos < 1 or p_max_intentos > 100 then
    raise exception 'p_max_intentos fuera de 1..100' using errcode = '22023';
  end if;

  -- MISMO candado por flota que `peaje_archivo_encolar` (0850): rearmar y encolar se serializan, así el tope de 50 no se rebasa.
  perform pg_advisory_xact_lock(hashtextextended('peaje_ingesta_tope:' || p_tenant::text, 0));

  select a.estado, a.intentos into v_estado, v_intentos
    from public.peaje_ingesta_archivo a
   where a.tenant_id = p_tenant and a.id = p_archivo
     for update;
  if not found then return jsonb_build_object('ok', false, 'codigo', 'no_existe'); end if;
  if v_estado <> 'fallida' then return jsonb_build_object('ok', false, 'codigo', 'no_fallida', 'estado', v_estado); end if;
  -- Los intentos NO se reinician: un proveedor que reenvía en bucle un archivo irreparable se detiene solo.
  if v_intentos >= p_max_intentos then
    return jsonb_build_object('ok', false, 'codigo', 'intentos_agotados', 'intentos', v_intentos);
  end if;

  select count(*) into v_n
    from public.peaje_ingesta_archivo a
   where a.tenant_id = p_tenant and a.estado in ('pendiente', 'procesando');
  -- 50 = MAX_PENDIENTES_POR_FLOTA (ingesta.ts) = tope de `peaje_archivo_encolar` (0850). Cambian juntos.
  if v_n >= 50 then return jsonb_build_object('ok', false, 'codigo', 'cola_llena'); end if;

  update public.peaje_ingesta_archivo
     set estado = 'pendiente', contenido = p_contenido, bytes = length(p_contenido),
         proximo_intento_en = now(), ultimo_error = null, reclamo = null, reclamado_hasta = null
   where tenant_id = p_tenant and id = p_archivo;

  return jsonb_build_object('ok', true, 'rearmado', true, 'intentos', v_intentos);
end $$;

revoke all on function public.peaje_archivo_rearmar(uuid, uuid, bytea, integer) from public, anon, authenticated;
grant execute on function public.peaje_archivo_rearmar(uuid, uuid, bytea, integer) to service_role;

comment on function public.peaje_archivo_rearmar(uuid, uuid, bytea, integer) is
  '0861: rearma a pendiente un archivo de peajes fallida (reenvío del mismo contenido) bajo el candado por flota y el tope de 50 de la 0850, sin reiniciar intentos y solo si intentos < p_max_intentos. Solo service_role.';

-- ── (c) ARCO: anonimizar las entregas por correo de un operador cancelado ───
create or replace function public.arco_anonimizar_entregas_correo(
  p_tenant uuid, p_operador uuid, p_ahora timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_anon timestamptz;
  v_n integer;
  v_archivos integer;
begin
  if p_tenant is null or p_operador is null or p_ahora is null then
    raise exception 'flota, operador y fecha requeridos' using errcode = '22023';
  end if;

  select o.anonimizado_en into v_anon
    from public.operador o
   where o.tenant_id = p_tenant and o.id = p_operador;
  if not found then return jsonb_build_object('ok', false, 'codigo', 'no_existe'); end if;
  -- Solo de un operador YA cancelado: esta función nunca puede vaciar el correo de un operador vivo.
  if v_anon is null then return jsonb_build_object('ok', false, 'codigo', 'operador_no_anonimizado'); end if;

  with objetivo as (
    select e.id, e.xlsx_ruta
      from public.liquidacion_entrega_correo e
      join public.liquidacion_externa l
        on l.id = e.liquidacion_externa_id and l.tenant_id = e.tenant_id
     where e.tenant_id = p_tenant and l.operador_id = p_operador and e.rol = 'operador'
       -- idempotente: lo ya anonimizado y terminal no se vuelve a tocar.
       and not (e.correo = 'purgado' and e.xlsx_ruta is null and e.estado not in ('pendiente', 'enviando'))
     order by e.id
       for update of e
  ), encoladas as (
    insert into public.storage_huerfano_candidato (bucket, nombre, motivo)
    select 'liquidaciones', o.xlsx_ruta, 'arco_entrega_correo'
      from objetivo o where o.xlsx_ruta is not null
    on conflict (bucket, nombre) do nothing
    returning nombre
  ), tocadas as (
    update public.liquidacion_entrega_correo e
       set correo = 'purgado',
           xlsx_ruta = null,
           estado = case when e.estado in ('pendiente', 'enviando') then 'omitida' else e.estado end,
           claim_token = null, claim_expira_en = null,
           ultimo_error = case when e.estado in ('pendiente', 'enviando') then 'Operador cancelado por ARCO: entrega omitida' else null end,
           updated_at = p_ahora
      from objetivo o
     where e.id = o.id
    returning e.id
  )
  select (select count(*) from tocadas), (select count(*) from encoladas) into v_n, v_archivos;

  return jsonb_build_object('ok', true, 'anonimizadas', v_n, 'archivosEncolados', v_archivos);
end $$;

revoke all on function public.arco_anonimizar_entregas_correo(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.arco_anonimizar_entregas_correo(uuid, uuid, timestamptz) to service_role;

comment on function public.arco_anonimizar_entregas_correo(uuid, uuid, timestamptz) is
  '0861: tras la cancelación ARCO de un operador, vacía el correo (purgado) y el xlsx de sus entregas rol=operador y omite las vivas. Idempotente; conserva la liquidación y su evidencia fiscal. Solo service_role.';

-- Disparador sobre `operador`: el ejecutor ARCO (0173/0442/0849) marca `anonimizado_en`; esto lo engancha sin redefinirlo.
create or replace function public.operador_anonimiza_entregas_correo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.anonimizado_en is not null and old.anonimizado_en is null then
    perform public.arco_anonimizar_entregas_correo(new.tenant_id, new.id);
  end if;
  return null;
end $$;

revoke all on function public.operador_anonimiza_entregas_correo() from public, anon, authenticated;

drop trigger if exists operador_anonimiza_entregas_correo on public.operador;
create trigger operador_anonimiza_entregas_correo
  after update of anonimizado_en on public.operador
  for each row execute function public.operador_anonimiza_entregas_correo();

-- Disparador sobre la cola: una entrega al operador que nace tras su cancelación nace omitida.
create or replace function public.liquidacion_entrega_correo_omitir_operador_cancelado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.rol = 'operador' and exists (
    select 1
      from public.liquidacion_externa l
      join public.operador o on o.id = l.operador_id and o.tenant_id = l.tenant_id
     where l.id = new.liquidacion_externa_id and l.tenant_id = new.tenant_id and o.anonimizado_en is not null
  ) then
    new.correo := 'purgado';
    new.xlsx_ruta := null;
    new.estado := 'omitida';
    new.claim_token := null;
    new.claim_expira_en := null;
    new.ultimo_error := 'Operador cancelado por ARCO: entrega omitida';
  end if;
  return new;
end $$;

revoke all on function public.liquidacion_entrega_correo_omitir_operador_cancelado() from public, anon, authenticated;

drop trigger if exists liquidacion_entrega_correo_omitir_operador_cancelado on public.liquidacion_entrega_correo;
create trigger liquidacion_entrega_correo_omitir_operador_cancelado
  before insert on public.liquidacion_entrega_correo
  for each row execute function public.liquidacion_entrega_correo_omitir_operador_cancelado();
