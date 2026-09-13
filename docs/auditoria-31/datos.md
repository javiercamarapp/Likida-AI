# Modelo de datos y esquema — auditoría 31

**Nota: 7/10** (antes 7). Razón del movimiento: **ninguna de las tres — la nota
se queda.** La ventana no trajo una línea de `supabase/` ni de `src/`
(`git diff 5ce91b2..HEAD --name-only` = dos dotfiles de latido), así que «se
atacó y subió» no se puede sostener; verifiqué los **11 hallazgos abiertos de la
30 uno por uno con `archivo:línea` y los 11 siguen ahí**, así que tampoco hay
«deuda que cobró factura» nueva ni un hallazgo mal reportado que justifique
subir. Lo que sí hice fue gastar la ronda en **profundidad medida** sobre
caminos que la 30 no había barrido, y el resultado confirma el ancla del rubro
en su lugar exacto: **«7 si las unicidades críticas están y faltan los CHECK de
dominio»**. Las unicidades críticas están, y lo medí en cinco ejes distintos
(abajo); lo que falta sigue siendo dominio.

Lo contable de esta ronda, todo extraído con guion sobre las 333 migraciones y
cotejado a mano después:

| Eje medido | Resultado |
|---|---|
| Tablas creadas / con RLS activa | **155 / 155** (0 sin RLS — los tres `do $$ … foreach … format('alter table %I enable row level security')` de `0001:110`, `0047:162` y `0048` cubren lo que un `grep` literal no ve) |
| Tablas con `tenant_id` / con FK a `tenant` | **100 / 100**; 4 sin `cascade` (3 `set null` deliberadas + `prospecto`) |
| Destinos distintos de `onConflict` en `src/` (sin pruebas) / respaldados por `unique`/PK **no parcial** | **21 / 21** |
| Columnas `text` con «uuid» en el nombre / con normalización de caso | **10 / 10** (9 CHECK `= lower(...)`, 1 índice funcional) |
| Columnas `text` de estado o dominio / con CHECK de dominio | **82 / 77** (5 sin: 3 de servicio, 1 de archivo, 1 tabla muerta) |
| FK de una sola columna entre dos tablas con `tenant_id` / con su compuesta o exceptuada por escrito | **6 / 6** |
| Archivos de `supabase/tests/` / invocados en `ci-postgres.yml` | **53 / 24** (29 sin invocador — reincidente) |
| Migraciones / prefijos duplicados | **333 / 0** (23 números ausentes, ninguno repetido) |

**El riesgo mayor del rubro hoy, y cambió respecto de la 30.** La 30 lo puso en
las cinco copias del predicado de «mismo comprobante», y sigue siendo cierto
(DAT30-M2 reincidente). Pero medido a fondo, el patrón que más se repite es
otro y es más simple: **el esquema protege con enorme cuidado la mesa donde el
contralor mira (el ciclo `viaje → gasto → liquidación → factura_emitida`) y deja
sin piso las tablas que salen del producto hacia el sistema de otro** —
`factura_proveedor`, cuyos tres importes viajan literalmente al layout de
importación de SAP B1 y de CONTPAQi sin un solo CHECK, alimentados desde un
adjunto de correo entrante.

## Estado de los 11 hallazgos abiertos de la 30

Verificados hoy, abriendo cada archivo. **11 de 11 reincidentes**, ninguno
cerrado, ninguno mal reportado.

