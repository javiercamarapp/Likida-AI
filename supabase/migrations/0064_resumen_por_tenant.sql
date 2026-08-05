-- 0064 — Las dos agregaciones del panel del CLIENTE, en la base.
--
-- La 0062 movió a SQL la agregación de `llm_costo` de /admin. Al escribirla
-- aparecieron otras dos lecturas de la misma familia, y las dos son PEORES que
-- la que se arregló, porque no viven en la consola de Javier sino en el panel
-- que ve el cliente:
--
--   · `getResumenCosto` (src/lib/cuadra/costos.ts)
--   · `getValorAhorro`  (src/lib/cuadra/analytics.ts)
--
-- ── 1. `getResumenCosto` YA ESTÁ MAL. NO ES UNA FECHA FUTURA. ───────────────
--
-- Es la única de todas las que se han revisado que no espera a crecer:
--
--     supabaseAdmin().from('llm_costo')
--       .select('viaje_id, fase, tokens_in, tokens_out, costo_usd')
--       .eq('tenant_id', tenantId)
--
-- Sin `traerTodo`, sin `range`, sin `count`. PostgREST recorta a `max_rows`
-- (1,000) EN SILENCIO: no lanza, no avisa, devuelve menos filas. Y el resultado
-- se etiqueta `estado: 'medido'`, que es una AFIRMACIÓN — el tipo
-- `ResumenCosto` existe justamente para que un cero no medido no se pueda
-- pintar, y esta consulta lo burlaba entregando una cifra corta con la etiqueta
-- de buena.
--
-- A partir de la llamada 1,001 de una flota —semanas de operación, no años— el
-- panel enseña un `totalUsd` y un `costoPromedioPorLiquidacion` que se quedaron
-- atrás y siguen bajando conforme la flota trabaja más. Es el modo de fallo
-- exacto que el encabezado de `costos.ts` dice venir a evitar: "cero solo se
-- pinta cuando cero es una medición".
--
-- ── 2. `getValorAhorro` rompe el dashboard del cliente antes que el de Javier ──
--
-- Sí usa `traerTodo`, así que no miente: LANZA. Pero lanza pronto y en la
-- pantalla del comprador.
--
--   · `llm_costo` del tenant — una fila por llamada al modelo, ~2,000 al día,
--     y se traen ENTERAS para contarlas por fase. Techo de `traerTodo`
--     (100,000) ≈ **día 50**.
--   · `gasto` del tenant — ~660 comprobantes al día, ~240 mil al año, y se
--     traen ENTEROS para contar los que pasaron por OCR y agruparlos por mes.
--     Techo ≈ **mes 5**.
--
-- ── POR QUÉ UNA FUNCIÓN HERMANA Y NO UN FILTRO EN `resumen_costo_ia` ────────
--
-- La tentación era añadirle `p_tenant` a la función de la 0062 y acabar. Se
-- descartó por tres razones, en orden de peso:
--
--  1. **La función de la 0062 es la única del repo con permiso de ver todas las
--     flotas a la vez.** Darle un modo "…o filtrada a una" pone el camino
--     peligroso (sin filtro) y el seguro (con filtro) en la MISMA llamada, a un
--     argumento nulo de distancia. CLAUDE.md ya nombra ese riesgo —"para que
--     nadie copie un patrón de aquí a una consulta de cliente y filtre de
--     menos"— y es la razón por la que `negocio.ts` vive fuera de
--     `analytics.ts`. Aquí `p_tenant` es `uuid` SIN DEFAULT: una llamada que lo
--     olvide no devuelve la base entera, devuelve un 404 de PostgREST porque no
--     encuentra la firma. El olvido falla ruidoso en vez de filtrar callado.
--  2. **Necesita `count(distinct viaje_id)`**, que la de /admin no calcula ni
--     debe. Meterlo allá arrastraría a la consola un corte por viaje —~11 mil
--     grupos al año— que es justo el payload sin techo que ese diseño evita.
--  3. **Devuelve MENOS, no más.** El panel del cliente no usa `porModelo`,
--     `porDia` ni `porTenant`; mandárselos es payload muerto viajando hacia
--     afuera del tenant que lo pidió.
--
-- Lo que sí se comparte es la FORMA (`totales` + `porFase` como lista de
-- `{fase, n, costoUsd}`), para que los dos consumidores del cliente
-- —`getResumenCosto`, que quiere el costo, y `getValorAhorro`, que quiere el
-- conteo— salgan de UNA sola llamada en vez de dos lecturas de la misma tabla.
--
-- ── MEDIDO: `count(distinct)` FUERA DEL `grouping sets` ─────────────────────
--
-- Con 400,131 filas repartidas en 10 flotas iguales (la objetivo es el 10%),
-- EXPLAIN ANALYZE en bloques revertidos:
--
--   count(distinct viaje_id) DENTRO del grouping sets
--     GroupAggregate → Sort (external merge, Disk: 1,312 kB)   128.5 ms
--     temp read 164 · written 165          ← derrama a disco
--
--   count(distinct viaje_id) en subconsulta APARTE
--     MixedAggregate (Batches: 1, Memory: 24 kB)                33.8 ms
--     temp 0                               ← todo en memoria
--
-- **3.8× más rápido y sin tocar disco.** Un agregado `DISTINCT` le prohíbe a
-- Postgres el camino de hash para TODO el `grouping sets`, así que una sola
-- columna distinta arrastra al resto a un `Sort` de la tabla completa del
-- tenant. Sacarlo a su propia subconsulta cuesta releer las filas del tenant
-- (1,168 buffers contra 584) y lo devuelve todo a memoria. El derrame a disco
-- es lo que se paga caro; releer páginas que ya están en caché, no.
--
-- ── ÍNDICES: NINGUNO NUEVO. MEDIDO. ────────────────────────────────────────
--
-- Las dos consultas filtran por `tenant_id`, y de eso ya hay de sobra:
--
--   llm_costo, 400,131 filas, la flota objetivo es el 10%
--     → Bitmap Index Scan on `idx_costo_tenant` (mig. 0003)   584 buffers
--
--   gasto, 120,040 filas, la flota objetivo es el 10% (8,000 con OCR de 12,000)
--     → Bitmap Index Scan on `idx_gasto_acumulado`            192 buffers
--       MixedAggregate, Batches: 1, Memory 37 kB, 19.3 ms
--
-- El planeador elige solo, no hay `Sort`, no hay derrame. `llm_costo` y `gasto`
-- tienen ya tres índices cada una que arrancan en `tenant_id` (0003, 0060,
-- 0061); un cuarto no tendría a quién servir y se pagaría en los ~2,660 inserts
-- diarios que reciben entre las dos.
--
-- ── PRECISIÓN Y VENTANA: igual que la 0062 ─────────────────────────────────
--
-- `sum(costo_usd)` se queda en `numeric` y vuelve SIN redondear —`round6()` en
-- `costos.ts` sigue siendo quien redondea—; `sum(tokens_*)` se promueve a
-- `bigint` solo. `p_desde`/`p_hasta` existen por simetría con la 0062, son
-- semiabiertos (`>= desde`, `< hasta`) y hoy se mandan en NULL: `getResumenCosto`
-- nunca tuvo ventana y no se la inventa una migración de rendimiento.
--
-- ── SECURITY INVOKER, y por qué el filtro es lo único que aísla ─────────────
--
-- Las dos son INVOKER (el default), como la 0062 y por lo mismo: la app llama
-- con `service_role`, que ya salta RLS, así que un `definer` no daría un
-- permiso más y sí convertiría un `revoke` olvidado en una fuga entre flotas.
--
-- Y hay que decirlo entero: **como `service_role` salta RLS, el `where
-- tenant_id = p_tenant` es lo ÚNICO que aísla a una flota de otra aquí.** Es la
-- misma regla que ya escribe `supabase/admin.ts` ("re-imponer scope por tenant a
-- mano") y por eso el parámetro no tiene default. Llamada por `authenticated`
-- —que hoy no puede— la RLS de `llm_costo`/`gasto` seguiría aplicando encima,
-- que es precisamente la red que un `definer` habría quitado.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. `llm_costo` de UNA flota  →  getResumenCosto + getValorAhorro
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.resumen_costo_ia_tenant(
  p_tenant uuid,                              -- SIN default: olvidarlo es un 404, no la base entera
  p_desde timestamptz default null,
  p_hasta timestamptz default null
)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  with g as (
    select
      grouping(fase)  as g_fase,
      fase,
      count(*)        as n,
      sum(costo_usd)  as costo,   -- numeric, sin redondear: redondea costos.ts
      sum(tokens_in)  as t_in,    -- integer → bigint solo
      sum(tokens_out) as t_out
    from llm_costo
    where tenant_id = p_tenant
      and (p_desde is null or created_at >= p_desde)
      and (p_hasta is null or created_at <  p_hasta)
    group by grouping sets ((), (fase))
  )
  select jsonb_build_object(
    -- `n = 0` es lo que distingue "esta flota no ha hecho NI UNA llamada al
    -- modelo" de "las llamadas costaron $0". `getResumenCosto` lo lee como
    -- `sin_registros`, que no es lo mismo que `medido` con totalUsd 0.
    'totales', (
      select jsonb_build_object(
        'n',         n,
        'costoUsd',  coalesce(costo, 0),
        'tokensIn',  coalesce(t_in, 0),
        'tokensOut', coalesce(t_out, 0),
        -- FUERA del grouping sets a propósito: medido 3.8× más rápido y sin
        -- derrame a disco (ver el comentario de arriba). `count(distinct)`
        -- ignora los NULL solo, que es justo lo que hace falta: una fila sin
        -- `viaje_id` no es una liquidación a la que atribuirle costo.
        'viajes', (
          select count(distinct viaje_id) from llm_costo
           where tenant_id = p_tenant
             and (p_desde is null or created_at >= p_desde)
             and (p_hasta is null or created_at <  p_hasta)
        )
      )
      from g where g_fase = 1
    ),
    'porFase', coalesce((
      select jsonb_agg(jsonb_build_object('fase', fase, 'n', n, 'costoUsd', costo)
                       order by costo desc, fase)
      from g where g_fase = 0
    ), '[]'::jsonb)
  );
$$;

comment on function public.resumen_costo_ia_tenant(uuid, timestamptz, timestamptz) is
  'Agrega llm_costo de UNA flota (total, conteo, tokens, viajes distintos y desglose por fase) en un jsonb de una fila. Hermana tenant-scoped de resumen_costo_ia (mig. 0062), que cruza todos los tenants: esta NO, y por eso p_tenant no tiene default. SECURITY INVOKER; como la app llama con service_role (que salta RLS), el filtro por tenant_id es lo unico que aisla una flota de otra. La consumen getResumenCosto (costos.ts) y getValorAhorro (analytics.ts).';

revoke all on function public.resumen_costo_ia_tenant(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.resumen_costo_ia_tenant(uuid, timestamptz, timestamptz) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Comprobantes que pasaron por OCR, de UNA flota  →  getValorAhorro
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `ocr_confianza is not null` es la prueba de que algo pasó por el Agente OCR.
-- NO `ocr_raw`, que está muerta (CLAUDE.md): contarla daría 0 documentos
-- procesados con la tabla llena, que es la cifra más vergonzosa posible en la
-- pantalla que presume el trabajo del producto.
--
-- El filtro va en el `where` y no después: antes se traían TODAS las filas de
-- `gasto` del tenant y JavaScript descartaba las que no habían pasado por OCR.
-- Con un tercio de captura manual, eso era un 50% de tráfico de más sobre la
-- segunda tabla que más rápido crece.
--
-- El mes se corta en UTC (`to_char(... at time zone 'UTC', 'YYYY-MM')`), que es
-- exactamente lo que daba el `created_at.slice(0, 7)` que sustituye. Es una
-- gráfica de acumulado, no un corte fiscal.
--
-- La serie es DISPERSA: solo los meses con actividad, igual que antes. El
-- acumulado corrido se sigue calculando en `analytics.ts` sobre una lista de
-- decenas de elementos — no es lo que había que mover a la base.
create or replace function public.resumen_documentos_tenant(p_tenant uuid)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  with g as (
    select
      grouping(to_char(created_at at time zone 'UTC', 'YYYY-MM')) as g_mes,
      to_char(created_at at time zone 'UTC', 'YYYY-MM')           as mes,
      count(*)                                                     as n
    from gasto
    where tenant_id = p_tenant
      and ocr_confianza is not null
    group by grouping sets ((), (to_char(created_at at time zone 'UTC', 'YYYY-MM')))
  )
  select jsonb_build_object(
    -- El corte `()` da una fila aunque no haya ni un comprobante: `n = 0`.
    'procesados', (select n from g where g_mes = 1),
    'porMes', coalesce((
      select jsonb_agg(jsonb_build_object('mes', mes, 'n', n) order by mes)
      from g where g_mes = 0
    ), '[]'::jsonb)
  );
$$;

comment on function public.resumen_documentos_tenant(uuid) is
  'Cuenta los comprobantes de UNA flota que pasaron por el Agente OCR (gasto.ocr_confianza no nula) y los agrupa por mes UTC, en un jsonb de una fila. La consume getValorAhorro (analytics.ts). SECURITY INVOKER; p_tenant sin default, el filtro por tenant_id es lo unico que aisla una flota de otra bajo service_role.';

revoke all on function public.resumen_documentos_tenant(uuid) from public, anon, authenticated;
grant execute on function public.resumen_documentos_tenant(uuid) to service_role;
