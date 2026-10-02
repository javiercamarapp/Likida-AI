-- ═══════════════════════════════════════════════════════════════════════════
-- 0665 — PEAJES: los «CURSOS» (rutas autorizadas) para reclamar los cruces fuera de curso.
--
-- LOOP PUNTA A PUNTA, ola 4, P8 «peajes-cursos». El cliente pidió cruzar el archivo de pases contra las posiciones GPS y
-- sus geocercas o «cursos»: las rutas autorizadas de cada unidad. Un pase en una caseta que NO está en el curso de la
-- unidad es un cruce fuera de curso, y es motivo para pedirle al proveedor el descuento (`fuera_de_curso`, reclamacion.ts).
--
-- DOS FORMAS DE CURSO (la segunda espera el formato real del cliente, 12-oct; aquí nace con contrato y datos sintéticos):
--   · `casetas`  — la lista de casetas autorizadas (catálogo `peaje_caseta`) de un convenio A→B o de una unidad. NO depende
--                  de nada del cliente: los convenios (0580) y el catálogo de casetas ya existen.
--   · `corredor` — una polilínea (la ruta) con un buffer en metros. La posición GPS a la hora del pase debe caer dentro del
--                  buffer; si no, es fuera de curso.
--
-- A QUIÉN APLICA un curso: a una unidad (`unidad_id`), a un convenio (`convenio_id`: aplica al viaje ligado a ese convenio,
-- 0580 `viaje_convenio`) o a ambos a la vez (la unidad solo dentro de ese convenio). Un curso sin ninguno de los dos no aplica
-- a nadie y la base lo rechaza.
--
-- LO QUE GARANTIZA LA BASE (y por qué no basta el código):
--   1. Todo es DE LA MISMA FLOTA por FK compuesta (molde 0145/0298/0580): un curso de la flota A no puede apuntar a la unidad,
--      al convenio ni a la caseta de la flota B aunque alguien mande su uuid.
--   2. El CHECK de forma: `casetas` no lleva polilínea ni buffer; `corredor` los lleva (2–2,000 vértices, buffer 25–20,000 m).
--   3. `peaje_curso_reemplazar(...)` guarda un lote de cursos TODO-O-NADA en una transacción: el curso se identifica por el
--      código de SU sistema (re-importar actualiza, no duplica), sus casetas se reemplazan enteras y cualquier fallo revierte el
--      lote completo con un `estado` que el código traduce a un mensaje.
--
-- RLS: deny-all (prendida SIN políticas; solo service_role, que filtra por tenant en cada consulta), igual que la 0375.
-- Idempotente: `if not exists`, guardas `pg_constraint`, `create or replace`. Rango asignado a P8: 0665–0669.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.peaje_curso (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete cascade,
  -- La llave de SU sistema: re-importar el mismo código actualiza.
  codigo         text not null,
  nombre         text not null,
  tipo           text not null,
  unidad_id      uuid,
  convenio_id    uuid,
  vigente_desde  date,
  vigente_hasta  date,
  -- Solo `corredor`: [{"lat": 19.4, "lng": -99.1}, …] y el ancho (m) a cada lado de la ruta.
  corredor       jsonb,
  buffer_m       integer,
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint peaje_curso_codigo_largo check (char_length(codigo) between 1 and 80),
  constraint peaje_curso_nombre_largo check (char_length(nombre) between 1 and 160),
  constraint peaje_curso_tipo_dominio check (tipo in ('casetas', 'corredor')),
  constraint peaje_curso_aplica_a check (unidad_id is not null or convenio_id is not null),
  constraint peaje_curso_vigencia_coherente check (vigente_hasta is null or vigente_desde is null or vigente_hasta >= vigente_desde),
  constraint peaje_curso_forma check (
    (tipo = 'casetas' and corredor is null and buffer_m is null)
    or (tipo = 'corredor' and corredor is not null and jsonb_typeof(corredor) = 'array'
        and jsonb_array_length(corredor) between 2 and 2000 and buffer_m between 25 and 20000)
  ),
  constraint peaje_curso_unico unique (tenant_id, codigo),
  constraint peaje_curso_id_tenant_key unique (id, tenant_id)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'peaje_curso_unidad_tenant_fkey' and conrelid = 'public.peaje_curso'::regclass) then
    alter table public.peaje_curso add constraint peaje_curso_unidad_tenant_fkey
      foreign key (unidad_id, tenant_id) references public.unidad (id, tenant_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'peaje_curso_convenio_tenant_fkey' and conrelid = 'public.peaje_curso'::regclass) then
    alter table public.peaje_curso add constraint peaje_curso_convenio_tenant_fkey
      foreign key (convenio_id, tenant_id) references public.cliente_convenio (id, tenant_id) on delete cascade;
  end if;
end $$;

create index if not exists peaje_curso_unidad_idx on public.peaje_curso (tenant_id, unidad_id) where unidad_id is not null;
create index if not exists peaje_curso_convenio_idx on public.peaje_curso (tenant_id, convenio_id) where convenio_id is not null;

comment on table public.peaje_curso is
  '0665: ruta autorizada. tipo casetas = lista de casetas del catálogo (peaje_curso_caseta); tipo corredor = polilínea + buffer en metros (formato del cliente pendiente). Aplica a una unidad, a un convenio o a ambos.';

