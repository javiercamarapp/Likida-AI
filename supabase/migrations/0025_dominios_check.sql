-- ═══════════════════════════════════════════════════════════════════════════
-- 0025 — El dominio también en la base. Los primeros CHECK del esquema.
--
-- ALTO de la auditoría 5 (modelo de datos).
--
-- QUÉ ESTÁ MAL HOY. `select conname from pg_constraint where connamespace =
-- 'public'::regnamespace and contype = 'c'` devuelve CERO filas: no hay un solo
-- CHECK en toda la base. El dominio vive en TypeScript (`types/cuadra.ts`) y en
-- un zod del intake (`intake/ocr.ts:26`), y `repo.ts` lo lee de vuelta con un
-- cast ciego —`concepto: r.concepto as Gasto['concepto']` (repo.ts:286)—. O sea:
-- todo lo que no entre por el intake queda sin dominio, y el motor lo trata como
-- si sí lo tuviera.
--
-- EL ESCENARIO CON VALORES. Un alta a mano por la consola de Supabase, que es
-- como se cargan los viajes hoy:
--
--     insert into gasto (tenant_id, viaje_id, concepto, monto, forma_pago, fecha)
--     values ('11111111-…','44444444-…-00ff','combustible', 9000, '01', '2026-07-28');
--
-- 'combustible' no existe en `ConceptoGasto` — el valor bueno es 'diesel' — y
-- hoy PASA. Después, en cadena:
--
--   1. `politicaPara('combustible', …)` (engine.ts:54) no empata nada → sin tope
--      de política;
--   2. `esCombustible` es `g.concepto === 'diesel' || …` (engine.ts:156) → NO se
--      marca `combustible_efectivo`, aunque `forma_pago = '01'`;
--   3. `getAcumuladoCombustible` filtra `.eq('concepto','diesel')` (repo.ts:424)
--      → los $9,000 no entran al contador del 15% de RFA 2026 regla 2.9, ni al
--      numerador ni al denominador;
--   4. y los $9,000 sí suman a `totalComprobado` y salen como deducibles.
--
-- Un concepto inventado no rompe nada: se vuelve el gasto MÁS LIMPIO de la
-- liquidación, y el contralor recibe una cifra de cumplimiento con $9,000 de
-- menos. El mismo hueco vale para `viaje.estatus` (un 'activo' escrito a mano
-- deja al operador sin viaje para siempre, porque `getOpenViaje` filtra
-- `.in(['abierto','en_cuadre'])`), para `liquidacion.estatus`, para
-- `gasto.estado_sat`, para `llm_costo.fase` y para `app_user.rol` — del que
-- depende `is_superadmin()`, o sea la RLS entera.
--
-- LO QUE ESTA MIGRACIÓN NO HACE, Y POR QUÉ:
--
--  · NO agrega `CHECK (monto > 0)`. La 0019:27-36 explica por qué sería un
--    retroceso y el argumento se sostiene: hoy un comprobante ilegible entra, el
--    motor lo marca `monto_invalido` (engine.ts:107) y el viaje va a REVISAR;
--    con el CHECK el INSERT fallaría y la foto se perdería en silencio. Un dato
--    malo VISIBLE vale más que un dato ausente. Lo único que sí se prohíbe es
--    `NaN`, que no es un dato malo visible: es un dato que envenena toda suma
--    donde entre (`total_comprobado` sale NaN y el PDF lo imprime).
--
--  · NO agrega CHECK a `tenant.plan`. La auditoría lo lista, pero ninguna línea
--    de `src/` lee esa columna (dos búsquedas). Un CHECK ahí no protege nada y
--    sí bloquearía el primer plan nuevo que alguien invente. Cuando tenga
--    consumidor, tendrá dominio.
--
--  · NO restringe `gasto.forma_pago` al catálogo c_FormaPago completo. Escribir
--    el catálogo mal rechazaría CFDI legítimos, que es peor que el problema. Lo
--    que sí se impone es la FORMA (dos dígitos), que es la que atrapa el fallo
--    real: si el mapeo de `ocr.ts:305` ('efectivo' → '01') alguna vez regresa el
--    texto en vez del código, la regla de LISR 27-III deja de dispararse y nadie
--    se entera.
--
-- COMPROBADO CONTRA LOS DATOS VIVOS el 28-jul-2026 (proyecto de Likida, solo
-- lecturas por la API REST): 8 gastos (conceptos diesel/caseta/otro/alimentacion;
-- estado_sat vigente o NULL; forma_pago 01/03/04 o NULL), 6 viajes
-- (abierto/liquidado), 5 liquidaciones (cuadrada/con_diferencias/revisar),
-- 25 filas de llm_costo (whatsapp/cuadre/ocr), 4 políticas
-- (diesel/caseta/viaticos/factura), 0 filas en app_user, ningún monto ≤ 0 ni
-- NaN. NINGUNA restricción de este archivo está violada hoy.
--
-- Reversible: `alter table <t> drop constraint <nombre>;` por cada una — los
-- nombres están en la tabla de abajo.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  r record;
  n bigint;
