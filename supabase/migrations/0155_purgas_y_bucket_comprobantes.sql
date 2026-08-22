-- ═══════════════════════════════════════════════════════════════════════════
-- 0155 — Purgas que faltaban, purga EN TANDAS, ventana por defecto del costo
-- de IA, candados del bucket `comprobantes` y el latido de los crons.
--
-- Auditoría prod "qué tira producción" (22-ago-2026), hallazgos:
--
--   ESC-2 / RES-14 · `wa_evento_pendiente` recibe una fila por CADA mensaje
--     del webhook y nunca se purgaba (4-10 GB/año, y es dato personal: el
--     texto del chofer viaja en `evento`). Se purga lo procesado a los 30 días
--     y las cartas muertas (al tope de intentos) a los 90 — nunca antes de que
--     el operador haya tenido tres meses de alertas diarias para mirarlas.
--     Índice parcial sobre `procesado_en is not null` para que la purga entre
--     por índice y no barra la tabla.
--   ESC-10 · `llm_costo` (200k filas/mes) no se purgaba y `resumen_costo_ia`
--     sumaba TODA la historia en cada carga de /admin. Se purga lo mayor a 13
--     meses (el consolidado mensual de la 0072 ya tiene ese mes cerrado) y la
--     ventana por defecto pasa a 90 días cuando `p_desde` llega en null.
--   ESC-11 · `posicion` sin purga ni índice (tenant, medida_en). 90 días.
--   ESC-13 · bucket `comprobantes` sin `file_size_limit` ni mime: 8 MB e
--     imágenes/PDF, que es lo que `subirComprobante` (intake/almacen.ts) sube.
--   ESC-16 · la purga nocturna borraba sin tandas bajo maxDuration=120: la
--     primera corrida sobre una tabla grande moría a la mitad y el lock de un
--     DELETE de millones de filas frenaba el webhook. Toda purga de esta
--     migración borra en tandas de 50k con un vencimiento compartido y
--     devuelve `parcial: true` si no alcanzó; el cron repite mientras tenga
--     presupuesto.
--   ESC-17 · `bitacora_auditoria` (365 d) y `cobranza_contacto` (180 d, solo
--     de viajes ya cerrados: la fila es el claim anti-doble-envío mientras el
--     viaje siga abierto) sin retención.
--   RES-7 · `cron_latido`: el último latido de cada cron, para que /api/health
--     pueda decir "este cron lleva 20 minutos sin correr" — hoy un 401 en la
--     ruta era invisible.
--
-- Idempotente: `create or replace`, `if not exists`, `drop function if exists`
-- antes de cambiar una firma. `mantenimiento_de_datos` conserva TODAS las
-- llaves anteriores (el bloque 120 exige `prospectoPersonasPurgadas`) y suma
-- las nuevas. NO se aplica a producción desde aquí.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Índices para que las purgas entren por índice ────────────────────────
create index if not exists wa_evento_pendiente_procesado_idx
  on public.wa_evento_pendiente (procesado_en)
  where procesado_en is not null;

-- ESC-11: getEstadoRastreo pregunta por tenant y último `medida_en`; la purga
-- por `medida_en`. El índice de la 0050 lleva `unidad_id` en medio.
create index if not exists posicion_tenant_medida_idx
  on public.posicion (tenant_id, medida_en desc);

create index if not exists bitacora_auditoria_ocurrio_idx
  on public.bitacora_auditoria (ocurrio_en);

