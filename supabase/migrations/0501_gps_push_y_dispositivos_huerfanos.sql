-- ═══════════════════════════════════════════════════════════════════════════
-- 0501 · GPS: PUSH FIRMADO POR FLOTA Y DISPOSITIVOS HUÉRFANOS
--
-- LOOP PUNTA A PUNTA, W3 «GPS/Jornada» (rango 0500-0519).
--
-- 1. `gps_push_secreto`: el GPS propio del cliente de demo (o cualquier dispositivo
--    que sepa hacer POST) manda sus posiciones a /api/gps/push/<flota> firmadas
--    con HMAC-SHA256. El secreto es POR FLOTA, se guarda CIFRADO por la
--    aplicación (el mismo cofre que las credenciales de conector — un volcado de
--    la base es ruido) y se muestra UNA SOLA VEZ al generarlo. La rotación
--    conserva el secreto anterior por una ventana corta (`previo_vence_en`)
--    para que los dispositivos se actualicen sin perder lecturas. La salud de la
--    integración (última recepción, último rechazo) vive aquí: no hay poll, así
--    que `conector_poll_estado` no aplica.
-- 2. `gps_dispositivo_huerfano`: dispositivos que un proveedor reporta y que
--    NINGUNA unidad de la flota reclama (`unidad.gps_device_id`). Solo guarda el
--    id y las horas — jamás coordenadas — y NO crea unidades: es la lista que el
--    dueño usa para mapear (alta masiva CSV) o descartar. Una unidad fantasma
--    desde un feed ajeno es como se llena la base de camiones que nadie mandó.
--
-- Ambas tablas: RLS activa sin políticas (deny-all para anon/authenticated);
-- solo service_role. El panel las lee con `supabaseAdmin` filtrando por flota.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.gps_push_secreto (
  tenant_id            uuid primary key references public.tenant(id) on delete cascade,
  secreto_cifrado      text not null,
  secreto_previo_cifrado text,
  previo_vence_en      timestamptz,
  version              integer not null default 1,
  creado_en            timestamptz not null default now(),
  rotado_en            timestamptz not null default now(),
  activo               boolean not null default true,
  ultima_recepcion_en  timestamptz,
  ultima_recepcion_guardadas integer not null default 0,
  ultimo_rechazo_en    timestamptz,
  ultimo_rechazo_motivo text,
  rechazos_total       bigint not null default 0,
  recepciones_total    bigint not null default 0,
  constraint gps_push_previo_coherente check (
    (secreto_previo_cifrado is null and previo_vence_en is null)
    or (secreto_previo_cifrado is not null and previo_vence_en is not null)
  ),
  constraint gps_push_version_sana check (version >= 1),
  constraint gps_push_motivo_corto check (ultimo_rechazo_motivo is null or length(ultimo_rechazo_motivo) <= 120)
);
comment on table public.gps_push_secreto is
  'Secreto HMAC por flota del push de posiciones (GPS propio). Cifrado por la aplicación; el valor en claro solo se muestra al generarlo. Contiene también la salud de la integración (última recepción / rechazo).';

alter table public.gps_push_secreto enable row level security;
revoke all on public.gps_push_secreto from public, anon, authenticated;
grant select, insert, update, delete on public.gps_push_secreto to service_role;

create table if not exists public.gps_dispositivo_huerfano (
  tenant_id       uuid not null references public.tenant(id) on delete cascade,
  proveedor       text not null,
  device_id       text not null,
  primer_visto_en timestamptz not null default now(),
  ultimo_visto_en timestamptz not null default now(),
  primary key (tenant_id, proveedor, device_id),
  constraint gps_huerfano_id_sano check (length(device_id) between 1 and 200),
  constraint gps_huerfano_proveedor_sano check (length(proveedor) between 1 and 60)
);
comment on table public.gps_dispositivo_huerfano is
  'Dispositivos que el proveedor reporta y ninguna unidad reclama. Solo id y horas (nunca coordenadas). No crea unidades: alimenta el mapeo masivo.';
create index if not exists gps_huerfano_visto_idx
  on public.gps_dispositivo_huerfano (tenant_id, ultimo_visto_en desc);

alter table public.gps_dispositivo_huerfano enable row level security;
revoke all on public.gps_dispositivo_huerfano from public, anon, authenticated;
grant select, insert, update, delete on public.gps_dispositivo_huerfano to service_role;

-- Rotación atómica: el secreto vigente pasa a «previo» con vigencia de 24 h.
-- Una segunda rotación dentro de la ventana descarta el previo anterior (solo
-- se conserva UN secreto previo).
create or replace function public.rotar_gps_push_secreto(
  p_tenant uuid, p_nuevo_cifrado text, p_ahora timestamptz default clock_timestamp()
) returns integer
language plpgsql security definer set search_path = ''
as $$
declare v integer;
begin
  if p_nuevo_cifrado is null or length(p_nuevo_cifrado) < 20 then
    raise exception 'secreto cifrado inválido';
  end if;
  insert into public.gps_push_secreto (tenant_id, secreto_cifrado, creado_en, rotado_en)
  values (p_tenant, p_nuevo_cifrado, p_ahora, p_ahora)
  on conflict (tenant_id) do update
    set secreto_previo_cifrado = public.gps_push_secreto.secreto_cifrado,
        previo_vence_en = p_ahora + interval '24 hours',
        secreto_cifrado = excluded.secreto_cifrado,
        version = public.gps_push_secreto.version + 1,
        rotado_en = p_ahora,
        activo = true
  returning version into v;
  return v;
end;
$$;
revoke all on function public.rotar_gps_push_secreto(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.rotar_gps_push_secreto(uuid, text, timestamptz) to service_role;

-- Salud de la integración, con debounce de 30 s para que un dispositivo que
-- manda cada segundo no convierta cada petición en un UPDATE.
create or replace function public.registrar_gps_push_uso(
  p_tenant uuid, p_ok boolean, p_motivo text default null, p_guardadas integer default 0,
  p_ahora timestamptz default clock_timestamp()
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_ok then
    update public.gps_push_secreto
       set ultima_recepcion_en = p_ahora, ultima_recepcion_guardadas = greatest(p_guardadas, 0),
           recepciones_total = recepciones_total + 1
     where tenant_id = p_tenant
       and (ultima_recepcion_en is null or ultima_recepcion_en < p_ahora - interval '30 seconds');
  else
    update public.gps_push_secreto
       set ultimo_rechazo_en = p_ahora, ultimo_rechazo_motivo = left(coalesce(p_motivo, 'rechazado'), 120),
           rechazos_total = rechazos_total + 1
     where tenant_id = p_tenant
       and (ultimo_rechazo_en is null or ultimo_rechazo_en < p_ahora - interval '30 seconds');
  end if;
end;
$$;
revoke all on function public.registrar_gps_push_uso(uuid, boolean, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.registrar_gps_push_uso(uuid, boolean, text, integer, timestamptz) to service_role;
