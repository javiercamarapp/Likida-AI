-- REVERSA: (1) reponer `recibir_desglose_atomico` con el cuerpo de la 0940 (`0940_a1_fecha_de_corte_y_entregas_omitidas.sql`, bloque «create or replace function public.recibir_desglose_atomico» más su revoke/grant a service_role); (2) `alter table public.liquidacion_desglose drop constraint if exists liquidacion_desglose_folio_origen_largo, drop column if exists folio_origen;` Los folios ya guardados se pierden al borrar la columna; no hay otra dependencia.
-- ═══════════════════════════════════════════════════════════════════════════
-- 1003 — A1 (LIQUIDACIÓN POR CORREO): FOLIO DE ORIGEN VISIBLE (piloto del webhook, 11-nov-2026).
--
-- El sistema de transporte del cliente puede repetir el número de bitácora que conoce el operador entre operadores distintos, pero
-- Likida necesita un identificador único por flota (`BitacoraID`, la llave de idempotencia y del índice único
-- `liquidacion_desglose_bitacora_unica`). La solución es separar las dos cosas: `BitacoraID` queda como el identificador interno y
-- único, y el número que ve el operador viaja en un campo nuevo, `Folio`, que se guarda aquí y se MUESTRA (Excel, asunto del correo y
-- panel) en lugar del identificador interno.
--
--  1. `liquidacion_desglose.folio_origen` (text, NULL = no vino; entonces se muestra la bitácora, como siempre). Máximo 40 caracteres.
--     NO entra en la huella de idempotencia ni en ningún índice: dos bitácoras distintas pueden traer el mismo folio.
--  2. `recibir_desglose_atomico` redefinida PARTIENDO DE LA 0940 (la última definición): mismo cuerpo, y el insert del encabezado
--     lleva `folio_origen`. Sin la llave en `p_desglose` queda NULL (llamadores anteriores intactos).
--
-- Aditiva e idempotente: no depende de `auth.users` ni de otras tablas más allá de `liquidacion_desglose` (0786); aplicar dos veces no
-- cambia nada. La función conserva revoke de public/anon/authenticated y grant solo a service_role. El código tolera la ausencia de
-- esta migración solo en la escritura (no manda el folio si no viene); la LECTURA del encabezado sí pide la columna, por eso la
-- migración va ANTES del [deploy] (la compuerta `scripts/ci/compuerta-deploy.mjs` lo exige).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.liquidacion_desglose add column if not exists folio_origen text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'liquidacion_desglose_folio_origen_largo'
                  and conrelid = 'public.liquidacion_desglose'::regclass) then
    alter table public.liquidacion_desglose
      add constraint liquidacion_desglose_folio_origen_largo check (folio_origen is null or char_length(folio_origen) between 1 and 40);
  end if;
end $$;

comment on column public.liquidacion_desglose.folio_origen is
  '1003: el número de bitácora que conoce el operador (campo `Folio` del webhook). Es lo que se MUESTRA (Excel, asunto, panel); `bitacora` sigue siendo el identificador único por flota. NULL = no vino: se muestra `bitacora`. No entra en la huella.';

