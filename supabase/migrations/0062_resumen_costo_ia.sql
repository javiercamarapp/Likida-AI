-- 0062 — El costo de IA se suma en la base, no en la memoria de Node.
--
-- `llm_costo` recibe UNA FILA POR LLAMADA AL MODELO: el OCR de cada foto, el
-- cuadre, cada acción del router, cada mensaje saliente de WhatsApp. A 30 viajes
-- diarios son ~2,000 filas al día y ~790,000 al año — la tabla que más rápido
-- crece de todo el producto, por encima de `gasto` (~240 mil al año).
--
-- `getResumenNegocio` (src/lib/admin/negocio.ts) se las traía TODAS a memoria con
-- `traerTodo` para sumarlas en JavaScript, y `getCostoPorFaseModelo` volvía a
-- traerlas otra vez. Desde que `traerTodo` LANZA `LecturaIncompleta` al agotar
-- sus 100 páginas (100,000 filas), eso no es un problema de velocidad: es la
-- fecha en la que /admin deja de cargar. No es hipotético, es aritmética —
-- 100,000 / 2,000 = **día 50 de operación real**.
--
-- Lo que cambia: la agregación se hace en SQL y cruza la red UNA fila. El número
-- de filas transferidas deja de depender del tamaño de la tabla.
--
-- ── QUÉ DEVUELVE, Y POR QUÉ jsonb Y NO `returns table` ───────────────────────
--
-- Son SEIS agregaciones sobre la misma tabla, con formas distintas:
--
--   1. totales        — n, sum(costo_usd), sum(tokens_in), sum(tokens_out)
--   2. porFase        — fase        → n, costo          (gráfica de barras)
--   3. porModelo      — modelo      → n, costo          (Model Ops)
--   4. porFaseModelo  — fase+modelo → n, costo          (`getCostoPorFaseModelo`)
--   5. porDia         — día UTC     → costo, tokens     (serie de tendencia)
--   6. porTenant      — tenant_id   → costo             (columna de la lista de flotas)
--
-- Un `returns table` obligaría a inventar una fila-unión: una columna
-- discriminadora (`tipo`) y seis columnas nullables donde cada fila usa dos o
-- tres. El llamador tendría que volver a partirla en seis, que es exactamente el
-- trabajo que esta migración vino a quitarle. Y devolvería ~450 filas en vez de
-- una, así que ni siquiera cumple el objetivo declarado.
--
-- `jsonb` devuelve UNA fila con UNA columna, y las seis partes llegan con la
-- forma que el panel ya pinta. El tamaño del payload crece con el número de
-- GRUPOS (6 fases × ~10 modelos + 365 días al año + N flotas ≈ 450 objetos, unas
-- decenas de KB), no con el número de filas. Ese es el contrato.
--
-- ── UN SOLO RECORRIDO: `GROUPING SETS` ───────────────────────────────────────
--
-- Medido contra esta base con 400,131 filas y 10 tenants (EXPLAIN ANALYZE dentro
-- de bloques revertidos, `analyze` antes de cada medición):
--
--   A) CTE `as materialized` + 6 agregaciones     2,870 ms   temp read 32,152
--      · materializa 790k filas en archivos temporales. Descartado.
--   B) seis subconsultas independientes           9,132 ms   buffers 174,551
--      · seis `Parallel Seq Scan` sobre la misma tabla. cost 203,960.
--   C) un `group by grouping sets`                7,488 ms   buffers  36,023
--      · UN `Seq Scan` → `MixedAggregate`.        cost  75,589.
--
-- C toca **4.8× menos páginas** que B por la razón obvia: lee la tabla una vez en
-- vez de seis. En reloj de pared la ventaja se ve más chica (18%) porque B se
-- reparte en dos workers y el `MixedAggregate` de C corrió en uno solo — pero el
-- que crece con la tabla es el I/O, no el paralelismo, y sobre la tabla que más
-- rápido crece del producto se elige el que no multiplica las lecturas.
--
-- El precio de C es que la salida viene apilada: una fila por grupo de CUALQUIERA
-- de los seis cortes, y `grouping()` es lo único que dice de cuál. De ahí los
-- `g_fase=0 and g_modelo=1 and …` de abajo, que se leen mal y hacen falta: sin
-- ellos, el corte `(fase)` y el corte `(fase, modelo)` se mezclarían y el costo
-- por fase saldría contado dos veces.
--
-- ── ÍNDICES: NINGUNO. MEDIDO, NO SUPUESTO ────────────────────────────────────
--
-- Una agregación de tabla COMPLETA no puede saltarse ninguna fila, así que lo
-- único que un índice podría dar es un `Index Only Scan` sobre una copia más
-- angosta. Se probó el índice de cobertura que haría falta —
-- `(fase, modelo, tenant_id, created_at) include (costo_usd, tokens_in,
-- tokens_out)`, o sea casi la fila entera— con 300,131 filas:
--
--   sin índice   Seq Scan             cost 36,145   buffers   6,144    848 ms
--   con índice   Index Only Scan      cost 34,506   buffers 302,840    975 ms
--
-- El planeador SÍ lo elige (lo estima 4.5% más barato) y sale MÁS LENTO. El
-- índice pesa 22 MB por cada 300 mil filas, tarda 1.5 s en construirse y se paga
-- en cada uno de los ~2,000 inserts diarios, para no ganar nada. **No se crea.**
-- `Seq Scan` + `MixedAggregate` es el plan correcto aquí.
--
-- Lo que SÍ haría falta el día que la ventana de fechas mande de verdad (ver
-- abajo): un índice `(created_at)`. Medido con la misma siembra, acotando a 30
-- días (25,851 de 300,131 filas):
--
--   sin índice   Seq Scan + Filter        buffers 8,003   696 ms
--   con índice   Bitmap Heap Scan         buffers 1,190    53 ms   ← 13×
--
-- TAMPOCO se crea hoy: nadie pasa `p_desde`/`p_hasta` todavía (ver abajo), y un
-- índice que no sirve a ninguna consulta viva es puro impuesto sobre el insert.
-- Cuando el filtro de /admin mueva el resumen entero, esa medición ya está hecha
-- y el índice es una línea.
--
-- ── LA VENTANA DE FECHAS ESTÁ PREPARADA Y APAGADA A PROPÓSITO ────────────────
--
-- `getResumenNegocio(hoy, ventanaDias)` recibe una ventana que HOY solo mueve
-- `facturasPorDia`; el resto son totales de siempre. Está documentado como deuda
-- en `negocio.ts` y **no se toca aquí**: cambiar qué periodo cubre el costo de IA
-- es un cambio de producto (mueve la cifra con la que se pone el precio), no de
-- rendimiento, y no se cuela dentro de una migración de velocidad.
--
-- La función acepta `p_desde`/`p_hasta` para que ese cambio sea un argumento y no
-- una función nueva. Ambos son `null` por default y `negocio.ts` los manda `null`
-- explícitos: mismo comportamiento que hoy, byte por byte.
--
-- El corte es `>= p_desde` y `< p_hasta`, semiabierto, para que dos ventanas
-- consecutivas no cuenten dos veces la fila del borde.
--
-- ── PRECISIÓN: `numeric` DE PUNTA A PUNTA ────────────────────────────────────
--
-- `costo_usd` es `numeric(10,6)` — dólares con seis decimales. `sum()` sobre
-- `numeric` acumula en `numeric`, exacto; sumar 790 mil `float8` no lo es, y el
-- error se acumula siempre en la misma dirección. La suma NO se redondea aquí:
-- vuelve entera y `negocio.ts` aplica su `round2()` de siempre (formato.ts), que
-- es el único sitio del repo donde se redondea dinero. Redondear en los dos lados
-- sería redondear dos veces.
--
-- `tokens_in`/`tokens_out` son `integer`: `sum()` los promueve a `bigint` solo,
-- así que 790 mil × ~5,000 tokens (≈4e9, fuera de int32) no desborda.
--
-- ── SECURITY INVOKER, NO DEFINER ─────────────────────────────────────────────
--
-- Esta es la única función del repo que CRUZA TODOS LOS TENANTS a propósito: es
-- el resumen de negocio de Javier, no el panel de una flota. Precisamente por eso
-- **no** es `SECURITY DEFINER`.
--
-- No hace falta: la app la llama con `service_role`, que ya salta RLS por sí
-- mismo. Un `definer` no le daría ni un permiso más.
--
-- Y sí haría daño: `definer` propiedad de `postgres` significa que quien logre
-- ejecutarla lee el costo de IA de TODAS las flotas sin pasar por RLS. Postgres
-- otorga `EXECUTE` a `PUBLIC` en toda función nueva —de ahí hereda `anon`— así
-- que un `revoke` olvidado convertiría esta función en una fuga entre clientes
-- servida por la API pública. Como INVOKER, ese mismo olvido no filtra nada: la
-- RLS de `llm_costo` (mig. 0003) sigue aplicando y un anónimo ve cero filas.
--
-- El `revoke`/`grant` de abajo va igual, en cinturón y tirantes, y sigue el
-- patrón de la 0012/0031: se revoca de `public` (no solo de `anon`) porque es de
-- ahí de donde `anon` y `authenticated` heredan.
--
-- `set search_path = public, pg_catalog` va aunque sea INVOKER, por lo mismo que
-- la 0035: el día que `authenticated` pueda llamar algo del esquema, un rol con
-- su propio esquema por delante de `public` hace que la función resuelva a OTRA
-- tabla con el mismo nombre. Una función `definer` SIN `search_path` fijo es el
-- agujero conocido; una `invoker` sin él es el mismo agujero esperando a que
-- alguien le ponga `definer` encima.

