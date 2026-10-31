-- REVERSA: `drop function if exists public.prospectos_sin_dossier(integer);` (solo la lee el investigador; sin ella el código cae al escaneo paginado de siempre, que se detiene tras ~2,000 dossiers). No hay datos que reponer.
-- ═══════════════════════════════════════════════════════════════════════════
-- 0930 — AUDITORÍA 39, OLA 8, lote O8-6-datos-correos.
--
-- A39-S28-01 (ALTO): `candidatosSinDossier` escaneaba como máximo 2,000 filas
-- `nuevo|contactado` desde la más vieja en CADA llamada; las que ya tienen
-- dossier siguen en `nuevo`, así que al llegar a ~2,000 investigados las
-- páginas escaneadas eran todas con dossier y devolvía [] para siempre, con
-- latido verde. El filtro «sin dossier» tiene que vivir en la consulta (anti-
-- join), no en un escaneo acotado de JavaScript.
--
-- `prospectos_sin_dossier(p_limite)` devuelve los ids a investigar, los más
-- viejos primero: vivos (sin duplicado, nuevo|contactado) que NO tienen dossier,
-- o cuyo dossier es PROVISIONAL por caída del sitio (marca SITIO_NO_RESPONDIO|n|…
-- en `datos`, A37-S28-05) con menos de 5 intentos y más de 24 h de antigüedad.
-- Las constantes (5 intentos, 24 h) espejan MAX_INTENTOS_SITIO_CAIDO y
-- REINTENTO_SITIO_CAIDO_MS de investigador.ts.
--
-- Aditiva e idempotente (create or replace de una función NUEVA). SECURITY
-- INVOKER con search_path fijo: la llama solo service_role, que ya lee ambas
-- tablas. Sin permiso para anon/authenticated.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.prospectos_sin_dossier(p_limite integer default 5)
returns table (id uuid)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select p.id
    from public.prospecto p
    left join public.prospecto_dossier d on d.prospecto_id = p.id
   where p.duplicado_de is null
     and p.estado in ('nuevo', 'contactado')
     and (
       d.prospecto_id is null
       or exists (
         select 1
           from jsonb_array_elements(case when jsonb_typeof(d.datos) = 'array' then d.datos else '[]'::jsonb end) e
          where starts_with(coalesce(e ->> 'dato', ''), 'SITIO_NO_RESPONDIO|')
            and (case when split_part(e ->> 'dato', '|', 2) ~ '^[0-9]{1,9}$'
                      then split_part(e ->> 'dato', '|', 2)::integer else 1 end) < 5
            and d.investigado_en <= now() - interval '24 hours'
       )
     )
   order by p.created_at asc, p.id asc
   limit greatest(1, least(coalesce(p_limite, 5), 100));
$$;

revoke all on function public.prospectos_sin_dossier(integer) from public, anon, authenticated;
grant execute on function public.prospectos_sin_dossier(integer) to service_role;

comment on function public.prospectos_sin_dossier(integer) is
  'A39-S28-01: prospectos vivos a investigar (sin dossier o con dossier provisional vencido), los más viejos primero. Anti-join en la base: no hay tope de escaneo.';