create table if not exists public.peaje_curso_caseta (
  curso_id   uuid not null,
  caseta_id  uuid not null,
  tenant_id  uuid not null references public.tenant(id) on delete cascade,
  orden      integer not null default 0,
  constraint peaje_curso_caseta_pk primary key (curso_id, caseta_id),
  constraint peaje_curso_caseta_orden_sano check (orden between 0 and 999)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'peaje_curso_caseta_curso_tenant_fkey' and conrelid = 'public.peaje_curso_caseta'::regclass) then
    alter table public.peaje_curso_caseta add constraint peaje_curso_caseta_curso_tenant_fkey
      foreign key (curso_id, tenant_id) references public.peaje_curso (id, tenant_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'peaje_curso_caseta_caseta_tenant_fkey' and conrelid = 'public.peaje_curso_caseta'::regclass) then
    alter table public.peaje_curso_caseta add constraint peaje_curso_caseta_caseta_tenant_fkey
      foreign key (caseta_id, tenant_id) references public.peaje_caseta (id, tenant_id) on delete cascade;
  end if;
end $$;

create index if not exists peaje_curso_caseta_tenant_idx on public.peaje_curso_caseta (tenant_id, curso_id);

comment on table public.peaje_curso_caseta is
  '0665: las casetas autorizadas de un curso de tipo casetas, en orden de recorrido (A→B). Borrar la caseta del catálogo la quita del curso.';

-- ── RLS (deny-all; solo service_role) ───────────────────────────────────────
alter table public.peaje_curso enable row level security;
alter table public.peaje_curso_caseta enable row level security;

-- ── Guardado atómico de un lote de cursos ───────────────────────────────────
-- p_cursos: arreglo de {codigo, nombre, tipo, unidad_id, convenio_id, vigente_desde, vigente_hasta, corredor, buffer_m, casetas: [uuid…]}.
-- Devuelve jsonb {estado: ok | invalida | referencia_invalida, creados, actualizados}. Cualquier fallo revierte el lote completo.
create or replace function public.peaje_curso_reemplazar(p_tenant uuid, p_cursos jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_item jsonb; v_id uuid; v_nuevo boolean; v_creados integer := 0; v_actualizados integer := 0; v_casetas jsonb; v_c text; v_orden integer;
begin
  if p_tenant is null or p_cursos is null or jsonb_typeof(p_cursos) <> 'array' then
    return jsonb_build_object('estado', 'invalida');
  end if;
  if jsonb_array_length(p_cursos) > 500 then
    raise exception 'un lote admite hasta 500 cursos' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_cursos) loop
    v_casetas := coalesce(v_item->'casetas', '[]'::jsonb);
    -- Un `return` aquí dejaría guardados los cursos anteriores del lote: se lanza y el handler de abajo revierte TODO.
    if jsonb_typeof(v_casetas) <> 'array' or jsonb_array_length(v_casetas) > 200 then
      raise exception 'casetas invalidas' using errcode = 'PC001';
    end if;
    -- Un curso de casetas sin casetas autorizaría nada: no se guarda (un corredor no lleva casetas).
    if (v_item->>'tipo') = 'casetas' and jsonb_array_length(v_casetas) = 0 then
      raise exception 'curso de casetas sin casetas' using errcode = 'PC001';
    end if;
    if (v_item->>'tipo') = 'corredor' and jsonb_array_length(v_casetas) > 0 then
      raise exception 'un corredor no lleva casetas' using errcode = 'PC001';
    end if;

    insert into public.peaje_curso
      (tenant_id, codigo, nombre, tipo, unidad_id, convenio_id, vigente_desde, vigente_hasta, corredor, buffer_m, activo)
    values (
      p_tenant, v_item->>'codigo', v_item->>'nombre', v_item->>'tipo',
      nullif(v_item->>'unidad_id', '')::uuid, nullif(v_item->>'convenio_id', '')::uuid,
      nullif(v_item->>'vigente_desde', '')::date, nullif(v_item->>'vigente_hasta', '')::date,
      case when jsonb_typeof(v_item->'corredor') = 'array' then v_item->'corredor' else null end,
      nullif(v_item->>'buffer_m', '')::integer, true
    )
    on conflict (tenant_id, codigo) do update set
      nombre = excluded.nombre, tipo = excluded.tipo, unidad_id = excluded.unidad_id, convenio_id = excluded.convenio_id,
      vigente_desde = excluded.vigente_desde, vigente_hasta = excluded.vigente_hasta, corredor = excluded.corredor,
      buffer_m = excluded.buffer_m, activo = true, actualizado_en = now()
    returning id, (xmax = 0) into v_id, v_nuevo;
    if v_nuevo then v_creados := v_creados + 1; else v_actualizados := v_actualizados + 1; end if;

    delete from public.peaje_curso_caseta where curso_id = v_id and tenant_id = p_tenant;
    v_orden := 0;
    for v_c in select jsonb_array_elements_text(v_casetas) loop
      insert into public.peaje_curso_caseta (curso_id, caseta_id, tenant_id, orden)
        values (v_id, v_c::uuid, p_tenant, v_orden)
        on conflict (curso_id, caseta_id) do nothing;
      v_orden := v_orden + 1;
    end loop;
  end loop;
  return jsonb_build_object('estado', 'ok', 'creados', v_creados, 'actualizados', v_actualizados);
exception
  when foreign_key_violation then return jsonb_build_object('estado', 'referencia_invalida');
  when sqlstate 'PC001' or check_violation or not_null_violation or invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range
    then return jsonb_build_object('estado', 'invalida');
end;
$$;

revoke all on function public.peaje_curso_reemplazar(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.peaje_curso_reemplazar(uuid, jsonb) to service_role;

comment on function public.peaje_curso_reemplazar(uuid, jsonb) is
  '0665: guarda un lote de cursos TODO-O-NADA (upsert por código, casetas reemplazadas enteras). estado: ok | invalida | referencia_invalida (unidad, convenio o caseta que no son de la flota).';
