-- ═══════════════════════════════════════════════════════════════════════════
-- 0130 · EL HISTORIAL DE TOQUES — timeline por prospecto (backlog Attio del
-- análisis del 17-ago; desbloqueada con el sbp_ fresco de Javier).
--
-- Cada contacto con un prospecto deja fila: el tap de WhatsApp/correo desde
-- el Cerebro la escribe sola, y la nota manual también cabe. Con esto la
-- tarjeta dice "último toque hace 12 días" y el filtro "sin contactar en N
-- días" deja de ser imposible.
--
-- RLS sin policies: mismas puertas que el resto del Cerebro (service-role
-- tras superadmin re-chequeado). El prospecto borrado se lleva su historial
-- (cascade): un toque sin prospecto no le habla a nadie.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.prospecto_toque (
  id           uuid primary key default gen_random_uuid(),
  prospecto_id uuid not null references public.prospecto(id) on delete cascade,
  canal        text not null
               constraint toque_canal_dominio
               check (canal in ('whatsapp', 'correo', 'llamada', 'visita', 'nota')),
  resumen      text,
  actor        text not null,
  creado_en    timestamptz not null default now()
);

-- La consulta viva es "el último toque de cada prospecto".
create index if not exists idx_toque_prospecto_fecha
  on public.prospecto_toque (prospecto_id, creado_en desc);

alter table public.prospecto_toque enable row level security;
