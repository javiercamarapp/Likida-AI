-- ═══════════════════════════════════════════════════════════════════════════
-- 0198 — ASISTENCIA EN CARRETERA Y SINIESTROS (Fase 4, núcleo)
--
-- El plano técnico (docs/asistencia/, plan maestro 26-ago) es explícito:
-- `incidencia` se AMPLÍA, no se duplica. Hoy la foto de un camión volcado
-- paga OCR y el chofer recibe "esa foto salió difícil de leer" — el circuito
-- de siniestros necesita tipos propios, severidad crítica, y las tablas que
-- el despachador consulta (póliza con su 800 de siniestros, directorio de
-- proveedores, contactos del operador) más la bitácora por incidencia.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Tipos nuevos y prioridad crítica (patrón drop/add de la 0044) ───────
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'incidencia_tipo_dominio' and conrelid = 'public.incidencia'::regclass
  ) then
    alter table public.incidencia drop constraint incidencia_tipo_dominio;
  end if;
  alter table public.incidencia
    add constraint incidencia_tipo_dominio
    check (tipo in ('retraso', 'averia', 'dano', 'faltante', 'desvio',
                    'siniestro', 'robo', 'emergencia_medica', 'varado', 'bloqueo'));

  if exists (
    select 1 from pg_constraint
    where conname = 'incidencia_prioridad_dominio' and conrelid = 'public.incidencia'::regclass
  ) then
    alter table public.incidencia drop constraint incidencia_prioridad_dominio;
  end if;
  alter table public.incidencia
    add constraint incidencia_prioridad_dominio
    check (prioridad in ('baja', 'media', 'alta', 'critica'));
end $$;

-- ── 2. Columnas del circuito de asistencia (todas aditivas) ────────────────
-- `operador_id` no estaba en el plano y ES NECESARIA: la incidencia de 0047
-- solo se ata al viaje, pero el punto C del plano (chofer SIN viaje abierto)
-- exige saber de quién es la emergencia — sin esta columna, dos choferes sin
-- viaje de la misma flota compartirían "la incidencia abierta" y el segundo
-- accidente no avisaría al jefe.
alter table public.incidencia add column if not exists operador_id uuid references public.operador(id) on delete set null;
alter table public.incidencia add column if not exists lat double precision;
alter table public.incidencia add column if not exists lng double precision;
alter table public.incidencia add column if not exists hay_lesionados boolean;
alter table public.incidencia add column if not exists unidad_movible boolean;
alter table public.incidencia add column if not exists nivel_escalado int not null default 0;
alter table public.incidencia add column if not exists reconocida_en timestamptz;
alter table public.incidencia add column if not exists reconocida_por uuid references public.app_user(id) on delete set null;
alter table public.incidencia add column if not exists notificar_desde timestamptz;

comment on column public.incidencia.hay_lesionados is
  'NULL significa NO PREGUNTADO — jamás false por defecto. Un false aquí es una afirmación ("no hay lesionados") que solo el chofer puede hacer; rellenarlo por default convertiría el silencio en un parte médico.';
comment on column public.incidencia.nivel_escalado is
  '0 chofer · 1 jefe · 2 dueño · 3 seguros · 4 emergencia. Monótono: el claim del escalamiento (Fase 5) solo sube. A diferencia del sello de escalar_viaje, aquí TIENE que volver a disparar — que el nivel 1 no conteste es el caso de uso.';
comment on column public.incidencia.notificar_desde is
  'Aviso DIFERIDO por ventana horaria (solo ámbar; el rojo la ignora siempre). NULL = notificar ya.';

-- ── 3. Directorio de emergencia por flota ──────────────────────────────────
create table if not exists public.proveedor_emergencia (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  tipo          text not null check (tipo in ('grua', 'llantera', 'mecanico', 'medico', 'otro')),
  nombre        text not null,
  telefono      text not null,
  lat           double precision,
  lng           double precision,
  radio_km      numeric,
  verificado_en timestamptz,
  verificado_por uuid references public.app_user(id) on delete set null,
  notas         text,
  created_at    timestamptz not null default now()
);
comment on table public.proveedor_emergencia is
  'Directorio de emergencia POR FLOTA. Los teléfonos no viven en el prompt del modelo: viven aquí, con quién los verificó y cuándo — el guardia de salida del agente (fase posterior) rechaza cualquier número que no salga de esta tabla. `verificado_en` NULL = capturado pero sin confirmar por teléfono: el agente lo rotula así.';

-- ── 4. Póliza de la flota — el 800 de siniestros es EL dato ────────────────
create table if not exists public.flota_poliza (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenant(id) on delete cascade,
  aseguradora         text not null,
  numero_poliza       text not null,
  telefono_siniestros text not null,
  vigencia_hasta      date,
  cobertura           text,
  created_at          timestamptz not null default now()
);
comment on table public.flota_poliza is
  'Hoy `unidad.poliza_vence` es una fecha suelta. Lo que el circuito de siniestros necesita es a QUIÉN marcar: aseguradora, número y el 800 de siniestros. Likida NUNCA marca por su cuenta (una llamada automática abre un siniestro, que es dinero y acto jurídico) — esta tabla le da al humano el dato en la mano.';

