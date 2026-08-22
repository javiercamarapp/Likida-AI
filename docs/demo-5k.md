# Demo «Transportes Peninsulares, S.A. de C.V.» (TPS) — flota de 5,000 camiones

Sembrada el 22-ago-2026 en el proyecto Supabase de producción `gngoqsvrxdguxvsizpbw`
(la única base que hay). **Es un tenant aparte** (`dddddddd-0000-4000-8000-000000005000`):
no se tocó nada de Flota G3M ni de ninguna otra flota. **Se elimina en cuanto Javier tome
las capturas** — ver §6.

Modelo de referencia: `docs/demo-5k-modelo.md`. Script: `scripts/demo-5k.sql`.
Limpieza: `scripts/demo-5k-limpiar.sql`.

## 1 · Cómo verla (cuenta de Javier, sin usuario nuevo)

Javier es `superadmin` (`app_user.tenant_id = null`), y un superadmin **elige** la flota que
mira (`src/lib/auth/guard.ts`, `admin-context.ts`). No hubo que ligar nada en `app_user`:

1. Entrar a `https://app.likida.ai/login` con la sesión normal (javiercamaraportepetit@gmail.com).
2. Ir a **`/admin/elegir-flota`** y elegir **«Transportes Peninsulares, S.A. de C.V.»**
   (la lista la arma `supabaseAdmin().from('tenant')`; la demo aparece como una flota real).
   Eso deja una cookie firmada y redirige a `/dashboard`.
3. Alternativa sin cookie (auditada como "ver como"):
   `https://app.likida.ai/dashboard?tenant=dddddddd-0000-4000-8000-000000005000`
   (y lo mismo con `/dashboard/viajes?tenant=…`, etc.).
4. Para volver a G3M: `/admin/elegir-flota` → «quitar selección» o elegir la otra.

Cada selección queda en `bitacora_auditoria` / `impersonacion_dia` (FK con cascade →
se borran con el tenant; la bitácora es `SET NULL`, append-only, no se toca).

**Local (`npm run dev`) no sirve para esta demo:** `.env.local` no trae
`NEXT_PUBLIC_SUPABASE_URL/ANON_KEY` ni `SUPABASE_SERVICE_ROLE_KEY` (en Vercel están como
*sensitive*: `vercel env pull` las baja como `[SENSITIVE]`), y el selector de flota usa
`supabaseAdmin()`. El login además es magic link / Google, no automatizable. Por eso la
verificación visual se hace en producción con la sesión de Javier.

## 2 · Qué hay en la base (conteos verificados 22-ago-2026)

