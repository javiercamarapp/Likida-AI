-- ═══════════════════════════════════════════════════════════════════════════
-- 0370 — LIQUIDACIÓN EXTERNA (Agente 1, modo «solo entrega»)
--
-- Innovativos ya calcula la liquidación de su chofer en su SAP/TMS. Lo que
-- pidió el 31-ago es que Likida la ENTREGUE por WhatsApp, no que la recalcule.
-- Este modo es el opuesto exacto del flujo de fotos: aquí la cifra NO nace de
-- un comprobante leído por OCR ni de un cuadre contra política, nace en el
-- sistema del cliente y llega por `POST /v1/liquidaciones-externas`.
--
-- ── POR QUÉ UNA TABLA NUEVA Y NO `liquidacion` ──────────────────────────────
--
-- `liquidacion` (0001) cuelga de UN viaje (`viaje_id unique`), su total sale de
-- `gasto`, y su ciclo (estatus del motor + revisión humana 0299 + PDF
-- versionado 0346) presupone que Likida hizo el cuadre. Una liquidación externa
-- puede cubrir varios viajes, trae SUS cifras y SU periodo, y nadie en Likida
-- las firma. Meterla en `liquidacion` habría obligado a inventar un viaje, un
-- cuadre y una revisión que no existen — y a que `/v1/liquidaciones` (el
-- cierre firmado que un ERP asienta) devolviera cifras que Likida nunca
-- verificó. Dos orígenes, dos tablas: las cifras de esta no son del motor y
-- ninguna pantalla las mezcla con las que sí lo son.
--
-- ── LA IDEMPOTENCIA ─────────────────────────────────────────────────────────
--
-- `unique (tenant_id, clave_externa)`: la clave es el identificador de la
-- liquidación en el sistema del cliente (el folio de SAP). Un reintento con el
-- mismo contenido es el MISMO registro; el mismo folio con OTRO contenido no se
-- sobrescribe (la API contesta 409). `huella` es el sha256 del contenido
-- normalizado y es lo que permite distinguir los dos casos sin comparar jsonb.
--
-- ── EL CICLO DE ENTREGA ─────────────────────────────────────────────────────
--
--   pendiente → en_cola → enviada → acusada
--                   ↘ fallida ↗ (el panel puede reintentar: generacion + 1)
--
--   pendiente  recibida; todavía no se ha entregado a la cola de WhatsApp.
--   en_cola    el mensaje vive en `wa_outbox` (0180), que reintenta y deja
--              rastro; esta tabla NO habla con Meta directamente.
--   enviada    Meta aceptó el mensaje (hay wamid).
--   acusada    el chofer apretó un botón: «Recibida» o «No coincide».
--   fallida    agotó reintentos o Meta la rechazó sin remedio. Se dice por qué.
--
-- `via` distingue mensaje de sesión (dentro de las 24 h) de plantilla (fuera de
-- ellas), porque la segunda necesita aprobación de Meta y quien opera tiene que
-- poder saber cuál se usó.
--
-- Todo lo que escribe esta tabla es el servidor (service_role). La política de
-- lectura es la de dinero: el encargado NO ve cifras (`ve_finanzas()`, 0048).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.liquidacion_externa (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant(id) on delete cascade,

  -- La identidad del documento en el sistema del cliente. `huella` = sha256 del
  -- contenido normalizado (ver el encabezado).
  clave_externa    text not null,
  huella           text not null,
  sistema_origen   text,

  operador_id      uuid not null references public.operador(id) on delete restrict,
  -- Los folios que el cliente dice que cubre. NO son FK: el viaje puede vivir
  -- solo en su TMS. `viaje_ids` son los que sí existen en Likida, resueltos al
  -- recibir; vacío no es un error.
  folios_viaje     text[] not null default '{}',
  viaje_ids        uuid[] not null default '{}',

  periodo_desde    date not null,
  periodo_hasta    date not null,

  -- Las cifras del cliente, tal cual. Likida no las recalcula; solo verifica,
  -- al recibirlas, que el total sea la suma de sus renglones.
  conceptos        jsonb not null,
  total            numeric(14,2) not null,
  moneda           text not null,

  -- El PDF vive en el bucket privado `liquidaciones` (0008). `pdf_origen`
  -- distingue el que adjuntó el cliente del que generó Likida con SUS cifras.
  pdf_ruta         text,
  pdf_origen       text not null,
  pdf_sha256       text,

  estado           text not null default 'pendiente',
  via              text,
  -- Sube cada vez que el panel reintenta una entrega fallida: es parte de la
  -- llave de deduplicación del outbox, y sin ella el reintento rebotaría
  -- contra la fila `dead` del intento anterior.
  generacion       int not null default 1,
  intentos         int not null default 0,
  proximo_intento_en timestamptz not null default now(),
  ultimo_error     text,
  wamid            text,
  enviada_en       timestamptz,

  acuse_tipo       text,
  acuse_en         timestamptz,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint liquidacion_externa_clave_unica unique (tenant_id, clave_externa),
  -- Destino de la FK compuesta de la bitácora (regla de la 0028/0145: toda FK
  -- entre dos tablas con tenant_id lleva su compuesta, o un autenticado de la
  -- flota A cuelga su fila del padre de la flota B).
  constraint liquidacion_externa_id_tenant_key unique (id, tenant_id),
  -- Un chofer de OTRA flota no puede ser el destinatario de esta liquidación.
  -- La FK simple de la columna se queda: son restricciones distintas.
  constraint liquidacion_externa_operador_tenant_fkey
    foreign key (operador_id, tenant_id) references public.operador (id, tenant_id) on delete restrict,
  constraint liquidacion_externa_clave_larga check (char_length(clave_externa) between 1 and 120),
  constraint liquidacion_externa_huella_forma check (huella ~ '^[0-9a-f]{64}$'),
  constraint liquidacion_externa_periodo check (periodo_desde <= periodo_hasta),
  constraint liquidacion_externa_moneda_dominio check (moneda in ('MXN', 'USD')),
  constraint liquidacion_externa_conceptos_forma check (
    jsonb_typeof(conceptos) = 'array'
    and jsonb_array_length(conceptos) between 1 and 100
  ),
  constraint liquidacion_externa_total_rango check (total between -9999999.99 and 9999999.99),
  constraint liquidacion_externa_pdf_origen_dominio check (pdf_origen in ('adjunto', 'generado')),
  constraint liquidacion_externa_estado_dominio check (
    estado in ('pendiente', 'en_cola', 'enviada', 'acusada', 'fallida')
  ),
  constraint liquidacion_externa_via_dominio check (via is null or via in ('sesion', 'plantilla')),
  constraint liquidacion_externa_generacion_pos check (generacion >= 1 and intentos >= 0),
  constraint liquidacion_externa_acuse_dominio check (
    acuse_tipo is null or acuse_tipo in ('recibida', 'no_coincide')
  ),
  -- Un acuse sin tipo o sin hora es una constancia a medias: o están los dos,
  -- o ninguno, y `acusada` exige los dos.
  constraint liquidacion_externa_acuse_completo check (
    (acuse_tipo is null) = (acuse_en is null)
    and (estado <> 'acusada' or acuse_tipo is not null)
  )
);

