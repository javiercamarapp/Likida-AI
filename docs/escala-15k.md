# Auditoría de escala: cliente de 15,000 viajes/mes

**Fecha:** 15-ago-2026 · **Contexto:** cliente grande por firmar — 15,000
viajes/mes ≈ 500/día ≈ 1-2 viajes/minuto en pico, con ráfagas de fotos de
cientos de choferes. La base hoy tiene ~4 viajes: nada de esto se había
ejercitado. Este documento registra dónde se rompe, qué se arregló en esta
pasada, qué queda documentado para otros, y la corrida sintética que lo mide.

**Volúmenes de referencia usados en todo el doc (supuestos declarados):**

| Tabla | Filas/mes | Base |
|---|---|---|
| `viaje` | 15,000 | dato del cliente |
| `gasto` | 45,000 | 3 fotos/viaje (punto medio del rango 2-4 declarado) |
| `liquidacion` | 12,000 | proporción de la siembra pedida (12k liq / 15k viajes) |
| `gasto` diésel | ~15,000 | 1 de las 3 fotos por viaje |

---

## 1. Índices de los caminos calientes

Se barrieron TODAS las consultas por-tenant de los flujos calientes (webhook
WA → conv/repo/processor; cuadre; liquidaciones; gastos; los agregados de
`analytics.ts` y `fiscal.ts`; pantallas de viajes/liquidaciones) contra los
**99** `create index` existentes en `supabase/migrations/`.

**Lo que ya está servido** (no se duplica):

| Consulta | Índice existente |
|---|---|
| `traerTodo` — `.eq(tenant).order('id').range()` (98 call sites) | `*_paginacion_idx (tenant_id, id)` — 0061 |
| `getViajes`/`getDocumentos` — `order created_at desc limit 100` | `viaje_reciente_idx` / `gasto_reciente_idx` — 0061 |
| `getLiquidaciones` / ventanas por `created_at` de `liquidacion` | `idx_liq_tenant (tenant_id, created_at desc)` — 0001 |
| `getOpenViaje` (conv.ts:165, cada mensaje de WA) | `uq_viaje_abierto_por_operador` parcial — 0029 |
| claim de idempotencia (conv.ts:345) | PK de `wa_mensaje_procesado` — 0002 |
| dedup de foto (repo.ts:187/213) | `uq_gasto_img_hash (tenant_id, img_hash)` parcial — 0027 |
| gastos de un viaje (repo.ts:664, motor de cuadre) | `idx_gasto_viaje (viaje_id)` — 0001 |
| cola por conciliar (analytics.ts:1680) | `cfdi_consolidado_linea_por_conciliar_idx` parcial — 0076 |
| huérfanos pendientes (repo.ts:313) | `idx_huerfano_pendiente` parcial — 0040 |
| `vincularCostosALiquidacion` (costos.ts:171, cada cierre) | `idx_costo_viaje (viaje_id)` — 0003 |

**El hueco: rango de fecha dentro de un tenant.** Ninguna variante existente
lo sirve — `idx_gasto_acumulado (tenant_id, concepto, fecha)` exige igualdad
en `concepto`, y los demás son por `id` o `created_at`. Consultas reales que
lo piden:

- `fiscal.ts:811-814` — `getGastosFiscales`, panel del contador (default:
  **ejercicio entero**)
- `analytics.ts:107-109` — `getSerieComparativa.gasto`, tarjetas KPI del
  Resumen, cada carga
- `analytics.ts:478-480` — `getGastoPorSemana` (5/13/52 semanas)
- `analytics.ts:1135-1137` — `getTopRutasPorGasto` con ventana
- `repo.ts:938-940` — `getAcumuladoCombustible`, **corre en cada cuadre**
  (~12,000 veces/mes con este cliente); su `.or()` de claves no puede usar
  `idx_gasto_acumulado`
- `intake/consolidado.ts` (candidatos del JOIN) — tenant + `cfdi_uuid is
  null` + rango de un mes
- `analytics.ts:113-115` — `getSerieComparativa.viaje` por `fecha_inicio`

**→ Migración `supabase/migrations/0111_indices_escala.sql`** (pendiente de
aplicar por el orquestador): `gasto_tenant_fecha_idx (tenant_id, fecha)` y
`viaje_tenant_fecha_inicio_idx (tenant_id, fecha_inicio)`. Sin
`CONCURRENTLY` a propósito (el apply del MCP es transaccional — comprobado en
la 0061); con ~4 viajes el lock es despreciable **hoy** — por eso se aplica
antes de la firma, no después. Lo descartado (y por qué) está en la cabecera
de la propia migración. Verificación: bloque `INDICES_0111` al final de
`supabase/verificaciones.sql` (esperado `2/t/t`) — salida real en §7.

