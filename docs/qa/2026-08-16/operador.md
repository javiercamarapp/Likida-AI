# QA autónomo — corrida del agente Operador — 2026-08-16

Fase 1 del ejército de QA (encargo-fase-1). Tenant sintético `ZZZ QA`
(`aaaaaaaa-0000-4000-8000-000000009901`) sobre el proyecto único de Supabase, con guard `ZZZ %`
antes de todo borrado en lote. El LLM explora, el código juzga: cada estado de
esta tabla lo decidió una función pura leyendo la base — nunca un modelo.

```
INVARIANTE                                    ESTADO  REPRO  SEVERIDAD
#1  anticipo − gastos = diferencia            ⚠️       4/6    CRÍTICO (intermitente en texto_sin_fotos 2/3)
#3  un comprobante = un gasto (dedup)         ✅       3/3    —
#4  ticket post-cierre → huérfanos            ✅       3/3    —
#5  ninguna cifra sin fuente                  ✅       6/6    —
#8  bitácora registró lo ocurrido             ✅       12/12    —
```

Reproducibilidad N/N = repeticiones de la MISMA semilla con el mismo veredicto.
Un ⚠️ intermitente se reporta con su conteo, no se oculta (diseño §3).

## Ataques

### foto_duplicada

- **Semilla**: `2026-08-16|nivel3|operador|foto_duplicada|0` → seed mulberry32 `3682408797` (misma semilla en las 3 repeticiones)
- **Invariantes que dispara**: #3 dedup, #8 bitacora
- **Datos sembrados**: anticipo $10600.00, viaje `ZZZQA-V-477674` + `ZZZQA-V-383081`, tickets $1196.47 (2026-08-16, ZZZQA-674980)

