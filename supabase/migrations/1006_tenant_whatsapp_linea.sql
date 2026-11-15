-- REVERSA: drop function if exists public.tenant_whatsapp_linea_hacer_principal(uuid); alter table if exists public.wa_outbox drop column if exists tenant_id, drop column if exists phone_number_id; drop table if exists public.tenant_whatsapp_linea;  -- pierde las líneas propias de WhatsApp registradas (sus tokens cifrados); el código vuelve al número global del entorno
-- ═══════════════════════════════════════════════════════════════════════════
-- 1006 — Línea de WhatsApp propia por tenant (w34, 13-nov-2026).
--
-- Hoy TODO el WhatsApp sale y entra por UN número (WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN del entorno). Esta migración deja dónde
-- guardar, por tenant, un número propio de la misma app de Meta: `tenant_whatsapp_linea`. La app de Meta sigue siendo la de Likida, así que la
-- firma del webhook (WHATSAPP_APP_SECRET) NO cambia; lo que cambia por tenant es el número (`phone_number_id`) y el token con que se envía.
--
-- ── EL TOKEN VA CIFRADO POR LA APLICACIÓN ───────────────────────────────────
-- Mismo patrón que `conector_credencial` (0094): AES-256-GCM con LIKIDA_COFRE_LLAVE, formato `v2.` con AAD `${tenant_id}:${phone_number_id}`
-- (copiar el cifrado de la línea de un tenant a la de otro ya no abre). El CHECK `like 'v2.%'` impide guardar un token en claro por accidente.
-- `token_pistas` guarda solo los últimos 4 para que una persona reconozca cuál token es.
--
-- ── QUIÉN LEE: solo el servidor (service_role) ─────────────────────────────
-- La capa 0 de grants (capa0_grants_tablas.sql) exige que anon/authenticated no tengan NINGÚN privilegio, ni de columna, sobre tablas de
-- `public` salvo su lista blanca. Esta tabla NO entra en ella: se revoca todo a anon/authenticated y la lee/escribe solo el servidor. La
-- política `administra_flota` queda declarada (defensa en profundidad y para el día en que una pantalla necesite leer columnas no secretas
-- por una vista o una función propia); sin grant no concede nada. `token_cifrado` jamás sale de ahí.
--
-- ── VARIAS LÍNEAS POR CLIENTE ───────────────────────────────────────────────
-- Un tenant puede tener varias líneas (por terminal o por propósito). `phone_number_id` sigue siendo único en TODA la tabla (un número
-- jamás cae a dos tenants: es lo que aísla el webhook entrante). Cada línea lleva `etiqueta`, `terminal_id` (opcional, FK a terminal con
-- on delete set null) y `proposito` (servicio_cliente | operadores | oficina | general). `principal` marca la línea por omisión del tenant:
-- el índice único parcial (tenant_id) where principal and estado = 'activa' garantiza UNA sola principal activa. El cambio de principal
-- es atómico con `tenant_whatsapp_linea_hacer_principal(linea_id)` (solo service_role). La selección (por línea, terminal, propósito o
-- principal) la hace `src/lib/meta/canal.ts`; con varias activas, sin principal y sin criterio FALLA CERRADO (motivo 'ambigua').
--
-- ── ESTADOS ─────────────────────────────────────────────────────────────────
--   pendiente      alta hecha, sin verificar: el tenant sigue enviando por el número global.
--   activa         verificada: el tenant envía y recibe por su número.
--   pausada        la apagó una persona: el tenant NO cae al número global (falla cerrado).
--   token_vencido  Meta contestó 190: igual, falla cerrado hasta renovar el token.
--
-- ── wa_outbox ───────────────────────────────────────────────────────────────
-- Dos columnas NULAS (tenant_id, phone_number_id) para que una salida encolada recuerde por qué línea debe salir. Con ambas nulas el
-- drenador sigue usando el número global, exactamente como hoy. Sin FK a propósito: el outbox es un registro de entrega y no debe bloquear
-- el borrado de un tenant ni arrastrar cascadas.
--
-- SIGUIENTE PASO (NO en esta migración): `wa_conversacion` no se toca aquí. Hoy se identifica por el teléfono del interlocutor; cuando haya
-- dos líneas la conversación tendrá que distinguirse también por línea (columna phone_number_id y su índice), en su propia migración.
--
-- ADITIVA E IDEMPOTENTE (create table/index if not exists; drop policy if exists + create; add column if not exists). No toca filas
-- existentes. NO aplicada en ninguna base remota.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.tenant_whatsapp_linea (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant(id) on delete cascade,
  phone_number_id  text not null,
  waba_id          text,
  numero_visible   text,
  etiqueta         text,
  terminal_id      uuid,
  proposito        text,
  principal        boolean not null default false,
  -- Cifrado POR LA APLICACIÓN (cofre v2). Nunca en claro.
  token_cifrado    text not null,
  -- Lo único del token que puede verse: sus últimos 4.
  token_pistas     text,
  estado           text not null default 'pendiente',
  -- Una frase NUESTRA, nunca la respuesta cruda de Meta (puede traer el token).
  ultimo_error     text,
  verificada_en    timestamptz,
  creada_en        timestamptz not null default now(),
  constraint tenant_whatsapp_linea_phone_unico unique (phone_number_id),
  constraint tenant_whatsapp_linea_phone_no_vacio check (length(trim(phone_number_id)) > 0),
  constraint tenant_whatsapp_linea_token_v2 check (token_cifrado like 'v2.%'),
  constraint tenant_whatsapp_linea_estado check (estado in ('pendiente', 'activa', 'pausada', 'token_vencido')),
  constraint tenant_whatsapp_linea_proposito check (proposito is null or proposito in ('servicio_cliente', 'operadores', 'oficina', 'general'))
);

