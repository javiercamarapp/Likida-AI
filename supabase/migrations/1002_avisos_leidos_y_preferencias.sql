-- REVERSA: drop function if exists public.aviso_marcar(uuid, text, text[], boolean);
--          drop table if exists public.aviso_silencio, public.aviso_preferencia, public.aviso_leido;
-- 1002 · Avisos por persona: qué avisos ya leyó (antes solo localStorage), qué tipos recibe por qué canal y su horario de silencio.
-- Entrega w14/notif (11-nov-2026), corregida en la integración w15. APLICADA en producción el 11-nov-2026 (MCP apply_migration),
-- verificada: RLS activa sin políticas, sin select para anon/authenticated, aviso_marcar solo para service_role.
-- Idempotente (create … if not exists) para que el rango reaplicable no la rompa.
--
-- Diseño:
--  · `ambito` = 'admin' (consola de Likida, superadmin) o el uuid de la flota (panel del cliente). Es texto con CHECK de forma para que
--    la llave primaria sirva de objetivo de upsert (un superadmin no tiene tenant_id: null no cabe en una llave).
--  · SIN privilegios para anon ni authenticated (regla de la 0947/0949 y capa0_grants_tablas: ningún cliente con JWT de usuario toca tablas
--    de `public`). Las tablas las lee y escribe SOLO el servidor con service_role, y es el servidor quien decide QUIÉN es la persona y QUÉ
--    ámbito le pertenece (`ui-v2/avisos/acciones.ts#contexto`: requireSuperadmin para 'admin', resolverTenantEfectivo para una flota) y
--    quien filtra por `usuario_id` y `ambito`. RLS queda habilitada y SIN políticas: si algún día se concediera un grant por error, el
--    resultado sería «nada», no «todo».
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

alter table public.aviso_leido enable row level security;
alter table public.aviso_preferencia enable row level security;
alter table public.aviso_silencio enable row level security;

-- Sin políticas a propósito: solo service_role (que salta RLS) entra; ver el diseño arriba.
revoke all on table public.aviso_leido, public.aviso_preferencia, public.aviso_silencio from public, anon, authenticated;
grant all on table public.aviso_leido, public.aviso_preferencia, public.aviso_silencio to service_role;

-- Marca (p_leido = true) o desmarca (false) un lote de claves de una persona, en un solo paso. La persona la dice el servidor (service_role),
-- que ya la resolvió de la sesión; la función NO decide el ámbito (no puede: no hay JWT). Poda a las 1000 más recientes por persona y ámbito.
-- Devuelve cuántas filas se insertaron o se borraron.
create or replace function public.aviso_marcar(p_usuario uuid, p_ambito text, p_claves text[], p_leido boolean)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_n integer := 0;
begin
  if p_usuario is null or p_ambito is null or p_claves is null or p_leido is null then
    raise exception 'aviso_marcar: argumentos nulos' using errcode = '22004';
  end if;
  if cardinality(p_claves) > 500 then
    raise exception 'aviso_marcar: demasiadas claves (máximo 500)' using errcode = '54000';
  end if;

  if p_leido then
    insert into public.aviso_leido (usuario_id, ambito, clave)
    select p_usuario, p_ambito, c from (select distinct unnest(p_claves) as c) x where c is not null and char_length(c) between 1 and 300
    on conflict (usuario_id, ambito, clave) do nothing;
    get diagnostics v_n = row_count;
    delete from public.aviso_leido a
     where a.usuario_id = p_usuario and a.ambito = p_ambito
       and a.ctid in (
         select ctid from public.aviso_leido
          where usuario_id = p_usuario and ambito = p_ambito
          order by leido_en desc, clave offset 1000);
  else
    delete from public.aviso_leido where usuario_id = p_usuario and ambito = p_ambito and clave = any(p_claves);
    get diagnostics v_n = row_count;
  end if;
  return v_n;
end;
$$;
revoke all on function public.aviso_marcar(uuid, text, text[], boolean) from public, anon, authenticated;
grant execute on function public.aviso_marcar(uuid, text, text[], boolean) to service_role;

comment on table public.aviso_leido is 'Avisos que una persona ya leyó, por ámbito (admin o flota). La clave lleva la huella de la condición. Mig. 1002.';
comment on table public.aviso_preferencia is 'Qué tipo de aviso recibe una persona por qué canal (app, correo, whatsapp). Sin fila = encendido. Mig. 1002.';
comment on table public.aviso_silencio is 'Horario de silencio de correo y WhatsApp por persona y ámbito (hora de Ciudad de México). Mig. 1002.';

commit;
