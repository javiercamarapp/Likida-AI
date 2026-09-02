-- ═══════════════════════════════════════════════════════════════════════════
-- 0269 · `ultimas_posiciones_tenant()` — la ÚLTIMA posición de cada unidad,
-- resuelta en la base. Auditoría 20, hallazgo 5 (MEDIO): el GPS es invisible.
--
-- ── POR QUÉ ESTE ARCHIVO LLEVA TRES NÚMEROS ────────────────────────────────
--
-- Nació 0266, se renumeró a 0267 al mergear el estudio de marketing (#262), y
-- llega a 0269 porque `0267_agente_insumo.sql` (#259) mergeó DESPUÉS que esta
-- migración con el mismo 0267 — durante unas horas master tuvo dos archivos
-- `0267_*`. El 0268 quedó apartado por el ciclo de tickets de soporte (#263),
-- todavía abierto cuando esto se escribió, así que el hueco es a propósito:
-- se salta un número antes que arriesgar la colisión de nuevo.
--
-- La numeración no es cosmética: `migraciones_verificadas.test.ts` indexa por
-- los cuatro primeros caracteres del nombre, así que dos archivos con el mismo
-- prefijo comparten decisión — mientras el 0267 estuvo duplicado, la exención
-- escrita para ESTA migración estaba dando por comprobada también a la otra.
-- No se rompió nada (agente_insumo sí tiene sus bloques 215 y 216 en
-- `verificaciones.sql`), pero el mecanismo que obliga a decidir por migración
-- estaba contando dos como una, en silencio, que es justo lo que ese test
-- existe para impedir.
--
-- Antes de reservar un número: `ls supabase/migrations/` contra el master del
-- momento y revisar los PR abiertos, no el número que traiga la rama.
--
-- ── LO MEDIDO ───────────────────────────────────────────────────────────────
--
-- `posicion` (0050) tiene DOS escritores reales desde hace semanas:
--   · `processor.ts:145` — el pin que el chofer comparte por WhatsApp
--     (`proveedor = 'whatsapp'`);
--   · `conectores/sincronizar_gps.ts:145` — el poller del conector GPS, que
--     corre en cada pasada de `/api/cron/gps` (0176).
--
-- Y NINGUNA pantalla enseñaba una sola posición. `/dashboard/mapa` declaraba,
-- en un comentario y en su leyenda, que «posicion está vacía — no hay GPS» y
-- dibujaba trayectos ILUSTRATIVOS origen→destino contra la tabla estática de
-- ciudades. El supuesto dejó de ser cierto el día que se conectó el primer
-- proveedor; el rótulo no se enteró.
--
-- ── POR QUÉ UNA RPC Y NO UNA CONSULTA DESDE POSTGREST ───────────────────────
--
-- «La última posición de cada unidad» es un `distinct on` — y PostgREST no lo
-- sabe expresar. Las dos alternativas desde el cliente eran peores:
--
--   · Una consulta por unidad (N+1): con 60 unidades son 60 viajes a la base
--     en cada render de una página `force-dynamic`.
--   · Traerse las N filas más recientes de la flota y quedarse con la primera
--     de cada unidad en JS: la unidad que lleva un día sin reportar CAE FUERA
--     de la ventana y desaparece del mapa sin que nadie se entere — un mapa al
--     que le faltan camiones y no lo dice es peor que no tener mapa.
--
-- El `distinct on (unidad_id) … order by unidad_id, medida_en desc` recorre el
-- índice `posicion_unidad_tiempo_idx (tenant_id, unidad_id, medida_en desc)`
-- que la 0050 ya dejó puesto, y devuelve UNA fila por unidad sin importar hace
-- cuánto reportó. `medida_en` y no `recibida_en`, por lo mismo que documenta la
-- 0050: un proveedor puede entregar en lote posiciones de hace una hora y
-- ordenarlas por hora de llegada dibujaría una ruta que el camión nunca hizo.
--
-- ── LO QUE ESTA FUNCIÓN NO DECIDE ───────────────────────────────────────────
--
-- No filtra por antigüedad. Una posición de hace tres días es un dato REAL y
-- la pantalla la pinta con su hora para que el jefe de tráfico juzgue; borrarla
-- aquí sería decidir por él cuándo un camión «ya no cuenta». El corte a 90 días
-- lo pone la purga de la 0155, que es otra cosa: retención, no presentación.
--
-- No trae la unidad dada de baja ni la inactiva: `posicion` referencia
-- `unidad(id)` con `on delete cascade`, así que el join es total, y el filtro
-- `u.activo` deja fuera al camión que la flota ya retiró — su último ping no es
-- operación, es historia.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.ultimas_posiciones_tenant(p_tenant uuid)
returns table (
  unidad_id        uuid,
  numero_economico text,
  placas           text,
  estado           text,
  lat              double precision,
  lng              double precision,
  velocidad        double precision,
  medida_en        timestamptz,
  proveedor        text
)
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  select distinct on (p.unidad_id)
    p.unidad_id,
    u.numero_economico,
    u.placas,
    u.estado,
    p.lat,
    p.lng,
    p.velocidad,
    p.medida_en,
    p.proveedor
  from posicion p
  join unidad u on u.id = p.unidad_id
  where p.tenant_id = p_tenant
    and u.activo
  order by p.unidad_id, p.medida_en desc;
$$;

comment on function public.ultimas_posiciones_tenant(uuid) is
  'La ÚLTIMA posición de cada unidad ACTIVA de una flota (distinct on unidad_id por medida_en desc, sobre posicion_unidad_tiempo_idx de la 0050). La lee /dashboard/mapa para pintar el pin real; sin ella la pantalla solo puede dibujar el trayecto ilustrativo origen→destino. No filtra por antigüedad a propósito: una posición vieja es un dato real y la pantalla la rotula con su hora. SECURITY INVOKER; p_tenant sin default (molde 0112).';

revoke all on function public.ultimas_posiciones_tenant(uuid) from public, anon, authenticated;
grant execute on function public.ultimas_posiciones_tenant(uuid) to service_role;
