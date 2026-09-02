-- 0261 · AUDITORÍA 20, BE-C1 (CRÍTICO) — el desempate de una ráfaga de
-- WhatsApp no era cronológico.
--
-- `guardarEventosPendientes` (wa_pendientes.ts) inserta TODA la ráfaga de un
-- POST del webhook en un solo upsert — un único
-- `INSERT ... VALUES (...),(...),... ON CONFLICT DO NOTHING`. La columna
-- `recibido_en` (0119) tenía `default now()`, y `now()` (= transaction_
-- timestamp()) se fija UNA vez al iniciar la transacción: cada fila de esa
-- ráfaga recibía el MISMO `recibido_en`, sin importar cuántos mensajes
-- traía el arreglo.
--
-- El desempate `(recibido_en, id)` que usan `listar_wa_pendientes` (0194) y,
-- sobre todo, `reclamar_wa_pendiente` (0187) — que bloquea con un
-- `NOT EXISTS` cualquier evento del mismo remitente que sea "anterior" y
-- siga sin `procesado_en` — caía entonces sobre `id`: el wamid de Meta, que
-- ordena alfabéticamente, no en el tiempo. Con una ráfaga de dos fotos y un
-- "listo" cuyos wamids empiecen, por azar, con una letra menor, el cron podía
-- reclamar y procesar el "listo" ANTES que las fotos — y cerrar el cuadre
-- sin ellas.
--
-- EL ARREGLO: `clock_timestamp()` sí avanza fila por fila DENTRO del mismo
-- statement (a diferencia de `now()`, fijo para toda la transacción) — es el
-- mismo reloj que ya usan los leases de esta tabla (0187: `lease_expires_at
-- = clock_timestamp() + …`) para todo lo que necesita el tiempo real de
-- Postgres, no el de la transacción. Con este default, cada fila de una
-- ráfaga insertada en un solo statement recibe un `recibido_en` distinto y
-- creciente en el orden en que Postgres las evalúa (el mismo orden en que
-- llegaron en el arreglo del webhook).
--
-- ALCANCE DELIBERADAMENTE ANGOSTO: solo `wa_evento_pendiente.recibido_en`.
-- Revisado el resto del código que lo toca:
--   · `0155` (purga de cartas muertas) y `admin/slo.ts` (SLO del drenado)
--     solo comparan `recibido_en < X` — nunca por igualdad ni agrupan por
--     él, así que no dependen de que la transacción vea un valor fijo.
--   · `candidato.recibido_en` (0219) es otro dominio (reclutamiento, sin
--     ráfaga de upsert) y no se toca aquí.
alter table public.wa_evento_pendiente
  alter column recibido_en set default clock_timestamp();

comment on column public.wa_evento_pendiente.recibido_en is
  'AUDITORÍA 20 (BE-C1): default clock_timestamp(), NO now(). El desempate (recibido_en, id) de listar_wa_pendientes/reclamar_wa_pendiente necesita que una ráfaga insertada en UN SOLO statement (guardarEventosPendientes) reciba timestamps distintos por fila — now() los empata a todos y el desempate cae en el wamid, que no es cronológico.';
