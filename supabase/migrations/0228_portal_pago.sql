-- ═══════════════════════════════════════════════════════════════════════════
-- 0228 — EL PORTAL DE PAGO POR LINK, Y EL REP EN MANOS DEL CLIENTE
--
-- Hoy la cobranza de la flota termina en `/dashboard/facturacion`: el contralor
-- ve el saldo y teclea los pagos que le avisan por WhatsApp o por correo. El
-- CLIENTE de la flota —el que debe el flete— no tiene dónde mirar lo que debe,
-- ni dónde decir "ya te pagué, aquí va la referencia", ni dónde recabar su
-- complemento de pago. Todo eso viaja hoy por mensajes sueltos.
--
-- Esta migración pone las cuatro piezas de la base. Lo que NO hace, a
-- propósito y por escrito:
--
--   · NO PROCESA PAGOS. No hay pasarela, no hay cargo, no hay tarjeta. El
--     cliente REGISTRA lo que ya pagó por su banco. Llamarle "portal de pago"
--     describe para qué sirve, no que Likida cobre.
--   · NO MARCA NADA COMO PAGADO. Lo que el cliente registra nace como
--     PROPUESTA en `portal_pago_propuesta` — una tabla APARTE de
--     `pago_recibido`. La cartera, el auditor de cobranza y la vista
--     `factura_saldo` no ven una sola de estas filas hasta que un humano
--     concilia. La conciliación propone; el contralor confirma. Si la
--     propuesta entrara a `pago_recibido`, cualquiera con el link podría
--     saldar una factura tecleando un monto, y el saldo que el contralor cruza
--     contra su banco dejaría de ser una medición.
--   · NO TIMBRA EL REP. Igual que `factura_emitida` (0049): el UUID lo da el
--     PAC de la flota y aquí solo se REGISTRA. `rep_emitido` guarda el hecho.
--
-- ── POR QUÉ `rep_emitido` Y NO `cfdi_pago` (0199) ─────────────────────────
--
-- Se parecen en la forma y son contrarias en el sentido. `cfdi_pago` es el REP
-- que la flota RECIBE de sus proveedores, y existe para liberar IVA
-- ACREDITABLE: `intake/rep.ts` la escribe y sella `gasto.pagado_en` con ella.
-- El REP de esta migración es el que la flota EMITE a su cliente, y su IVA es
-- TRASLADADO. Meter uno en la tabla del otro no es un atajo de esquema: es
-- inflar el IVA acreditable de la flota con el IVA que le trasladó a su
-- cliente. Es una declaración anual equivocada, no un renglón de más.
--
-- ── EL TOKEN NO SE GUARDA. SE GUARDA SU SHA-256 ───────────────────────────
--
-- Mismo criterio que `tenant_api_key` (0093) y misma razón: un volcado de esta
-- tabla no puede ser una llave maestra a las facturas de todas las flotas. Se
-- enseña UNA vez, al generarla; si se pierde, se revoca y se emite otra. Por
-- eso hay `token_prefijo`: los primeros caracteres en claro, lo justo para que
-- el contralor reconozca en su pantalla cuál liga revoca.
--
-- Y no se deriva del `factura_id`: un id identifica, no autoriza — la misma
-- lección que dejó escrita el buzón de intake (0095).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. `pago_recibido` estrena unique (id, tenant_id) ──────────────────────
-- Nunca había sido DESTINO de una FK. Ahora lo es (una propuesta conciliada
-- apunta al pago real, y el REP también), y la regla de la 0028/0145 exige
-- que toda FK entre dos tablas con tenant_id lleve su compuesta — que necesita
-- este unique del lado del destino.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pago_recibido_id_tenant_key' and conrelid = 'public.pago_recibido'::regclass
  ) then
    alter table public.pago_recibido add constraint pago_recibido_id_tenant_key unique (id, tenant_id);
  end if;
end $$;

