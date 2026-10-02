-- ═══════════════════════════════════════════════════════════════════════════
-- 0661 — Conductor: REPARTO JUSTO del cron entre flotas y cierre de lo vencido.
--
-- El cron `conductor-hitos` lee los viajes abiertos de TODAS las flotas con tope de 400 y `aceptado_en ASC`. Con una flota
-- grande delante, sus 400 viajes más viejos se comen la pasada entera y las flotas chicas (o los viajes de hoy) no se atienden
-- jamás, sin aviso. Y un viaje que quedó «abierto» hace meses (nadie lo liquidó) sigue ocupando un lugar para siempre.
--
--   viajes_activos_repartidos   → los ids de los viajes a atender, REPARTIDOS: primero el más viejo de cada flota, luego el
--                                  segundo de cada una, y así hasta llenar el tope. La flota que empata el último turno rota con
--                                  `p_rotacion` (el cron pasa el número de ventana de 5 min), así el sobrante no es siempre de
--                                  la misma. Los abiertos con más de `p_max_dias` desde que se aceptaron ya no entran;
--   cerrar_hitos_viajes_vencidos → los hitos que siguen esperando (o escalados) de un viaje abierto con más de `p_max_dias` se
--                                  marcan `omitido` con motivo `viaje_abierto_vencido`: la escalera deja de perseguirlos, la
--                                  oficina los puede capturar a mano (0385) y el viaje NO se toca (eso es decisión del negocio).
--
-- Security definer, search_path vacío, solo service_role. El código funciona sin esta migración (lectura anterior).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.viajes_activos_repartidos(
  p_limite integer, p_rotacion bigint default 0, p_max_dias integer default 30,
  p_ahora timestamptz default clock_timestamp()
) returns table (o_id uuid)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_limite is null or p_limite < 1 or p_limite > 5000 then raise exception 'p_limite fuera de 1..5000'; end if;
  if p_max_dias is null or p_max_dias < 1 then raise exception 'p_max_dias inválido'; end if;
  return query
  select q.id
    from (
      select v.id, v.tenant_id,
             row_number() over (partition by v.tenant_id order by v.aceptado_en, v.id) as turno
        from public.viaje v
       where v.estatus = 'abierto'
         and v.aceptado_en is not null
         and v.aceptado_en > p_ahora - make_interval(days => p_max_dias)
    ) q
   order by q.turno, md5(q.tenant_id::text || coalesce(p_rotacion, 0)::text), q.id
   limit p_limite;
end;
$$;
revoke all on function public.viajes_activos_repartidos(integer, bigint, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.viajes_activos_repartidos(integer, bigint, integer, timestamptz) to service_role;

create or replace function public.cerrar_hitos_viajes_vencidos(
  p_max_dias integer default 30, p_limite integer default 500, p_ahora timestamptz default clock_timestamp()
) returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  if p_max_dias is null or p_max_dias < 1 then raise exception 'p_max_dias inválido'; end if;
  if p_limite is null or p_limite < 1 then raise exception 'p_limite inválido'; end if;
  update public.viaje_hito h
     set estado = 'omitido', omitido_motivo = 'viaje_abierto_vencido', updated_at = p_ahora
   where h.id in (
     select h2.id
       from public.viaje_hito h2
       join public.viaje v on v.id = h2.viaje_id and v.tenant_id = h2.tenant_id
      where h2.estado in ('esperado', 'escalado')
        and v.estatus = 'abierto'
        and v.aceptado_en is not null
        and v.aceptado_en <= p_ahora - make_interval(days => p_max_dias)
      order by v.aceptado_en, h2.id
      limit p_limite
      for update of h2 skip locked
   );
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.cerrar_hitos_viajes_vencidos(integer, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.cerrar_hitos_viajes_vencidos(integer, integer, timestamptz) to service_role;
