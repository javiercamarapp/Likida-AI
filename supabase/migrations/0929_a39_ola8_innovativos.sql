-- REVERSA: (1) solo si NO hay filas con correccion_n > 0 (anula o borra antes las correcciones -R<n>): create unique index if not exists public.liquidacion_desglose_bitacora_unica on public.liquidacion_desglose (tenant_id, coalesce(terminal, ''), bitacora); create unique index if not exists public.liquidacion_desglose_numero_liquidacion_unico on public.liquidacion_desglose (tenant_id, coalesce(terminal, ''), numero_liquidacion) where numero_liquidacion is not null; drop index if exists public.liquidacion_desglose_bitacora_unica_v2; drop index if exists public.liquidacion_desglose_numero_liquidacion_unico_v2; alter table public.liquidacion_desglose drop column if exists correccion_n; y volver a aplicar el cuerpo de `recibir_desglose_atomico` de 0923_a37_z_resto_14_defensa_en_base.sql (create or replace misma firma + revoke/grant). (2) solo si no hay dos reclamos activos (estado <> 'rechazado') con la misma flota+desglose+categoría (junta o rechaza los extra): create unique index if not exists public.peaje_reclamo_activo_unico on public.peaje_reclamo (tenant_id, desglose_id, categoria) where estado <> 'rechazado'; drop index if exists public.peaje_reclamo_activo_unico_v2; alter table public.peaje_reclamo drop column if exists lote.
-- ═══════════════════════════════════════════════════════════════════════════
-- 0929 · Ola 8 (auditoría 39) · lote O8-5 «innovativos» — DOS candados de unicidad que impedían un flujo legítimo contra la base real.
--
-- ADITIVA e IDEMPOTENTE; COMPATIBLE HACIA ATRÁS: el código desplegado hoy no manda `correccion_n` ni `lote` (toman 0 por omisión: las
-- filas nuevas se comportan igual que antes) y el código nuevo tolera su ausencia (cae al camino anterior y lo avisa).
--
--  1. A39-A1-01 · La corrección `-R<n>` (arreglo de A37-A1-02) era IMPOSIBLE contra la base real. La corrección es una liquidación
--     nueva (`<clave>-R<n>`), pero su encabezado comparte flota, terminal, bitácora y número de liquidación con la original, y los
--     índices únicos de 0786 (bitácora) y 0789 (número de liquidación) la rechazaban con 23505. La prueba pasaba con un doble.
--     Ahora `liquidacion_desglose.correccion_n` (0 = la original; n ≥ 1 = su n-ésima corrección) entra en AMBAS llaves únicas y
--     `recibir_desglose_atomico` (redefinida desde 0923, mismo cuerpo) lo escribe. Dos originales o dos copias de la misma corrección
--     siguen chocando: la unicidad por bitácora no se afloja, solo distingue la corrección de su original.
--
--  2. A39-S14-01 · Reclamar candidatos por SEGUNDA vez en la misma categoría y desglose fallaba para siempre (variante de INN-A2-01).
--     `peaje_reclamo_activo_unico` (0847) era (flota, desglose, categoría): el primer reclamo (ya enviado al portal) bloqueaba
--     cualquier tanda posterior de candidatos de esa categoría. Ahora `peaje_reclamo.lote` (0 = reclamo de la categoría COMPLETA, que
--     conserva su candado contra el doble envío; 1, 2… = cada tanda de candidatos, disjuntas porque cada candidato tiene UNA decisión
--     por renglón en `peaje_candidato_accion`). Los reclamos que ya nacieron de una tanda de candidatos (los que tienen decisiones
--     ligadas) se reclasifican a lote 1: así el que hoy está atorado se libera.
--
-- No enciende nada, no toca permisos de tablas: la función conserva revoke de anon/authenticated y grant solo a service_role.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. A39-A1-01 ────────────────────────────────────────────────────────────

alter table public.liquidacion_desglose
  add column if not exists correccion_n smallint not null default 0;

alter table public.liquidacion_desglose
  drop constraint if exists liquidacion_desglose_correccion_rango;
alter table public.liquidacion_desglose
  add constraint liquidacion_desglose_correccion_rango check (correccion_n between 0 and 20);

comment on column public.liquidacion_desglose.correccion_n is
  '0929 (A39-A1-01): 0 = la bitácora original; n ≥ 1 = su corrección -R<n> (A37-A1-02). Entra en las llaves únicas de bitácora y de número de liquidación para que la corrección (misma bitácora, terminal y número) no choque con la original. Máximo 20 (MAX_CORRECCIONES).';

-- Los índices nuevos se crean ANTES de soltar los viejos (nunca queda la tabla sin candado) y son estrictamente más débiles en la
-- corrección: toda fila que cumplía el índice viejo cumple el nuevo, así que crearlos no puede fallar por datos existentes.
create unique index if not exists liquidacion_desglose_bitacora_unica_v2
  on public.liquidacion_desglose (tenant_id, coalesce(terminal, ''), bitacora, correccion_n);