| rep | oráculo | estado | esperado | real |
|---|---|---|---|---|
| 1 | dedup_comprobante (#3) | ✅ ok | rechazo con 'duplicate key value' contra uq_gasto_img_hash | 23505: duplicate key value violates unique constraint "uq_gasto_img_hash" |
| 1 | bitacora_registro (#8) | ✅ ok | ["foto.ya_en_otro_viaje"] | los 1 eventos esperados se emitieron (4 eventos capturados en total) |
| 2 | dedup_comprobante (#3) | ✅ ok | rechazo con 'duplicate key value' contra uq_gasto_img_hash | 23505: duplicate key value violates unique constraint "uq_gasto_img_hash" |
| 2 | bitacora_registro (#8) | ✅ ok | ["foto.ya_en_otro_viaje"] | los 1 eventos esperados se emitieron (2 eventos capturados en total) |
| 3 | dedup_comprobante (#3) | ✅ ok | rechazo con 'duplicate key value' contra uq_gasto_img_hash | 23505: duplicate key value violates unique constraint "uq_gasto_img_hash" |
| 3 | bitacora_registro (#8) | ✅ ok | ["foto.ya_en_otro_viaje"] | los 1 eventos esperados se emitieron (2 eventos capturados en total) |

- Costo real: rep1 $0.0025 · rep2 $0.0016 · rep3 $0.0025
- Evidencia: `docs/qa/2026-08-16/evidencia/operador/foto_duplicada-rep1` · `docs/qa/2026-08-16/evidencia/operador/foto_duplicada-rep2` · `docs/qa/2026-08-16/evidencia/operador/foto_duplicada-rep3`

### post_cierre

- **Semilla**: `2026-08-16|nivel3|operador|post_cierre|0` → seed mulberry32 `3556574581` (misma semilla en las 3 repeticiones)
- **Invariantes que dispara**: #4 huerfano_post_cierre, #8 bitacora
- **Datos sembrados**: anticipo $11100.00, viaje `ZZZQA-V-998268`, tickets $1076.80 (2026-08-13, ZZZQA-687777)

| rep | oráculo | estado | esperado | real |
|---|---|---|---|---|
| 1 | huerfano_post_cierre (#4) | ✅ ok | liquidación intacta + huérfano visible + trigger CU001 | liquidación sin cambio; huérfano pendiente con monto; CU001: el viaje 0db2f417-3a19-4e04-b6d3-b0dd553f790f ya tiene liquidación emitida: el gasto llegó tarde |
| 1 | bitacora_registro (#8) | ✅ ok | ["huerfano.guardado"] | los 1 eventos esperados se emitieron (1 eventos capturados en total) |
| 2 | huerfano_post_cierre (#4) | ✅ ok | liquidación intacta + huérfano visible + trigger CU001 | liquidación sin cambio; huérfano pendiente con monto; CU001: el viaje 559d1676-9904-4583-ad02-b0edbb345cae ya tiene liquidación emitida: el gasto llegó tarde |
| 2 | bitacora_registro (#8) | ✅ ok | ["huerfano.guardado"] | los 1 eventos esperados se emitieron (1 eventos capturados en total) |
| 3 | huerfano_post_cierre (#4) | ✅ ok | liquidación intacta + huérfano visible + trigger CU001 | liquidación sin cambio; huérfano pendiente con monto; CU001: el viaje dde3790a-6386-4a9c-bcfd-3b3cf7a5e966 ya tiene liquidación emitida: el gasto llegó tarde |
| 3 | bitacora_registro (#8) | ✅ ok | ["huerfano.guardado"] | los 1 eventos esperados se emitieron (1 eventos capturados en total) |

- Costo real: rep1 $0.0017 · rep2 $0.0017 · rep3 $0.0017
- Evidencia: `docs/qa/2026-08-16/evidencia/operador/post_cierre-rep1` · `docs/qa/2026-08-16/evidencia/operador/post_cierre-rep2` · `docs/qa/2026-08-16/evidencia/operador/post_cierre-rep3`

### texto_sin_fotos

- **Semilla**: `2026-08-16|nivel3|operador|texto_sin_fotos|0` → seed mulberry32 `3671386848` (misma semilla en las 3 repeticiones)
- **Invariantes que dispara**: #1 cuadre_balancea (no debe cerrar), #5 cifras_con_fuente, #8 bitacora
- **Datos sembrados**: anticipo $10600.00, viaje `ZZZQA-V-442947`, tickets (ninguno), textos: «ya subí todo»

| rep | oráculo | estado | esperado | real |
|---|---|---|---|---|
| 1 | cuadre_balancea (#1) | ❌ fallo | sin liquidación (no debe cerrar sin comprobantes) | {"total_comprobado":0,"diferencia":10600,"estatus":"con_diferencias"} |
| 1 | cifras_con_fuente (#5) | ✅ ok | toda cifra respaldada por DB/escenario/chofer (o blanco/derivada) | 2 mensajes verificados, 0 cifras huérfanas |
| 1 | bitacora_registro (#8) | ✅ ok | ["agent.run"] | los 1 eventos esperados se emitieron (6 eventos capturados en total) |
| 2 | cuadre_balancea (#1) | ❌ fallo | sin liquidación (no debe cerrar sin comprobantes) | {"total_comprobado":0,"diferencia":10600,"estatus":"con_diferencias"} |
| 2 | cifras_con_fuente (#5) | ✅ ok | toda cifra respaldada por DB/escenario/chofer (o blanco/derivada) | 2 mensajes verificados, 0 cifras huérfanas |
| 2 | bitacora_registro (#8) | ✅ ok | ["agent.run"] | los 1 eventos esperados se emitieron (6 eventos capturados en total) |
| 3 | cuadre_balancea (#1) | ✅ ok | sin liquidación (no debe cerrar) | sin liquidación |
| 3 | cifras_con_fuente (#5) | ✅ ok | toda cifra respaldada por DB/escenario/chofer (o blanco/derivada) | 1 mensajes verificados, 0 cifras huérfanas |
| 3 | bitacora_registro (#8) | ✅ ok | ["agent.run"] | los 1 eventos esperados se emitieron (2 eventos capturados en total) |

- Costo real: rep1 $0.0169 · rep2 $0.0125 · rep3 $0.0208
- Evidencia: `docs/qa/2026-08-16/evidencia/operador/texto_sin_fotos-rep1` · `docs/qa/2026-08-16/evidencia/operador/texto_sin_fotos-rep2` · `docs/qa/2026-08-16/evidencia/operador/texto_sin_fotos-rep3`

### borde_tope

- **Semilla**: `2026-08-16|nivel3|operador|borde_tope|0` → seed mulberry32 `2964908642` (misma semilla en las 3 repeticiones)
- **Invariantes que dispara**: #1 cuadre_balancea, #5 cifras_con_fuente, #8 bitacora
- **Datos sembrados**: anticipo $13900.00, viaje `ZZZQA-V-805897`, tickets $4001.00 (2026-08-16, ZZZQA-357210) · $3999.00 (2026-08-16, ZZZQA-309807), textos: «listo»

| rep | oráculo | estado | esperado | real |
|---|---|---|---|---|
| 1 | cuadre_balancea (#1) | ✅ ok | anticipo − comprobado = diferencia (y recalculado coincide) | {"totalComprobado":8000,"totalAnticipo":13900,"diferencia":5900} |
| 1 | cifras_con_fuente (#5) | ✅ ok | toda cifra respaldada por DB/escenario/chofer (o blanco/derivada) | 3 mensajes verificados, 0 cifras huérfanas |
| 1 | bitacora_registro (#8) | ✅ ok | ["agent.run"] | los 1 eventos esperados se emitieron (8 eventos capturados en total) |
| 2 | cuadre_balancea (#1) | ✅ ok | anticipo − comprobado = diferencia (y recalculado coincide) | {"totalComprobado":8000,"totalAnticipo":13900,"diferencia":5900} |
| 2 | cifras_con_fuente (#5) | ✅ ok | toda cifra respaldada por DB/escenario/chofer (o blanco/derivada) | 3 mensajes verificados, 0 cifras huérfanas |
| 2 | bitacora_registro (#8) | ✅ ok | ["agent.run"] | los 1 eventos esperados se emitieron (8 eventos capturados en total) |
| 3 | cuadre_balancea (#1) | ✅ ok | anticipo − comprobado = diferencia (y recalculado coincide) | {"totalComprobado":8000,"totalAnticipo":13900,"diferencia":5900} |
| 3 | cifras_con_fuente (#5) | ✅ ok | toda cifra respaldada por DB/escenario/chofer (o blanco/derivada) | 3 mensajes verificados, 0 cifras huérfanas |
| 3 | bitacora_registro (#8) | ✅ ok | ["agent.run"] | los 1 eventos esperados se emitieron (8 eventos capturados en total) |

- Costo real: rep1 $0.0125 · rep2 $0.0187 · rep3 $0.0123
- Evidencia: `docs/qa/2026-08-16/evidencia/operador/borde_tope-rep1` · `docs/qa/2026-08-16/evidencia/operador/borde_tope-rep2` · `docs/qa/2026-08-16/evidencia/operador/borde_tope-rep3`

## Gasto de la corrida (real, del ledger)

```
Corrida 2026-08-16: $0.2411 de $2 tope
    google/gemini-3.1-flash-lite             $0.0368
    anthropic/claude-sonnet-5                $0.2043
```

Total: $0.2411 USD de $2 de tope. Los mensajes de
WhatsApp salieron por el cliente Meta FALSO del arnés (número de prueba de Meta:
un chofer externo no puede escribir) — no hay gasto real de mensajería.

## Limpieza del tenant

✅ tenant `ZZZ QA` borrado (cascada) y verificado en 0 filas en operador, viaje, gasto, liquidacion, comprobante_huerfano, wa_conversacion y llm_costo; 0 claims `ZZZQA-*`.
- storage/comprobantes: 13 objetos borrados
- storage/liquidaciones: 10 objetos borrados