begin
  for r in
    select * from (values
      -- ── gasto ────────────────────────────────────────────────────────────
      -- Los 9 de `ConceptoGasto` (types/cuadra.ts:20-25). 'viaticos' es el
      -- genérico HEREDADO: el OCR ya no lo emite (CONCEPTOS_OCR lo excluye a
      -- propósito) pero hay filas viejas con él y reclasificarlas solas sería
      -- inventar. 'flete' está separado de 'transporte' por LISR 28-V: una guía
      -- de paquetería no ampara una comida.
      ('gasto', 'gasto_concepto_dominio',
       $c$concepto in ('diesel','caseta','factura','alimentacion','hospedaje','transporte','flete','viaticos','otro')$c$),

      -- `EstadoSat` (types/cuadra.ts:27). NULL = todavía no se preguntó al SAT,
      -- que es distinto de 'pendiente' (se preguntó y no contestó) y es el
      -- estado de la mayoría de los tickets de papel.
      ('gasto', 'gasto_estado_sat_dominio',
       $c$estado_sat is null or estado_sat in ('vigente','cancelado','no_encontrado','pendiente')$c$),

      -- Forma, no catálogo. Ver la nota de la cabecera.
      ('gasto', 'gasto_forma_pago_formato',
       $c$forma_pago is null or forma_pago ~ '^[0-9]{2}$'$c$),

      -- NaN no es un monto ilegible: es un monto que contamina toda suma en la
      -- que entre. Postgres considera NaN igual a sí mismo, así que
      -- `monto <> 'NaN'` es FALSE solo para NaN y TRUE para cualquier número
      -- —incluidos 0 y los negativos, que siguen permitidos a propósito—.
      ('gasto', 'gasto_monto_no_nan',
       $c$monto <> 'NaN'::numeric$c$),

      -- ── viaje ────────────────────────────────────────────────────────────
      -- `getOpenViaje` filtra `.in(['abierto','en_cuadre'])` (conv.ts:81) y
      -- `guardar_liquidacion_tx` escribe 'liquidado' (0013:46). Cualquier cuarto
      -- valor deja al operador sin viaje abierto y sin manera de enterarse.
      ('viaje', 'viaje_estatus_dominio',
       $c$estatus in ('abierto','en_cuadre','liquidado')$c$),

      ('viaje', 'viaje_anticipo_no_nan',
       $c$anticipo <> 'NaN'::numeric$c$),

      -- El contador de la barrera de ráfaga (0011) nunca puede ser negativo:
      -- `intake_delta` ya lo protege con `greatest(0, …)`, pero un UPDATE a mano
      -- lo dejaría en -1 y el "listo" esperaría a que llegue a 0 para siempre.
      ('viaje', 'viaje_intake_pendientes_no_negativo',
       $c$intake_pendientes >= 0$c$),

      -- ── liquidacion ──────────────────────────────────────────────────────
      -- `EstatusLiquidacion` (types/cuadra.ts:102). Es lo que el panel del
      -- contralor pinta y lo que decide si el viaje va a bandeja.
      ('liquidacion', 'liquidacion_estatus_dominio',
       $c$estatus in ('cuadrada','con_diferencias','revisar')$c$),

      ('liquidacion', 'liquidacion_montos_no_nan',
       $c$total_comprobado <> 'NaN'::numeric and total_anticipo <> 'NaN'::numeric and diferencia <> 'NaN'::numeric$c$),

      -- ── app_user ─────────────────────────────────────────────────────────
      -- De este dominio depende `is_superadmin()` (0001:101-104), y de ahí la
      -- policy `tenant_data` de las siete tablas de negocio. Un rol mal escrito
      -- ('super_admin', 'admin') no da un error: da un usuario que cree tener
      -- permisos y no los tiene, o al revés. Hoy la tabla está VACÍA, así que
      -- este es el momento barato de ponerlo.
      ('app_user', 'app_user_rol_dominio',
       $c$rol in ('superadmin','flota_admin','contador','operador')$c$),

      -- ── llm_costo ────────────────────────────────────────────────────────
      -- `FaseCosto` (costos.ts:7). OJO: son SEIS, no las cinco del comentario de
      -- 0003 — 'whatsapp' se agregó después para el costo del mensaje saliente
      -- y en producción hay filas con esa fase. Tomar el dominio del comentario
      -- viejo habría roto el registro de costos.
      ('llm_costo', 'llm_costo_fase_dominio',
       $c$fase in ('ocr','cuadre','escalacion','chat','router','whatsapp')$c$),

      -- ── politica_gasto ───────────────────────────────────────────────────
      -- La tabla está muerta hoy (`getPolitica` no tiene un solo llamador: la
      -- política viva sale de `tenant.config`), pero si alguien la revive tiene
      -- que hablar el mismo idioma que `gasto.concepto` o los topes no empatarán
      -- con nada.
      ('politica_gasto', 'politica_gasto_concepto_dominio',
       $c$concepto in ('diesel','caseta','factura','alimentacion','hospedaje','transporte','flete','viaticos','otro')$c$)
    ) as t(tabla, nombre, expr)
  loop
    if exists (
      select 1 from pg_constraint
      where conname = r.nombre and conrelid = format('public.%I', r.tabla)::regclass
    ) then
      continue;   -- idempotente: ya se aplicó
    end if;

    -- Antes de imponerla, contar cuántas filas la violan. Un ADD CONSTRAINT que
    -- falla solo dice "is violated by some row"; esto dice cuántas y de qué
    -- columna, que es lo que hace falta para limpiarlas.
    execute format('select count(*) from public.%I where not (%s)', r.tabla, r.expr) into n;
    if n > 0 then
      raise exception
        'No se puede aplicar %.%: hay % fila(s) que violan `%`. Corrígelas (la consola de Supabase es por donde entraron) y vuelve a aplicar esta migración.',
        r.tabla, r.nombre, n, r.expr;
    end if;

    execute format('alter table public.%I add constraint %I check (%s)', r.tabla, r.nombre, r.expr);
  end loop;
end $$;

comment on constraint gasto_concepto_dominio on gasto is
  'Los 9 valores de ConceptoGasto. Sin esto, un concepto inventado se salta el tope de política, la regla de combustible en efectivo y el contador del 15% de RFA 2026 regla 2.9 — y suma a totalComprobado como si fuera deducible.';

comment on constraint app_user_rol_dominio on app_user is
  'De este dominio depende is_superadmin() y por tanto la RLS de las 7 tablas de negocio.';