---

## 2. Los topes silenciosos (PostgREST recorta a 1,000 sin avisar)

Barrido completo de `src/`: 382 llamadas `.select(` en 89 archivos; 98 usos
de `traerTodo` en 16 archivos ya protegen la mayoría. Lo que quedaba, con el
volumen de este cliente:

### 2a. Arreglado en esta pasada (archivos míos)

| Sitio | Qué mentía a 15k/mes | Arreglo |
|---|---|---|
| `api/dashboard/chat/route.ts:73` | La suma del **tope diario de gasto de IA** se congelaba al pasar de 1,000 filas/día: el freno de presupuesto dejaba de dispararse justo el día de más uso (el recorte llega como ÉXITO, no como error) | `traerTodo` paginado; el fallo de lectura conserva su camino fail-closed |
| `fiscal.ts:827` | El `.in('id', viajeIds)` del contexto folio/operador se recortaba a 1,000: con un trimestre (~45,000 viajes) la pantalla del contador pintaba **sin folio ni operador** todo lo que pasara del corte | nuevo helper `traerPorIds` (pg.ts): tandas de 200 ids, 5 en vuelo, ninguna puede tocar el techo ni el límite de URL |
| `analytics.ts:1692/1703/1711` | Mismos `.in()` sin techo en la cola "por conciliar" (folios de candidatos) | `traerPorIds` ×3 |
| `intake/consolidado.ts:235` | Idempotencia del reenvío: `existentes.length` reportaba 1,000 como total del acuse; además era la única consulta del archivo **sin filtro de tenant** | `traerTodo` + `.eq('tenant_id')` (error de lectura conserva su camino previo, ahora con log) |
| `intake/consolidado.ts:252` | Mapa de gastos ya sellados incompleto → el reenvío reportaba como huérfano lo que estaba bien ligado — el fallo exacto que el bloque decía evitar | `traerTodo` |
| `intake/consolidado.ts:267` y `:582` | Candidatos del JOIN recortados: líneas conciliables marcadas `por_conciliar`/`sin_match` — **fraude aparente por truncamiento** | `traerTodo` ×2 |
| `intake/desglose_peaje.ts:650/676/763/968` | Cuatro `.limit(5000)` con un comentario que afirmaba protegerse del recorte: **PostgREST aplica min(limit, max_rows)** → entregaba 1,000. `total`/`pctCuadra` congelados en 1,000 en el detalle **y en el acuse al cliente**; casetas con contraparte marcadas `sin_contraparte`; bitácora RMF 9.18 (documento fiscal) incompleta | `traerTodo` ×4 + `traerPorIds` para el `.in()` de viajes de la bitácora |
| `informes_wa.ts:75-81` | Paginación a mano que cortaba con `filas.length < PAGINA` — el criterio que pg.ts documenta como defectuoso: con `max_rows` más bajo, la suma de "anticipos vivos" le llegaba al dueño parcial y presentada como total | `traerTodo` + `conteo` |
| `agentes/cobranza.ts:328` | `.limit(1000)` **exactamente en el tope** para listar tenants con viajes vivos: un solo cliente de 500/día llenaba las 1,000 filas con sus abiertos y **ninguna otra flota volvía a ser cobrada**, sin error ni log | `traerTodo` (lo abierto está acotado por la operación — mig. 0029) |
| `agentes/cobranza.ts:119` | `cola.vigilados` = `.length` de un `.limit(500)` → el KPI "Viajes vigilados" topaba en 500 | `traerTodo` + `traerPorIds` para los tiers de contacto |
| `escalar_viaje.ts:105` | `.limit(100)` **sin `.order()`**: con >100 vencidos entre corridas, un viaje concreto podía quedar fuera del lote para siempre, sin rastro | `.order('avisado_en', asc)`: el lote es ahora una cola que drena (lo escalado sale del filtro); el techo se queda como presupuesto de envíos del cron |
| `analytics.ts:1578` (`getDesglosesRecibidos`) | JSDoc decía "ventana de 2,000 líneas" sobre un `.limit(2000)` → ventana real de 1,000, y **sin `.order()`**: las 1,000 eran las que Postgres quisiera — la bitácora podía callarse lo recién recibido | `.order(created_at desc, id desc).limit(1000)` + JSDoc corregido |
| `analytics.ts:391` (`getLiquidacionesPorDia`) | No truncaba (usa `traerTodo`) pero leía **todo el histórico** de `liquidacion` para una gráfica de 7/30 días — a 12k/mes, años de filas por carga | cota inferior generosa por `created_at` (medianoche UTC del día MX más viejo — solo puede sobrar hacia el pasado) |

