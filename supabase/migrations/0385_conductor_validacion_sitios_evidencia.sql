-- ═══════════════════════════════════════════════════════════════════════════
-- 0385 — AGENTE 5 «CONDUCTOR», segunda entrega: sitios, validación contra la
-- ubicación, evidencia por hito, estadías en andén y tablero.
--
-- La 0380 dejó el hito en `recibido` y dijo que `validado` «solo se alcanza por
-- oficina o sistema». Esta migración le da con qué:
--
-- 1. CATÁLOGO DE SITIOS = `geocerca` (0050). Hoy ningún código la escribe (CLAUDE.md:
--    «Siguen SIN escritor: geocerca»). Se AMPLÍA en vez de crear otra tabla: los
--    lectores de estadías (0207) y peajes ya apuntan a ella. Tipos nuevos
--    `cliente`, `planta` y `anden`, código del sitio en el sistema del cliente,
--    dirección, cliente dueño y padre (el andén cuelga de la planta). NINGUNA
--    coordenada se inventa: la fila nace de un CSV o de una captura humana y lo
--    dice en `fuente`.
-- 2. QUÉ SITIO ESPERA CADA HITO: `viaje.origen_geocerca_id` (carga) y
--    `viaje.destino_geocerca_id` (descarga). Sin sitio asignado el hito NO se
--    puede validar y el veredicto dice «sin dato», no «no coincide».
-- 3. EL VEREDICTO: `viaje_hito_validacion`, uno por (hito, ciclo): `validado`,
--    `sin_coincidencia` o `sin_dato`. Sin coordenadas guardadas aparte (las del
--    pin ya viven en `viaje_hito.lat/lng`, que la cancelación ARCO borra). Un
--    veredicto solo MEJORA (sin_dato → sin_coincidencia → validado): una
--    posición posterior y lejana no desdice una evidencia positiva.
-- 4. EVIDENCIA OPCIONAL POR HITO: `viaje_hito_evidencia` (foto del sello, del
--    andén, del sello de recibido). El archivo vive en el bucket `comprobantes`
--    (mismo pipeline que el POD); aquí solo la ruta y su huella. Retención y
--    cancelación ARCO MARCAN el archivo en la cola de borrado de Storage (0165) y
--    desligan la ruta; el borrado real lo hace el servidor por la API.
-- 5. ACCIONES DE OFICINA con bitácora: capturar un hito a mano, validarlo y
--    marcar atendida una escalación. Cada una exige motivo y deja quién y cuándo
--    (`conductor_accion_oficina`, append-only) en la MISMA transacción.
-- 6. INDICADORES del tablero agregados en SQL (`conductor_indicadores`): a 250
--    camiones los hitos de una semana no viajan a la app para sumarlos.
--
-- Lo escribe el servidor (service_role). Lectura: `ve_operacion()` (dueño,
-- encargado, superadmin; el contador no), como la 0380.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. El catálogo de sitios (extiende `geocerca`) ──────────────────────────
alter table public.geocerca drop constraint if exists geocerca_tipo_dominio;
alter table public.geocerca add constraint geocerca_tipo_dominio check (tipo in
  ('origen', 'destino', 'patio', 'punto_interes', 'restringida', 'cliente', 'planta', 'anden'));

alter table public.geocerca
  add column if not exists codigo text,
  add column if not exists direccion text,
  add column if not exists cliente_id uuid,
  add column if not exists padre_id uuid,
  add column if not exists fuente text not null default 'manual';

alter table public.geocerca drop constraint if exists geocerca_codigo_forma;
alter table public.geocerca add constraint geocerca_codigo_forma
  check (codigo is null or (codigo = btrim(codigo) and char_length(codigo) between 1 and 40));
alter table public.geocerca drop constraint if exists geocerca_direccion_larga;
alter table public.geocerca add constraint geocerca_direccion_larga
  check (direccion is null or char_length(direccion) <= 200);
alter table public.geocerca drop constraint if exists geocerca_fuente_dominio;
alter table public.geocerca add constraint geocerca_fuente_dominio check (fuente in ('manual', 'csv'));
alter table public.geocerca drop constraint if exists geocerca_padre_distinto;
alter table public.geocerca add constraint geocerca_padre_distinto check (padre_id is null or padre_id <> id);

