-- ═══════════════════════════════════════════════════════════════════════════
-- 0832 — Carta Porte: REFERENCIA COMERCIAL del cliente en el viaje y regla «exige referencia» por cliente (T-A3-65).
--
-- Qué es: la referencia del cliente (la que él necesita para cobrar) NO es un campo del CCP ni obliga al tránsito: es
-- asunto de Comercial y de la carta de instrucciones. Se captura en el requerimiento, FUERA del documento fiscal, y por
-- cliente se puede exigir («con y sin» se compara). Nada bloquea el viaje ni el timbrado: solo alimenta un tablero de
-- referencias pendientes.
--   · cp_cliente_referencia: UNA fila por cliente con `exige_referencia` (default false: sin fila = no la exige).
--   · cp_viaje_referencia:   la referencia capturada de UN viaje (opcional; sin fila = sin referencia).
-- Rango extra de A3 (0830–0839, slot propuesto 0832). Aditiva: dos tablas nuevas y vacías, sin seed; no toca nada
-- existente. Idempotente.
--
-- Reglas: deny-all + service_role (igual que 0792/0830). FK compuestas (…, tenant_id) → cliente / viaje: una fila no
-- cuelga de otra flota; borrar el cliente o el viaje CASCADA. La referencia: 1 a 60 caracteres, sin espacios en los
-- bordes ni caracteres de control.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.cp_cliente_referencia (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenant(id) on delete cascade,
  cliente_id         uuid not null,
  exige_referencia   boolean not null default false,
  updated_by         uuid references public.app_user(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint cp_cliente_referencia_cliente_fkey
    foreign key (cliente_id, tenant_id) references public.cliente (id, tenant_id) on delete cascade,
  constraint cp_cliente_referencia_unico unique (tenant_id, cliente_id)
);
comment on table public.cp_cliente_referencia is
  'Regla por cliente: exige_referencia (0832). Sin fila = no la exige. La referencia no es campo del CCP; nada bloquea por ella.';

create table if not exists public.cp_viaje_referencia (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  viaje_id      uuid not null,
  referencia    text not null,
  capturada_en  timestamptz not null default now(),
  capturada_por uuid references public.app_user(id) on delete set null,
  constraint cp_viaje_referencia_viaje_fkey
    foreign key (viaje_id, tenant_id) references public.viaje (id, tenant_id) on delete cascade,
  constraint cp_viaje_referencia_unico unique (tenant_id, viaje_id),
  constraint cp_viaje_referencia_forma check (
    char_length(referencia) between 1 and 60
    and referencia = btrim(referencia)
    and referencia !~ '[[:cntrl:]]'
  )
);
comment on table public.cp_viaje_referencia is
  'Referencia comercial del cliente capturada en el requerimiento de un viaje (0832). Opcional; NO entra al XML del CCP.';

alter table public.cp_cliente_referencia enable row level security;
alter table public.cp_viaje_referencia enable row level security;
revoke all on public.cp_cliente_referencia from public, anon, authenticated;
revoke all on public.cp_viaje_referencia from public, anon, authenticated;
grant select, insert, update, delete on public.cp_cliente_referencia to service_role;
grant select, insert, update, delete on public.cp_viaje_referencia to service_role;
