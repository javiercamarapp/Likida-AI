-- REVERSA: drop trigger if exists peaje_tarifa_sin_traslape on public.peaje_tarifa; drop function if exists public.peaje_tarifa_sin_traslape(); drop function if exists public.purgar_liquidacion_entrega_correo_residuos(integer, integer, timestamptz); drop function if exists public.purgar_programa_despacho(integer, integer, timestamptz); alter table public.insight_linea_base drop constraint if exists insight_linea_base_minutos_tope; drop policy if exists administra_flota on public.insight_linea_base; y recrear la política de supabase/migrations/0805_insight_linea_base.sql (create policy administra_flota ... for all using/with check sin la cláusula de capturada_por). Ningún dato se borra al revertir.
-- ═══════════════════════════════════════════════════════════════════════════
-- 0890 — Lote A5-05 de la auditoría 37 (hallazgos BAJO de S62): cuatro candados
-- y retenciones en UNA migración, aditiva e idempotente.
--
--  A37-S62-06  peaje_tarifa: que dos vigencias de la misma caseta y clase no se
--              traslapen dejaba de ser solo de la aplicación (leer-decidir-
--              escribir). Un TRIGGER con candado de asesoría por (flota, caseta,
--              clase) serializa las escrituras y rechaza el traslape con 23P01
--              (exclusion_violation). Se usa trigger y no EXCLUDE gist porque (1)
--              no exige btree_gist y (2) una restricción de exclusión no admite
--              NOT VALID: si producción ya tuviera una pareja traslapada la
--              migración entera fallaría. El trigger solo vigila escrituras
--              nuevas; lo viejo no se toca. Misma llave (flota, caseta, clase,
--              inicio) NO cuenta como traslape: ahí manda el upsert de la llave
--              única de la 0811.
--  A37-S62-08  Entregas por correo: la 0788 purga correo y xlsx_ruta pero deja
--              pedido_por (correo de quien pidió el reenvío) y ultimo_error (el
--              texto del proveedor, que suele citar al destinatario), y nunca
--              toca pendiente/enviando. La 0788 NO se redefine (el guardia 0809
--              lo prohíbe): función NUEVA `purgar_liquidacion_entrega_correo_
--              residuos` que (a) limpia pedido_por/ultimo_error de lo ya
--              purgado y (b) cierra como `fallida` + purgada la entrega que
--              lleva más de p_meses sin avanzar (pendiente/enviando con
--              proximo_intento_en y created_at más viejos que el corte).
--  A37-S62-07  Programa de despacho: función NUEVA `purgar_programa_despacho`
--              (piso 6 meses, defecto 12): borra la historia de cambios y las
--              cargas viejas y vacía el texto libre `comentarios` de las filas
--              viejas. NO borra filas: sobre ellas cuelgan en cascada vigia_aviso
--              (la constancia de lo avisado) y los datos de viaje.
--  A37-S62-10  insight_linea_base: tope superior de minutos (NOT VALID: solo
--              escrituras nuevas) y la política de `authenticated` ya no deja
--              poner a otro usuario en capturada_por (null o uno mismo; el
--              superadmin queda exento). El servidor (service_role) no pasa por RLS.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A37-S62-06 ───────────────────────────────────────────────────────────────
create or replace function public.peaje_tarifa_sin_traslape()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Serializa a quien escribe la misma (flota, caseta, clase): el segundo espera
  -- al commit del primero y su SELECT (nueva foto por sentencia) ya lo ve.
  perform pg_advisory_xact_lock(
    hashtextextended('peaje_tarifa:' || new.tenant_id::text || ':' || new.caseta_norm || ':' || new.clase::text, 0));
  if exists (
    select 1 from public.peaje_tarifa t
     where t.tenant_id = new.tenant_id
       and t.caseta_norm = new.caseta_norm
       and t.clase = new.clase
       and t.id <> new.id
       and t.vigente_desde <> new.vigente_desde
       and daterange(t.vigente_desde, t.vigente_hasta, '[]') && daterange(new.vigente_desde, new.vigente_hasta, '[]')
  ) then
    raise exception 'peaje_tarifa: la vigencia se traslapa con otra tarifa de la misma caseta y clase'
      using errcode = '23P01';
  end if;
  return new;
end $$;

revoke all on function public.peaje_tarifa_sin_traslape() from public, anon, authenticated;
grant execute on function public.peaje_tarifa_sin_traslape() to service_role;

drop trigger if exists peaje_tarifa_sin_traslape on public.peaje_tarifa;
create trigger peaje_tarifa_sin_traslape
  before insert or update of tenant_id, caseta_norm, clase, vigente_desde, vigente_hasta
  on public.peaje_tarifa
  for each row execute function public.peaje_tarifa_sin_traslape();

