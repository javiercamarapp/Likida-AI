# Mapa de carga del dashboard — riesgo a 50k viajes/mes (22-ago-2026)

Supuestos: viaje 50k/mes (600k/año), gasto 300k/mes (3.6M/año), liquidacion 50k/mes (600k/año).

## El helper
`traerTodo` (`src/lib/likida/pg.ts:177`): PAGINA=1,000, MAX_PAGINAS=100 → tope 100,000 filas; al rebasar LANZA `LecturaIncompleta` (pg.ts:214). Offset O(n²). `traerPorIds` (pg.ts:159) sin tope (600k ids = 3,000 viajes de red). `acotada()` (presupuesto.ts:160, 8 s) NO se usa en analytics/comercial/fiscal/operacion/clientes/facturacion_clientes/admin/negocio.

Umbrales: gasto revienta a 30 días (300k); viaje/liquidacion a 84 días (140k) y sin filtro (600k).

## Nivel 1 — lee `gasto` completo (3.6M): revienta ~día 10
| # | Función | archivo:línea | Páginas | Filtro | Rec. |
|---|---|---|---|---|---|
| 1 | `detectarAnomalias` | analytics.ts:378 | Resumen (inicio-contenido.tsx:96), Contador (inicio-contador.tsx:79), Combustible-Casetas (:122), Notificaciones (:40) | gasto sin fecha | RPC: `group by cfdi_uuid/folio having count(distinct viaje_id)>1` |
| 2 | `getGastoPorSemana` 52 sem | analytics.ts:506 vía :560 | Resumen (:100) | gasto gte fecha 35/91/364 d | RPC `date_trunc('week')` por concepto |
| 3 | `getGastosFiscales` 'ejercicio' | fiscal.ts:813 | Resumen (:102), Contador (:81) | gasto año completo + traerPorIds 600k viajes | acotar/agregar por dimensiones (JSDoc fiscal.ts:790-812 explica por qué no RPC) |
| 4 | `getGastosFiscalesSeries` | fiscal.ts:930 | Resumen (:105), Contador (:85) | 3× getGastosFiscales: 7d, 30d, 'todo' (:948) | quitar vista 'todo' o agregar |
| 5 | `getTopRutasPorGasto` histórico | analytics.ts:1265 vía :1314 | Resumen (:107) | gasto sin ventana (:1327) + viaje completo ×3 | RPC `sum group by origen,destino limit 5` join viaje |
| 6 | `getGastoPorConcepto` | analytics.ts:1155 | Combustible-Casetas (:120) | gasto sin fecha | RPC `sum/count group by concepto` |
| 7 | `getStatsPorOperador` | analytics.ts:314 | Agente Liquidación (page.tsx:61) | operador + gasto diésel + viaje + liquidacion completos | RPC 3 joins |

## Nivel 2 — lee `viaje`/`liquidacion` completos (600k): revienta ~mes 2
| # | Función | archivo:línea | Páginas | Rec. |
|---|---|---|---|---|
| 8 | `getLiquidadoPorSemana` 52 sem | analytics.ts:582 vía :617 | Resumen (:101) | RPC sum por semana, día local MX |
| 9 | `getViajesPorMes` | analytics.ts:637 | Resumen (:106) | RPC count group by mes |
| 10 | `getOperadoresDetalle` | analytics.ts:1352 | Operadores (page.tsx:53), Inicio-Operación (:87) | RPC |
| 11 | `getDineroObservadoPorTipo` | analytics.ts:280 | Agente Liquidación (:60) | RPC (jsonb_array_elements en CTE, como 0112) |
| 12 | `getRentabilidad` | comercial.ts:133 | Rentabilidad (:31) | RPC 4 sums |
| 13 | `getFacturacionClientes` | facturacion_clientes.ts:609 | Facturación (:55), Contador (:89) | RPC + acotar |
| 14 | `getCobranza` | comercial.ts:188 | Rentabilidad (:32), Facturación, Clientes | acotar por periodo + paginar UI (devuelve facturas enteras) |
| 15 | `getPanelClientes` | clientes.ts:601 | Clientes (:54) | RPC |
| 16 | `getCartera` | comercial.ts:48 | vía getPanelClientes | RPC |
| 17 | `getTableroOperacion` | operacion.ts:458 | Inicio-Operación (:78), Despacho (:51) | RPC 6 conteos |
| 18 | `getCargaOperadores` | operacion.ts:49 | Inicio-Operación (:80), Despacho (:54) | RPC |
| 19 | `getIncidencias` | operacion.ts:258 | Inicio-Operación (:81) | join en SQL (trae 600k viajes para un folio) |
| 20 | `getLiquidacionesPorDia(84)` | analytics.ts:413 | Agente Liquidación (:58) | RPC count por día local |
| 21 | `getConciliacionConsolidado` | analytics.ts:1858 | Combustible-Casetas (:124), Peajes (:59) | RPC 3 conteos |
| 22 | `getLineasPorConciliar` | analytics.ts:1908 | idem | paginar UI |