| # | Veredicto | Evidencia leída hoy |
|---|---|---|
| DAT30-M1 (`prospecto` bloquea el borrado de tenant) | **REINCIDENTE** | `0105_zona_vendedores.sql:80` sigue siendo `tenant_id uuid references public.tenant(id),` pelado. `qa-motor.ts:457-467` sigue con el comentario «son las **DOS** únicas tablas … (las otras 90 sí)» y la lista de dos (`:468`). Mi barrido independiente de hoy: 100 tablas con `tenant_id`, 4 sin `cascade`. |
| DAT30-M2 (0349/0355 deduplican por tenant, no por viaje) | **REINCIDENTE** | `0349:63` y `0355:110` siguen con `row_number() over (partition by unaccent(lower(concepto)), coalesce(folio_norm, folio), monto order by id)` **sin `viaje_id`**; `engine.ts:514` sigue recibiendo `gastos: Gasto[]` de UN viaje. La cabecera de `0355:100-103` sigue diciendo «mismo criterio». |
| DAT30-M3 (`retencion_iva` sin techo) | **REINCIDENTE** | `0352:15` sigue siendo la identidad aritmética y `0352:20` sigue siendo `retencion_iva >= 0`. No hay ningún `retencion_iva <= iva` en las 333. |
| DAT30-M4 (la exención de 0353 afirma «BYTE-IDÉNTICO») | **REINCIDENTE** | `migraciones_verificadas.test.ts:54` conserva textual «pg_get_functiondef() de ambas funciones es BYTE-IDÉNTICO antes y después». Corrí la suite: 4 pruebas, verdes — porque lo único que comprueba de la razón es su longitud. |
| DAT30-B1 (0352 no reaplicable) | **REINCIDENTE** | `0352:9-10`: `add column retencion_iva numeric not null default 0;` sin `if not exists`. |
| DAT30-B2 (el `combustible` del hash contra el dedup de 0349) | **REINCIDENTE** | Sin cambio en `0354:77-93` ni en `0349:56-78`. |
| DAT30-B3 (`senales_pmf` / `embudo_activacion` cuentan rechazadas) | **REINCIDENTE** | `0162:83` y `0251:78` intactos. |
| DAT30-B4 (`0341` no reaplicable) | **REINCIDENTE** | `0341:35`: `drop function public.reclamar_eventos_seguridad(uuid,text,integer,text,integer,timestamptz);` sin `if exists`. Sigue siendo el **único** `drop function` sin guarda de las 333 (medido). |
| DAT30-B5 (pin de 154 tablas) | **REINCIDENTE, latente** | `staging-recovery.mjs:214`: `Number(physical[0].tables) !== 154`. |
| DAT30-B6 (`invitacion_rol_dominio`) | **REINCIDENTE** | `0053:44-45`: `check (rol in ('flota_admin', 'contador', 'encargado', 'operador'))`. Única definición en las 333. Sigue admitiendo el rol que `0086:97` retiró de `app_user_rol_dominio` y rechazando el `vendedor` que `0105:51` agregó. |
| DAT30-B7 (29 de 53 archivos de `supabase/tests/` sin invocador) | **REINCIDENTE** | Recontado hoy: `ls supabase/tests/ \| wc -l` = **53**; invocaciones a `supabase/tests` en `ci-postgres.yml` = **24**. Las 10 exenciones de `migraciones_verificadas.test.ts:55-66` siguen ahí. |

## Hallazgos

### [MEDIO · NUEVO] DAT31-M1 — `factura_proveedor` es la única tabla de documento fiscal del esquema sin piso en sus importes, y los tres viajan literalmente al layout de importación del ERP del cliente
`supabase/migrations/0091_factura_proveedor.sql:30-32`,
`src/lib/likida/proveedores.ts:86-88`,
`src/app/api/correo/entrante/route.ts:364`,
`src/lib/likida/proveedores.ts:397`,
`src/lib/likida/proveedores.ts:425`

`factura_proveedor` declara `sub_total numeric(12,2)`, `iva numeric(12,2)` y
`total numeric(12,2) not null` (`:30-32`) y **no tiene ni un CHECK sobre
ninguno de los tres**. Lo verifiqué barriendo las 333 migraciones por el nombre
de la tabla: los constraints que existen son
`factura_proveedor_conceptos_positivo` (0144:26), `..._origen_dominio`,
`..._ocr_rango`, `..._sat_dominio`, `..._respaldo`,
`..._exporta_solo_aprobada` (0108:49-63) y `..._cfdi_uuid_minuscula`
(0158:395). Ninguno toca un importe.

La asimetría es la que lo vuelve hallazgo y no gusto: sus dos hermanas **sí**
lo tienen. `factura_emitida` —lo que la flota EXPIDE— lleva
`factura_importes_positivos` desde `0049:49` (y 0352 la recreó incluyendo la
retención); `factura_saas` lleva `factura_saas_monto_no_negativo` (`0052:100`).
La que RECIBE, que es la que sale del producto hacia la contabilidad de otro,
no.

**Escenario, con valores, por el camino no autenticado.** El buzón de la flota
recibe un correo con un adjunto XML. `route.ts:335` lo parsea, `:364` llama a
`guardarFacturaProveedor` sin más filtro que `cfdiIngresable`
(`proveedores.ts:86-88`), que es, entero:

```ts
return Boolean(xml.uuid) && typeof xml.total === 'number';
```

`typeof (-4640) === 'number'`. El parser tampoco filtra: `num()`
(`intake/cfdi_xml.ts:262-266`) solo descarta `NaN`, y `parseFloat('-4640.00')`
es `-4640`. Un `@Total="-4640.00"` —una nota de crédito emitida por un ERP que
la firma en negativo, o un XML editado a mano— entra como fila:

```
cfdi_uuid = 'a1b2…', emisor_rfc = 'IES920101ABC', total = -4640.00,
sub_total = -4000.00, iva = -640.00, estado = 'pendiente'
```

La base la acepta. `getFacturasProveedorPendientes` (`escalaciones.ts:117-135`)
la pinta en la cola de aprobación de `/admin` con `total: Number(f.total)` =
`-4640`. `decidirFacturaProveedor` (`proveedores.ts:311-332`) solo hace
`update … set estado = 'aprobada'`: **no mira el importe**. Y aprobada, la fila
sale por los tres layouts de export, que la copian sin tocarla:

- `aFilaSapB1` (`:397`) → `DocTotal: -4640`
- `aFilaContpaqi` (`:425`) → `total: -4640`, `subtotal: -4000`
- `aFilaExportProveedor` (`:365`) → `total: -4640`

**Consecuencia.** El archivo lo importa el contador de la flota a su SAP B1 o a
su CONTPAQi. Un `DocTotal` negativo en un lote de facturas de compra o lo
rechaza el DTW —y el contador pierde el lote entero por una fila que Likida dio
por buena— o entra como una factura de proveedor negativa y le mueve el saldo
de la cuenta 2110. Es exactamente el error que el comentario de cabecera del
propio módulo dice que existe para no cometer («un valor inventado no falla
ruidosamente — importa mal y ensucia un cierre contable»,
`proveedores.ts:344-348`), cometido con un valor que no se inventó: se aceptó.

**Intenté refutarlo por cuatro lados y sobrevive:**
(a) *la vía de la FOTO sí valida* — `validarFotoParaIngreso:185` hace
`if (!(g.monto > 0)) return { ok: false, motivo: 'sin_total' }`. Cierto, y por
eso el hallazgo es solo de la vía XML; que una de las dos puertas valide y la
otra no es el argumento, no la refutación.
(b) *«el CFDI 4.0 prohíbe un Total negativo»* — lo prohíbe el estándar, no el
parser ni la columna, y el origen del XML es un correo entrante, que es
entrada no confiable por definición.
(c) *«un CHECK `total = sub_total + iva` lo atraparía»* — **no debe ponerse**, y
lo digo para que nadie lo intente: `iva` guarda solo el traslado 002
(`proveedores.ts:139`), así que un CFDI con IEPS o con retenciones descuadra
legítimamente. Lo que falta es el **piso** (`>= 0`), no la identidad; ahí la
0352 acertó en la tabla de al lado y aquí no hay nada.
(d) *«el `sub_total` nulo protege»* — no: `total` es `not null` y es el único
que los tres layouts publican siempre.

Causa raíz probable: la 0091 se escribió como bandeja de triage («un humano
decide») y heredó los CHECK del *flujo* —origen, estado SAT, respaldo, quién
aprobó— sin heredar los del *dinero*, que eran los de la 0049, dos migraciones
antes.

### [BAJO · NUEVO] DAT31-B1 — `retencion_iva` es el único importe de `factura_emitida` declarado `numeric` sin escala: la columna admite fracciones de centavo que sus tres hermanas redondean
`supabase/migrations/0352_factura_retencion_iva.sql:10`,
`supabase/migrations/0049_cobranza_factura_emitida_pago.sql:39-41`,
`src/lib/likida/facturacion_escritura.ts:107-109`

`0049:39-41` declara `subtotal numeric(12,2)`, `iva numeric(12,2)`,
`total numeric(12,2)`. `0352:10` agrega
`add column retencion_iva numeric not null default 0` — **`numeric` a secas**,
sin precisión ni escala. Es la única de las cuatro.