-- ── A37-S62-08 ───────────────────────────────────────────────────────────────
create or replace function public.purgar_liquidacion_entrega_correo_residuos(
  p_meses  integer     default 13,
  p_limite integer     default 500,
  p_ahora  timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_limpias integer; v_cerradas integer; v_archivos integer;
begin
  if p_meses is null or p_meses < 12 or p_limite is null or p_limite < 1 or p_limite > 5000 or p_ahora is null then
    raise exception 'parámetros de purga inválidos (p_meses >= 12, p_limite 1..5000)' using errcode = 'PU001';
  end if;

  -- (a) lo ya purgado conserva todavía quién pidió el reenvío y el texto de error.
  with sucias as (
    select id from public.liquidacion_entrega_correo
     where correo = 'purgado' and (pedido_por is not null or ultimo_error is not null)
     order by created_at, id
     limit p_limite
       for update skip locked
  ), limpiadas as (
    update public.liquidacion_entrega_correo e
       set pedido_por = null, ultimo_error = null, updated_at = p_ahora
      from sucias s where e.id = s.id
    returning e.id
  )
  select count(*) into v_limpias from limpiadas;

  -- (b) la entrega que lleva más de p_meses sin avanzar ya no se va a enviar: se
  --     cierra como fallida y se purga igual que una terminal.
  with atascadas as (
    select id, xlsx_ruta from public.liquidacion_entrega_correo
     where estado in ('pendiente', 'enviando')
       and correo <> 'purgado'
       and created_at < p_ahora - make_interval(months => p_meses)
       and proximo_intento_en < p_ahora - make_interval(months => p_meses)
       and (claim_expira_en is null or claim_expira_en < p_ahora)
     order by created_at, id
     limit p_limite
       for update skip locked
  ), encoladas as (
    insert into public.storage_huerfano_candidato (bucket, nombre, motivo)
    select 'liquidaciones', xlsx_ruta, 'retencion_entrega_correo'
      from atascadas where xlsx_ruta is not null
    on conflict (bucket, nombre) do nothing
    returning nombre
  ), cerradas as (
    update public.liquidacion_entrega_correo e
       set estado = 'fallida', correo = 'purgado', xlsx_ruta = null, pedido_por = null, ultimo_error = null,
           claim_token = null, claim_expira_en = null, updated_at = p_ahora
      from atascadas a where e.id = a.id
    returning e.id
  )
  select (select count(*) from cerradas), (select count(*) from encoladas) into v_cerradas, v_archivos;

  return jsonb_build_object('limpiadas', v_limpias, 'atascadasCerradas', v_cerradas, 'archivosEncolados', v_archivos,
                            'parcial', v_limpias >= p_limite or v_cerradas >= p_limite);
end $$;

revoke all on function public.purgar_liquidacion_entrega_correo_residuos(integer, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.purgar_liquidacion_entrega_correo_residuos(integer, integer, timestamptz)
  to service_role;
comment on function public.purgar_liquidacion_entrega_correo_residuos(integer, integer, timestamptz) is
  '0890: complementa la 0788. Limpia pedido_por y ultimo_error de lo ya purgado y cierra (fallida + purgada) la entrega pendiente/enviando sin avanzar en más de p_meses (piso 12). Idempotente. Solo service_role.';

-- ── A37-S62-07 ───────────────────────────────────────────────────────────────
create or replace function public.purgar_programa_despacho(
  p_meses  integer     default 12,
  p_limite integer     default 1000,
  p_ahora  timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_cambios integer; v_comentarios integer; v_cargas integer;
begin
  if p_meses is null or p_meses < 6 or p_limite is null or p_limite < 1 or p_limite > 5000 or p_ahora is null then
    raise exception 'parámetros de purga inválidos (p_meses >= 6, p_limite 1..5000)' using errcode = 'PU001';
  end if;

  with viejos as (
    select id from public.programa_despacho_cambio
     where en < p_ahora - make_interval(months => p_meses)
     order by en, id
     limit p_limite
       for update skip locked
  ), borrados as (
    delete from public.programa_despacho_cambio c using viejos v where c.id = v.id returning c.id
  )
  select count(*) into v_cambios from borrados;

  with viejas as (
    select id from public.programa_despacho_fila
     where comentarios is not null
       and fecha < (p_ahora - make_interval(months => p_meses))::date
     order by fecha, id
     limit p_limite
       for update skip locked
  ), vaciadas as (
    update public.programa_despacho_fila f set comentarios = null from viejas v where f.id = v.id returning f.id
  )
  select count(*) into v_comentarios from vaciadas;

  with viejas as (
    select id from public.programa_despacho_carga
     where created_at < p_ahora - make_interval(months => p_meses)
     order by created_at, id
     limit p_limite
       for update skip locked
  ), borradas as (
    delete from public.programa_despacho_carga c using viejas v where c.id = v.id returning c.id
  )
  select count(*) into v_cargas from borradas;

  return jsonb_build_object('cambios', v_cambios, 'comentariosVaciados', v_comentarios, 'cargas', v_cargas,
                            'parcial', v_cambios >= p_limite or v_comentarios >= p_limite or v_cargas >= p_limite);
end $$;

revoke all on function public.purgar_programa_despacho(integer, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.purgar_programa_despacho(integer, integer, timestamptz)
  to service_role;
comment on function public.purgar_programa_despacho(integer, integer, timestamptz) is
  '0890: retención del programa de despacho (12 meses por defecto, piso 6). Borra historia de cambios y cargas viejas y vacía comentarios de filas viejas; NO borra filas (cuelgan vigia_aviso y datos de viaje). Idempotente. Solo service_role.';

-- ── A37-S62-10 ───────────────────────────────────────────────────────────────
alter table public.insight_linea_base drop constraint if exists insight_linea_base_minutos_tope;
alter table public.insight_linea_base
  add constraint insight_linea_base_minutos_tope check (minutos_por_unidad <= 100000) not valid;

drop policy if exists administra_flota on public.insight_linea_base;
create policy administra_flota on public.insight_linea_base for all
  using ((tenant_id = any(public.get_user_tenant_ids()) and public.administra_flota()) or public.is_superadmin())
  with check (
    (tenant_id = any(public.get_user_tenant_ids()) and public.administra_flota()
      and (capturada_por is null or capturada_por = auth.uid()))
    or public.is_superadmin()
  );
