-- 0560 — `encolar_wa_outbox_dedupe` deja de ser solo de GPS: acepta la entrega
-- de liquidaciones externas (Agente 1).
--
-- EL HALLAZGO. La 0324/0328/0333 dejaron esta RPC con una validación que solo
-- reconoce la alerta GPS: la llave tiene que empezar con `gps:` y el payload tiene
-- que ser la plantilla `gps_alerta_critica`. La entrega de liquidaciones externas
-- (`liquidacion_externa/entrega.ts`, ola 1) la usa con llaves `liqext:…` y
-- payloads de otra forma, así que contra la base real cada intento de encolar
-- habría levantado «dedupe_key GPS inválida» y TODA liquidación habría terminado
-- `fallida` tras cinco reintentos. Las pruebas unitarias no lo veían porque
-- simulan la RPC.
--
-- QUÉ HACE. La función se reescribe ENTERA (no se apila sobre la 0333):
--   · rama `gps:%`      — la validación de la 0333, sin cambios;
--   · rama `liqext:%`   — llave con forma `liqext:<uuid>:g<n>:(sesion|plantilla)`;
--       · `:sesion`     → mensaje interactivo de botones con ENCABEZADO DE
--                          DOCUMENTO (https), cuerpo ≤ 1024 y exactamente dos
--                          botones de respuesta (id ≤ 256, título ≤ 20, prefijos
--                          `liqext_ok:` / `liqext_no:`);
--       · `:plantilla`  → plantilla `liquidacion_externa_v1` es_MX con encabezado
--                          de documento https, cuerpo de 4 variables de texto y
--                          dos botones de respuesta rápida.
--     El sufijo de la llave tiene que coincidir con el tipo del payload: una llave
--     de sesión con un payload de plantilla (o al revés) es un error de programa
--     que aquí se corta en vez de mandar el mensaje equivocado.
--   · cualquier otro prefijo se rechaza. Es a propósito: esta RPC es `security
--     definer` y escribe una cola que termina en el teléfono de una persona; cada
--     agente que quiera usarla añade SU rama con SU contrato.
--
-- Forward-only. Mismo cuerpo de salida y mismos grants que la 0333.

create or replace function public.encolar_wa_outbox_dedupe(
  p_dedupe_key text, p_payload jsonb, p_error text default null
) returns table(id uuid, estado text, provider_message_id text)
language plpgsql security definer set search_path='' as $$
declare
  v_botones jsonb;
  v_comps   jsonb;
  v_ok      boolean;
