-- ═══════════════════════════════════════════════════════════════════════════
-- 0162 — Lo que la consola cuenta en la base, y la basura de Storage que nadie
--        recogía (escala 50k viajes/mes, 22-ago-2026).
--
-- Cinco funciones y una tabla de cursor, de cuatro hallazgos distintos que
-- comparten una sola forma: **traer filas para producir un número**.
--
--   ESC-9   `senales_pmf`            — 7 `count exact` × N flotas → 1 consulta.
--   ESC-11  `estado_rastreo_tenant`  — `posicion` entera para dos escalares.
--   FE-8    `consumo_agentes`        — `.limit(5000)` (= 1,000 silencioso) para
--           `slo_agente_corrida`       sumar dinero y medir un p95.
--   DAT-35  `limpiar_storage_huerfano` — nada borraba de Storage al borrar
--                                        una flota o un viaje.
--
-- Las cuatro primeras son SECURITY INVOKER y van revocadas a
-- public/anon/authenticated (Postgres da EXECUTE a PUBLIC en toda función
-- nueva — lección de la 0054). La quinta es `security definer` porque tiene
-- que borrar de `storage.objects`, que no es del esquema de la app.
--
-- Verificado por el bloque 134 de supabase/verificaciones.sql.
--
-- PARA DESHACER (en orden):
--   drop function public.senales_pmf(uuid);
--   drop function public.estado_rastreo_tenant(uuid);
--   drop function public.consumo_agentes(timestamptz, timestamptz);
--   drop function public.slo_agente_corrida(timestamptz);
--   drop function public.limpiar_storage_huerfano(integer, integer, timestamptz, timestamptz);
--   drop function public.es_uuid(text);
--   drop table public.storage_limpieza_cursor;
--   -- y volver a poner `mantenimiento_de_datos` como la dejó la 0155.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · ESC-9 — senales_pmf(): las tres señales, de TODAS las flotas o de una
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `getSenalesPmf` (src/lib/likida/pmf.ts) hacía SIETE `count exact` por flota,
-- y `/admin/flotas` los lanzaba con un `Promise.all` sobre TODAS las flotas
-- sin pool: 7 × N consultas simultáneas contra el mismo pooler. Con 50 flotas
-- son 350 consultas concurrentes para pintar una tabla — y cada `count exact`
-- de `liquidacion`/`viaje` es un recorrido del índice de esa flota, no una
-- lectura de una fila.
--
-- Aquí se agrupa una vez: `count(*) filter (...)` sobre el mismo recorrido,
-- `group by tenant_id`. El payload depende del número de FLOTAS, no del de
-- liquidaciones.
--
-- ── p_tenant NULL = TODAS LAS FLOTAS, y es a propósito ──────────────────────
--
-- Segunda excepción consciente al molde de la 0112 (`p_tenant uuid` sin
-- default), por la misma razón que `resumen_negocio` (0153) y `resumen_costo_ia`
-- (0062): el ÚNICO consumidor de pmf.ts es /admin — la tabla de flotas y la
-- ficha de cliente (src/lib/admin/ficha-cliente.ts), las dos detrás del guard
-- de superadmin. Con `p_tenant` la misma función sirve la ficha de UNA flota en
-- una sola ida (siete counts menos), y con NULL sirve la tabla entera.
--
-- El día que una pantalla de /dashboard quiera señales de PMF, la respuesta
-- correcta es pasarle SIEMPRE su `p_tenant` desde una función `_tenant` nueva,
-- no relajar ésta. Los candados: SECURITY INVOKER (la RLS de las tres tablas
-- sigue aplicando encima; la app la llama con `service_role`, que ya la salta)
-- + `revoke ... from public, anon, authenticated`.
--
-- ── Por qué `<> 'superadmin'` y no `is distinct from` ───────────────────────
--
-- Es la traducción EXACTA del `.neq('primera_descarga_rol', 'superadmin')` que
-- hacía PostgREST: `NULL <> 'superadmin'` es NULL, así que una descarga sin rol
-- NO contaba como "por cliente". En la práctica no existe (el RPC de la 0114
-- escribe fecha y rol juntos), pero cambiar el operador aquí cambiaría la cifra
-- sin que nadie lo pidiera — y esta cifra es la señal de PMF.
create or replace function public.senales_pmf(p_tenant uuid default null)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  with l as (
    select tenant_id,
           count(*)                                                      as liquidaciones,
           count(*) filter (where primera_descarga_en is not null)        as descargadas,
           count(*) filter (where primera_descarga_en is not null
                              and primera_descarga_rol <> 'superadmin')   as por_cliente
      from liquidacion
     where p_tenant is null or tenant_id = p_tenant
     group by tenant_id
  ),
  v as (
    select tenant_id,
           count(*)                                                          as liquidados,
           count(*) filter (where recordatorio_comprobacion_en is null)      as sin_recordatorio
      from viaje
     where estatus = 'liquidado'
       and (p_tenant is null or tenant_id = p_tenant)
     group by tenant_id
  ),
  t as (
    select tenant_id,
           count(*)                                        as tickets,
           count(*) filter (where abierto_por is not null) as del_cliente
      from ticket_soporte
     where p_tenant is null or tenant_id = p_tenant
     group by tenant_id
  ),
  flotas as (
    select tenant_id from l
    union select tenant_id from v
    union select tenant_id from t
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'tenantId',        f.tenant_id,
           'liquidaciones',   coalesce(l.liquidaciones, 0),
           'descargadas',     coalesce(l.descargadas, 0),
           'porCliente',      coalesce(l.por_cliente, 0),
           'liquidados',      coalesce(v.liquidados, 0),
           'sinRecordatorio', coalesce(v.sin_recordatorio, 0),
           'tickets',         coalesce(t.tickets, 0),
           'delCliente',      coalesce(t.del_cliente, 0)
         ) order by f.tenant_id), '[]'::jsonb)
    from flotas f
    left join l on l.tenant_id = f.tenant_id
    left join v on v.tenant_id = f.tenant_id
    left join t on t.tenant_id = f.tenant_id;