| Entidad | Filas | Detalle |
|---|---|---|
| `tenant` | 1 | RFC ficticio `TPE150812AB3`, régimen 601, CP 66600 (Apodaca), uso G03, plan `demo` |
| `terminal` | 25 | MTY, GDL, CDMX, QRO, SLP, PUE, VER, MID, CUN, VSA, TIJ, CJS, NLD, HMO, CUL, LEON, AGS, TOL, TAM, SAL, MZT, OAX, TUX, CHI, DUR |
| `cliente` / `tarifa` | 40 / 40 | los del modelo (Abarrotes del Norte, Aceros Monterrey, …), tarifa por km $28–42 |
| `operador` | 7,500 | 7,200 activos; nombres mexicanos verosímiles; tel. `5215559000001…5215559007500`; licencia E con vencimientos mezclados (vencidas / <30 días / vigentes / sin dato) |
| `unidad` | 5,000 | `T-0001…T-5000`; 60 % Kenworth (T680/T880/T660), 25 % Freightliner (Cascadia/M2), 10 % International LT625, 5 % Volvo VNL 760; años 2014–2026; 4,600 en ruta / 250 taller / 150 disponibles; placas `ABC-1234-A` ficticias |
| `viaje` | **27,544** | 30 días (24-jul → 22-ago), 580 los domingos / ~970 entre semana; 70 corredores reales ×2 sentidos; `km_recorridos` e `ingreso_flete` en todos |
| — abiertos / en_cuadre / liquidados | 1,806 / 134 / 25,604 | **máx. 1 abierto por operador** (constraint 0029), `avisado_en` NULL en todos los abiertos, 28 escalados sin aceptar |
| `gasto` | **96,118** | diésel 50,309 · caseta 24,869 · alimentación 11,059 · otro 6,846 · hospedaje 1,652 · factura 1,383 (3.49 por viaje) |
| — sin CFDI | 22.7 % global (5 % del diésel) | diésel con complemento de hidrocarburos, IEPS 6.174 $/L, 25 % en efectivo (`forma_pago 01`) |
| — diésel sobre tope ($4,000) | 7.9 % de los viajes | + casetas > $5,000, alimentación > $450, hospedaje > $900, otro > $1,500 |
| — anomalías | 14 CFDI repetidos en 2 viajes | los ve `detectarAnomalias` (inicio y combustible-casetas) |
| `liquidacion` | **24,827** (97 % de los liquidados; 777 liquidados sin liquidación) | 18,252 cuadradas · 4,343 con diferencias · 2,232 a revisar; `total_comprobado` = suma exacta de sus gastos (0 descuadres); anticipo $182.7 M vs comprobado $188.9 M; 8,746 faltantes > $500 y 5,175 sobrantes > $500; IVA/IEPS/peaje/litros acreditables llenos |
| `pod` | 1,552 | 60 % subido, resto pendiente/rechazado (tablero del encargado) |
| `incidencia` / `mantenimiento` | 60 / 280 | mitad abiertas, SLA de 4–48 h; 250 órdenes de taller + 30 DVIR |
| `comprobante_huerfano` | 42 | 12 pendientes (alerta del inicio), 30 resueltos |
| `factura_emitida` / `pago_recibido` | 556 / 333 | cobranza en /rentabilidad: pagadas, emitidas, vencidas y canceladas |

### Los viajes del guion del video (arriba de `/dashboard/viajes`)

| Folio | Ruta | Anticipo | Comprobado | Liquidación |
|---|---|---|---|---|
| **1042** | Monterrey → Querétaro | $10,600 | $10,600 = diésel **$4,200 (sobre tope $4,000)** + diésel $3,800 + caseta $1,400 + factura CFDI $1,200 | hoy, `con_diferencias`, una sola diferencia `sobre_politica` de $200 |
| 1039 | Guadalajara → CDMX | $8,400 | $8,400 | `cuadrada` |
| 1037 | Veracruz → Puebla | $6,200 | $6,200 | `cuadrada` |
| 1035 | San Luis Potosí → Monterrey | $9,100 | $9,100 | `cuadrada` |

Tienen `created_at` de la última hora, así que salen en las primeras filas (la tabla ordena
por `created_at desc` y muestra 100).

## 3 · Decisiones y lo que NO se modeló

- **27,500 viajes y no 70,000 — a propósito.** `traerTodo()` (`src/lib/likida/pg.ts:48`)
  **lanza** «lectura incompleta» al pasar de 100,000 filas por tabla, y lo usan
  `getGastoPorConcepto` y `detectarAnomalias` (/combustible-casetas), `getGastosFiscales`
  («Ahorro generado» y motor fiscal del inicio), `getRentabilidad`, `getOperadoresDetalle` y
  el top de rutas histórico. Con 70,000 viajes (~220,000 gastos) esas pantallas mostrarían el
  error en vez de cifras (`docs/escala-15k.md §6` lo documenta). La siembra se quedó en
  **96,118 gastos**, el máximo que cabe. Para 70,000 viajes: en `scripts/demo-5k.sql`
  BLOQUE 4 poner `por_dia := 2540; domingo := 1000` y aceptar el error — o agregar en SQL
  esas lecturas (como hizo la 0112 con los KPI).
- **Tope de caseta $5,000** (no $1,500): el gasto de casetas es **una línea por viaje**
  (estado de cuenta del TAG) — con $1,500 el 43 % de las liquidaciones salía con
  diferencias por la caseta MTY–QRO de $2,900.