-- Un código por flota: es la llave con la que el cliente identifica su sitio y la
-- que hace idempotente re-importar el mismo CSV.
create unique index if not exists geocerca_codigo_unico on public.geocerca (tenant_id, codigo) where codigo is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'geocerca_cliente_tenant_fkey' and conrelid = 'public.geocerca'::regclass) then
    alter table public.geocerca add constraint geocerca_cliente_tenant_fkey
      foreign key (cliente_id, tenant_id) references public.cliente (id, tenant_id) on delete set null (cliente_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'geocerca_padre_tenant_fkey' and conrelid = 'public.geocerca'::regclass) then
    alter table public.geocerca add constraint geocerca_padre_tenant_fkey
      foreign key (padre_id, tenant_id) references public.geocerca (id, tenant_id) on delete set null (padre_id);
  end if;
end $$;

comment on column public.geocerca.codigo is
  '0385: código del sitio en el sistema del cliente. Único por flota; es la llave de re-importación del CSV.';
comment on column public.geocerca.fuente is
  '0385: quién puso las coordenadas: manual (captura humana en el panel) o csv (importación de un archivo del cliente). Nunca se geocodifica ni se inventa.';
comment on column public.geocerca.padre_id is
  '0385: el sitio que contiene a este (un andén cuelga de su planta).';

-- ── 2. Qué sitio espera cada viaje ──────────────────────────────────────────
alter table public.viaje
  add column if not exists origen_geocerca_id uuid,
  add column if not exists destino_geocerca_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'viaje_origen_geocerca_tenant_fkey' and conrelid = 'public.viaje'::regclass) then
    alter table public.viaje add constraint viaje_origen_geocerca_tenant_fkey
      foreign key (origen_geocerca_id, tenant_id) references public.geocerca (id, tenant_id) on delete set null (origen_geocerca_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'viaje_destino_geocerca_tenant_fkey' and conrelid = 'public.viaje'::regclass) then
    alter table public.viaje add constraint viaje_destino_geocerca_tenant_fkey
      foreign key (destino_geocerca_id, tenant_id) references public.geocerca (id, tenant_id) on delete set null (destino_geocerca_id);
  end if;
end $$;

comment on column public.viaje.origen_geocerca_id is
  '0385: el sitio donde SE CARGA (contra el que se valida la llegada a carga). NULL = sin sitio asignado: el hito se queda «sin dato», no «no coincide».';
comment on column public.viaje.destino_geocerca_id is
  '0385: el sitio donde SE DESCARGA (contra el que se valida la llegada a descarga). NULL = sin sitio asignado.';

-- ── 3. Perillas de la flota ─────────────────────────────────────────────────
alter table public.agente_conductor_config
  add column if not exists validar_ubicacion boolean not null default true,
  -- Margen que se SUMA al radio del sitio: el pin y el GPS civil no son exactos.
  add column if not exists tolerancia_ubicacion_m integer not null default 150,
  -- Máxima diferencia entre la hora del mensaje y la de la posición que se compara.
  add column if not exists ventana_ubicacion_min smallint not null default 30,
  add column if not exists pedir_ubicacion boolean not null default true,
  -- Alerta por exceso de estadía en andén (minutos desde la llegada). NULL = sin alerta.
  add column if not exists estadia_alerta_carga_min integer,
  add column if not exists estadia_alerta_descarga_min integer,
  add column if not exists pedir_foto_evidencia boolean not null default false;

alter table public.agente_conductor_config drop constraint if exists conductor_config_validacion;
alter table public.agente_conductor_config add constraint conductor_config_validacion check (
  tolerancia_ubicacion_m between 0 and 5000
  and ventana_ubicacion_min between 5 and 180
  and (estadia_alerta_carga_min is null or estadia_alerta_carga_min between 15 and 4320)
  and (estadia_alerta_descarga_min is null or estadia_alerta_descarga_min between 15 and 4320)
);
comment on column public.agente_conductor_config.tolerancia_ubicacion_m is
  '0385: metros que se suman al radio del sitio antes de decir «no coincide». SUPUESTO por defecto (150 m), no una medición: la flota lo ajusta.';

-- ── 4. Dominios que se amplían (se enumeran ENTEROS, lección de la 0227) ────
alter table public.viaje_hito drop constraint if exists viaje_hito_fuente_dominio;
alter table public.viaje_hito add constraint viaje_hito_fuente_dominio check (fuente is null or fuente in
  ('texto', 'boton', 'ubicacion', 'foto', 'sistema', 'oficina'));

alter table public.viaje_hito_aviso drop constraint if exists viaje_hito_aviso_clase_dominio;
alter table public.viaje_hito_aviso add constraint viaje_hito_aviso_clase_dominio check (clase in
  ('solicitud', 'recordatorio', 'escalacion', 'confirmacion', 'aviso_oficina', 'ubicacion', 'alerta_estadia'));