create unique index if not exists liquidacion_desglose_numero_liquidacion_unico_v2
  on public.liquidacion_desglose (tenant_id, coalesce(terminal, ''), numero_liquidacion, correccion_n)
  where numero_liquidacion is not null;

drop index if exists public.liquidacion_desglose_bitacora_unica;
drop index if exists public.liquidacion_desglose_numero_liquidacion_unico;

comment on index public.liquidacion_desglose_bitacora_unica_v2 is
  '0929: una bitácora es única por flota+terminal+corrección (la corrección -R<n> comparte bitácora con su original). Sustituye a liquidacion_desglose_bitacora_unica (0786).';
comment on index public.liquidacion_desglose_numero_liquidacion_unico_v2 is
  '0929: el número de liquidación es único por flota+terminal+corrección. Sustituye a liquidacion_desglose_numero_liquidacion_unico (0789).';

-- Misma función que 0923 (viaje_ids de la flota, entregas solo si no hay ninguna), con UNA diferencia: el encabezado escribe
-- `correccion_n` (coalesce a 0 si el llamador no lo manda).
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
      total_origen, retenida_motivo, numero_liquidacion, numero_pago, bitacoras, correccion_n
    ) values (
      v_id, p_tenant,
      p_desglose->>'bitacora', p_desglose->>'terminal', p_desglose->>'poliza', p_desglose->>'unidad',
      p_desglose->>'tipo_operador', (p_desglose->>'dias')::smallint,
      p_desglose->>'total_origen', left(p_desglose->>'retenida_motivo', 1000),
      p_desglose->>'numero_liquidacion', p_desglose->>'numero_pago',
      case when jsonb_typeof(p_desglose->'bitacoras') = 'array'
           then array(select jsonb_array_elements_text(p_desglose->'bitacoras')) end,
      coalesce((p_desglose->>'correccion_n')::smallint, 0)
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
  if not coalesce(v_retenida, false) and not v_hay_entr and jsonb_array_length(p_entregas) > 0 then
    insert into public.liquidacion_entrega_correo (
      tenant_id, liquidacion_externa_id, generacion, rol, correo, xlsx_ruta, xlsx_sha256, disparo
    )
    select p_tenant, v_id, 1, e->>'rol', lower(btrim(e->>'correo')), e->>'xlsx_ruta', e->>'xlsx_sha256',
           coalesce(e->>'disparo', 'auto')
      from jsonb_array_elements(p_entregas) e
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
  '0857 + 0923 + 0929: crea en UNA transacción la liquidación externa, su encabezado, el evento recibida y las entregas por correo; si la liquidación ya existe con la misma huella a medias (corte previo), completa lo que falta. 0923: al crear exige que viaje_ids sean de la flota (23503) y no agrega entregas a una liquidación que ya tiene alguna. 0929: el encabezado lleva correccion_n (0 original, n ≥ 1 corrección -R<n>) para no chocar con los índices únicos de bitácora y número. Misma clave con otra huella lanza P0001. Solo service_role.';

revoke all on function public.recibir_desglose_atomico(uuid, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.recibir_desglose_atomico(uuid, jsonb, jsonb, jsonb, jsonb)
  to service_role;

-- ── 2. A39-S14-01 ───────────────────────────────────────────────────────────

alter table public.peaje_reclamo
  add column if not exists lote smallint not null default 0;

alter table public.peaje_reclamo
  drop constraint if exists peaje_reclamo_lote_rango;
alter table public.peaje_reclamo
  add constraint peaje_reclamo_lote_rango check (lote between 0 and 1000);

comment on column public.peaje_reclamo.lote is
  '0929 (A39-S14-01): 0 = reclamo de la categoría COMPLETA (su doble envío sigue chocando con el índice); 1, 2… = cada tanda de candidatos reclamada de esa categoría (disjuntas: cada candidato tiene una decisión única por renglón en peaje_candidato_accion).';

-- Los reclamos que ya nacieron de una tanda de candidatos (tienen decisiones ligadas) eran lote 0 por omisión: se reclasifican a 1
-- para que la categoría de un desglose atorado hoy pueda recibir la siguiente tanda. A lo sumo UNO activo por (flota, desglose,
-- categoría) cumplía el índice viejo, así que no puede haber dos con lote 1 activos. Idempotente: la segunda corrida no encuentra lote 0.
update public.peaje_reclamo r
   set lote = 1
 where r.lote = 0
   and exists (select 1 from public.peaje_candidato_accion a
                where a.tenant_id = r.tenant_id and a.reclamo_id = r.id and a.accion = 'reclamado');

create unique index if not exists peaje_reclamo_activo_unico_v2
  on public.peaje_reclamo (tenant_id, desglose_id, categoria, lote)
  where estado <> 'rechazado';

drop index if exists public.peaje_reclamo_activo_unico;

comment on index public.peaje_reclamo_activo_unico_v2 is
  '0929: un reclamo ACTIVO (no rechazado) por flota+desglose+categoría+lote. Conserva el candado contra el doble envío de "Registrar reclamo" (lote 0) y permite una tanda nueva de candidatos de la misma categoría (lote siguiente). Sustituye a peaje_reclamo_activo_unico (0847).';
