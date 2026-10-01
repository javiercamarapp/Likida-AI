-- ═══════════════════════════════════════════════════════════════════════════
-- 0380 — AGENTE 5 «CONDUCTOR»: los hitos del viaje por WhatsApp.
--
-- Innovativos (250 camiones) pide un agente que PIDA, PERSIGA, VALIDE y REGISTRE
-- los hitos que el chofer no manda: llegada a cargar (y con quién se reportó),
-- salida de carga, llegada a descarga, salida de descarga y regreso — y que
-- mande los avisos que su sistema actual no manda.
--
-- ── POR QUÉ UNA TABLA DE HITOS Y NO MÁS COLUMNAS EN `viaje` ──────────────────
-- La 0090 dejó tres sellos (`llegada_en`, `descarga_en`, `regreso_en`) y dijo
-- que «el día que haya más pasos, esa será su migración». Es hoy. Un hito ahora
-- tiene ESTADO (esperado → recibido → validado, u omitido / escalado), fuente,
-- hora del mensaje, contacto en andén, coordenadas, recordatorios y ciclo de
-- corrección: seis columnas por hito, cinco hitos. Una fila por (viaje, hito).
-- Los tres sellos de la 0090 SE CONSERVAN y el motor los sigue escribiendo
-- (`llegada_en` = llegada a descarga, `descarga_en` = «estoy descargando»,
-- `regreso_en`): la espera en patio y el tablero que ya existen no se rompen.
--
-- ── LA AMBIGUEDAD DE «YA LLEGUÉ» ─────────────────────────────────────────────
-- Con tres columnas, «ya llegué» en el ORIGEN sellaba la llegada al DESTINO. Con
-- una fila por hito, el motor decide a CUÁL se refiere mirando qué hitos del
-- viaje ya están registrados (src/lib/likida/conductor/maquina.ts).
--
-- ── EL CANDADO ANTI-DUPLICADO ────────────────────────────────────────────────
-- `viaje_hito_aviso` es a la vez la bitácora y el claim: un (hito, ciclo, clase,
-- nivel) existe UNA vez. Reclamar = insertar; el perdedor del insert no manda
-- nada (mismo patrón que `cobranza_contacto`, 0089).
--
-- ── PRIVACIDAD ───────────────────────────────────────────────────────────────
-- Datos personales nuevos: el nombre de un tercero (quien recibe en el andén),
-- coordenadas del chofer, el texto que escribió y los últimos 4 dígitos de
-- quien recibió un aviso. Cancelación ARCO: un disparador sobre
-- `operador.anonimizado_en` los borra SIN reescribir `ejecutar_arco_cancelacion`
-- (que varias ramas tocan). Retención: `anonimizar_conductor_hitos` (plazo
-- PROPUESTO de 365 días; lo fija el aviso de privacidad de cada flota, no esta
-- migración) y `purgar_conductor_auditoria`. Los instantes y estados NO se
-- borran: son la evidencia de estadías que la flota cruza contra su cliente.
--
-- Todo lo escribe el servidor (service_role). Lectura: operación de la flota
-- (`ve_operacion()` — dueño, encargado, superadmin; el contador no—, el mismo
-- criterio que `posicion` desde la 0324: dónde está el chofer y con quién se
-- reportó no es asunto del contador).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Cita y ETA de origen y destino, en el viaje ──────────────────────────
-- NULLABLE a propósito: la mayoría de los viajes hoy no traen cita capturada, y
-- un NULL es un dato que nadie capturó, no un error. Sin cita el agente usa los
-- plazos por defecto de la config de la flota.
alter table public.viaje
  add column if not exists cita_origen_en  timestamptz,
  add column if not exists cita_destino_en timestamptz,
  add column if not exists eta_origen_en   timestamptz,
  add column if not exists eta_destino_en  timestamptz;

comment on column public.viaje.cita_origen_en is
  '0380: hora de la cita de CARGA en el origen (la fija el cliente de la flota). NULL = no capturada.';
comment on column public.viaje.cita_destino_en is
  '0380: hora de la cita de DESCARGA en el destino. NULL = no capturada.';
