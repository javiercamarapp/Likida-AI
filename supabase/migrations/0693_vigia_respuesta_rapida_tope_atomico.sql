-- ═══════════════════════════════════════════════════════════════════════════
-- 0693 — Vigía: el tope de 200 respuestas rápidas aprobadas por flota deja de ser una carrera (R09-6, adversarial de la ronda 09,
-- re-auditoría de la ronda 18).
--
-- La 0647 contaba (`select count(*)`) y luego insertaba, sin candado: con 199 aprobadas, dos aprobaciones simultáneas de preguntas
-- NUEVAS veían las dos 199 y entraban las dos (201). Ahora la función toma un candado de transacción POR FLOTA antes de contar:
-- las aprobaciones de una misma flota se serializan (solo ellas; otras flotas no se esperan) y la segunda ve ya el 200.
-- Mismo cuerpo, misma firma, mismos permisos que la 0647; solo se agrega el candado.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.vigia_respuesta_rapida_aprobar(
  p_tenant uuid, p_tema text, p_pregunta text, p_texto text, p_usuario uuid default null
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare v_id uuid; v_n integer;
begin
  if p_tenant is null then raise exception 'flota requerida' using errcode = '22023'; end if;
  if not exists (select 1 from public.tenant where id = p_tenant) then raise exception 'flota inexistente' using errcode = '22023'; end if;
  -- Candado de transacción por flota: sin él, count + insert no es atómico y el tope se rebasa con aprobaciones simultáneas.
  perform pg_advisory_xact_lock(hashtextextended('vigia_respuesta_rapida_tope:' || p_tenant::text, 0));
  -- El tope solo cuenta lo que sería NUEVO: corregir la respuesta de una pregunta ya aprobada nunca topa.
  if not exists (select 1 from public.vigia_respuesta_rapida where tenant_id = p_tenant and estado = 'aprobada' and lower(btrim(pregunta)) = lower(btrim(p_pregunta))) then
    select count(*) into v_n from public.vigia_respuesta_rapida where tenant_id = p_tenant and estado = 'aprobada';
    if v_n >= 200 then raise exception 'tope de 200 respuestas rápidas aprobadas por flota' using errcode = '54000'; end if;
  end if;
  insert into public.vigia_respuesta_rapida (tenant_id, tema, pregunta, texto, aprobada_por)
  values (p_tenant, p_tema, btrim(p_pregunta), btrim(p_texto), p_usuario)
  on conflict (tenant_id, lower(btrim(pregunta))) where estado = 'aprobada'
  do update set tema = excluded.tema, texto = excluded.texto, aprobada_por = excluded.aprobada_por,
                aprobada_en = now(), updated_at = now()
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.vigia_respuesta_rapida_aprobar(uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.vigia_respuesta_rapida_aprobar(uuid, text, text, text, uuid) to service_role;