Todos con pruebas: `pg_por_ids.test.ts` (nuevo, 5 casos incl. orden y fallo),
`desglose_peaje_paginado.test.ts` (nuevo: reproduce el servidor que recorta a
1,000 y exige contar 2,500), `analytics_por_dia.test.ts` (nuevo caso de la
cota), y los mocks de `consolidado_orquestador/barrido`, `cobranza_*`,
`informes_wa` y `costo_parcial` actualizados para paginar como el servidor.

### 2b. Documentado para otros (archivos ajenos a esta pasada)

| Sitio | Problema | Dueño sugerido |
|---|---|---|
| `src/lib/agents/chat-tools.ts:112-114` y `:133-135` | Devuelve al modelo un campo llamado **`total`** con `getViajes(100).length` / `getLiquidaciones(50).length` — el analista de chat afirma "tienes 100 viajes" para siempre | agentes de chat |
| `src/lib/admin/negocio.ts:301` (`getConversacionesActivas`, `.limit(20)`) | `/admin/conversaciones` (`page.tsx:37,41`) y `/admin/whatsapp-infra` (`page.tsx:75`) pintan "Conversaciones activas" y "Mensajes totales" con techo real de 20 | agentes de /admin |
| `intake/consolidado.ts:548` (`barridoConsolidados`, `.limit(1000)`) | El barrido drena 1,000 líneas por corrida — re-entrante a propósito, pero si la cola crece más rápido que la corrida, el excedente es invisible (no hay conteo del backlog). Propuesta: `count: 'exact', head: true` adicional para loguear el tamaño real de la cola por corrida | quien opere el cron de peajes |
| `src/lib/likida/repo.ts:664` (`getGastos`) y `analytics.ts:1374`, `consulta_chofer.ts:156`, `repo.ts:629`, `facturacion_escritura.ts:396` | Sin limitador pero acotadas POR VIAJE/factura (~3-10 filas). No truncan con este cliente; anotadas para que nadie las copie a un contexto no acotado | — |

---

## 3. Los `limit`/tops de pantallas: qué rótulos siguen siendo verdad

Con 500 viajes/día, **100 filas ≈ 5 horas de operación** y 50 liquidaciones
≈ medio día. El inventario completo (verificado contra el código):

**Rotulado honesto — aguanta 15k** (declaran la ventana en pantalla):
`/dashboard/viajes` (`vista.tsx:153` "los {cargados} más recientes; los
conteos de arriba sí cuentan todo el histórico" — los KPI salen de
`contarViajes`/`contarEscalados`, conteos reales), `/dashboard/mapa`
(`vista.tsx:47`), `/dashboard/agentes/conductores` (`vista.tsx:70` — ojo: el
"100" está escrito a mano en el texto, no derivado), `/dashboard/huerfanos`
selector (`acciones.tsx:81`), `/dashboard/carta-porte` (`vista.tsx:60` — el
único que compara contra un `count` real).

**Rótulos que MIENTEN con 15k — documentados para el dueño del dashboard**
(las vistas son de `src/app/dashboard/**`, fuera de mi carril en esta pasada):

