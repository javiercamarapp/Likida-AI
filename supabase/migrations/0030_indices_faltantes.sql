-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORÍA 6 — SONDEAR UN ÍNDICE EXIGE MIRAR EL CATÁLOGO.
--
-- El chequeo de arranque decía verificar la migración 0019 (el unique de
-- `gasto.cfdi_uuid`) y no podía: sondeaba con
--
--     select cfdi_uuid from gasto where cfdi_uuid is not null limit 1
--
-- y esa columna existe desde `0001_init.sql`, con índice o sin él. La consulta
-- responde igual de bien en una base donde la 0019 nunca se aplicó. Es la
-- tercera ronda seguida con el mismo hallazgo —"anuncia que verifica y no
-- verifica"— y la de ayer lo empeoró: le puso encima un comentario de seis
-- líneas afirmando que "se sonda leyendo el índice".
--
-- El daño hoy es cero porque la 0019 SÍ está aplicada en producción. Lo que se
-- cierra es la falsa garantía: un chequeo que no puede fallar no está
-- protegiendo nada, y el día que alguien levante un proyecto nuevo, el arranque
-- va a decir que todo está bien sobre una base que liquida el mismo CFDI dos
-- veces, con su IVA acreditado por duplicado.
--
-- PostgREST no expone `pg_indexes`, así que hace falta una función. Es de solo
-- lectura, no toca datos de nadie, y sirve para cualquier índice futuro: se le
-- pasa la lista de los que deben existir y devuelve los que no están.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function indices_faltantes(p_esperados text[])
returns text[]
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    array_agg(e order by e) filter (
      where not exists (
        select 1 from pg_indexes i
        where i.schemaname = 'public' and i.indexname = e
      )
    ),
    '{}'::text[]
  )
  from unnest(p_esperados) as e;
$$;

comment on function indices_faltantes(text[]) is
  'Devuelve cuáles de los índices esperados NO existen en el esquema public. Solo lectura; la usa el chequeo de arranque para sondear migraciones que crean índices (ver src/lib/cuadra/startup.ts).';

revoke all on function indices_faltantes(text[]) from public, anon, authenticated;
grant execute on function indices_faltantes(text[]) to service_role;
