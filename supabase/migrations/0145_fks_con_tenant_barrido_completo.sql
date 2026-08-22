-- ═══════════════════════════════════════════════════════════════════════════
-- 0145 — El aislamiento entre flotas dentro de TODAS las claves foráneas
--        (auditoría 18: C3 CRÍTICO + B9 BAJO). IDEMPOTENTE: segura de re-correr.
--
-- LA 0028 SE QUEDÓ EN CUATRO. Escribió la regla —"una FK entre dos tablas con
-- tenant_id va compuesta (col, tenant_id), o un autenticado de la flota A cuelga
-- su fila del padre de la flota B"— y la aplicó a las cuatro relaciones que
-- existían en julio. Después nacieron ~30 más y ninguna la siguió; la 0073
-- arregló UNA (`comprobante_huerfano.operador_id`) y dejó escrito que el resto
-- seguía abierto. Leído del catálogo vivo el 22-ago-2026: 36 FKs entre tablas
-- con tenant_id NOT NULL, 5 compuestas, 31 sin tenant.
--
-- LA QUE DUELE: `pago_recibido.factura_id → factura_emitida(id)`. Un contador de
-- A registra {tenant_id: A, factura_id: <factura de B por $250,000>}: el WITH
-- CHECK pasa (su tenant), la FK pasa (la factura existe). `factura_saldo` suma
-- pagos SOLO por factura_id, y `getCobranza` la lee con service role: la
-- pantalla de B dice "pagada, saldo $0.00" y B no puede ver el abono que lo
-- explica, porque es de A. Es el error que el producto existe para no cometer.
--
-- QUÉ CAMBIA RESPECTO A LA 0028, Y POR QUÉ AHORA SÍ SE PUEDE CERRAR TODO:
--  · Las columnas NULLABLE con `on delete set null` (cfdi_xml.gasto_id,
--    llm_costo.*, viaje.unidad_id, …) quedaron fuera en la 0028 porque un
--    SET NULL compuesto intentaría anular también `tenant_id` (NOT NULL) y
--    reventaría el DELETE del padre. Postgres 15+ admite
--    `on delete set null (columna)` — anula SOLO esa columna. Producción corre
--    PostgreSQL 17.6 (comprobado con `select version()` el 22-ago) y el CI
--    usa postgres:16. La decisión de versión que la 0028 no quiso tomar ya
--    está tomada por la plataforma.
--  · `factura_viaje` NO tenía `tenant_id` (hereda el de su factura vía EXISTS
--    en la policy). Sin columna no hay FK compuesta posible, y su WITH CHECK
--    solo valida el lado de la factura: {factura de A, viaje de B} entraba.
--    Se le agrega `tenant_id`, heredado de la factura por un trigger BEFORE
--    (el código que inserta no tiene que cambiar), y las dos FK compuestas:
--    la fila solo puede existir si factura Y viaje son de ESA flota.
--  · `wa_conversacion.tenant_id` era NULLABLE (0001:80) — la 0028 la dejó
--    fuera por eso (B9: el índice único no cubre NULL y esas filas son
--    invisibles para toda policy). Hoy `loadConversation` siempre escribe el
--    tenant (conv.ts:263) y en producción hay 0 filas con NULL. Se cierra la
--    nulabilidad y entra al barrido como cualquier otra tabla.
--
-- LAS FK SIMPLES SE QUEDAN (mismo criterio que la 0028 y la 0073): son
-- restricciones distintas, no una sustituye a la otra.
--
-- COMPROBADO CONTRA PRODUCCIÓN el 22-ago-2026 ANTES de escribir esto: las 36
-- relaciones, cero filas cruzadas (21,679 gastos, 6,204 viajes, 5,723
-- liquidaciones, 333 pagos). Ninguna de estas FK está violada hoy; la
-- migración valida de inmediato y, si mañana lo estuviera, dice CUÁNTAS y
-- en cuál en vez de "is not present in table".
--
-- LA REGLA YA NO DEPENDE DE ACORDARSE: el bloque 112 de verificaciones.sql
-- barre el catálogo y se pone ROJO en CI con cualquier FK futura entre dos
-- tablas con tenant_id que no traiga su compuesta.
--
-- Reversible: `drop constraint` por cada FK de la lista de abajo, después los
-- siete `unique (id, tenant_id)`, el trigger y la columna de factura_viaje, y
-- `alter column tenant_id drop not null` en wa_conversacion.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. B9: wa_conversacion.tenant_id deja de admitir NULL ───────────────────
do $$
declare n bigint;
begin
  select count(*) into n from public.wa_conversacion where tenant_id is null;
  if n > 0 then
    raise exception 'wa_conversacion: % fila(s) sin tenant_id. Son historial de conversación (dato personal, LFPDPPP) sin flota a la que atribuirlo: decide a quién pertenecen o bórralas antes de volver a aplicar.', n;
  end if;
  alter table public.wa_conversacion alter column tenant_id set not null;
