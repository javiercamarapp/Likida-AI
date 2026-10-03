-- ═══════════════════════════════════════════════════════════════════════════
-- 0643 — Liquidación externa: el AVISO de discrepancia deja de ser un «una vez y se acabó».
--
-- Cuando el chofer responde «No coincide», la oficina debe enterarse. Hasta aquí el aviso salía una sola vez,
-- sin red: si WhatsApp lo rechazaba o el proceso moría, la discrepancia quedaba marcada en el panel y nadie se
-- enteraba. Esta tabla guarda el ESTADO del aviso — una fila por (liquidación, ciclo), con ciclo = cada vez que el
-- chofer vuelve a decir «No coincide» —, para que el cron lo reintente, el panel lo muestre y «Reavisar» lo rearme.
--
--   · estado: pendiente (toca mandarlo) · enviando (alguien lo manda, con arriendo) · enviado · fallido (se agotaron los intentos);
--   · telefonos_aceptados: a quién YA le llegó (o quedó en el outbox): un reintento va solo a los faltantes, no repite
--     el WhatsApp a quien ya lo recibió;
--   · tarea_id: la tarea durable que se abrió para una persona en la cola del orquestador (0650), motivo
--     `diferencia_liquidacion`, para que la discrepancia no dependa de que un WhatsApp salga. Sin FK a propósito: la 0650
--     es posterior y el código funciona sin ella.
--
-- El código funciona contra una base SIN esta migración (cae al aviso de una sola vez de antes), así que aplicarla
-- no es requisito para desplegar. Escribe solo service_role (RPC de la 0644); la lectura es de quien ve finanzas.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.liquidacion_aviso_discrepancia (
  liquidacion_externa_id uuid        not null,
  tenant_id              uuid        not null references public.tenant(id) on delete cascade,
  ciclo                  integer     not null,
  estado                 text        not null default 'pendiente',
  intentos               integer     not null default 0,
  proximo_intento_en     timestamptz not null default now(),
  ultimo_error           text,
  claim_token            uuid,
  claim_expira_en        timestamptz,
  telefonos_aceptados    text[]      not null default '{}',
  tarea_id               uuid,
  creado_en              timestamptz not null default now(),
  actualizado_en         timestamptz not null default now(),
  enviado_en             timestamptz,
  primary key (liquidacion_externa_id, ciclo),
  constraint liquidacion_aviso_discrepancia_liq_tenant_fkey
    foreign key (liquidacion_externa_id, tenant_id) references public.liquidacion_externa (id, tenant_id) on delete cascade,
  constraint liquidacion_aviso_discrepancia_ciclo_pos check (ciclo >= 1),
  constraint liquidacion_aviso_discrepancia_estado check (estado in ('pendiente', 'enviando', 'enviado', 'fallido')),
  constraint liquidacion_aviso_discrepancia_intentos check (intentos >= 0),
  constraint liquidacion_aviso_discrepancia_error_largo check (ultimo_error is null or char_length(ultimo_error) <= 500),
  -- Un arriendo solo existe mientras alguien lo manda; enviado ⇔ trae su hora.
  constraint liquidacion_aviso_discrepancia_claim_coherente check (
    (estado = 'enviando') = (claim_token is not null and claim_expira_en is not null)
  ),
  constraint liquidacion_aviso_discrepancia_enviado_coherente check ((estado = 'enviado') = (enviado_en is not null)),
  constraint liquidacion_aviso_discrepancia_telefonos_tope check (cardinality(telefonos_aceptados) <= 10)
);

comment on table public.liquidacion_aviso_discrepancia is
  '0643: estado del aviso a la oficina cuando un chofer responde «No coincide». Una fila por (liquidación, ciclo): pendiente → enviando (arriendo) → enviado | fallido; el cron reintenta y el panel permite reavisar.';

create index if not exists liquidacion_aviso_discrepancia_trabajo_idx
  on public.liquidacion_aviso_discrepancia (proximo_intento_en) where estado in ('pendiente', 'enviando');
create index if not exists liquidacion_aviso_discrepancia_tenant_idx
  on public.liquidacion_aviso_discrepancia (tenant_id);

alter table public.liquidacion_aviso_discrepancia enable row level security;

drop policy if exists tenant_lee on public.liquidacion_aviso_discrepancia;
create policy tenant_lee on public.liquidacion_aviso_discrepancia for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_finanzas()) or is_superadmin());

revoke all on public.liquidacion_aviso_discrepancia from public, anon, authenticated;
grant select, insert, update, delete on public.liquidacion_aviso_discrepancia to service_role;