alter table public.viaje_hito_evento drop constraint if exists viaje_hito_evento_dominio;
alter table public.viaje_hito_evento add constraint viaje_hito_evento_dominio check (evento in
  ('solicitado', 'recibido', 'validado', 'omitido', 'escalado', 'corregido', 'pospuesto', 'atendido', 'contacto',
   'validacion', 'evidencia', 'captura_manual', 'alerta_estadia'));

-- ── 5. El veredicto de la validación ────────────────────────────────────────
create table if not exists public.viaje_hito_validacion (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  viaje_id uuid not null,
  viaje_hito_id uuid not null,
  ciclo smallint not null,
  resultado text not null,
  -- Por qué NO hay dato (resultado = sin_dato): sin_sitio, sin_ubicacion, ubicacion_fuera_de_ventana, coordenadas_invalidas.
  motivo text,
  fuente text,
  distancia_m integer,
  tolerancia_m integer not null,
  radio_m integer,
  sitio_id uuid,
  -- La hora de la posición comparada (no la del mensaje).
  medida_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint viaje_hito_validacion_unico unique (viaje_hito_id, ciclo),
  constraint viaje_hito_validacion_hito_fkey
    foreign key (viaje_hito_id, tenant_id) references public.viaje_hito (id, tenant_id) on delete cascade,
  constraint viaje_hito_validacion_sitio_fkey
    foreign key (sitio_id, tenant_id) references public.geocerca (id, tenant_id) on delete set null (sitio_id),
  constraint viaje_hito_validacion_resultado check (resultado in ('validado', 'sin_coincidencia', 'sin_dato')),
  constraint viaje_hito_validacion_fuente check (fuente is null or fuente in ('pin', 'gps')),
  constraint viaje_hito_validacion_motivo check (
    (resultado = 'sin_dato') = (motivo is not null)
    and (motivo is null or motivo in ('sin_sitio', 'sin_ubicacion', 'ubicacion_fuera_de_ventana', 'coordenadas_invalidas'))
  ),
  -- Un veredicto de coincidencia no puede salir sin medir: trae distancia y de dónde salió la posición.
  -- (sitio_id puede quedar NULL si la flota borra el sitio después: la FK es `set null`.)
  constraint viaje_hito_validacion_medido check (
    (resultado = 'sin_dato' and distancia_m is null)
    or (resultado <> 'sin_dato' and distancia_m is not null and fuente is not null)
  ),
  constraint viaje_hito_validacion_numeros check (
    (distancia_m is null or distancia_m >= 0) and tolerancia_m between 0 and 5000 and (radio_m is null or radio_m between 25 and 100000)
  )
);
comment on table public.viaje_hito_validacion is
  '0385: el veredicto de validar un hito contra la ubicación (pin de WhatsApp o GPS): validado / sin_coincidencia / sin_dato. Uno por (hito, ciclo); solo MEJORA. Sin coordenadas: las del pin viven en viaje_hito (que ARCO anonimiza). «sin_coincidencia» NO acusa al chofer: dice que la posición comparada no cae en el sitio registrado.';
create index if not exists viaje_hito_validacion_tenant_idx on public.viaje_hito_validacion (tenant_id, resultado, updated_at desc);
create index if not exists viaje_hito_validacion_viaje_idx on public.viaje_hito_validacion (viaje_id);

-- ── 6. La evidencia por hito ────────────────────────────────────────────────
create table if not exists public.viaje_hito_evidencia (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  viaje_id uuid not null,
  viaje_hito_id uuid not null,
  ciclo smallint not null,
  tipo text not null,
  -- Ruta en el bucket `comprobantes`. NULL = purgada (retención o ARCO).
  ruta text,
  sha256 text not null,
  wa_message_id text,
  created_at timestamptz not null default now(),
  purgada_en timestamptz,
  constraint viaje_hito_evidencia_hito_fkey
    foreign key (viaje_hito_id, tenant_id) references public.viaje_hito (id, tenant_id) on delete cascade,
  constraint viaje_hito_evidencia_tipo check (tipo in ('sello', 'anden', 'recibido', 'otra')),
  constraint viaje_hito_evidencia_ruta check ((ruta is null) = (purgada_en is not null) and (ruta is null or char_length(ruta) <= 300)),
  constraint viaje_hito_evidencia_sha check (sha256 ~ '^[0-9a-f]{16,64}$'),
  constraint viaje_hito_evidencia_unica unique (viaje_hito_id, ciclo, sha256)
);
-- Un mensaje de WhatsApp aporta a lo más UNA evidencia: la red durable contra el reintento del webhook.
create unique index if not exists viaje_hito_evidencia_mensaje_unico
  on public.viaje_hito_evidencia (tenant_id, wa_message_id) where wa_message_id is not null;