end $$;

comment on column public.wa_conversacion.tenant_id is
  'NOT NULL desde la 0145 (B9). Con NULL, el índice único (tenant_id, telefono) no cubría la fila y ninguna policy la veía: historial de WhatsApp sin dueño y sin pantalla desde la cual borrarlo.';

-- ── 1. Los destinos: unique (id, tenant_id) donde faltaba ───────────────────
-- Misma forma que la 0028 §1: `id` ya es PK, el índice extra es el precio de
-- poder apuntarle con una FK compuesta.
do $$
declare r record;
begin
  for r in select * from (values
      ('cfdi_xml',        'cfdi_xml_id_tenant_key'),
      ('cliente',         'cliente_id_tenant_key'),
      ('desglose_peaje',  'desglose_peaje_id_tenant_key'),
      ('factura_emitida', 'factura_emitida_id_tenant_key'),
      ('suscripcion',     'suscripcion_id_tenant_key'),
      ('terminal',        'terminal_id_tenant_key'),
      ('unidad',          'unidad_id_tenant_key')
    ) as t(tabla, nombre)
  loop
    if not exists (
      select 1 from pg_constraint
      where conname = r.nombre and conrelid = format('public.%I', r.tabla)::regclass
    ) then
      execute format('alter table public.%I add constraint %I unique (id, tenant_id)', r.tabla, r.nombre);
    end if;
  end loop;
end $$;

-- ── 2. factura_viaje gana tenant_id, heredado de su factura ─────────────────
alter table public.factura_viaje
  add column if not exists tenant_id uuid references public.tenant(id) on delete cascade;

update public.factura_viaje fv
   set tenant_id = f.tenant_id
  from public.factura_emitida f
 where f.id = fv.factura_id and fv.tenant_id is null;

create or replace function public.factura_viaje_hereda_tenant()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- El tenant NO se teclea: es el de la factura. Si el llamador lo manda, las
  -- FK compuestas de abajo exigen que coincida con factura Y viaje.
  if new.tenant_id is null then
    select tenant_id into new.tenant_id from public.factura_emitida where id = new.factura_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_factura_viaje_hereda_tenant on public.factura_viaje;
create trigger trg_factura_viaje_hereda_tenant
  before insert or update of factura_id, tenant_id on public.factura_viaje
  for each row execute function public.factura_viaje_hereda_tenant();

alter table public.factura_viaje alter column tenant_id set not null;

comment on column public.factura_viaje.tenant_id is
  'Heredado de factura_emitida por trigger (0145). Existe para que las FK compuestas (factura_id, tenant_id) y (viaje_id, tenant_id) exijan que factura y viaje sean de la MISMA flota — antes {factura de A, viaje de B} pasaba el WITH CHECK.';