| Pantalla | Cifra | Fuente | Falla a 15k |
|---|---|---|---|
| `agentes/cobranza/vista.tsx:67` | KPI "Viajes vigilados" · nota "abiertos o en cuadre" | `cola.vigilados` | **el dato ya quedó arreglado** (§2a: `colaCobranza` pagina) — la vista no necesita cambio, se anota para verificar el render |
| `agentes/liquidacion/vista.tsx:96,102` | cola "Esperan tu revisión" | `getLiquidaciones` (50) | el KPI "Por revisar" (real, de `getKpis`) puede decir 12 y la tabla enseñar 3, sin nota de ventana |
| `despacho/vista.tsx:179` | "hay {activos.length−MAX_FILAS} más en curso" | `getViajes` (100) | el "más en curso" está topado a 100 mientras el KPI vecino (`tablero.viajesActivos`, `traerTodo`) es real: dos cifras del mismo concepto en la misma pantalla |
| `combustible-casetas/page.tsx:193` | "{sinCfdi} de {N} sin factura" | `getDocumentos(…, 1000)` | tile SIN ventana declarada junto a tiles de histórico completo (`getGastoPorConcepto`) — cuatro tiles contiguos con dos alcances |
| `avance-cierre.tsx:113` + `actividad.tsx:53` | "Avance de cierre {pct}%" / Actividad 7-30d | `getViajes` (100) | la premisa escrita ("capado a 100 — de sobra para 7/30 días") **muere con 500/día**: 100 filas son 5 horas, no 7 días |
| `huerfanos/vista.tsx:42` | "Esperan que alguien los acomode · N" | `.length` de `.limit(200)` | existe `contarHuerfanosPendientes` (count real, repo.ts:411) y esta pantalla no la usa |
| `agentes/proveedores/vista.tsx:64-70` | 4 KPIs por `.length` | `listarFacturasProveedor` (100) | sin ventana declarada |
| `agentes/peajes/vista.tsx:148-175` | "Estados de cuenta recibidos" | `getDesglosesRecibidos` | **el dato ya quedó arreglado** (§2a: ventana honesta de 1,000 más recientes); la leyenda "Cada consolidado…" merece decir "los más recientes" |
| `viajes/page.tsx:43` + `inicio-contenido.tsx:115` | link "Ver" de liquidación | mapa folio→id de `getLiquidaciones` (50) | un viaje liquidado hace >medio día **pierde su link en silencio** |
| `huerfanos/page.tsx:88` | server action `adjuntar` re-verifica contra `getViajes(100)` | — | un viaje vivo real fuera de la ventana falla con "Ese viaje ya no está abierto" — **mensaje falso** (es lógica, no pintura: el más urgente de esta tabla) |
| `api/v1/viajes/route.ts:97` | paginación por sobre-lectura (`getViajes(desplazamiento+limite)`) | — | ya se auto-protege (detecta el recorte y falla, `:110`); el arreglo de fondo que su propio comentario anota (`range` + `order('id')` en `getViajes`) sube de prioridad con 15k |

---

## 4. El webhook de WhatsApp a ráfaga

Escenario: 200 choferes mandan 5 fotos en 10 minutos → **1,000 imágenes,
1,000 llamadas de OCR** (~1.7/s sostenido).

**Lo que protege de verdad (verificado):**

1. **Idempotencia** — `claimMessage` (conv.ts:343-353): INSERT contra la PK
   de `wa_mensaje_procesado` (0002). Reentrega de Meta → `'duplicado'` → no-op.
2. **La cola es de Meta** — lo que excede el rate limit **no se descarta: se
   contesta 429 + `Retry-After: 60`** (route.ts:244-249) y Meta reentrega con
   backoff durable. El diseño está razonado en route.ts:107-141.
3. **Pool de 5 por invocación** (route.ts:40-59): un POST con 22 fotos ya no
   corre 22 visiones a la vez contra el mismo `maxDuration`.
4. **Presupuesto por turno** (processor.ts:393): OCR 25s/foto, barrera 20s,
   mutex 12s — dentro de `maxDuration = 120` (route.ts:77, plan Pro
   verificado).
5. **Barrera de intake** (`intake_pendientes`, conv.ts:567-610): el "listo"
   espera a que las fotos en vuelo asienten; fail-closed con TTL de 10 min.
6. **Mutex por viaje** (`viaje_lock`, rpc `try_lock_viaje`, 0005): serializa
   los cierres; las fotos no lo toman a propósito.

**La verdad del rate limit:** `lib/ratelimit.ts` es POR INSTANCIA (su propia
cabecera lo declara: "el techo real es 40 × instancias"). Con Vercel
escalando, **casi nada se difiere** en la ráfaga — y no importa: la
protección real es idempotencia + 429 + pool, que funcionan por invocación.
El límite en memoria queda como amortiguador del caso "un teléfono mandando
sin parar a la misma instancia".

**La ráfaga de 1,000 fotos EN SÍ no rompe:** 1.7 req/s es tráfico trivial
para la plataforma; cada invocación procesa su lote con pool de 5; el OCR es
red, no CPU; los inserts de `gasto` son miles/minuto de sobra para Postgres.
Costo de la ráfaga: 1,000 × $0.0016 ≈ **$1.60 USD** con el override de OCR
vigente (§5) — o ~$17.60 con el default.

**El cuello REAL está después de las fotos, en el cierre:**