create index if not exists viaje_hito_evidencia_viaje_idx on public.viaje_hito_evidencia (tenant_id, viaje_id);
create index if not exists viaje_hito_evidencia_retencion_idx on public.viaje_hito_evidencia (created_at) where ruta is not null;
comment on table public.viaje_hito_evidencia is
  '0385: foto de evidencia de un hito (sello, andén, sello de recibido). El archivo vive en el bucket comprobantes; aquí la ruta y su huella. Retención y ARCO desligan la ruta y encolan el archivo en storage_huerfano_candidato.';

-- ── 7. Las acciones de la oficina, con bitácora ─────────────────────────────
create table if not exists public.conductor_accion_oficina (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  viaje_id uuid not null,
  viaje_hito_id uuid not null,
  accion text not null,
  usuario_id uuid,
  -- Congelado: la firma no puede depender de que la cuenta siga existiendo (misma lección que jornada).
  usuario_email text not null,
  motivo text not null,
  -- Solo captura manual: la hora que la oficina declara para el hito.
  hora_declarada timestamptz,
  created_at timestamptz not null default now(),
  constraint conductor_accion_hito_fkey
    foreign key (viaje_hito_id, tenant_id) references public.viaje_hito (id, tenant_id) on delete cascade,
  constraint conductor_accion_dominio check (accion in ('captura_manual', 'validar', 'atender')),
  constraint conductor_accion_motivo check (char_length(btrim(motivo)) between 5 and 200),
  constraint conductor_accion_email check (char_length(usuario_email) between 3 and 200),
  constraint conductor_accion_hora check ((accion = 'captura_manual') = (hora_declarada is not null))
);
comment on table public.conductor_accion_oficina is
  '0385: bitácora append-only de lo que la OFICINA hace sobre un hito (capturarlo a mano, validarlo, marcar atendida su escalación): quién, cuándo y por qué. Se escribe en la misma transacción que el cambio.';
create index if not exists conductor_accion_tenant_idx on public.conductor_accion_oficina (tenant_id, id desc);
create index if not exists conductor_accion_hito_idx on public.conductor_accion_oficina (viaje_hito_id);

-- ── 8. RLS ──────────────────────────────────────────────────────────────────
alter table public.viaje_hito_validacion enable row level security;
alter table public.viaje_hito_evidencia enable row level security;
alter table public.conductor_accion_oficina enable row level security;

do $$
declare t text;
begin
  foreach t in array array['viaje_hito_validacion', 'viaje_hito_evidencia', 'conductor_accion_oficina']
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
-- La bitácora de acciones es append-only también para quien escribe por servidor.
revoke update, delete on table public.conductor_accion_oficina from service_role;
grant usage, select on sequence public.conductor_accion_oficina_id_seq to service_role;

-- ── 9. Aplicar un veredicto (atómico, solo mejora) ──────────────────────────
-- Devuelve: 'nuevo' | 'mejorado' | 'igual' | 'hito_cambio' (el hito ya no está recibido en ese ciclo:
-- se corrigió o retiró mientras se medía — no se escribe un veredicto sobre otra cosa).
create or replace function public.aplicar_validacion_hito(
  p_tenant uuid, p_hito uuid, p_ciclo smallint, p_resultado text, p_motivo text, p_fuente text,
  p_distancia integer, p_tolerancia integer, p_radio integer, p_sitio uuid, p_medida_en timestamptz, p_ahora timestamptz default now()
) returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  h public.viaje_hito%rowtype;
  v public.viaje_hito_validacion%rowtype;
  rango_nuevo integer;
  rango_viejo integer;
  salida text;
