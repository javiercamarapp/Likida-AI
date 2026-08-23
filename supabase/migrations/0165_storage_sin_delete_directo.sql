-- ═══════════════════════════════════════════════════════════════════════════
-- 0165 — SUPABASE PROHÍBE BORRAR DE `storage.objects` DESDE SQL, y por eso el
--        mantenimiento nocturno ENTERO dejaba de correr.
--
-- QUÉ PASÓ, MEDIDO EN PRODUCCIÓN (22-ago-2026): al llamar
-- `mantenimiento_de_datos()` la base contestó
--
--     42501: Direct deletion from storage tables is not allowed.
--            Use the Storage API instead.
--     CONTEXT: PL/pgSQL function storage.protect_delete()
--
-- La 0162 borraba los objetos huérfanos con un `delete from storage.objects`.
-- Supabase le puso un trigger `protect_delete` justamente para que nadie deje
-- el almacén con archivos sin catálogo. La consecuencia NO era perder la
-- limpieza: era perderlo todo. Las catorce purgas iban en fila dentro de una
-- función; la que lanza se lleva a las que faltan. Las de PRIVACIDAD
-- (`wa_conversacion` a 180 días, `prospecto_persona` a 365) son de las
-- últimas, y son exactamente las que un aviso público promete cumplir.
--
-- DOS ARREGLOS, uno por cada mitad del problema:
--
-- 1. `limpiar_storage_huerfano` ya no borra: MARCA. Escribe los huérfanos en
--    `storage_huerfano_candidato` y el borrado real lo hace el servidor con
--    la Storage API, que es lo que Supabase pide. Detectar sigue siendo la
--    parte difícil (los tres cinturones de la 0162: gracia de 7 días,
--    anti-join contra `comprobante_huerfano.ruta_imagen` y contra
--    `liquidacion_historico.pdf_url`), y esa parte no cambia. Marcar además
--    deja el borrado REVISABLE antes de que ocurra, que para evidencia
--    fiscal es mejor que borrar y avisar.
--
-- 2. `mantenimiento_de_datos` mete CADA purga en su propio bloque con su
--    `exception`. Una que falle se anota en `fallos` y las trece restantes
--    corren igual. El resultado deja de ser "todo o nada" y el cron puede
--    gritar con el nombre de la que falló en vez de con un error opaco.
--
-- Comprobado en producción tras aplicarla: `fallos: []`, 75 objetos revisados
-- y 25 marcados (comprobantes y PDFs de los viajes que se borraron el 20-ago).
-- IDEMPOTENTE.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.storage_huerfano_candidato (
  bucket       text not null,
  nombre       text not null,
  motivo       text not null,
  detectado_en timestamptz not null default now(),
  borrado_en   timestamptz,
  primary key (bucket, nombre)
);

comment on table public.storage_huerfano_candidato is
  'Objetos de Storage que el barrido juzgó huérfanos y que el servidor tiene que borrar por la Storage API (0165). `borrado_en` lo sella quien lo borra. Deny-all: RLS activo y sin policies.';

alter table public.storage_huerfano_candidato enable row level security;