- **`getAcumuladoCombustible` (repo.ts:910-972) corre EN CADA CUADRE y lee
  el combustible del EJERCICIO completo, paginado.** Con ~15,000 cargas de
  diésel/mes: en marzo son ~45 páginas (~45 viajes de red DENTRO del turno
  del webhook, varios segundos de su presupuesto); y **al rebasar 100,000
  filas (~mes 7 del ejercicio) su tope de 100 páginas (repo.ts:919) LANZA y
  el cuadre deja de cerrar** — fail-closed y honesto, pero el producto deja
  de liquidar. El propio código lo anticipa: "un tenant que las pase necesita
  que esto sea un `sum()` en SQL" (repo.ts:916-918).
  **✅ RESUELTO 15-ago-2026 (mig. 0112) — Y fue un hallazgo, no una
  propuesta nueva:** la RPC ya existía. `sumar_combustible_ejercicio`
  (mig. 0084, 05-ago-2026) hacía exactamente este `sum() filter (where
  forma_pago = '01')` y estaba APLICADA en producción — pero `getAcumulado
  Combustible` nunca se cambió para llamarla, así que siguió paginando a
  mano diez días con la RPC que lo resolvía ya viva y sin un solo llamador
  en `src/`. Y la RPC muerta tenía un bug: no filtraba `monto > 0`. La 0112
  corrigió el filtro (mismo `create or replace`) y conectó
  `getAcumuladoCombustible`. Ver §6 para el detalle y la prueba de
  equivalencia (`repo_acumulado.test.ts`).
- **OCR inline, 1 llamada de visión por foto** (route → processor.ts:693/965
  → `intake/ocr.ts:251` `generateStructured`): no hay cola ni throttle
  global. La concurrencia entre instancias es la que Vercel decida; los
  límites de tasa de OpenRouter **no están registrados en el repo**, así que
  no se afirma dónde estrangulan. El arreglo de fondo que el propio webhook
  anota (route.ts:76) sigue siendo mover el procesamiento pesado a una cola
  (QStash); mientras, el 429+reentrega de Meta hace de válvula.
- `wa_mensaje_procesado` crece ~60-75k filas/mes; la purga a 30 días ya
  existe (0101 / cron purgar) — sin acción.

---

## 5. Costo proyectado de IA (solo cifras que constan en el repo)

**Supuestos declarados:** 15,000 viajes/mes; 2-4 fotos/viaje → 30,000-60,000
llamadas de OCR/mes (1 llamada de visión por foto — processor.ts:693/965);
12,000 liquidaciones/mes.

**Precios y mediciones registrados en el repo:**

| Dato | Valor | Fuente |
|---|---|---|
| OCR default | `google/gemini-3.6-flash` — $1.5 in / $7.5 out por M | models.ts:48 · openrouter.ts:132 |
| OCR en producción (override Vercel) | `google/gemini-3.1-flash-lite` — $0.25 / $1.5 | models.ts:44-47 · openrouter.ts:140 |
| Tokens por llamada OCR (medido en prod) | 4,076 in + 1,536 out | .env.example:167-168 |
| Costo por comprobante (medido) | $0.0176 (3.6-flash) · $0.0069 (sin razonamiento) · **$0.0015-0.0016 (3.1-flash-lite)** | .env.example:171-172 · models.ts:38 · openrouter.ts:138 |
| Cuadre | `claude-sonnet-5` — $2/$10 intro **hasta 31-ago-2026**, después $3/$15 | openrouter.ts:144 |
| Banda por liquidación (arquitectura, jul-2026) | ≈ $0.03-0.05 / liquidación | models.ts:17 |
| WhatsApp saliente | $0.008 / mensaje (default; entrantes gratis) | costos.ts:47 |

**Proyección mensual:**

| Concepto | 2 fotos/viaje (30k OCR) | 4 fotos/viaje (60k OCR) |
|---|---|---|
| OCR con el **override vigente** (lite, $0.0015-0.0016) | **$45-48** | **$90-96** |
| OCR si alguien revierte al default (3.6-flash, $0.0176) | $528 | $1,056 |
| Cuadre + chat + router (banda del repo: 12k liq × $0.03-0.05) | $360-600 | $360-600 |
| WhatsApp saliente (fórmula: 15,000 × M × $0.008) | $120 × M | $120 × M |

- **Escenario central** (3 fotos/viaje, override lite, banda media $0.04/liq,
  M = 4 mensajes salientes/viaje como supuesto ilustrativo): 45k×$0.0016 =
  $72 + 12k×$0.04 = $480 + $480 de WA ≈ **$1,030 USD/mes**, del cual la IA
  pura es ≈ **$550**.
- **Advertencias que el propio repo obliga a dar:** (a) la banda $0.03-0.05
  es de julio, ANTERIOR a la medición de OCR del 4-ago — no se sabe si ya
  incluye el OCR, así que sumar ambas columnas puede doble-contar unos
  centavos por viaje; (b) los **tokens del cuadre no están registrados** —
  solo la banda; (c) la frecuencia de escalación a Opus ($5/$25) **no está
  registrada**; (d) el intro de Sonnet vence el 31-ago: la banda sube ~50%
  en su componente de cuadre; (e) M (salientes/viaje) no está medido — por
  eso va como fórmula. El caché de prompt medido (−91.6% en llamada repetida,
  openrouter.ts:165-171) puede bajar el cuadre; sin medición por fase, no se
  proyecta.
