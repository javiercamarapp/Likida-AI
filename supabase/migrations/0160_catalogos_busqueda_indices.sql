-- ═══════════════════════════════════════════════════════════════════════════
-- 0160 · LOS CATÁLOGOS DEL PANEL SE BUSCAN, YA NO SE VUELCAN (FE-2)
--
-- Auditoría "qué tira producción", frontend, CRÍTICO. `listOperadores`
-- (repo.ts) y los dos catálogos sueltos de /dashboard/despacho (cliente y
-- unidad) no llevaban `.limit()`: a 7,500 choferes y 5,000 unidades PostgREST
-- recortaba a 1,000 EN SILENCIO —sin error, sin aviso— y el chofer 1,001
-- simplemente no existía para el despacho. Encima, ese catálogo entero se
-- pintaba UNA VEZ POR FILA (un `<select>` por viaje por asignar y otro por
-- viaje en curso): ~1.5-2 MB de HTML por carga para elegir UNO.
--
-- El arreglo vive en el código (`buscarCatalogo`/`contarCatalogo` en repo.ts +
-- `ComboCatalogo` en app/dashboard/combo-catalogo.tsx): la UI pide 20
-- opciones al escribir y nunca recibe el catálogo. Esta migración pone lo
-- único que ese arreglo necesita de la BASE: que el `%q%` de esas búsquedas
-- no sea un barrido del tenant.
--
-- SIN ESTOS ÍNDICES el arreglo sigue siendo correcto —el tope de 20 lo impone
-- el `.limit()`—, pero cada tecla del combo cuesta un seq scan de la tabla
-- entera filtrado por tenant. Con ellos, `ilike '%hern%'` entra como
-- condición de índice: es el mismo patrón (y el mismo EXPLAIN) que la 0154 ya
-- midió para la búsqueda del Registro de Viajes — Rows Removed by Filter
-- 199,944 de 200,000 sin GIN.
--
-- ── pg_trgm en `extensions`, no en `public` ─────────────────────────────────
-- Igual que la 0154: Supabase instala las extensiones en `extensions`, los
-- operadores `~~*`/`ilike` son del catálogo (no hace falta tocar search_path)
-- y solo la opclass se nombra calificada (`extensions.gin_trgm_ops`).
--
-- Índices sin CONCURRENTLY a propósito (regla 4 de REGLAS-ESCALA): el
-- orquestador decide cómo aplicarlos. Idempotente: `if not exists` en todo.
-- No crea ninguna garantía de unicidad/atomicidad/permisos — son índices de
-- velocidad —, pero el bloque 132 de verificaciones.sql comprueba que existan
-- y que la búsqueda del combo los pueda usar, porque su ausencia es
-- silenciosa exactamente igual que lo era el recorte que vienen a cerrar.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_trgm with schema extensions;

-- ── El arranque del combo: los primeros N por orden alfabético ──────────────
-- Sin `q`, la consulta es `where tenant_id = ? and activo order by <col>
-- limit 20`. Con estos índices parciales el planificador la resuelve leyendo
-- 20 entradas del índice y parando: ni ordena en memoria ni toca las 7,499
-- filas que no va a devolver. Parciales sobre `activo` porque el catálogo
-- SIEMPRE filtra activos — un chofer dado de baja no se puede despachar.
create index if not exists operador_catalogo_idx
  on public.operador (tenant_id, nombre)
  where activo;

comment on index public.operador_catalogo_idx is
  'Arranque del buscador de choferes del panel (buscarCatalogo, FE-2/0160): tenant + orden alfabético sobre los activos, para que `order by nombre limit 20` pare a las 20 entradas en vez de ordenar el tenant entero.';

create index if not exists cliente_catalogo_idx
  on public.cliente (tenant_id, nombre)
  where activo;

comment on index public.cliente_catalogo_idx is
  'Arranque del buscador de clientes del panel (buscarCatalogo, FE-2/0160). Mismo criterio que operador_catalogo_idx.';

create index if not exists unidad_catalogo_idx
  on public.unidad (tenant_id, numero_economico)
  where activo;

comment on index public.unidad_catalogo_idx is
  'Arranque del buscador de unidades del panel (buscarCatalogo, FE-2/0160). Ordena por numero_economico, que es lo que la pantalla enseña.';

-- ── La búsqueda `%q%` al escribir ──────────────────────────────────────────
-- GIN de trigramas, uno por columna buscada. Sin `tenant_id` adentro, por la
-- misma razón que la 0154: GIN no ordena, y el filtro de tenant se aplica
-- después sobre las pocas filas que sobreviven a los trigramas.
create index if not exists operador_nombre_trgm_idx
  on public.operador using gin (nombre extensions.gin_trgm_ops);

comment on index public.operador_nombre_trgm_idx is
  'Trigramas (pg_trgm en schema extensions) para el `ilike %q%` del buscador de choferes (FE-2/0160). Sin esto cada tecla del combo es un barrido del tenant — el mismo EXPLAIN que la 0154 midió para el Registro de Viajes.';

create index if not exists cliente_nombre_trgm_idx
  on public.cliente using gin (nombre extensions.gin_trgm_ops);

comment on index public.cliente_nombre_trgm_idx is
  'Trigramas para el `ilike %q%` del buscador de clientes (FE-2/0160).';

create index if not exists unidad_numero_economico_trgm_idx
  on public.unidad using gin (numero_economico extensions.gin_trgm_ops);

comment on index public.unidad_numero_economico_trgm_idx is
  'Trigramas para el `ilike %q%` del buscador de unidades (FE-2/0160).';

-- Estadísticas frescas para las tres: un índice recién creado sobre una tabla
-- sin analizar no lo elige el planificador (misma nota que la 0157).
analyze public.operador;
analyze public.cliente;
analyze public.unidad;
