-- ═══════════════════════════════════════════════════════════════════════════
-- demo-5k-limpiar.sql — borra ENTERO el tenant demo
-- «Transportes Peninsulares, S.A. de C.V.» (scripts/demo-5k.sql).
--
-- Un solo DELETE sobre `tenant`: todas las tablas de negocio cuelgan de él con
-- ON DELETE CASCADE (0001, 0047-0050, 0053…), y las FK hijas tienen índice por
-- tenant_id (0071) para que la cascada no escanee tablas enteras. Las pocas FK
-- a tenant SIN cascade (chat_conversacion, cobranza_contacto, prospecto) no
-- tienen filas de este tenant — el bloque lo comprueba y se niega si las hay.
--
-- bitacora_auditoria y evento_seguridad son ON DELETE SET NULL (append-only,
-- a propósito): las entradas de "ver como" de Javier sobre este tenant quedan
-- con tenant_id nulo, no se borran.
--
-- Se niega a borrar si el uuid fijo no se llama como la demo: si alguien
-- reutilizó el id para otra flota, esto no se la lleva.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  t uuid := 'dddddddd-0000-4000-8000-000000005000';
  n text;
  huerfanas int;
  t0 timestamptz := clock_timestamp();
begin
  select nombre into n from tenant where id = t;
  if n is null then
    raise notice 'TPS no existe: nada que limpiar';
    return;
  end if;
  if n <> 'Transportes Peninsulares, S.A. de C.V.' then
    raise exception 'el tenant % se llama "%" y no es la demo TPS: no se borra', t, n;
  end if;

  select (select count(*) from chat_conversacion where tenant_id = t)
       + (select count(*) from cobranza_contacto where tenant_id = t)
       + (select count(*) from prospecto where tenant_id = t) into huerfanas;
  if huerfanas > 0 then
    raise exception 'hay % filas en chat_conversacion/cobranza_contacto/prospecto (FK sin cascade): bórralas primero', huerfanas;
  end if;

  -- Las cuentas web ligadas al tenant (si alguien creó alguna) caen por cascade
  -- en app_user; el usuario de auth.users NO — queda sin fila en app_user
  -- (= "alta pendiente"). La demo no crea ninguna: Javier entra con su superadmin.
  delete from tenant where id = t;
  raise notice 'TPS borrado en % (cascada: terminal, operador, unidad, cliente, tarifa, viaje, gasto, liquidacion, pod, incidencia, mantenimiento, comprobante_huerfano, factura_emitida, pago_recibido, impersonacion_dia)',
    clock_timestamp() - t0;
end $$;

-- Debe devolver ceros:
select
  (select count(*) from tenant      where id = 'dddddddd-0000-4000-8000-000000005000')        as tenant,
  (select count(*) from operador    where tenant_id = 'dddddddd-0000-4000-8000-000000005000') as operadores,
  (select count(*) from unidad      where tenant_id = 'dddddddd-0000-4000-8000-000000005000') as unidades,
  (select count(*) from viaje       where tenant_id = 'dddddddd-0000-4000-8000-000000005000') as viajes,
  (select count(*) from gasto       where tenant_id = 'dddddddd-0000-4000-8000-000000005000') as gastos,
  (select count(*) from liquidacion where tenant_id = 'dddddddd-0000-4000-8000-000000005000') as liquidaciones,
  (select count(*) from factura_emitida where tenant_id = 'dddddddd-0000-4000-8000-000000005000') as facturas;
