-- 0178 — Correcciones de cumplimiento después de las migraciones 0173–0177.
--
-- 1) Una oposición a decisiones automatizadas NO es una cancelación: detiene
--    la automatización/requiere revisión humana, pero no anonimiza ni borra.
-- 2) La evidencia fiscal no entra a la cola de borrado de Storage. CFF art. 30
--    obliga a conservarla al menos cinco años; una solicitud ARCO no vence esa
--    obligación. Se clasifica explícitamente para que el ejecutor HTTP tenga
--    una segunda barrera además de la consulta que lo llena.
-- 3) Los layouts ERP son configuración POR FLOTA y exigen una plantilla
--    confirmada. No se guardan credenciales aquí: un archivo no las necesita.

-- ── Clases de retención de Storage ────────────────────────────────────────
alter table public.storage_huerfano_candidato
  add column if not exists clase_retencion text not null default 'operativa';

alter table public.storage_huerfano_candidato
  drop constraint if exists storage_huerfano_clase_retencion_dominio;
alter table public.storage_huerfano_candidato
  add constraint storage_huerfano_clase_retencion_dominio
  check (clase_retencion in ('operativa', 'fiscal_cff_30'));

-- Las filas que 0173 metió como `arco` son, por definición, imágenes de gasto:
-- se conservan. No se las borra retroactivamente solo porque ya estén en cola.
update public.storage_huerfano_candidato
   set clase_retencion = 'fiscal_cff_30'
 where motivo = 'arco' and borrado_en is null;

create or replace function public.clasificar_retencion_storage_candidato()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  -- Toda referencia viva a comprobante, liquidación o historial es evidencia
  -- fiscal/documental. La cola puede conservar la observación, pero el
  -- borrador HTTP no puede borrar el objeto.
  if exists (
    select 1 from public.gasto g
     where g.imagen_url is not null and position(new.nombre in g.imagen_url) > 0
  ) or exists (
    select 1 from public.comprobante_huerfano h
     where h.ruta_imagen = new.nombre
  ) or exists (
    select 1 from public.liquidacion_historico lh
     where lh.pdf_url = new.nombre
  ) then
    new.clase_retencion := 'fiscal_cff_30';
  end if;
  return new;
end;
$$;

-- Las funciones trigger se ejecutan por el trigger aunque el llamador no
-- tenga EXECUTE. Cerrarla evita que aparezca como SECURITY DEFINER pública y
-- mantiene la misma política deny-all que el resto de helpers internos.
revoke all on function public.clasificar_retencion_storage_candidato() from public, anon, authenticated;

drop trigger if exists trg_storage_candidato_retencion on public.storage_huerfano_candidato;
create trigger trg_storage_candidato_retencion
before insert or update on public.storage_huerfano_candidato
for each row execute function public.clasificar_retencion_storage_candidato();

comment on column public.storage_huerfano_candidato.clase_retencion is
  'operativa = el ejecutor puede borrar si la API confirma; fiscal_cff_30 = evidencia fiscal/documental retenida por CFF art. 30, nunca se borra desde esta cola.';

