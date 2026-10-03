-- ═══════════════════════════════════════════════════════════════════════════
-- 0620 — Liquidación externa: reclamo atómico y registro por teléfono de la copia al jefe.
--
-- Hasta aquí la copia al jefe se decidía leyendo la bitácora y escribiendo el resultado DESPUÉS de mandar el
-- WhatsApp: dos invocaciones concurrentes (la entrega del POST y el cron, o dos clics en «reenviar copia»)
-- veían la bitácora vacía y mandaban el mensaje con el monto dos veces. Esta migración da el candado:
-- UNA fila por (liquidación, generación, teléfono) que se RECLAMA antes de mandar. Quien la reclama manda;
-- quien llega después ve la fila y no manda. Si el envío no sale, el reclamo se suelta y se puede reintentar;
-- si sale, la fila queda `aceptada` y ese teléfono no vuelve a recibirla (el reintento va solo a los faltantes).
--
-- Un reclamo cuyo proceso murió se retoma pasado el arriendo (lease, 30..900 s). El código funciona contra
-- una base SIN esta migración (cae a la bitácora, sin candado atómico), así que aplicarla no es requisito
-- para desplegar. Escribe solo service_role; la lectura es de quien ve finanzas de la flota.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.liquidacion_copia_jefe (
  liquidacion_externa_id uuid        not null,
  tenant_id              uuid        not null references public.tenant(id) on delete cascade,
  generacion             integer     not null,
  telefono               text        not null,
  estado                 text        not null default 'reclamada',
  claim_token            uuid        not null default gen_random_uuid(),
  reclamada_en           timestamptz not null default now(),
  claim_expira_en        timestamptz not null default now() + interval '5 minutes',
  aceptada_en            timestamptz,
  primary key (liquidacion_externa_id, generacion, telefono),
  constraint liquidacion_copia_jefe_liq_tenant_fkey
    foreign key (liquidacion_externa_id, tenant_id) references public.liquidacion_externa (id, tenant_id) on delete cascade,
  constraint liquidacion_copia_jefe_estado check (estado in ('reclamada', 'aceptada')),
  constraint liquidacion_copia_jefe_generacion_pos check (generacion >= 1),
  constraint liquidacion_copia_jefe_telefono_forma check (telefono ~ '^[0-9]{10,15}$'),
  constraint liquidacion_copia_jefe_aceptada_coherente check ((estado = 'aceptada') = (aceptada_en is not null))
);

comment on table public.liquidacion_copia_jefe is
  '0620: reclamo atómico y registro por teléfono de la copia de una liquidación al jefe de flota. Una fila por (liquidación, generación, teléfono): reclamada = alguien la está mandando; aceptada = ya salió y no se repite.';

create index if not exists liquidacion_copia_jefe_tenant_idx on public.liquidacion_copia_jefe (tenant_id);

alter table public.liquidacion_copia_jefe enable row level security;

drop policy if exists tenant_lee on public.liquidacion_copia_jefe;
create policy tenant_lee on public.liquidacion_copia_jefe for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_finanzas()) or is_superadmin());

revoke all on public.liquidacion_copia_jefe from public, anon, authenticated;
grant select, insert, update, delete on public.liquidacion_copia_jefe to service_role;

-- Reclama el envío a UN teléfono. Devuelve el token si le toca mandar; NULL si ya salió (aceptada), si otro
-- lo está mandando con arriendo vigente, o si la liquidación no es de esa flota.
create or replace function public.reclamar_copia_jefe(
  p_tenant uuid, p_liquidacion uuid, p_generacion integer, p_telefono text,
  p_ahora timestamptz default clock_timestamp(), p_lease_segundos integer default 300
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_token uuid;
begin
  if p_lease_segundos < 30 or p_lease_segundos > 900 then raise exception 'lease fuera de 30..900'; end if;
  if not exists (select 1 from public.liquidacion_externa l where l.id = p_liquidacion and l.tenant_id = p_tenant) then
    return null;
  end if;
  insert into public.liquidacion_copia_jefe as c (
    liquidacion_externa_id, tenant_id, generacion, telefono, estado, claim_token, reclamada_en, claim_expira_en
  ) values (
    p_liquidacion, p_tenant, p_generacion, p_telefono, 'reclamada', gen_random_uuid(), p_ahora,
    p_ahora + make_interval(secs => p_lease_segundos)
  )
  on conflict (liquidacion_externa_id, generacion, telefono) do update
     set claim_token = gen_random_uuid(), reclamada_en = p_ahora,
         claim_expira_en = p_ahora + make_interval(secs => p_lease_segundos)
   where c.estado = 'reclamada' and c.claim_expira_en <= p_ahora and c.tenant_id = p_tenant
  returning c.claim_token into v_token;
  return v_token;
end;
$$;
revoke all on function public.reclamar_copia_jefe(uuid, uuid, integer, text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.reclamar_copia_jefe(uuid, uuid, integer, text, timestamptz, integer) to service_role;

-- Cierra el reclamo: aceptada = true deja la fila `aceptada` (no se repite); false la SUELTA (reintentable).
-- Solo cierra quien conserva el token vigente de la fila.
create or replace function public.cerrar_copia_jefe(
  p_tenant uuid, p_liquidacion uuid, p_generacion integer, p_telefono text, p_claim uuid, p_aceptada boolean,
  p_ahora timestamptz default clock_timestamp()
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  if p_aceptada then
    update public.liquidacion_copia_jefe
       set estado = 'aceptada', aceptada_en = p_ahora
     where liquidacion_externa_id = p_liquidacion and tenant_id = p_tenant and generacion = p_generacion
       and telefono = p_telefono and claim_token = p_claim and estado = 'reclamada';
  else
    delete from public.liquidacion_copia_jefe
     where liquidacion_externa_id = p_liquidacion and tenant_id = p_tenant and generacion = p_generacion
       and telefono = p_telefono and claim_token = p_claim and estado = 'reclamada';
  end if;
  get diagnostics n = row_count;
  return n = 1;
end;
$$;
revoke all on function public.cerrar_copia_jefe(uuid, uuid, integer, text, uuid, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.cerrar_copia_jefe(uuid, uuid, integer, text, uuid, boolean, timestamptz) to service_role;
