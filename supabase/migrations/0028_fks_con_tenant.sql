-- ═══════════════════════════════════════════════════════════════════════════
-- 0028 — El aislamiento entre flotas, dentro de las claves foráneas.
--
-- MEDIO de la auditoría 5 (modelo de datos). Se cierra aquí porque es puro
-- esquema y no toca una línea de `src/`.
--
-- QUÉ ESTÁ MAL HOY. Las 22 claves foráneas del esquema apuntan todas a `(id)`:
-- `gasto_viaje_id_fkey → viaje(id)`, `liquidacion_viaje_id_fkey → viaje(id)`,
-- `viaje_operador_id_fkey → operador(id)`… Ninguna es compuesta con
-- `tenant_id`. Y la policy `tenant_data` de 0001:113-117 solo comprueba
-- `tenant_id = any(get_user_tenant_ids())` sobre la fila que se inserta: la
-- verificación de la FK no mira tenant, y además ignora la RLS.
--
-- EL ESCENARIO CON VALORES. Un usuario autenticado del tenant A, vía PostgREST:
--
--     insert into gasto (tenant_id, viaje_id, concepto, monto)
--     values ('<A>', '<uuid de un viaje del tenant B>', 'diesel', 50000);
--
-- El `WITH CHECK` pasa —el `tenant_id` que escribe es el suyo— y la FK pasa —el
-- viaje existe—. Queda una fila con `gasto.tenant_id` ≠ `viaje.tenant_id`.
--
-- LA CONSECUENCIA. La fila es INVISIBLE para `getGastos(viajeId, B)`, que filtra
-- por los dos, así que el dueño del viaje no la ve nunca. Pero SÍ entra en
-- `getAcumuladoCombustible(A)` (repo.ts:424, que filtra por tenant y concepto,
-- no por viaje) y en los KPI del panel de A: $50,000 de diésel que nadie gastó,
-- metidos en el denominador del 15% de RFA 2026 regla 2.9 de otra flota.
--
-- Y el mismo hueco por dentro: `guardar_liquidacion_tx` recibe el tenant como
-- PARÁMETRO y nunca lo compara contra el del viaje (0013:26-31, 0021:31-37).
-- Una llamada con el par equivocado escribe una liquidación en la flota A sobre
-- un viaje de la flota B. Con la FK compuesta, ese INSERT ya no puede pasar —el
-- arreglo cae dentro de la función sin editarla.
--
-- POR QUÉ COMPUESTA Y NO UN TRIGGER. Un trigger es código que hay que mantener,
-- probar y que se puede desactivar. Una FK compuesta es una propiedad de la
-- clave: el aislamiento deja de ser "una columna repetida en cada tabla" y pasa
-- a ser parte de la relación, que es lo que siempre debió ser.
--
-- LO QUE NO SE TOCA, Y POR QUÉ:
--
--  · Las FK de una sola columna siguen ahí. Son redundantes con las nuevas, y
--    dropearlas a nueve días del demo no compra nada: la comprobación de más
--    cuesta microsegundos y quitarlas sí puede sorprender.
--  · `cfdi_xml.gasto_id` y `llm_costo.viaje_id`/`liquidacion_id` quedan fuera.
--    Las tres son `on delete set null` sobre una columna NULLABLE junto a un
--    `tenant_id` NOT NULL: una FK compuesta con SET NULL intentaría anular
--    también el tenant y reventaría el DELETE. Se pueden cerrar con
--    `on delete set null (columna)` (Postgres 15+), pero eso es una decisión de
--    versión que no toca tomar en esta migración. Ninguna de las tres está en el
--    camino del dinero.
--  · `wa_conversacion` queda fuera: su `tenant_id` es NULLABLE (0001:80) y una
--    FK compuesta con MATCH SIMPLE no comprueba nada cuando una columna es NULL.
--
-- COMPROBADO CONTRA LOS DATOS VIVOS el 28-jul-2026: hay un solo tenant
-- (`11111111-…`) y las 8 filas de `gasto`, las 6 de `viaje`, las 5 de
-- `liquidacion`, las 3 de `operador` y las 0 de `codigo_pendiente` son todas
-- suyas. Cero cruces. Ninguna de estas FK está violada hoy.
--
-- Reversible: `alter table <t> drop constraint <nombre>;` por cada FK, y después
-- las cuatro `unique (id, tenant_id)`.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Los destinos ─────────────────────────────────────────────────────────
-- Una FK compuesta necesita un índice único sobre EXACTAMENTE esas columnas en
-- la tabla destino. `id` ya es PK, así que `(id, tenant_id)` es redundante en
-- cuanto a unicidad —no puede haber dos filas con el mismo id— pero Postgres lo
-- exige para poder apuntarle. El índice extra es el precio del aislamiento.
do $$
declare r record;
begin
  for r in select * from (values
      ('viaje',       'viaje_id_tenant_key'),
      ('operador',    'operador_id_tenant_key'),
      ('gasto',       'gasto_id_tenant_key'),
      ('liquidacion', 'liquidacion_id_tenant_key')
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

-- ── 2. Las relaciones del camino del dinero ─────────────────────────────────
do $$
declare r record; n bigint;
begin
  for r in select * from (values
      -- (tabla, nombre de la FK, columnas de origen, tabla destino, on delete)
      ('gasto',            'gasto_viaje_tenant_fkey',            'viaje_id, tenant_id',    'viaje',    'cascade'),
      ('liquidacion',      'liquidacion_viaje_tenant_fkey',      'viaje_id, tenant_id',    'viaje',    'cascade'),
      ('codigo_pendiente', 'codigo_pendiente_viaje_tenant_fkey', 'viaje_id, tenant_id',    'viaje',    'cascade'),
      ('viaje',            'viaje_operador_tenant_fkey',         'operador_id, tenant_id', 'operador', 'restrict')
    ) as t(tabla, nombre, columnas, destino, accion)
  loop
    if exists (
      select 1 from pg_constraint
      where conname = r.nombre and conrelid = format('public.%I', r.tabla)::regclass
    ) then
      continue;   -- idempotente
    end if;

    -- Decir CUÁNTAS filas están cruzadas antes de intentarlo. Un ADD CONSTRAINT
    -- que falla solo dice "is not present in table"; esto dice el tamaño del
    -- problema, que es lo que decide si se limpia a mano o se investiga.
    execute format(
      'select count(*) from public.%I h where not exists (
         select 1 from public.%I d where d.id = h.%I and d.tenant_id = h.tenant_id)',
      r.tabla, r.destino, split_part(r.columnas, ',', 1)
    ) into n;

    if n > 0 then
      raise exception
        'No se puede aplicar %.%: hay % fila(s) de % cuyo tenant_id NO coincide con el de su % (o cuyo padre no existe). Cada una es dinero contado en la flota equivocada. Revísalas antes de volver a aplicar.',
        r.tabla, r.nombre, n, r.tabla, r.destino;
    end if;

    execute format(
      'alter table public.%I add constraint %I foreign key (%s) references public.%I (id, tenant_id) on delete %s',
      r.tabla, r.nombre, r.columnas, r.destino, r.accion
    );
  end loop;
end $$;

comment on constraint gasto_viaje_tenant_fkey on gasto is
  'El gasto y su viaje son de la MISMA flota. Sin esto, un autenticado del tenant A podía colgar un gasto suyo del viaje de B: invisible para B y contado en el 15% de combustible de A.';

comment on constraint liquidacion_viaje_tenant_fkey on liquidacion is
  'La liquidación y su viaje son de la MISMA flota. Cierra por esquema el hueco de guardar_liquidacion_tx, que recibe el tenant como parámetro y nunca lo compara contra el del viaje.';
