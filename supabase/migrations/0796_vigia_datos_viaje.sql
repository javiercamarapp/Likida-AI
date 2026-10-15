-- ═══════════════════════════════════════════════════════════════════════════
-- 0796 — Datos del viaje que el cliente pide por adelantado (Agente 4, Vigía).
--
-- Lo que pidió el cliente (levantamiento 747a3730, 00:21): cada día se gastan horas mandando, para cada servicio,
-- «el número de la caja, las placas de la caja y el estado de la caja, la unidad, las placas de la unidad, el operador
-- asignado, la licencia y vigencia y el teléfono del operador», y se piden horas antes de que el sistema los tenga. En el
-- CSV del programa no vienen placas, operador, licencia ni teléfono, así que hace falta un lugar donde vivan:
--
--   · `vigia_caja`               catálogo de cajas de la flota (número, línea, placas, estado), cargable por CSV o a mano.
--   · `vigia_dato_viaje_manual`  lo que alguien captura a mano para UNA fila del programa (operador, licencia, teléfono,
--                                placas, estado de la caja) mientras no lo traiga el sistema. Uno por fila.
--   · `vigia_politica_datos`     qué campos se le pueden dar a un cliente: una regla general (cliente_id null) y reglas por
--                                cliente que mandan sobre la general. `vigia_dato_visible()` resuelve la que aplica; sin
--                                regla alguna los datos personales del operador quedan ocultos (T-A4-12 afina la política).
--
-- Todo lo escribe el servidor (service_role); la lectura es para quien atiende clientes (`ve_atencion_cliente()`, 0400),
-- igual que 0795. El código que lea estas tablas debe tolerar su ausencia (42P01 / PGRST205 = «aún no aplicada»).
--
-- DATOS PERSONALES Y ARCO. `vigia_dato_viaje_manual` guarda nombre, licencia y teléfono de un operador. Borrar al
-- operador borra su captura (FK con ON DELETE CASCADE). OJO: la cancelación ARCO (`ejecutar_arco_cancelacion`, 0262/0356/…)
-- ANONIMIZA al operador, no lo borra, así que NO dispara esa cascada; limpiar esta tabla desde ARCO exige redefinir esa
-- función en una migración posterior (no se hace aquí: es una migración vigente y protegida). Pendiente anotado en
-- `_construccion/T-A4-10.md` con la prueba que lo exige.
--
-- ROLLBACK (en orden inverso; solo la función y las tres tablas, ninguna otra migración depende de ellas):
--   drop function if exists public.vigia_dato_visible(uuid, uuid, text, boolean);
--   drop table if exists public.vigia_politica_datos;
--   drop table if exists public.vigia_dato_viaje_manual;
--   drop table if exists public.vigia_caja;
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.vigia_caja (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete cascade,
  numero         text not null,
  linea          text,
  placas         text,
  estado         text,
  fuente         text not null default 'csv',
  actualizado_en timestamptz not null default now(),
  constraint vigia_caja_id_tenant_key unique (id, tenant_id),
  constraint vigia_caja_numero_forma check (char_length(btrim(numero)) between 1 and 40),
  constraint vigia_caja_linea_forma check (linea is null or char_length(btrim(linea)) between 1 and 40),
  constraint vigia_caja_placas_forma check (placas is null or placas ~ '^[A-Z0-9-]{3,12}$'),
  constraint vigia_caja_estado check (estado is null or estado in ('vacia', 'cargada', 'en_patio', 'en_transito', 'desconocido')),
  constraint vigia_caja_fuente check (fuente in ('csv', 'manual', 'sistema'))
);
create unique index if not exists vigia_caja_numero_uq
  on public.vigia_caja (tenant_id, lower(btrim(numero)));
comment on table public.vigia_caja is
  '0796: catálogo de cajas de la flota (número, línea, placas, estado). Único por flota y número sin importar mayúsculas ni espacios en los extremos.';