-- ── 3. Las relaciones, todas ────────────────────────────────────────────────
do $$
declare r record; n bigint;
begin
  for r in select * from (values
      -- (tabla, nombre, columna, destino, acción on delete)
      ('cfdi_consolidado_linea', 'cfdi_consolidado_linea_cfdi_xml_tenant_fkey', 'cfdi_xml_id',    'cfdi_xml',        'cascade'),
      ('cfdi_consolidado_linea', 'cfdi_consolidado_linea_gasto_tenant_fkey',    'gasto_id',       'gasto',           'set null (gasto_id)'),
      ('cfdi_xml',               'cfdi_xml_gasto_tenant_fkey',                  'gasto_id',       'gasto',           'set null (gasto_id)'),
      ('cobranza_contacto',      'cobranza_contacto_viaje_tenant_fkey',         'viaje_id',       'viaje',           'cascade'),
      ('comprobante_huerfano',   'comprobante_huerfano_viaje_tenant_fkey',      'viaje_id',       'viaje',           'set null (viaje_id)'),
      ('cotizacion',             'cotizacion_cliente_tenant_fkey',              'cliente_id',     'cliente',         'set null (cliente_id)'),
      ('cotizacion',             'cotizacion_viaje_tenant_fkey',                'viaje_id',       'viaje',           'set null (viaje_id)'),
      ('desglose_peaje_linea',   'desglose_peaje_linea_desglose_tenant_fkey',   'desglose_id',    'desglose_peaje',  'cascade'),
      ('desglose_peaje_linea',   'desglose_peaje_linea_viaje_tenant_fkey',      'viaje_id',       'viaje',           'set null (viaje_id)'),
      ('factura_emitida',        'factura_emitida_cliente_tenant_fkey',         'cliente_id',     'cliente',         'restrict'),
      ('factura_emitida',        'factura_emitida_viaje_tenant_fkey',           'viaje_id',       'viaje',           'set null (viaje_id)'),
      ('factura_saas',           'factura_saas_suscripcion_tenant_fkey',        'suscripcion_id', 'suscripcion',     'set null (suscripcion_id)'),
      ('factura_viaje',          'factura_viaje_factura_tenant_fkey',           'factura_id',     'factura_emitida', 'cascade'),
      ('factura_viaje',          'factura_viaje_viaje_tenant_fkey',             'viaje_id',       'viaje',           'cascade'),
      ('incidencia',             'incidencia_gasto_tenant_fkey',                'gasto_id',       'gasto',           'set null (gasto_id)'),
      ('incidencia',             'incidencia_unidad_tenant_fkey',               'unidad_id',      'unidad',          'set null (unidad_id)'),
      ('incidencia',             'incidencia_viaje_tenant_fkey',                'viaje_id',       'viaje',           'cascade'),
      ('llm_costo',              'llm_costo_liquidacion_tenant_fkey',           'liquidacion_id', 'liquidacion',     'set null (liquidacion_id)'),
      ('llm_costo',              'llm_costo_viaje_tenant_fkey',                 'viaje_id',       'viaje',           'set null (viaje_id)'),
      ('mantenimiento',          'mantenimiento_unidad_tenant_fkey',            'unidad_id',      'unidad',          'cascade'),
      ('operador',               'operador_terminal_tenant_fkey',               'terminal_id',    'terminal',        'set null (terminal_id)'),
      ('pago_recibido',          'pago_recibido_factura_tenant_fkey',           'factura_id',     'factura_emitida', 'cascade'),
      ('pod',                    'pod_operador_tenant_fkey',                    'operador_id',    'operador',        'set null (operador_id)'),
      ('pod',                    'pod_viaje_tenant_fkey',                       'viaje_id',       'viaje',           'cascade'),
      ('posicion',               'posicion_unidad_tenant_fkey',                 'unidad_id',      'unidad',          'cascade'),
      ('solicitud_arco',         'solicitud_arco_operador_tenant_fkey',         'operador_id',    'operador',        'set null (operador_id)'),
      ('tarifa',                 'tarifa_cliente_tenant_fkey',                  'cliente_id',     'cliente',         'cascade'),
      ('ticket_soporte',         'ticket_soporte_viaje_tenant_fkey',            'viaje_id',       'viaje',           'set null (viaje_id)'),
      ('viaje',                  'viaje_cliente_tenant_fkey',                   'cliente_id',     'cliente',         'set null (cliente_id)'),
      ('viaje',                  'viaje_terminal_tenant_fkey',                  'terminal_id',    'terminal',        'set null (terminal_id)'),
      ('viaje',                  'viaje_unidad_tenant_fkey',                    'unidad_id',      'unidad',          'set null (unidad_id)'),
      ('wa_conversacion',        'wa_conversacion_operador_tenant_fkey',        'operador_id',    'operador',        'set null (operador_id)'),
      ('wa_conversacion',        'wa_conversacion_viaje_tenant_fkey',           'viaje_id',       'viaje',           'set null (viaje_id)')
    ) as t(tabla, nombre, columna, destino, accion)
  loop
    if exists (
      select 1 from pg_constraint
      where conname = r.nombre and conrelid = format('public.%I', r.tabla)::regclass
    ) then
      continue;   -- idempotente
    end if;

    -- Cuántas filas están cruzadas, ANTES de intentarlo (0028 §2). Una columna
    -- NULL no cruza nada: MATCH SIMPLE no la comprueba, igual que la FK.
    execute format(
      'select count(*) from public.%I h where h.%I is not null and not exists (
         select 1 from public.%I d where d.id = h.%I and d.tenant_id = h.tenant_id)',
      r.tabla, r.columna, r.destino, r.columna
    ) into n;

    if n > 0 then
      raise exception
        'No se puede aplicar %.%: hay % fila(s) de % cuyo tenant_id NO coincide con el de su % (o cuyo padre no existe). Cada una es un dato contado en la flota equivocada. Revísalas antes de volver a aplicar.',
        r.tabla, r.nombre, n, r.tabla, r.destino;
    end if;

    execute format(
      'alter table public.%I add constraint %I foreign key (%I, tenant_id) references public.%I (id, tenant_id) on delete %s',
      r.tabla, r.nombre, r.columna, r.destino, r.accion
    );
  end loop;
end $$;

comment on constraint pago_recibido_factura_tenant_fkey on public.pago_recibido is
  'El pago y su factura son de la MISMA flota (0145, C3). Sin esto, un contador de A podía abonar a una factura de B: factura_saldo la pintaba pagada y B no podía ver el abono que lo explicaba.';

comment on constraint factura_emitida_cliente_tenant_fkey on public.factura_emitida is
  'La factura y su cliente son de la MISMA flota (0145). La comprobación "ese cliente no está en tu flota" vivía solo en facturacion_escritura.ts:262; ahora también es de la base.';

comment on constraint factura_viaje_viaje_tenant_fkey on public.factura_viaje is
  'El viaje amparado es de la flota de la factura (0145). El WITH CHECK de factura_viaje solo validaba el lado de la factura; {factura de A, viaje de B} entraba y ligaba el viaje de otra flota al ingreso facturado de A.';