-- ── 1. La liga: un link por factura, con caducidad y revocable ─────────────
create table if not exists public.portal_pago_liga (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  factura_id    uuid not null references public.factura_emitida(id) on delete cascade,
  token_hash    text not null,
  token_prefijo text not null,
  expira_en     timestamptz not null,
  creada_en     timestamptz not null default now(),
  creada_por    uuid references public.app_user(id) on delete set null,
  revocada_en   timestamptz,
  revocada_por  uuid references public.app_user(id) on delete set null,
  -- Sello best-effort del último acceso, para que el contralor sepa si la liga
  -- llegó a manos del cliente antes de perseguirlo por teléfono. La bitácora
  -- fina vive en `portal_pago_acceso`; esta columna es el resumen barato.
  ultimo_acceso_en timestamptz
);

comment on table public.portal_pago_liga is
  'Un link público por factura: /pago/<token>. El token EN CLARO no vive aquí — solo su sha256 y su prefijo, igual que tenant_api_key (0093). Se enseña una vez al generarlo; perdido, se revoca y se emite otro. La liga NO da sesión ni rol: el alcance es exactamente una factura, y por eso ni siquiera existe la posibilidad de listar otra.';
comment on column public.portal_pago_liga.token_hash is
  'sha256 hex del token completo. El CHECK de forma es la red que impide guardar el token en claro por accidente: si alguien escribiera el token, el insert falla en vez de conservarlo.';
comment on column public.portal_pago_liga.expira_en is
  'Caducidad DECLARADA, nunca infinita. El default de la app son 90 días. Un link de cobranza acaba escrito en un correo reenviado y en el ERP del cliente: sin fecha de muerte, la única forma de cerrarlo sería acordarse de revocarlo.';
comment on column public.portal_pago_liga.ultimo_acceso_en is
  'NULL significa NO SE HA ABIERTO — jamás se lee como "se abrió hace mucho". La distinción importa: el contralor decide con esto si el cliente ya vio la factura o si el correo nunca llegó.';

alter table public.portal_pago_liga
  add constraint portal_pago_liga_hash_forma check (token_hash ~ '^[0-9a-f]{64}$');
alter table public.portal_pago_liga
  add constraint portal_pago_liga_prefijo_forma
  check (token_prefijo = btrim(token_prefijo) and char_length(token_prefijo) between 4 and 24);
alter table public.portal_pago_liga
  add constraint portal_pago_liga_expira_despues check (expira_en > creada_en);
-- Revocar es un HECHO con autor y fecha; media revocación no existe.
alter table public.portal_pago_liga
  add constraint portal_pago_liga_revocacion_coherente
  check (revocada_por is null or revocada_en is not null);

-- Único GLOBAL, no por flota: el token ES la credencial y dos flotas con el
-- mismo hash se leerían la factura la una a la otra. Mismo criterio que
-- `tenant_buzon_token_unico` (0095).
create unique index if not exists portal_pago_liga_token_unico
  on public.portal_pago_liga (token_hash);

-- UNA liga viva por factura. Sin esto, "genera link" repetido deja cinco
-- tokens vigentes sobre la misma factura y revocar el que el contralor ve en
-- pantalla no cierra los otros cuatro.
create unique index if not exists portal_pago_liga_viva_unica
  on public.portal_pago_liga (factura_id)
  where revocada_en is null;

create index if not exists portal_pago_liga_factura_idx
  on public.portal_pago_liga (tenant_id, factura_id, creada_en desc);

-- ── 2. La propuesta: lo que el cliente teclea, en cuarentena ───────────────
create table if not exists public.portal_pago_propuesta (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  liga_id       uuid not null references public.portal_pago_liga(id) on delete cascade,
  factura_id    uuid not null references public.factura_emitida(id) on delete cascade,
  fecha         date not null,
  monto         numeric(12,2) not null,
  referencia    text not null,
  metodo        text,
  estado        text not null default 'pendiente',
  -- El pago REAL, el de `pago_recibido`, que nació al conciliar. NULL mientras
  -- la propuesta siga siendo una afirmación del cliente y nada más.
  pago_id       uuid references public.pago_recibido(id) on delete restrict,
  resuelta_en   timestamptz,
  resuelta_por  uuid references public.app_user(id) on delete set null,
  nota          text,
  registrada_en timestamptz not null default now()
);

