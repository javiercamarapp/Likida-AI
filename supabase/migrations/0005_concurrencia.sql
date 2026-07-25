-- ═══════════════════════════════════════════════════════════════════════════
-- Concurrencia y idempotencia del money-path (AUDIT_V2: CR-1, CR-2, AL-1, ME-17).
--
-- El motor de cuadre es idempotente pero la PERSISTENCIA no lo era: dos cierres
-- concurrentes creaban dos liquidaciones/dos PDFs. Aquí se fuerza a nivel DB.
-- ═══════════════════════════════════════════════════════════════════════════

-- CR-1: una sola liquidación por viaje (cierre idempotente, upsert en repo).
create unique index if not exists liquidacion_viaje_uidx on liquidacion (viaje_id);

-- ME-17: una sola conversación por (tenant, teléfono) — loadConversation ya no
-- puede duplicar filas ni reventar con maybeSingle() ante >1.
create unique index if not exists wa_conversacion_tenant_tel_uidx
  on wa_conversacion (tenant_id, telefono);

-- ── AL-1/CR-1: mutex por viaje (lease) para serializar el procesamiento ──────
-- Cada mensaje entrante corre en su propio after() concurrente. Sin serializar,
-- un "listo" puede cerrar el viaje ANTES de que el OCR de la última foto guarde
-- su gasto. Este lease serializa el procesamiento por viaje; el TTL evita
-- deadlocks si un after() muere sin liberar.
create table if not exists viaje_lock (
  viaje_id     uuid primary key,
  locked_until timestamptz not null
);

-- Tabla interna: sólo service-role. RLS ON sin policy = denegado a anon/auth.
alter table viaje_lock enable row level security;

-- Adquiere el lease de forma atómica. Devuelve true si se obtuvo (nuevo o lease
-- expirado tomado), false si otro proceso lo tiene vigente.
create or replace function try_lock_viaje(p_viaje uuid, p_ttl_ms integer)
returns boolean
language plpgsql
as $$
begin
  insert into viaje_lock (viaje_id, locked_until)
  values (p_viaje, now() + make_interval(secs => p_ttl_ms / 1000.0))
  on conflict (viaje_id) do update
    set locked_until = excluded.locked_until
    where viaje_lock.locked_until < now();   -- sólo si el lease previo expiró
  return found;                              -- true = insertado o actualizado
end $$;

-- Libera el lease (best-effort; si no libera, expira por TTL).
create or replace function unlock_viaje(p_viaje uuid)
returns void
language sql
as $$
  delete from viaje_lock where viaje_id = p_viaje;
$$;