-- ── 5. Contactos de emergencia del operador ────────────────────────────────
create table if not exists public.contacto_emergencia (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenant(id) on delete cascade,
  operador_id          uuid not null references public.operador(id) on delete cascade,
  nombre               text not null,
  telefono             text not null,
  parentesco           text,
  avisar_si_lesionados boolean not null default false,
  created_at           timestamptz not null default now()
);
comment on column public.contacto_emergencia.avisar_si_lesionados is
  'FALSE por default A PROPÓSITO: esta fila guarda a un familiar que nunca aceptó ningún aviso de privacidad. Avisarle es una decisión que la flota activa explícitamente por contacto, no un default — y el aviso de privacidad del operador debe declararlo antes de que se capture el primero.';

-- ── 6. Bitácora por incidencia (append-only por convención) ────────────────
create table if not exists public.incidencia_evento (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  incidencia_id uuid not null references public.incidencia(id) on delete cascade,
  tipo          text not null,
  detalle       jsonb,
  wa_message_id text,
  created_at    timestamptz not null default now()
);
comment on table public.incidencia_evento is
  'Bitácora APPEND-ONLY por incidencia (abierta, aviso_jefe_enviado/fallido, reconocida, mensaje_adicional, escalada...). NO se reusa bitacora_auditoria — aquella es administrativa y cross-tenant. Append-only por convención + escritor único (asistencia_wa.ts): service_role bypassa RLS, así que la base no puede impedir un UPDATE — el test estructural del escritor único es la guardia. `unique (incidencia_id, wa_message_id)` es la llave de idempotencia: el mismo mensaje de WhatsApp reentregado no duplica el evento.';

-- Parcial: los eventos SIN mensaje de WhatsApp (los que emite el sistema)
-- no compiten entre sí por la unicidad.
create unique index if not exists incidencia_evento_wa_unico
  on public.incidencia_evento (incidencia_id, wa_message_id)
  where wa_message_id is not null;

create index if not exists incidencia_evento_incidencia_idx
  on public.incidencia_evento (incidencia_id, created_at);

-- Para el cron de escalamiento (Fase 5) y el panel: las abiertas de una flota
-- por severidad. El índice de 0047 (tenant, estado, prioridad) ya cubre casi
-- todo; este añade el filtro por reconocimiento pendiente.
create index if not exists incidencia_sin_reconocer_idx
  on public.incidencia (tenant_id, abierta_en)
  where reconocida_en is null and estado <> 'resuelta';

-- ── 7. RLS deny-all + revoke (doble candado, patrón 0186/0196) ─────────────
alter table public.proveedor_emergencia enable row level security;
alter table public.flota_poliza         enable row level security;
alter table public.contacto_emergencia  enable row level security;
alter table public.incidencia_evento    enable row level security;

revoke all on public.proveedor_emergencia from public, anon, authenticated;
revoke all on public.flota_poliza         from public, anon, authenticated;
revoke all on public.contacto_emergencia  from public, anon, authenticated;
revoke all on public.incidencia_evento    from public, anon, authenticated;
grant select, insert, update, delete on public.proveedor_emergencia to service_role;
grant select, insert, update, delete on public.flota_poliza         to service_role;
grant select, insert, update, delete on public.contacto_emergencia  to service_role;
grant select, insert, update, delete on public.incidencia_evento    to service_role;

-- ── 8. Las FK con tenant (la regla de la 0028/0145, que el bloque 112 vigila) ──
-- Toda FK entre dos tablas con tenant_id lleva su COMPUESTA: sin ella, un
-- autenticado de la flota A puede colgar su fila del padre de la flota B.
-- El bloque auto-descubriente de la 0145 se pone ROJO en CI con cualquier FK
-- nueva que no la traiga — estas tres son las de esta migración.
do $$
begin
  -- incidencia es DESTINO por primera vez (incidencia_evento le apunta):
  -- necesita el unique (id, tenant_id) que la 0145 les dio a los destinos.
  if not exists (
    select 1 from pg_constraint
    where conname = 'incidencia_id_tenant_key' and conrelid = 'public.incidencia'::regclass
  ) then
    alter table public.incidencia add constraint incidencia_id_tenant_key unique (id, tenant_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'incidencia_operador_tenant_fkey' and conrelid = 'public.incidencia'::regclass
  ) then
    alter table public.incidencia
      add constraint incidencia_operador_tenant_fkey
      foreign key (operador_id, tenant_id) references public.operador (id, tenant_id)
      on delete set null (operador_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'contacto_emergencia_operador_tenant_fkey' and conrelid = 'public.contacto_emergencia'::regclass
  ) then
    alter table public.contacto_emergencia
      add constraint contacto_emergencia_operador_tenant_fkey
      foreign key (operador_id, tenant_id) references public.operador (id, tenant_id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'incidencia_evento_incidencia_tenant_fkey' and conrelid = 'public.incidencia_evento'::regclass
  ) then
    alter table public.incidencia_evento
      add constraint incidencia_evento_incidencia_tenant_fkey
      foreign key (incidencia_id, tenant_id) references public.incidencia (id, tenant_id)
      on delete cascade;
  end if;
end $$;
