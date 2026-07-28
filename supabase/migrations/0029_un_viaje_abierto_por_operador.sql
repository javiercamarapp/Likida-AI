-- ═══════════════════════════════════════════════════════════════════════════
-- 0029 — Un operador, un viaje abierto.
--
-- MEDIO de la auditoría 5 (modelo de datos). Se cierra aquí porque es un índice
-- y no toca una línea de `src/`.
--
-- QUÉ ESTÁ MAL HOY. `getOpenViaje` (conv.ts:72-84) hace
--
--     .in('estatus', ['abierto','en_cuadre'])
--     .order('created_at', { ascending: false })
--     .limit(1)
--
-- que es la forma de un SELECT que ESPERA varios y se queda con uno. En la base
-- no hay nada que limite a uno: `viaje.estatus` tiene `default 'abierto'` y no
-- existe índice parcial ni restricción. El código trata "el viaje abierto" como
-- singular; la base lo trata como plural.
--
-- EL ESCENARIO CON VALORES. Los dos viajes que se cargaron a mano el 28-jul son
-- del MISMO operador (`33333333-…-00ff`): `44444444-…-00ff` a las 20:45 con
-- anticipo $5,000 y `44444444-…-00fe` a las 21:46 con anticipo $4,000. Hoy los
-- dos acabaron `liquidado`, pero el segundo se creó a un UPDATE de distancia de
-- coexistir abierto con el primero.
--
-- Con los dos abiertos, TODAS las fotos del operador se cuelgan del más nuevo
-- (`…00fe`, por el `order by created_at desc`). `…00ff` se queda con $5,000 de
-- anticipo y CERO comprobantes, y nadie lo ve. Cuando alguien lo cierre, la
-- diferencia sale $5,000 en contra del operador: una liquidación fantasma que
-- acusa a una persona de un dinero que sí comprobó, en el otro viaje.
--
-- POR QUÉ UN ÍNDICE PARCIAL. La restricción no es "un viaje por operador" —un
-- operador hace cientos al año— sino "un viaje ABIERTO por operador". Eso es
-- exactamente lo que expresa un índice único parcial, y su predicado son los
-- mismos dos estatus que filtra `getOpenViaje`. Cuando el viaje se cierra
-- (`estatus = 'liquidado'`, que es lo que escribe `guardar_liquidacion_tx`) la
-- fila sale del índice sola y el operador puede empezar otro.
--
-- QUIÉN SE VA A TOPAR CON ESTO. Ninguna línea de `src/` inserta en `viaje`
-- (dos búsquedas: las tres apariciones de `from('viaje')` son un select, un
-- select y un select). Los viajes se cargan por la consola de Supabase o por el
-- seed, así que el único que puede chocar es quien los captura — que es
-- precisamente quien tiene que enterarse antes de que el operador mande su
-- primera foto, no después de cerrar.
--
-- COMPROBADO CONTRA LOS DATOS VIVOS el 28-jul-2026: de los 6 viajes, uno solo
-- está `abierto` (`44444444-…-000001`, del operador `33333333-…-0001`) y los
-- otros cinco están `liquidado`. Cero pares en conflicto. Esta migración no
-- rompe nada hoy.
--
-- Reversible: `drop index uq_viaje_abierto_por_operador;`
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare r record; msg text := '';
begin
  for r in
    select tenant_id, operador_id, count(*) as n, string_agg(id::text, ', ') as viajes
    from viaje
    where estatus in ('abierto', 'en_cuadre')
    group by tenant_id, operador_id
    having count(*) > 1
  loop
    msg := msg || format(E'\n  operador %s (flota %s) → %s viajes abiertos: %s',
                         r.operador_id, r.tenant_id, r.n, r.viajes);
  end loop;

  if msg <> '' then
    raise exception E'Hay operadores con más de un viaje abierto:%\n\nTodas sus fotos se están colgando del más NUEVO; los otros van a cerrar con el anticipo completo en contra del operador. Cierra o cancela los sobrantes antes de volver a aplicar.', msg;
  end if;
end $$;

create unique index if not exists uq_viaje_abierto_por_operador
  on viaje (tenant_id, operador_id)
  where estatus in ('abierto', 'en_cuadre');

comment on index uq_viaje_abierto_por_operador is
  'Un operador tiene A LO MÁS un viaje abierto. Es el invariante que getOpenViaje ya asume con .limit(1) y que la base no imponía: con dos abiertos, las fotos se cuelgan del más nuevo y el viejo cierra con el anticipo entero en contra del operador.';
