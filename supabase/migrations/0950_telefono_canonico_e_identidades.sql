-- REVERSA: `drop index if exists public.operador_telefono_canonico_idx, public.app_user_telefono_canonico_idx, public.vigia_contacto_telefono_canonico_idx;` (después de las funciones, o antes: no dependen de ellos) `drop function if exists public.telefono_identidad_conflictos(); drop function if exists public.telefono_identidades(text); drop function if exists public.telefono_enmascarado(text); drop function if exists public.telefono_canonico(text);` (en ese orden; la 0951 y la 0952 dependen de estas funciones: revertirlas ANTES). No hay datos que reponer: la migración no escribe ninguna fila.
-- ═══════════════════════════════════════════════════════════════════════════
-- 0950 — F1 lote B, L1H (CT-SEG-07 / X-01 / BK-03): el teléfono es la llave de identidad de WhatsApp y hoy NO hay
-- unicidad entre `operador`, `app_user` y `vigia_contacto` ni entre flotas. Esta migración pone la BASE común para
-- resolverlo SIN romper filas existentes (puede haber duplicados hoy; no se sabe hasta que Javier corra
-- `scripts/f1-consulta-duplicados-telefono.sql`):
--
--   · `telefono_canonico(text)`: la forma canónica del teléfono (solo dígitos; `521`+10 → `52`+10; 10 dígitos → `52`+10).
--     Es la misma regla de `variantesTelefono` (TS) y de `telefono_normalizado` (0024) más la forma nacional de 10 dígitos
--     que `variantesTelefono` también casa. NO reemplaza a `telefono_normalizado` (sus índices de 0024/0932 siguen igual).
--   · `telefono_enmascarado(text)`: para diagnósticos; deja solo los 4 últimos dígitos.
--   · `telefono_identidades(canon)`: las identidades ACTIVAS que el bot puede resolver por teléfono (operador activo sin
--     marcador `sin-tel:`, app_user activo con teléfono, vigia_contacto en estado activo). Las usan el guardián (0951) y el
--     resolutor (0952).
--   · `telefono_identidad_conflictos()`: de solo lectura; lista los duplicados que ya existen, con el teléfono ENMASCARADO.
--
-- Aditiva e idempotente (`create or replace`, `create index if not exists`). No toca filas; solo agrega 3 índices por expresión
-- (no únicos) sobre `telefono_canonico` para que el guardián (0951) y el resolutor (0952) busquen por índice y no
-- recorran las tablas. Solo `service_role` ejecuta lo que lee datos.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.telefono_canonico(p_telefono text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog, public
as $$
  select case
           when x.d = '' then null
           -- F1B: prefijos de marcacion historicos que NO son parte del numero: 00 internacional (0052…), 044/045
           -- (celular local/nacional, ya desusados) y 01 (larga distancia nacional). Antes «044 999 111 0001» daba
           -- 0449991110001 y no chocaba con 529991110001.
           when x.d ~ '^00521[0-9]{10}$' or x.d ~ '^0052[0-9]{10}$' then '52' || right(x.d, 10)
           when x.d ~ '^04[45][0-9]{10}$' or x.d ~ '^01[0-9]{10}$' then '52' || right(x.d, 10)
           when x.d ~ '^521[0-9]{10}$' then '52' || right(x.d, 10)
           when x.d ~ '^[0-9]{10}$' then '52' || x.d
           else x.d
         end
    from (select regexp_replace(coalesce(p_telefono, ''), '[^0-9]', '', 'g') as d) x
$$;

comment on function public.telefono_canonico(text) is
  '0950: forma canónica de un teléfono de WhatsApp: solo dígitos; 521+10 → 52+10; 10 dígitos nacionales → 52+10; sin dígitos → NULL (p. ej. el marcador «sin-tel:…»). Misma regla que variantesTelefono (TS).';

create or replace function public.telefono_enmascarado(p_telefono text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog, public
as $$
  select case
           when c.v is null then null
           when length(c.v) <= 4 then repeat('*', length(c.v))
           else repeat('*', length(c.v) - 4) || right(c.v, 4)
         end
    from (select public.telefono_canonico(p_telefono) as v) c
$$;

comment on function public.telefono_enmascarado(text) is
  '0950: el teléfono canónico con todo oculto salvo los 4 últimos dígitos. Para diagnósticos y logs.';

-- Índices por expresión sobre la forma canónica: SIN ellos `telefono_identidades(canon)` recorre las tres tablas enteras y
-- aplica `telefono_canonico` (regexp) a cada fila, y el disparador de la 0951 lo hace en CADA alta: insertar N operadores
-- costaba O(N²) (5,000 altas en la batería de CI colgaban el job de 10 min). No son únicos (los duplicados históricos
-- existen) y son aditivos/idempotentes. `telefono_canonico` es immutable, así que es indexable.
create index if not exists operador_telefono_canonico_idx on public.operador (public.telefono_canonico(telefono));
create index if not exists app_user_telefono_canonico_idx on public.app_user (public.telefono_canonico(telefono));
create index if not exists vigia_contacto_telefono_canonico_idx on public.vigia_contacto (public.telefono_canonico(telefono));

-- plpgsql y no sql a propósito: con `(p_canon is null or canon = p_canon)` el plan genérico de una función SQL no puede
-- usar el índice (OR con parámetro). Aquí la rama con número consulta cada tabla con `telefono_canonico(col) = p_canon`
-- (sargable); la rama sin número (diagnóstico de conflictos, de uso raro) sí recorre todo.
create or replace function public.telefono_identidades(p_canon text default null)
returns table (tabla text, ref_id uuid, tenant_id uuid, canon text)
language plpgsql
stable
set search_path = pg_catalog, public
as $$
begin
  if p_canon is null then
    return query
    select i.tabla, i.ref_id, i.tenant_id, i.canon
      from (
        select 'operador'::text as tabla, o.id as ref_id, o.tenant_id as tenant_id, public.telefono_canonico(o.telefono) as canon
          from public.operador o
         where o.activo and o.telefono !~ '^sin-tel:' and o.telefono !~ '[A-Za-z:]'
        union all
        select 'app_user'::text, u.id, u.tenant_id, public.telefono_canonico(u.telefono)
          from public.app_user u
         -- F1B: sin flota (superadmin / vendedor de Likida, tenant_id NULL) no es una «flota» mas: contarlo daba
         -- «ambigua» al compartir el numero con un operador y el disparador rechazaba el alta.
         where u.telefono is not null and u.activo and u.tenant_id is not null and u.telefono !~ '[A-Za-z:]'
        union all
        select 'vigia_contacto'::text, c.id, c.tenant_id, public.telefono_canonico(c.telefono)
          from public.vigia_contacto c
         where c.estado = 'activo' and c.telefono !~ '[A-Za-z:]'
      ) i
     -- solo números marcables: excluye marcadores y basura. El marcador ARCO «anon:<hex>» se excluye por la columna
     -- CRUDA (letras o «:»), no por el canónico: sus dígitos hex sueltos (1201 de 2000 marcadores aleatorios) pasaban
     -- el filtro de 10-15 dígitos (F1B).
     where i.canon ~ '^[0-9]{10,15}$';
  else
    return query
    select i.tabla, i.ref_id, i.tenant_id, i.canon
      from (
        select 'operador'::text as tabla, o.id as ref_id, o.tenant_id as tenant_id, public.telefono_canonico(o.telefono) as canon
          from public.operador o
         where public.telefono_canonico(o.telefono) = p_canon
           and o.activo and o.telefono !~ '^sin-tel:' and o.telefono !~ '[A-Za-z:]'
        union all
        select 'app_user'::text, u.id, u.tenant_id, public.telefono_canonico(u.telefono)
          from public.app_user u
         where public.telefono_canonico(u.telefono) = p_canon
           and u.telefono is not null and u.activo and u.tenant_id is not null and u.telefono !~ '[A-Za-z:]'
        union all
        select 'vigia_contacto'::text, c.id, c.tenant_id, public.telefono_canonico(c.telefono)
          from public.vigia_contacto c
         where public.telefono_canonico(c.telefono) = p_canon
           and c.estado = 'activo' and c.telefono !~ '[A-Za-z:]'
      ) i
     where i.canon ~ '^[0-9]{10,15}$';
  end if;
end;
$$;

comment on function public.telefono_identidades(text) is
  '0950: identidades ACTIVAS resolubles por teléfono (operador, app_user, vigia_contacto), con el teléfono canónico. Con p_canon filtra a ese número. Solo service_role.';

create or replace function public.telefono_identidad_conflictos()
returns table (
  telefono_enmascarado text,
  tipo text,
  filas integer,
  flotas integer,
  tablas text[],
  tenants uuid[],
  refs text[]
)
language sql
stable
set search_path = pg_catalog, public
as $$
  select public.telefono_enmascarado(g.canon),
         case when count(distinct coalesce(g.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)) > 1
              then 'entre_flotas' else 'misma_flota' end,
         count(*)::integer,
         count(distinct coalesce(g.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid))::integer,
         array_agg(distinct g.tabla order by g.tabla),
         array_agg(distinct g.tenant_id order by g.tenant_id),
         array_agg(g.tabla || ':' || g.ref_id::text order by g.tabla, g.ref_id)
    from public.telefono_identidades() g
   group by g.canon
  having count(*) > 1
   order by 2, 3 desc, 1
$$;

comment on function public.telefono_identidad_conflictos() is
  '0950: teléfonos canónicos que hoy identifican a más de una identidad activa. SOLO LECTURA; el teléfono sale enmascarado. tipo = entre_flotas (grave: el bot no puede saber de qué flota es) o misma_flota (varias identidades de una sola flota).';

revoke all on function public.telefono_identidades(text) from public, anon, authenticated;
revoke all on function public.telefono_identidad_conflictos() from public, anon, authenticated;
grant execute on function public.telefono_identidades(text) to service_role;
grant execute on function public.telefono_identidad_conflictos() to service_role;
