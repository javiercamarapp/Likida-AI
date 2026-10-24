-- REVERSA: drop trigger if exists gasto_monto_con_xml_inmutable on public.gasto; drop function if exists public.gasto_monto_con_xml_inmutable(); drop function if exists public.corridas_fallidas_por_grupo(integer, integer); alter table public.agente_conductor_config drop constraint if exists conductor_config_compuerta_rangos, drop column if exists compuerta_movimiento_activa, drop column if exists detenida_metros, drop column if exists detenida_ventana_min, drop column if exists sin_gps_permite; y volver a aplicar el cuerpo de importar_sitios_conductor de supabase/migrations/0632_geocerca_reimportacion_conserva_manual.sql (create or replace + revoke/grant).
-- ═══════════════════════════════════════════════════════════════════════════
-- 0870 · Lote «parciales» de la auditoría 37 (A37-P-02, A37-P-05, A37-P-06, A37-P-08)
--
-- ADITIVA e IDEMPOTENTE; COMPATIBLE HACIA ATRÁS: el código desplegado no usa nada de esto y el código nuevo tolera su ausencia.
--
--  1. A37-P-02 (S56-01, ALTO fiscal): un gasto con XML verificado (xml_verificado = true) trae subtotal, IVA e IEPS DEL XML. El
--     veto de cambiarle el monto vivía solo en TypeScript; cualquier otra ruta (la RPC de revisión, un UPDATE directo) lo dejaba
--     incoherente. Ahora un trigger BEFORE UPDATE rechaza cambiar `monto` (al centavo) cuando la fila YA estaba verificada
--     (CU017). No bloquea ligar el CFDI (ahí OLD.xml_verificado aún no es true) ni escrituras que no tocan el monto.
--  2. A37-P-05 (S34-01): importar_sitios_conductor detecta, en su pasada de revisión, nombres repetidos dentro del mismo lote
--     con otro código y los devuelve como error con la línea, sin escribir nada.
--  3. A37-P-06 (S22-01): corridas_fallidas_por_grupo devuelve las últimas N corridas en fallo POR agente+flota, solo las
--     posteriores a la última corrida que salió bien de ese grupo (con esa fecha), para que una flota ruidosa no empuje fuera de
--     una ventana global de 200 los fallos de otra. Solo service_role.
--  4. A37-P-08 (A5): columnas de la compuerta «unidad detenida» en agente_conductor_config, apagada por omisión (fail-closed).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. A37-P-02 ────────────────────────────────────────────────────────────
create or replace function public.gasto_monto_con_xml_inmutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.xml_verificado is true
     and abs(coalesce(new.monto, 0) - coalesce(old.monto, 0)) >= 0.005 then
    raise exception 'el gasto % tiene CFDI verificado: su monto sale del XML y no se puede cambiar a mano', old.id
      using errcode = 'CU017';
  end if;
  return new;
end $$;

comment on function public.gasto_monto_con_xml_inmutable() is
  'A37-P-02 (0870): rechaza (CU017) cambiar gasto.monto cuando la fila ya tenía xml_verificado = true: subtotal, IVA e IEPS salen del XML y quedarían incoherentes con el monto. Aplica también a revisar_liquidacion. No bloquea la liga del CFDI (OLD.xml_verificado aún no es true).';

revoke all on function public.gasto_monto_con_xml_inmutable() from public, anon, authenticated;

drop trigger if exists gasto_monto_con_xml_inmutable on public.gasto;
create trigger gasto_monto_con_xml_inmutable
  before update of monto on public.gasto
  for each row
  when (old.xml_verificado is true and new.monto is distinct from old.monto)
  execute function public.gasto_monto_con_xml_inmutable();

-- ── 2. A37-P-05 ────────────────────────────────────────────────────────────
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
  v_poligono jsonb;
  v_aprox boolean;
  v_auto boolean;
  v_fuente text;
  conservados integer := 0;
