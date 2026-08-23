-- 0169 — Fase 3 (parcial) del plan de asistencia/siniestros
-- (docs/asistencia/PLAN-FASES.md, docs/perfil/PERFIL-OPERATIVO.md):
-- consolidar el perfil del cliente, ANTES de construir cualquier agente
-- nuevo encima.
--
-- El perfil ya existe, repartido en cinco lugares que no se hablan
-- (tenant.config, columnas de tenant, agente_cobranza_config,
-- agente_notificacion_config, conector_credencial). No se inventa un sexto:
-- se le da un lugar propio, `tenant.perfil jsonb`, y NO otra llave de
-- `config` — `getConfig()` fusiona los defaults de la demo, así que
-- estructuralmente no puede contestar "¿esto lo declaró el cliente o es
-- nuestro relleno?", que es exactamente la pregunta del perfil.
--
-- Solo vive aquí lo DECLARADO (o detectado con certeza) por el cliente. Lo
-- INFERIDO (Mitad A de PERFIL-OPERATIVO.md: modalidad de compra de diésel,
-- doble captura, etc.) se recalcula cada mes y se muestra — nunca se
-- persiste como hecho: un agente que quiera actuar sobre una inferencia
-- tiene que llamar una función que no existe (`decidir()`, en
-- perfil/preguntas.ts, no acepta procedencia 'inferido').
--
-- Historial con TRIGGER, no por convención: `actualizarFacilidad15` (código
-- existente) ya escribe sin bitácora y nadie lo notó — ese es el patrón de
-- bug que esto existe para no repetir. `perfil_actualizado_por` viaja en el
-- MISMO UPDATE que `perfil` (mismo patrón que `resuelto_por` en
-- consolidado.ts: el actor lo declara quien llama, no `auth.uid()` — el
-- cliente admin bypassa RLS y no siempre trae un JWT de usuario).
--
-- NO incluye en esta migración (deferido a propósito, documentado en
-- perfil/preguntas.ts): el sello `perfil_version_id` en `liquidacion` y
-- `liquidacion_historico` que pide el plan — requiere tocar
-- `guardar_liquidacion_tx` (el RPC del camino de dinero) y merece su propia
-- pasada con las pruebas de ese RPC, no colarse aquí.
alter table public.tenant add column if not exists perfil jsonb not null default '{}';
alter table public.tenant add column if not exists perfil_actualizado_por uuid references public.app_user(id) on delete set null;

comment on column public.tenant.perfil is
  'Lo que el cliente DECLARÓ (o se detectó con certeza) sobre cómo se maneja su flota, con procedencia por campo. NUNCA se escribe con procedencia "inferido" — eso se recalcula y se muestra, no se persiste. Ver perfil/preguntas.ts.';
comment on column public.tenant.perfil_actualizado_por is
  'app_user que hizo el último UPDATE de perfil, escrito en el MISMO statement que perfil (lo lee el trigger de abajo). NULL si lo tocó un proceso del sistema.';

create table if not exists public.tenant_perfil_version (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  perfil jsonb not null,
  actualizado_por uuid references public.app_user(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.tenant_perfil_version is
  'Una fila por cada cambio de tenant.perfil (trigger, no convención). Bitácora, no se edita ni se borra desde la app.';

create index if not exists idx_tenant_perfil_version_tenant
  on public.tenant_perfil_version (tenant_id, created_at desc);

-- SECURITY INVOKER (el default, sin `security definer`): el UPDATE de
-- `perfil` SIEMPRE lo hace `supabaseAdmin()` (service role, bypassa RLS), así
-- que el trigger no necesita privilegios prestados — y sin ellos, un
-- `security definer` expuesto por PostgREST como RPC pública (`anon`/
-- `authenticated`, aunque falle al no correr en contexto de trigger) deja de
-- ser una superficie que vale la pena revisar. Hallazgo de `get_advisors`
-- (security) al aplicar esta migración: SECURITY DEFINER en un trigger que
-- no lo necesitaba.
create or replace function public.sellar_perfil_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.perfil is distinct from old.perfil then
    insert into public.tenant_perfil_version (tenant_id, perfil, actualizado_por)
    values (new.id, new.perfil, new.perfil_actualizado_por);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sellar_perfil_version on public.tenant;
create trigger trg_sellar_perfil_version
  after update of perfil on public.tenant
  for each row execute function public.sellar_perfil_version();

comment on trigger trg_sellar_perfil_version on public.tenant is
  'Sella una fila en tenant_perfil_version en cada cambio real de perfil (is distinct from — un UPDATE que no cambia el valor no ensucia el historial). Con trigger, no por convención: actualizarFacilidad15 ya prueba que "hay que acordarse de loguear" falla.';

-- Deny-all a propósito, mismo patrón que agente_cobranza_config (0089) y
-- prospecto_contacto (0118): solo supabaseAdmin() (server, bypassa RLS) la
-- toca. tenant.perfil ya queda cubierto por las policies existentes de
-- `tenant` (tenant_self, solo SELECT desde 0078 — los UPDATEs ya pasaban
-- por el server).
alter table public.tenant_perfil_version enable row level security;
