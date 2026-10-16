-- ═══════════════════════════════════════════════════════════════════════════
-- 0794 — Carta Porte: el CCP ya timbrado que el TMS avisa (T-A3-33).
--
-- Qué es: cuando el equipo del cliente timbra el CCP dentro de su TMS, el TMS puede avisarnos (PDF + XML). Aquí se
-- REGISTRA ese aviso —el UUID fiscal que ya existe, este módulo no timbra— y, solo si la flota activó «responder al
-- cliente», se contesta por correo al remitente original del documento (con confirmación humana la primera vez por
-- cliente). El interruptor nace APAGADO: es un deseo del cliente, no un requisito, y el TMS aún no confirma si avisa.
--
--   · cp_ccp_timbrado: una fila por UUID fiscal y flota (unique tenant_id + uuid ⇒ el mismo aviso dos veces es una sola
--     fila y UN solo correo). Cuelga del documento y del envío de la MISMA flota (FK compuestas): un CCP no se liga a
--     un envío de otra flota. `estado` y `respondido_en` son coherentes por CHECK. Guarda solo RUTAS de Storage y el
--     destino; nunca el contenido del XML.
--   · cp_salida_config.responder_ccp: el interruptor por flota (ADD COLUMN, default false).
--   · RPC (security definer, solo service_role): cp_ccp_marcar_respondido (UPDATE condicional atómico: gana UNA sola
--     llamada concurrente) y cp_ccp_liberar_respuesta (suelta el candado si el correo NO salió, para poder reintentar).
--
-- No toca ninguna función ni constraint existente. Deny-all + service_role. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.cp_ccp_timbrado (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete cascade,
  documento_id   uuid not null,
  envio_id       uuid not null,
  -- El UUID fiscal del timbre (TimbreFiscalDigital@UUID), en minúsculas.
  uuid           text not null,
  pdf_ruta       text not null,
  xml_ruta       text not null,
  recibido_en    timestamptz not null default now(),
  respondido_en  timestamptz,
  destino_correo text,
  estado         text not null default 'guardado',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint cp_ccp_timbrado_doc_tenant_fkey
    foreign key (documento_id, tenant_id) references public.cp_documento (id, tenant_id) on delete cascade,
  constraint cp_ccp_timbrado_envio_tenant_fkey
    foreign key (envio_id, tenant_id) references public.cp_envio_tms (id, tenant_id) on delete cascade,
  constraint cp_ccp_timbrado_id_tenant_key unique (id, tenant_id),
  constraint cp_ccp_timbrado_uuid_unico unique (tenant_id, uuid),
  constraint cp_ccp_timbrado_uuid_forma check (uuid ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  constraint cp_ccp_timbrado_estado_dominio check (estado in ('guardado', 'pendiente_confirmacion', 'respondido', 'error_envio')),
  constraint cp_ccp_timbrado_rutas_largo check (char_length(pdf_ruta) between 1 and 400 and char_length(xml_ruta) between 1 and 400),
  constraint cp_ccp_timbrado_destino_forma check (
    destino_correo is null
    or (char_length(destino_correo) <= 254 and destino_correo ~ '^[^@\s]+@[^@\s]+$')),
  -- «respondido» y «tiene fecha de respuesta» son lo mismo: el candado y el estado no se desfasan.
  constraint cp_ccp_timbrado_respondido_coherente check ((estado = 'respondido') = (respondido_en is not null)),
  constraint cp_ccp_timbrado_respondido_con_destino check (estado <> 'respondido' or destino_correo is not null)
);
create index if not exists cp_ccp_timbrado_envio_idx on public.cp_ccp_timbrado (tenant_id, envio_id);
create index if not exists cp_ccp_timbrado_destino_idx
  on public.cp_ccp_timbrado (tenant_id, destino_correo) where estado = 'respondido';
create index if not exists cp_ccp_timbrado_pendientes_idx
  on public.cp_ccp_timbrado (tenant_id, recibido_en desc) where estado in ('pendiente_confirmacion', 'error_envio');
comment on table public.cp_ccp_timbrado is
  'CCP ya timbrado que el TMS avisa (0794): UUID fiscal único por flota, rutas de PDF/XML en Storage y estado de la respuesta por correo al cliente. Este módulo registra el UUID, no timbra.';

alter table public.cp_ccp_timbrado enable row level security;
revoke all on public.cp_ccp_timbrado from public, anon, authenticated;
grant select, insert, update, delete on public.cp_ccp_timbrado to service_role;

-- ── El interruptor por flota: APAGADO por omisión ───────────────────────────
alter table public.cp_salida_config
  add column if not exists responder_ccp boolean not null default false;
comment on column public.cp_salida_config.responder_ccp is
  '«Responder al cliente» con el CCP timbrado (0794). Apagado por omisión: sin activarlo se guarda el aviso y NO se manda ningún correo.';

-- ── RPC ─────────────────────────────────────────────────────────────────────
-- «Responder UNA vez»: UPDATE condicional atómico. Dos llamadas concurrentes: solo una recibe true.
create or replace function public.cp_ccp_marcar_respondido(p_tenant uuid, p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n int;
begin
  update public.cp_ccp_timbrado t
     set estado = 'respondido', respondido_en = now(), updated_at = now()
   where t.id = p_id and t.tenant_id = p_tenant
     and t.respondido_en is null
     and t.estado in ('guardado', 'pendiente_confirmacion', 'error_envio')
     and t.destino_correo is not null;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;
revoke all on function public.cp_ccp_marcar_respondido(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cp_ccp_marcar_respondido(uuid, uuid) to service_role;

-- Suelta el candado cuando el correo NO salió: queda en `error_envio` y se puede reintentar.
create or replace function public.cp_ccp_liberar_respuesta(p_tenant uuid, p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n int;
begin
  update public.cp_ccp_timbrado t
     set estado = 'error_envio', respondido_en = null, updated_at = now()
   where t.id = p_id and t.tenant_id = p_tenant and t.estado = 'respondido';
  get diagnostics n = row_count;
  return n > 0;
end;
$$;
revoke all on function public.cp_ccp_liberar_respuesta(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cp_ccp_liberar_respuesta(uuid, uuid) to service_role;
