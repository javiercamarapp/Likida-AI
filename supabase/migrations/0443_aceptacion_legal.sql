-- ═══════════════════════════════════════════════════════════════════════════
-- 0443 — REGISTRO DE ACEPTACIÓN LEGAL: Términos, Aviso y MANDATO de autofacturación.
--
-- Auditoría ola 1, #48. El login solo decía «Al continuar, aceptas los Términos
-- y el Aviso» (aceptación tácita, sin marca de tiempo) y el mandato para operar
-- portales de facturación en nombre de la flota se encendía con UNA variable de
-- entorno global (FACTURACION_MANDATO_ACEPTADO): no quedaba evidencia, por flota,
-- de quién lo autorizó, cuándo ni con qué versión del texto.
--
-- Esta tabla es esa evidencia: una fila por (flota, usuario, documento, versión).
--   · documento: 'terminos' | 'aviso_privacidad' | 'mandato_autofacturacion'.
--   · version: la versión del texto aceptado (constantes en src/lib/legal/documentos.ts).
--   · hash_sha256: huella del texto exacto (obligatoria para el MANDATO, cuyo texto
--     vive en una constante del código; para Términos/Aviso, nulo).
--   · commit_ref: el commit desplegado cuando se aceptó (VERCEL_GIT_COMMIT_SHA): el
--     texto de esa versión se reconstruye de git.
--   · aceptado_en / user_id (quién) / revocado_en (el mandato se puede retirar).
-- No guarda IP ni correo: el «quién» es el app_user; si la cuenta se cancela por
-- ARCO, user_id pasa a NULL y la evidencia (qué versión, cuándo, de qué flota) se
-- conserva sin dato personal.
--
-- Reglas que SOLO la base garantiza (probadas en supabase/tests/0443_*.sql):
--   · idempotencia: la misma persona no acepta dos veces la misma versión;
--   · UNA sola aceptación vigente del mandato por (flota, versión);
--   · el mandato solo lo registra un `flota_admin` activo DE ESA flota;
--   · el mandato vigente es el de la versión pedida y no revocado.
-- Deny-all para anon/authenticated (RLS sin políticas): todo entra por service_role.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

create table if not exists public.aceptacion_legal (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  user_id      uuid references public.app_user(id) on delete set null,
  documento    text not null
    constraint aceptacion_legal_documento_dominio check (documento in ('terminos', 'aviso_privacidad', 'mandato_autofacturacion')),
  version      text not null
    constraint aceptacion_legal_version_forma check (length(version) between 1 and 64),
  hash_sha256  text
    constraint aceptacion_legal_hash_forma check (hash_sha256 is null or hash_sha256 ~ '^[0-9a-f]{64}$'),
  commit_ref   text
    constraint aceptacion_legal_commit_forma check (commit_ref is null or length(commit_ref) <= 64),
  aceptado_en  timestamptz not null default now(),
  revocado_en  timestamptz,
  revocado_por uuid references public.app_user(id) on delete set null,
  constraint aceptacion_legal_revocacion_posterior check (revocado_en is null or revocado_en >= aceptado_en),
  -- El texto del mandato es lo que se firma: sin su huella no hay evidencia.
  constraint aceptacion_legal_mandato_con_hash check (documento <> 'mandato_autofacturacion' or hash_sha256 is not null)
);

