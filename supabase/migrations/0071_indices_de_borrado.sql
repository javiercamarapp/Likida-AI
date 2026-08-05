-- 0066 — Borrar una flota era O(n²). Los índices que le faltan a las FK.
--
-- AUDITORÍA DE DATOS, CRÍTICO. Medido contra esta base, con una flota sembrada
-- de 2,000 viajes y ~34,000 filas hijas:
--
--     delete from tenant  SIN estos índices : 4,696.5 ms
--     delete from tenant  CON estos índices :   900.5 ms      → 5.2×
--
-- Y el mecanismo aislado, sobre `llm_costo` con 75,000 filas — 200 sondeos, que
-- es lo que el trigger de FK corre por CADA liquidación borrada:
--
--     sin índice: 2,069.9 ms  (10.350 ms c/u)
--     con índice:     7.2 ms  ( 0.036 ms c/u)      → 286×
--
-- ── POR QUÉ ES CUADRÁTICO Y NO SOLO LENTO ────────────────────────────────
--
-- Postgres NO indexa el lado que REFERENCIA de una foreign key; solo el lado
-- referenciado. Al borrar una fila padre, el trigger de la FK tiene que buscar
-- a los hijos que la apuntan, y sin índice esa búsqueda es un `Seq Scan` de la
-- tabla hija COMPLETA. El trigger corre UNA VEZ POR FILA PADRE. Borrar 2,000
-- viajes con 10 FK sin índice apuntándoles son 20,000 recorridos completos:
-- filas_padre × tamaño_hijo. Por eso duplicar el tamaño de la flota cuadruplica
-- el tiempo, y por eso no se nota hoy —con la base vacía todo es instantáneo— y
-- se nota justo el día que hay datos.
--
-- ── CÓMO SE ELIGIÓ CADA UNO (y por qué NO están los tres que faltan) ──────
--
-- El criterio NO es "toda FK sin índice". El costo real de un borrado es
--     (filas del PADRE) × (tamaño del HIJO)
-- así que solo vale la pena el índice cuando el padre puede tener MUCHAS filas.
--
-- Las FK contra `tenant` NO cumplen: `tenant` tiene una fila por flota, así que
-- su trigger corre UNA vez por borrado, no una por fila. Un solo `Seq Scan` de
-- una tabla acotada es correcto y barato, y un índice de más se paga en CADA
-- insert para siempre. Por eso quedan FUERA, a propósito, tres que la auditoría
-- pedía —`campania(tenant_id)`, `terminal(tenant_id)`, `codigo_pendiente(tenant_id)`—
-- y por eso tampoco se agregan las otras ~20 FK contra `tenant` del esquema.
--
-- También quedan fuera las FK COMPUESTAS cuya primera columna ya está indexada
-- sola: `gasto(viaje_id,tenant_id)`, `liquidacion(viaje_id,tenant_id)` y
-- `codigo_pendiente(viaje_id,tenant_id)` se resuelven con los índices que ya
-- existen sobre `viaje_id`; el planner entra por ahí y filtra el resto. Un
-- índice compuesto nuevo ahí sería redundante.
--
-- La auditoría nombró 9. Seis eran del tipo correcto y están aquí; tres eran
-- contra `tenant` y se descartan. Pero la lista estaba INCOMPLETA: el sondeo del
-- catálogo encontró 43 FK sin índice utilizable, y con solo los 6 de la
-- auditoría el borrado SEGUÍA siendo cuadrático, porque quedaban 10 FK contra
-- `viaje` sin cubrir. Los 24 de abajo son el conjunto que de verdad lo cierra.
--
-- Se crean SIN `concurrently` porque la base está vacía: es instantáneo y no
-- bloquea a nadie. Sobre una base con datos habría que usar `concurrently`.

-- ── Hijos de `viaje` — el padre más numeroso, y el que más FK recibe ──────
create index if not exists factura_viaje_viaje_id_idx        on public.factura_viaje (viaje_id);
create index if not exists comprobante_huerfano_viaje_id_idx on public.comprobante_huerfano (viaje_id);
create index if not exists cotizacion_viaje_id_idx           on public.cotizacion (viaje_id);
create index if not exists factura_emitida_viaje_id_idx      on public.factura_emitida (viaje_id);
create index if not exists incidencia_viaje_id_idx           on public.incidencia (viaje_id);
create index if not exists ticket_soporte_viaje_id_idx       on public.ticket_soporte (viaje_id);
create index if not exists wa_conversacion_viaje_id_idx      on public.wa_conversacion (viaje_id);

-- ── Hijos de `gasto` y de `liquidacion` — los dos que más filas acumulan ──
create index if not exists cfdi_xml_gasto_id_idx             on public.cfdi_xml (gasto_id);
create index if not exists llm_costo_liquidacion_id_idx      on public.llm_costo (liquidacion_id);

-- ── Hijos de `operador` ──────────────────────────────────────────────────
create index if not exists comprobante_huerfano_operador_id_idx on public.comprobante_huerfano (operador_id);
create index if not exists app_user_operador_id_idx           on public.app_user (operador_id);
create index if not exists pod_operador_id_idx                on public.pod (operador_id);
create index if not exists solicitud_arco_operador_id_idx     on public.solicitud_arco (operador_id);
create index if not exists wa_conversacion_operador_id_idx    on public.wa_conversacion (operador_id);

-- ── Hijos de `unidad`, de `cliente` y de `terminal` ──────────────────────
create index if not exists mantenimiento_unidad_id_idx        on public.mantenimiento (unidad_id);
create index if not exists incidencia_unidad_id_idx           on public.incidencia (unidad_id);
create index if not exists tarifa_cliente_id_idx              on public.tarifa (cliente_id);
create index if not exists cotizacion_cliente_id_idx          on public.cotizacion (cliente_id);
create index if not exists factura_emitida_cliente_id_idx     on public.factura_emitida (cliente_id);
create index if not exists operador_terminal_id_idx           on public.operador (terminal_id);

-- ── `viaje` es a la vez padre grande e hijo de cinco catálogos ───────────
-- Sin estos, borrar UN operador, UNA unidad o UN cliente recorre `viaje` entera.
create index if not exists viaje_operador_id_idx              on public.viaje (operador_id);
create index if not exists viaje_unidad_id_idx                on public.viaje (unidad_id);
create index if not exists viaje_cliente_id_idx               on public.viaje (cliente_id);
create index if not exists viaje_terminal_id_idx              on public.viaje (terminal_id);
