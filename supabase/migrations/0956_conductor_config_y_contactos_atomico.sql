-- ═══════════════════════════════════════════════════════════════════════════
-- 0956 — MX-007 / API04-02: la config del Conductor y sus contactos se guardan en UNA transacción.
--
-- PUT /v1/conductor/config guardaba `agente_conductor_config` (upsert) y después los contactos de escalamiento
-- (altas, bajas, renombres) en pasos separados: una terminal ajena o un corte a media escritura dejaba la config nueva con
-- los contactos viejos (o a medias). Esta función hace todo en una sola llamada, así que cualquier error —incluida la FK
-- compuesta de la terminal (23503)— revierte también la config.
--
-- COMPATIBILIDAD (regla del lote B): migración ADITIVA (solo crea una función; no toca tablas ni filas). El código anterior no la
-- llama y sigue funcionando; el código nuevo la usa y, si la función no existe (42883 / PGRST202), cae al camino de varios pasos.
--
-- DISEÑO
--  · `p_config` trae SOLO las columnas a escribir (el llamador ya retira los grupos de migraciones que la base no tiene). Una clave
--    que no es columna lanza 42703 con el mismo texto que Postgres (`column "x" of relation ... does not exist`): el llamador
--    reconoce el grupo faltante por el nombre de la columna, igual que con el upsert directo.
--  · `p_contactos` NULL = no tocar contactos; un arreglo REEMPLAZA la lista: primero altas, luego bajas, luego renombres.
--    Elemento: {"terminalId": uuid|null, "nivel": 1|2, "nombre": text, "telefono": text}.
--  · El tenant sale del parámetro, nunca del JSON (`tenant_id` del JSON se sobrescribe).
--  · SECURITY DEFINER con search_path fijo; solo `service_role` la ejecuta (el servidor, tras autenticar la llave o la sesión).
--
-- REVERSA (sin pérdida de datos; solo quita la función):
--   drop function if exists public.guardar_conductor_config_y_contactos(uuid, jsonb, jsonb);
-- Aplicación doble: segura (create or replace; el revoke/grant es idempotente).
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.guardar_conductor_config_y_contactos(
  p_tenant uuid,
  p_config jsonb,
  p_contactos jsonb default null
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_col  text;
  v_cols text;
  v_sets text;
  v_cfg  jsonb;
  v_n    jsonb;
begin
  if p_tenant is null or p_config is null or jsonb_typeof(p_config) <> 'object' then
    raise exception 'guardar_conductor_config_y_contactos: parametros invalidos' using errcode = '22023';
  end if;
  if p_contactos is not null and jsonb_typeof(p_contactos) <> 'array' then
    raise exception 'guardar_conductor_config_y_contactos: contactos debe ser un arreglo' using errcode = '22023';
  end if;

  v_cfg := jsonb_set(p_config, '{tenant_id}', to_jsonb(p_tenant::text), true);

  for v_col in select k from jsonb_object_keys(v_cfg) as k loop
    if not exists (
      select 1 from pg_catalog.pg_attribute a
       where a.attrelid = 'public.agente_conductor_config'::regclass
         and a.attname = v_col and a.attnum > 0 and not a.attisdropped
    ) then
      raise exception 'column "%" of relation "agente_conductor_config" does not exist', v_col using errcode = '42703';
    end if;
  end loop;

  select string_agg(quote_ident(k), ', '),
         string_agg(format('%1$I = excluded.%1$I', k), ', ') filter (where k <> 'tenant_id')
    into v_cols, v_sets
    from jsonb_object_keys(v_cfg) as k;

  execute format(
    'insert into public.agente_conductor_config (%s) select %s from jsonb_populate_record(null::public.agente_conductor_config, $1) '
    || 'on conflict (tenant_id) do update set %s',
    v_cols, v_cols, coalesce(v_sets, 'tenant_id = excluded.tenant_id')
  ) using v_cfg;

  if p_contactos is null then
    return;
  end if;

  -- Los elementos, con la última aparición ganando (como el Map del código de varios pasos).
  select coalesce(jsonb_agg(jsonb_build_object('terminal_id', x.terminal_id, 'nivel', x.nivel, 'nombre', x.nombre, 'telefono', x.telefono)), '[]'::jsonb)
    into v_n
    from (
      select distinct on (terminal_id, nivel, telefono) terminal_id, nivel, nombre, telefono
        from (
          select nullif(c.elem->>'terminalId', '')::uuid as terminal_id,
                 (c.elem->>'nivel')::smallint as nivel,
                 c.elem->>'nombre' as nombre,
                 c.elem->>'telefono' as telefono,
                 c.ord
            from jsonb_array_elements(p_contactos) with ordinality as c(elem, ord)
        ) y
       order by terminal_id, nivel, telefono, ord desc
    ) x;

  -- 1) Altas primero: una terminal ajena lanza 23503 y revierte TODO (config incluida).
  insert into public.conductor_contacto_trafico (tenant_id, terminal_id, nivel, nombre, telefono, activo)
  select p_tenant, n.terminal_id, n.nivel, n.nombre, n.telefono, true
    from jsonb_to_recordset(v_n) as n(terminal_id uuid, nivel smallint, nombre text, telefono text)
   where not exists (
     select 1 from public.conductor_contacto_trafico e
      where e.tenant_id = p_tenant and e.terminal_id is not distinct from n.terminal_id
        and e.nivel = n.nivel and e.telefono = n.telefono
   );

  -- 2) Bajas: los que ya no están en la lista.
  delete from public.conductor_contacto_trafico e
   where e.tenant_id = p_tenant
     and not exists (
       select 1 from jsonb_to_recordset(v_n) as n(terminal_id uuid, nivel smallint, nombre text, telefono text)
        where e.terminal_id is not distinct from n.terminal_id and e.nivel = n.nivel and e.telefono = n.telefono
     );

  -- 3) Los que se conservan pueden haber cambiado de nombre (y vuelven a estar activos).
  update public.conductor_contacto_trafico e
     set nombre = n.nombre, activo = true
    from jsonb_to_recordset(v_n) as n(terminal_id uuid, nivel smallint, nombre text, telefono text)
   where e.tenant_id = p_tenant
     and e.terminal_id is not distinct from n.terminal_id and e.nivel = n.nivel and e.telefono = n.telefono;
end;
$$;

comment on function public.guardar_conductor_config_y_contactos(uuid, jsonb, jsonb) is
  '0956 (MX-007/API04-02): guarda la config del Conductor y REEMPLAZA sus contactos de escalamiento en una sola transaccion. Solo service_role.';

revoke all on function public.guardar_conductor_config_y_contactos(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.guardar_conductor_config_y_contactos(uuid, jsonb, jsonb) to service_role;

commit;
