-- ═══════════════════════════════════════════════════════════════════════════
-- 0050 — RASTREO: posiciones, geocercas y las credenciales del proveedor.
--
-- `dashboard/mapa` lo decía así: "Likida no está conectado a ningún GPS ni
-- plataforma de rastreo. El sistema no guarda una sola coordenada: lo que
-- sabe de un viaje es su origen y su destino escritos como texto".
--
-- ESTO CREA EL ESQUEMA, NO LA CONEXIÓN. No hay credenciales de ningún
-- proveedor todavía, así que estas tablas van a estar vacías hasta que una
-- flota conecte la suya. Una tabla vacía y una pantalla que dice "conecta tu
-- rastreo" es honesto; sembrarla con coordenadas de ejemplo no lo sería.
--
-- RLS: `posicion` y `geocerca` son de OFICINA (mismo criterio de la 0047):
-- el chofer se excluye con `not is_operador()`. Dónde va cada unidad de la
-- flota no es asunto de un operador — y su propia posición tampoco se la
-- devolvemos por aquí, porque abriría la puerta a leer la de los demás.
--
-- `rastreo_credencial` es MÁS ESTRICTA que todo lo demás del esquema: solo
-- flota_admin y superadmin. Ni el contador ni el encargado. Un token de API
-- de rastreo permite ver y a veces MANDAR órdenes a la flota entera, así que
-- no cabe en `ve_finanzas()` — no es dinero, es control.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Quién manda en las credenciales de rastreo ─────────────────────────────
create or replace function public.administra_flota()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.app_user
    where id = auth.uid() and rol in ('superadmin', 'flota_admin')
  );
$$;

comment on function public.administra_flota is
  'TRUE solo para superadmin y flota_admin. Para lo que no es dinero sino CONTROL: tokens de rastreo, integraciones. Ni el contador ni el encargado.';

revoke execute on function public.administra_flota() from anon;

-- ── Posiciones ─────────────────────────────────────────────────────────────
create table if not exists public.posicion (
  id          bigserial primary key,
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  unidad_id   uuid not null references public.unidad(id) on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  velocidad   double precision,
  rumbo       double precision,
  odometro    double precision,
  -- El instante que reporta el GPS, NO el de la inserción: un proveedor puede
  -- entregar en lote posiciones de hace una hora, y ordenarlas por hora de
  -- llegada dibujaría una ruta que el camión nunca hizo.
  medida_en   timestamptz not null,
  recibida_en timestamptz not null default now(),
  proveedor   text not null,
  constraint posicion_lat_valida check (lat between -90 and 90),
  constraint posicion_lng_valida check (lng between -180 and 180),
  constraint posicion_velocidad_sana check (velocidad is null or (velocidad >= 0 and velocidad < 250))
);

comment on table public.posicion is
  'Serie de posiciones por unidad. Vacía hasta que una flota conecte su proveedor: no se siembra con coordenadas de ejemplo.';
comment on column public.posicion.medida_en is
  'El instante que reporta el GPS, no el de la insercion. Ordenar por hora de llegada dibujaria una ruta que el camion nunca hizo.';

-- La misma lectura entregada dos veces por un reintento del proveedor no se
-- guarda dos veces: duplicaría la distancia recorrida y con ella el km/l.
create unique index if not exists posicion_sin_duplicado
  on public.posicion (unidad_id, medida_en, proveedor);

create index if not exists posicion_unidad_tiempo_idx
  on public.posicion (tenant_id, unidad_id, medida_en desc);

-- ── Geocercas ──────────────────────────────────────────────────────────────
--
-- Círculo (centro + radio) y no polígono: sin PostGIS un polígono habría que
-- guardarlo como JSON y resolverlo en la aplicación, y ahí es donde se cuela
-- el error de "adentro/afuera" que nadie audita. El círculo se resuelve con
-- aritmética y se puede verificar a mano.
create table if not exists public.geocerca (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenant(id) on delete cascade,
  nombre     text not null,
  tipo       text not null default 'punto_interes',
  lat        double precision not null,
  lng        double precision not null,
  radio_m    int not null,
  activa     boolean not null default true,
  creada_en  timestamptz not null default now(),
  constraint geocerca_tipo_dominio check (tipo in ('origen', 'destino', 'patio', 'punto_interes', 'restringida')),
  constraint geocerca_lat_valida check (lat between -90 and 90),
  constraint geocerca_lng_valida check (lng between -180 and 180),
  constraint geocerca_radio_sano check (radio_m between 25 and 100000),
  constraint geocerca_nombre_unico unique (tenant_id, nombre)
);

comment on column public.geocerca.radio_m is
  'Radio en metros. Minimo 25: por debajo, el error tipico del GPS civil (~10 m) hace que la unidad entre y salga sola y la bitacora se llene de eventos falsos.';

create index if not exists geocerca_tenant_activa_idx on public.geocerca (tenant_id, activa);

-- ── Credenciales del proveedor de rastreo ──────────────────────────────────
--
-- EL TOKEN NO SE PUEDE LEER DESDE EL PANEL, y por eso hay dos columnas. El
-- secreto vive en `token_cifrado` (lo escribe y descifra el servidor con su
-- llave, nunca PostgREST); la UI solo enseña `token_ultimos4` y "configurado".
-- Un panel que muestra el token completo lo filtra a cualquiera que mire la
-- pantalla, y un token de rastreo no expira solo.
create table if not exists public.rastreo_credencial (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete cascade,
  proveedor      text not null,
  token_cifrado  text,
  token_ultimos4 text,
  usuario        text,
  base_url       text,
  activo         boolean not null default true,
  probada_en     timestamptz,
  ultimo_error   text,
  creada_en      timestamptz not null default now(),
  constraint rastreo_proveedor_dominio
    check (proveedor in ('wialon', 'traccar', 'samsara', 'geotab', 'navixy', 'otro')),
  constraint rastreo_una_por_proveedor unique (tenant_id, proveedor)
);

comment on table public.rastreo_credencial is
  'Credenciales del proveedor de rastreo por flota. El token nunca se devuelve al panel: la UI ensena "configurado" y los ultimos 4.';
comment on column public.rastreo_credencial.ultimo_error is
  'El error exacto del ultimo "Probar conexion". Es lo que convierte "escrito" en "verificable": sin el, una integracion rota se ve igual que una que nadie uso.';

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.posicion           enable row level security;
alter table public.geocerca           enable row level security;
alter table public.rastreo_credencial enable row level security;

create policy tenant_data on public.posicion for all
  using ((tenant_id = any(get_user_tenant_ids()) and not is_operador()) or is_superadmin())
  with check ((tenant_id = any(get_user_tenant_ids()) and not is_operador()) or is_superadmin());

create policy tenant_data on public.geocerca for all
  using ((tenant_id = any(get_user_tenant_ids()) and not is_operador()) or is_superadmin())
  with check ((tenant_id = any(get_user_tenant_ids()) and not is_operador()) or is_superadmin());

-- Más estricta a propósito: control, no lectura.
create policy solo_admin_flota on public.rastreo_credencial for all
  using ((tenant_id = any(get_user_tenant_ids()) and administra_flota()) or is_superadmin())
  with check ((tenant_id = any(get_user_tenant_ids()) and administra_flota()) or is_superadmin());