create index if not exists storage_huerfano_por_borrar_idx
  on public.storage_huerfano_candidato (bucket, detectado_en)
  where borrado_en is null;

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
  vence     timestamptz := coalesce(p_vence, clock_timestamp() + interval '20 seconds');
  gracia    integer     := greatest(coalesce(p_gracia_dias, 7), 1);
  corte     timestamptz := p_ahora - make_interval(days => gracia);
  tanda     integer     := least(greatest(coalesce(p_tanda, 500), 1), 5000);
  v_bucket  text;
  v_cursor  text;
  v_ultimo  text;
  v_leidos  integer;
  v_marc    bigint;
  revisados bigint  := 0;
  marcados  bigint  := 0;
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
               case when p.seg[1] = 'informes' and cardinality(p.seg) = 3
                    then p.seg[2]
                    else p.seg[1]
               end as tenant_txt,
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
        select j.id, j.name,
               case when public.es_uuid(j.tenant_txt)
                     and not exists (select 1 from public.tenant t where t.id = j.tenant_txt::uuid)
                    then 'flota_inexistente' else 'viaje_inexistente' end as motivo
          from juicio j
         where j.created_at < corte
           and (
             (public.es_uuid(j.tenant_txt)
              and not exists (select 1 from public.tenant t where t.id = j.tenant_txt::uuid))
             or (j.viaje_txt is not null and public.es_uuid(j.viaje_txt)
                 and not exists (select 1 from public.viaje v where v.id = j.viaje_txt::uuid))
           )
           and not exists (
             select 1 from public.comprobante_huerfano h where h.ruta_imagen = j.name
           )
           and not exists (
             select 1 from public.liquidacion_historico lh where lh.pdf_url = j.name
           )
      ),
      marcado as (
        insert into public.storage_huerfano_candidato (bucket, nombre, motivo)
        select v_bucket, c.name, c.motivo from condenados c
        on conflict (bucket, nombre) do nothing
        returning nombre
      )
      select (select count(*) from lote),
             (select max(name) from lote),
             (select count(*) from marcado)
        into v_leidos, v_ultimo, v_marc;

      revisados := revisados + coalesce(v_leidos, 0);
      marcados  := marcados  + coalesce(v_marc, 0);

      if coalesce(v_leidos, 0) = 0 then
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
    'marcados',  marcados,
    'borrados',  0,
    'parcial',   parcial,
    'graciaDias', gracia
  );
end;
$$;

comment on function public.limpiar_storage_huerfano(integer, integer, timestamptz, timestamptz) is
  'MARCA (no borra: Supabase lo prohíbe, ver 0165) en storage_huerfano_candidato lo que un barrido ROTATIVO de storage.objects (buckets comprobantes y liquidaciones) que borra SOLO huérfanos por estructura: la flota ya no existe, o el viaje ya no existe (DAT-35). Nunca toca un objeto de menos de p_gracia_dias, ni uno nombrado por comprobante_huerfano.ruta_imagen o liquidacion_historico.pdf_url — las dos tablas que sobreviven al borrado del viaje. NO libera los bytes del almacén S3, solo el catálogo (ver la cabecera de la 0162). La llama mantenimiento_de_datos.';

