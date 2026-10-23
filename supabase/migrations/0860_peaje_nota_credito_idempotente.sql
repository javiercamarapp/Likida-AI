-- ═══════════════════════════════════════════════════════════════════════════
-- 0860 — PEAJES: registrar una nota de crédito es ATÓMICO e IDEMPOTENTE
-- (hallazgo A33-06, ALTO en dinero, auditoría 35; reaparece como A35-A2-07).
--
-- DEFECTO: `registrarNotaDeCredito` (peajes/repo.ts) LEÍA `monto_acreditado`,
-- INSERTABA la nota en `peaje_reclamo_nota` y ESCRIBÍA `monto_acreditado =
-- leído + monto`: tres idas a la base sin candado ni unicidad. Un doble clic,
-- dos pestañas o dos POST simultáneos (a) duplican la nota y (b) leen el mismo
-- total y se pisan (última escritura gana): lo acreditado queda mal y el estado
-- del reclamo (`acreditado`/`acreditado_parcial`) se calcula sobre un total falso.
--
-- ARREGLO (en la BASE, molde 0847/0850):
--   · `peaje_reclamo_nota.clave_idempotencia` (nullable) + índice único PARCIAL
--     (tenant_id, reclamo_id, clave_idempotencia) donde la clave NO es nula.
--     Las notas existentes tienen la clave en NULL: el índice no puede fallar
--     con datos previos (NULL nunca choca) y el código viejo sigue insertando
--     sin clave.
--   · `peaje_nota_credito_registrar(...)`: bloquea la fila del reclamo
--     (`for update`), así que dos llamadas sobre el mismo reclamo se
--     serializan; si ya hay una nota con esa clave devuelve `duplicada=true` SIN
--     sumar otra vez; si no, inserta la nota y suma al total dentro de la misma
--     transacción, con la misma regla de estado que `estadoTrasAcreditar` (TS).
--   Compatible hacia atrás: no cambia firmas ni columnas existentes; el código
--   desplegado antes de esta migración sigue funcionando (camino viejo).
--
-- Aditiva e idempotente. NO cambia RLS (la tabla ya es deny-all; solo service_role).
--
-- REVERSA:
--   drop function if exists public.peaje_nota_credito_registrar(uuid, uuid, numeric, date, text, text);
--   drop index if exists public.peaje_reclamo_nota_clave_unica;
--   alter table public.peaje_reclamo_nota drop column if exists clave_idempotencia;
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.peaje_reclamo_nota add column if not exists clave_idempotencia text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'peaje_reclamo_nota_clave_larga' and conrelid = 'public.peaje_reclamo_nota'::regclass) then
    alter table public.peaje_reclamo_nota add constraint peaje_reclamo_nota_clave_larga
      check (clave_idempotencia is null or char_length(clave_idempotencia) between 1 and 200);
  end if;
end $$;

-- Parcial: las filas previas (clave NULL) no participan, así que crear el índice no puede fallar por datos existentes.
create unique index if not exists peaje_reclamo_nota_clave_unica
  on public.peaje_reclamo_nota (tenant_id, reclamo_id, clave_idempotencia)
  where clave_idempotencia is not null;

comment on column public.peaje_reclamo_nota.clave_idempotencia is
  '0860: clave que manda el llamador (hash del reclamo+estado visto+monto+fecha+folio). Una misma clave por reclamo registra la nota UNA sola vez (doble clic / reintento).';

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

  -- Idempotencia, ya bajo el candado: la misma clave no suma dos veces.
  if p_clave is not null and exists (
    select 1 from public.peaje_reclamo_nota n
     where n.tenant_id = p_tenant and n.reclamo_id = p_reclamo and n.clave_idempotencia = p_clave
  ) then
    return jsonb_build_object('ok', true, 'duplicada', true, 'monto_acreditado', v_acreditado, 'estado', v_estado);
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
  '0860: registra una nota de crédito de peajes de forma atómica (for update sobre el reclamo) e idempotente (clave por reclamo). Solo service_role.';
