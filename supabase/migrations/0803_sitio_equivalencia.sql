-- ═══════════════════════════════════════════════════════════════════════════
-- 0803 — Equivalencias texto→sitio: lo que la oficina ya sabe y el nombre no dice.
--
-- El origen y el destino de un viaje llegan como TEXTO LIBRE del programa de despacho («STOP <planta> FINAL <producto>»,
-- «VACIO <cliente>», «SALIR A RUTA ANTES DE LAS 7 PM»). `derivarSitio` (0637) solo liga por código, nombre exacto o nombre
-- contenido, así que casi todo eso quedaba sin sitio, y sin sitio no hay hito por geocerca. Esta tabla es el diccionario de la
-- flota: «este texto (normalizado) ES este sitio», o «este texto NO es un lugar» (instrucción, no excepción).
--
--   · `texto_normalizado` es el texto ya pasado por `normalizarNombre` (minúsculas, sin acentos ni puntuación, espacios simples);
--   · `tipo`: `sitio` (liga a `geocerca_id`) · `sin_sitio` / `ignorar` (no es un lugar; el viaje queda «sin sitio, por decisión»);
--   · `lado`: el diccionario puede valer para origen, destino o ambos; `cliente_id` desempata homónimos entre clientes;
--   · UNIQUE (flota, texto, lado, cliente-o-ninguno): reimportar no duplica.
--
-- 0637: el CHECK de `criterio` de `viaje_sitio_derivado` admite además `equivalencia` (sitio ligado por esta tabla) y
-- `equivalencia_sin_sitio` (constancia de la decisión «no es un lugar», con `geocerca_id` nulo). Sin coordenadas ni personas.
-- Lo escribe el servidor; lectura como `viaje_cruce_geocerca` (0635).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.sitio_equivalencia (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  texto_normalizado text not null,
  lado text not null default 'ambos',
  geocerca_id uuid,
  tipo text not null,
  cliente_id uuid,
  creado_por uuid references public.app_user(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint sitio_equivalencia_sitio_fkey
    foreign key (geocerca_id, tenant_id) references public.geocerca (id, tenant_id) on delete cascade,
  -- FK compuesta (regla de 0145/0600): el cliente tiene que ser de la misma flota que la equivalencia.
  constraint sitio_equivalencia_cliente_fkey
    foreign key (cliente_id, tenant_id) references public.cliente (id, tenant_id) on delete cascade,
  constraint sitio_equivalencia_lado_dominio check (lado in ('origen', 'destino', 'ambos')),
  constraint sitio_equivalencia_tipo_dominio check (tipo in ('sitio', 'sin_sitio', 'ignorar')),
  constraint sitio_equivalencia_tipo_sitio check ((tipo = 'sitio') = (geocerca_id is not null)),
  constraint sitio_equivalencia_texto_no_vacio check (length(texto_normalizado) > 0)
);
comment on table public.sitio_equivalencia is
  '0803: diccionario de la flota texto de origen/destino (normalizado) → sitio, o «no es un lugar» (sin_sitio/ignorar). Gana a los criterios por nombre en derivarSitio; ante duda no se asigna. Sin coordenadas ni datos de personas.';
create unique index if not exists sitio_equivalencia_unica
  on public.sitio_equivalencia (tenant_id, texto_normalizado, lado, coalesce(cliente_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists sitio_equivalencia_tenant_idx on public.sitio_equivalencia (tenant_id, created_at desc);

alter table public.sitio_equivalencia enable row level security;
drop policy if exists tenant_lee on public.sitio_equivalencia;
create policy tenant_lee on public.sitio_equivalencia for select
  using (
    (tenant_id = any(public.get_user_tenant_ids()) and (select public.ve_operacion()))
    or (select public.is_superadmin())
  );
revoke all on table public.sitio_equivalencia from public, anon, authenticated;
grant select on table public.sitio_equivalencia to authenticated;
grant select, insert, update, delete on table public.sitio_equivalencia to service_role;

-- 0637: dos criterios nuevos en la constancia de qué derivó el sistema (reaplicable).
alter table public.viaje_sitio_derivado drop constraint if exists viaje_sitio_derivado_criterio_dominio;
alter table public.viaje_sitio_derivado add constraint viaje_sitio_derivado_criterio_dominio
  check (criterio in ('codigo', 'nombre_exacto', 'nombre_contenido', 'equivalencia', 'equivalencia_sin_sitio')) not valid;
alter table public.viaje_sitio_derivado validate constraint viaje_sitio_derivado_criterio_dominio;
