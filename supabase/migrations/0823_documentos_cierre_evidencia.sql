-- ═══════════════════════════════════════════════════════════════════════════
-- 0823 — AGENTE 5 «CONDUCTOR» (T-A5-53/54, R24/R25): pedir y recibir los
-- documentos de cierre que cada cliente exige (catálogo de la 0809), y la
-- contingencia de fotos ilegibles de celulares de gama baja.
--
-- QUÉ YA EXISTÍA (no se duplica):
--   · `cliente_documento_requerido` (0809): el catálogo — qué documentos pide
--     cada cliente, básico/complementario, con firma/sello. Sin filas = solo
--     el POD de siempre.
--   · `viaje_hito_evidencia` (0385): la foto de evidencia de un hito, con
--     `tipo` CERRADO a ('sello', 'anden', 'recibido', 'otra').
--
-- QUÉ AGREGA ESTA MIGRACIÓN:
--   1. Amplía el CHECK de `viaje_hito_evidencia.tipo` con 'documento_cierre':
--      la foto de UN documento del catálogo, colgada del hito `salida_descarga`
--      (el fin de la descarga, cuando se piden los documentos). `NOT VALID` +
--      `VALIDATE` envuelto: la tabla es la más fotografiada del Conductor y no
--      se le impone un escaneo bloqueante; si una fila vieja no calza (no
--      debería, el valor es nuevo) la restricción sigue `NOT VALID` y el
--      NOTICE lo dice, sin tumbar el deploy.
--   2. `viaje_hito_evidencia.documento_requerido_id`: A CUÁL documento del
--      catálogo pertenece esa foto. NULL = tipo distinto de 'documento_cierre',
--      o una foto que SÍ es de un documento de cierre pero cuya categoría no
--      se pudo determinar por caption (T-A5-53: «queda por revisar»).
--   3. `viaje_documento_cierre`: la SOLICITUD y su seguimiento, uno por
--      (viaje, documento). Guarda el SNAPSHOT del catálogo al momento de
--      pedirlo (nombre/tipo pueden cambiar después en `cliente_documento_
--      requerido` sin alterar lo ya solicitado), el estado (pendiente /
--      recibido / revisar), el contador de reintentos por ILEGIBILIDAD
--      (T-A5-54: una foto chica/oscura/borrosa pide repetir UNA vez; al
--      segundo intento fallido se acepta igual, marcada «revisar» — nunca
--      bloquea el viaje) y la respuesta del chofer a la plantilla N11
--      («Ya los envié» / «Me falta uno»).
--
-- Solo aditiva e idempotente (create/alter … if not exists, drop … if exists,
-- reaplicable sin error). Nace VACÍA: sin catálogos ni datos de ningún
-- cliente real. RLS con la misma política de lectura que `viaje_hito_
-- evidencia` (0385) y `cliente_documento_requerido` (0809); la escritura solo
-- la hace el servidor (service_role).
--
-- Reversa manual (no se corre sola):
--   drop table if exists public.viaje_documento_cierre;
--   alter table public.viaje_hito_evidencia drop column if exists documento_requerido_id;
--   -- el CHECK de tipo se deja ampliado: retirar 'documento_cierre' exigiría
--   -- primero borrar o reclasificar las filas que ya lo usen.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Ampliar el CHECK de `viaje_hito_evidencia.tipo` ──────────────────────
alter table public.viaje_hito_evidencia drop constraint if exists viaje_hito_evidencia_tipo;
alter table public.viaje_hito_evidencia add constraint viaje_hito_evidencia_tipo
  check (tipo in ('sello', 'anden', 'recibido', 'otra', 'documento_cierre')) not valid;

do $$
begin
  begin
    alter table public.viaje_hito_evidencia validate constraint viaje_hito_evidencia_tipo;
  exception when others then
    raise notice '0823: viaje_hito_evidencia_tipo sigue NOT VALID (hay filas previas que no cumplen): %', sqlerrm;
  end;
end $$;

-- ── 2. A cuál documento del catálogo pertenece la foto ──────────────────────

-- `cliente_documento_requerido` (0809) no tenía unique (id, tenant_id): mismo
-- movimiento de la 0028/0145/0207 — redundante en unicidad (id ya es PK),
-- obligatorio para que una FK compuesta pueda apuntarle.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'cliente_documento_requerido_id_tenant_key' and conrelid = 'public.cliente_documento_requerido'::regclass
  ) then
    alter table public.cliente_documento_requerido
      add constraint cliente_documento_requerido_id_tenant_key unique (id, tenant_id);
  end if;
end $$;

alter table public.viaje_hito_evidencia
  add column if not exists documento_requerido_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'viaje_hito_evidencia_documento_fkey' and conrelid = 'public.viaje_hito_evidencia'::regclass
  ) then
    alter table public.viaje_hito_evidencia add constraint viaje_hito_evidencia_documento_fkey
      foreign key (documento_requerido_id, tenant_id) references public.cliente_documento_requerido (id, tenant_id)
      on delete set null (documento_requerido_id) not valid;
  end if;
end $$;

do $$
begin
  begin
    alter table public.viaje_hito_evidencia validate constraint viaje_hito_evidencia_documento_fkey;
  exception when others then
    raise notice '0823: viaje_hito_evidencia_documento_fkey sigue NOT VALID: %', sqlerrm;
  end;
end $$;

create index if not exists viaje_hito_evidencia_documento_idx
  on public.viaje_hito_evidencia (tenant_id, documento_requerido_id) where documento_requerido_id is not null;