## Ya bien (nivel 3)
getSerieComparativa/getSeriesKpiCards/getKpis/getAcreditables (RPC 0112), getAcumuladoCombustible (RPC+acotada), contarViajes/contarEscalados/contarHuerfanosPendientes (head count), getViajes(100), getDocumentos(limit; Comb-Casetas pide 1000), getLiquidaciones(50), getHuerfanosDeFlota, getLiquidacionDetalle, getPrimerosPasos, getValorAhorro.

Muertas sin llamador: getGastoPorRuta, getViajesSinLiquidar, getLiquidacionesFiscales, getPods, getCotizaciones, getEstadoRastreo (lee posicion completa), contarGastosDelTenant.

## `/dashboard/viajes` — `getViajesRegistro` (analytics.ts:1042)
Pagina (≤100) pero: `pagina` hasta 1000 → OFFSET 100k (viajes/page.tsx:46); `.or(ilike %q%)` sin índice → seq scan 600k (:1065); `order fecha_inicio desc nulls last, created_at desc` sin índice que lo sirva (:1068). Rec: keyset sobre (fecha_inicio, id) + índice `(tenant_id, fecha_inicio desc nulls last, created_at desc)` + pg_trgm GIN.

## Páginas con Promise.all gordo
Resumen 16 funciones (6 lanzan a escala); Contador 8; Agente Liquidación 13; Inicio-Operación 8 (4 lecturas de los mismos 600k viajes); Despacho 7; Combustible-Casetas 6; Viajes 6 + 4 `count exact` sobre 600k por carga.

## `/admin` — `getResumenNegocio` (src/lib/admin/negocio.ts:191)
Lee `viaje` (:216) y `gasto` (:221) de TODOS los tenants sin fecha → con un cliente de 50k/mes lanza a los ~10 días. La llaman ~17 páginas de /admin (consola, ejecutivo, consumo, notificaciones, model-ops, agente-*, capacidad-forecast, configuracion, flotas, usuarios/nuevo, crecimiento, integraciones, costos-facturacion, analitica, observabilidad). `getLiquidacionesEnRevisar` (:642) cross-tenant sin fecha.

## UI
`BannerInsight` (kit.tsx:391) `truncate` en un span con un monto → "$12,345,6…" mutilado. `StatCard` (kit.tsx:147) y `KpiTile` (:63) sin `truncate/overflow`: a ~1e14 se desbordan; sin prueba de ancho. `WidgetUso` (kit.tsx:217) en sidebar de /admin muestra USD 7 cifras.

## Índices
Existen: gasto_tenant_fecha_idx, viaje_tenant_fecha_inicio_idx (0111), idx_liq_tenant (tenant, created_at desc), *_paginacion_idx (tenant,id), idx_gasto_acumulado (tenant,concepto,fecha), idx_viaje_tenant (tenant,estatus). Faltan: gasto (tenant_id, concepto) para group by sin fecha; pg_trgm para ilike; viaje (tenant_id, fecha_inicio desc nulls last, created_at desc).

## Molde RPC (0112)
`create or replace function public.x_tenant(p_tenant uuid, p_desde timestamptz default null) returns jsonb language sql stable parallel safe set search_path = public, pg_catalog as $$ select jsonb_build_object('campo', coalesce(sum(col),0)) from t where tenant_id = p_tenant and (p_desde is null or created_at >= p_desde); $$;` + comment + `revoke all ... from public, anon, authenticated; grant execute ... to service_role;`. JS: validar forma y lanzar. Prueba de equivalencia JS-viejo vs RPC.
