-- ═══════════════════════════════════════════════════════════════════════════
-- 0939 — VERSIÓN DE INTERFAZ POR TENANT (`tenant_ui`): qué piel del panel ve una flota.
--
-- NÚMERO PROVISIONAL: el orquestador fija el definitivo al abrir el PR de release
-- (debe ser posterior a la última migración fusionada en master y de prefijo
-- único; la compuerta de deploy falla con prefijos repetidos). Renombrar el
-- archivo es lo único que cambia: nada en el código cita este número.
--
-- Es la BANDERA del rediseño (`data-ui="v2"`). Se eligió una tabla propia y no
-- `tenant_perfil` (CHECK de un solo valor, «el perfil solo quita») ni
-- `tenant.config` (mezcla política fiscal) ni una variable de Vercel (obliga a
-- redeploy):
--   · SIN FILA = v1 (el panel de siempre). Ninguna otra flota cambia.
--   · CON FILA = la versión que diga. `v1` explícito equivale a no tener fila.
--   · FALLA HACIA v1: si la tabla no se puede leer (o aún no existe), el código
--     pinta v1. Es la dirección opuesta a `tenant_perfil` (que falla cerrado):
--     aquí lo seguro es el panel que ya conocen, no el nuevo.
--   · Activar o revertir una flota es un INSERT/UPDATE/DELETE (0 builds, ≤30 s
--     con la caché de 30 s de `perfil_tenant.ts`): `scripts/ui/aplicar-ui-v2.sh`.
--
-- RLS DENY-ALL: mismo patrón que `tenant_perfil` (0770). Solo el servidor
-- (service-role) la toca; el panel nunca escribe una versión.
-- BITÁCORA: cada alta, cambio o baja se asienta en `bitacora_auditoria` (0053,
-- append-only) con un TRIGGER, igual que 0770.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.tenant_ui (
  tenant_id    uuid primary key references public.tenant(id) on delete cascade,
  version      text not null check (version in ('v1', 'v2')),
  -- `set null` y no cascade: borrar la cuenta de quien lo cambió no debe quitar
  -- la versión ni la evidencia (mismo criterio que `tenant_perfil.cambiado_por`).
  cambiado_por uuid references public.app_user(id) on delete set null,
  cambiado_en  timestamptz not null default now()
);

comment on table public.tenant_ui is
  'Versión de interfaz de UNA flota (0939). SIN FILA = v1 (el panel de siempre). v2 = el rediseño (data-ui="v2"). Falla hacia v1. Deny-all: solo service-role.';
comment on column public.tenant_ui.version is
  'Dominio cerrado: v1 | v2. Un nombre inventado rebota aquí.';
comment on column public.tenant_ui.cambiado_por is
  'app_user que lo cambió por última vez (null si lo hizo un script). El historial completo vive en bitacora_auditoria (accion tenant_ui.*).';

-- Deny-all: enable SIN políticas. Todo acceso es service-role del servidor.
alter table public.tenant_ui enable row level security;

-- ── Bitácora por trigger ───────────────────────────────────────────────────
create or replace function public.tenant_ui_bitacora()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'DELETE') then
    -- Si la baja es el cascade de borrar la flota, el tenant ya no existe y la
    -- FK de la bitácora rebotaría: ahí no se asienta nada.
    if not exists (select 1 from public.tenant where id = old.tenant_id) then
      return old;
    end if;
    insert into public.bitacora_auditoria (tenant_id, actor_id, accion, entidad, entidad_id, detalle)
    values (old.tenant_id, old.cambiado_por, 'tenant_ui.quitar', 'tenant', old.tenant_id::text,
            jsonb_build_object('version', old.version));
    return old;
  elsif (tg_op = 'UPDATE') then
    insert into public.bitacora_auditoria (tenant_id, actor_id, accion, entidad, entidad_id, detalle)
    values (new.tenant_id, new.cambiado_por, 'tenant_ui.cambiar', 'tenant', new.tenant_id::text,
            jsonb_build_object('de', old.version, 'a', new.version));
    return new;
  end if;
  insert into public.bitacora_auditoria (tenant_id, actor_id, accion, entidad, entidad_id, detalle)
  values (new.tenant_id, new.cambiado_por, 'tenant_ui.aplicar', 'tenant', new.tenant_id::text,
          jsonb_build_object('version', new.version));
  return new;
end;
$$;

revoke all on function public.tenant_ui_bitacora() from public, anon, authenticated;

drop trigger if exists tenant_ui_bitacora_trg on public.tenant_ui;
create trigger tenant_ui_bitacora_trg
  after insert or update or delete on public.tenant_ui
  for each row execute function public.tenant_ui_bitacora();