comment on column public.vigia_caja.numero is '0796: número de caja tal como lo usa la flota (texto: se conservan ceros a la izquierda y letras).';
comment on column public.vigia_caja.linea is '0796: línea transportista dueña de la caja, si el catálogo la trae.';
comment on column public.vigia_caja.placas is '0796: placas de la caja (mayúsculas, sin espacios; 3–12 letras, números o guiones); null si no se conocen.';
comment on column public.vigia_caja.estado is '0796: estado de la caja (vacia, cargada, en_patio, en_transito, desconocido); null si no se sabe.';
comment on column public.vigia_caja.fuente is '0796: de dónde salió el renglón: csv (importador), manual (captura) o sistema (conector).';

create table if not exists public.vigia_dato_viaje_manual (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete cascade,
  fila_id        uuid not null,
  operador_id    uuid,
  operador_nombre text,
  licencia       text,
  licencia_vence date,
  telefono       text,
  placas_unidad  text,
  placas_caja    text,
  estado_caja    text,
  editado_por    uuid,
  en             timestamptz not null default now(),
  constraint vigia_dato_viaje_manual_id_tenant_key unique (id, tenant_id),
  constraint vigia_dato_viaje_manual_fila_fkey
    foreign key (fila_id, tenant_id) references public.programa_despacho_fila (id, tenant_id) on delete cascade,
  constraint vigia_dato_viaje_manual_operador_fkey
    foreign key (operador_id, tenant_id) references public.operador (id, tenant_id) on delete cascade,
  constraint vigia_dato_viaje_manual_fila_unica unique (tenant_id, fila_id),
  constraint vigia_dato_viaje_manual_nombre_forma check (operador_nombre is null or char_length(btrim(operador_nombre)) between 1 and 120),
  constraint vigia_dato_viaje_manual_licencia_forma check (licencia is null or char_length(btrim(licencia)) between 1 and 40),
  constraint vigia_dato_viaje_manual_telefono check (telefono is null or telefono ~ '^52[0-9]{10}$'),
  constraint vigia_dato_viaje_manual_placas_unidad check (placas_unidad is null or placas_unidad ~ '^[A-Z0-9-]{3,12}$'),
  constraint vigia_dato_viaje_manual_placas_caja check (placas_caja is null or placas_caja ~ '^[A-Z0-9-]{3,12}$'),
  constraint vigia_dato_viaje_manual_estado_caja check (
    estado_caja is null or estado_caja in ('vacia', 'cargada', 'en_patio', 'en_transito', 'desconocido'))
);
create index if not exists vigia_dato_viaje_manual_operador_idx
  on public.vigia_dato_viaje_manual (tenant_id, operador_id) where operador_id is not null;
comment on table public.vigia_dato_viaje_manual is
  '0796: datos del viaje capturados a mano para una fila del programa (operador, licencia, teléfono, placas, estado de la caja) mientras el sistema no los trae. Uno por fila. Dato personal: ver ARCO en la cabecera de la migración.';
comment on column public.vigia_dato_viaje_manual.fila_id is '0796: fila del programa de despacho (0795) a la que pertenece la captura; borrar la fila borra la captura.';
comment on column public.vigia_dato_viaje_manual.operador_id is '0796: operador del catálogo, si se eligió uno; null si se escribió a mano. Borrar al operador borra la captura.';
comment on column public.vigia_dato_viaje_manual.operador_nombre is '0796: nombre escrito a mano cuando no hay operador del catálogo.';
comment on column public.vigia_dato_viaje_manual.licencia is '0796: número de licencia del operador (dato personal).';
comment on column public.vigia_dato_viaje_manual.licencia_vence is '0796: vigencia de la licencia.';
comment on column public.vigia_dato_viaje_manual.telefono is '0796: teléfono del operador en el formato 52 + 10 dígitos (misma regla que 0673).';
comment on column public.vigia_dato_viaje_manual.placas_unidad is '0796: placas de la unidad (tractor), mayúsculas y sin espacios.';
comment on column public.vigia_dato_viaje_manual.placas_caja is '0796: placas de la caja, mayúsculas y sin espacios.';
comment on column public.vigia_dato_viaje_manual.estado_caja is '0796: estado de la caja (mismo catálogo que vigia_caja.estado).';
comment on column public.vigia_dato_viaje_manual.editado_por is '0796: usuario que capturó o corrigió el dato por última vez.';
comment on column public.vigia_dato_viaje_manual.en is '0796: cuándo se capturó o corrigió por última vez.';