$$;

comment on function public.senales_pmf(uuid) is
  'Las 3 señales de PMF (mig. 0114) agregadas en SQL: por flota si p_tenant es NULL (CROSS-TENANT A PROPÓSITO — solo /admin, vía service_role), o de una sola flota si se pasa. Reemplaza los 7 count exact POR FLOTA de getSenalesPmf (pmf.ts), que /admin/flotas lanzaba sin pool (ESC-9). Una flota SIN filas en las tres tablas no aparece en el arreglo: eso es "sin datos", y el TS lo distingue de un cero. SECURITY INVOKER; revocada a public/anon/authenticated (mig. 0162).';

revoke all on function public.senales_pmf(uuid) from public, anon, authenticated;
grant execute on function public.senales_pmf(uuid) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · ESC-11 — estado_rastreo_tenant(): dos escalares, no la tabla entera
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `getEstadoRastreo` (comercial.ts) traía `posicion` ENTERA de la flota con
-- `traerTodo` para calcular exactamente dos números: cuántas unidades tienen
-- posición y cuál fue la última. `posicion` es la tabla de más escritura del
-- producto cuando el rastreo esté conectado (una fila por ping por unidad), y
-- `traerTodo` lanza a las 100,000 filas: la pantalla de rastreo dejaría de
-- cargar antes que ninguna otra.
--
-- La purga a 90 días y el índice `(tenant_id, medida_en)` ya los puso la 0155;
-- lo que faltaba era no traerse las filas. `count(distinct unidad_id)` y
-- `max(medida_en)` salen del mismo recorrido acotado por tenant.
--
-- `ultimaPosicion` sale como texto ISO 8601 con offset, que es lo mismo que
-- entregaba PostgREST — la UI lo formatea con `fechaMx`, no lo compara.
create or replace function public.estado_rastreo_tenant(p_tenant uuid)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'unidadesConPosicion', count(distinct unidad_id),
    'ultimaPosicion',      to_jsonb(max(medida_en))
  )
  from posicion
  where tenant_id = p_tenant;
