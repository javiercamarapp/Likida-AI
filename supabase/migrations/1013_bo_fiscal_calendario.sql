-- 1013 — Back-office de Likida: calendario fiscal (catálogo de obligaciones y su cumplimiento).
--
-- Dos tablas de PLATAFORMA (sin tenant_id: son de Likida, no de una flota):
--   · bo_obligacion_fiscal      catálogo de obligaciones con fecha nominal. TODAS nacen 'pendiente_de_contador': el catálogo es
--                               información general; un contador lo revisa antes de la primera declaración. El sistema NUNCA presenta
--                               nada ante el SAT: solo recuerda y prepara el paquete.
--   · bo_obligacion_cumplimiento  una fila por (obligación, periodo). 'presentada' solo la marca una persona y exige quién, cuándo y
--                               la referencia del acuse; el sistema jamás declara por su cuenta.
--
-- Candado de entidad: mientras bo_entidad.rfc sea null (Likida aún no tiene razón social ni RFC propios) las obligaciones con
-- requiere_entidad se muestran «Aún no aplica» y sin fechas. Eso lo decide el código leyendo bo_entidad; esta migración no depende de ella.
--
-- Las fechas son NOMINALES: no se ajustan por día inhábil. Los días límite sembrados son una propuesta general, no asesoría fiscal.
--
-- ADITIVA E IDEMPOTENTE. Las migraciones NO se aplican a producción desde aquí: solo se escriben.
-- REVERSA (manual):
--   drop trigger if exists bo_obligacion_cumplimiento_final on public.bo_obligacion_cumplimiento;
--   drop function if exists public.bo_obligacion_cumplimiento_final();
--   drop table if exists public.bo_obligacion_cumplimiento;
--   drop table if exists public.bo_obligacion_fiscal;
begin;

create table if not exists public.bo_obligacion_fiscal (
  id               uuid primary key default gen_random_uuid(),
  clave            text not null unique check (clave ~ '^[a-z0-9_]{3,60}$'),
  nombre           text not null check (char_length(btrim(nombre)) between 3 and 160),
  periodicidad     text not null check (periodicidad in ('mensual', 'anual', 'evento')),
  -- Día del mes de la fecha límite nominal (1-31; si el mes es más corto, el último día). Null en las de 'evento'.
  dia_limite       integer check (dia_limite between 1 and 31),
  -- Solo anuales: mes (1-12) de la fecha límite.
  mes_limite       integer check (mes_limite between 1 and 12),
  -- Cuántos meses después del periodo cae la fecha límite (mensuales: 1 = el mes siguiente).
  meses_desfase    integer not null default 1 check (meses_desfase between 0 and 3),
  requiere_entidad boolean not null default true,
  estado_catalogo  text not null default 'pendiente_de_contador' check (estado_catalogo in ('pendiente_de_contador', 'revisada_por_contador')),
  nota             text,
  creado_en        timestamptz not null default now(),
  check ((periodicidad = 'evento') = (dia_limite is null)),
  check ((periodicidad = 'anual') = (mes_limite is not null))
);

comment on table public.bo_obligacion_fiscal is
  '1013: catálogo de obligaciones fiscales con fecha límite NOMINAL (sin ajuste por día inhábil). Todas nacen pendiente_de_contador. Información general; un contador la revisa antes de la primera declaración. Solo service_role.';

create table if not exists public.bo_obligacion_cumplimiento (
  id                    uuid primary key default gen_random_uuid(),
  clave                 text not null references public.bo_obligacion_fiscal (clave) on delete restrict,
  -- Mes que cubre la obligación (primer día del mes). Las anuales usan el 1 de enero del ejercicio.
  periodo               date not null check (periodo = date_trunc('month', periodo)::date),
  estado                text not null default 'pendiente' check (estado in ('pendiente', 'paquete_listo', 'presentada', 'no_aplica')),
  paquete_generado_en   timestamptz,
  presentada_por        text,
  presentada_en         date,
  acuse_ref             text,
  nota                  text,
  creado_en             timestamptz not null default now(),
  actualizado_en        timestamptz not null default now(),
  unique (clave, periodo),
  -- «Presentada» la marca un humano con acuse: sin quién, cuándo y referencia no existe.
  check (estado <> 'presentada' or (
    nullif(btrim(coalesce(presentada_por, '')), '') is not null
    and presentada_en is not null
    and nullif(btrim(coalesce(acuse_ref, '')), '') is not null)),
  check (estado <> 'paquete_listo' or paquete_generado_en is not null)
);

