-- Claims durables para correo y WhatsApp. Las filas históricas de correo eran
-- marcadores definitivos, por eso nacen como `applied`.
alter table public.correo_procesado
  add column if not exists estado text not null default 'applied',
  add column if not exists claim_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists applied_at timestamptz,
  add column if not exists ultimo_error text;

alter table public.correo_procesado drop constraint if exists correo_procesado_estado_check;
alter table public.correo_procesado add constraint correo_procesado_estado_check
  check (estado in ('processing', 'applied'));

create or replace function public.reclamar_correo(p_email_id text, p_lease_seconds int default 90)
returns table(resultado text, token uuid)
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare v_token uuid := gen_random_uuid();
begin
  insert into correo_procesado(email_id, estado, claim_token, lease_expires_at, applied_at)
  values (p_email_id, 'processing', v_token, now()+make_interval(secs=>p_lease_seconds), null)
  on conflict(email_id) do update set
    claim_token=excluded.claim_token, lease_expires_at=excluded.lease_expires_at,
    estado='processing', ultimo_error=null
  where correo_procesado.estado <> 'applied'
    and (correo_procesado.lease_expires_at is null or correo_procesado.lease_expires_at < now());
  if found then return query select 'claimed'::text, v_token; return; end if;
  return query select case when estado='applied' then 'applied' else 'busy' end, null::uuid
    from correo_procesado where email_id=p_email_id;
end $$;

create or replace function public.finalizar_correo(p_email_id text, p_token uuid, p_ok boolean, p_error text default null)
returns boolean language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
  if p_ok then
    update correo_procesado set estado='applied', applied_at=now(), lease_expires_at=null,
      ultimo_error=null where email_id=p_email_id and claim_token=p_token and estado='processing';
  else
    -- `now()` is fixed for the whole transaction. Using it here made an
    -- immediate retry in that same transaction remain busy (`now() < now()`
    -- is false). An explicit expired lease releases the job immediately while
    -- the token predicate still prevents an old worker from finalizing it.
    update correo_procesado set lease_expires_at='-infinity'::timestamptz, ultimo_error=left(p_error,500)
      where email_id=p_email_id and claim_token=p_token and estado='processing';
  end if;
  return found;
end $$;

alter table public.wa_evento_pendiente
  add column if not exists claim_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists claim_owner text;

create index if not exists wa_evento_pendiente_lease_idx
  on public.wa_evento_pendiente(recibido_en)
  where procesado_en is null;

create or replace function public.reclamar_wa_pendiente(
  p_id text, p_intentos int, p_owner text, p_lease_seconds int default 180)
returns table(id text, evento jsonb, intentos int, claim_token uuid)
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare v_token uuid := gen_random_uuid();
begin
  return query
  update wa_evento_pendiente w set
    intentos=w.intentos+1, claim_token=v_token, claim_owner=left(p_owner,100),
    lease_expires_at=now()+make_interval(secs=>p_lease_seconds)
  where w.id=p_id and w.intentos=p_intentos and w.procesado_en is null
    and (w.lease_expires_at is null or w.lease_expires_at < now())
  returning w.id,w.evento,w.intentos,w.claim_token;
end $$;

revoke all on function public.reclamar_correo(text,int) from public,anon,authenticated;
revoke all on function public.finalizar_correo(text,uuid,boolean,text) from public,anon,authenticated;
revoke all on function public.reclamar_wa_pendiente(text,int,text,int) from public,anon,authenticated;
grant execute on function public.reclamar_correo(text,int), public.finalizar_correo(text,uuid,boolean,text),
  public.reclamar_wa_pendiente(text,int,text,int) to service_role;