begin
  if btrim(coalesce(p_dedupe_key,''))='' or length(p_dedupe_key)>300 then
    raise exception 'dedupe_key WA inválida';
  end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object'
     or coalesce(p_payload->>'messaging_product','')<>'whatsapp'
     or coalesce(p_payload->>'to','') !~ '^[1-9][0-9]{7,14}$' then
    raise exception 'payload WA inválido: messaging_product/to';
  end if;

  if p_dedupe_key like 'gps:%' then
    -- ── GPS: la validación de la 0333, intacta ───────────────────────────────
    if p_payload->>'type'<>'template'
       or p_payload->'template'->>'name' <> 'gps_alerta_critica'
       or p_payload->'template'->'language'->>'code' <> 'es_MX'
       or (case when jsonb_typeof(p_payload->'template'->'components')='array'
            then jsonb_array_length(p_payload->'template'->'components')<>2 else true end)
       or not exists (
         select 1 from jsonb_array_elements(case when jsonb_typeof(p_payload->'template'->'components')='array'
           then p_payload->'template'->'components' else '[]'::jsonb end) c
         where c->>'type'='body'
           and (case when jsonb_typeof(c->'parameters')='array' then jsonb_array_length(c->'parameters')=1 else false end)
           and c->'parameters'->0->>'type'='text'
           and nullif(btrim(c->'parameters'->0->>'text'),'') is not null
           and char_length(c->'parameters'->0->>'text')<=1024)
       or not exists (
         select 1 from jsonb_array_elements(case when jsonb_typeof(p_payload->'template'->'components')='array'
           then p_payload->'template'->'components' else '[]'::jsonb end) c
         where c->>'type'='button' and c->>'sub_type'='quick_reply' and c->>'index'='0'
           and (case when jsonb_typeof(c->'parameters')='array' then jsonb_array_length(c->'parameters')=1 else false end)
           and c->'parameters'->0->>'type'='payload'
           and nullif(btrim(c->'parameters'->0->>'payload'),'') is not null
           and char_length(c->'parameters'->0->>'payload')<=256) then
      raise exception 'payload WA GPS requiere plantilla gps_alerta_critica/es_MX/body<=1024/quick_reply<=256/0';
    end if;

  elsif p_dedupe_key like 'liqext:%' then
    -- ── Liquidación externa (Agente 1) ───────────────────────────────────────
    if p_dedupe_key !~ '^liqext:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:g[0-9]{1,6}:(sesion|plantilla)$' then
      raise exception 'dedupe_key de liquidación externa con forma inválida';
    end if;

    if p_dedupe_key like '%:sesion' then
      if p_payload->>'type' <> 'interactive' then
        raise exception 'liqext:sesion exige un mensaje interactivo';
      end if;
      v_botones := p_payload->'interactive'->'action'->'buttons';
      v_ok := coalesce(
        p_payload->'interactive'->>'type' = 'button'
        and p_payload->'interactive'->'header'->>'type' = 'document'
        and coalesce(p_payload->'interactive'->'header'->'document'->>'link','') ~ '^https://[^[:space:]]+$'
        and nullif(btrim(coalesce(p_payload->'interactive'->'header'->'document'->>'filename','')),'') is not null
        and nullif(btrim(coalesce(p_payload->'interactive'->'body'->>'text','')),'') is not null
        and char_length(p_payload->'interactive'->'body'->>'text') <= 1024
        and jsonb_typeof(v_botones) = 'array'
        and jsonb_array_length(v_botones) = 2, false);
      if not v_ok or exists (
        select 1 from jsonb_array_elements(v_botones) b
        where not coalesce(
          b->>'type' = 'reply'
          and coalesce(b->'reply'->>'id','') ~ '^liqext_(ok|no):[0-9a-f-]{36}$'
          and nullif(btrim(coalesce(b->'reply'->>'title','')),'') is not null
          and char_length(b->'reply'->>'title') <= 20, false)
      ) then
        raise exception 'payload de liquidación externa (sesión) inválido: encabezado de documento https, cuerpo<=1024 y dos botones liqext_ok/liqext_no';
      end if;

    else
      if p_payload->>'type' <> 'template'
         or p_payload->'template'->>'name' <> 'liquidacion_externa_v1'
         or coalesce(p_payload->'template'->'language'->>'code','') <> 'es_MX' then
        raise exception 'liqext:plantilla exige la plantilla liquidacion_externa_v1/es_MX';
      end if;
      v_comps := p_payload->'template'->'components';
      v_ok := coalesce(jsonb_typeof(v_comps) = 'array' and jsonb_array_length(v_comps) = 4, false);
      if v_ok then
        v_ok :=
          -- encabezado de documento https
          exists (select 1 from jsonb_array_elements(v_comps) c
            where c->>'type' = 'header'
              and c->'parameters'->0->>'type' = 'document'
              and coalesce(c->'parameters'->0->'document'->>'link','') ~ '^https://[^[:space:]]+$')
          -- cuerpo: cuatro variables de texto no vacías
          and exists (select 1 from jsonb_array_elements(v_comps) c
            where c->>'type' = 'body'
              and jsonb_typeof(c->'parameters') = 'array'
              and jsonb_array_length(c->'parameters') = 4
              and not exists (select 1 from jsonb_array_elements(c->'parameters') p
                where not coalesce(p->>'type' = 'text'
                  and nullif(btrim(coalesce(p->>'text','')),'') is not null
                  and char_length(p->>'text') <= 1024, false)))
          -- dos botones de respuesta rápida, índices 0 y 1
          and (select count(*) from jsonb_array_elements(v_comps) c
            where c->>'type' = 'button' and c->>'sub_type' = 'quick_reply'
              and c->>'index' in ('0','1')
              and coalesce(c->'parameters'->0->>'payload','') ~ '^liqext_(ok|no):[0-9a-f-]{36}$') = 2;
      end if;
      if not coalesce(v_ok, false) then
        raise exception 'payload de liquidación externa (plantilla) inválido: encabezado de documento https, 4 variables de cuerpo y 2 botones liqext_ok/liqext_no';
      end if;
    end if;

  else
    raise exception 'dedupe_key WA sin validador para su prefijo (gps:, liqext:)';
  end if;

  return query insert into public.wa_outbox as o(dedupe_key,payload,ultimo_error)
    values(p_dedupe_key,p_payload,left(coalesce(p_error,'alerta WA pendiente'),500))
    on conflict(dedupe_key) do update set dedupe_key=excluded.dedupe_key
    returning o.id,o.estado,o.provider_message_id;
end $$;

revoke all on function public.encolar_wa_outbox_dedupe(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.encolar_wa_outbox_dedupe(text,jsonb,text) to service_role;

comment on function public.encolar_wa_outbox_dedupe(text,jsonb,text) is
  '0560: encola una salida de WhatsApp con llave de idempotencia. Valida el payload por prefijo de llave (gps:, liqext:); otro prefijo se rechaza. Solo service_role.';
