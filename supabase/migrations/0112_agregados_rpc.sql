-- ═══════════════════════════════════════════════════════════════════════════
-- 0112 — Los agregados de JS con fecha de caducidad: a RPC.
--
-- El P1 más caro de la auditoría externa del 15-ago-2026: quedaban caminos
-- del patrón "traer muchas filas → agregarlas en JavaScript" con fecha de
-- caducidad CALCULABLE contra el volumen de un cliente de 15,000 viajes/mes
-- (docs/escala-15k.md §6). `traerTodo` es correcto —lanza en vez de truncar—
-- pero LANZA: su techo son 100 páginas = 100,000 filas (pg.ts:45-48), y cada
-- función que lee una tabla ENTERA del tenant tiene un mes en el que la
-- pantalla del CLIENTE (o el CIERRE) empieza a mostrar su estado de error.
--
-- Se mueven CUATRO caminos al patrón que la 0062/0064 ya validaron dos veces:
-- sum()/count() en SQL, UN viaje de red, resultado en jsonb (el primero,
-- `table` por la razón que su sección explica). Prioridad: por fecha de
-- caducidad Y por si corren en el camino CALIENTE (el cuadre) o en un panel —
-- el cuadre gana aunque su fecha sea más lejana, porque si el cuadre deja de
-- cerrar el producto entero se detiene, no solo una pantalla.
--
--   1. sumar_combustible_ejercicio (CORRIGE Y CONECTA la 0084, no crea nada)
--      ← getAcumuladoCombustible (repo.ts). CAMINO CALIENTE: corre EN CADA
--      CUADRE (~12,000 veces/mes con este cliente). Caduca ~mes 6.7, pero es
--      el único de los cuatro que DETIENE EL CIERRE al reventar (repo.ts,
--      MAX_PAGINAS=100), no solo una pantalla. Va primero. HALLAZGO: la RPC
--      para esto ya existía, aplicada en producción desde el 05-ago-2026, y
--      nadie la llamaba (ver su sección para la evidencia y el bug que tenía).
--   2. serie_comparativa_tenant        ← getSerieComparativa (analytics.ts)
--      Caduca ~mes 2.2 por el lado de `gasto` (la vista "histórico" de
--      getSeriesKpiCards lee ~10 años, prácticamente la tabla entera) — el
--      MISMO mes que getGastosFiscales/'ejercicio' (ver abajo por qué ESA no
--      se mueve aquí) — y corre en CADA carga del Resumen y del panel del
--      contador, TRES veces (semanal/mensual/histórico).
--   3. kpis_liquidacion_tenant         ← getKpis (analytics.ts)
--   4. acreditables_liquidacion_tenant ← getAcreditables (analytics.ts)
--      Las dos sobre `liquidacion`: caducan ~mes 8.3, las últimas de las
--      cuatro, pero se leen en CADA carga de /dashboard y /dashboard/contador
--      (getKpis, siempre sin ventana ahí) y en cada consulta de acreditables
--      del panel fiscal y de la herramienta de chat `acreditables_periodo`.
--
-- ── LO QUE NO SE MUEVE AQUÍ, Y POR QUÉ (getGastosFiscales, fiscal.ts:799) ───
--
-- Está en la MISMA fecha de caducidad (~mes 2.2, `gasto` del ejercicio) y es
-- la lectura más grande de las cinco identificadas en §6 — pero NO es un
-- `sum()`/`count()`. Sus filas ROW-LEVEL (folio, RFC emisor, UUID de CFDI,
-- estado SAT, EFOS, forma de pago, IVA/IEPS trasladado) alimentan
-- `resumirFiscal` y `resumirPerdidas` (fiscal.ts), que evalúan DEDUCIBILIDAD
-- por comprobante: proporción de IVA acreditable por tope de viáticos
-- (`proporcionAlimentacionPorGasto`, que depende de la config del tenant),
-- vigencia 69-B (EFOS), IEPS del diésel condicionado a forma de pago, y el
-- PLAZO DE CADUCIDAD DEL PORTAL DEL COMERCIO (`armarPorFacturar`, política
-- por comercio de `facturacion/caducidad.ts`) — reglas fiscales citadas
-- contra fichas verificadas de `normas/`, no aritmética.
--
-- Reimplementar esa lógica en SQL para volverla un agregado sería DUPLICAR
-- la ley fiscal en dos lenguajes: el día que cambie una regla (la RFA es
-- vigente por EJERCICIO, se renueva cada año), hay dos lugares que
-- actualizar y el riesgo real es que se actualice uno y no el otro —
-- exactamente lo que la regla de "nunca inventar una cifra" existe para
-- evitar en un producto que el contralor cruza contra su papel de trabajo.
-- No es "no conviene por volumen": es que la lógica es demasiado móvil para
-- vivir en dos sitios a la vez. `getGastosFiscales` sigue con fecha de
-- caducidad ~mes 2.2 de cada ejercicio (docs/escala-15k.md §6, sin resolver
-- en esta pasada). El mitigante que SÍ se puede mover sin duplicar la ley
-- fiscal —acotar el periodo por defecto del panel del contador— es una
-- decisión de PRODUCTO (qué ve el contador al entrar), no de rendimiento, y
-- no se cuela dentro de una migración de escala.
--
-- ── EL MOLDE: SECURITY INVOKER, no DEFINER ──────────────────────────────────
--
-- Las cuatro son tenant-scoped, como la 0064, y por la MISMA razón son
-- INVOKER (el default) y no DEFINER: la app llama con `service_role`, que ya
-- salta RLS —un `definer` no daría ni un permiso más—, y SÍ haría daño: un
-- `revoke` olvidado sobre una `definer` filtra costo/dinero entre flotas;
-- sobre una `invoker`, la RLS de `gasto`/`liquidacion`/`viaje` (0003 y
-- posteriores) sigue aplicando encima y un `anon` sigue viendo cero filas.
-- `p_tenant` va SIN default en las cuatro: olvidarlo es un 404 de PostgREST
-- por firma no encontrada, no la base entera de todas las flotas — mismo
-- argumento que la 0064 (resumen_costo_ia_tenant / resumen_documentos_tenant).
--
-- `revoke`/`grant` van igual, cinturón y tirantes: Postgres otorga EXECUTE a
-- PUBLIC en toda función nueva, y `anon`/`authenticated` heredan de ahí — un
-- `revoke` olvidado convertiría cualquiera de estas en una fuga servida por
-- la API pública.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Combustible del ejercicio, UNA flota  →  getAcumuladoCombustible (repo.ts)
--    NO ES UNA FUNCIÓN NUEVA: corrige y por fin CONECTA la 0084.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- HALLAZGO 15-AGO-2026: la migración 0084 ("sumar_combustible_ejercicio: la
-- agregación del 15% en SQL", 05-ago-2026) YA ESCRIBIÓ este `sum()` — está
-- APLICADA en producción (verificaciones.sql bloque 81, muestreo contra el
-- catálogo real: `f_0084=1`) — pero CERO archivos de `src/` la llaman
-- (grepeado). Su propio comentario decía "la usa desde_db y la tool de
-- periodo"; nunca se hizo. `getAcumuladoCombustible` (repo.ts) siguió
-- paginando `traerTodo` a mano diez días más, en el camino que corre EN CADA
-- CUADRE, con el `sum()` que lo resolvía ya viviendo en la base sin que nada
-- lo llamara. Esta migración no repite ese trabajo: lo TERMINA.
--
-- Y la RPC muerta tenía un BUG real, que se corrige aquí de paso: no
-- filtraba `monto > 0`. `getAcumuladoCombustible` en TS sí lo hacía ("los
-- duplicados y los montos no positivos quedan fuera por el mismo criterio
-- que usa el motor"). Sin ese filtro, una fila de monto 0 o NEGATIVO —un
-- duplicado excluido, un ajuste— habría entrado al `sum()` en cuanto alguien
-- la conectara: el denominador del 15% de combustible en efectivo (RFA 2026
-- regla 2.9) inflado por filas que ni el motor cuenta. La prueba de
-- equivalencia (`repo_acumulado.test.ts`) lo cubre explícitamente: un
-- dataset con montos negativos y en cero, JS viejo vs RPC corregida, mismo
-- resultado.
--
-- El resto del criterio ya estaba bien y no cambia: `forma_pago = '01'` es
-- efectivo en el catálogo del SAT (un gasto SIN forma de pago no cuenta como
-- efectivo — no se sabe, y suponerlo infla el numerador contra la flota);
-- "combustible" es `concepto = 'diesel'` O la clave del SAT está en
-- `p_claves` (15101505/14/15 hoy, las manda el llamador — AUDITORÍA 14,
-- MEDIO: antes había TRES contadores con TRES criterios distintos y el chat
-- decía 8% donde el motor decía 12%). `p_claves` sigue SIN default —firma
-- intacta, `create or replace` la reemplaza en el mismo objeto—: quien no
-- mande claves solo cuenta `concepto = 'diesel'`.
--
-- `returns table`, no `jsonb`: se conserva la forma de la 0084 a propósito
-- —cambiar el tipo de retorno de una función existente exige DROP, y esta
-- migración corrige, no reconstruye—. `numeric` no tiene el problema de
-- punto flotante que obligaba a `Number.isFinite` en JS, pero SÍ admite el
-- valor especial 'NaN'; una comparación `monto > 0` contra NaN es FALSE (ni
-- true ni null), así que una fila corrupta con NaN queda fuera igual que con
-- el filtro JS.
create or replace function public.sumar_combustible_ejercicio(p_tenant uuid, p_anio int, p_claves text[])
returns table (total numeric, efectivo numeric)
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  select
    coalesce(sum(monto), 0) as total,
    coalesce(sum(monto) filter (where forma_pago = '01'), 0) as efectivo
  from gasto
  where tenant_id = p_tenant
    and monto > 0
    and fecha >= make_date(p_anio, 1, 1)
    and fecha <= make_date(p_anio, 12, 31)
    and (concepto = 'diesel' or (p_claves is not null and cardinality(p_claves) > 0 and clave_prod_serv = any(p_claves)));
$$;

comment on function public.sumar_combustible_ejercicio(uuid, int, text[]) is
  'Total y efectivo de combustible del ejercicio (RFA 2026 regla 2.9), UNA flota. La usa getAcumuladoCombustible (repo.ts), que corre en CADA CUADRE — desde el 15-ago-2026 (mig. 0112 corrigió el filtro monto>0 que faltaba desde la 0084 y por fin la conectó; antes de eso, cero llamadores). SECURITY INVOKER; p_tenant sin default. concepto=diesel O clave_prod_serv en p_claves, monto>0: mismo criterio que el motor de cuadre.';

-- Cinturón y tirantes: ya estaban puestos desde la 0084 (`create or replace`
-- no los borra), se repiten para que esta migración quede completa por sí
-- sola si alguien la lee sin la 0084 al lado.
revoke all on function public.sumar_combustible_ejercicio(uuid, int, text[]) from public, anon, authenticated;
grant execute on function public.sumar_combustible_ejercicio(uuid, int, text[]) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Serie comparativa de N periodos, UNA flota  →  getSerieComparativa (analytics.ts)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Las tarjetas de KPI del Resumen (`getSeriesKpiCards`) llaman a esta función
-- TRES veces por carga —semanal (7d×2), mensual (30d×2), histórico
-- (3650d×1)— y es la vista "histórico" la que lee prácticamente la tabla
-- entera del tenant: con este cliente, ~10 años de `gasto` (45k/mes) tocan
-- el mismo techo de `traerTodo` que `getGastosFiscales`, en el mismo mes 2.2.
--
-- `p_pasos` periodos consecutivos de `p_ventana_dias` días, SIN traslape,
-- terminando en `p_hoy` — paso=0 es el más reciente, igual que el índice 0
-- de la función que reemplaza. `generate_series` arma los límites UNA vez;
-- cada tabla se agrega con un JOIN contra `limites` en vez de `p_pasos`
-- consultas — mismo espíritu que "UNA consulta por tabla, no `pasos`
-- consultas" que ya declaraba la función JS que sustituye.
--
-- `gasto.fecha` y `viaje.fecha_inicio` son `date`: la comparación de rango es
-- directa y usa los índices de la 0111 (`gasto_tenant_fecha_idx`,
-- `viaje_tenant_fecha_inicio_idx`) — el mismo hueco que esa migración vino a
-- tapar, ahora con un consumidor real. `liquidacion.created_at` es
-- `timestamptz`: el bucket usa el día LOCAL de México (`at time zone
-- 'America/Mexico_City'`), igual que `diaLocalMx` en la función JS — un
-- corte solo en UTC repetiría el bug ya pagado ahí (cierres de tarde cayendo
-- en el día siguiente). El filtro sigue siendo `tenant_id = p_tenant`
-- primero, así que usa `idx_liq_tenant` (0001) por el prefijo de tenant antes
-- de aplicar el cómputo de zona horaria sobre esas filas.
--
-- `gastoTotal`/`liquidado` se redondean UNA vez (`round(…, 2)`) y
-- `costoPorViaje` divide sobre ese valor YA redondeado — el MISMO orden que
-- la función JS (`round2(gastoTotal)` primero, y ESE valor entra a la
-- división, que vuelve a pasar por `round2`): dividir sobre la suma cruda
-- daría un centavo distinto en el borde. `numeric` no tiene el bug de punto
-- flotante que `round2` tuvo que parchar (formato.ts: `round2(1.005)` daba
-- `1`, no `1.01`, antes del parche con `Number.EPSILON`) — no hace falta
-- reproducir el parche, solo el ORDEN de las operaciones.
--
-- Sin filas en un periodo: `coalesce(…, 0)` en gasto/liquidado/viajes — un
-- periodo vacío es una MEDICIÓN real (cero viajes), no un hueco que se calla.
create or replace function public.serie_comparativa_tenant(
  p_tenant uuid,
  p_ventana_dias int,
  p_pasos int,
  p_hoy date
)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  with limites as (
    select
      gs as paso,
      (p_hoy - (gs * p_ventana_dias))::date as hasta,
      (p_hoy - (gs * p_ventana_dias) - (p_ventana_dias - 1))::date as desde
    from generate_series(0, p_pasos - 1) as gs
  ),
  g as (
    select l.paso, round(sum(gasto.monto), 2) as gasto_total
    from limites l
    join gasto on gasto.tenant_id = p_tenant
      and gasto.fecha >= l.desde and gasto.fecha <= l.hasta
    group by l.paso
  ),
  v as (
    select l.paso,
      count(*) as n,
      count(*) filter (where viaje.estatus = 'liquidado') as liquidados
    from limites l
    join viaje on viaje.tenant_id = p_tenant
      and viaje.fecha_inicio >= l.desde and viaje.fecha_inicio <= l.hasta
    group by l.paso
  ),
  liq as (
    select l.paso, round(sum(liquidacion.total_comprobado), 2) as liquidado
    from limites l
    join liquidacion on liquidacion.tenant_id = p_tenant
      and (liquidacion.created_at at time zone 'America/Mexico_City')::date >= l.desde
      and (liquidacion.created_at at time zone 'America/Mexico_City')::date <= l.hasta
    group by l.paso
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'desde', to_char(l.desde, 'YYYY-MM-DD'),
      'hasta', to_char(l.hasta, 'YYYY-MM-DD'),
      'gastoTotal', coalesce(g.gasto_total, 0),
      'totalViajes', coalesce(v.n, 0),
      'costoPorViaje', case when coalesce(v.n, 0) = 0 then null
        else round(coalesce(g.gasto_total, 0) / v.n, 2) end,
      'liquidado', coalesce(liq.liquidado, 0),
      'viajesLiquidados', coalesce(v.liquidados, 0)
    ) order by l.paso
  ), '[]'::jsonb)
  from limites l
  left join g on g.paso = l.paso
  left join v on v.paso = l.paso
  left join liq on liq.paso = l.paso;