create or replace function public.resumen_costo_ia(
  p_desde timestamptz default null,
  p_hasta timestamptz default null
)
returns jsonb
language sql
stable
parallel safe
-- SECURITY INVOKER (el default, explícito por escrito arriba): no se pone
-- `security definer` a la única función que ve todas las flotas.
set search_path = public, pg_catalog
as $$
  with g as (
    select
      -- `grouping()` devuelve 1 cuando la columna NO participa en el corte de
      -- esa fila. Es lo único que separa los seis cortes apilados.
      grouping(fase)                                    as g_fase,
      grouping(modelo)                                  as g_modelo,
      grouping(((created_at at time zone 'UTC')::date)) as g_dia,
      grouping(tenant_id)                               as g_tenant,
      fase,
      modelo,
      -- UTC, igual que el `created_at.slice(0, 10)` que hacía negocio.ts: es una
      -- gráfica de tendencia, no un corte fiscal. Cambiarlo a hora de México
      -- movería la serie histórica sin que nadie lo pidiera.
      (created_at at time zone 'UTC')::date             as dia,
      tenant_id,
      count(*)          as n,
      sum(costo_usd)    as costo,   -- numeric, sin redondear: redondea formato.ts
      sum(tokens_in)    as t_in,    -- integer → bigint solo
      sum(tokens_out)   as t_out
    from llm_costo
    where (p_desde is null or created_at >= p_desde)
      and (p_hasta is null or created_at <  p_hasta)
    group by grouping sets (
      (),                                        -- totales
      (fase),                                    -- porFase
      (modelo),                                  -- porModelo
      (fase, modelo),                            -- porFaseModelo
      ((created_at at time zone 'UTC')::date),   -- porDia
      (tenant_id)                                -- porTenant
    )
  )
  select jsonb_build_object(
    -- El corte `()` produce UNA fila incluso sobre cero filas de entrada, con
    -- `n = 0` y las sumas en NULL. Por eso los `coalesce`: una base recién
    -- levantada tiene que dar ceros medidos, no `null` ni un error. `n` es lo
    -- único que distingue "no hay NI UNA llamada registrada" de "las llamadas
    -- costaron $0" — la misma distinción que exige `ResumenCosto` en costos.ts.
    'totales', (
      select jsonb_build_object(
        'n', n,
        'costoUsd',  coalesce(costo, 0),
        'tokensIn',  coalesce(t_in, 0),
        'tokensOut', coalesce(t_out, 0))
      from g where g_fase = 1 and g_modelo = 1 and g_dia = 1 and g_tenant = 1
    ),

    -- `g_modelo = 1` NO sobra: sin él entrarían también las filas del corte
    -- (fase, modelo) y cada fase quedaría contada dos veces.
    'porFase', coalesce((
      select jsonb_agg(jsonb_build_object('fase', fase, 'n', n, 'costoUsd', costo)
                       order by costo desc, fase)
      from g where g_fase = 0 and g_modelo = 1 and g_dia = 1 and g_tenant = 1
    ), '[]'::jsonb),

    'porModelo', coalesce((
      select jsonb_agg(jsonb_build_object('modelo', modelo, 'n', n, 'costoUsd', costo)
                       order by costo desc, modelo)
      from g where g_fase = 1 and g_modelo = 0 and g_dia = 1 and g_tenant = 1
    ), '[]'::jsonb),

    'porFaseModelo', coalesce((
      select jsonb_agg(jsonb_build_object('fase', fase, 'modelo', modelo, 'n', n, 'costoUsd', costo)
                       order by costo desc, fase, modelo)
      from g where g_fase = 0 and g_modelo = 0
    ), '[]'::jsonb),

    -- DISPERSA A PROPÓSITO: solo los días con actividad, igual que antes. Quien
    -- la pinta ya lo sabe (`observabilidad`, `analitica`), y rellenar los huecos
    -- aquí obligaría a inventar el calendario del panel dentro de la base.
    'porDia', coalesce((
      select jsonb_agg(jsonb_build_object('dia', to_char(dia, 'YYYY-MM-DD'),
                                          'costoUsd', costo, 'tokens', t_in + t_out)
                       order by dia)
      from g where g_dia = 0
    ), '[]'::jsonb),

    'porTenant', coalesce((
      select jsonb_agg(jsonb_build_object('tenantId', tenant_id, 'costoUsd', costo)
                       order by costo desc)
      from g where g_tenant = 0
    ), '[]'::jsonb)
  );
$$;

comment on function public.resumen_costo_ia(timestamptz, timestamptz) is
  'Agrega TODA la tabla llm_costo (totales, por fase, por modelo, por fase+modelo, por día UTC y por tenant) en UN solo recorrido y devuelve un jsonb de una fila. Cruza todos los tenants a propósito: la consume /admin (superadmin), nunca el panel de un cliente. SECURITY INVOKER — el service-role de la app ya salta RLS y un definer solo abriría una fuga entre flotas. `p_desde`/`p_hasta` acotan por created_at (semiabierto, >= desde y < hasta); en null cubre todo el histórico, que es como la llama negocio.ts hoy.';

-- `public` y no solo `anon`: Postgres otorga EXECUTE a PUBLIC en toda función
-- nueva, y `anon`/`authenticated` heredan de ahí. Mismo patrón que la 0012/0031.
revoke all on function public.resumen_costo_ia(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.resumen_costo_ia(timestamptz, timestamptz) to service_role;