comment on table public.portal_pago_propuesta is
  'Lo que el CLIENTE dice que pagó. Vive fuera de pago_recibido a propósito: la cartera, factura_saldo y auditor_cobranza no la ven, así que nadie puede saldar una factura tecleando un monto en un formulario público. Al conciliar, el contralor crea el pago de verdad por registrar_pago_tx (0159) y esta fila queda apuntándole. La conciliación propone; el humano confirma.';
comment on column public.portal_pago_propuesta.monto is
  'Lo que el cliente AFIRMA haber pagado. No se resta de ningún saldo ni se compara automáticamente contra el banco: es un dicho, y la pantalla del contralor lo rotula como tal.';
comment on column public.portal_pago_propuesta.pago_id is
  'ON DELETE RESTRICT y no SET NULL: si el pago real desapareciera, esta fila diría "conciliada" apuntando al vacío — un rastro de conciliación que ya no se puede auditar. Mejor que el borrado rebote.';

alter table public.portal_pago_propuesta
  add constraint portal_pago_propuesta_monto_positivo check (monto > 0);
alter table public.portal_pago_propuesta
  add constraint portal_pago_propuesta_estado_dominio
  check (estado in ('pendiente', 'conciliada', 'descartada'));
alter table public.portal_pago_propuesta
  add constraint portal_pago_propuesta_referencia_forma
  check (referencia = btrim(referencia) and referencia <> '' and char_length(referencia) <= 80);
alter table public.portal_pago_propuesta
  add constraint portal_pago_propuesta_metodo_forma
  check (metodo is null or (metodo = btrim(metodo) and metodo <> '' and char_length(metodo) <= 40));
-- Los tres estados y lo que cada uno OBLIGA a traer. Una "conciliada" sin
-- pago_id sería una factura abonada sin abono; una "pendiente" con
-- resuelta_en, un trámite cerrado que sigue en la bandeja.
alter table public.portal_pago_propuesta
  add constraint portal_pago_propuesta_estado_coherente
  check (
    (estado = 'pendiente'  and pago_id is null     and resuelta_en is null     and resuelta_por is null)
    or (estado = 'conciliada' and pago_id is not null and resuelta_en is not null)
    or (estado = 'descartada' and pago_id is null     and resuelta_en is not null)
  );

-- IDEMPOTENCIA POR CONSTRAINT. Un doble clic, un reintento del navegador o el
-- cliente que vuelve a mandar el mismo comprobante no pueden dejar dos
-- propuestas idénticas en la bandeja del contralor: se decidiría dos veces el
-- mismo pago. La referencia se normaliza (mayúsculas, sin orillas) porque
-- "REF-8891" y "ref-8891 " son el mismo movimiento bancario.
create unique index if not exists portal_pago_propuesta_unica
  on public.portal_pago_propuesta (liga_id, fecha, monto, upper(btrim(referencia)));

create index if not exists portal_pago_propuesta_bandeja_idx
  on public.portal_pago_propuesta (tenant_id, estado, registrada_en desc);
create index if not exists portal_pago_propuesta_factura_idx
  on public.portal_pago_propuesta (factura_id, registrada_en desc);

-- ── 3. El REP que la flota EMITE a su cliente ──────────────────────────────
create table if not exists public.rep_emitido (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  factura_id    uuid not null references public.factura_emitida(id) on delete cascade,
  pago_id       uuid references public.pago_recibido(id) on delete restrict,
  cfdi_uuid     text not null,
  fecha_pago    date not null,
  imp_pagado    numeric(12,2) not null,
  forma_pago_p  text,
  -- El XML tal cual lo devolvió el PAC, cuando la flota lo tiene a la mano.
  -- NULL = solo hay registro del UUID, y el portal lo DICE en esos términos en
  -- vez de ofrecer una descarga que no existe.
  xml           text,
  registrado_en timestamptz not null default now(),
  registrado_por uuid references public.app_user(id) on delete set null,
  -- Sello TRAS EL HECHO: cuándo el portal se lo enseñó al cliente por primera
  -- vez. Se escribe una sola vez y no se vuelve a tocar.
  entregado_en  timestamptz
);