-- La misma persona no acepta dos veces (vigente) la misma versión del mismo documento.
create unique index if not exists aceptacion_legal_unica_por_usuario_uidx
  on public.aceptacion_legal (tenant_id, documento, version, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where revocado_en is null;
-- El mandato es de la FLOTA: una sola aceptación vigente por versión.
create unique index if not exists aceptacion_legal_mandato_unico_uidx
  on public.aceptacion_legal (tenant_id, version)
  where documento = 'mandato_autofacturacion' and revocado_en is null;
create index if not exists aceptacion_legal_tenant_idx
  on public.aceptacion_legal (tenant_id, documento, aceptado_en desc);
create index if not exists aceptacion_legal_user_idx
  on public.aceptacion_legal (user_id) where user_id is not null;

comment on table public.aceptacion_legal is
  '0443 (auditoría ola 1 #48): evidencia de aceptación de Términos, Aviso de privacidad y MANDATO de autofacturación por flota — quién (user_id), cuándo, qué versión y huella del texto. Sin IP ni correo. Escritor: lib/legal/aceptacion.ts vía registrar_aceptacion_legal; lector del candado de emisión: mandato_autofacturacion_vigente.';

alter table public.aceptacion_legal enable row level security;
revoke all on table public.aceptacion_legal from public, anon, authenticated;
grant select, insert, update on table public.aceptacion_legal to service_role;

-- ── Registrar (idempotente, validando pertenencia y rol) ───────────────────
create or replace function public.registrar_aceptacion_legal(
  p_tenant uuid,
  p_user uuid,
  p_documento text,
  p_version text,
  p_hash text default null,
  p_commit text default null
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_rol text;
  v_activo boolean;
  v_id uuid;
begin
  if p_documento not in ('terminos', 'aviso_privacidad', 'mandato_autofacturacion') then
    return jsonb_build_object('ok', false, 'motivo', 'documento desconocido');
  end if;
  if p_version is null or length(trim(p_version)) = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'falta la versión');
  end if;

  select rol, activo into v_rol, v_activo from app_user where id = p_user and tenant_id = p_tenant;
  if not found or not v_activo then
    return jsonb_build_object('ok', false, 'motivo', 'el usuario no es de esta flota o está dado de baja');
  end if;
  -- Quien obliga a la empresa a un mandato es su dueño, no cualquier rol.
  if p_documento = 'mandato_autofacturacion' and v_rol <> 'flota_admin' then
    return jsonb_build_object('ok', false, 'motivo', 'solo el dueño de la flota (flota_admin) puede otorgar el mandato');
  end if;
  if p_documento = 'mandato_autofacturacion' and (p_hash is null or p_hash !~ '^[0-9a-f]{64}$') then
    return jsonb_build_object('ok', false, 'motivo', 'el mandato exige la huella del texto aceptado');
  end if;

  insert into aceptacion_legal (tenant_id, user_id, documento, version, hash_sha256, commit_ref)
  values (p_tenant, p_user, p_documento, p_version, p_hash, p_commit)
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    -- Ya estaba aceptada (esta persona, o —en el mandato— cualquiera de la flota).
    return jsonb_build_object('ok', true, 'registrada', false, 'motivo', 'ya estaba aceptada');
  end if;
  return jsonb_build_object('ok', true, 'registrada', true, 'id', v_id);
end;
$$;

comment on function public.registrar_aceptacion_legal(uuid, uuid, text, text, text, text) is
  '0443: registra una aceptación (idempotente). El mandato exige flota_admin activo de la flota y la huella del texto. Devuelve {ok, registrada, id|motivo}.';
revoke all on function public.registrar_aceptacion_legal(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.registrar_aceptacion_legal(uuid, uuid, text, text, text, text) to service_role;

-- ── Revocar el mandato ─────────────────────────────────────────────────────
create or replace function public.revocar_mandato_autofacturacion(p_tenant uuid, p_user uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_rol text;
  v_activo boolean;
  n int;
begin
  select rol, activo into v_rol, v_activo from app_user where id = p_user and tenant_id = p_tenant;
  if not found or not v_activo or v_rol <> 'flota_admin' then
    return jsonb_build_object('ok', false, 'motivo', 'solo el dueño de la flota puede retirar el mandato');
  end if;
  update aceptacion_legal
     set revocado_en = now(), revocado_por = p_user
   where tenant_id = p_tenant and documento = 'mandato_autofacturacion' and revocado_en is null;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'revocadas', n);
end;
$$;

comment on function public.revocar_mandato_autofacturacion(uuid, uuid) is
  '0443: el dueño retira el mandato de su flota (la emisión vuelve a ensayo en la siguiente corrida). La fila se conserva con revocado_en/revocado_por: la historia no se borra.';
revoke all on function public.revocar_mandato_autofacturacion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.revocar_mandato_autofacturacion(uuid, uuid) to service_role;

-- ── El candado: ¿hay mandato vigente de ESTA versión? ──────────────────────
create or replace function public.mandato_autofacturacion_vigente(p_tenant uuid, p_version text)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from aceptacion_legal
     where tenant_id = p_tenant
       and documento = 'mandato_autofacturacion'
       and version = p_version
       and revocado_en is null
  );
$$;

comment on function public.mandato_autofacturacion_vigente(uuid, text) is
  '0443: lo que lee el candado de emisión (al_vuelo.ts): true solo si la flota aceptó ESTA versión del mandato y no la retiró.';
revoke all on function public.mandato_autofacturacion_vigente(uuid, text) from public, anon, authenticated;
grant execute on function public.mandato_autofacturacion_vigente(uuid, text) to service_role;

commit;