Escenario, con valores. La retención del 4 % sobre un subtotal de `$10,000.11`
es `$400.0044`. Un escritor que la calcule en vez de teclearla —el siguiente,
porque hoy no hay formulario: lo dice la propia exención,
`migraciones_verificadas.test.ts:79`— manda `400.0044`. Las tres hermanas
habrían guardado `400.00` por la escala de la columna; ésta guarda `400.0044`
exacto. `factura_total_cuadra` (`0352:15`) tolera `0.01`, así que pasa. La fila
queda con un importe fiscal en fracciones de centavo, que no existe en un CFDI,
y la suma de columnas del periodo deja de cuadrar contra la suma de los
totales.

Hoy no muerde, y lo digo porque lo comprobé: el único escritor es
`crearFactura` (`facturacion_escritura.ts:394`) y su `montoTecleado` **rechaza
explícitamente más de dos decimales** (`:107-109`, con el mensaje «la base
guarda centavos y redondear en silencio descuadraría la factura»). Y ahí está
el punto: la frase describe una garantía que la base da para `subtotal`, `iva` y
`total` por el tipo de la columna, y que para `retencion_iva` da únicamente la
aplicación. Un script de migración de saldos, un `insert` desde la consola de
Supabase o el segundo escritor —el que la columna se creó para recibir— no
pasan por `montoTecleado`.

Causa raíz probable: la 0352 escribió el `add column` mirando el default (`0`)
y no el tipo de las columnas que iba a acompañar en el mismo CHECK.

### [BAJO · NUEVO] DAT31-B2 — `llm_costo_mensual.fase` no tiene el dominio que la 0351 acaba de ampliar en `llm_costo.fase`, y el arnés bidireccional que la 30 celebró mira una sola de las dos columnas
`supabase/migrations/0072_purga_y_consolidado_ia.sql:59`,
`supabase/migrations/0351_costo_fase_copiloto_runner.sql:17`,
`src/lib/likida/costos_dominio.test.ts:36`,
`src/lib/likida/costos_dominio.test.ts:46`

El esquema tiene **dos** columnas `fase`: `llm_costo.fase`, con
`llm_costo_fase_dominio` desde `0025:146` y ampliado a nueve valores por
`0351:17`; y `llm_costo_mensual.fase` (`0072:59`), que es `text not null` y
**sin CHECK**. Lo verifiqué barriendo los `constraint`/`check` de las 333 por
nombre de tabla: `llm_costo_mensual` solo tiene
`llm_costo_mensual_mes_es_dia_1` y `llm_costo_mensual_no_negativo`
(`0072:68-70`).

La 30 anotó, con razón, que `FaseCosto` (`costos.ts:41`) y su CHECK son «el
único dominio del esquema con arnés bidireccional real». Leí el arnés: `:36`
hace `if (!sql.includes('llm_costo_fase_dominio')) continue;` y `:46` lanza si
ninguna migración lo define. O sea que el arnés está **atado al nombre del
constraint**, y la segunda columna, que no tiene constraint, es invisible para
él por construcción. Lo corrí esta ronda: 3 archivos, 12 pruebas, verdes — y
verdes seguirían con cualquier valor en `llm_costo_mensual.fase`.

Escenario, con valores. `consolidar_llm_costo_mensual` (`0072:84-110`) es hoy
el único escritor y lee de `llm_costo`, así que las nueve fases están
garantizadas **aguas arriba**. Un backfill —el caso real: recalcular el
consolidado de un mes cerrado tras la 0351, que agregó `copiloto` y `runner`—
escrito a mano con `insert … values (…, 'copilot', 'claude-…', …)` entra sin
protestar. La PK es `(tenant_id, mes, fase, modelo)`, así que `'copilot'` y
`'copiloto'` son **dos filas** y el panel de costo de IA por fase de `/admin`
pinta dos renglones donde hay uno, con el gasto partido entre ambos. La misma
escritura contra `llm_costo` habría rebotado con 23514.

Consecuencia: la cifra de costo de IA por fase —la que decide si el margen por
liquidación aguanta— puede partirse sin que nada avise, y el arnés que existe
precisamente para que las dos listas no se separen no cubre la columna donde
se separarían. Es BAJO porque hoy hay un solo escritor y es SQL.

Causa raíz probable: la 0072 copió las columnas de `llm_costo` y no sus
constraints; el arnés de la 0351 se ancló al nombre del constraint en vez de al
nombre de la columna, y por eso no puede ver una columna sin constraint.

## Lo que revisé y está bien

Lo que dice «medido» salió de un guion sobre las 333 migraciones; el resto lo
abrí a mano.