-- La terminal es del MISMO tenant (FK compuesta con `terminal_id_tenant_key`, como 0298/0380): una línea no puede apuntar a la terminal de
-- otro cliente. `on delete set null (terminal_id)` solo anula la terminal, no el tenant.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_whatsapp_linea_terminal_fk') then
    alter table public.tenant_whatsapp_linea
      add constraint tenant_whatsapp_linea_terminal_fk
      foreign key (terminal_id, tenant_id) references public.terminal (id, tenant_id) on delete set null (terminal_id);
  end if;
end $$;

-- Una sola principal ACTIVA por tenant (varias líneas por tenant: ya no hay índice de «una viva»).
create unique index if not exists tenant_whatsapp_linea_una_principal
  on public.tenant_whatsapp_linea (tenant_id)
  where principal and estado = 'activa';

create index if not exists tenant_whatsapp_linea_tenant_idx on public.tenant_whatsapp_linea (tenant_id, creada_en desc, id);

alter table public.tenant_whatsapp_linea enable row level security;

drop policy if exists administra_flota on public.tenant_whatsapp_linea;
create policy administra_flota on public.tenant_whatsapp_linea for select
  using ((tenant_id = any(get_user_tenant_ids()) and administra_flota()) or is_superadmin());

-- Solo el servidor: ni anon ni authenticated tienen privilegio alguno (ni de columna) sobre esta tabla.
revoke all on table public.tenant_whatsapp_linea from public, anon, authenticated;
grant all on table public.tenant_whatsapp_linea to service_role;

-- Cambio de principal ATÓMICO: en una sola transacción baja la principal vigente del tenant y sube la indicada (la indicada debe estar
-- activa). Devuelve false si la línea no existe o no está activa. Solo service_role.
create or replace function public.tenant_whatsapp_linea_hacer_principal(p_linea_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant
    from public.tenant_whatsapp_linea
   where id = p_linea_id and estado = 'activa'
   for update;
  if v_tenant is null then return false; end if;
  update public.tenant_whatsapp_linea set principal = false
   where tenant_id = v_tenant and principal and id <> p_linea_id;
  update public.tenant_whatsapp_linea set principal = true where id = p_linea_id;
  return true;
end
$fn$;
revoke all on function public.tenant_whatsapp_linea_hacer_principal(uuid) from public, anon, authenticated;
grant execute on function public.tenant_whatsapp_linea_hacer_principal(uuid) to service_role;

comment on table public.tenant_whatsapp_linea is
  '1006: líneas de WhatsApp propias de un tenant (misma app de Meta; varias por tenant). El token va CIFRADO por la aplicación (v2, AAD tenant:phone_number_id). Solo el servidor (service_role) lee y escribe; anon/authenticated sin privilegios.';
comment on column public.tenant_whatsapp_linea.token_cifrado is
  '1006: token de acceso cifrado v2 (cofre). Solo service_role.';
comment on column public.tenant_whatsapp_linea.estado is
  '1006: pendiente (sigue el número global) | activa | pausada (falla cerrado) | token_vencido (falla cerrado). Varias líneas por tenant; una sola principal activa.';
comment on column public.tenant_whatsapp_linea.principal is
  '1006: línea por omisión del tenant (una sola principal activa). Se cambia con tenant_whatsapp_linea_hacer_principal.';
comment on column public.tenant_whatsapp_linea.proposito is
  '1006: servicio_cliente | operadores | oficina | general (null = sin propósito).';
comment on column public.tenant_whatsapp_linea.ultimo_error is
  '1006: frase escrita por nosotros. NUNCA la respuesta cruda de Meta.';

do $$
begin
  if to_regclass('public.wa_outbox') is null then
    raise notice '1006: public.wa_outbox no existe; se omiten sus dos columnas';
    return;
  end if;
  alter table public.wa_outbox add column if not exists tenant_id uuid;
  alter table public.wa_outbox add column if not exists phone_number_id text;
  comment on column public.wa_outbox.tenant_id is '1006: tenant dueño de la salida; null = número global (como siempre).';
  comment on column public.wa_outbox.phone_number_id is '1006: línea por la que debe salir; null = número global del entorno (como siempre).';
end $$;
