-- ═══════════════════════════════════════════════════════════════════════════
-- 0787 — LIQUIDACIÓN POR CORREO: cola de entrega por destinatario y RPC de
--        reclamo atómico (Agente 1, rango A1 del programa de cinco agentes).
--
-- El desglose se entrega por correo: un correo POR DESTINATARIO (operador,
-- coordinador, RH, archivo), nunca uno solo con copias, para que el rebote o la
-- queja de uno no oculte lo del resto y cada envío tenga su propio estado.
-- Esta migración pone la tabla que sostiene esa cola y la función que la
-- reclama sin que dos trabajadores tomen la misma fila. Ninguna lógica de
-- envío vive aquí.
--
-- ── QUÉ AÑADE ───────────────────────────────────────────────────────────────
--
--   1. `liquidacion_entrega_correo`: una fila por (liquidación, generación,
--      rol, correo). La unicidad es la idempotencia: reintentar encolar la
--      misma entrega no duplica el correo. `generacion` arranca igual a
--      `liquidacion_externa.generacion` y sube con cada reenvío manual.
--   2. `reclamar_entregas_correo(limite, ahora, lease_seg)`: toma hasta
--      `limite` filas listas (pendientes con `proximo_intento_en` vencido, o
--      `enviando` cuyo lease venció), las marca `enviando` con un
--      `claim_token` nuevo y un `claim_expira_en`, y las devuelve. Usa
--      `for update skip locked`: dos reclamos simultáneos nunca devuelven la
--      misma fila. Función NUEVA (no redefine ninguna).
--   3. RLS: lectura de dinero (`ve_finanzas()`, como 0370/0786); escribe solo
--      service_role. La función solo la ejecuta service_role.
--
-- ── POR QUÉ NO ROMPE A NADIE ────────────────────────────────────────────────
--
-- Tabla y función nuevas: nada previo depende de ellas. Nadie encola filas
-- hasta que un servicio posterior lo haga; con `liquidacion_correo_config`
-- en su valor por defecto (canal whatsapp, inactiva) la tabla queda vacía.
--
-- ── IDEMPOTENCIA ────────────────────────────────────────────────────────────
--
-- `if not exists` en tabla e índices, `create or replace` en la función y
-- `drop policy if exists` antes de la política. Aplicarla dos veces no cambia
-- nada la segunda vez.
--
-- ── CÓMO SE REVIERTE (documentado, no automático) ───────────────────────────
--
--   drop function if exists public.reclamar_entregas_correo(integer, timestamptz, integer);
--   drop table if exists public.liquidacion_entrega_correo;
--
-- (Tabla y función son nuevas: nada previo depende de ellas.)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. liquidacion_entrega_correo ───────────────────────────────────────────
create table if not exists public.liquidacion_entrega_correo (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenant(id) on delete cascade,
  liquidacion_externa_id uuid not null,
  generacion             integer not null default 1,
  rol                    text not null,
  correo                 text not null,
  estado                 text not null default 'pendiente',
  intentos               integer not null default 0,
  proximo_intento_en     timestamptz not null default now(),
  claim_token            uuid,
  claim_expira_en        timestamptz,
  resend_id              text,
  ultimo_error           text,
  disparo                text not null default 'auto',
  pedido_por             text,
  xlsx_ruta              text,
  xlsx_sha256            text,
  enviada_en             timestamptz,
  entregada_en           timestamptz,
  rebotada_en            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  -- Regla de la 0028/0145: toda FK entre dos tablas con tenant_id lleva su
  -- compuesta, o un autenticado de la flota A cuelga su fila de la
  -- liquidación de la flota B. Al purgar la liquidación se van sus entregas.
  constraint liquidacion_entrega_correo_liquidacion_tenant_fkey
    foreign key (liquidacion_externa_id, tenant_id)
    references public.liquidacion_externa (id, tenant_id) on delete cascade,
  constraint liquidacion_entrega_correo_generacion_pos check (generacion >= 1),
  constraint liquidacion_entrega_correo_rol_dominio check (
    rol in ('operador', 'coordinador', 'rh', 'archivo')
  ),
  constraint liquidacion_entrega_correo_estado_dominio check (
    estado in ('pendiente', 'enviando', 'enviada', 'entregada', 'rebotada', 'queja', 'fallida', 'omitida')
  ),
  constraint liquidacion_entrega_correo_disparo_dominio check (
    disparo in ('auto', 'manual', 'reclamo')
  ),
  constraint liquidacion_entrega_correo_intentos_no_neg check (intentos >= 0),
  constraint liquidacion_entrega_correo_correo_forma check (
    correo ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' and char_length(correo) <= 254
  ),
  -- El token y su vencimiento van juntos: no hay lease a medias.
  constraint liquidacion_entrega_correo_lease_coherente check (
    (claim_token is null) = (claim_expira_en is null)
  ),
  constraint liquidacion_entrega_correo_resend_id_largo check (
    resend_id is null or char_length(resend_id) between 1 and 200
  ),
  constraint liquidacion_entrega_correo_error_largo check (
    ultimo_error is null or char_length(ultimo_error) <= 1000
  ),
  constraint liquidacion_entrega_correo_pedido_por_largo check (
    pedido_por is null or char_length(pedido_por) <= 200
  ),
  constraint liquidacion_entrega_correo_xlsx_ruta_largo check (
    xlsx_ruta is null or char_length(xlsx_ruta) <= 500
  ),
  constraint liquidacion_entrega_correo_xlsx_sha256_forma check (
    xlsx_sha256 is null or xlsx_sha256 ~ '^[0-9a-f]{64}$'
  )
);