$$;

comment on function public.estado_rastreo_tenant(uuid) is
  'Los dos escalares del panel de rastreo de UNA flota: unidadesConPosicion (count distinct unidad_id) y ultimaPosicion (max medida_en, NULL si no hay ninguna). Reemplaza el traerTodo de `posicion` entera que hacía getEstadoRastreo (comercial.ts, ESC-11). SECURITY INVOKER; p_tenant sin default (molde 0112).';

revoke all on function public.estado_rastreo_tenant(uuid) from public, anon, authenticated;
grant execute on function public.estado_rastreo_tenant(uuid) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · FE-8 — consumo_agentes() y slo_agente_corrida(): el dinero no se muestrea
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `getConsumoPorAgente` (admin/consumo.ts) y `getSLOs` (admin/slo.ts) leían
-- `agente_corrida` con `.limit(5000)` y SIN `order`. Dos cosas mal a la vez:
--   1. PostgREST recorta a `max_rows` = 1,000 EN SILENCIO, así que el límite
--      real nunca fue 5,000 (regla 3 de docs/escala-50k/REGLAS-FIX.md).
--   2. Sin `order`, esas 1,000 filas son las que Postgres devolvió primero —
--      un conjunto ARBITRARIO. El panel decía "gastó $X en 30 días" y "el 97%
--      de las corridas salió bien" sobre una muestra que nadie eligió.
--
-- A 50k viajes/mes el runner corre por flota y por agente: 30 días pasan de
-- 1,000 corridas con menos de diez clientes. La cifra no se iba a poner un
-- poco imprecisa: iba a quedarse congelada en la primera página.
--
-- Las dos son CROSS-TENANT a propósito (miden a Likida, no a una flota) y solo
-- las llama /admin. `costo_usd` es NULL en las corridas anteriores a la 0123 —
-- `coalesce(..., 0)` al sumar es lo que ya hacía el JS (`Number(c.costo_usd ?? 0)`),
-- y el `n` de cada agente sigue diciendo cuántas corridas hubo.
create or replace function public.consumo_agentes(
  p_desde      timestamptz,
  p_inicio_hoy timestamptz
) returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'agente', agente,
           'n',      n,
           'fallos', fallos,
           'g30',    g30,
           'hoy',    hoy
         ) order by agente), '[]'::jsonb)
  from (
    select agente,
           count(*)                                              as n,
           count(*) filter (where estado = 'fallo')               as fallos,
           sum(coalesce(costo_usd, 0))                            as g30,
           sum(coalesce(costo_usd, 0))
             filter (where inicio >= p_inicio_hoy)                as hoy
      from agente_corrida
     where inicio >= p_desde
     group by agente
  ) x;
$$;

comment on function public.consumo_agentes(timestamptz, timestamptz) is
  'Gasto y conteo de agente_corrida por AGENTE desde p_desde, con el subtotal del día (>= p_inicio_hoy) aparte. CROSS-TENANT a propósito: mide el back office de Likida, no a una flota, y solo lo lee /admin/consumo. Reemplaza el .limit(5000) sin order de consumo.ts, que PostgREST recortaba a 1,000 filas arbitrarias (FE-8). SECURITY INVOKER.';