create table if not exists public.vigia_politica_datos (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenant(id) on delete cascade,
  cliente_id uuid,
  campo      text not null,
  visible    boolean not null,
  updated_by uuid,
  created_at timestamptz not null default now(),
  constraint vigia_politica_datos_id_tenant_key unique (id, tenant_id),
  constraint vigia_politica_datos_cliente_fkey
    foreign key (cliente_id, tenant_id) references public.cliente (id, tenant_id) on delete cascade,
  constraint vigia_politica_datos_campo check (
    campo in ('caja', 'placas_caja', 'estado_caja', 'unidad', 'placas_unidad', 'operador', 'licencia', 'vigencia', 'telefono'))
);
create unique index if not exists vigia_politica_datos_general_uq
  on public.vigia_politica_datos (tenant_id, campo) where cliente_id is null;
create unique index if not exists vigia_politica_datos_cliente_uq
  on public.vigia_politica_datos (tenant_id, cliente_id, campo) where cliente_id is not null;
comment on table public.vigia_politica_datos is
  '0796: qué campos del viaje se le pueden dar a un cliente. cliente_id null = regla general de la flota; una regla por cliente manda sobre la general.';
comment on column public.vigia_politica_datos.cliente_id is '0796: cliente al que aplica la regla; null = general.';
comment on column public.vigia_politica_datos.campo is '0796: campo del viaje (caja, placas_caja, estado_caja, unidad, placas_unidad, operador, licencia, vigencia, telefono).';
comment on column public.vigia_politica_datos.visible is '0796: true = se puede dar al cliente; false = no.';

-- Qué regla aplica a (flota, cliente, campo): la del cliente si existe, si no la general, si no el valor por defecto
-- que pasa quien llama (los datos personales del operador deben pasar false: sin regla, ocultos).
create or replace function public.vigia_dato_visible(
  p_tenant uuid, p_cliente uuid, p_campo text, p_por_defecto boolean default false)
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select coalesce(
    (select p.visible
       from public.vigia_politica_datos p
      where p.tenant_id = p_tenant
        and p.campo = p_campo
        and (p.cliente_id is null or p.cliente_id = p_cliente)
      order by (p.cliente_id is null)
      limit 1),
    p_por_defecto);
$$;
comment on function public.vigia_dato_visible(uuid, uuid, text, boolean) is
  '0796: resuelve si un campo del viaje se le da a un cliente: regla del cliente, si no la general, si no p_por_defecto.';
revoke all on function public.vigia_dato_visible(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.vigia_dato_visible(uuid, uuid, text, boolean) to service_role;

alter table public.vigia_caja             enable row level security;
alter table public.vigia_dato_viaje_manual enable row level security;
alter table public.vigia_politica_datos   enable row level security;
drop policy if exists tenant_lee on public.vigia_caja;
create policy tenant_lee on public.vigia_caja for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_atencion_cliente()) or is_superadmin());
drop policy if exists tenant_lee on public.vigia_dato_viaje_manual;
create policy tenant_lee on public.vigia_dato_viaje_manual for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_atencion_cliente()) or is_superadmin());
drop policy if exists tenant_lee on public.vigia_politica_datos;
create policy tenant_lee on public.vigia_politica_datos for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_atencion_cliente()) or is_superadmin());

revoke all on table public.vigia_caja, public.vigia_dato_viaje_manual, public.vigia_politica_datos
  from public, anon, authenticated;
grant select on table public.vigia_caja, public.vigia_dato_viaje_manual, public.vigia_politica_datos to authenticated;
grant select, insert, update, delete on table public.vigia_caja, public.vigia_dato_viaje_manual, public.vigia_politica_datos to service_role;