-- ── 2. El motor de tandas (ESC-16) ───────────────────────────────────────────
-- Borra de `p_tabla` las filas que cumplen `p_condicion` de 50k en 50k, y se
-- detiene (parcial) cuando pasa `p_vence`. `p_condicion` la arman SOLO las
-- funciones de abajo con `format(%L)`: esta función no es ejecutable desde la
-- API (revoke) y nunca recibe texto del usuario.
create or replace function public.purgar_en_tandas(
  p_tabla regclass,
  p_condicion text,
  p_vence timestamptz default null,
  p_tanda integer default 50000
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  borradas bigint := 0;
  n bigint;
begin
  if p_tanda < 1 then
    raise exception 'purgar_en_tandas: la tanda debe ser >= 1' using errcode = 'PU003';
  end if;
  loop
    execute format(
      'delete from %s where ctid in (select ctid from %s where %s limit %s)',
      p_tabla, p_tabla, p_condicion, p_tanda);
    get diagnostics n = row_count;
    borradas := borradas + n;
    exit when n < p_tanda;
    if p_vence is not null and clock_timestamp() >= p_vence then
      return jsonb_build_object('borradas', borradas, 'parcial', true);
    end if;
  end loop;
  return jsonb_build_object('borradas', borradas, 'parcial', false);
end;
$$;

comment on function public.purgar_en_tandas is
  'Borra en tandas de p_tanda filas hasta agotar la condición o pasar p_vence (ESC-16). Devuelve {borradas, parcial}. Solo la llaman las purgar_* de mantenimiento_de_datos; nunca recibe texto de usuario.';

revoke all on function public.purgar_en_tandas(regclass, text, timestamptz, integer) from public, anon, authenticated;

-- ── 3. Purgas ────────────────────────────────────────────────────────────────

-- 3a. wa_mensaje_procesado (0072) aprende las tandas. Misma regla del piso.
drop function if exists public.purgar_wa_mensaje_procesado(integer, timestamptz);
create or replace function public.purgar_wa_mensaje_procesado(
  p_dias integer default 30,
  p_ahora timestamptz default now(),
  p_vence timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_dias < 7 then
    raise exception 'purgar_wa_mensaje_procesado: % días es demasiado poco; el mínimo es 7', p_dias
      using errcode = 'PU001';
  end if;
  return public.purgar_en_tandas(
    'public.wa_mensaje_procesado'::regclass,
    format('created_at < %L', p_ahora - make_interval(days => p_dias)),
    p_vence);
end;
$$;
revoke all on function public.purgar_wa_mensaje_procesado(integer, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.purgar_wa_mensaje_procesado(integer, timestamptz, timestamptz) to service_role;

-- 3b. wa_evento_pendiente (ESC-2 / RES-14).
create or replace function public.purgar_wa_evento_pendiente(
  p_dias_procesados integer default 30,
  p_dias_muertas integer default 90,
  p_ahora timestamptz default now(),
  p_vence timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  procesados jsonb;
  muertas jsonb;
begin
  if p_dias_procesados < 7 or p_dias_muertas < 30 then
    raise exception 'purgar_wa_evento_pendiente: plazos demasiado cortos (mínimo 7 procesados / 30 cartas muertas)'
      using errcode = 'PU001';
  end if;
  procesados := public.purgar_en_tandas(
    'public.wa_evento_pendiente'::regclass,
    format('procesado_en is not null and procesado_en < %L', p_ahora - make_interval(days => p_dias_procesados)),
    p_vence);
  -- Las cartas muertas (intentos al tope, nunca procesadas) se conservan 90
  -- días: el cron las grita a diario; tres meses es tiempo de sobra para
  -- mirarlas. Lo pendiente VIVO (por debajo del tope) jamás se toca.
  muertas := public.purgar_en_tandas(
    'public.wa_evento_pendiente'::regclass,
    format('procesado_en is null and intentos >= 5 and recibido_en < %L', p_ahora - make_interval(days => p_dias_muertas)),
    p_vence);
  return jsonb_build_object(
    'borradas', (procesados->>'borradas')::bigint + (muertas->>'borradas')::bigint,
    'parcial', (procesados->>'parcial')::boolean or (muertas->>'parcial')::boolean);
end;
$$;
comment on function public.purgar_wa_evento_pendiente is
  'Borra de la bandeja durable del webhook lo procesado hace más de p_dias_procesados (30) y las cartas muertas (intentos >= 5) de más de p_dias_muertas (90). Lo pendiente vivo no se toca. La llama mantenimiento_de_datos.';
revoke all on function public.purgar_wa_evento_pendiente(integer, integer, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.purgar_wa_evento_pendiente(integer, integer, timestamptz, timestamptz) to service_role;

-- 3c. posicion (ESC-11).
create or replace function public.purgar_posicion(
  p_dias integer default 90,
  p_ahora timestamptz default now(),
  p_vence timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_dias < 30 then
    raise exception 'purgar_posicion: % días es demasiado poco; el mínimo es 30', p_dias using errcode = 'PU001';
  end if;
  return public.purgar_en_tandas(
    'public.posicion'::regclass,
    format('medida_en < %L', p_ahora - make_interval(days => p_dias)),
    p_vence);
end;
$$;
comment on function public.purgar_posicion is
  'Borra las posiciones GPS con medida_en anterior a p_dias (default 90). El km/l y las geocercas se calculan sobre ventanas cortas. La llama mantenimiento_de_datos.';
revoke all on function public.purgar_posicion(integer, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.purgar_posicion(integer, timestamptz, timestamptz) to service_role;

-- 3d. llm_costo (ESC-10): solo lo mayor a 13 meses. El consolidado mensual
-- (0072) corre ANTES en mantenimiento_de_datos, así que el mes que se borra
-- ya está cerrado en llm_costo_mensual. Cambio VISIBLE: resumen_costo_ia_tenant
-- (0064) suma filas crudas y para periodos de hace más de 13 meses contesta
-- desde el consolidado, no desde el detalle por viaje.
create or replace function public.purgar_llm_costo(
  p_meses integer default 13,
  p_ahora timestamptz default now(),
  p_vence timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_meses < 13 then
    raise exception 'purgar_llm_costo: % meses es demasiado poco; el mínimo es 13 (un ejercicio fiscal más margen)', p_meses
      using errcode = 'PU002';
  end if;
  return public.purgar_en_tandas(
    'public.llm_costo'::regclass,
    format('created_at < %L', p_ahora - make_interval(months => p_meses)),
    p_vence);
end;
$$;
comment on function public.purgar_llm_costo is
  'Borra el detalle de llm_costo de más de p_meses (mínimo y default 13). El consolidado mensual (llm_costo_mensual, 0072) conserva la cifra. La llama mantenimiento_de_datos.';
revoke all on function public.purgar_llm_costo(integer, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.purgar_llm_costo(integer, timestamptz, timestamptz) to service_role;

-- 3e. bitacora_auditoria (ESC-17). Es append-only para los roles de la app
-- (0053); la purga corre como definer, con un plazo mínimo de un año.
create or replace function public.purgar_bitacora_auditoria(
  p_dias integer default 365,
  p_ahora timestamptz default now(),
  p_vence timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_dias < 365 then
    raise exception 'purgar_bitacora_auditoria: % días es demasiado poco; el mínimo es 365', p_dias using errcode = 'PU001';
  end if;
  return public.purgar_en_tandas(
    'public.bitacora_auditoria'::regclass,
    format('ocurrio_en < %L', p_ahora - make_interval(days => p_dias)),
    p_vence);
end;
$$;
comment on function public.purgar_bitacora_auditoria is
  'Borra la bitácora de auditoría de más de p_dias (mínimo y default 365). La llama mantenimiento_de_datos.';
revoke all on function public.purgar_bitacora_auditoria(integer, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.purgar_bitacora_auditoria(integer, timestamptz, timestamptz) to service_role;

-- 3f. cobranza_contacto (ESC-17). SOLO de viajes que ya no están abiertos: la
-- fila es el claim unique(viaje, tier) y borrarla con el viaje vivo
-- permitiría recontactar un tier ya cobrado.
create or replace function public.purgar_cobranza_contacto(
  p_dias integer default 180,
  p_ahora timestamptz default now(),
  p_vence timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_dias < 90 then
    raise exception 'purgar_cobranza_contacto: % días es demasiado poco; el mínimo es 90', p_dias using errcode = 'PU001';
  end if;
  return public.purgar_en_tandas(
    'public.cobranza_contacto'::regclass,
    format('created_at < %L and not exists (select 1 from public.viaje v where v.id = cobranza_contacto.viaje_id and v.estatus in (''abierto'', ''en_cuadre''))',
           p_ahora - make_interval(days => p_dias)),
    p_vence);
end;
$$;
comment on function public.purgar_cobranza_contacto is
  'Borra la bitácora del Agente de Cobranza de más de p_dias (default 180) de viajes que ya no están abiertos ni en cuadre. La llama mantenimiento_de_datos.';
revoke all on function public.purgar_cobranza_contacto(integer, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.purgar_cobranza_contacto(integer, timestamptz, timestamptz) to service_role;

-- ── 4. mantenimiento_de_datos: misma firma, llaves de siempre + nuevas ───────
-- El presupuesto de las tandas es compartido: 60 s desde que arranca la
-- función, debajo de los 120 del cron, que repite la llamada mientras
-- `parcial` sea true y le quede reloj.
create or replace function public.mantenimiento_de_datos(
  p_dias_wa integer default 30,
  p_ahora timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  vence timestamptz := clock_timestamp() + interval '60 seconds';
  wa jsonb;
  ia_consolidados bigint;
  idem_purgadas bigint;
  correo_purgado bigint;
  corridas_purgadas bigint;
  conversaciones_purgadas bigint;
  codigos_purgados bigint;
  personas_purgadas bigint;
  eventos jsonb;
  posiciones jsonb;
  llm jsonb;
  bitacora jsonb;
  cobranza jsonb;
begin
  wa := public.purgar_wa_mensaje_procesado(p_dias_wa, p_ahora, vence);
  ia_consolidados := public.consolidar_llm_costo_mensual(p_ahora);
  idem_purgadas := public.purgar_api_idempotencia(7, p_ahora);
  correo_purgado := public.purgar_correo_procesado(90, p_ahora);
  corridas_purgadas := public.purgar_agente_corrida(180, p_ahora);
  conversaciones_purgadas := public.purgar_wa_conversacion(180, p_ahora);
  codigos_purgados := public.purgar_codigo_pendiente(180, p_ahora);
  personas_purgadas := public.purgar_prospecto_persona(365, p_ahora);
  eventos := public.purgar_wa_evento_pendiente(30, 90, p_ahora, vence);
  posiciones := public.purgar_posicion(90, p_ahora, vence);
  llm := public.purgar_llm_costo(13, p_ahora, vence);
  bitacora := public.purgar_bitacora_auditoria(365, p_ahora, vence);
  cobranza := public.purgar_cobranza_contacto(180, p_ahora, vence);
  return jsonb_build_object(
    'waPurgados', (wa->>'borradas')::bigint,
    'diasWa', p_dias_wa,
    'iaConsolidados', ia_consolidados,
    -- Era `false` fijo desde la 0072; ahora es la cifra (ESC-10).
    'llmCostoPurgado', (llm->>'borradas')::bigint,
    'idempotenciaPurgada', idem_purgadas,
    'correoPurgado', correo_purgado,
    'corridasPurgadas', corridas_purgadas,
    'conversacionesPurgadas', conversaciones_purgadas,
    'codigosPurgados', codigos_purgados,
    'prospectoPersonasPurgadas', personas_purgadas,
    'waEventosPurgados', (eventos->>'borradas')::bigint,
    'posicionesPurgadas', (posiciones->>'borradas')::bigint,
    'bitacoraPurgada', (bitacora->>'borradas')::bigint,
    'cobranzaContactosPurgados', (cobranza->>'borradas')::bigint,
    'parcial', (wa->>'parcial')::boolean or (eventos->>'parcial')::boolean
             or (posiciones->>'parcial')::boolean or (llm->>'parcial')::boolean
             or (bitacora->>'parcial')::boolean or (cobranza->>'parcial')::boolean,
    'corridaEn', p_ahora
  );
end;
$$;
revoke all on function public.mantenimiento_de_datos(integer, timestamptz) from public, anon, authenticated;
grant execute on function public.mantenimiento_de_datos(integer, timestamptz) to service_role;

-- ── 5. resumen_costo_ia: 90 días por defecto (ESC-10) ───────────────────────
-- Mismo cuerpo que la 0062; solo cambia la cláusula `where`: `p_desde` en null
-- ya NO significa "toda la historia" sino "los últimos 90 días". negocio.ts
-- sigue pasando null y deja de recorrer 200k filas/mes en cada carga de /admin.
-- `p_hasta` en null sigue siendo "hasta hoy".
create or replace function public.resumen_costo_ia(
  p_desde timestamptz default null,
  p_hasta timestamptz default null
)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  with g as (
    select
      grouping(fase)                                    as g_fase,
      grouping(modelo)                                  as g_modelo,
      grouping(((created_at at time zone 'UTC')::date)) as g_dia,
      grouping(tenant_id)                               as g_tenant,
      fase,
      modelo,
      (created_at at time zone 'UTC')::date             as dia,
      tenant_id,
      count(*)          as n,
      sum(costo_usd)    as costo,
      sum(tokens_in)    as t_in,
      sum(tokens_out)   as t_out
    from llm_costo
    where created_at >= coalesce(p_desde, now() - interval '90 days')
      and (p_hasta is null or created_at <  p_hasta)
    group by grouping sets (
      (),
      (fase),
      (modelo),
      (fase, modelo),
      ((created_at at time zone 'UTC')::date),
      (tenant_id)
    )
  )
  select jsonb_build_object(
    'totales', (
      select jsonb_build_object(
        'n', n,
        'costoUsd',  coalesce(costo, 0),
        'tokensIn',  coalesce(t_in, 0),
        'tokensOut', coalesce(t_out, 0))
      from g where g_fase = 1 and g_modelo = 1 and g_dia = 1 and g_tenant = 1
    ),
    'porFase', coalesce((
      select jsonb_agg(jsonb_build_object('fase', fase, 'n', n, 'costoUsd', costo)
                       order by costo desc, fase)
      from g where g_fase = 0 and g_modelo = 1 and g_dia = 1 and g_tenant = 1
    ), '[]'::jsonb),
    'porModelo', coalesce((
      select jsonb_agg(jsonb_build_object('modelo', modelo, 'n', n, 'costoUsd', costo)
                       order by costo desc, modelo)
      from g where g_fase = 1 and g_modelo = 0 and g_dia = 1 and g_tenant = 1
    ), '[]'::jsonb),
    'porFaseModelo', coalesce((
      select jsonb_agg(jsonb_build_object('fase', fase, 'modelo', modelo, 'n', n, 'costoUsd', costo)
                       order by costo desc, fase, modelo)
      from g where g_fase = 0 and g_modelo = 0
    ), '[]'::jsonb),
    'porDia', coalesce((
      select jsonb_agg(jsonb_build_object('dia', to_char(dia, 'YYYY-MM-DD'),
                                          'costoUsd', costo, 'tokens', t_in + t_out)
                       order by dia)
      from g where g_dia = 0
    ), '[]'::jsonb),
    'porTenant', coalesce((
      select jsonb_agg(jsonb_build_object('tenantId', tenant_id, 'costoUsd', costo)
                       order by costo desc)
      from g where g_tenant = 0
    ), '[]'::jsonb)
  );
$$;
comment on function public.resumen_costo_ia(timestamptz, timestamptz) is
  'Agrega llm_costo (totales, por fase, por modelo, por fase+modelo, por día UTC y por tenant) en UN solo recorrido. Cruza todos los tenants a propósito: la consume /admin (superadmin). SECURITY INVOKER. `p_desde` en null = últimos 90 días (0155, ESC-10); `p_hasta` en null = hasta hoy. Semiabierto: >= desde y < hasta.';
revoke all on function public.resumen_costo_ia(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.resumen_costo_ia(timestamptz, timestamptz) to service_role;

-- ── 6. Bucket `comprobantes`: tipo y peso (ESC-13) ──────────────────────────
-- Mismo mecanismo que `avatares` en la 0147: Storage hace cumplir estos dos
-- campos en cada subida, incluida la directa. 8 MB cubre una foto de cámara
-- moderna sin recomprimir; imagen o PDF es lo único que `subirComprobante`
-- manda. La retención (CFF art. 30: cinco años) NO es purga: aquí no se borra.
update storage.buckets
   set file_size_limit    = 8 * 1024 * 1024,
       allowed_mime_types = array['image/*', 'application/pdf']
 where id = 'comprobantes';

-- ── 7. cron_latido (RES-7) ───────────────────────────────────────────────────
create table if not exists public.cron_latido (
  id             text primary key,
  ultimo_latido  timestamptz not null default now(),
  estado         text not null default 'ok',
  detalle        jsonb,
  constraint cron_latido_id_dominio check (id in ('wa-pendientes', 'escalar', 'facturar', 'purgar', 'runner')),
  constraint cron_latido_estado_dominio check (estado in ('ok', 'fallo', 'saltado', 'parcial'))
);
comment on table public.cron_latido is
  'El último latido de cada cron de Vercel (RES-7, 0155). /api/health lo lee para decir cuál lleva demasiado sin correr — un 401 o un secreto ausente dejaban el cron muerto e invisible. Deny-all: solo el servidor.';
alter table public.cron_latido enable row level security;