- **RLS universal, y lo comprobé contra la trampa que hace fallar el grep.**
  *Medido:* 155 tablas creadas, **155 con `enable row level security`**. Un
  `grep 'alter table X enable row level security'` devuelve falsos positivos
  porque tres bloques (`0001:107-119`, `0047:160-180`, `0048`) la activan con
  `execute format('alter table public.%I enable row level security', t)` sobre
  un `array[...]`. Resolví el `foreach` y no queda ninguna. `gasto`, `viaje`,
  `liquidacion`, `operador`, `unidad`, `pod`, `incidencia` y `mantenimiento`
  —las ocho que un barrido ingenuo reporta como desprotegidas— entran por ahí.
  Y no depende de que alguien se acuerde: el bloque 18 de `verificaciones.sql`
  (`:971-996`) barre `pg_class` y exige la lista vacía, con el job
  `Capa 1 — batería de aislamiento` que lo corre (`ci-postgres.yml:232-243`,
  con `${PIPESTATUS[0]}` explícito para que un fallo no salga en verde).
- **Las 21 rutas de `upsert` tienen su índice único, y ninguno es parcial.**
  *Medido:* extraje los 21 destinos distintos de `onConflict` de `src/` (sin
  pruebas) y los crucé contra los `unique index` / `unique constraint` /
  `primary key` compuestos de las 333. **21 de 21 casan con un único NO
  PARCIAL.** El caso que más fácilmente se rompe está resuelto **y
  documentado**: `0176:59-67` explica que `uq_posicion_lectura
  (tenant_id, unidad_id, medida_en)` va SIN `where` aunque un predicado siempre
  cierto pareciera inofensivo, porque con un único parcial PostgREST no puede
  inferirlo desde `on_conflict=` y «el upsert del poller reventaría con *no
  unique or exclusion constraint matching*». Fui a buscar ese defecto
  precisamente porque es silencioso y no está.
- **La disciplina de minúsculas en los UUID de CFDI está completa.** *Medido:*
  10 columnas `text` con «uuid» en el nombre en todo el esquema. Las 10 tienen
  normalización de caso: nueve con CHECK `= lower(...)` (`gasto`, `cfdi_xml`,
  `factura_emitida`, `factura_proveedor` por `0158:392-429`; `codigo_pendiente`,
  `factura_saas`, `rep_emitido` `0228:210`, `sat_cfdi_descargado` `0231:241`, y
  **las DOS de `cfdi_pago`** en un solo constraint, `0283:188-189`), y la
  décima, `ccp_timbre.uuid_fiscal`, por un camino distinto pero equivalente:
  índice único funcional `(tenant_id, lower(uuid_fiscal))` (`0226:141-142`) más
  un CHECK de forma case-insensitive (`:123-124`). Esto es lo que hace
  imposible el caso de manual del rubro —el mismo CFDI cobrado dos veces—, y la
  0283 lo dice con el número: «el IVA del docto se libera dos veces».
- **El barrido de FK compuestas de la 0145 es real y se autovigila.** *Medido:*
  6 FK de una sola columna entre dos tablas con `tenant_id`. Cuatro
  (`cfdi_consolidado_linea.cfdi_xml_id`, `desglose_peaje_linea.desglose_id`,
  `factura_saas.suscripcion_id`, `llm_costo.liquidacion_id`) **tienen su
  hermana compuesta** en la lista de `0145:135-165`; las otras dos
  (`cola_aprobacion.prospecto_id`, `envio_mensaje.campania_id`) apuntan a
  destinos con `tenant_id` NULLABLE y están exceptuadas **por escrito** en el
  bloque 112 (`verificaciones.sql:5789-5791`), que además lo lee del catálogo
  —no de una lista de nombres— y siembra dos flotas para probar en vivo que el
  pago de B sobre la factura de A rebota (`:5843-5847`).
- **Los dominios de estado están puestos donde se decide algo.** *Medido:* 82
  columnas `text` de estado/tipo/rol/fase; **77 con CHECK**. Las cinco sin son
  `solicitud_arco.canal` (0053:107), `evento_stripe.tipo` (0055:45),
  `liquidacion_historico.estatus` (0159:167, tabla de archivo que copia una
  columna ya validada), `envio_mensaje.canal` (tabla muerta, sustituida por
  `campana` en la 0123) y `llm_costo_mensual.fase` (DAT31-B2). Los que importan
  están y se mantuvieron: `app_user_rol_dominio` se recreó tres veces
  (`0044:22`, `0086:97`, `0105:51`) siguiendo los roles reales, y
  `mcp_oauth_codigo.rol`/`mcp_oauth_token.rol` —que la 0260 dejó sueltas a
  propósito— recibieron el suyo en `0271:120` y `:131`.
