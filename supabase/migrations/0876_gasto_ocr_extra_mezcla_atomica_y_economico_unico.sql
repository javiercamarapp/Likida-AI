-- REVERSA: drop function if exists public.gasto_mezclar_ocr_extra(uuid, uuid, jsonb, text, jsonb, numeric, boolean); drop index if exists public.uq_unidad_economico_ci; (ninguna tabla ni columna cambia; el código tolera la ausencia de ambos).
-- ═══════════════════════════════════════════════════════════════════════════
-- 0876 · lote B-sat-fiscal-06 (auditoría 37)
--
-- (1) A37-S45-10: `gasto_mezclar_ocr_extra`. `corregirMontoGasto` y
--     `marcarMontoDisputado` LEÍAN `ocr_extra`, le agregaban una clave y
--     reescribían la columna ENTERA: lo que la validación SAT o la ingesta del
--     XML escribieron entre la lectura y el UPDATE se perdía, dos correcciones
--     concurrentes perdían una entrada del historial `montoCorregido`, y un
--     gasto borrado a medias devolvía ok. Aquí el merge (`||`) y el append al
--     historial ocurren en UNA sentencia, contra la fila bloqueada, y se
--     devuelve cuántas filas tocó (0 = ya no existe, o dejó de cumplir la
--     condición `p_sin_xml_verificado`).
--
-- (2) A37-S46-10: índice único (tenant_id, lower(btrim(numero_economico))) en
--     `unidad`. `unidad_economico_unico` (0047) es sobre el texto crudo: «t-042»
--     y «T-042» eran dos unidades para la base y la misma para el jefe de
--     tráfico y para el mapeo GPS (que compara en minúsculas). Se crea SOLO si
--     no hay duplicados previos (si los hay, avisa con WARNING y no aborta: se
--     limpian y se reaplica la migración; no se adivina cuál unidad borrar).
--     Las placas ya tienen su índice (0290 `uq_unidad_placas_por_tenant`).
--
-- ADITIVA e IDEMPOTENTE: función nueva (create or replace) e índice if not
-- exists. Compatible hacia atrás con el código desplegado (no lo llama).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.gasto_mezclar_ocr_extra(
  p_tenant uuid,
  p_gasto uuid,
  -- claves a fusionar en ocr_extra (`||`): lo que trae gana sobre lo viejo, el resto sobrevive
  p_parche jsonb default '{}'::jsonb,
  -- si se pasan las dos, `p_historial_entrada` se AGREGA al arreglo `ocr_extra->p_historial_clave`
  -- (un valor suelto previo se vuelve el primer elemento; nada se pisa)
  p_historial_clave text default null,
  p_historial_entrada jsonb default null,
  -- si no es null, también cambia `gasto.monto`
  p_monto numeric default null,
  -- true = solo si el gasto NO está verificado con XML (el CFDI es la autoridad del monto)
  p_sin_xml_verificado boolean default false
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tocadas integer;
begin
  if p_parche is not null and jsonb_typeof(p_parche) <> 'object' then
    raise exception 'p_parche debe ser un objeto json';
  end if;
  if (p_historial_clave is null) <> (p_historial_entrada is null) then
    raise exception 'p_historial_clave y p_historial_entrada van juntas';
  end if;

  update public.gasto g
     set monto = coalesce(p_monto, g.monto),
         ocr_extra =
           (coalesce(g.ocr_extra, '{}'::jsonb) || coalesce(p_parche, '{}'::jsonb))
           || case
                when p_historial_clave is null then '{}'::jsonb
                else jsonb_build_object(
                  p_historial_clave,
                  (case coalesce(jsonb_typeof(coalesce(g.ocr_extra, '{}'::jsonb) -> p_historial_clave), 'null')
                     when 'array' then g.ocr_extra -> p_historial_clave
                     when 'null' then '[]'::jsonb
                     else jsonb_build_array(g.ocr_extra -> p_historial_clave)
                   end) || jsonb_build_array(p_historial_entrada)
                )
              end
   where g.id = p_gasto
     and g.tenant_id = p_tenant
     and (not p_sin_xml_verificado or not coalesce(g.xml_verificado, false));

  get diagnostics v_tocadas = row_count;
  return v_tocadas;
end $$;

revoke all on function public.gasto_mezclar_ocr_extra(uuid, uuid, jsonb, text, jsonb, numeric, boolean) from public, anon, authenticated;
grant execute on function public.gasto_mezclar_ocr_extra(uuid, uuid, jsonb, text, jsonb, numeric, boolean) to service_role;

comment on function public.gasto_mezclar_ocr_extra(uuid, uuid, jsonb, text, jsonb, numeric, boolean) is
  'A37-S45-10: merge atómico (||) de ocr_extra + append al historial + cambio opcional de monto, en una sentencia; devuelve filas tocadas.';

-- ── (2) Número económico único sin distinguir mayúsculas ─────────────────────
do $$
begin
  if exists (
    select 1 from public.unidad
     where numero_economico is not null
     group by tenant_id, lower(btrim(numero_economico))
    having count(*) > 1
  ) then
    raise warning '0876/A37-S46-10: hay unidades con el mismo número económico salvo mayúsculas/espacios en una misma flota; uq_unidad_economico_ci NO se creó. Unifica esas unidades y reaplica esta migración.';
  else
    create unique index if not exists uq_unidad_economico_ci
      on public.unidad (tenant_id, lower(btrim(numero_economico)))
      where numero_economico is not null;
    comment on index public.uq_unidad_economico_ci is
      'A37-S46-10: el número económico es único por flota sin importar mayúsculas ni espacios de orilla (el mapeo GPS ya compara en minúsculas).';
  end if;
end $$;