comment on table public.liquidacion_externa is
  'Liquidaciones que el SAP/TMS del cliente ya calculó y Likida solo ENTREGA al chofer por WhatsApp (0370). Las cifras son del cliente: Likida no las recalcula ni las mezcla con `liquidacion`, cuyo total sí sale del motor de cuadre.';
comment on column public.liquidacion_externa.clave_externa is
  'Identificador de la liquidación en el sistema del cliente (folio de SAP). Con tenant_id es la llave de idempotencia.';
comment on column public.liquidacion_externa.huella is
  'sha256 del contenido normalizado. Mismo folio + misma huella = reintento; mismo folio + otra huella = conflicto (la API contesta 409, no sobrescribe).';
comment on column public.liquidacion_externa.viaje_ids is
  'Los viajes de Likida que coinciden con folios_viaje al recibirla. Vacío = el cliente no los tiene en Likida; no es un error.';
comment on column public.liquidacion_externa.estado is
  'pendiente → en_cola → enviada → acusada, o fallida. En_cola = vive en wa_outbox (0180), que es quien reintenta contra Meta.';
comment on column public.liquidacion_externa.generacion is
  'Sube al reintentar una entrega fallida; entra a la llave de deduplicación del outbox para que el reintento no rebote contra la fila dead anterior.';