- **`tenant.config` no es un jsonb libre, y su lista de llaves está al día.**
  Cotejé las 11 llaves de `LikidaConfig` (`config.ts:24-88`) contra el
  `llaves_ok` vigente (`0085:25-27`, diez) más las dos que el CHECK resta antes
  de validar (`0278:86`: `config_tenant_valida(config - 'agentes' -
  'presupuestoLlmUsdDia')`). **Coinciden exactamente**; no sobra ni falta
  ninguna. El validador además exige la forma por dentro —`politica` array no
  vacío, `concepto` string y dentro de los mismos 9 de
  `gasto_concepto_dominio`, `topeMonto` número— con mensajes que citan la línea
  de `engine.ts` que reventaría.
- **La única vista del esquema no filtra entre flotas.** Hay **una** vista en
  las 333 (`factura_saldo`) y lleva `security_invoker = true` puesto dos veces
  (`0054:42` y de nuevo al recrearla en `0161:104`, con una advertencia de seis
  líneas de por qué no se puede omitir). El defecto que ese `alter` arregló
  está medido en el comentario: «via-tabla=1, via-vista=2».
- **El escape del trigger de inmutabilidad es transaccional, no de sesión.**
  `gasto_no_tras_liquidar()` (`0300:36-40`) se salta si
  `current_setting('likida.revision_en_curso', true) = '1'`. Fui a ver si eso
  se podía plantar desde fuera: los tres sitios que lo escriben
  (`0299:342`, `0306:161`, `0353:83`) usan `set_config(…, true)` — *local*, o
  sea que muere con la transacción — y las tres RPC que lo usan están
  `revoke all … from public, anon, authenticated` con `grant execute … to
  service_role` (`0306:297-298`), ACL que `create or replace` preserva. No hay
  ventana entre peticiones de PostgREST.
- **`gasto` tiene 14 constraints y ninguno de los obvios falta.** Piso
  (`gasto_monto_no_negativo`, 0070:41), NaN (`gasto_monto_no_nan`, 0025:104),
  dominio de concepto de 9 valores igual al de TS y al de `politica_gasto`
  (0025:87-88 y :154-155), `estado_sat`, formato de `forma_pago` y de
  `pagado_forma` (0199), rango de OCR (0146), descuento que no excede (0281),
  orden de CFDI positivo (0065), y las tres unicidades que sostienen el dedup
  (`uq_gasto_cfdi_uuid`, `uq_gasto_img_hash`, `uq_gasto_wa_message_id`).
- **Ninguna migración repite prefijo.** 333 archivos, de la 0001 a la 0356, con
  23 números ausentes (67-69, 156, 179, 200, 210-212, 220-222, 224, 249,
  252-253, 255-257, 277, 293, 295, 343) y **cero duplicados**: no hay dos
  migraciones que compitan por el mismo lugar en el orden de replay.

### Auto-refutaciones (hallazgos que abrí y maté yo mismo)

- **«`pod.lat`/`pod.lng` no tienen el `check (lat between -90 and 90)` que sí
  tiene `posicion`»** — cierto (`0047:133-134` vs `0050:59-60`), y **vacío**:
  grepeé los dos escritores de `pod` (`pod_wa.ts:82`, `operacion.ts:393`) y
  ninguno escribe `lat` ni `lng`; ningún lector las selecciona
  (`operacion.ts:329`, `auditor_cobranza.ts:578` piden `estado`/`viaje_id`).
  Columna sin escritor no tiene escenario — es la trampa que `CLAUDE.md`
  advierte.
- **«`evento_seguridad_flota.lat/lng` tampoco lo tiene»** — cierto
  (`0203:29-30`), pero el único escritor **ya valida el rango en TS**
  (`sincronizar_eventos.ts:109`: `e.lat >= -90 && e.lat <= 90`), la tabla se
  purga sola (0335) y la coordenada no alimenta ninguna cifra. Es deuda de la
  forma del rubro («lo hace la aplicación») sin consecuencia que pueda escribir
  con valores, así que no la subo a hallazgo.