create or replace function public.recibir_desglose_atomico(
  p_tenant      uuid,
  p_liquidacion jsonb,
  p_desglose    jsonb,
  p_evento      jsonb,
  p_entregas    jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id          uuid;
  v_huella      text;
  v_nueva       boolean := false;
  v_reparada    boolean := false;
  v_desg_nuevo  boolean := false;
  v_n_entregas  integer := 0;
  v_tiene_desg  boolean;
  v_retenida    boolean;
  v_hay_entr    boolean;
begin
  if p_tenant is null then
    raise exception 'p_tenant no puede ser nulo';
  end if;
  if p_liquidacion is null or jsonb_typeof(p_liquidacion) <> 'object'
     or p_desglose is null or jsonb_typeof(p_desglose) <> 'object' then
    raise exception 'p_liquidacion y p_desglose deben ser objetos';
  end if;
  if p_entregas is null or jsonb_typeof(p_entregas) <> 'array' then
    raise exception 'p_entregas debe ser un arreglo';
  end if;

  -- 0923 (A37-S63-08): `viaje_ids` no tiene FK. Al CREAR la liquidación, cada viaje tiene que ser de la flota. (Si la
  -- liquidación ya existe, es un reintento: no se revalida contra viajes que pudieron borrarse después.)
  if not exists (select 1 from public.liquidacion_externa l
                  where l.tenant_id = p_tenant and l.clave_externa = p_liquidacion->>'clave_externa')
     and exists (
       select 1
         from unnest(coalesce(array(select jsonb_array_elements_text(p_liquidacion->'viaje_ids')), '{}'::text[])::uuid[]) as vid
        where not exists (select 1 from public.viaje v where v.id = vid and v.tenant_id = p_tenant)
     ) then
    raise exception 'recibir_desglose_atomico: viaje_ids contiene viajes que no son de la flota' using errcode = '23503';
  end if;

  insert into public.liquidacion_externa (
    tenant_id, clave_externa, huella, sistema_origen, operador_id, folios_viaje, viaje_ids,
    periodo_desde, periodo_hasta, conceptos, total, moneda, pdf_ruta, pdf_origen, pdf_sha256
  ) values (
    p_tenant,
    p_liquidacion->>'clave_externa',
    p_liquidacion->>'huella',
    p_liquidacion->>'sistema_origen',
    (p_liquidacion->>'operador_id')::uuid,
    coalesce(array(select jsonb_array_elements_text(p_liquidacion->'folios_viaje')), '{}'::text[]),
    coalesce(array(select jsonb_array_elements_text(p_liquidacion->'viaje_ids')), '{}'::text[])::uuid[],
    (p_liquidacion->>'periodo_desde')::date,
    (p_liquidacion->>'periodo_hasta')::date,
    p_liquidacion->'conceptos',
    (p_liquidacion->>'total')::numeric,
    p_liquidacion->>'moneda',
    p_liquidacion->>'pdf_ruta',
    p_liquidacion->>'pdf_origen',
    p_liquidacion->>'pdf_sha256'
  )
  on conflict (tenant_id, clave_externa) do nothing
  returning id into v_id;

  if v_id is not null then
    v_nueva := true;
  else
    -- Ya existía (reintento o carrera). Se bloquea la fila para que dos
    -- reparaciones simultáneas no compitan.
    select l.id, l.huella into v_id, v_huella
      from public.liquidacion_externa l
     where l.tenant_id = p_tenant and l.clave_externa = p_liquidacion->>'clave_externa'
       for update;
    if v_id is null then
      raise exception 'liquidacion_externa desapareció durante la recepción';
    end if;
    if v_huella <> p_liquidacion->>'huella' then
      raise exception 'recibir_desglose_atomico: la clave ya existe con otro contenido' using errcode = 'P0001';
    end if;
  end if;

  -- Encabezado: PK por liquidación, así que reintentar no duplica ni pisa.
  select exists (select 1 from public.liquidacion_desglose d
                  where d.tenant_id = p_tenant and d.liquidacion_externa_id = v_id)
    into v_tiene_desg;
  if not v_tiene_desg then
    insert into public.liquidacion_desglose (
      liquidacion_externa_id, tenant_id, bitacora, terminal, poliza, unidad, tipo_operador, dias,
      total_origen, retenida_motivo, numero_liquidacion, numero_pago, bitacoras, correccion_n, folio_origen
    ) values (
      v_id, p_tenant,
      p_desglose->>'bitacora', p_desglose->>'terminal', p_desglose->>'poliza', p_desglose->>'unidad',
      p_desglose->>'tipo_operador', (p_desglose->>'dias')::smallint,
      p_desglose->>'total_origen', left(p_desglose->>'retenida_motivo', 1000),
      p_desglose->>'numero_liquidacion', p_desglose->>'numero_pago',
      case when jsonb_typeof(p_desglose->'bitacoras') = 'array'
           then array(select jsonb_array_elements_text(p_desglose->'bitacoras')) end,
      coalesce((p_desglose->>'correccion_n')::smallint, 0),
      left(nullif(btrim(p_desglose->>'folio_origen'), ''), 40)
    )
    on conflict (liquidacion_externa_id) do nothing;
    v_desg_nuevo := found;
    v_retenida := (p_desglose->>'retenida_motivo') is not null;
  else
    select (d.retenida_motivo is not null) into v_retenida
      from public.liquidacion_desglose d
     where d.tenant_id = p_tenant and d.liquidacion_externa_id = v_id;
  end if;

  if v_nueva or v_desg_nuevo then
    insert into public.liquidacion_externa_evento (liquidacion_externa_id, tenant_id, tipo, detalle)
    values (v_id, p_tenant, 'recibida', coalesce(p_evento, '{}'::jsonb));
  end if;

  -- Entregas: solo si no está retenido Y la liquidación aún no tiene NINGUNA (0923, A37-S63-08): un reintento con la
  -- misma huella pero otros destinatarios no le agrega un correo a alguien nuevo dentro de la misma generación.
  -- Idempotentes por el índice único (liquidación, generación, rol, lower(correo)).
  select exists (select 1 from public.liquidacion_entrega_correo e
                  where e.tenant_id = p_tenant and e.liquidacion_externa_id = v_id)
    into v_hay_entr;
  -- 0933/0940: un desglose RETENIDO sigue sin entregas al operador/coordinador/RH/archivo, pero el revisor del primer mes (rol
  -- `revisor`) sí recibe su aviso de «retenido»: es la única entrega que se admite en una retenida.
  if not v_hay_entr and jsonb_array_length(p_entregas) > 0 then
    insert into public.liquidacion_entrega_correo (
      tenant_id, liquidacion_externa_id, generacion, rol, correo, xlsx_ruta, xlsx_sha256, disparo, estado, ultimo_error
    )
    select p_tenant, v_id, 1, e->>'rol', lower(btrim(e->>'correo')), e->>'xlsx_ruta', e->>'xlsx_sha256',
           coalesce(e->>'disparo', 'auto'),
           -- 0940: una entrega puede nacer `omitida` (fecha de corte del arranque): sin cola, nadie la envía. Cualquier otro valor = pendiente.
           case when e->>'estado' = 'omitida' then 'omitida' else 'pendiente' end,
           case when e->>'estado' = 'omitida' then left(e->>'ultimo_error', 1000) end
      from jsonb_array_elements(p_entregas) e
     where not coalesce(v_retenida, false) or e->>'rol' = 'revisor'
    on conflict do nothing;
    get diagnostics v_n_entregas = row_count;
  end if;

  v_reparada := (not v_nueva) and (v_desg_nuevo or (v_n_entregas > 0 and not v_hay_entr));

  return jsonb_build_object(
    'liquidacion_id', v_id, 'creada', v_nueva, 'reparada', v_reparada, 'entregas', v_n_entregas
  );
end;
$$;

comment on function public.recibir_desglose_atomico(uuid, jsonb, jsonb, jsonb, jsonb) is
  '0857 + 0923 + 0929 + 0933 + 0940 + 1003: crea en UNA transacción la liquidación externa, su encabezado, el evento recibida y las entregas por correo; si la liquidación ya existe con la misma huella a medias (corte previo), completa lo que falta. 0923: al crear exige que viaje_ids sean de la flota (23503) y no agrega entregas a una liquidación que ya tiene alguna. 0929: el encabezado lleva correccion_n. 0933: en una retenida solo se admite la entrega al revisor del primer mes. 0940: cada entrega puede nacer `omitida` (fecha de corte del arranque). 1003: el encabezado lleva folio_origen (el número de bitácora que ve el operador). Misma clave con otra huella lanza P0001. Solo service_role.';

revoke all on function public.recibir_desglose_atomico(uuid, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.recibir_desglose_atomico(uuid, jsonb, jsonb, jsonb, jsonb)
  to service_role;
