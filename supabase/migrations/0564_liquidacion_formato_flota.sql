-- 0564 — Liquidación externa: el FORMATO de la flota y a quién se le copia.
--
-- La flota recibe hoy «el formatito»: un Excel que su oficina arma a mano. Esta
-- tabla guarda, UNA fila por flota, la plantilla (columnas, encabezados, datos de
-- arriba, fila de total, qué documento viaja por WhatsApp) derivada de su Excel
-- de muestra, más dos listas de teléfonos que decide la persona que administra:
--
--   · `copia_telefonos`        — quién recibe COPIA de cada liquidación entregada
--                                (el jefe de flota);
--   · `discrepancia_telefonos` — quién es AVISADO cuando un chofer responde
--                                «No coincide» (si queda vacía, el código cae a
--                                la copia y, sin copia, a quien ve dinero).
--
-- Sin fila = el comportamiento de siempre (PDF genérico, sin copia). El código
-- funciona contra una base sin esta migración (trata la tabla ausente como «sin
-- formato»), así que aplicarla no es un requisito para desplegar.
--
-- Los teléfonos van en E.164 sin «+» (el mismo formato que `app_user.telefono`),
-- hasta 3 por lista: una copia a medio equipo ya no es una copia, es un reparto
-- de dinero fuera de la matriz de visibilidad. Escribe solo service_role.

create table if not exists public.liquidacion_formato_flota (
  tenant_id              uuid primary key references public.tenant(id) on delete cascade,
  formato                jsonb not null,
  nombre_muestra         text,
  copia_telefonos        text[] not null default '{}',
  discrepancia_telefonos text[] not null default '{}',
  actualizado_en         timestamptz not null default now(),
  actualizado_por        text,
  constraint liquidacion_formato_flota_formato_objeto check (jsonb_typeof(formato) = 'object'),
  constraint liquidacion_formato_flota_muestra_largo check (nombre_muestra is null or char_length(nombre_muestra) <= 200),
  constraint liquidacion_formato_flota_copia_tope check (cardinality(copia_telefonos) <= 3),
  constraint liquidacion_formato_flota_copia_forma check (array_to_string(copia_telefonos, ',') ~ '^([0-9]{10,15}(,[0-9]{10,15}){0,2})?$'),
  constraint liquidacion_formato_flota_discrepancia_tope check (cardinality(discrepancia_telefonos) <= 3),
  constraint liquidacion_formato_flota_discrepancia_forma check (array_to_string(discrepancia_telefonos, ',') ~ '^([0-9]{10,15}(,[0-9]{10,15}){0,2})?$')
);

comment on table public.liquidacion_formato_flota is
  '0564: plantilla del formato de liquidación de la flota (derivada de su Excel de muestra) y los teléfonos de la copia al jefe y del aviso de discrepancia. Una fila por flota; sin fila = formato genérico y sin copia.';

alter table public.liquidacion_formato_flota enable row level security;

drop policy if exists tenant_lee on public.liquidacion_formato_flota;
create policy tenant_lee on public.liquidacion_formato_flota for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_finanzas()) or is_superadmin());