comment on column public.liquidacion_externa.acuse_tipo is
  'Lo que apretó el chofer: recibida o no_coincide. NULL = todavía no contestó.';

create index if not exists liquidacion_externa_tenant_creada_idx
  on public.liquidacion_externa (tenant_id, created_at desc, id desc);
create index if not exists liquidacion_externa_operador_idx
  on public.liquidacion_externa (operador_id);
-- Lo que el cron mira: lo que todavía no terminó de salir.
create index if not exists liquidacion_externa_trabajo_idx
  on public.liquidacion_externa (proximo_intento_en)
  where estado in ('pendiente', 'en_cola');

-- ── Bitácora de eventos ─────────────────────────────────────────────────────
-- Append-only: qué le pasó a cada liquidación y cuándo. Es lo que contesta
-- «¿se la mandaron a este chofer? ¿cuándo apretó el botón?» sin depender de que
-- el log de la invocación siga vivo.
create table if not exists public.liquidacion_externa_evento (
  id                      bigint generated always as identity primary key,
  liquidacion_externa_id  uuid not null references public.liquidacion_externa(id) on delete cascade,
  tenant_id               uuid not null references public.tenant(id) on delete cascade,
  tipo                    text not null,
  detalle                 jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now(),
  constraint liquidacion_externa_evento_liq_tenant_fkey
    foreign key (liquidacion_externa_id, tenant_id) references public.liquidacion_externa (id, tenant_id) on delete cascade,
  constraint liquidacion_externa_evento_tipo_dominio check (tipo in (
    'recibida', 'encolada', 'enviada', 'fallback_plantilla', 'fallida',
    'reintento_manual', 'acuse_recibida', 'acuse_no_coincide'
  ))
);
comment on table public.liquidacion_externa_evento is
  'Bitácora append-only de la entrega de cada liquidación externa (0370).';
create index if not exists liquidacion_externa_evento_liq_idx
  on public.liquidacion_externa_evento (liquidacion_externa_id, id);
create index if not exists liquidacion_externa_evento_tenant_idx
  on public.liquidacion_externa_evento (tenant_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Una tabla nueva sin RLS es el agujero que nadie ve hasta que alguien le
-- pregunta a PostgREST con la anon key. Lectura: dinero (el encargado no entra).
-- Escritura: ninguna política — solo service_role, que es quien escribe.
alter table public.liquidacion_externa enable row level security;
alter table public.liquidacion_externa_evento enable row level security;

drop policy if exists tenant_lee on public.liquidacion_externa;
create policy tenant_lee on public.liquidacion_externa for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_finanzas()) or is_superadmin());

drop policy if exists tenant_lee on public.liquidacion_externa_evento;
create policy tenant_lee on public.liquidacion_externa_evento for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_finanzas()) or is_superadmin());

-- ── El latido del cron que entrega y concilia ───────────────────────────────
-- `/api/cron/liquidaciones-externas` pasa la cola de entrega y concilia contra
-- el outbox. Su latido necesita estar en el dominio de `cron_latido`, que se
-- enumera ENTERO cada vez (lección de la 0227/0241/0248: una lista corta no
-- falla ruidosamente, silencia el latido de los que faltan). Espejo de CRONS en
-- `lib/admin/salud.ts`; `salud.test.ts` lee el último `add constraint` de todo
-- `supabase/migrations/` y compara.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'cron_latido_id_dominio' and conrelid = 'public.cron_latido'::regclass
  ) then
    alter table public.cron_latido drop constraint cron_latido_id_dominio;
  end if;
  alter table public.cron_latido
    add constraint cron_latido_id_dominio
    check (id in (
      'wa-pendientes',
      'wa-outbox',
      'escalar',
      'facturar',
      'purgar',
      'runner',
      'gps',
      'asistencia',
      'descarga-sat',
      'jornada',
      'portales-vivos',
      'liquidaciones-externas'
    ));
end $$;

comment on constraint cron_latido_id_dominio on public.cron_latido is
  'El catálogo COMPLETO de ids de cron, espejo de CRONS en lib/admin/salud.ts. Se enumera entero al tocarlo: una lista corta no falla ruidosamente, silencia el latido de los crons que faltan. La 0370 añade liquidaciones-externas.';
