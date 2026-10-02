-- ═══════════════════════════════════════════════════════════════════════════
-- 0600 · FK compuestas (col, tenant_id) que faltaban tras la ola 2 y la ola 3
--
-- La regla de la 0028/0145: TODA FK entre dos tablas con tenant_id lleva su
-- hermana compuesta, para que {fila de A, padre de B} sea imposible en la base
-- y no solo en el código. El bloque 112 de `verificaciones.sql` barre
-- `pg_constraint` y lista las que se saltan el patrón. La integración de la
-- ola 3 corrió por primera vez la cadena completa (0001..0542) y el bloque
-- encontró cinco relaciones nuevas sin compuesta:
--
--   · desglose_peaje.ingesta_archivo_id        -> peaje_ingesta_archivo   (0376)
--   · peaje_ingesta_archivo.desglose_id        -> desglose_peaje          (0376)
--   · desglose_peaje_linea.caseta_id           -> peaje_caseta            (0375)
--   · desglose_peaje_linea.unidad_id           -> unidad                  (0375)
--   · cobranza_gasto_contacto.operador_id      -> operador                (0525)
--
-- Idempotente: cada FK se salta si ya existe y las UNIQUE (id, tenant_id) que
-- sirven de destino se crean solo si faltan. Si hubiera filas cruzadas de
-- flota, la migración se detiene con el conteo (jamás las "arregla" en
-- silencio: cada una sería un dato contado en la flota equivocada).
-- `on delete set null (col)` (Postgres 15+) anula SOLO la columna, nunca el
-- tenant_id, igual que en la 0145.
-- ═══════════════════════════════════════════════════════════════════════════

-- Destinos: las dos tablas de peajes que no tenían UNIQUE (id, tenant_id).
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'peaje_caseta_id_tenant_key' and conrelid = 'public.peaje_caseta'::regclass
  ) then
    alter table public.peaje_caseta
      add constraint peaje_caseta_id_tenant_key unique (id, tenant_id);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'peaje_ingesta_archivo_id_tenant_key' and conrelid = 'public.peaje_ingesta_archivo'::regclass
  ) then
    alter table public.peaje_ingesta_archivo
      add constraint peaje_ingesta_archivo_id_tenant_key unique (id, tenant_id);
  end if;
end $$;

do $$
declare r record; n bigint;
begin
  for r in select * from (values
      ('desglose_peaje',          'desglose_peaje_ingesta_archivo_tenant_fkey',   'ingesta_archivo_id', 'peaje_ingesta_archivo', 'set null (ingesta_archivo_id)'),
      ('peaje_ingesta_archivo',   'peaje_ingesta_archivo_desglose_tenant_fkey',   'desglose_id',        'desglose_peaje',        'set null (desglose_id)'),
      ('desglose_peaje_linea',    'desglose_peaje_linea_caseta_tenant_fkey',      'caseta_id',          'peaje_caseta',          'set null (caseta_id)'),
      ('desglose_peaje_linea',    'desglose_peaje_linea_unidad_tenant_fkey',      'unidad_id',          'unidad',                'set null (unidad_id)'),
      ('cobranza_gasto_contacto', 'cobranza_gasto_contacto_operador_tenant_fkey', 'operador_id',        'operador',              'set null (operador_id)')
    ) as t(tabla, nombre, columna, destino, accion)
  loop
    -- Una tabla puede no existir todavía en una base a medio migrar: se salta.
    if to_regclass(format('public.%I', r.tabla)) is null then continue; end if;
    if exists (
      select 1 from pg_constraint
       where conname = r.nombre and conrelid = format('public.%I', r.tabla)::regclass
    ) then
      continue;   -- idempotente
    end if;

    execute format(
      'select count(*) from public.%I h where h.%I is not null and not exists (
         select 1 from public.%I d where d.id = h.%I and d.tenant_id = h.tenant_id)',
      r.tabla, r.columna, r.destino, r.columna
    ) into n;

    if n > 0 then
      raise exception
        'No se puede aplicar %.%: hay % fila(s) de % cuyo tenant_id NO coincide con el de su % (o cuyo padre no existe). Revísalas antes de volver a aplicar.',
        r.tabla, r.nombre, n, r.tabla, r.destino;
    end if;

    execute format(
      'alter table public.%I add constraint %I foreign key (%I, tenant_id) references public.%I (id, tenant_id) on delete %s',
      r.tabla, r.nombre, r.columna, r.destino, r.accion
    );
  end loop;
end $$;
