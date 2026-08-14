-- ═══════════════════════════════════════════════════════════════════════════
-- 0101 — LA PURGA QUE LA 0096 DEJÓ PROMETIDA (hallazgo C3, auditoría 4).
--
-- `correo_procesado` es la idempotencia del intake por correo: una fila por
-- `email_id` de Resend, para que un reintento del webhook no procese dos veces
-- el mismo correo. La 0096 creó el índice por fecha "para poder limpiar"...
-- y `mantenimiento_de_datos` nunca la tocó: crecía para siempre.
--
-- 90 DÍAS. El criterio: la fila solo sirve mientras Resend pueda reintentar
-- ese `email_id` (sus reintentos viven horas, no meses) y mientras alguien
-- quiera auditar qué correos entraron. 90 días cubre las dos cosas con margen
-- de sobra; conservar más no protege nada y agranda una tabla sin RLS de
-- lectura. Mismo patrón que `purgar_api_idempotencia` (0098): SECURITY
-- DEFINER CON SU REVOKE — la verificación 75 vigila el conjunto.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.purgar_correo_procesado(
  p_dias integer default 90,
  p_ahora timestamptz default now()
) returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare borradas bigint;
begin
  delete from public.correo_procesado
   where created_at < p_ahora - make_interval(days => p_dias);
  get diagnostics borradas = row_count;
  return borradas;
end;
$$;

comment on function public.purgar_correo_procesado is
  'Borra las filas de idempotencia del intake por correo más viejas que p_dias (default 90). Entra por idx_correo_procesado_created (0096). La llama mantenimiento_de_datos.';

-- El revoke que a la 0098 se le olvidó una vez y costó una función de purga
-- llamable por `anon` desde internet. No se repite.
revoke all on function public.purgar_correo_procesado(integer, timestamptz) from public;
revoke all on function public.purgar_correo_procesado(integer, timestamptz) from anon;
revoke all on function public.purgar_correo_procesado(integer, timestamptz) from authenticated;
grant execute on function public.purgar_correo_procesado(integer, timestamptz) to service_role;

-- ── mantenimiento_de_datos aprende la llave nueva ──────────────────────────
-- MISMA FIRMA que la 0098 (integer, timestamptz): el cron de purgar llama la
-- RPC única y no hay que tocarlo.
create or replace function public.mantenimiento_de_datos(
  p_dias_wa integer default 30,
  p_ahora timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  wa_purgados bigint;
  ia_consolidados bigint;
  idem_purgadas bigint;
  correo_purgado bigint;
begin
  wa_purgados := public.purgar_wa_mensaje_procesado(p_dias_wa, p_ahora);
  ia_consolidados := public.consolidar_llm_costo_mensual(p_ahora);
  idem_purgadas := public.purgar_api_idempotencia(7, p_ahora);
  correo_purgado := public.purgar_correo_procesado(90, p_ahora);
  return jsonb_build_object(
    'waPurgados', wa_purgados,
    'diasWa', p_dias_wa,
    'iaConsolidados', ia_consolidados,
    'llmCostoPurgado', false,
    'idempotenciaPurgada', idem_purgadas,
    'correoPurgado', correo_purgado,
    'corridaEn', p_ahora
  );
end;
$$;

revoke all on function public.mantenimiento_de_datos(integer, timestamptz) from public;
revoke all on function public.mantenimiento_de_datos(integer, timestamptz) from anon;
revoke all on function public.mantenimiento_de_datos(integer, timestamptz) from authenticated;
grant execute on function public.mantenimiento_de_datos(integer, timestamptz) to service_role;
