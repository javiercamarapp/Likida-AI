-- ═══════════════════════════════════════════════════════════════════════════
-- 0689 · `vigia_purgar` por lotes de verdad (ronda 16, vuelta 2: prueba de
--        carga de 250 camiones / 5,000 viajes al mes).
--
-- MEDIDO sobre 97,500 mensajes y 32,500 conversaciones (la mitad del historial
-- vencido, lo que habría tras 6 meses sin purgar): un solo `vigia_purgar(500)`
-- tardaba 10-30 s. Dos causas, las dos reales:
--
--   1. LA CAUSA DE FONDO: el borrado de 500 mensajes pagaba 23.5 s en el
--      TRIGGER de la FK `vigia_mensaje_respuesta_a_fkey` (ON DELETE SET NULL):
--      por cada mensaje borrado Postgres busca los que lo citan en `respuesta_a`,
--      y no había índice utilizable (el único con `respuesta_a` es parcial
--      `WHERE autor = 'agente'`), así que cada borrado era un Seq Scan de
--      `vigia_mensaje` — 47 ms × 500. Con 5,000 viajes al mes la tabla solo
--      crece. Índice parcial `(respuesta_a, tenant_id) WHERE respuesta_a IS NOT NULL`:
--      la condición de la FK (`respuesta_a = $1 AND tenant_id = $2`) lo implica.
--   2. LA SEGUNDA MITAD NO TENÍA TOPE: el `delete from vigia_conversacion` de las
--      cerradas vacías se llevaba TODAS de golpe (con cascada fila a fila hacia
--      `vigia_evento`). Solo los mensajes llevaban `p_limite`. Ahora el límite es
--      del PASO ENTERO: los mensajes se llevan hasta `p_limite` y a las
--      conversaciones les toca lo que sobró del presupuesto; lo que no cupo lo
--      toma la siguiente pasada del cron (que ya corre `purgar(500)` en cada una).
--      Un límite por llamada es lo que mantiene la pasada bajo el techo de 2 s.
--
-- Mismas garantías de la 0400: SOLO se borra (a) el mensaje más viejo que la
-- retención de SU flota (180 días por omisión) y (b) la conversación `cerrada`
-- desde hace más de 30 días que ya no tiene un solo mensaje. Una conversación
-- activa, una cerrada hace poco o una que conserva algún mensaje no se tocan.
-- Para una base con las tablas ya enormes, correr ANTES de migrar
-- scripts/ci/0689_preflight_indices_vigia_purga.sql (CONCURRENTLY, mismo nombre
-- y definición): `if not exists` hace que esta migración los dé por buenos.
-- ═══════════════════════════════════════════════════════════════════════════

create index if not exists vigia_mensaje_respuesta_a_idx
  on public.vigia_mensaje (respuesta_a, tenant_id)
  where respuesta_a is not null;

-- Las conversaciones cerradas candidatas a purga, por antigüedad de cierre.
create index if not exists vigia_conversacion_cerrada_idx
  on public.vigia_conversacion (cerrada_en)
  where estado = 'cerrada';

create or replace function public.vigia_purgar(
  p_limite integer default 500
) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare v_n integer; v_c integer := 0;
begin
  if p_limite < 1 or p_limite > 10000 then raise exception 'límite de purga inválido'; end if;
  with viejos as (
    select m.id from public.vigia_mensaje m
      left join public.vigia_config c on c.tenant_id = m.tenant_id
     where m.created_at < now() - make_interval(days => coalesce(c.retencion_dias, 180))
     order by m.created_at limit p_limite
  )
  delete from public.vigia_mensaje m using viejos v where m.id = v.id;
  get diagnostics v_n = row_count;

  -- Conversaciones cerradas que se quedaron sin mensajes: SOLO con lo que sobró
  -- del presupuesto de esta pasada (el límite es de la pasada, no de cada mitad).
  if v_n < p_limite then
    with huerfanas as (
      select c.id from public.vigia_conversacion c
       where c.estado = 'cerrada'
         and c.cerrada_en < now() - interval '30 days'
         and not exists (select 1 from public.vigia_mensaje m where m.conversacion_id = c.id)
       order by c.cerrada_en, c.id
       limit p_limite - v_n
    )
    delete from public.vigia_conversacion c using huerfanas h where c.id = h.id;
    get diagnostics v_c = row_count;
  end if;
  return v_n + v_c;
end $$;
revoke all on function public.vigia_purgar(integer) from public, anon, authenticated;
grant execute on function public.vigia_purgar(integer) to service_role;
comment on function public.vigia_purgar(integer) is
  '0689: retención del Vigía por LOTES: a lo más p_limite filas por llamada entre mensajes vencidos (retención de su flota) y conversaciones cerradas vacías (>30 días). Devuelve cuántas borró; el cron la repite en la siguiente pasada.';