revoke all on function public.limpiar_storage_huerfano(integer, integer, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.limpiar_storage_huerfano(integer, integer, timestamptz, timestamptz) to service_role;


revoke all on function public.limpiar_storage_huerfano(integer, integer, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.limpiar_storage_huerfano(integer, integer, timestamptz, timestamptz) to service_role;

-- ── CADA PURGA EN SU PROPIO BLOQUE ──────────────────────────────────────────
-- Iban en fila: la primera que lanzara se llevaba las trece restantes. Ahora
-- cada una falla sola, su error queda en `fallos` y el resto corre igual.
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
  wa jsonb := '{}'::jsonb; eventos jsonb := '{}'::jsonb; posiciones jsonb := '{}'::jsonb;
  llm jsonb := '{}'::jsonb; bitacora jsonb := '{}'::jsonb; cobranza jsonb := '{}'::jsonb;
  storage_huerfano jsonb := '{}'::jsonb;
  ia_consolidados bigint := 0; idem_purgadas bigint := 0; correo_purgado bigint := 0;
  corridas_purgadas bigint := 0; conversaciones_purgadas bigint := 0;
  codigos_purgados bigint := 0; personas_purgadas bigint := 0;
  fallos text[] := '{}';
begin
  begin wa := public.purgar_wa_mensaje_procesado(p_dias_wa, p_ahora, vence);
  exception when others then fallos := fallos || ('wa_mensaje_procesado: ' || sqlerrm); end;
  begin ia_consolidados := public.consolidar_llm_costo_mensual(p_ahora);
  exception when others then fallos := fallos || ('consolidar_llm_costo: ' || sqlerrm); end;
  begin idem_purgadas := public.purgar_api_idempotencia(7, p_ahora);
  exception when others then fallos := fallos || ('api_idempotencia: ' || sqlerrm); end;
  begin correo_purgado := public.purgar_correo_procesado(90, p_ahora);
  exception when others then fallos := fallos || ('correo_procesado: ' || sqlerrm); end;
  begin corridas_purgadas := public.purgar_agente_corrida(180, p_ahora);
  exception when others then fallos := fallos || ('agente_corrida: ' || sqlerrm); end;
  begin conversaciones_purgadas := public.purgar_wa_conversacion(180, p_ahora);
  exception when others then fallos := fallos || ('wa_conversacion: ' || sqlerrm); end;
  begin codigos_purgados := public.purgar_codigo_pendiente(180, p_ahora);
  exception when others then fallos := fallos || ('codigo_pendiente: ' || sqlerrm); end;
  begin personas_purgadas := public.purgar_prospecto_persona(365, p_ahora);
  exception when others then fallos := fallos || ('prospecto_persona: ' || sqlerrm); end;
  begin eventos := public.purgar_wa_evento_pendiente(30, 90, p_ahora, vence);
  exception when others then fallos := fallos || ('wa_evento_pendiente: ' || sqlerrm); end;
  begin posiciones := public.purgar_posicion(90, p_ahora, vence);
  exception when others then fallos := fallos || ('posicion: ' || sqlerrm); end;
  begin llm := public.purgar_llm_costo(13, p_ahora, vence);
  exception when others then fallos := fallos || ('llm_costo: ' || sqlerrm); end;
  begin bitacora := public.purgar_bitacora_auditoria(365, p_ahora, vence);
  exception when others then fallos := fallos || ('bitacora_auditoria: ' || sqlerrm); end;
  begin cobranza := public.purgar_cobranza_contacto(180, p_ahora, vence);
  exception when others then fallos := fallos || ('cobranza_contacto: ' || sqlerrm); end;
  begin storage_huerfano := public.limpiar_storage_huerfano(7, 500, p_ahora, vence);
  exception when others then fallos := fallos || ('storage_huerfano: ' || sqlerrm); end;

  return jsonb_build_object(
    'waPurgados', coalesce((wa->>'borradas')::bigint, 0),
    'diasWa', p_dias_wa,
    'iaConsolidados', ia_consolidados,
    'llmCostoPurgado', coalesce((llm->>'borradas')::bigint, 0),
    'idempotenciaPurgada', idem_purgadas,
    'correoPurgado', correo_purgado,
    'corridasPurgadas', corridas_purgadas,
    'conversacionesPurgadas', conversaciones_purgadas,
    'codigosPurgados', codigos_purgados,
    'prospectoPersonasPurgadas', personas_purgadas,
    'waEventosPurgados', coalesce((eventos->>'borradas')::bigint, 0),
    'posicionesPurgadas', coalesce((posiciones->>'borradas')::bigint, 0),
    'bitacoraPurgada', coalesce((bitacora->>'borradas')::bigint, 0),
    'cobranzaContactosPurgados', coalesce((cobranza->>'borradas')::bigint, 0),
    'storageHuerfanoMarcado', coalesce((storage_huerfano->>'marcados')::bigint, 0),
    'storageHuerfanoRevisado', coalesce((storage_huerfano->>'revisados')::bigint, 0),
    'fallos', to_jsonb(fallos),
    'parcial', coalesce((wa->>'parcial')::boolean, false) or coalesce((eventos->>'parcial')::boolean, false)
             or coalesce((posiciones->>'parcial')::boolean, false) or coalesce((llm->>'parcial')::boolean, false)
             or coalesce((bitacora->>'parcial')::boolean, false) or coalesce((cobranza->>'parcial')::boolean, false)
             or coalesce((storage_huerfano->>'parcial')::boolean, false)
             or cardinality(fallos) > 0,
    'corridaEn', p_ahora
  );
end;
$$;

revoke all on function public.mantenimiento_de_datos(integer, timestamptz) from public, anon, authenticated;
grant execute on function public.mantenimiento_de_datos(integer, timestamptz) to service_role;