$$;

comment on function public.serie_comparativa_tenant(uuid, int, int, date) is
  'p_pasos periodos consecutivos de p_ventana_dias días terminando en p_hoy, para UNA flota: gasto total, viajes (y liquidados), costo por viaje y monto liquidado, por periodo — jsonb array, paso=0 es el más reciente. Reemplaza el traerTodo triple (gasto/viaje/liquidacion) + bucketeo en JS de getSerieComparativa (analytics.ts), cuya vista "histórico" (getSeriesKpiCards, ventana ~10 años) lee casi toda la tabla del tenant y caduca ~mes 2.2 a 15k viajes/mes (docs/escala-15k.md §6). SECURITY INVOKER; p_tenant sin default. liquidacion se bucketea por día LOCAL de México, gasto/viaje por date directo (usan los índices de la 0111).';

revoke all on function public.serie_comparativa_tenant(uuid, int, int, date) from public, anon, authenticated;
grant execute on function public.serie_comparativa_tenant(uuid, int, int, date) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. KPIs de liquidación, UNA flota  →  getKpis (analytics.ts)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Se lee en CADA carga de /dashboard y /dashboard/contador. `p_desde` es el
-- MISMO corte que `corteVentana` ya calculaba en JS (ventana de N días, o
-- `null` para todo el histórico) — llega ya resuelto: la función SQL no
-- conoce "ventanaDias", solo el `timestamptz` resultante.
--
-- `diferenciaDetectada` suma, POR LIQUIDACIÓN, el monto absoluto de las
-- diferencias de tipo 'sobre_politica' o 'duplicado' dentro del jsonb
-- `diferencias` — el MISMO filtro y el MISMO `Math.abs` que la función JS. Va
-- en un CTE aparte (`base`) para que el `jsonb_array_elements` por fila no
-- entre en conflicto con los `count(*) filter` del agregado exterior — mismo
-- motivo por el que el `count(distinct)` de la 0064 sale de su propio
-- `grouping sets`: mezclar un des-anidado por fila con agregados de fila
-- completa en la misma pasada fuerza un plan peor y, aquí, sería
-- directamente ambiguo.
--
-- `cuadre/engine.ts` SIEMPRE pone `monto` en cada diferencia que empuja
-- (líneas ~441-654) — incluso las de monto 0 (`fecha_sospechosa`,
-- `folio_verificar`) lo declaran explícito — así que un elemento sin la
-- clave `monto` no ocurre en datos reales; si ocurriera, `(d->>'monto')::
-- numeric` da NULL y `sum()` lo ignora (aporta 0), mientras que la reducción
-- en JS (`Math.abs(d.monto)` sobre `undefined` → `NaN`) contaminaría la suma
-- ENTERA de esa liquidación. Es una divergencia posible solo ante datos
-- corruptos, y en ese caso el que no miente es SQL.
--
-- `tasaCuadre`: redondeo de un cociente no-negativo — `round(numeric)` en
-- Postgres redondea igual que `Math.round` para valores ≥0 (ambos redondean
-- el .5 hacia arriba), así que no hace falta el parche de `Number.EPSILON`
-- que `round2` sí necesita para punto flotante (formato.ts): aquí es
-- aritmética `numeric`, exacta de por sí.
create or replace function public.kpis_liquidacion_tenant(
  p_tenant uuid,
  p_desde timestamptz default null
)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  with base as (
    select
      total_comprobado,
      estatus,
      (
        select coalesce(sum(abs((d->>'monto')::numeric)), 0)
        from jsonb_array_elements(coalesce(diferencias, '[]'::jsonb)) as d
        where d->>'tipo' in ('sobre_politica', 'duplicado')
      ) as dinero_observado_fila
    from liquidacion
    where tenant_id = p_tenant
      and (p_desde is null or created_at >= p_desde)
  )
  select jsonb_build_object(
    'viajesLiquidados', count(*),
    'montoComprobado', coalesce(sum(total_comprobado), 0),
    'diferenciaDetectada', coalesce(sum(dinero_observado_fila), 0),
    'conDiferencias', count(*) filter (where estatus = 'con_diferencias'),
    'porRevisar', count(*) filter (where estatus = 'revisar'),
    'tasaCuadre', case when count(*) = 0 then 0
      else round((count(*) filter (where estatus = 'cuadrada'))::numeric * 100 / count(*))::int end
  )
  from base;