comment on table public.liquidacion_entrega_correo is
  '0787: cola de entrega del desglose por correo, una fila por destinatario (liquidación, generación, rol, correo). La unicidad es la idempotencia. Se reclama con reclamar_entregas_correo. Escribe solo service_role.';
comment on column public.liquidacion_entrega_correo.generacion is
  'Misma que liquidacion_externa.generacion en el primer envío; sube con cada reenvío manual.';
comment on column public.liquidacion_entrega_correo.claim_token is
  '0787: lease del trabajador que tiene la fila en `enviando`. Quien confirma el envío debe presentar este token.';
comment on column public.liquidacion_entrega_correo.claim_expira_en is
  '0787: cuándo vence el lease. Pasada esa hora, otro trabajador puede reclamar la fila (el primero murió a medio envío).';
comment on column public.liquidacion_entrega_correo.resend_id is
  '0787: id del mensaje en el proveedor, para casar el webhook de entregado/rebotado/queja. Único cuando existe.';

-- Idempotencia por destinatario y generación, sin importar mayúsculas del
-- correo. Índice y no constraint: la unicidad es sobre una expresión.
create unique index if not exists liquidacion_entrega_correo_destinatario_unico
  on public.liquidacion_entrega_correo (liquidacion_externa_id, generacion, rol, lower(correo));

-- El webhook busca por resend_id; dos filas no pueden compartirlo.
create unique index if not exists liquidacion_entrega_correo_resend_id_unico
  on public.liquidacion_entrega_correo (resend_id) where resend_id is not null;

-- Lo que el reclamo recorre: solo lo vivo. Parcial para que lo ya entregado,
-- rebotado u omitido no engorde el índice.
create index if not exists liquidacion_entrega_correo_cola_idx
  on public.liquidacion_entrega_correo (proximo_intento_en)
  where estado in ('pendiente', 'enviando');

create index if not exists liquidacion_entrega_correo_tenant_idx
  on public.liquidacion_entrega_correo (tenant_id, created_at desc);

-- ── 2. RLS ──────────────────────────────────────────────────────────────────
-- Tabla nueva sin RLS = agujero para quien le pregunta a PostgREST con la anon
-- key. Lectura: dinero (el encargado no entra). Escritura: ninguna política,
-- solo service_role.
alter table public.liquidacion_entrega_correo enable row level security;

drop policy if exists tenant_lee on public.liquidacion_entrega_correo;
create policy tenant_lee on public.liquidacion_entrega_correo for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_finanzas()) or is_superadmin());

-- ── 3. reclamar_entregas_correo ─────────────────────────────────────────────
-- Reclamo atómico. Una sola sentencia: el SELECT ... FOR UPDATE SKIP LOCKED
-- fija las filas y el UPDATE las marca, de modo que dos llamadas concurrentes
-- reparten filas distintas y nunca la misma. Las más antiguas primero.
--
-- Toma dos clases de fila:
--   · pendiente con proximo_intento_en <= p_ahora (toca enviarla);
--   · enviando con claim_expira_en <= p_ahora (el trabajador murió: se
--     re-reclama con un token nuevo, el viejo ya no sirve).
-- `intentos` NO se toca aquí: lo cuenta quien confirma el resultado del envío.
create or replace function public.reclamar_entregas_correo(
  p_limite   integer default 20,
  p_ahora    timestamptz default now(),
  p_lease_seg integer default 120
)
returns setof public.liquidacion_entrega_correo
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limite is null or p_limite < 1 or p_limite > 500 then
    raise exception 'p_limite fuera de 1..500';
  end if;
  if p_ahora is null then
    raise exception 'p_ahora no puede ser nulo';
  end if;
  if p_lease_seg is null or p_lease_seg < 1 or p_lease_seg > 3600 then
    raise exception 'p_lease_seg fuera de 1..3600';
  end if;

  return query
  with elegidas as (
    select e.id
    from public.liquidacion_entrega_correo e
    where (e.estado = 'pendiente' and e.proximo_intento_en <= p_ahora)
       or (e.estado = 'enviando' and e.claim_expira_en <= p_ahora)
    order by e.proximo_intento_en, e.id
    limit p_limite
    for update of e skip locked
  )
  update public.liquidacion_entrega_correo t
     set estado          = 'enviando',
         claim_token     = gen_random_uuid(),
         claim_expira_en = p_ahora + make_interval(secs => p_lease_seg),
         updated_at      = p_ahora
    from elegidas
   where t.id = elegidas.id
  returning t.*;
end;
$$;

comment on function public.reclamar_entregas_correo(integer, timestamptz, integer) is
  '0787: reclama hasta p_limite entregas de correo listas (pendientes vencidas o enviando con lease vencido), las pone en enviando con claim_token y claim_expira_en, y las devuelve. for update skip locked: dos llamadas concurrentes nunca devuelven la misma fila. Solo service_role.';

revoke all on function public.reclamar_entregas_correo(integer, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.reclamar_entregas_correo(integer, timestamptz, integer)
  to service_role;
