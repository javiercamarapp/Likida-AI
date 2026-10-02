-- ═══════════════════════════════════════════════════════════════════════════
-- 0648 · VIGÍA: UN CICLO DE ESPERA NUEVO NACE LIMPIO (corrección de la ronda adversarial 09).
--
-- El barrido (ahora cada minuto) lee los hilos una vez y escribe después; si el gerente contestaba en medio, el barrido dejaba
-- `escalamiento_nivel`/`molestia_nivel` > 0 en un hilo que `marcarRespondida` ya había reiniciado, y `vigia_recibir_mensaje` abría
-- el ciclo siguiente HEREDANDO ese nivel: con nivel 1 el responsable nunca recibía su aviso y con nivel 2 el hilo salía de la cola.
-- La causa en el código se cierra con escrituras condicionadas al ciclo (servicio.ts); esta migración cierra el otro extremo:
--   1. `vigia_recibir_mensaje` reinicia nivel de escalamiento y molestia cuando abre un ciclo (sin_respuesta_desde era null).
--   2. Repara lo ya dañado: hilos activos sin ciclo de espera que conservan un nivel (sin efecto para quien esperaba de verdad).
-- Idempotente: create or replace + un UPDATE que solo toca filas incoherentes.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.vigia_recibir_mensaje(
  p_tenant uuid, p_contacto uuid, p_wamid text, p_tipo text, p_texto text,
  p_ahora timestamptz default now()
) returns table (
  mensaje_id uuid, conversacion_id uuid, duplicado boolean,
  entradas_sin_respuesta integer, sin_respuesta_desde timestamptz,
  control text, cliente_id uuid, viaje_id uuid
)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_contacto public.vigia_contacto%rowtype;
  v_conv public.vigia_conversacion%rowtype;
  v_msg uuid;
  v_ahora timestamptz := least(coalesce(p_ahora, clock_timestamp()), clock_timestamp());
begin
  select * into v_contacto from public.vigia_contacto
   where id = p_contacto and tenant_id = p_tenant and estado = 'activo';
  if not found then
    raise exception 'contacto no autorizado para el vigía' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_contacto::text, 4));

  select * into v_conv from public.vigia_conversacion
   where contacto_id = p_contacto and tenant_id = p_tenant and estado = 'activa';
  if not found then
    insert into public.vigia_conversacion (tenant_id, contacto_id, cliente_id)
    values (p_tenant, p_contacto, v_contacto.cliente_id)
    returning * into v_conv;
  end if;

  insert into public.vigia_mensaje (tenant_id, conversacion_id, direccion, autor, wamid, tipo, texto, estado, created_at)
  values (p_tenant, v_conv.id, 'entrante', 'cliente', nullif(btrim(p_wamid), ''),
          coalesce(p_tipo, 'texto'), left(p_texto, 4000), 'recibido', v_ahora)
  on conflict (tenant_id, wamid) where wamid is not null do nothing
  returning id into v_msg;

  if v_msg is null then
    -- Repetido: se devuelve el mensaje que ya existía, sin tocar el hilo.
    select m.id into v_msg from public.vigia_mensaje m
     where m.tenant_id = p_tenant and m.wamid = nullif(btrim(p_wamid), '');
    return query select v_msg, v_conv.id, true, v_conv.entradas_sin_respuesta,
      v_conv.sin_respuesta_desde, v_conv.control, v_conv.cliente_id, v_conv.viaje_id;
    return;
  end if;

  update public.vigia_conversacion c set
    ultima_entrada_en = greatest(coalesce(c.ultima_entrada_en, v_ahora), v_ahora),
    -- 0648: un ciclo NUEVO (el hilo no esperaba nada) nace sin la escalera ni la molestia del anterior. Si una pasada del barrido
    -- escribió el nivel sobre un hilo ya contestado, el ciclo siguiente heredaba ese nivel: con nivel 1 el responsable nunca recibía
    -- su aviso y con nivel 2 el hilo salía de la cola del barrido para siempre.
    escalamiento_nivel = case when c.sin_respuesta_desde is null then 0 else c.escalamiento_nivel end,
    escalado_en = case when c.sin_respuesta_desde is null then null else c.escalado_en end,
    molestia_nivel = case when c.sin_respuesta_desde is null then 0 else c.molestia_nivel end,
    molestia_motivos = case when c.sin_respuesta_desde is null then '{}'::text[] else c.molestia_motivos end,
    molestia_en = case when c.sin_respuesta_desde is null then null else c.molestia_en end,
    sin_respuesta_desde = coalesce(c.sin_respuesta_desde, v_ahora),
    entradas_sin_respuesta = c.entradas_sin_respuesta + 1,
    updated_at = clock_timestamp()
   where c.id = v_conv.id
   returning * into v_conv;

  return query select v_msg, v_conv.id, false, v_conv.entradas_sin_respuesta,
    v_conv.sin_respuesta_desde, v_conv.control, v_conv.cliente_id, v_conv.viaje_id;
end $$;
revoke all on function public.vigia_recibir_mensaje(uuid, uuid, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.vigia_recibir_mensaje(uuid, uuid, text, text, text, timestamptz) to service_role;

update public.vigia_conversacion
   set escalamiento_nivel = 0, escalado_en = null, molestia_nivel = 0, molestia_motivos = '{}', molestia_en = null
 where sin_respuesta_desde is null
   and (escalamiento_nivel <> 0 or molestia_nivel <> 0 or escalado_en is not null or molestia_en is not null or molestia_motivos <> '{}');