- **Lo accionable:** la variable más cara es el modelo de OCR. El override
  `LIKIDA_MODEL_OCR=google/gemini-3.1-flash-lite` vive SOLO en Vercel
  (models.ts:44-47): si alguien limpia el env, el costo de OCR se multiplica
  **×11** en silencio. Con 15k viajes eso es ~$460-960/mes de diferencia.

---

## 6. La deuda estructural: agregados de JS con fecha de caducidad

`traerTodo` es correcto (lanza en vez de truncar) pero **lanza**: su techo es
100 páginas = 100,000 filas (pg.ts:45-48). Con este cliente, cada función que
lee una tabla completa del tenant tiene fecha de caducidad CALCULABLE — y al
llegar, la pantalla del CLIENTE muestra su estado de error:

| Función (todas verificadas con `traerTodo`) | Tabla que agota | Rompe en | Estado (15-ago-2026, mig. 0112) |
|---|---|---|---|
| `getGastoPorConcepto` (analytics.ts:1018), `getGastoPorRuta` (:1042), `detectarAnomalias` (:354), `getTopRutasPorGasto` histórico (:1128), `getGastoPorSemana` 52 sem. (:468) | `gasto` (45k/mes) | **~mes 2.2** | **SIGUE con fecha** — fuera del carril de esta pasada (mínimos: repo.ts/analytics.ts/fiscal.ts, no todo `analytics.ts`) |
| `getSerieComparativa` histórico (vía `getSeriesKpiCards`) | `gasto`/`viaje`/`liquidacion` (45k/15k/12k por mes) | ~mes 2.2 | ✅ **RESUELTO** — `serie_comparativa_tenant` (0112), `sum()`/`count()` en SQL con los índices de la 0111. Prueba de equivalencia: `analytics_serie_comparativa.test.ts` |
| `getGastosFiscales` periodo 'ejercicio' — el **default** del contador (fiscal.ts:108, 799) | `gasto` del año | ~mes 2.2 de cada ejercicio | **SIGUE con fecha, A PROPÓSITO** — no es un `sum()`/`count()`: sus filas alimentan `resumirFiscal`/`resumirPerdidas`, que evalúan deducibilidad por comprobante (IVA acreditable proporcional, EFOS, plazo de portal por comercio). Migrar esa lógica a SQL duplicaría la ley fiscal en dos lenguajes — razón completa en la cabecera de la mig. 0112 y en el JSDoc de `getGastosFiscales` |
| `getAcumuladoCombustible` (repo.ts) — **camino del webhook, corre en CADA CUADRE** | `gasto` diésel del año | ~mes 6.7 (§4) | ✅ **RESUELTO — Y ERA UN HALLAZGO NUEVO.** La RPC (`sumar_combustible_ejercicio`) ya existía APLICADA en producción desde la mig. 0084 (05-ago-2026) y **nadie la llamaba** — código muerto durante 10 días con el `sum()` que resolvía esto ya viviendo en la base. Además tenía un bug real: no filtraba `monto > 0`, así que un ajuste/duplicado con monto negativo o cero se habría sumado al denominador del 15% de combustible en efectivo (RFA 2026 regla 2.9) en cuanto alguien la conectara. La 0112 corrigió el filtro y conectó `getAcumuladoCombustible`. Prueba de equivalencia: `repo_acumulado.test.ts` |
| `getViajesPorMes` (:599), `getStatsPorOperador.viaje` (:304), `getOperadoresDetalle.viaje` (:1227), `getTopRutasPorGasto.viaje` (:1141) | `viaje` (15k/mes) | ~mes 6.7 | **SIGUE con fecha** — fuera del carril de esta pasada |
| `getKpis` sin ventana | `liquidacion` (12k/mes) | ~mes 8.3 | ✅ **RESUELTO** — `kpis_liquidacion_tenant` (0112). Prueba de equivalencia: `analytics_kpis_acreditables.test.ts` |
| `getAcreditables` sin ventana | `liquidacion` (12k/mes) | ~mes 8.3 | ✅ **RESUELTO** — `acreditables_liquidacion_tenant` (0112). Misma prueba de equivalencia que `getKpis` |
| `getDineroObservadoPorTipo` (:267), `getLiquidadoPorSemana` 52 sem. (:544), `getLiquidacionesFiscales` 'ejercicio' (fiscal.ts:979), `getStatsPorOperador.liquidacion` (:313), `getOperadoresDetalle.liquidacion` (:1232) | `liquidacion` (12k/mes) | ~mes 8.3 | **SIGUE con fecha** — fuera del carril de esta pasada |