begin
  if p_tenant is null or p_filas is null or jsonb_typeof(p_filas) <> 'array' then raise exception 'importar_sitios: entrada inválida'; end if;
  if jsonb_array_length(p_filas) = 0 or jsonb_array_length(p_filas) > 2000 then raise exception 'importar_sitios: entre 1 y 2000 filas'; end if;
  -- Dos importaciones de la MISMA flota a la vez se serializan: la segunda ve los sitios de la primera y actualiza en
  -- vez de chocar con el unique (código, nombre). Por flota, no global: otra flota no espera.
  perform pg_advisory_xact_lock(hashtextextended('importar_sitios_conductor:' || p_tenant::text, 0));

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
    if f->'poligono' is not null and jsonb_typeof(f->'poligono') <> 'null' and not public.geocerca_poligono_valido(f->'poligono') then
      errores := errores || jsonb_build_object('linea', v_linea, 'mensaje', 'El polígono del sitio «' || v_nombre || '» no es válido (3 a 500 vértices con latitud y longitud, y con área).');
    end if;
    select g.id, g.codigo into existe_nombre from public.geocerca g
     where g.tenant_id = p_tenant and g.nombre = v_nombre and g.codigo is distinct from v_codigo limit 1;
    if found then
      errores := errores || jsonb_build_object('linea', v_linea, 'mensaje', 'Ya existe un sitio llamado «' || v_nombre || '» con otro código; cámbiale el nombre o el código.');
    end if;
    -- 0870 (A37-P-05 / S34-01): el nombre es único por flota (geocerca_nombre_unico, 0050). Dos filas del MISMO lote con el mismo
    -- nombre y otro código no chocaban en esta revisión (solo miraba lo ya guardado) y la segunda inserción fallaba con un 23505
    -- genérico a mitad de la escritura. Aquí se dice con la línea, ANTES de escribir nada.
    if exists (
      select 1 from jsonb_array_elements(p_filas) x
       where btrim(x->>'nombre') = v_nombre
         and nullif(btrim(x->>'codigo'), '') is distinct from v_codigo
         and (x->>'linea')::integer <> v_linea
    ) then
      errores := errores || jsonb_build_object('linea', v_linea, 'mensaje', 'El nombre «' || v_nombre || '» se repite en el archivo con otro código; cámbiale el nombre o el código a una de las filas.');
    end if;
  end loop;
  if jsonb_array_length(errores) > 0 then
    return jsonb_build_object('ok', false, 'errores', errores);
  end if;

  -- Pasada 2: escribir (upsert por código).
  for f in select * from jsonb_array_elements(p_filas) loop
    v_codigo := btrim(f->>'codigo');
    v_cliente := null;
    -- 0632: `conservar_activa` es la marca de la re-importación AUTOMÁTICA diaria (la manual del panel no la manda).
    v_auto := coalesce((f->>'conservar_activa')::boolean, false);
    -- 0630: el polígono nativo (si viene) y la bandera de aproximación (solo si NO hay polígono: un círculo que sustituye a uno).
    v_poligono := case when jsonb_typeof(f->'poligono') = 'array' then f->'poligono' else null end;
    v_aprox := v_poligono is null and coalesce((f->>'aproximada')::boolean, false);
    if nullif(btrim(f->>'cliente'), '') is not null then
      select c.id into v_cliente from public.cliente c where c.tenant_id = p_tenant and lower(c.nombre) = lower(btrim(f->>'cliente')) limit 1;
    end if;
    select g.id, g.fuente into v_id, v_fuente from public.geocerca g where g.tenant_id = p_tenant and g.codigo = v_codigo;
    if v_id is not null and v_auto and v_fuente = 'manual' then
      -- 0632: lo que la flota editó a mano en el editor de sitios (fuente = 'manual') NO lo pisa la re-importación automática:
      -- ni el tipo, ni el círculo, ni el polígono, ni el cliente, ni la dirección, ni el padre. La huella solo evita esto mientras
      -- la tabla del cliente no cambie; el primer cambio en cualquier fila reescribía todas.
      conservados := conservados + 1;
      continue;
    end if;
    if v_id is null then
      insert into public.geocerca (tenant_id, nombre, tipo, lat, lng, radio_m, codigo, direccion, cliente_id, fuente, poligono, aproximada)
      values (p_tenant, btrim(f->>'nombre'), f->>'tipo', (f->>'lat')::double precision, (f->>'lng')::double precision,
              (f->>'radio_m')::integer, v_codigo, nullif(btrim(f->>'direccion'), ''), v_cliente, 'csv', v_poligono, v_aprox);
      creados := creados + 1;
    else
      update public.geocerca
         set nombre = btrim(f->>'nombre'), tipo = f->>'tipo', lat = (f->>'lat')::double precision, lng = (f->>'lng')::double precision,
             radio_m = (f->>'radio_m')::integer,
             -- 0632: la re-importación automática no trae dirección (su tabla no la tiene): no borra la que se capturó a mano.
             direccion = case when v_auto then coalesce(nullif(btrim(f->>'direccion'), ''), public.geocerca.direccion) else nullif(btrim(f->>'direccion'), '') end,
             cliente_id = v_cliente, fuente = 'csv',
             -- Re-importar a mano reactiva el sitio (como siempre); la re-importación AUTOMÁTICA diaria manda `conservar_activa` y NO
             -- revive un sitio que la flota archivó a propósito.
             activa = case when coalesce((f->>'conservar_activa')::boolean, false) then public.geocerca.activa else true end,
             poligono = v_poligono, aproximada = v_aprox
       where id = v_id and tenant_id = p_tenant;
      actualizados := actualizados + 1;
    end if;
  end loop;
  -- Padres: una vez que todos existen.
  for f in select * from jsonb_array_elements(p_filas) loop
    v_codigo := btrim(f->>'codigo');
    v_padre := null;
    v_auto := coalesce((f->>'conservar_activa')::boolean, false);
    if nullif(btrim(f->>'padre'), '') is not null then
      select g.id into v_padre from public.geocerca g where g.tenant_id = p_tenant and g.codigo = btrim(f->>'padre');
    end if;
    -- 0632: la automática sin padre en su tabla NO deja huérfano al sitio que la flota anidó a mano, y nunca toca lo manual.
    if v_auto and (v_padre is null or exists (select 1 from public.geocerca g where g.tenant_id = p_tenant and g.codigo = v_codigo and g.fuente = 'manual')) then
      continue;
    end if;
    update public.geocerca set padre_id = v_padre where tenant_id = p_tenant and codigo = v_codigo;
  end loop;
  return jsonb_build_object('ok', true, 'creados', creados, 'actualizados', actualizados, 'conservados', conservados);