$$;

comment on function public.kpis_liquidacion_tenant(uuid, timestamptz) is
  'KPIs de liquidacion de UNA flota (viajes liquidados, monto comprobado, dinero observado por sobre_politica/duplicado, con_diferencias, por_revisar, tasa de cuadre %) en jsonb. p_desde acota por created_at (o null = todo el histórico) — el mismo corte que corteVentana ya resolvía en JS. Reemplaza el traerTodo de getKpis (analytics.ts), que lee TODA liquidacion del tenant y caduca ~mes 8.3 a 15k viajes/mes (docs/escala-15k.md §6). SECURITY INVOKER; p_tenant sin default.';

revoke all on function public.kpis_liquidacion_tenant(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.kpis_liquidacion_tenant(uuid, timestamptz) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Estímulos acreditables, UNA flota  →  getAcreditables (analytics.ts)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Cuatro sumas sobre columnas que el motor de cuadre YA calculó y guardó por
-- liquidación (`ieps_acreditable`, `iva_acreditable`, `peaje_acreditable`,
-- `litros_diesel_acreditables` — 0007/0021): no hay lógica fiscal que
-- reimplementar aquí, solo agregación pura. `not null default 0` en las
-- cuatro columnas significa que ningún `coalesce` hace falta sobre la FILA,
-- pero SÍ sobre el `sum()`: una flota sin liquidaciones en la ventana da 0
-- filas, y `sum()` de 0 filas es NULL, no 0 — la misma trampa que documenta
-- cada RPC de esta migración.
create or replace function public.acreditables_liquidacion_tenant(
  p_tenant uuid,
  p_desde timestamptz default null
)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'litrosDiesel', coalesce(sum(litros_diesel_acreditables), 0),
    'ieps', coalesce(sum(ieps_acreditable), 0),
    'iva', coalesce(sum(iva_acreditable), 0),
    'peaje', coalesce(sum(peaje_acreditable), 0)
  )
  from liquidacion
  where tenant_id = p_tenant
    and (p_desde is null or created_at >= p_desde);
$$;

comment on function public.acreditables_liquidacion_tenant(uuid, timestamptz) is
  'Suma de estímulos acreditables (IEPS diésel + IVA + peaje 50% + litros de diésel elegibles) de UNA flota, en jsonb. p_desde acota por created_at (o null = todo el histórico). Reemplaza el traerTodo de getAcreditables (analytics.ts), que caduca ~mes 8.3 a 15k viajes/mes (docs/escala-15k.md §6). SECURITY INVOKER; p_tenant sin default.';

revoke all on function public.acreditables_liquidacion_tenant(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.acreditables_liquidacion_tenant(uuid, timestamptz) to service_role;