- Los 14 conceptos del modelo se mapean a los 9 del dominio (`gasto_concepto_dominio`):
  diésel→`diesel`, casetas→`caseta`, viáticos/alimentos→`alimentacion`, hospedaje→`hospedaje`,
  refacción/grúa/custodia→`factura`, maniobras/pensión/lavado/permisos/multa→`otro`
  (el detalle va en `ocr_extra.detalle`). Báscula y telefonía se quitaron por el techo.
- **No modelado (no hay tabla o columna):** remolques, tipo y peso de carga, carta porte por
  viaje (`viaje.ccp_*` solo son banderas), contralor regional por terminal, rendimiento y
  tanque por unidad (`tenant.config.unidades` existe pero ningún panel lo lee), firmas de
  liquidación, `pdf_url` (no hay archivo en storage), marcas `duplicado_sospechoso` /
  `fuera_de_ruta` / `cfdi_validado_qr` (se aproximan con CFDI repetidos, `xml_verificado`
  y `estado_sat`), `desglose_peaje`, `cfdi_consolidado_linea` (la sección de conciliación
  de /combustible-casetas dirá «todavía no llega ningún CFDI consolidado» — es verdad).
- **Historial de 8 semanas**: solo hay 30 días. La gráfica semanal muestra 5 semanas con
  datos; el histórico por mes, julio y agosto. Sembrar julio completo rompería el techo.
- `viaje.avisado_en` NULL en los 1,940 abiertos → en `/dashboard/viajes` su pill de aviso
  sale como «sin avisar». Es el precio de que el cron de WhatsApp no les escriba a 7,500
  números falsos (`escalar_viaje.ts` y cobranza filtran `avisado_en is not null`).
- Los abiertos llevan `escalado_en` en 28 casos con `avisado_en` NULL (para la alerta
  «escalados sin chofer»); semánticamente raro, inofensivo para los crons.

## 4 · Tiempos medidos (base de producción, 22-ago-2026)

Siembra: bloque 1 0.07 s · operadores 1.0 s · unidades 0.2 s · viajes 1.4–1.8 s por tramo
de ~7,000 · gastos 7.3–7.9 s por tramo de ~32,000 · liquidaciones 7–9 s · bloque 8 2.3 s.
Total ≈ 45 s de base.

Consultas del dashboard (`EXPLAIN ANALYZE`, solo tiempo de base, sin red ni render):

| Consulta | Tiempo | Plan |
|---|---|---|
| `serie_comparativa_tenant(t, 30, 2, hoy)` (KPI del inicio, ×3) | 334 ms | RPC agregada (0112) |
| `getViajes` (100 recientes) | 1.4 ms | `viaje_reciente_idx` |
| `contarEscalados` | 1.0 ms | `idx_viaje_tenant` |
| `getLiquidadoPorSemana` (página de 1,000) | 14 ms | `liquidacion_pkey` + filtro |
| `getGastoPorSemana` (página de 1,000 con ventana de fecha) | 32 ms | `gasto_pkey` + filtro |
| **`traerTodo(gasto)` completo — 97 páginas de 1,000 por `offset`** | **1.48 s de base** (la página 51 sola: 359 ms) | cada página recorre desde el inicio: O(n²) |
| `traerTodo(viaje)` 28 páginas / `traerTodo(liquidacion)` 25 páginas | 0.32 s / 0.65 s | ídem |

**Pantallas que pueden pasar de 3 s** (por las ~97 llamadas PostgREST en serie, no por la
base): `/dashboard/combustible-casetas` (`getGastoPorConcepto` + `detectarAnomalias` +
`getDocumentos` = ~200 páginas → estimado 6–12 s), `/dashboard` (motor fiscal del
ejercicio lee los 96k gastos: ~100 páginas → 4–8 s además de los KPI), `/dashboard/operadores`
y `/dashboard/rentabilidad` (28 + 25 páginas → ~2–4 s).