- **«`desglose_peaje_linea.monto` no tiene piso y el parser acepta negativos»** —
  cierto (`0106:68`; `montoDeCelda` usa `/^-?\d+(\.\d+)?$/`,
  `intake/desglose_peaje.ts:189`), pero el negativo es **deliberado**: el
  desglose del proveedor trae renglones de devolución y el archivo es un hecho,
  no un sello (lo dice el `comment on table`, `0106:88`). Y no contamina la
  bitácora del estímulo: para llegar a `lineasCuadra` tiene que empatar con un
  `gasto.monto`, que es `>= 0` por CHECK. Un piso aquí rompería el parser.
- **«`pago_recibido` no tiene techo: los abonos pueden superar el total»** —
  cierto, y **correcto**: un sobrepago existe en la vida real y
  `factura_saldo` (`0049:113-127`) lo deriva en vez de guardarlo, precisamente
  para que no se desincronice. Poner el techo convertiría un hecho de banco en
  un error de captura.
- **«`ticket_mensaje` no tiene `tenant_id`, como `factura_viaje` antes de la
  0145»** — no es el mismo hueco: el comentario de `0051:126-127` explica que
  hereda por `EXISTS` a propósito («una segunda copia del tenant_id se puede
  desincronizar»), y la 0268 partió la policy en `hilo_lectura`/`hilo_escritura`
  con el ancla `autor_id = (select auth.uid())` (`0268:126`) que impide firmar
  por otro. El borrado en cascada llega vía `ticket_soporte`.
- **«la `0268` perdió el `not is_operador()` que la `0086` le había puesto a
  `ticket_mensaje`»** — cierto al pie de la letra, e inocuo: el rol `operador`
  salió de `app_user_rol_dominio` en `0086:97`, así que `is_operador()` no puede
  ser verdadero para nadie. Queda como texto muerto, no como permiso.

## Lo que NO alcancé a revisar

- **Nada corrió contra Postgres.** Sin base ni `.env`, ni una de las 24 pruebas
  SQL cableadas en CI ni un solo bloque de `verificaciones.sql` se ejecutó.
  Todo lo de arriba es lectura de archivos y guiones sobre el texto de las
  migraciones: cuando digo «el bloque 18 exige la lista vacía» estoy afirmando
  lo que el archivo dice que hace, no que lo haya visto ponerse rojo.
- **El interior de las 29 migraciones sin invocador en CI.** Igual que la 30 y
  la 29: leí sus `create table`, CHECK y firmas para poder contar, no su
  lógica. `procesar_jornadas_derivadas` (0325) y el lote de 2,000 acuses de la
  0337 siguen sin leerse línea por línea.
- **El alcance del dedup en las copias del predicado que la 30 dejó abiertas.**
  No crucé si `0342`/`0307` (desglose de póliza, que arman su propio
  `folioNorm` en jsonb) deduplican por viaje o por tenant. Sigue siendo el
  agujero que impide cerrar DAT30-M2 con un número en vez de con dos casos.
- **Reversibilidad, otra vez medida solo como reaplicabilidad, y solo por
  clases.** Conté los motivos mecánicos (17 `add column` sin `if not exists`,
  8 `create table` sin guarda, 21 `create index` sin guarda, 1 `drop function`
  sin `if exists`, 38 `create policy` sin su `drop policy if exists`) pero
  **no descarté a mano los falsos positivos** —muchos van precedidos de un
  `drop` del mismo nombre en la misma migración, que los vuelve reaplicables—,
  así que no publico la cifra como hallazgo: publicaría un número que no
  aguanta. Lo que sí queda verificado a mano es que `0341` sigue siendo el
  único `drop function` sin guarda de las 333.
- **Si el cuerpo que 0353 imprime coincide con PRODUCCIÓN.** Sin acceso a la
  base, sigue sin poder comprobarse; la 30 verificó que coincide con lo que el
  *repo* dice, que es otra cosa.
- **Los triggers como conjunto.** Leí `gasto_no_tras_liquidar` y el
  `constraint trigger` diferido de la revisión, no los ~40 restantes. Un
  trigger que sustituye a un CHECK es, para este rubro, una restricción con
  menos garantías (se puede deshabilitar con `alter table … disable trigger`,
  cosa que un CHECK no admite), y no medí cuántas invariantes del esquema
  dependen de uno.
