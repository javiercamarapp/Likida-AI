-- ═══════════════════════════════════════════════════════════════════════════
-- CANARIO (solo fase `canario`): objetos ABIERTOS A PROPOSITO. Si el banco no los marca, el banco esta ciego y el CI falla.
-- Viven dentro de la transaccion del banco y se deshacen con el rollback final. Prefijo zz_canario_ para no confundirlos.
-- ═══════════════════════════════════════════════════════════════════════════
create table public.zz_canario_fuga (tenant_id uuid not null, dato text not null);
alter table public.zz_canario_fuga enable row level security;
create policy canario_abierta on public.zz_canario_fuga for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.zz_canario_fuga to authenticated, anon;

create table public.zz_canario_sin_rls (tenant_id uuid not null, dato text not null);
grant select, update on public.zz_canario_sin_rls to authenticated, anon;

create function public.zz_canario_definer() returns int language sql security definer set search_path = public, pg_temp as $f$ select 1 $f$;
grant execute on function public.zz_canario_definer() to anon, authenticated;

create view public.zz_canario_vista as select * from public.zz_canario_sin_rls;
grant select on public.zz_canario_vista to anon, authenticated;
