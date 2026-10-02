-- ═══════════════════════════════════════════════════════════════════════════
-- 0652 · ORQUESTADOR VIVO (2/2): EL BARRIDO DE SALUD DE LOS AGENTES, CON CLAIM.
--
-- «Si un agente falla, notifica» solo ocurría cuando alguien le preguntaba al asistente.
-- Ahora un barrido dentro del cron `escalar` revisa la salud de los agentes de cada
-- flota y abre (o cierra) una tarea `falla_de_agente`. Para que sea SEGURO a la
-- concurrencia y barato:
--
--   · `orquestador_barrido_estado` — una fila por flota: cuándo se barrió por última vez.
--   · `reclamar_flotas_barrido_orquestador(límite, ventana_min)` — el claim atómico: toma
--     las flotas a las que ya les toca (nunca barridas o con la ventana cumplida, las más
--     atrasadas primero), les sella el intento y devuelve SOLO las que ganó. Dos corridas
--     solapadas no barren la misma flota en la misma ventana (FOR UPDATE SKIP LOCKED y
--     ON CONFLICT … WHERE como segundo candado).
--   · `registrar_barrido_orquestador(flota, resultado, abiertas, cerradas, error)` — cierra
--     el intento: un error acorta la reintento a 10 min en vez de esperar la ventana entera.
--
-- Solo service_role; RLS activa sin políticas (deny-all).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.orquestador_barrido_estado (
  tenant_id uuid primary key references public.tenant(id) on delete cascade,
  ultimo_barrido_en timestamptz not null default now(),
  ultimo_resultado text,
  ultimo_error text,
  abiertas integer not null default 0,
  cerradas integer not null default 0,
  constraint orquestador_barrido_resultado check (ultimo_resultado is null or ultimo_resultado in ('ok', 'error')),
  constraint orquestador_barrido_error_largo check (ultimo_error is null or char_length(ultimo_error) <= 300),
  constraint orquestador_barrido_conteos check (abiertas >= 0 and cerradas >= 0)
);
alter table public.orquestador_barrido_estado enable row level security;
revoke all on table public.orquestador_barrido_estado from public, anon, authenticated;
grant select, insert, update, delete on table public.orquestador_barrido_estado to service_role;
comment on table public.orquestador_barrido_estado is
  '0652: cuándo se barrió por última vez la salud de los agentes de cada flota (cron escalar). Deny-all; solo service_role.';

create or replace function public.reclamar_flotas_barrido_orquestador(p_limite integer default 25, p_ventana_min integer default 30)
returns table (tenant_id uuid)
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if p_limite is null or p_limite not between 1 and 500 or p_ventana_min is null or p_ventana_min not between 1 and 1440 then
    raise exception 'reclamar_flotas_barrido_orquestador: argumentos inválidos' using errcode = '22023';
  end if;
  return query
    with candidatas as (
      select t.id as tid
        from public.tenant t
        left join public.orquestador_barrido_estado e on e.tenant_id = t.id
       where e.tenant_id is null
          or e.ultimo_barrido_en < clock_timestamp()
             - make_interval(mins => case when e.ultimo_resultado = 'error' then least(p_ventana_min, 10) else p_ventana_min end)
       order by coalesce(e.ultimo_barrido_en, '-infinity'::timestamptz), t.id
       limit p_limite
         for update of t skip locked
    )
    insert into public.orquestador_barrido_estado as s (tenant_id, ultimo_barrido_en)
    select c.tid, clock_timestamp() from candidatas c
    on conflict on constraint orquestador_barrido_estado_pkey do update set ultimo_barrido_en = clock_timestamp()
     where s.ultimo_barrido_en < clock_timestamp()
           - make_interval(mins => case when s.ultimo_resultado = 'error' then least(p_ventana_min, 10) else p_ventana_min end)
    returning s.tenant_id;
end $$;

create or replace function public.registrar_barrido_orquestador(
  p_tenant uuid, p_resultado text, p_abiertas integer default 0, p_cerradas integer default 0, p_error text default null
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if p_tenant is null or p_resultado is null or p_resultado not in ('ok', 'error') then
    raise exception 'registrar_barrido_orquestador: argumentos inválidos' using errcode = '22023';
  end if;
  insert into public.orquestador_barrido_estado as s (tenant_id, ultimo_barrido_en, ultimo_resultado, ultimo_error, abiertas, cerradas)
  values (p_tenant, clock_timestamp(), p_resultado, case when p_resultado = 'error' then left(p_error, 300) else null end,
          greatest(coalesce(p_abiertas, 0), 0), greatest(coalesce(p_cerradas, 0), 0))
  on conflict on constraint orquestador_barrido_estado_pkey do update set
    ultimo_resultado = excluded.ultimo_resultado, ultimo_error = excluded.ultimo_error,
    abiertas = excluded.abiertas, cerradas = excluded.cerradas;
end $$;

revoke all on function public.reclamar_flotas_barrido_orquestador(integer, integer) from public, anon, authenticated;
grant execute on function public.reclamar_flotas_barrido_orquestador(integer, integer) to service_role;
revoke all on function public.registrar_barrido_orquestador(uuid, text, integer, integer, text) from public, anon, authenticated;
grant execute on function public.registrar_barrido_orquestador(uuid, text, integer, integer, text) to service_role;