begin
  if p_resultado not in ('validado', 'sin_coincidencia', 'sin_dato') then raise exception 'resultado inválido'; end if;
  select * into h from public.viaje_hito
   where id = p_hito and tenant_id = p_tenant and ciclo = p_ciclo and estado in ('recibido', 'validado')
   for update;
  if not found then return 'hito_cambio'; end if;

  rango_nuevo := case p_resultado when 'validado' then 3 when 'sin_coincidencia' then 2 else 1 end;
  select * into v from public.viaje_hito_validacion where viaje_hito_id = p_hito and ciclo = p_ciclo for update;
  if not found then
    insert into public.viaje_hito_validacion (tenant_id, viaje_id, viaje_hito_id, ciclo, resultado, motivo, fuente, distancia_m,
                                              tolerancia_m, radio_m, sitio_id, medida_en, created_at, updated_at)
    values (p_tenant, h.viaje_id, p_hito, p_ciclo, p_resultado, p_motivo, p_fuente, p_distancia, p_tolerancia, p_radio, p_sitio,
            p_medida_en, p_ahora, p_ahora);
    salida := 'nuevo';
  else
    rango_viejo := case v.resultado when 'validado' then 3 when 'sin_coincidencia' then 2 else 1 end;
    if rango_nuevo <= rango_viejo then return 'igual'; end if;
    update public.viaje_hito_validacion
       set resultado = p_resultado, motivo = p_motivo, fuente = p_fuente, distancia_m = p_distancia, tolerancia_m = p_tolerancia,
           radio_m = p_radio, sitio_id = p_sitio, medida_en = p_medida_en, updated_at = p_ahora
     where id = v.id;
    salida := 'mejorado';
  end if;

  if p_resultado = 'validado' and h.estado = 'recibido' then
    update public.viaje_hito
       set estado = 'validado', validado_en = p_ahora, validado_por = 'gps', updated_at = p_ahora
     where id = h.id and tenant_id = p_tenant;
    insert into public.viaje_hito_evento (tenant_id, viaje_id, viaje_hito_id, tipo_hito, evento, detalle)
    values (p_tenant, h.viaje_id, h.id, h.tipo, 'validado', jsonb_build_object('por', 'gps', 'fuente', p_fuente, 'distancia_m', p_distancia));
  else
    insert into public.viaje_hito_evento (tenant_id, viaje_id, viaje_hito_id, tipo_hito, evento, detalle)
    values (p_tenant, h.viaje_id, h.id, h.tipo, 'validacion',
            jsonb_build_object('resultado', p_resultado, 'motivo', p_motivo, 'fuente', p_fuente, 'distancia_m', p_distancia));
  end if;
  return salida;