revoke all on function public.consumo_agentes(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.consumo_agentes(timestamptz, timestamptz) to service_role;

-- `percentile_disc` es el MISMO p95 que hacía el JS: rango más cercano
-- (`orden[ceil(n*0.95) - 1]`), un valor que de verdad ocurrió, no una
-- interpolación. `percentile_cont` habría cambiado la cifra del SLO.
--
-- `medibles` no es `total`: el p95 solo mira corridas `ok` CON `fin` (una
-- corrida viva no tiene duración) y con duración no negativa — el mismo filtro
-- que el JS, para que "muestra insuficiente" siga significando lo mismo.
create or replace function public.slo_agente_corrida(p_desde timestamptz)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  with d as (
    select estado,
           case when fin is not null
                then extract(epoch from (fin - inicio))
           end as seg
      from agente_corrida
     where inicio >= p_desde
  ),
  m as (
    select seg from d where estado = 'ok' and seg is not null and seg >= 0
  )
  select jsonb_build_object(
    'total',       (select count(*) from d),
    'ok',          (select count(*) from d where estado = 'ok'),
    'medibles',    (select count(*) from m),
    'p95Segundos', (select percentile_disc(0.95) within group (order by seg) from m)
  );
$$;

comment on function public.slo_agente_corrida(timestamptz) is
  'Los dos SLO de corridas de agente desde p_desde: total/ok (tasa de éxito) y p95 de duración en segundos de las OK con fin (percentile_disc = rango más cercano, el mismo que calculaba el JS). CROSS-TENANT a propósito (mide a Likida). Reemplaza el .limit(5000) sin order de slo.ts (FE-8). SECURITY INVOKER.';

revoke all on function public.slo_agente_corrida(timestamptz) from public, anon, authenticated;
grant execute on function public.slo_agente_corrida(timestamptz) to service_role;

-- Las dos filtran `inicio >= p_desde` SIN tenant, y los índices que hay son
-- `(tenant_id, agente, inicio desc)` (0102) y `(creada_en)` — ninguno sirve de
-- prefijo para eso. Sin índice: seq scan de la tabla entera cada carga de
-- /admin/consumo y de /admin/observabilidad.
-- Sin CONCURRENTLY (regla 4 de docs/escala-50k/REGLAS-ESCALA.md).
create index if not exists agente_corrida_inicio_idx
  on public.agente_corrida (inicio);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · DAT-35 — limpiar_storage_huerfano(): la basura que nadie recogía
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Borrar una flota (`delete from tenant`) o un viaje arrastra en cascada sus
-- gastos, PODs, incidencias y liquidaciones. Los ARCHIVOS de esas filas —la
-- foto del ticket, el PDF de la liquidación— se quedan en Storage para siempre:
-- nada los mira. A 50k viajes/mes son ~61 GB/mes de comprobantes (ESC-13); la
-- fracción huérfana crece sola y sin dueño que la reclame.
--
-- ── LO QUE ESTA FUNCIÓN NO BORRA JAMÁS ─────────────────────────────────────
--
-- Es la parte importante, porque aquí un falso positivo es DESTRUIR EVIDENCIA
-- FISCAL: el CFF art. 30 obliga a conservar los comprobantes CINCO AÑOS, y el
-- PDF de una liquidación es el papel que el operador ya recibió.
--
-- Por eso NO borra "lo que no está referenciado". Borra únicamente lo que es
-- huérfano POR ESTRUCTURA, y solo en dos casos:
--
--   A. La FLOTA ya no existe. El primer segmento de la ruta es un uuid que no
--      está en `tenant`. Si la flota se borró, sus filas se fueron en cascada
--      (todas las tablas del producto cuelgan de `tenant` con `on delete
--      cascade`), así que no hay nada vivo que pueda apuntar a ese archivo.
--   B. El VIAJE ya no existe. El segundo segmento es un uuid que no está en
--      `viaje`. `gasto`, `pod` e `incidencia` cuelgan del viaje con `on delete
--      cascade` (0001:60, 0047:129/100), así que un viaje borrado se llevó
--      consigo todas las filas que podían nombrar ese archivo.
--
-- Y sobre esos dos casos van, además, TRES cinturones:
--
--   · La GRACIA. Nada que se haya creado en los últimos `p_gracia_dias` (7 por
--     default) se toca. `subirComprobante` sube la foto ANTES de que exista la
--     fila del gasto (intake/almacen.ts), y un import a medias o un cierre en
--     curso no pueden quedar sin su archivo por una carrera de segundos.
--   · `comprobante_huerfano.ruta_imagen`. Esa tabla es la ÚNICA que sobrevive
--     al borrado del viaje que la originó (`viaje_id ... on delete set null`,
--     0040): un comprobante en la sala de espera sigue vivo aunque su viaje ya
--     no esté, y su foto es lo único que queda de él.
--   · `liquidacion_historico.pdf_url`. Mismo caso y misma razón (0159): el
--     histórico existe justo para sobrevivir al borrado, y `viaje_id` va SIN FK
--     a propósito. Su PDF es el papel emitido.
--
--   Las demás columnas que nombran un objeto —`gasto.imagen_url`,
--   `pod.storage_path`, `incidencia.evidencia_path`, `liquidacion.pdf_url`— NO
--   necesitan anti-join: sus filas mueren en cascada con el viaje o con el
--   tenant, que es exactamente la condición que dispara el borrado. Si algún
--   día una de esas FKs deja de ser `cascade`, hay que añadir su anti-join aquí
--   ANTES de que la 0162 vuelva a correr.
--
-- ── LO QUE ESTA FUNCIÓN NO PUEDE HACER, DICHO ──────────────────────────────
--
-- Borrar la fila de `storage.objects` quita el objeto del catálogo (deja de
-- listarse, de firmarse y de contar para el inventario), pero **NO borra el
-- blob del almacén S3**: eso solo lo hace la API de Storage. O sea: esta purga
-- recupera el catálogo y la coherencia, no necesariamente los gigabytes de la
-- factura. Reclamar los bytes es trabajo del servicio de Storage o de un
-- barrido con la service role — ver `scripts/respaldo-storage.sh` y
-- docs/conocimiento/DEPLOY.md, donde queda escrito el procedimiento.
--
-- ── EL CURSOR ───────────────────────────────────────────────────────────────
--
-- El barrido es ROTATIVO, no completo: cada corrida avanza `p_tanda` objetos
-- por bucket desde donde quedó la anterior y se detiene al agotar el reloj.
-- Un `storage.objects` de cientos de miles de filas no cabe en los 120 s del
-- cron, y volver a empezar desde el principio cada noche haría que la cola
-- nunca se alcanzara. Al llegar al final, el cursor vuelve a '' y cuenta vuelta.
create table if not exists public.storage_limpieza_cursor (
  bucket        text primary key,
  ultimo_nombre text        not null default '',
  vuelta_en     timestamptz,
  vueltas       bigint      not null default 0,
  actualizado_en timestamptz not null default now()
);

comment on table public.storage_limpieza_cursor is
  'Por dónde va el barrido rotativo de limpiar_storage_huerfano (0162, DAT-35). Una fila por bucket. Deny-all: RLS activo y sin policies — solo el servidor.';

alter table public.storage_limpieza_cursor enable row level security;

-- `es_uuid`: la ruta trae los ids como TEXTO. Un `::uuid` sobre un segmento que
-- no lo es (p. ej. `sin-viaje`, o `informes`) lanza 22P02 y tumbaría el barrido
-- entero. IMMUTABLE y sin acceso a tablas: se puede usar en un `where`.
create or replace function public.es_uuid(t text)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select t ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$$;

comment on function public.es_uuid(text) is
  '¿Este texto tiene forma de uuid? Para poder filtrar segmentos de una ruta de Storage sin que un `::uuid` sobre `sin-viaje` lance 22P02 (0162).';

create or replace function public.limpiar_storage_huerfano(
  p_gracia_dias integer     default 7,
  p_tanda       integer     default 500,
  p_ahora       timestamptz default now(),
  p_vence       timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- El presupuesto propio es corto a propósito: esta purga es la ÚLTIMA de
  -- mantenimiento_de_datos y la menos urgente de todas (nada se corrompe si no
  -- corre esta noche), así que no puede comerse el reloj de las que sí lo son.
  vence     timestamptz := coalesce(p_vence, clock_timestamp() + interval '20 seconds');
  gracia    integer     := greatest(coalesce(p_gracia_dias, 7), 1);
  corte     timestamptz := p_ahora - make_interval(days => gracia);
  tanda     integer     := least(greatest(coalesce(p_tanda, 500), 1), 5000);
  v_bucket  text;
  v_cursor  text;
  v_ultimo  text;
  v_leidos  integer;
  v_borr    bigint;
  revisados bigint  := 0;
  borrados  bigint  := 0;
  parcial   boolean := false;
begin
  foreach v_bucket in array array['comprobantes', 'liquidaciones'] loop
    if clock_timestamp() >= vence then parcial := true; exit; end if;

    insert into public.storage_limpieza_cursor (bucket) values (v_bucket)
      on conflict (bucket) do nothing;
    select ultimo_nombre into v_cursor
      from public.storage_limpieza_cursor where bucket = v_bucket;

    loop
      if clock_timestamp() >= vence then parcial := true; exit; end if;

      with lote as (
        select o.id, o.name, o.created_at
          from storage.objects o
         where o.bucket_id = v_bucket
           and o.name > v_cursor
         order by o.name
         limit tanda
      ),
      partes as (
        select l.id, l.name, l.created_at, string_to_array(l.name, '/') as seg
          from lote l
      ),
      juicio as (
        select p.id,
               p.name,
               p.created_at,
               -- LA FLOTA. `informes/{tenant}/informe-*.pdf` (oficina_wa.ts) la
               -- mete en el SEGUNDO segmento; todo lo demás en el primero.
               case when p.seg[1] = 'informes' and cardinality(p.seg) = 3
                    then p.seg[2]
                    else p.seg[1]
               end as tenant_txt,
               -- EL VIAJE, y SOLO si la ruta tiene la forma exacta que este
               -- producto escribe. Cualquier otra forma deja `viaje_txt` en
               -- NULL y con eso la regla B no puede dispararse: un objeto que
               -- no reconocemos NO se borra.
               --
               --   comprobantes/{tenant}/{viaje|sin-viaje}/{hash}.{ext}
               --                          └─ `sin-viaje` no es uuid → no aplica
               --   liquidaciones/{tenant}/{viaje}[-operador].pdf
               --
               -- El `informes/...` del bucket de liquidaciones cae aquí en NULL
               -- a propósito: su segundo segmento es la FLOTA, no un viaje, y
               -- tratarlo como viaje habría borrado todos los informes de golpe.
               case
                 when v_bucket = 'comprobantes' and cardinality(p.seg) = 3
                      and public.es_uuid(p.seg[1])
                   then p.seg[2]
                 when v_bucket = 'liquidaciones' and cardinality(p.seg) = 2
                      and public.es_uuid(p.seg[1]) and p.seg[2] like '%.pdf'
                   then regexp_replace(p.seg[2], '(-operador)?\.pdf$', '')
               end as viaje_txt
          from partes p
      ),
      condenados as (
        select j.id, j.name
          from juicio j
         where j.created_at < corte
           and (
             -- A · la flota ya no existe
             (public.es_uuid(j.tenant_txt)
              and not exists (select 1 from public.tenant t where t.id = j.tenant_txt::uuid))
             -- B · el viaje ya no existe
             or (j.viaje_txt is not null and public.es_uuid(j.viaje_txt)
                 and not exists (select 1 from public.viaje v where v.id = j.viaje_txt::uuid))
           )
           -- Los dos cinturones: lo que sobrevive al borrado del viaje.
           and not exists (
             select 1 from public.comprobante_huerfano h where h.ruta_imagen = j.name
           )
           and not exists (
             select 1 from public.liquidacion_historico lh where lh.pdf_url = j.name
           )
      ),
      borrado as (
        delete from storage.objects o
         using condenados c
         where o.id = c.id
        returning o.id
      )
      select (select count(*) from lote),
             (select max(name) from lote),
             (select count(*) from borrado)
        into v_leidos, v_ultimo, v_borr;

      revisados := revisados + coalesce(v_leidos, 0);
      borrados  := borrados  + coalesce(v_borr, 0);

      if coalesce(v_leidos, 0) = 0 then
        -- Fin del bucket: vuelta completa, el cursor regresa al principio.
        update public.storage_limpieza_cursor
           set ultimo_nombre = '', vuelta_en = p_ahora,
               vueltas = vueltas + 1, actualizado_en = p_ahora
         where bucket = v_bucket;
        exit;
      end if;

      v_cursor := v_ultimo;
      update public.storage_limpieza_cursor
         set ultimo_nombre = v_cursor, actualizado_en = p_ahora
       where bucket = v_bucket;
    end loop;
  end loop;

  return jsonb_build_object(
    'revisados', revisados,
    'borrados',  borrados,
    'parcial',   parcial,
    'graciaDias', gracia
  );
end;
$$;

comment on function public.limpiar_storage_huerfano(integer, integer, timestamptz, timestamptz) is
  'Barrido ROTATIVO de storage.objects (buckets comprobantes y liquidaciones) que borra SOLO huérfanos por estructura: la flota ya no existe, o el viaje ya no existe (DAT-35). Nunca toca un objeto de menos de p_gracia_dias, ni uno nombrado por comprobante_huerfano.ruta_imagen o liquidacion_historico.pdf_url — las dos tablas que sobreviven al borrado del viaje. NO libera los bytes del almacén S3, solo el catálogo (ver la cabecera de la 0162). La llama mantenimiento_de_datos.';

revoke all on function public.limpiar_storage_huerfano(integer, integer, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.limpiar_storage_huerfano(integer, integer, timestamptz, timestamptz) to service_role;

-- Los dos anti-join del cinturón, sobre las dos tablas CHICAS (la sala de
-- espera de comprobantes y el archivo de liquidaciones retiradas). Sin ellos,
-- cada tanda de 500 objetos serían 1,000 seq scans.
create index if not exists comprobante_huerfano_ruta_idx
  on public.comprobante_huerfano (ruta_imagen)
  where ruta_imagen is not null;

create index if not exists liquidacion_historico_pdf_idx
  on public.liquidacion_historico (pdf_url)
  where pdf_url is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5 · mantenimiento_de_datos: la misma firma, una llave más
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CUERPO IDÉNTICO AL DE LA 0155 más dos líneas: la llamada a
-- `limpiar_storage_huerfano` (la ÚLTIMA de la lista, con el reloj ya gastado
-- por las que sí protegen datos) y su llave en el resultado. Se reescribe
-- entera porque Postgres no sabe extender una función: si alguien vuelve a
-- tocar `mantenimiento_de_datos` en otra migración, tiene que partir de ÉSTA.
--
-- `parcial` suma la de Storage: el cron repite la llamada mientras sea true y
-- le quede reloj, así que el barrido rotativo avanza más de una tanda por noche
-- cuando hay tiempo.
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
  storage_huerfano jsonb;
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
  -- DAT-35, y va AL FINAL: es la única purga cuyo retraso no corrompe ni
  -- expone nada — solo deja basura en el catálogo de Storage una noche más.
  storage_huerfano := public.limpiar_storage_huerfano(7, 500, p_ahora, vence);
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
    'storageHuerfanoBorrado', (storage_huerfano->>'borrados')::bigint,
    'storageHuerfanoRevisado', (storage_huerfano->>'revisados')::bigint,
    'parcial', (wa->>'parcial')::boolean or (eventos->>'parcial')::boolean
             or (posiciones->>'parcial')::boolean or (llm->>'parcial')::boolean
             or (bitacora->>'parcial')::boolean or (cobranza->>'parcial')::boolean
             or (storage_huerfano->>'parcial')::boolean,
    'corridaEn', p_ahora
  );
end;
$$;
revoke all on function public.mantenimiento_de_datos(integer, timestamptz) from public, anon, authenticated;
grant execute on function public.mantenimiento_de_datos(integer, timestamptz) to service_role;
