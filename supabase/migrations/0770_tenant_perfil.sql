-- ═══════════════════════════════════════════════════════════════════════════
-- 0770 — PERFIL DE TENANT (`cinco_agentes`): una flota que solo ve y solo opera
--        lo de los cinco agentes más la base mínima.
--
-- Hasta hoy no existía NINGÚN recorte por flota: el gating era por ROL → ÁREA →
-- RUTA (`visibilidad.ts`) y el dueño de cualquier flota veía todo el menú. Esta
-- tabla es el DATO del recorte. La lista cerrada de rutas, acciones, recursos
-- de API y crons que el perfil deja vivos vive en CÓDIGO
-- (`visibilidad.ts` → RUTAS_PERFIL_CINCO_AGENTES y hermanas), no aquí: cambiar
-- qué cubre el perfil es un cambio de código revisable, no un UPDATE.
--
-- CONTRATO:
--   · SIN FILA = comportamiento de siempre. Ninguna otra flota cambia.
--   · CON FILA = lista cerrada: lo que el código no declara como permitido se
--     NIEGA (falla cerrado). Una ruta o acción nueva sin clasificar queda fuera.
--   · El perfil solo QUITA, nunca da: se aplica por encima del rol (igual que
--     `rolEfectivo`), así que el resultado es siempre un subconjunto de lo que
--     el rol ya permitía.
--
-- Dominio cerrado de `perfil` (CHECK): un nombre inventado rebota aquí y no
-- se convierte en un perfil que el código no conoce (que el código trataría
-- como restringido de todos modos).
--
-- RLS DENY-ALL: mismo patrón que `interruptor` (0110) e `interruptor_tenant`
-- (0297). Solo el servidor (service-role) la toca: el panel nunca escribe un
-- perfil; lo aplica el operador de Likida con `scripts/perfil/`.
--
-- BITÁCORA: cada alta, cambio o baja se asienta en `bitacora_auditoria` (0053,
-- append-only) con un TRIGGER, para que quede rastro aunque quien escriba sea
-- un script o el SQL editor y no la aplicación.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.tenant_perfil (
  tenant_id    uuid primary key references public.tenant(id) on delete cascade,
  perfil       text not null check (perfil in ('cinco_agentes')),
  -- Quién lo aplicó por última vez. `set null` y no cascade: borrar la cuenta
  -- de quien lo aplicó no debe quitar el perfil ni la evidencia (mismo criterio
  -- que `interruptor_tenant.cambiado_por`).
  cambiado_por uuid references public.app_user(id) on delete set null,
  cambiado_en  timestamptz not null default now()
);

comment on table public.tenant_perfil is
  'Perfil de módulos de UNA flota (0770). SIN FILA = comportamiento actual. Con perfil=cinco_agentes la app solo muestra y deja operar los cinco agentes y la base mínima; lo demás queda en stand-by (oculto e inoperante, sin borrar). Deny-all: solo service-role. La lista de lo permitido vive en código (visibilidad.ts).';
comment on column public.tenant_perfil.perfil is
  'Dominio cerrado. cinco_agentes = liquidación, peajes, carta porte, vigía y conductor + base mínima.';
comment on column public.tenant_perfil.cambiado_por is
  'app_user que lo aplicó por última vez (null si lo aplicó un script). El historial completo vive en bitacora_auditoria (accion perfil_tenant.*).';

-- Deny-all: enable SIN políticas. Todo acceso es service-role del servidor.
alter table public.tenant_perfil enable row level security;

-- ── Bitácora por trigger ───────────────────────────────────────────────────
create or replace function public.tenant_perfil_bitacora()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'DELETE') then
    -- Si la baja es el cascade de borrar la flota, el tenant ya no existe y la
    -- FK de la bitácora rebotaría: ahí no se asienta nada (la purga de la flota
    -- tiene su propio rastro).
    if not exists (select 1 from public.tenant where id = old.tenant_id) then
      return old;
    end if;
    insert into public.bitacora_auditoria (tenant_id, actor_id, accion, entidad, entidad_id, detalle)
    values (old.tenant_id, old.cambiado_por, 'perfil_tenant.quitar', 'tenant', old.tenant_id::text,
            jsonb_build_object('perfil', old.perfil));
    return old;
  elsif (tg_op = 'UPDATE') then
    insert into public.bitacora_auditoria (tenant_id, actor_id, accion, entidad, entidad_id, detalle)
    values (new.tenant_id, new.cambiado_por, 'perfil_tenant.cambiar', 'tenant', new.tenant_id::text,
            jsonb_build_object('de', old.perfil, 'a', new.perfil));
    return new;
  end if;
  insert into public.bitacora_auditoria (tenant_id, actor_id, accion, entidad, entidad_id, detalle)
  values (new.tenant_id, new.cambiado_por, 'perfil_tenant.aplicar', 'tenant', new.tenant_id::text,
          jsonb_build_object('perfil', new.perfil));
  return new;
end;
$$;

revoke all on function public.tenant_perfil_bitacora() from public, anon, authenticated;

drop trigger if exists tenant_perfil_bitacora_trg on public.tenant_perfil;
create trigger tenant_perfil_bitacora_trg
  after insert or update or delete on public.tenant_perfil
  for each row execute function public.tenant_perfil_bitacora();