end $$;
revoke all on function public.aplicar_validacion_hito(uuid, uuid, smallint, text, text, text, integer, integer, integer, uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.aplicar_validacion_hito(uuid, uuid, smallint, text, text, text, integer, integer, integer, uuid, timestamptz, timestamptz) to service_role;

-- ── 10. Acciones de la oficina (hito + bitácora en UNA transacción) ─────────
-- Capturar a mano: el jefe declara la hora del hito (no puede ser futura ni anterior a la aceptación del
-- viaje) y el motivo. Los hitos anteriores todavía pendientes pasan a `omitido`, igual que cuando el chofer
-- avisa fuera de orden. Devuelve 'ok' | 'hito_cambio' (ya estaba recibido/validado) | 'hora_invalida'.
create or replace function public.capturar_hito_oficina(
  p_tenant uuid, p_hito uuid, p_hora timestamptz, p_usuario uuid, p_email text, p_motivo text, p_ahora timestamptz default now()
) returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  h public.viaje_hito%rowtype;
  aceptado timestamptz;
  idx integer;
begin
  select * into h from public.viaje_hito
   where id = p_hito and tenant_id = p_tenant and estado in ('esperado', 'escalado', 'omitido') for update;
  if not found then return 'hito_cambio'; end if;
  select v.aceptado_en into aceptado from public.viaje v where v.id = h.viaje_id and v.tenant_id = p_tenant;
  if p_hora is null or p_hora > p_ahora + interval '5 minutes' or (aceptado is not null and p_hora < aceptado) then
    return 'hora_invalida';
  end if;

  update public.viaje_hito
     set estado = 'recibido', fuente = 'oficina', interpretacion = 'sistema', confianza = null, wa_message_id = null,
         mensaje_en = p_hora, recibido_en = p_ahora, texto_chofer = null, sin_contacto = false, omitido_motivo = null,
         pospuesto_hasta = null, updated_at = p_ahora
   where id = h.id and tenant_id = p_tenant;

  idx := array_position(array['llegada_carga', 'salida_carga', 'llegada_descarga', 'salida_descarga', 'regreso'], h.tipo);
  update public.viaje_hito x
     set estado = 'omitido', omitido_motivo = 'inferido_por_' || h.tipo, updated_at = p_ahora
   where x.viaje_id = h.viaje_id and x.tenant_id = p_tenant and x.estado in ('esperado', 'escalado')
     and array_position(array['llegada_carga', 'salida_carga', 'llegada_descarga', 'salida_descarga', 'regreso'], x.tipo) < idx;

  insert into public.conductor_accion_oficina (tenant_id, viaje_id, viaje_hito_id, accion, usuario_id, usuario_email, motivo, hora_declarada)
  values (p_tenant, h.viaje_id, h.id, 'captura_manual', p_usuario, p_email, btrim(p_motivo), p_hora);
  insert into public.viaje_hito_evento (tenant_id, viaje_id, viaje_hito_id, tipo_hito, evento, detalle)
  values (p_tenant, h.viaje_id, h.id, h.tipo, 'captura_manual', jsonb_build_object('fuente', 'oficina'));
  return 'ok';
end $$;
revoke all on function public.capturar_hito_oficina(uuid, uuid, timestamptz, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.capturar_hito_oficina(uuid, uuid, timestamptz, uuid, text, text, timestamptz) to service_role;

-- Validar por oficina: recibido → validado (validado_por = oficina). 'ok' | 'hito_cambio'.
create or replace function public.validar_hito_oficina(
  p_tenant uuid, p_hito uuid, p_usuario uuid, p_email text, p_motivo text, p_ahora timestamptz default now()
) returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare h public.viaje_hito%rowtype;
begin
  select * into h from public.viaje_hito where id = p_hito and tenant_id = p_tenant and estado = 'recibido' for update;
  if not found then return 'hito_cambio'; end if;
  update public.viaje_hito set estado = 'validado', validado_en = p_ahora, validado_por = 'oficina', updated_at = p_ahora
   where id = h.id and tenant_id = p_tenant;
  insert into public.conductor_accion_oficina (tenant_id, viaje_id, viaje_hito_id, accion, usuario_id, usuario_email, motivo)
  values (p_tenant, h.viaje_id, h.id, 'validar', p_usuario, p_email, btrim(p_motivo));
  insert into public.viaje_hito_evento (tenant_id, viaje_id, viaje_hito_id, tipo_hito, evento, detalle)
  values (p_tenant, h.viaje_id, h.id, h.tipo, 'validado', jsonb_build_object('por', 'oficina'));
  return 'ok';
end $$;
revoke all on function public.validar_hito_oficina(uuid, uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.validar_hito_oficina(uuid, uuid, uuid, text, text, timestamptz) to service_role;

-- Marcar atendida una escalación desde el tablero (el botón «Ya lo atiendo» del WhatsApp ya existía).
-- Devuelve cuántos hitos del viaje se marcaron (0 = ya estaba atendido o el chofer ya contestó).
create or replace function public.atender_escalacion_oficina(
  p_tenant uuid, p_viaje uuid, p_usuario uuid, p_email text, p_motivo text, p_ahora timestamptz default now()
) returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare n integer := 0; r record;
begin
  for r in
    update public.viaje_hito
       set escalacion_atendida_en = p_ahora, updated_at = p_ahora
     where tenant_id = p_tenant and viaje_id = p_viaje and estado = 'escalado' and escalacion_atendida_en is null
    returning id, tipo
  loop
    n := n + 1;
    insert into public.conductor_accion_oficina (tenant_id, viaje_id, viaje_hito_id, accion, usuario_id, usuario_email, motivo)
    values (p_tenant, p_viaje, r.id, 'atender', p_usuario, p_email, btrim(p_motivo));
    insert into public.viaje_hito_evento (tenant_id, viaje_id, viaje_hito_id, tipo_hito, evento, detalle)
    values (p_tenant, p_viaje, r.id, r.tipo, 'atendido', jsonb_build_object('por', 'oficina'));
  end loop;
  return n;
end $$;
revoke all on function public.atender_escalacion_oficina(uuid, uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.atender_escalacion_oficina(uuid, uuid, uuid, text, text, timestamptz) to service_role;

-- ── 11. Indicadores del tablero (agregados en SQL) ──────────────────────────
-- «Sin insistencia» = hito resuelto con a lo más UN mensaje al chofer en el ciclo vigente (la solicitud) y
-- sin escalar. «Tiempo de respuesta» = recibido_en − solicitado_en, solo donde el agente sí pidió el hito
-- (un aviso espontáneo no tiene tiempo de respuesta). Los filtros son opcionales.
create or replace function public.conductor_indicadores(
  p_tenant uuid, p_desde timestamptz, p_hasta timestamptz,
  p_terminal uuid default null, p_cliente uuid default null, p_operador uuid default null
) returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'recibidos', count(*) filter (where h.estado in ('recibido', 'validado')),
    'sin_insistencia', count(*) filter (where h.estado in ('recibido', 'validado') and h.recordatorios_enviados <= 1 and h.escalado_en is null),
    'con_respuesta_medida', count(*) filter (where h.estado in ('recibido', 'validado') and h.solicitado_en is not null and h.recibido_en >= h.solicitado_en),
    'minutos_respuesta_promedio', round((avg(extract(epoch from (h.recibido_en - h.solicitado_en)) / 60.0)
        filter (where h.estado in ('recibido', 'validado') and h.solicitado_en is not null and h.recibido_en >= h.solicitado_en))::numeric, 1),
    'escalados', count(*) filter (where h.escalado_en is not null),
    'omitidos', count(*) filter (where h.estado = 'omitido'),
    'validados_ubicacion', count(*) filter (where val.resultado = 'validado'),
    'sin_coincidencia', count(*) filter (where val.resultado = 'sin_coincidencia'),
    'capturados_oficina', count(*) filter (where h.fuente = 'oficina')
  )
  from public.viaje_hito h
  join public.viaje v on v.id = h.viaje_id and v.tenant_id = h.tenant_id
  left join public.viaje_hito_validacion val on val.viaje_hito_id = h.id and val.ciclo = h.ciclo
  where h.tenant_id = p_tenant
    and h.updated_at >= p_desde and h.updated_at < p_hasta
    and (p_terminal is null or v.terminal_id = p_terminal)
    and (p_cliente is null or v.cliente_id = p_cliente)
    and (p_operador is null or v.operador_id = p_operador)
$$;
revoke all on function public.conductor_indicadores(uuid, timestamptz, timestamptz, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.conductor_indicadores(uuid, timestamptz, timestamptz, uuid, uuid, uuid) to service_role;

-- ── 12. Retención y cancelación ARCO de la evidencia ────────────────────────
-- El archivo se ENCOLA para borrarlo por la Storage API (Supabase prohíbe `delete from storage.objects`
-- desde SQL, 0165) y la ruta se desliga. Plazo PROPUESTO de 365 días (mínimo 30): lo fija el aviso de
-- privacidad de cada flota, no esta migración.
create or replace function public.purgar_conductor_evidencia(
  p_dias integer default 365, p_limite integer default 2000
) returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_n integer;
begin
  if p_dias is null or p_dias < 30 or p_limite is null or p_limite < 1 then
    raise exception 'parámetros de retención inválidos';
  end if;
  with viejas as (
    select id, tenant_id, viaje_hito_id, ruta from public.viaje_hito_evidencia
     where ruta is not null and created_at < now() - make_interval(days => p_dias)
     order by created_at limit p_limite for update
  ), encoladas as (
    insert into public.storage_huerfano_candidato (bucket, nombre, motivo)
    select 'comprobantes', ruta, 'retencion_conductor' from viejas
    on conflict (bucket, nombre) do nothing
    returning nombre
  ), desligadas as (
    -- La ruta legada en el hito se desliga junto con la evidencia.
    update public.viaje_hito h set evidencia_ruta = null
      from viejas v where h.id = v.viaje_hito_id and h.tenant_id = v.tenant_id
    returning h.id
  )
  update public.viaje_hito_evidencia e set ruta = null, purgada_en = now()
    from viejas v where e.id = v.id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.purgar_conductor_evidencia(integer, integer) from public, anon, authenticated;
grant execute on function public.purgar_conductor_evidencia(integer, integer) to service_role;

create or replace function public.conductor_anonimizar_evidencia_por_arco()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if old.anonimizado_en is null and new.anonimizado_en is not null then
    insert into public.storage_huerfano_candidato (bucket, nombre, motivo)
    select 'comprobantes', e.ruta, 'arco'
      from public.viaje_hito_evidencia e
      join public.viaje v on v.id = e.viaje_id and v.tenant_id = e.tenant_id
     where e.tenant_id = new.tenant_id and v.operador_id = new.id and e.ruta is not null
    on conflict (bucket, nombre) do nothing;
    update public.viaje_hito_evidencia e set ruta = null, purgada_en = now()
      from public.viaje v
     where v.id = e.viaje_id and v.tenant_id = e.tenant_id
       and e.tenant_id = new.tenant_id and v.operador_id = new.id and e.ruta is not null;
  end if;
  return new;
end $$;
revoke all on function public.conductor_anonimizar_evidencia_por_arco() from public, anon, authenticated;
drop trigger if exists conductor_anonimizar_evidencia_por_arco on public.operador;
create trigger conductor_anonimizar_evidencia_por_arco
  after update of anonimizado_en on public.operador
  for each row execute function public.conductor_anonimizar_evidencia_por_arco();

-- ── 13. Importar el catálogo de sitios (todo o nada) ────────────────────────
-- Entra el CSV ya parseado por src/lib/likida/conductor/sitios.ts (formas, rangos, caja de México). Aquí se
-- revisa lo que SOLO la base sabe —el cliente existe, el padre existe, el nombre no pisa a otro sitio— y,
-- si hay UN error, no se escribe nada: un catálogo a medias deja viajes validados contra el sitio equivocado.
-- Re-importar el mismo archivo es idempotente (la llave es el código). Una fila de la importación gana sobre una
-- captura manual del mismo código. Devuelve {ok, creados, actualizados} o {ok:false, errores:[{linea, mensaje}]}.
create or replace function public.importar_sitios_conductor(p_tenant uuid, p_filas jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  f jsonb;
  errores jsonb := '[]'::jsonb;
  creados integer := 0;
  actualizados integer := 0;
  v_id uuid;
  v_cliente uuid;
  v_padre uuid;
  v_linea integer;
  v_codigo text;
  v_nombre text;
  existe_nombre record;
begin
  if p_tenant is null or p_filas is null or jsonb_typeof(p_filas) <> 'array' then raise exception 'importar_sitios: entrada inválida'; end if;
  if jsonb_array_length(p_filas) = 0 or jsonb_array_length(p_filas) > 2000 then raise exception 'importar_sitios: entre 1 y 2000 filas'; end if;

  -- Pasada 1: revisar sin escribir.
  for f in select * from jsonb_array_elements(p_filas) loop
    v_linea := (f->>'linea')::integer;
    v_codigo := nullif(btrim(f->>'codigo'), '');
    v_nombre := btrim(f->>'nombre');
    if nullif(btrim(f->>'cliente'), '') is not null
       and not exists (select 1 from public.cliente c where c.tenant_id = p_tenant and lower(c.nombre) = lower(btrim(f->>'cliente'))) then
      errores := errores || jsonb_build_object('linea', v_linea, 'mensaje', 'El cliente «' || btrim(f->>'cliente') || '» no existe en tu catálogo de clientes.');
    end if;
    if nullif(btrim(f->>'padre'), '') is not null
       and not exists (select 1 from jsonb_array_elements(p_filas) x where nullif(btrim(x->>'codigo'), '') = btrim(f->>'padre'))
       and not exists (select 1 from public.geocerca g where g.tenant_id = p_tenant and g.codigo = btrim(f->>'padre')) then
      errores := errores || jsonb_build_object('linea', v_linea, 'mensaje', 'El sitio padre «' || btrim(f->>'padre') || '» no está en el archivo ni en tu catálogo.');
    end if;
    select g.id, g.codigo into existe_nombre from public.geocerca g
     where g.tenant_id = p_tenant and g.nombre = v_nombre and g.codigo is distinct from v_codigo limit 1;
    if found then
      errores := errores || jsonb_build_object('linea', v_linea, 'mensaje', 'Ya existe un sitio llamado «' || v_nombre || '» con otro código; cámbiale el nombre o el código.');
    end if;
  end loop;
  if jsonb_array_length(errores) > 0 then
    return jsonb_build_object('ok', false, 'errores', errores);
  end if;

  -- Pasada 2: escribir (upsert por código).
  for f in select * from jsonb_array_elements(p_filas) loop
    v_codigo := btrim(f->>'codigo');
    v_cliente := null;
    if nullif(btrim(f->>'cliente'), '') is not null then
      select c.id into v_cliente from public.cliente c where c.tenant_id = p_tenant and lower(c.nombre) = lower(btrim(f->>'cliente')) limit 1;
    end if;
    select g.id into v_id from public.geocerca g where g.tenant_id = p_tenant and g.codigo = v_codigo;
    if v_id is null then
      insert into public.geocerca (tenant_id, nombre, tipo, lat, lng, radio_m, codigo, direccion, cliente_id, fuente)
      values (p_tenant, btrim(f->>'nombre'), f->>'tipo', (f->>'lat')::double precision, (f->>'lng')::double precision,
              (f->>'radio_m')::integer, v_codigo, nullif(btrim(f->>'direccion'), ''), v_cliente, 'csv');
      creados := creados + 1;
    else
      update public.geocerca
         set nombre = btrim(f->>'nombre'), tipo = f->>'tipo', lat = (f->>'lat')::double precision, lng = (f->>'lng')::double precision,
             radio_m = (f->>'radio_m')::integer, direccion = nullif(btrim(f->>'direccion'), ''), cliente_id = v_cliente, fuente = 'csv', activa = true
       where id = v_id and tenant_id = p_tenant;
      actualizados := actualizados + 1;
    end if;
  end loop;
  -- Padres: una vez que todos existen.
  for f in select * from jsonb_array_elements(p_filas) loop
    v_codigo := btrim(f->>'codigo');
    v_padre := null;
    if nullif(btrim(f->>'padre'), '') is not null then
      select g.id into v_padre from public.geocerca g where g.tenant_id = p_tenant and g.codigo = btrim(f->>'padre');
    end if;
    update public.geocerca set padre_id = v_padre where tenant_id = p_tenant and codigo = v_codigo;
  end loop;
  return jsonb_build_object('ok', true, 'creados', creados, 'actualizados', actualizados);
end $$;
revoke all on function public.importar_sitios_conductor(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.importar_sitios_conductor(uuid, jsonb) to service_role;
