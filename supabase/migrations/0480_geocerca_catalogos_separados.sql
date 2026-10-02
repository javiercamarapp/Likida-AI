-- ═══════════════════════════════════════════════════════════════════════════
-- 0480 — `geocerca` sirve a DOS catálogos y ninguno puede pisar al otro.
--
-- La 0385 amplió `geocerca` (0050) con el catálogo de sitios del Conductor
-- (cliente, planta, andén, con `codigo`, padre y cliente dueño). Pero el editor
-- de geocercas de peajes (/dashboard/agentes/peajes/configuracion) ya escribía
-- la MISMA tabla con un upsert por (tenant, nombre): guardar «Planta Zapopan»
-- desde peajes cambiaba el `tipo` y las coordenadas de un sitio del Conductor
-- (hallazgo de la ronda 02). Dos pantallas, una tabla, una llave y ningún dueño.
--
-- La salida es separar por DUEÑO, no por tabla: la tabla sigue siendo una (los
-- lectores de estadías 0207, mapa y briefing ya apuntan a ella y una geocerca
-- sigue siendo un círculo con centro y radio), pero cada fila declara a qué
-- catálogo pertenece y la base lo impone:
--
--   `catalogo = 'peajes'`    → tipos: origen, destino, patio, punto_interes, restringida.
--   `catalogo = 'conductor'` → tipos: cliente, planta, anden, patio, punto_interes.
--
-- 1. `catalogo` es INMUTABLE: una fila no cambia de dueño (ni por upsert, ni por
--    UPDATE directo). Quien intente «adoptar» la fila del otro catálogo rebota.
-- 2. El tipo debe ser uno de los de SU catálogo (CHECK de pareja): un sitio del
--    Conductor no puede volverse `restringida`, ni una geocerca de peajes `planta`.
-- 3. Una fila nace en `conductor` si su tipo, su `codigo` o su `fuente = 'csv'`
--    lo delatan (el importador de la 0385 no necesita reescribirse); cualquier
--    otra nace en `peajes`, salvo que quien inserta diga `conductor` (el editor
--    manual de sitios, para `patio` y `punto_interes` sin código).
-- 4. El nombre sigue siendo único por flota (`geocerca_nombre_unico`): los dos
--    catálogos comparten espacio de nombres a propósito, porque un viaje apunta
--    a un sitio por nombre o código y dos «Patio Norte» serían ambiguos.
--
-- Datos existentes: hasta hoy ningún escritor ha puesto filas de sitios en una
-- base real (0385 aún no se aplica), así que lo que haya es de peajes; las filas
-- que ya parezcan de sitios (tipo del Conductor, `codigo`, `fuente = 'csv'`) se
-- reclasifican con el MISMO predicado del disparador.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.geocerca
  add column if not exists catalogo text not null default 'peajes';

alter table public.geocerca drop constraint if exists geocerca_catalogo_dominio;
alter table public.geocerca add constraint geocerca_catalogo_dominio
  check (catalogo in ('peajes', 'conductor'));

comment on column public.geocerca.catalogo is
  'Dueño de la fila: peajes (editor de geocercas de peajes) o conductor (catálogo de sitios del Agente 5). Inmutable; el tipo debe ser de su catálogo. 0480.';

-- Reclasificación ANTES de crear el CHECK de pareja (y antes del disparador).
update public.geocerca
   set catalogo = 'conductor'
 where catalogo = 'peajes'
   and (tipo in ('cliente', 'planta', 'anden') or codigo is not null or fuente = 'csv');

alter table public.geocerca drop constraint if exists geocerca_catalogo_tipo_pareja;
alter table public.geocerca add constraint geocerca_catalogo_tipo_pareja check (
  (catalogo = 'peajes'    and tipo in ('origen', 'destino', 'patio', 'punto_interes', 'restringida'))
  or
  (catalogo = 'conductor' and tipo in ('cliente', 'planta', 'anden', 'patio', 'punto_interes'))
);

create or replace function public.geocerca_catalogo_guardia() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    -- Lo que delata un sitio del Conductor manda sobre lo que diga quien inserta.
    if new.tipo in ('cliente', 'planta', 'anden') or new.codigo is not null or new.fuente = 'csv' then
      new.catalogo := 'conductor';
    end if;
    return new;
  end if;
  if new.catalogo is distinct from old.catalogo then
    raise exception 'geocerca.catalogo es inmutable: la fila % pertenece al catálogo %', old.id, old.catalogo
      using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists geocerca_catalogo_guardia on public.geocerca;
create trigger geocerca_catalogo_guardia
  before insert or update of catalogo on public.geocerca
  for each row execute function public.geocerca_catalogo_guardia();

revoke all on function public.geocerca_catalogo_guardia() from public, anon, authenticated;

create index if not exists geocerca_tenant_catalogo_idx on public.geocerca (tenant_id, catalogo, activa);