Y ANTES de romper, cobran en latencia: cada 45,000 filas son 45 viajes de red
en serie por función, y una carga del Resumen dispara varias en paralelo.

**Lo que se movió a RPC (15-ago-2026, mig. 0112):** los cuatro caminos con
prioridad más alta por fecha de caducidad Y por correr en el camino
CALIENTE (el cuadre gana sobre un panel aunque su fecha sea más lejana) —
`getAcumuladoCombustible`/`sumar_combustible_ejercicio` (1º, camino del
cuadre — y resultó ser una RPC ya escrita y dormida desde la 0084, con un bug
que esta pasada corrigió de paso), `getSerieComparativa` (2º, mismo mes 2.2
que `getGastosFiscales`, corre 3×/carga), `getKpis` y `getAcreditables` (3º,
mismo mes 8.3, `liquidacion`). Las cuatro siguen el patrón que el repo ya
validó dos veces — `resumen_documentos_tenant` / `resumen_costo_ia_tenant`
(mig. 0064) — con el fail-closed de forma de `costos.ts:295-316` y
`SECURITY INVOKER` (no `DEFINER`: la app llama con `service_role`, que ya
salta RLS, así que un `definer` no daría más permiso y sí abriría una fuga
entre flotas si algún `revoke` se olvida — el mismo argumento que la 0064).
Cada una con su prueba de equivalencia JS-viejo-vs-RPC-nueva en TS, más el
bloque `AGREGADOS_0112` en `supabase/verificaciones.sql` (aislamiento entre
dos tenants sembrados a mano, y para el combustible, la regresión explícita
del bug del `monto > 0`).

**Lo que NO se movió, y por qué:** `getGastosFiscales` se quedó a propósito
(lógica de deducibilidad fiscal, no aritmética — ver la fila de la tabla). El
resto de la lista de §6 —los agregados de `gasto`/`viaje` restantes en
`analytics.ts` y las cinco funciones más de `liquidacion`— sigue con fecha de
caducidad calculable y es la tarea de fondo que queda para la siguiente
pasada, en el mismo orden: `gasto` (mes 2.2) antes que `viaje`/`liquidacion`
(mes 6.7-8.3). La 0111 (índices) no cambió estas fechas —baja el costo de
filtrar, no el de acarrear— y la 0112 tampoco las cambió para lo que dejó
sin mover.

---

## 7. Resultados de la corrida sintética — *(los pega el orquestador)*

Scripts diseñados (no corridos aquí): `scripts/carga-15k.sql` (siembra:
tenant `ZZZ CARGA` fijo `aaaaaaaa-0000-4000-8000-000000015000`, 200
choferes, 15,000 viajes, 45,000 gastos, 12,000 liquidaciones; respeta 0025/
0029/0036/0070 — el porqué de cada decisión está en su cabecera),
`scripts/carga-15k-medir.sql` (las consultas calientes REALES traducidas
literalmente de PostgREST, en `EXPLAIN (ANALYZE, BUFFERS)`),
`scripts/carga-15k-limpiar.sql` (delete del tenant, cascada, con guardia de
nombre).

**Orden de corrida:** aplicar 0111 → correr bloque `INDICES_0111` de
verificaciones.sql → `carga-15k.sql` → `carga-15k-medir.sql` → pegar salidas
→ `carga-15k-limpiar.sql`.

**Umbral aceptable, y por qué:** consulta de **pantalla < 100 ms** (una
página del dashboard encadena 3-6 consultas; a 100 ms cada una el servidor
sigue debajo del segundo, que es donde un panel deja de sentirse roto);
página de 1,000 de un agregado < 100 ms (una función de 45 páginas queda en
~4.5 s — tolerable HOY como techo, inaceptable como norma: §6); camino del
**webhook < 50 ms** por consulta (el turno completo carga OCR de 25 s;
la base no debe ser quien gaste el presupuesto).

### Verificación de índices (bloque INDICES_0111)

```
ERROR: P0001: INDICES_0111  ambos=2  gasto_def=t  viaje_def=t   (esperado 2/t/t)
— corrida 15-ago-2026 vía MCP, tras aplicar la 0111. Coincide.
```

### Conteo de control de la siembra

```
operadores=200 | viajes=15000 | gastos=45000 | liquidaciones=12000
— corrida 15-ago-2026. Coincide exacto.
```

### EXPLAIN ANALYZE — pantallas

