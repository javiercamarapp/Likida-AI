-- REVERSA: drop table if exists public.vigia_sin_atender_config;  -- nada depende de ella; el código tolera su ausencia (42P01 / PGRST205 = valores de arranque)
-- ═══════════════════════════════════════════════════════════════════════════
-- 0999 — Vigía «sin atender»: configuración por flota (ronda 6, carril config).
--
-- Hoy valen solo los plazos de `vigia_config`, los directores con turno, los festivos y el servicio al cliente. No había dónde guardar lo
-- propio de «sin atender»: horario de atención, palabras clave, lista del equipo, umbral de insistencia ni el interruptor del resumen por
-- correo de CADA flota. Esta tabla es ese lugar: UNA fila por flota.
--
--   · SIN FILA = TODO APAGADO (falla cerrado): sin horario de atención (la espera cuenta minutos corridos), palabras clave de arranque,
--     sin lista de equipo, y `resumen_correo_habilitado` en false. El código aplica esos mismos valores si la tabla no existe.
--   · `equipo_nombres`: nombres del personal TAL COMO SALEN en el chat. El código los convierte a un código irreversible (con la sal de la
--     flota) al revisar; los chats y sus mensajes NO se guardan aquí ni en ningún lado nuevo.
--   · `resumen_correo_habilitado` es EXTRA a la bandera de plataforma LIKIDA_VIGIA_SIN_ATENDER_CORREO y a los interruptores global y del
--     agente: el resumen sale solo si TODAS las capas están encendidas.
--
-- RLS y permisos: SOLO service_role (default cerrado desde la 0947; la guardia de migraciones prohíbe abrir tablas nuevas a anon/authenticated).
-- La app lee y escribe por el servidor, con el tenant de la sesión. La política `tenant_lee` (la misma de 0798: la flota lee lo suyo,
-- quien atiende clientes) queda como segunda barrera: si algún día se concede lectura a `authenticated`, solo verá su flota. Son datos de
-- PERSONAL de la flota y se borran con ella (cascade). No toca ninguna fila existente ni redefine ninguna función.
-- ADITIVA E IDEMPOTENTE. No crea funciones (nada que fijar en search_path).
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.vigia_sin_atender_config (
  tenant_id                  uuid primary key references public.tenant(id) on delete cascade,
  horario_atencion           jsonb,
  palabras_clave             text[] not null default '{}',
  palabras_urgentes          text[] not null default '{}',
  equipo_nombres             text[] not null default '{}',
  insistencia_min            integer not null default 2,
  umbral_urgente_min         integer not null default 10,
  resumen_correo_habilitado  boolean not null default false,
  updated_at                 timestamptz not null default now(),
  updated_by                 uuid,
  constraint vigia_sin_atender_config_insistencia check (insistencia_min between 0 and 50),
  constraint vigia_sin_atender_config_umbral_urgente check (umbral_urgente_min between 1 and 1440),
  constraint vigia_sin_atender_config_listas check (
    cardinality(palabras_clave) <= 30 and cardinality(palabras_urgentes) <= 30 and cardinality(equipo_nombres) <= 100),
  constraint vigia_sin_atender_config_tamano check (
    char_length(array_to_string(palabras_clave, ',')) <= 1500
    and char_length(array_to_string(palabras_urgentes, ',')) <= 1500
    and char_length(array_to_string(equipo_nombres, ',')) <= 10000),
  constraint vigia_sin_atender_config_horario check (
    horario_atencion is null or (
      jsonb_typeof(horario_atencion) = 'object'
      and octet_length(horario_atencion::text) <= 256
      and (horario_atencion ->> 'desdeHora') ~ '^([0-9]|1[0-9]|2[0-3])$'
      and (horario_atencion ->> 'hastaHora') ~ '^([1-9]|1[0-9]|2[0-4])$'
      and case when (horario_atencion ->> 'desdeHora') ~ '^[0-9]+$' and (horario_atencion ->> 'hastaHora') ~ '^[0-9]+$'
               then (horario_atencion ->> 'hastaHora')::integer > (horario_atencion ->> 'desdeHora')::integer else false end
    ))
);

comment on table public.vigia_sin_atender_config is
  '0999: configuración de «sin atender» por flota (una fila). SIN FILA = todo apagado (falla cerrado). Horario de atención, palabras clave y urgentes, nombres del equipo, umbral de insistencia e interruptor propio del resumen por correo. Sin texto de chats.';
comment on column public.vigia_sin_atender_config.horario_atencion is '0999: null = sin horario (minutos corridos). Objeto {desdeHora 0-23, hastaHora 1-24 mayor que desdeHora, diasHabiles opcional 0-6}.';
comment on column public.vigia_sin_atender_config.equipo_nombres is '0999: nombres del equipo tal como salen en el chat (máx. 100). El código los vuelve un código irreversible al revisar.';
comment on column public.vigia_sin_atender_config.insistencia_min is '0999: mensajes seguidos del cliente sin respuesta que cuentan como insistencia; 0 = apagado.';
comment on column public.vigia_sin_atender_config.resumen_correo_habilitado is '0999: false (default) = esta flota no recibe el resumen por correo aunque la bandera de plataforma esté encendida.';

alter table public.vigia_sin_atender_config enable row level security;
drop policy if exists tenant_lee on public.vigia_sin_atender_config;
create policy tenant_lee on public.vigia_sin_atender_config for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_atencion_cliente()) or is_superadmin());
revoke all on table public.vigia_sin_atender_config from public, anon, authenticated;
grant select, insert, update, delete on table public.vigia_sin_atender_config to service_role;

commit;
