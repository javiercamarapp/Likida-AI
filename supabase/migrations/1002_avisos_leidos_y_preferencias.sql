-- REVERSA: drop function if exists public.aviso_marcar(text, text[], boolean);
--          drop table if exists public.aviso_silencio, public.aviso_preferencia, public.aviso_leido;
-- 1002 · Avisos por persona: qué avisos ya leyó (antes solo localStorage), qué tipos recibe por qué canal y su horario de silencio.
-- PROPUESTA de la entrega w14/notif (11-nov-2026): pendiente de revisión del dueño y de aplicación; NO aplicada.
-- Idempotente (create … if not exists, drop policy if exists) para que el rango reaplicable no la rompa.
--
-- Diseño:
--  · `ambito` = 'admin' (consola de Likida, superadmin) o el uuid de la flota (panel del cliente). Es texto con CHECK de forma para que
--    la llave primaria sirva de objetivo de upsert (un superadmin no tiene tenant_id: null no cabe en una llave).
--  · RLS por USUARIO y por ÁMBITO: cada persona ve y escribe solo sus filas, y solo en un ámbito que le pertenece (su flota, o 'admin'
--    si es superadmin; un superadmin puede además «ver como» cualquier flota). anon no toca nada.
--  · La «leída» es de un aviso VIVO cuya clave lleva la huella de la condición: si la condición cambia, la clave cambia y vuelve como
--    no leída. Por eso la clave vieja no sirve de nada y `aviso_marcar` poda a las 1000 más recientes por persona y ámbito.
begin;

create table if not exists public.aviso_leido (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  ambito text not null,
  clave text not null,
  leido_en timestamptz not null default now(),
  primary key (usuario_id, ambito, clave),
  constraint aviso_leido_ambito_forma check (ambito = 'admin' or ambito ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  constraint aviso_leido_clave_largo check (char_length(clave) between 1 and 300)
);
create index if not exists idx_aviso_leido_reciente on public.aviso_leido (usuario_id, ambito, leido_en desc);

create table if not exists public.aviso_preferencia (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  ambito text not null,
  categoria text not null,
  canal text not null,
  activo boolean not null,
  actualizado_en timestamptz not null default now(),
  primary key (usuario_id, ambito, categoria, canal),
  constraint aviso_preferencia_ambito_forma check (ambito = 'admin' or ambito ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  constraint aviso_preferencia_canal_dominio check (canal in ('app', 'correo', 'whatsapp')),
  constraint aviso_preferencia_categoria_dominio check (categoria in (
    'escalaciones', 'soporte', 'sistema', 'costos', 'negocio',
    'operacion', 'dinero', 'conexiones', 'sistema_flota'))
);

create table if not exists public.aviso_silencio (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  ambito text not null,
  activo boolean not null default false,
  desde time not null default '22:00',
  hasta time not null default '07:00',
  permite_criticos boolean not null default true,
  actualizado_en timestamptz not null default now(),
  primary key (usuario_id, ambito),
  constraint aviso_silencio_ambito_forma check (ambito = 'admin' or ambito ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  constraint aviso_silencio_rango check (desde <> hasta)
);

-- ¿Este ámbito le pertenece a quien llama? 'admin' solo al superadmin; una flota, a quien pertenece a ella o al superadmin («ver como»).
create or replace function public.aviso_ambito_permitido(p_ambito text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when p_ambito = 'admin' then public.is_superadmin()
    when p_ambito ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then p_ambito::uuid = any(public.get_user_tenant_ids()) or public.is_superadmin()
    else false
  end;
$$;

alter table public.aviso_leido enable row level security;
alter table public.aviso_preferencia enable row level security;
alter table public.aviso_silencio enable row level security;

drop policy if exists aviso_leido_propio on public.aviso_leido;
create policy aviso_leido_propio on public.aviso_leido for all to authenticated
  using (usuario_id = auth.uid() and public.aviso_ambito_permitido(ambito))
  with check (usuario_id = auth.uid() and public.aviso_ambito_permitido(ambito));
drop policy if exists aviso_preferencia_propia on public.aviso_preferencia;
create policy aviso_preferencia_propia on public.aviso_preferencia for all to authenticated
  using (usuario_id = auth.uid() and public.aviso_ambito_permitido(ambito))
  with check (usuario_id = auth.uid() and public.aviso_ambito_permitido(ambito));
drop policy if exists aviso_silencio_propio on public.aviso_silencio;
create policy aviso_silencio_propio on public.aviso_silencio for all to authenticated
  using (usuario_id = auth.uid() and public.aviso_ambito_permitido(ambito))
  with check (usuario_id = auth.uid() and public.aviso_ambito_permitido(ambito));

revoke all on table public.aviso_leido, public.aviso_preferencia, public.aviso_silencio from public, anon, authenticated;
grant select, insert, update, delete on table public.aviso_leido, public.aviso_preferencia, public.aviso_silencio to authenticated;
grant all on table public.aviso_leido, public.aviso_preferencia, public.aviso_silencio to service_role;

-- Marca (p_leido = true) o desmarca (false) un lote de claves de la persona que llama, en un solo paso. SECURITY INVOKER: la RLS decide.
-- Poda a las 1000 más recientes por persona y ámbito. Devuelve cuántas filas se insertaron o se borraron.
create or replace function public.aviso_marcar(p_ambito text, p_claves text[], p_leido boolean)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_n integer := 0;
begin
  if v_uid is null then
    raise exception 'aviso_marcar: sin sesión' using errcode = '28000';
  end if;
  if p_ambito is null or p_claves is null or p_leido is null then
    raise exception 'aviso_marcar: argumentos nulos' using errcode = '22004';
  end if;
  if cardinality(p_claves) > 500 then
    raise exception 'aviso_marcar: demasiadas claves (máximo 500)' using errcode = '54000';
  end if;
  if not public.aviso_ambito_permitido(p_ambito) then
    raise exception 'aviso_marcar: ámbito no permitido' using errcode = '42501';
  end if;

  if p_leido then
    insert into public.aviso_leido (usuario_id, ambito, clave)
    select v_uid, p_ambito, c from (select distinct unnest(p_claves) as c) x where c is not null and char_length(c) between 1 and 300
    on conflict (usuario_id, ambito, clave) do nothing;
    get diagnostics v_n = row_count;
    delete from public.aviso_leido a
     where a.usuario_id = v_uid and a.ambito = p_ambito
       and a.ctid in (
         select ctid from public.aviso_leido
          where usuario_id = v_uid and ambito = p_ambito
          order by leido_en desc, clave offset 1000);
  else
    delete from public.aviso_leido where usuario_id = v_uid and ambito = p_ambito and clave = any(p_claves);
    get diagnostics v_n = row_count;
  end if;
  return v_n;
end;
$$;
revoke all on function public.aviso_marcar(text, text[], boolean) from public, anon;
grant execute on function public.aviso_marcar(text, text[], boolean) to authenticated, service_role;
revoke all on function public.aviso_ambito_permitido(text) from public, anon;
grant execute on function public.aviso_ambito_permitido(text) to authenticated, service_role;

comment on table public.aviso_leido is 'Avisos que una persona ya leyó, por ámbito (admin o flota). La clave lleva la huella de la condición. Mig. 1002.';
comment on table public.aviso_preferencia is 'Qué tipo de aviso recibe una persona por qué canal (app, correo, whatsapp). Sin fila = encendido. Mig. 1002.';
comment on table public.aviso_silencio is 'Horario de silencio de correo y WhatsApp por persona y ámbito (hora de Ciudad de México). Mig. 1002.';

commit;