comment on column public.viaje.eta_origen_en is
  '0380: hora estimada de llegada al origen (la del TMS o la del despachador). La cita manda sobre la ETA.';
comment on column public.viaje.eta_destino_en is
  '0380: hora estimada de llegada al destino. La cita manda sobre la ETA.';

-- ── 2. Validadores de minutos de la config (jsonb de enteros ascendentes) ───
create or replace function public.conductor_minutos_validos(p_valor jsonb)
returns boolean
language sql immutable
set search_path = ''
as $$
  select p_valor is not null
     and jsonb_typeof(p_valor) = 'array'
     and jsonb_array_length(p_valor) between 1 and 6
     and not exists (
       select 1 from jsonb_array_elements(p_valor) e
        where jsonb_typeof(e) <> 'number'
           or (e #>> '{}') !~ '^[0-9]{1,4}$'
     )
     -- Ascendentes y sin repetir: insistir es escalar, nunca repetir.
     and (select coalesce(bool_and(a.v < a.siguiente), true)
            from (select (e.value #>> '{}')::int as v,
                         lead((e.value #>> '{}')::int) over (order by e.ordinality) as siguiente
                    from jsonb_array_elements(p_valor) with ordinality e) a
           where a.siguiente is not null)
$$;
revoke all on function public.conductor_minutos_validos(jsonb) from public, anon, authenticated;
grant execute on function public.conductor_minutos_validos(jsonb) to service_role;

create or replace function public.conductor_dias_validos(p_valor jsonb)
returns boolean
language sql immutable
set search_path = ''
as $$
  select p_valor is not null
     and jsonb_typeof(p_valor) = 'array'
     and jsonb_array_length(p_valor) between 1 and 7
     and not exists (select 1 from jsonb_array_elements(p_valor) e where (e #>> '{}') !~ '^[1-7]$')
$$;
revoke all on function public.conductor_dias_validos(jsonb) from public, anon, authenticated;
grant execute on function public.conductor_dias_validos(jsonb) to service_role;

-- ── 3. La configuración por flota ───────────────────────────────────────────
-- Sin fila = defaults del código (src/lib/likida/conductor/config.ts). Una fila
-- por flota, como `agente_cobranza_config` (0089).
create table if not exists public.agente_conductor_config (
  tenant_id uuid primary key references public.tenant(id) on delete cascade,
  activo boolean not null default true,
  -- Contactos al CHOFER, en minutos desde que el hito toca. 0 = la solicitud;
  -- los demás son recordatorios 1, 2 y 3. Default 0/+15/+30/+45.
  solicitudes_min jsonb not null default '[0, 15, 30, 45]'::jsonb,
  -- Minutos desde que toca el hito para avisar al patio responsable (nivel 1).
  escalar_tras_min integer not null default 90,
  -- Minutos MÁS que el nivel 1 sigue sin atenderse para subir al jefe general.
  segundo_nivel_min integer not null default 30,
  -- La ventana de la flota: NUNCA se insiste fuera de ella (hora de México).
  hora_inicio smallint not null default 6,
  hora_fin smallint not null default 22,
  dias_semana jsonb not null default '[1,2,3,4,5,6,7]'::jsonb,
  -- Mensajes proactivos por chofer por día (solicitudes y recordatorios).
  tope_diario_chofer smallint not null default 12,
  -- Cuándo toca pedir la llegada: N min antes de la cita/ETA.
  anticipo_cita_min smallint not null default 30,
  -- Plazos por defecto cuando NO hay cita/ETA: son SUPUESTOS, no mediciones.
  espera_sin_cita_min integer not null default 120,
  espera_carga_min integer not null default 120,
  trayecto_sin_eta_min integer not null default 480,
  espera_descarga_min integer not null default 120,
  regreso_min integer not null default 30,
  -- Cuánto se aplaza el hito cuando el chofer avisa «voy con retraso».
  posponer_min smallint not null default 30,
  -- Hasta cuándo el chofer puede RETIRAR un hito que acaba de mandar.
  ventana_correccion_min smallint not null default 60,
  -- El modelo de respaldo para texto libre (las reglas siempre van primero).
  usar_llm boolean not null default true,
  -- Avisos a la oficina (con la hora exacta del mensaje).
  avisar_oficina_llegada boolean not null default false,
  avisar_oficina_salida boolean not null default false,
  confirmar_al_chofer boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint conductor_config_solicitudes check (public.conductor_minutos_validos(solicitudes_min)),
  constraint conductor_config_horas check (hora_inicio between 0 and 23 and hora_fin between 1 and 24 and hora_fin > hora_inicio),
  constraint conductor_config_dias check (public.conductor_dias_validos(dias_semana)),
  constraint conductor_config_escalar check (escalar_tras_min between 10 and 1440 and segundo_nivel_min between 5 and 1440),
  constraint conductor_config_tope check (tope_diario_chofer between 1 and 60),
  constraint conductor_config_plazos check (
    anticipo_cita_min between 0 and 600
    and espera_sin_cita_min between 0 and 2880 and espera_carga_min between 0 and 2880
    and trayecto_sin_eta_min between 0 and 4320 and espera_descarga_min between 0 and 2880
    and regreso_min between 0 and 2880 and posponer_min between 5 and 240
    and ventana_correccion_min between 5 and 720
  )
);
comment on table public.agente_conductor_config is
  'Configuración por flota del Agente 5 Conductor (0380): escalera de recordatorios, ventana horaria, tope diario, plazos por defecto y avisos a la oficina. Sin fila = defaults del código.';
comment on column public.agente_conductor_config.espera_sin_cita_min is
  'SUPUESTO por defecto cuando el viaje no trae cita/ETA (no es una medición). La flota lo ajusta a su operación.';

-- ── 4. A quién se escala: patio responsable (nivel 1) → jefe general (nivel 2) ─
create table if not exists public.conductor_contacto_trafico (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  -- NULL = aplica a toda la flota (jefe general, o respaldo de cualquier patio).
  terminal_id uuid,
  nivel smallint not null,
  nombre text not null,
  telefono text not null,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  constraint conductor_contacto_nivel check (nivel in (1, 2)),
  constraint conductor_contacto_nombre check (char_length(btrim(nombre)) between 1 and 80),
  constraint conductor_contacto_telefono check (telefono ~ '^[1-9][0-9]{7,14}$'),
  constraint conductor_contacto_terminal_fkey
    foreign key (terminal_id, tenant_id) references public.terminal (id, tenant_id) on delete cascade
);
create unique index if not exists conductor_contacto_unico
  on public.conductor_contacto_trafico (tenant_id, coalesce(terminal_id, '00000000-0000-0000-0000-000000000000'::uuid), nivel, telefono);
create index if not exists conductor_contacto_busqueda
  on public.conductor_contacto_trafico (tenant_id, nivel) where activo;
comment on table public.conductor_contacto_trafico is
  '0380: a quién escala el Agente 5. Nivel 1 = patio responsable de la terminal del viaje; nivel 2 = jefe general. Sin contactos, el nivel 2 cae al jefe de la flota (app_user). Teléfono en forma 52+10 (wa_normalizar_telefono).';

-- ── 5. Los hitos ────────────────────────────────────────────────────────────
create table if not exists public.viaje_hito (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  viaje_id uuid not null,
  tipo text not null,
  estado text not null default 'esperado',
  -- Cuántas veces se retiró y se volvió a registrar. Entra a la llave del claim
  -- de avisos: un hito corregido vuelve a empezar su escalera.
  ciclo smallint not null default 1,

  -- Cómo llegó el dato.
  fuente text,
  interpretacion text,
  confianza real,
  wa_message_id text,
  -- LA HORA DEL MENSAJE (Meta) y la de recepción: dos verdades distintas, y el
  -- producto nunca presenta ninguna como telemetría del evento físico.
  mensaje_en timestamptz,
  recibido_en timestamptz,
  texto_chofer text,

  -- Con quién se reportó en el andén.
  contacto_nombre text,
  contacto_area text,
  sin_contacto boolean not null default false,

  -- Evidencia opcional.
  lat double precision,
  lng double precision,
  evidencia_ruta text,

  -- Validación independiente del dicho del chofer.
  validado_en timestamptz,
  validado_por text,

  -- Qué se hizo cuando NO se recibió.
  omitido_motivo text,
  pospuesto_hasta timestamptz,
  pospuesto_veces smallint not null default 0,
  correcciones smallint not null default 0,

  -- La escalera de recordatorios.
  solicitado_en timestamptz,
  recordatorios_enviados smallint not null default 0,
  ultimo_aviso_en timestamptz,
  escalado_en timestamptz,
  escalacion_nivel smallint not null default 0,
  escalacion_atendida_en timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint viaje_hito_viaje_unico unique (viaje_id, tipo),
  constraint viaje_hito_id_tenant_key unique (id, tenant_id),
  constraint viaje_hito_viaje_tenant_fkey
    foreign key (viaje_id, tenant_id) references public.viaje (id, tenant_id) on delete cascade,
  constraint viaje_hito_tipo_dominio check (tipo in
    ('llegada_carga', 'salida_carga', 'llegada_descarga', 'salida_descarga', 'regreso')),
  constraint viaje_hito_estado_dominio check (estado in
    ('esperado', 'recibido', 'validado', 'omitido', 'escalado')),
  constraint viaje_hito_fuente_dominio check (fuente is null or fuente in
    ('texto', 'boton', 'ubicacion', 'foto', 'sistema')),
  constraint viaje_hito_interpretacion_dominio check (interpretacion is null or interpretacion in
    ('regla', 'boton', 'llm', 'ubicacion', 'foto', 'sistema')),
  constraint viaje_hito_confianza_rango check (confianza is null or confianza between 0 and 1),
  -- Un hito recibido o validado trae su fuente y su hora; uno que no se recibió
  -- no puede fingir que sí (ni traer contacto ni coordenadas de otro ciclo).
  constraint viaje_hito_recibido_completo check (
    (estado in ('recibido', 'validado')) = (recibido_en is not null and fuente is not null)
  ),
  constraint viaje_hito_validado_completo check (
    (estado = 'validado') = (validado_en is not null and validado_por is not null)
  ),
  constraint viaje_hito_validado_por_dominio check (validado_por is null or validado_por in ('oficina', 'gps', 'sistema')),
  constraint viaje_hito_omitido_motivo check ((estado = 'omitido') = (omitido_motivo is not null)),
  constraint viaje_hito_escalado_completo check (estado <> 'escalado' or (escalado_en is not null and escalacion_nivel >= 1)),
  constraint viaje_hito_coordenadas check (
    (lat is null) = (lng is null)
    and (lat is null or (lat between -90 and 90 and lng between -180 and 180))
  ),
  constraint viaje_hito_texto_corto check (
    (texto_chofer is null or char_length(texto_chofer) <= 240)
    and (contacto_nombre is null or char_length(contacto_nombre) between 1 and 80)
    and (contacto_area is null or char_length(contacto_area) between 1 and 60)
    and (evidencia_ruta is null or char_length(evidencia_ruta) <= 300)
  ),
  constraint viaje_hito_contador_sano check (
    ciclo >= 1 and recordatorios_enviados between 0 and 30
    and correcciones between 0 and 30 and pospuesto_veces between 0 and 10
    and escalacion_nivel between 0 and 2
  )
);
comment on table public.viaje_hito is
  'Los hitos del viaje que el Agente 5 pide, persigue, valida y registra (0380). Una fila por (viaje, hito): esperado → recibido → validado, u omitido (se infirió por un hito posterior) o escalado (se agotaron los recordatorios). La hora es la del MENSAJE, no la del evento físico.';
comment on column public.viaje_hito.mensaje_en is
  'Hora del mensaje del chofer según Meta (DAT-38). No es la hora del evento físico: el chofer puede avisar tarde.';
comment on column public.viaje_hito.ciclo is
  'Sube cada vez que el hito se retira (corrección) o se pospone: reinicia la escalera de recordatorios.';
comment on column public.viaje_hito.texto_chofer is
  'Lo que escribió el chofer (≤ 240). Dato personal: lo anonimiza la cancelación ARCO y la retención.';

create index if not exists viaje_hito_tenant_viaje_idx on public.viaje_hito (tenant_id, viaje_id);
-- Lo que el cron persigue: solo lo que sigue esperando respuesta.
create index if not exists viaje_hito_trabajo_idx on public.viaje_hito (tenant_id, updated_at)
  where estado in ('esperado', 'escalado');
create index if not exists viaje_hito_recibido_idx on public.viaje_hito (tenant_id, recibido_en desc)
  where estado in ('recibido', 'validado');
-- Un mensaje de WhatsApp registra a lo más UN hito: la red durable contra el
-- reintento del webhook (la primera red es el claim del mensaje).
create unique index if not exists viaje_hito_mensaje_unico
  on public.viaje_hito (tenant_id, wa_message_id) where wa_message_id is not null;

-- ── 6. Bitácora de avisos + claim anti-duplicado ────────────────────────────
create table if not exists public.viaje_hito_aviso (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  viaje_id uuid not null,
  viaje_hito_id uuid not null,
  -- Quién recibe (solo para el tope diario por chofer); no es una FK a propósito.
  operador_id uuid,
  ciclo smallint not null,
  clase text not null,
  nivel smallint not null default 0,
  -- NULL = reclamado y todavía sin resultado (o la corrida murió a media).
  ok boolean,
  canal text,
  motivo text,
  destinatario_ult4 text,
  created_at timestamptz not null default now(),
  constraint viaje_hito_aviso_unico unique (viaje_hito_id, ciclo, clase, nivel),
  constraint viaje_hito_aviso_hito_fkey
    foreign key (viaje_hito_id, tenant_id) references public.viaje_hito (id, tenant_id) on delete cascade,
  constraint viaje_hito_aviso_clase_dominio check (clase in
    ('solicitud', 'recordatorio', 'escalacion', 'confirmacion', 'aviso_oficina')),
  constraint viaje_hito_aviso_nivel check (nivel between 0 and 9),
  constraint viaje_hito_aviso_canal check (canal is null or canal in ('texto', 'botones', 'plantilla', 'ninguno')),
  constraint viaje_hito_aviso_ult4 check (destinatario_ult4 is null or destinatario_ult4 ~ '^[0-9]{1,4}$'),
  constraint viaje_hito_aviso_motivo check (motivo is null or char_length(motivo) <= 200)
);
comment on table public.viaje_hito_aviso is
  'Bitácora y CLAIM de los avisos del Agente 5 (0380): un (hito, ciclo, clase, nivel) existe una vez. Reclamar = insertar; el perdedor no manda nada. Sin teléfono completo (solo los últimos 4).';
create index if not exists viaje_hito_aviso_chofer_dia_idx
  on public.viaje_hito_aviso (operador_id, created_at) where operador_id is not null;
create index if not exists viaje_hito_aviso_tenant_idx on public.viaje_hito_aviso (tenant_id, created_at desc);
create index if not exists viaje_hito_aviso_viaje_idx on public.viaje_hito_aviso (viaje_id);

-- ── 7. Eventos: bitácora append-only y feed para el sistema del cliente ─────
-- Sin datos personales en `detalle` (ids, estados, fuentes): el feed de /v1 lo
-- lee un sistema ajeno y la cancelación ARCO no tiene que reescribirlo.
create table if not exists public.viaje_hito_evento (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  viaje_id uuid not null,
  viaje_hito_id uuid not null,
  tipo_hito text not null,
  evento text not null,
  detalle jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint viaje_hito_evento_hito_fkey
    foreign key (viaje_hito_id, tenant_id) references public.viaje_hito (id, tenant_id) on delete cascade,
  constraint viaje_hito_evento_tipo_hito check (tipo_hito in
    ('llegada_carga', 'salida_carga', 'llegada_descarga', 'salida_descarga', 'regreso')),
  constraint viaje_hito_evento_dominio check (evento in
    ('solicitado', 'recibido', 'validado', 'omitido', 'escalado', 'corregido', 'pospuesto', 'atendido', 'contacto')),
  constraint viaje_hito_evento_detalle check (jsonb_typeof(detalle) = 'object' and pg_column_size(detalle) <= 2000)
);
comment on table public.viaje_hito_evento is
  'Bitácora append-only del Agente 5 (0380) y fuente de GET /v1/hitos/eventos. Sin datos personales en detalle.';
create index if not exists viaje_hito_evento_tenant_idx on public.viaje_hito_evento (tenant_id, id);
create index if not exists viaje_hito_evento_hito_idx on public.viaje_hito_evento (viaje_hito_id, id);

-- ── 8. RLS ──────────────────────────────────────────────────────────────────
alter table public.agente_conductor_config enable row level security;
alter table public.conductor_contacto_trafico enable row level security;
alter table public.viaje_hito enable row level security;
alter table public.viaje_hito_aviso enable row level security;
alter table public.viaje_hito_evento enable row level security;

do $$
declare t text;
begin
  foreach t in array array['agente_conductor_config', 'conductor_contacto_trafico', 'viaje_hito', 'viaje_hito_aviso', 'viaje_hito_evento']
  loop
    execute format('drop policy if exists tenant_lee on public.%I', t);
    execute format($p$
      create policy tenant_lee on public.%I for select
      using (
        (tenant_id = any(public.get_user_tenant_ids()) and (select public.ve_operacion()))
        or (select public.is_superadmin())
      )
    $p$, t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;
-- La bitácora de eventos es append-only también para quien escribe por servidor.
revoke update, delete on table public.viaje_hito_evento from service_role;
grant delete on table public.viaje_hito_evento to service_role; -- solo la retención; ver purgar_conductor_auditoria
grant usage, select on sequence public.viaje_hito_evento_id_seq to service_role;

-- ── 9. Sembrar los hitos de los viajes abiertos y aceptados ─────────────────
-- Set-based e idempotente: el cron lo corre al inicio de cada pasada. Los viajes
-- de una flota con el agente apagado no reciben filas.
create or replace function public.sembrar_hitos_conductor(p_limite integer default 500)
returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_n integer;
begin
  if p_limite is null or p_limite < 1 then raise exception 'p_limite inválido'; end if;
  with candidatos as (
    select v.id, v.tenant_id
      from public.viaje v
     where v.estatus = 'abierto'
       and v.aceptado_en is not null
       and coalesce((select c.activo from public.agente_conductor_config c where c.tenant_id = v.tenant_id), true)
       and not exists (select 1 from public.viaje_hito h where h.viaje_id = v.id)
     order by v.aceptado_en
     limit p_limite
  ), tipos(tipo) as (
    values ('llegada_carga'), ('salida_carga'), ('llegada_descarga'), ('salida_descarga'), ('regreso')
  )
  insert into public.viaje_hito (tenant_id, viaje_id, tipo)
  select c.tenant_id, c.id, t.tipo from candidatos c cross join tipos t
  on conflict (viaje_id, tipo) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.sembrar_hitos_conductor(integer) from public, anon, authenticated;
grant execute on function public.sembrar_hitos_conductor(integer) to service_role;

-- ── 10. Cancelación ARCO: el dato personal de los hitos se retira ───────────
-- Dispara cuando `ejecutar_arco_cancelacion` marca `operador.anonimizado_en`.
-- Se conservan estados e instantes (evidencia de estadías); se borra el tercero
-- (contacto en andén), las coordenadas, el texto y los últimos 4 dígitos.
create or replace function public.conductor_anonimizar_por_arco()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if old.anonimizado_en is null and new.anonimizado_en is not null then
    update public.viaje_hito h
       set contacto_nombre = null, contacto_area = null, lat = null, lng = null,
           texto_chofer = null, evidencia_ruta = null, updated_at = now()
     where h.tenant_id = new.tenant_id
       and h.viaje_id in (select v.id from public.viaje v where v.operador_id = new.id and v.tenant_id = new.tenant_id);
    update public.viaje_hito_aviso a
       set destinatario_ult4 = null
     where a.tenant_id = new.tenant_id and a.operador_id = new.id;
  end if;
  return new;
end $$;
revoke all on function public.conductor_anonimizar_por_arco() from public, anon, authenticated;
drop trigger if exists conductor_anonimizar_por_arco on public.operador;
create trigger conductor_anonimizar_por_arco
  after update of anonimizado_en on public.operador
  for each row execute function public.conductor_anonimizar_por_arco();

-- ── 11. Retención ───────────────────────────────────────────────────────────
-- El plazo es un PARÁMETRO (default 365 días, mínimo 30) y está PROPUESTO: la
-- decisión de política de privacidad es de la flota/Javier, no de una migración.
create or replace function public.anonimizar_conductor_hitos(
  p_dias integer default 365, p_limite integer default 5000
) returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_n integer;
begin
  if p_dias is null or p_dias < 30 or p_limite is null or p_limite < 1 then
    raise exception 'parámetros de retención inválidos';
  end if;
  with viejos as (
    select id from public.viaje_hito
     where coalesce(recibido_en, created_at) < now() - make_interval(days => p_dias)
       and (contacto_nombre is not null or contacto_area is not null or lat is not null
            or texto_chofer is not null or evidencia_ruta is not null)
     order by coalesce(recibido_en, created_at) limit p_limite
  )
  update public.viaje_hito h
     set contacto_nombre = null, contacto_area = null, lat = null, lng = null,
         texto_chofer = null, evidencia_ruta = null, updated_at = now()
    from viejos v where h.id = v.id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.anonimizar_conductor_hitos(integer, integer) from public, anon, authenticated;
grant execute on function public.anonimizar_conductor_hitos(integer, integer) to service_role;

create or replace function public.purgar_conductor_auditoria(
  p_dias integer default 365, p_limite integer default 5000
) returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_a integer; v_e integer;
begin
  if p_dias is null or p_dias < 30 or p_limite is null or p_limite < 1 then
    raise exception 'parámetros de retención inválidos';
  end if;
  with viejos as (
    select id from public.viaje_hito_aviso
     where created_at < now() - make_interval(days => p_dias) order by created_at limit p_limite
  ) delete from public.viaje_hito_aviso a using viejos v where a.id = v.id;
  get diagnostics v_a = row_count;
  with viejos as (
    select id from public.viaje_hito_evento
     where created_at < now() - make_interval(days => p_dias) order by id limit p_limite
  ) delete from public.viaje_hito_evento e using viejos v where e.id = v.id;
  get diagnostics v_e = row_count;
  return v_a + v_e;
end $$;
revoke all on function public.purgar_conductor_auditoria(integer, integer) from public, anon, authenticated;
grant execute on function public.purgar_conductor_auditoria(integer, integer) to service_role;

-- ── 12. El rol de modelo del clasificador de hitos ──────────────────────────
-- `agente_definicion_modelo_rol_dominio` espeja `ModelRole` (0311): se enumera
-- ENTERO, con `conductor_hito` de más. agente_definicion_modelo_rol_dominio.test.ts
-- cruza las dos listas.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'agente_definicion_modelo_rol_dominio' and conrelid = 'public.agente_definicion'::regclass
  ) then
    alter table public.agente_definicion drop constraint agente_definicion_modelo_rol_dominio;
  end if;
  alter table public.agente_definicion
    add constraint agente_definicion_modelo_rol_dominio check (modelo_rol is null or modelo_rol in
      ('ocr', 'cuadre', 'cuadre_fallback', 'chat', 'back_office', 'analisis',
       'extraccion', 'marketing', 'codigo', 'codigo_escritura', 'qa',
       'piloto', 'transcripcion', 'contador', 'conductor_hito'));
end $$;

-- ── 13. El latido del cron `conductor-hitos` ────────────────────────────────
-- El dominio de `cron_latido` se enumera ENTERO cada vez (lección de la
-- 0227/0241/0248). Espejo de CRONS en `lib/admin/salud.ts`.
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
      'liquidaciones-externas',
      'peajes',
      'conductor-hitos'
    ));
end $$;

comment on constraint cron_latido_id_dominio on public.cron_latido is
  'El catálogo COMPLETO de ids de cron, espejo de CRONS en lib/admin/salud.ts. Se enumera entero al tocarlo: una lista corta no falla ruidosamente, silencia el latido de los crons que faltan. La 0380 añade conductor-hitos.';