comment on table public.bo_obligacion_cumplimiento is
  '1013: una fila por (obligación, periodo). presentada solo la marca una persona con acuse (quién, cuándo, referencia); el sistema nunca declara. Solo service_role.';

create index if not exists bo_obligacion_cumplimiento_periodo_idx on public.bo_obligacion_cumplimiento (periodo desc, clave);

-- Una obligación presentada es definitiva: no se desmarca ni se cambia su acuse (una corrección es una nota, no reescribir la historia).
create or replace function public.bo_obligacion_cumplimiento_final()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.estado = 'presentada' and (
       new.estado <> 'presentada'
    or new.presentada_por is distinct from old.presentada_por
    or new.presentada_en is distinct from old.presentada_en
    or new.acuse_ref is distinct from old.acuse_ref
    or new.clave <> old.clave
    or new.periodo <> old.periodo) then
    raise exception 'una obligacion presentada no se modifica (clave %, periodo %)', old.clave, old.periodo using errcode = '42501';
  end if;
  new.actualizado_en := now();
  return new;
end;
$$;

drop trigger if exists bo_obligacion_cumplimiento_final on public.bo_obligacion_cumplimiento;
create trigger bo_obligacion_cumplimiento_final
  before update on public.bo_obligacion_cumplimiento
  for each row execute function public.bo_obligacion_cumplimiento_final();

-- Semilla: todas 'pendiente_de_contador'. Fechas generales (día 17 del mes siguiente para las mensuales de impuestos); NO son asesoría.
insert into public.bo_obligacion_fiscal (clave, nombre, periodicidad, dia_limite, mes_limite, meses_desfase, requiere_entidad, nota) values
  ('isr_provisional',          'ISR: pago provisional mensual',               'mensual', 17, null, 1, true,  'Fecha general; un contador la confirma según el régimen.'),
  ('iva_mensual',              'IVA: declaración mensual',                    'mensual', 17, null, 1, true,  'Fecha general; un contador la confirma según el régimen.'),
  ('diot',                     'DIOT: operaciones con terceros',              'mensual', 17, null, 1, true,  'Solo con gastos que traigan RFC del proveedor.'),
  ('contabilidad_electronica', 'Contabilidad electrónica: balanza mensual',   'mensual', 3,  null, 2, true,  'Layout oficial y catálogo: pendiente de contador.'),
  ('declaracion_anual',        'Declaración anual del ejercicio',             'anual',   31, 3,    0, true,  'Fecha general de personas morales; un contador la confirma.'),
  ('nomina_imss',              'Nómina e IMSS: obligaciones patronales',      'mensual', 17, null, 1, true,  'Hoy no hay nómina propia: la nómina se compra, no se construye.'),
  ('conservacion_5_anios',     'Conservación de la contabilidad (5 años)',    'evento',  null, null, 0, false, 'Piso conservador de retención; no tiene fecha límite.')
on conflict (clave) do nothing;

alter table public.bo_obligacion_fiscal enable row level security;
alter table public.bo_obligacion_cumplimiento enable row level security;
revoke all on table public.bo_obligacion_fiscal from public, anon, authenticated;
revoke all on table public.bo_obligacion_cumplimiento from public, anon, authenticated;
grant select, insert, update on table public.bo_obligacion_fiscal to service_role;
grant select, insert, update on table public.bo_obligacion_cumplimiento to service_role;
-- Nada de hechos se borra: sin delete ni truncate ni siquiera para service_role.
revoke delete, truncate on table public.bo_obligacion_fiscal from service_role;
revoke delete, truncate on table public.bo_obligacion_cumplimiento from service_role;

commit;