-- ── ARCO: cancelación y oposición son flujos distintos ────────────────────
create or replace function public.ejecutar_arco_cancelacion(
  p_tenant uuid,
  p_solicitud uuid
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_operador uuid;
  v_tipo text;
  v_estado text;
  ev jsonb := '{}'::jsonb;
  n int;
  seudonimo text;
begin
  select operador_id, tipo, estado into v_operador, v_tipo, v_estado
    from solicitud_arco where id = p_solicitud and tenant_id = p_tenant;

  if v_operador is null then
    return jsonb_build_object('ok', false, 'motivo', 'solicitud sin operador o de otra flota');
  end if;
  if v_tipo <> 'cancelacion' then
    return jsonb_build_object(
      'ok', false,
      'motivo', case when v_tipo = 'oposicion'
        then 'la oposición no cancela ni anonimiza datos; conserva la revisión humana de decisiones automatizadas'
        else 'esta función solo ejecuta solicitudes de cancelación'
      end
    );
  end if;
  if v_estado in ('resuelta', 'improcedente') then
    return jsonb_build_object('ok', false, 'motivo', 'ya estaba cerrada');
  end if;

  seudonimo := 'Operador ' || upper(substr(encode(digest(v_operador::text, 'sha256'), 'hex'), 1, 6));

  -- Las imágenes de gasto/CFDI se CONSERVAN: son evidencia fiscal. La antigua
  -- 0173 las ponía en una cola de borrado; 0178 no promete ese borrado.
  ev := ev || jsonb_build_object('evidencia_fiscal_retenida', true, 'fundamento_retencion', 'CFF art. 30');

  delete from wa_conversacion where tenant_id = p_tenant and operador_id = v_operador;
  get diagnostics n = row_count; ev := ev || jsonb_build_object('wa_conversacion', n);

  delete from envio_mensaje e
   where e.tenant_id = p_tenant
     and e.telefono = (select telefono from operador where id = v_operador);
  get diagnostics n = row_count; ev := ev || jsonb_build_object('envio_mensaje', n);

  update operador
     set nombre = seudonimo,
         telefono = 'anon:' || substr(encode(digest(v_operador::text || 'tel', 'sha256'), 'hex'), 1, 16),
         anonimizado_en = now()
   where id = v_operador and tenant_id = p_tenant;
  get diagnostics n = row_count; ev := ev || jsonb_build_object('operador_anonimizado', n);

  update app_user
     set nombre = seudonimo, telefono = null, avatar_url = null
   where operador_id = v_operador;
  get diagnostics n = row_count; ev := ev || jsonb_build_object('app_user_anonimizado', n);

  update solicitud_arco
     set estado = 'resuelta', resuelta_en = now(), ejecutada_en = now(), evidencia = ev,
         resolucion = coalesce(resolucion, 'Cancelación ejecutada: datos personales anonimizados. La documentación fiscal se conserva por el art. 30 del CFF y queda desligada del titular.')
   where id = p_solicitud and tenant_id = p_tenant;

  return jsonb_build_object('ok', true, 'evidencia', ev, 'seudonimo', seudonimo);
end;
$$;

create or replace function public.ejecutar_arco_oposicion(
  p_tenant uuid,
  p_solicitud uuid
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_operador uuid;
  v_tipo text;
begin
  select operador_id, tipo into v_operador, v_tipo
    from solicitud_arco where id = p_solicitud and tenant_id = p_tenant;
  if v_operador is null or v_tipo <> 'oposicion' then
    return jsonb_build_object('ok', false, 'motivo', 'solicitud de oposición inexistente o de otra flota');
  end if;
  -- La oposición ya se materializa en operador.oposicion_automatizada (0100).
  -- Aquí solo queda evidencia del flujo, sin tocar identidad ni documentos.
  update solicitud_arco
     set estado = 'en_proceso',
         evidencia = coalesce(evidencia, '{}'::jsonb) || jsonb_build_object(
           'oposicion_automatizada_vigente', true,
           'accion', 'requiere_revision_humana; no se cancelaron datos'
         )
   where id = p_solicitud and tenant_id = p_tenant
     and estado not in ('resuelta', 'improcedente');
  return jsonb_build_object('ok', true, 'accion', 'oposicion registrada; requiere revisión humana');
end;
$$;

revoke all on function public.ejecutar_arco_cancelacion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ejecutar_arco_cancelacion(uuid, uuid) to service_role;
revoke all on function public.ejecutar_arco_oposicion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ejecutar_arco_oposicion(uuid, uuid) to service_role;

-- ── Perfil ERP por tenant, sin credenciales ───────────────────────────────
create table if not exists public.erp_export_perfil (
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  sistema       text not null check (sistema in ('contpaqi', 'sap_b1')),
  plantilla     jsonb not null,
  confirmado_en timestamptz not null,
  confirmado_por uuid references public.app_user(id) on delete set null,
  actualizado_en timestamptz not null default now(),
  primary key (tenant_id, sistema),
  check (jsonb_typeof(plantilla) = 'object')
);

alter table public.erp_export_perfil enable row level security;
comment on table public.erp_export_perfil is
  'Perfil de exportación ERP por flota. `confirmado_en` exige que el contador haya contrastado la plantilla con una instancia/archivo real; no almacena credenciales ni afirma una conexión viva.';

-- ── 0175: una base desconocida no se sustituye por el total ───────────────
-- El primer RPC de póliza hacía `coalesce(sub_total, monto)` y llamaba a eso
-- base. Eso mezclaba IVA dentro de la cuenta de gasto y luego intentaba cargar
-- el IVA por separado. El conteo `baseEstimada` no deshace un asiento ya
-- fabricado. Desde aquí el dato queda explícitamente desconocido y la ruta
-- HTTP bloquea el archivo hasta que llegue el XML/base correcta.
create or replace function public.poliza_datos_tenant(
  p_tenant uuid,
  p_desde  date,
  p_hasta  date
) returns jsonb
language sql
stable parallel safe
set search_path = public, pg_catalog
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'liquidacionId',  l.id,
    'folioViaje',     coalesce(v.folio, ''),
    'operador',       coalesce(o.nombre, ''),
    'fecha',          (l.created_at at time zone 'America/Mexico_City')::date,
    'anticipo',       coalesce(l.total_anticipo, 0),
    'comprobado',     coalesce(l.total_comprobado, 0),
    'diferencia',     coalesce(l.diferencia, 0),
    'ivaAcreditable', coalesce(l.iva_acreditable, 0),
    'porConcepto',    coalesce(g.desglose, '[]'::jsonb),
    'baseDesconocida', coalesce(g.sin_subtotal, 0)
  ) order by l.created_at), '[]'::jsonb)
  from liquidacion l
  join viaje v on v.id = l.viaje_id
  left join operador o on o.id = v.operador_id
  left join lateral (
    select
      jsonb_agg(jsonb_build_object(
        'concepto', t.concepto,
        'subtotal', case when t.base_conocida then t.base else null end,
        'baseConocida', t.base_conocida
      ) order by t.concepto) as desglose,
      sum(t.sin_sub) as sin_subtotal
    from (
      select gg.concepto,
             sum(gg.sub_total) filter (where gg.sub_total is not null) as base,
             bool_and(gg.sub_total is not null) as base_conocida,
             count(*) filter (where gg.sub_total is null) as sin_sub
        from gasto gg
       where gg.tenant_id = p_tenant and gg.viaje_id = l.viaje_id
       group by gg.concepto
    ) t
  ) g on true
 where l.tenant_id = p_tenant
   and (l.created_at at time zone 'America/Mexico_City')::date >= p_desde
   and (l.created_at at time zone 'America/Mexico_City')::date <= p_hasta;
$$;

revoke all on function public.poliza_datos_tenant(uuid, date, date) from public, anon, authenticated;
grant execute on function public.poliza_datos_tenant(uuid, date, date) to service_role;
