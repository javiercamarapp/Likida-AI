-- ═══════════════════════════════════════════════════════════════════════════
-- 0851 — Una unidad, un viaje abierto. Gemelo de la 0029
-- (`uq_viaje_abierto_por_operador`), pero sobre `unidad_id`.
--
-- HALLAZGO ALTO CONFIRMADO. `asignarUnidad()` y `crearViaje()`
-- (src/lib/likida/operacion.ts) comprueban que la unidad sea de la flota
-- (`unidadPropia`) y que no esté dada de baja (`unidadDeBaja`) — pero nunca
-- comprueban que esa unidad NO tenga ya otro viaje abierto. La 0029 cerró
-- exactamente este hueco para `operador_id` (un chofer no puede tener dos
-- viajes abiertos a la vez); para `unidad_id` el candado nunca se escribió.
--
-- EL ESCENARIO. Un jefe de tráfico asigna el tracto/caja «T-014» al viaje A
-- (`abierto`) y, sin desasignarlo, lo vuelve a asignar al viaje B (`abierto`)
-- desde /dashboard/despacho — dos clics, sin que nada en servidor lo frene.
-- Las dos filas de `viaje` quedan apuntando a la MISMA unidad. Cualquier
-- lectura que agregue "viajes por unidad" (carga de la unidad, kilometraje,
-- el combo de asignación que la vuelve a ofrecer como "libre") ve una unidad
-- que está en dos lugares a la vez — el mismo tipo de dato fantasma que la
-- 0029 documentó para operador, pero del lado del camión.
--
-- POR QUÉ UN ÍNDICE PARCIAL, Y NO SOLO UN CANDADO EN `src/`. El candado de
-- aplicación (que esta migración acompaña, ver `unidadTieneViajeAbierto` en
-- operacion.ts) da el mensaje legible — pero por sí solo deja una carrera:
-- dos requests casi simultáneos pueden leer "cero viajes abiertos" los dos, y
-- los dos escribir. El índice único parcial es la verdad que NINGUNA carrera
-- puede saltarse — es la MISMA garantía que `uq_viaje_abierto_por_operador`
-- ya da del lado del operador, y el candado de aplicación solo evita que esa
-- carrera, cuando sí ocurre, se vea como un 23505 crudo de Postgres en vez de
-- un mensaje que el jefe de tráfico entienda.
--
-- `unidad_id is not null` en el predicado: un viaje sin unidad asignada
-- (`unidad_id = null`, el caso normal al crear el viaje desde el formulario)
-- no debe contar contra el candado — Postgres ya trata los NULL de un índice
-- único como distintos entre sí, pero el predicado lo deja explícito y barato
-- de leer, igual que pidió la auditoría.
--
-- COMPROBADO ANTES DE CREAR EL ÍNDICE (mismo patrón que la 0029): si ya
-- existieran dos viajes abiertos con la misma unidad, el índice no podría
-- crearse y esta migración falla con un mensaje que dice exactamente cuáles
-- hay que cerrar primero, en vez de fallar con el error crudo de Postgres.
--
-- Reversible: `drop index uq_viaje_abierto_por_unidad;`
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare r record; msg text := '';
begin
  for r in
    select tenant_id, unidad_id, count(*) as n, string_agg(id::text, ', ') as viajes
    from viaje
    where estatus in ('abierto', 'en_cuadre') and unidad_id is not null
    group by tenant_id, unidad_id
    having count(*) > 1
  loop
    msg := msg || format(E'\n  unidad %s (flota %s) → %s viajes abiertos: %s',
                         r.unidad_id, r.tenant_id, r.n, r.viajes);
  end loop;

  if msg <> '' then
    raise exception E'Hay unidades con más de un viaje abierto:%\n\nLa misma unidad está en dos viajes a la vez. Desasigna o cierra los sobrantes antes de volver a aplicar esta migración.', msg;
  end if;
end $$;

create unique index if not exists uq_viaje_abierto_por_unidad
  on viaje (tenant_id, unidad_id)
  where estatus in ('abierto', 'en_cuadre') and unidad_id is not null;

comment on index uq_viaje_abierto_por_unidad is
  'Una unidad (tracto/caja) tiene A LO MÁS un viaje abierto. Gemelo de uq_viaje_abierto_por_operador (0029) del lado de la unidad: sin esto, asignarUnidad()/crearViaje() (operacion.ts) podían dejar la MISMA unidad enganchada a dos viajes abiertos a la vez — nada en la base lo impedía, solo la UI del combo.';