end $$;
revoke all on function public.importar_sitios_conductor(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.importar_sitios_conductor(uuid, jsonb) to service_role;

-- ── 3. A37-P-06 ────────────────────────────────────────────────────────────
create or replace function public.corridas_fallidas_por_grupo(p_por_grupo integer default 50, p_max integer default 2000)
returns table (
  agente text, estado text, disparo text, inicio timestamptz, fin timestamptz,
  tareas_hechas integer, tareas_total integer, tenant_id uuid, tenant_nombre text, error text,
  ultimo_sin_fallo timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with fallos as (
    select c.id, c.agente, c.estado, c.disparo, c.inicio, c.fin, c.tareas_hechas, c.tareas_total, c.tenant_id, c.error,
           (select max(o.inicio) from public.agente_corrida o
             where o.agente = c.agente and o.tenant_id is not distinct from c.tenant_id and o.estado in ('ok', 'parcial')) as ultimo_sin_fallo
      from public.agente_corrida c
     where c.estado = 'fallo'
  ), vigentes as (
    select f.*, row_number() over (partition by f.agente, f.tenant_id order by f.inicio desc, f.id desc) as n
      from fallos f
     where f.ultimo_sin_fallo is null or f.inicio > f.ultimo_sin_fallo
  )
  select v.agente, v.estado, v.disparo, v.inicio, v.fin, v.tareas_hechas, v.tareas_total, v.tenant_id,
         t.nombre as tenant_nombre, v.error, v.ultimo_sin_fallo
    from vigentes v
    left join public.tenant t on t.id = v.tenant_id
   where v.n <= greatest(1, least(coalesce(p_por_grupo, 50), 500))
   order by v.inicio desc, v.id desc
   limit greatest(1, least(coalesce(p_max, 2000), 5000));
$$;

comment on function public.corridas_fallidas_por_grupo(integer, integer) is
  'A37-P-06 (0870): las últimas p_por_grupo corridas en fallo por agente+flota, solo las posteriores a la última corrida ok/parcial de ese grupo (ultimo_sin_fallo). Evita que una flota ruidosa empuje fuera de una ventana global los fallos de otra. Solo service_role.';

revoke all on function public.corridas_fallidas_por_grupo(integer, integer) from public, anon, authenticated;
grant execute on function public.corridas_fallidas_por_grupo(integer, integer) to service_role;

-- ── 4. A37-P-08 ────────────────────────────────────────────────────────────
alter table public.agente_conductor_config
  add column if not exists compuerta_movimiento_activa boolean not null default false,
  add column if not exists detenida_metros integer not null default 150,
  add column if not exists detenida_ventana_min integer not null default 5,
  add column if not exists sin_gps_permite boolean not null default false;

alter table public.agente_conductor_config drop constraint if exists conductor_config_compuerta_rangos;
alter table public.agente_conductor_config add constraint conductor_config_compuerta_rangos
  check (detenida_metros between 10 and 5000 and detenida_ventana_min between 1 and 60);

comment on column public.agente_conductor_config.compuerta_movimiento_activa is
  '0870 (A37-P-08): compuerta «unidad detenida». false (por omisión, fail-closed) = no hay compuerta; true = solo se le escribe al chofer con la unidad detenida según GPS.';
comment on column public.agente_conductor_config.detenida_metros is
  '0870: metros dentro de los que la unidad se da por detenida. 150 por omisión (supuesto); de 10 a 5000.';
comment on column public.agente_conductor_config.detenida_ventana_min is
  '0870: minutos de la ventana para dar la unidad por detenida. 5 por omisión (supuesto); de 1 a 60.';
comment on column public.agente_conductor_config.sin_gps_permite is
  '0870: false (por omisión) = con la compuerta encendida y sin muestra de GPS reciente NO se le escribe al chofer (silencio ante la duda); true = se permite.';
