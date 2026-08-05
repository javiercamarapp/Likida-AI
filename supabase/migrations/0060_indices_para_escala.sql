-- 0060 — Los índices que hacen falta cuando dejen de ser 8 viajes de prueba.
--
-- Likida arranca con 30+ viajes diarios: ~660 comprobantes al día, ~20 mil al
-- mes, ~240 mil al año. Con los 8 viajes de prueba de hoy TODO va rápido, y eso
-- no prueba nada: un recorrido completo de tabla es instantáneo sobre 180 filas.
--
-- ── 1. LA COLA DE FACTURACIÓN ────────────────────────────────────────────
--
-- El cron de `/api/cron/facturar` busca gastos con `cfdi_uuid is null`. El único
-- índice que tocaba esa columna era `uq_gasto_cfdi_uuid`, y es PARCIAL sobre
-- justo lo contrario (`where cfdi_uuid is not null`), así que Postgres no lo
-- puede usar para buscar los nulos. Sin este índice, cada corrida —una por
-- hora— recorre la tabla entera y la ordena por fecha para quedarse con ocho
-- filas.
--
-- Se indexa PARCIALMENTE sobre lo pendiente, no sobre toda la tabla: lo ya
-- facturado no se vuelve a consultar nunca, y con el tiempo será la inmensa
-- mayoría. El índice se mantiene chico solo, y las filas salen de él al
-- facturarse.
--
-- ── 2. A QUIÉN SE LE AVISA EN CADA FLOTA ─────────────────────────────────
--
-- `telefonosJefe()` busca por (tenant_id, rol). `app_user` se queda chica
-- —decenas de filas por flota— así que hoy un recorrido es correcto y barato.
-- Se agrega igual porque cuesta nada y quita la duda: es el índice que sostiene
-- los dos avisos que salen HACIA la oficina, y esos no pueden depender de que
-- la tabla siga siendo chica.

create index if not exists gasto_por_facturar_idx
  on public.gasto (created_at)
  where cfdi_uuid is null;

create index if not exists app_user_tenant_rol_idx
  on public.app_user (tenant_id, rol)
  where telefono is not null;