**No es un índice lo que falta** — `gasto_paginacion_idx (tenant_id, id)` ya existe y el
costo está en el `offset`. Lo que los bajaría a <1 s es agregar en SQL (un
`sum()/count() group by concepto` para `getGastoPorConcepto`; un `group by cfdi_uuid having
count(distinct viaje_id) > 1` para `detectarAnomalias`; un RPC para `resumirPerdidas`), como
ya hizo la 0112. **No se creó ningún índice en producción.**

## 5 · Verificaciones corridas (todas OK)

```
viajes_total 27544 · abierto 1806 · en_cuadre 134 · liquidado 25604
abiertos_por_operador_max 1 · abiertos_con_avisado_en 0 · abiertos_escalados_sin_aceptar 28
gastos_total 96118 (< 100,000) · gasto_fecha_null 0 · gastos_sin_cfdi 22.7 % · diésel sobre tope 7.9 % de viajes
liquidaciones 24827 · liquidados_sin_liquidacion 777 · liq_comprobado_igual_suma_gastos: 0 descuadres
anticipo 182,689,300 vs comprobado 188,872,833 · dif. media −123.67
telefonos_fuera_rango_falso 0 · viajes_sin_ingreso_flete 0 · viajes/gastos con created_at futuro 0
otros_tenants_viajes 1 (G3M, intacto) · duplicados cfdi 14
```
Reproducibles con las consultas de `scripts/demo-5k-limpiar.sql` (conteos) y del bloque
«verificación» de `supabase/verificaciones.sql`.

## 6 · Páginas para las capturas del video

- **Plano 10 — `/dashboard/viajes`**: KPI «Viajes en total 27,544», abiertos 1,806, en
  cuadre 134, liquidados 25,604, escalados 28; la tabla abre con 1042 / 1039 / 1037 / 1035.
- **Plano 19 — gráfica de gasto semanal**: `/dashboard` → tarjeta «Gasto por categoría»
  del `PanelPeriodo` (selector mensual: 5 semanas; diésel / caseta / alimentación).
- **Plano 22 — reportes por periodo**: `/dashboard` → `KpiPeriodo` + `PanelPeriodo` con el
  selector semanal / mensual / histórico (viajes, actividad, liquidado, top rutas con región).
- También llenas: `/dashboard/rentabilidad` (ingreso de flete vs comprobado, margen,
  cobranza con 556 facturas), `/dashboard/combustible-casetas` (diésel $, casetas $, litros
  elegibles, % sin CFDI, 14 cargas repetidas), `/dashboard/operadores` (7,500; licencias),
  `/dashboard/unidades` (5,000; vigencias), `/dashboard/huerfanos` (12 pendientes).

**Capturas de referencia:** no se pudieron tomar desde esta sesión — el clasificador de
auto mode bloqueó la extensión de Chrome (`mcp__claude-in-chrome`) y la CLI de Supabase, y
en local no hay llaves. La carpeta `~/Desktop/video likida/frames/capturas-app/` queda
creada y vacía para las de Javier.

## 7 · Limpieza (en cuanto estén las fotos)

```
scripts/demo-5k-limpiar.sql   -- pegar en el SQL editor de Supabase (o por MCP)
```
Un solo `delete from tenant where id = 'dddddddd-0000-4000-8000-000000005000'`, protegido:
se niega si el nombre no es el de la demo o si hay filas en las 3 tablas sin cascade
(`chat_conversacion`, `cobranza_contacto`, `prospecto` — hoy 0). **Probado el 22-ago con
rollback**: la cascada tarda **10.0 s**, deja 0 filas en viaje/gasto/liquidacion/operador/
unidad/factura/pod y no toca a los demás tenants. Las FK a tenant sin índice
(`terminal`, `politica_gasto`, `campania`, `impersonacion_dia`, `evento_seguridad`) son
tablas de decenas de filas: no pesan en el borrado.

Después de borrar, `/admin/elegir-flota` deja de listarla; si la cookie de selección
apuntaba a ella, `requireSessionTenant` manda al selector (fallar cerrado).