comment on table public.rep_emitido is
  'El complemento de pago (CFDI Pagos 2.0) que la flota EMITE a su cliente. NO es cfdi_pago (0199): aquella guarda los REP que la flota RECIBE de proveedores y libera IVA ACREDITABLE. Este trae IVA TRASLADADO. Mezclarlas inflaría el acreditable de la flota con el IVA que ella misma trasladó. Likida no timbra: el UUID lo da el PAC de la flota y aquí solo se REGISTRA, igual que en factura_emitida (0049).';
comment on column public.rep_emitido.xml is
  'NULL significa QUE NO ESTÁ, no "vacío". El portal distingue las dos cosas: con XML ofrece la descarga; sin él, enseña el UUID citable y dice que el archivo hay que pedírselo a la flota. Nunca un botón de descarga que no baje nada.';
comment on column public.rep_emitido.entregado_en is
  'Sello del primer momento en que el cliente lo vio en el portal. Se pone DESPUÉS del hecho y no se reescribe: es la constancia de entrega, no una intención de entregar.';

alter table public.rep_emitido
  add constraint rep_emitido_uuid_minuscula check (cfdi_uuid = lower(cfdi_uuid));
alter table public.rep_emitido
  add constraint rep_emitido_uuid_forma
  check (cfdi_uuid ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
alter table public.rep_emitido
  add constraint rep_emitido_imp_positivo check (imp_pagado > 0);
alter table public.rep_emitido
  add constraint rep_emitido_forma_formato
  check (forma_pago_p is null or forma_pago_p ~ '^[0-9]{2}$');

-- El mismo UUID fiscal no puede registrarse dos veces en la misma flota: es la
-- llave de idempotencia del alta, igual que `factura_cfdi_unico` (0049).
create unique index if not exists rep_emitido_uuid_unico
  on public.rep_emitido (tenant_id, cfdi_uuid);
create index if not exists rep_emitido_factura_idx
  on public.rep_emitido (tenant_id, factura_id, fecha_pago desc);

-- ── 4. Bitácora del portal — SIN IP NI USER-AGENT ──────────────────────────
create table if not exists public.portal_pago_acceso (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenant(id) on delete cascade,
  liga_id    uuid not null references public.portal_pago_liga(id) on delete cascade,
  tipo       text not null,
  detalle    jsonb,
  ocurrio_en timestamptz not null default now()
);

comment on table public.portal_pago_acceso is
  'Qué pasó en el portal y cuándo. NO GUARDA IP NI USER-AGENT, y no es un olvido: el visitante es un tercero que jamás aceptó un aviso de privacidad de Likida, y para lo que esta bitácora sirve —"¿el cliente ya vio la factura?", "¿desde cuándo dice que pagó?"— la IP no aporta nada. Minimización del art. 13 de la LFPDPPP, mismo criterio que sitio_evento.';
comment on column public.portal_pago_acceso.tipo is
  'vista · pago_propuesto · rep_mostrado · liga_expirada · liga_revocada. Un token que no corresponde a NINGUNA liga no deja rastro aquí: no hay liga a la cual colgarlo, y contar los fallidos por token sería construir el oráculo que la página pública existe para no ser.';

alter table public.portal_pago_acceso
  add constraint portal_pago_acceso_tipo_dominio
  check (tipo in ('vista', 'pago_propuesto', 'rep_mostrado', 'liga_expirada', 'liga_revocada'));

create index if not exists portal_pago_acceso_liga_idx
  on public.portal_pago_acceso (liga_id, ocurrio_en desc);
create index if not exists portal_pago_acceso_tenant_idx
  on public.portal_pago_acceso (tenant_id, ocurrio_en desc);

-- ── 5. RLS deny-all + revoke (doble candado, patrón 0186/0196/0198) ────────
-- Ninguna de estas cuatro se toca desde una sesión de navegador: el portal es
-- público y corre con service_role del lado del servidor, y el panel del
-- contralor también (supabaseAdmin bypassa RLS y la puerta es puedeVerRuta).
-- Sin política y sin grant, `anon` y `authenticated` no tienen ni por dónde
-- empezar — que es exactamente lo que se quiere de la tabla que guarda las
-- credenciales de acceso a facturas.
alter table public.portal_pago_liga      enable row level security;
alter table public.portal_pago_propuesta enable row level security;
alter table public.rep_emitido           enable row level security;
alter table public.portal_pago_acceso    enable row level security;

revoke all on public.portal_pago_liga      from public, anon, authenticated;
revoke all on public.portal_pago_propuesta from public, anon, authenticated;
revoke all on public.rep_emitido           from public, anon, authenticated;
revoke all on public.portal_pago_acceso    from public, anon, authenticated;

grant select, insert, update, delete on public.portal_pago_liga      to service_role;
grant select, insert, update, delete on public.portal_pago_propuesta to service_role;
grant select, insert, update, delete on public.rep_emitido           to service_role;
grant select, insert, update, delete on public.portal_pago_acceso    to service_role;

-- ── 6. Las FK con tenant (la regla de la 0028/0145, que el bloque 112 vigila) ──
-- Toda FK entre dos tablas con tenant_id NOT NULL lleva su COMPUESTA: sin
-- ella, un tenant puede colgar su fila del padre de otro. Las FK a `app_user`
-- quedan fuera por diseño (su tenant_id es NULLABLE — el superadmin no tiene
-- flota), igual que en la 0198.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'portal_pago_liga_id_tenant_key' and conrelid = 'public.portal_pago_liga'::regclass
  ) then
    alter table public.portal_pago_liga add constraint portal_pago_liga_id_tenant_key unique (id, tenant_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'portal_pago_liga_factura_tenant_fkey' and conrelid = 'public.portal_pago_liga'::regclass
  ) then
    alter table public.portal_pago_liga
      add constraint portal_pago_liga_factura_tenant_fkey
      foreign key (factura_id, tenant_id) references public.factura_emitida (id, tenant_id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'portal_pago_propuesta_liga_tenant_fkey' and conrelid = 'public.portal_pago_propuesta'::regclass
  ) then
    alter table public.portal_pago_propuesta
      add constraint portal_pago_propuesta_liga_tenant_fkey
      foreign key (liga_id, tenant_id) references public.portal_pago_liga (id, tenant_id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'portal_pago_propuesta_factura_tenant_fkey' and conrelid = 'public.portal_pago_propuesta'::regclass
  ) then
    alter table public.portal_pago_propuesta
      add constraint portal_pago_propuesta_factura_tenant_fkey
      foreign key (factura_id, tenant_id) references public.factura_emitida (id, tenant_id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'portal_pago_propuesta_pago_tenant_fkey' and conrelid = 'public.portal_pago_propuesta'::regclass
  ) then
    alter table public.portal_pago_propuesta
      add constraint portal_pago_propuesta_pago_tenant_fkey
      foreign key (pago_id, tenant_id) references public.pago_recibido (id, tenant_id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'rep_emitido_factura_tenant_fkey' and conrelid = 'public.rep_emitido'::regclass
  ) then
    alter table public.rep_emitido
      add constraint rep_emitido_factura_tenant_fkey
      foreign key (factura_id, tenant_id) references public.factura_emitida (id, tenant_id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'rep_emitido_pago_tenant_fkey' and conrelid = 'public.rep_emitido'::regclass
  ) then
    alter table public.rep_emitido
      add constraint rep_emitido_pago_tenant_fkey
      foreign key (pago_id, tenant_id) references public.pago_recibido (id, tenant_id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'portal_pago_acceso_liga_tenant_fkey' and conrelid = 'public.portal_pago_acceso'::regclass
  ) then
    alter table public.portal_pago_acceso
      add constraint portal_pago_acceso_liga_tenant_fkey
      foreign key (liga_id, tenant_id) references public.portal_pago_liga (id, tenant_id)
      on delete cascade;
  end if;
end $$;