```
[P1] getViajes limit 100      → 2.9 ms  · Index Scan viaje_reciente_idx (5 buffers)
[P2] getDocumentos limit 100  → 3.3 ms  · Index Scan gasto_reciente_idx (77 buffers)
[P3] getLiquidaciones limit 50→ 0.1 ms  · Index Scan idx_liq_tenant (4 buffers)
[P4] contarViajes             → 3.5 ms  · Index ONLY Scan viaje_tenant_fecha_inicio_idx (0111), 0 heap fetches
[P5] contarEscalados          → 1.2 ms  · Index Scan idx_viaje_tenant (200 filtradas)

HALLAZGO DE LA CORRIDA: la PRIMERA medición de P1 dio 257 ms con el plan
equivocado — las estadísticas estaban frías tras el bulk insert (el
planeador estimaba rows=1 contra 15,000 reales). Un `ANALYZE` sobre las 4
tablas lo bajó a 2.9 ms. Lección operativa: tras cualquier carga masiva
(importar el histórico del cliente el día del onboarding), correr ANALYZE
antes de enseñar el panel.
```

### EXPLAIN ANALYZE — agregados (páginas de traerTodo)

```
[A1] getKpis pág. PROFUNDA (offset 11000) → 9.6 ms · liquidacion_paginacion_idx
     (12,047 buffers — el OFFSET relee todo, pero caliente y chico; pág. 1
     estrictamente más rápida, no medida aparte)
[A2] serie gasto 60d   → 2.2 ms · gasto_pkey con filtro (el planeador prefirió
     pkey porque el order by id y el tenant único lo permiten; sin Seq Scan)
[A3] serie viaje 60d   → 1.7 ms · viaje_pkey con filtro (ídem; sin Seq Scan)
[A4] getGastosFiscales pág. 45 (offset 44000, 21 cols) → 81.7 ms ·
     45,154 buffers — DENTRO del umbral pero es la página del techo: las 45
     páginas encadenadas del panel del contador suman segundos (§6 sigue
     vigente: migrar a RPC).
[A5] getAcumuladoCombustible → 9.8 ms · Index Scan gasto_tenant_fecha_idx
     (0111) + incremental sort — EL ÍNDICE NUEVO TRABAJANDO en la consulta
     que corre en cada cuadre.
[A6] candidatos consolidado → 3.0 ms · sin Seq Scan
[A7] resumen_documentos_tenant → 129.7 ms frío / 49.3 ms caliente (1,525
     buffers); resumen_costo_ia_tenant → 18.5 ms. El RPC agregado es el
     patrón correcto: 45k filas agregadas en <50 ms calientes.
```

### EXPLAIN ANALYZE — camino del webhook

```
[W1] getOpenViaje              → 1.6 ms · uq_viaje_abierto_por_operador
[W2] operador por teléfono     → 0.1 ms · idx_operador_tel
[W3] dedup por img_hash        → 1.4 ms · uq_gasto_img_hash
[W4] gastos de un viaje        → 0.3 ms · idx_gasto_viaje
[W5] claim insert (revertido)  → 17.9 ms · escritura con PK (bajo el umbral de 50)
```

### Veredicto

```
VEREDICTO (15-ago-2026): TODO dentro del umbral con estadísticas frescas.
Cero Seq Scans en las 17 mediciones. El índice de la 0111 carga la consulta
del cuadre (A5: 9.8 ms) y el conteo de viajes (P4, index-only). Los dos
avisos que quedan de pie: (1) ANALYZE obligatorio tras cargas masivas — sin
él, P1 salió 88× más lento con el plan equivocado; (2) el techo real no es
la base sino el patrón traerTodo-en-JS (A4: 45 páginas × ~80 ms), que
revienta por EXCEPCIÓN de 100 páginas entre el mes 2.2 y el 8.3 (§6) — la
migración a RPCs sigue siendo la tarea de fondo antes del mes 3 del cliente.
Tenant ZZZ CARGA borrado tras la corrida (limpiar.sql, verificado en 0).
```

---

## 8. Estado de verificación de esta pasada

- `npx tsc --noEmit -p .` → limpio (exit 0). Sin ruido de agentes paralelos
  al momento de mi última corrida.
- `npx eslint` sobre los 19 archivos tocados → 0 errores, 0 warnings.
- vitest de TODOS los archivos con pruebas que tocan lo cambiado → corrida
  consolidada final: **23 archivos, 331 pruebas, todas verdes** (pg, fiscal,
  analytics, consolidado ×3, desglose ×2, informes_wa, chat route ×2,
  cobranza ×4, escalar, chat-tools, y las dos suites nuevas). **No** se
  corrió la suite completa (regla de esta pasada).
- **NO aplicado a la base** (lo corre el orquestador): la 0111, el bloque
  `INDICES_0111`, y los tres scripts de carga.