comment on column public.viaje_hito_evidencia.documento_requerido_id is
  '0823: el documento del catálogo (cliente_documento_requerido) que esta foto satisface. NULL = no es tipo documento_cierre, o lo es pero su categoría no se pudo determinar por el caption (queda «por revisar» en viaje_documento_cierre, sin bloquear el viaje).';

-- `viaje_hito_evidencia` (0385) tampoco tenía unique (id, tenant_id): mismo
-- movimiento, para que `viaje_documento_cierre` pueda apuntarle con FK compuesta.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'viaje_hito_evidencia_id_tenant_key' and conrelid = 'public.viaje_hito_evidencia'::regclass
  ) then
    alter table public.viaje_hito_evidencia
      add constraint viaje_hito_evidencia_id_tenant_key unique (id, tenant_id);
  end if;
end $$;

-- ── 3. La solicitud y su seguimiento: UNA fila por (viaje, documento) ───────
create table if not exists public.viaje_documento_cierre (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  viaje_id uuid not null,
  -- Nullable a propósito: si el documento se BORRA del catálogo (`bajaDocumentoCliente` hace DELETE real), esta fila
  -- NO debe desaparecer con él — es la bitácora de lo que YA se pidió y recibió de ESE viaje. El nombre/tipo siguen
  -- vivos en el snapshot de abajo aunque el puntero al catálogo se quede en null.
  documento_requerido_id uuid,
  -- Snapshot al momento de pedirlo: el catálogo puede cambiar (o borrarse) después sin alterar lo ya solicitado.
  nombre_solicitado text not null,
  tipo_solicitado text not null,
  solicitado_en timestamptz not null default now(),
  recibido_en timestamptz,
  viaje_hito_evidencia_id uuid,
  -- T-A5-54: cuántas veces se le pidió repetir la foto por ilegible. Un documento, un contador propio: no se comparte entre documentos.
  intentos_legibilidad smallint not null default 0,
  estado text not null default 'pendiente',
  -- La respuesta del chofer a la plantilla N11 («Ya los envié» / «Me falta uno»); null = aún no contestó.
  respuesta_chofer text,
  respuesta_chofer_en timestamptz,
  created_at timestamptz not null default now(),
  constraint viaje_documento_cierre_viaje_fkey
    foreign key (viaje_id, tenant_id) references public.viaje (id, tenant_id) on delete cascade,
  constraint viaje_documento_cierre_doc_fkey
    foreign key (documento_requerido_id, tenant_id) references public.cliente_documento_requerido (id, tenant_id) on delete set null (documento_requerido_id),
  constraint viaje_documento_cierre_evidencia_fkey
    foreign key (viaje_hito_evidencia_id, tenant_id) references public.viaje_hito_evidencia (id, tenant_id) on delete set null (viaje_hito_evidencia_id),
  constraint viaje_documento_cierre_estado check (estado in ('pendiente', 'recibido', 'revisar')),
  constraint viaje_documento_cierre_tipo check (tipo_solicitado in ('basico', 'complementario')),
  constraint viaje_documento_cierre_intentos check (intentos_legibilidad between 0 and 10),
  constraint viaje_documento_cierre_nombre check (char_length(btrim(nombre_solicitado)) between 1 and 80),
  constraint viaje_documento_cierre_respuesta check (respuesta_chofer is null or respuesta_chofer in ('evid_listo', 'evid_falta')),
  -- Coherencia: «recibido» siempre trae su hora; las demás nunca la traen (se limpia si se reabre el documento).
  constraint viaje_documento_cierre_recibido_coherente check ((estado = 'recibido') = (recibido_en is not null)),
  -- Una solicitud por documento y viaje: reimportar/repetir la pregunta no duplica la fila.
  constraint viaje_documento_cierre_unico unique (viaje_id, documento_requerido_id)
);
comment on table public.viaje_documento_cierre is
  '0823: documentos de cierre pedidos por viaje (snapshot del catálogo 0809), su estado (pendiente/recibido/revisar) y el contador de reintentos por foto ilegible (T-A5-54). Nace vacía; sin catálogos ni datos reales.';
comment on column public.viaje_documento_cierre.intentos_legibilidad is
  '0823/T-A5-54: reintentos pedidos por foto ilegible (< 800 px, oscura o borrosa) de ESTE documento. Al llegar a 2 se acepta la foto igual y el estado pasa a revisar; nunca bloquea el viaje.';

create index if not exists viaje_documento_cierre_viaje_idx
  on public.viaje_documento_cierre (tenant_id, viaje_id);
create index if not exists viaje_documento_cierre_pendientes_idx
  on public.viaje_documento_cierre (tenant_id, viaje_id) where estado <> 'recibido';

-- ── 4. RLS: misma política de lectura que `cliente_documento_requerido` (0809) y `viaje_hito_evidencia` (0385) ──
alter table public.viaje_documento_cierre enable row level security;
drop policy if exists tenant_lee on public.viaje_documento_cierre;
create policy tenant_lee on public.viaje_documento_cierre for select
  using (
    (tenant_id = any(public.get_user_tenant_ids()) and (select public.ve_operacion()))
    or (select public.is_superadmin())
  );
revoke all on table public.viaje_documento_cierre from public, anon, authenticated;
grant select on table public.viaje_documento_cierre to authenticated;
grant select, insert, update, delete on table public.viaje_documento_cierre to service_role;
