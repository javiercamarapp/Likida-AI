-- 0680 — RETENCIÓN DE LOS LEDGERS QUE CRECÍAN SIN PURGA (Ola 9, seguridad; auditoría ola 1 #23).
--
-- Cinco tablas de bitácora/ledger solo se escribían: nada las recortaba. Ninguna es dinero
-- ni documento fiscal (esos conservan su plazo propio), pero todas acumulan una fila por cada
-- señal y arrastran identificadores de personas (huella del destinatario, actor, detalle):
--
--   tabla                    plazo por omisión      por qué ese plazo
--   evento_seguridad (0133)  info 90 / media 180    la telemetría de Trust & Safety; lo grave se conserva un año
--                            / alta 365 días        para poder reconstruir un incidente (mismo criterio que 0288)
--   evento_stripe (0055)     400 días               Stripe reintenta por días, no por meses; 400 cubre un ciclo
--                                                   anual completo de conciliación más holgura
--   vigia_evento (0400)      365 días               bitácora de la conversación del Vigía (huella del destinatario)
--   cp_documento_evento      730 días               auditoría de documentos de Carta Porte; el documento mismo
--     (0420)                                        caduca por `retener_hasta`, esto es solo su historia
--   buzon_entrega_evento     365 días               intentos de entrega del buzón al contador
--     (0531)
--
-- DECISIÓN QUE NO SE TOMA AQUÍ: `jornada_revision_historial` (jornada laboral derivada del GPS)
-- queda FUERA a propósito. Su plazo depende de lo que fije el abogado (LEG-6, docs/legal/RETENCION.md);
-- purgarla con un número inventado sería decidir una política laboral desde una migración.
--
-- Cómo corre: `mantener_ledgers` la llama el cron /api/cron/purgar (módulo retencion_ledgers.ts),
-- que ya trae la puerta con secreto, el kill switch y el latido. Cada tabla se purga con
-- `purgar_en_tandas` (0155) y SU fallo no tumba a las demás: se acumula en `fallos`. Piso de
-- 30 días en cualquier plazo; solo service_role ejecuta. Idempotente.
begin;

-- ── 1. evento_seguridad (Trust & Safety) ────────────────────────────────────
create or replace function public.purgar_evento_seguridad(
  p_dias_info integer default 90,
  p_dias_media integer default 180,
  p_dias_alta integer default 365,
  p_ahora timestamptz default now(),
  p_vence timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare r_info jsonb; r_media jsonb; r_alta jsonb;
begin
  if p_dias_info < 30 or p_dias_media < p_dias_info or p_dias_alta < p_dias_media then
    raise exception 'purgar_evento_seguridad: plazos inválidos (mínimo 30 días y lo grave nunca dura menos que lo leve)'
      using errcode = 'PU001';
  end if;
  r_info := public.purgar_en_tandas('public.evento_seguridad'::regclass,
    format('severidad = ''info'' and creado_en < %L', p_ahora - make_interval(days => p_dias_info)), p_vence);
  r_media := public.purgar_en_tandas('public.evento_seguridad'::regclass,
    format('severidad = ''media'' and creado_en < %L', p_ahora - make_interval(days => p_dias_media)), p_vence);
  r_alta := public.purgar_en_tandas('public.evento_seguridad'::regclass,
    format('severidad = ''alta'' and creado_en < %L', p_ahora - make_interval(days => p_dias_alta)), p_vence);
  return jsonb_build_object(
    'borradas', (r_info->>'borradas')::bigint + (r_media->>'borradas')::bigint + (r_alta->>'borradas')::bigint,
    'parcial', (r_info->>'parcial')::boolean or (r_media->>'parcial')::boolean or (r_alta->>'parcial')::boolean);
end $$;
comment on function public.purgar_evento_seguridad(integer, integer, integer, timestamptz, timestamptz) is
  '0680: retención de evento_seguridad por severidad (info 90 / media 180 / alta 365 días; piso 30; lo grave no dura menos que lo leve). Solo service_role.';
revoke all on function public.purgar_evento_seguridad(integer, integer, integer, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.purgar_evento_seguridad(integer, integer, integer, timestamptz, timestamptz) to service_role;

-- ── 2. Orquestadora: las cinco tablas, cada una con su plazo y su fallo aislado ─────────
create or replace function public.mantener_ledgers(
  p_ahora timestamptz default now(),
  p_vence timestamptz default null,
  p_dias_stripe integer default 400,
  p_dias_vigia integer default 365,
  p_dias_cp_documento integer default 730,
  p_dias_buzon integer default 365
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  salida jsonb := '{}'::jsonb;
  fallos text[] := '{}';
  parcial boolean := false;
  r jsonb;
begin
  if least(p_dias_stripe, p_dias_vigia, p_dias_cp_documento, p_dias_buzon) < 30 then
    raise exception 'mantener_ledgers: ningún plazo puede ser menor de 30 días' using errcode = 'PU001';
  end if;

  begin
    r := public.purgar_evento_seguridad(90, 180, 365, p_ahora, p_vence);
    salida := salida || jsonb_build_object('evento_seguridad', r);
    parcial := parcial or (r->>'parcial')::boolean;
  exception when others then fallos := fallos || ('evento_seguridad: ' || sqlerrm); end;

  begin
    r := public.purgar_en_tandas('public.evento_stripe'::regclass,
      format('procesado_en < %L', p_ahora - make_interval(days => p_dias_stripe)), p_vence);
    salida := salida || jsonb_build_object('evento_stripe', r);
    parcial := parcial or (r->>'parcial')::boolean;
  exception when others then fallos := fallos || ('evento_stripe: ' || sqlerrm); end;

  begin
    r := public.purgar_en_tandas('public.vigia_evento'::regclass,
      format('created_at < %L', p_ahora - make_interval(days => p_dias_vigia)), p_vence);
    salida := salida || jsonb_build_object('vigia_evento', r);
    parcial := parcial or (r->>'parcial')::boolean;
  exception when others then fallos := fallos || ('vigia_evento: ' || sqlerrm); end;

  begin
    r := public.purgar_en_tandas('public.cp_documento_evento'::regclass,
      format('created_at < %L', p_ahora - make_interval(days => p_dias_cp_documento)), p_vence);
    salida := salida || jsonb_build_object('cp_documento_evento', r);
    parcial := parcial or (r->>'parcial')::boolean;
  exception when others then fallos := fallos || ('cp_documento_evento: ' || sqlerrm); end;

  begin
    r := public.purgar_en_tandas('public.buzon_entrega_evento'::regclass,
      format('en < %L', p_ahora - make_interval(days => p_dias_buzon)), p_vence);
    salida := salida || jsonb_build_object('buzon_entrega_evento', r);
    parcial := parcial or (r->>'parcial')::boolean;
  exception when others then fallos := fallos || ('buzon_entrega_evento: ' || sqlerrm); end;

  return salida || jsonb_build_object('parcial', parcial, 'fallos', to_jsonb(fallos));
end $$;
comment on function public.mantener_ledgers(timestamptz, timestamptz, integer, integer, integer, integer) is
  '0680: purga los ledgers sin retención (evento_seguridad, evento_stripe, vigia_evento, cp_documento_evento, buzon_entrega_evento) con plazo por tabla y piso de 30 días. Una tabla que falla se acumula en `fallos` y no tumba a las demás. La llama /api/cron/purgar. Solo service_role.';
revoke all on function public.mantener_ledgers(timestamptz, timestamptz, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.mantener_ledgers(timestamptz, timestamptz, integer, integer, integer, integer) to service_role;

commit;
