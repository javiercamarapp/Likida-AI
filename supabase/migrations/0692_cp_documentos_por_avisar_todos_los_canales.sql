-- ═══════════════════════════════════════════════════════════════════════════
-- 0692 — Carta Porte: el aviso de «dudas» a la oficina cubre TODOS los canales (nota S de la re-auditoría, ronda 18).
--
-- La 0641 listaba para avisar solo los documentos con `canal = 'correo'`. El cliente pidió «marcar dudas y mandar al equipo» sin
-- distinguir cómo llegó el documento: uno que entró por WhatsApp o por el panel (`manual`) y quedó por revisar con un bloqueo o con
-- lectura poco segura se quedaba en la bandeja sin que nadie se enterara. Ahora entran los tres canales; el resto del contrato es el de
-- la 0641 (por revisar, con un bloqueo o confianza por debajo del umbral, dentro de la ventana de días y UNA vez por documento: el candado
-- `cp_documento_reclamar_aviso` no cambia). Misma firma, security invoker y permisos.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.cp_documentos_por_avisar(
  p_limite int default 25, p_umbral numeric default 0.85, p_dias int default 3
) returns table (tenant_id uuid, id uuid)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_limite is null or p_limite < 1 or p_limite > 200 then
    raise exception 'cp_documentos_por_avisar: p_limite fuera de rango (1-200)';
  end if;
  if p_umbral is null or p_umbral <= 0 or p_umbral > 1 then
    raise exception 'cp_documentos_por_avisar: p_umbral fuera de rango (0-1]';
  end if;
  if p_dias is null or p_dias < 1 or p_dias > 30 then
    raise exception 'cp_documentos_por_avisar: p_dias fuera de rango (1-30)';
  end if;
  return query
  select d.tenant_id, d.id
    from public.cp_documento d
   where d.purgado_en is null
     and d.estado = 'por_revisar'
     and d.canal in ('correo', 'whatsapp', 'manual')
     and not (d.avisos_oficina ? 'hallazgos')
     and d.updated_at > now() - make_interval(days => p_dias)
     and (
       coalesce((d.validacion ->> 'bloqueos')::int, 0) > 0
       or (d.confianza_min is not null and d.confianza_min < p_umbral)
     )
   order by d.updated_at, d.id
   limit p_limite;
end;
$$;
revoke all on function public.cp_documentos_por_avisar(int, numeric, int) from public, anon, authenticated;
grant execute on function public.cp_documentos_por_avisar(int, numeric, int) to service_role;
