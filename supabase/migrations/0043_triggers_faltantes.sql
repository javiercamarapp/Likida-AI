-- AUDITORÍA 9, CRÍTICO (operabilidad) — sondear un TRIGGER exige mirar el
-- catálogo, igual que ya se resolvió para índices en la 0030.
--
-- `startup.ts` sondea 0005, 0011, 0016, 0017, 0031, 0033 y los índices de
-- 0019/0024 en cada arranque frío — pero NINGUNA línea sonda 0036 ni 0037
-- (`trg_gasto_no_tras_liquidar` / `..._update`), el trigger que impide que
-- un gasto se inserte o se modifique DESPUÉS de emitida la liquidación.
-- `0036_no_gastos_tras_liquidar.sql` lo llama, en su propio comentario,
-- "el peor bug histórico del camino del dinero" (PDF y WhatsApp diciendo
-- cifras contrarias del mismo viaje). Si ese trigger falta en un entorno
-- —un proyecto de Supabase nuevo para el demo, un `db push` que se corta a
-- la mitad— el arranque hoy dice `{ok: true}` de todos modos.
--
-- PostgREST no expone `pg_trigger`, así que hace falta una función — de
-- solo lectura, mismo criterio que `indices_faltantes`, y sirve para
-- cualquier trigger futuro.

create or replace function triggers_faltantes(p_esperados text[])
returns text[]
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    array_agg(e order by e) filter (
      where not exists (
        select 1 from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and t.tgname = e and not t.tgisinternal
      )
    ),
    '{}'::text[]
  )
  from unnest(p_esperados) as e;
$$;

comment on function triggers_faltantes(text[]) is
  'Devuelve cuáles de los triggers esperados NO existen en el esquema public. Solo lectura; la usa el chequeo de arranque para sondear migraciones que crean triggers (ver src/lib/cuadra/startup.ts).';

revoke all on function triggers_faltantes(text[]) from public, anon, authenticated;
grant execute on function triggers_faltantes(text[]) to service_role;
