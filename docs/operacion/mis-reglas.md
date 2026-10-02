# Agente 13 — «Mis reglas»

> Estado (2-oct-2026, rama `loop/w3-buzon-cobranza-reglas`): **cerrado en código, no en campo.**
> Lo que depende de Meta (plantilla `regla_aviso_v1` aprobada, número real) y de un
> destinatario real capturado vive en «Bloqueos externos».

## Qué hace

El dueño o el contador escribe en español «avísame si una unidad sale a viaje sin póliza
vigente» y Likida lo vigila. **El modelo traduce UNA vez** a una de las **10 plantillas
cerradas** de `src/lib/likida/reglas/catalogo.ts`; lo guardado es la estructura
(`regla_vigilancia.plantilla` + `params`), nunca el texto. Quien vigila después es SQL
(`lectores.ts`), sin IA.

| # | Plantilla | Canal del aviso |
|---|-----------|-----------------|
| 1 | `unidad_sin_papel_vigente_al_despachar` | operación (jefe de tráfico) |
| 2 | `gasto_de_concepto_mayor_a` | dinero (dueño/contador) |
| 3 | `gasto_sin_cfdi_mayor_a` | dinero |
| 4 | `chofer_con_viajes_sin_liquidar` | operación |
| 5 | `documento_por_vencer` | operación |
| 6 | `factura_sin_cobrar_mas_de` | dinero |
| 7 | `estadia_mayor_a` | operación |
| 8 | `incidencia_abierta_mas_de` | operación |
| 9 | `viaje_abierto_sin_comprobantes_mas_de` | operación |
| 10 | `costo_ia_dia_mayor_a` | plataforma (superadmin) |

## El ciclo, eslabón por eslabón (criterio a–i)

| | Eslabón | Dónde |
|---|---|---|
| a | Entrada | `/dashboard/reglas` (frase ≤ 400 caracteres, o elegir la vigilancia a mano sin modelo). |
| b | Lógica | `traductor.ts` (una llamada, rol `extraccion`, presupuesto por flota) → `catalogo.ts` valida y arma la frase; `lectores.ts` evalúa. |
| c | Persistencia | `regla_vigilancia` (0229), `regla_disparo` (sello anti-spam por objeto y ciclo), **`regla_aviso` (0520, historial de avisos)**. RLS deny-all + `service_role`; FK compuesta (una flota no cuelga de otra). |
| d | Salida | **`enviarConFallback`** (`lib/meta/enviar_con_fallback.ts`): texto con la ventana de 24 h abierta, plantilla **`regla_aviso_v1`** con ella cerrada. Verificado: ya no se usa `sendText` a secas. |
| e | Cron | `vigilarReglas` dentro del cron `escalar` (cada hora). «Claim» = la llave en `regla_disparo` (**0660**): se **reclama** antes de mandar (`enviando` + token + arriendo de 5 min), se manda y se **confirma** (`enviado`). Dos corridas solapadas no mandan el mismo aviso: quien pierde el insert de la llave no manda. Si Meta rechaza o el envío lanza, la llave se **libera** y el caso se reintenta; si la corrida muere a media, el arriendo vence y otra la retoma. Sin la 0660 en la base cae al orden anterior (manda primero, sella después). |
| f | UI | Tarjeta por regla: confirmar, pausar/reanudar, borrar (diálogo único), **historial de avisos y límite de frecuencia** (toasts/estados del sistema D2). |
| g | Pruebas | Ver abajo. |
| h | Integración externa | Solo WhatsApp (Meta) y el modelo (OpenRouter), ambos detrás de interfaces probadas con dobles. |
| i | Documentación | Este archivo. |

## La confirmación humana la exige la base

`regla_vigilancia_activa_confirmada` (CHECK, 0229): una regla no sale de `pendiente` sin
`confirmada_por` y `confirmada_en`, ni por un UPDATE directo. El camino normal
(`confirmarRegla`) va anclado por `id + estado='pendiente'`: dos clics no re-firman. El
barrido solo lee reglas `activa`.

## Nuevo en la 0520: límite de frecuencia por regla

Cada regla trae dos topes (por omisión **4 avisos / 24 h** y **1 h** de separación):

* `max_avisos_dia` (1–24): avisos máximos en una ventana móvil de 24 h.
* `min_horas_entre_avisos` (0–168): separación mínima desde el último aviso.

Solo cuentan los avisos **enviados** (Meta aceptó); un fallido no consume cupo. **Lo
pospuesto no se pierde**: no se sella, el caso sigue siendo «nuevo» y sale agrupado en el
siguiente aviso permitido (`frecuencia.ts`, puro). El resultado del barrido trae
`diferidas`. Si el historial no se puede leer la regla falla por su lado (no se manda a
ciegas).

## Historial de disparos

`regla_aviso`: una fila por intento (enviado/fallido, casos, canal `texto|botones|plantilla`,
motivo del selector o error de Meta en palabras). La pantalla enseña los últimos 10 avisos
y las últimas 10 evidencias de cada regla. **Retención: 365 días**, borrado en el mismo
barrido que escribe (`purgarAvisosViejos`).

## Pruebas

* `reglas/frecuencia.test.ts` — el tope diario, la separación, los futuros, los rangos.
* `reglas/vigilante.test.ts` — mandar primero/sellar después, canal por rol, frecuencia,
  historial, aislamiento entre reglas.
* `reglas/repo.test.ts` — filas ilegibles, transiciones ancladas, historial, retención.
* `reglas/plantillas_aviso.test.ts` — **las 10 plantillas** hasta el mensaje a Meta con el
  selector REAL (ventana abierta → texto con frase y evidencia; cerrada → `regla_aviso_v1`
  con 3 parámetros), al destinatario de su canal.
* `reglas/e2e_ciclo_completo.test.ts` — **E2E del ciclo**: frase → interpretar → pendiente
  (no vigila) → confirmación humana → barrido con lector real → aviso por plantilla →
  sello + historial + bitácora. Casos: feliz, ventana abierta, duplicado (misma regla
  dos veces; doble confirmación; mismo caso en la siguiente corrida), fuera de orden
  (pausar/reanudar), fallo de Meta (no sella, reintenta), sin teléfono, modelo caído,
  **otro tenant** (confirmar/pausar/borrar/frecuencia ajenos fallan; cada flota avisa a su
  teléfono), y el límite de frecuencia de punta a punta.
* `supabase/tests/0520_reglas_frecuencia.sql` (ci-postgres) — el CHECK de confirmación,
  rangos, coherencia canal↔resultado, FK compuesta, cascade y RLS contra Postgres real.

## Bloqueos externos

* Aprobación de Meta de `regla_aviso_v1` (texto ES-MX sin verificar contra Meta; ver
  `docs/operacion/plantillas-meta.md`) y número/WABA real. Sin ellas, fuera de la ventana
  de 24 h el aviso falla y se reintenta cada hora **sin consumir cupo ni sello**.
* Teléfono del jefe de tráfico y del contacto de dinero capturados (sin ellos la regla
  falla por su lado y lo dice en el log).
* Llave del modelo de la flota en producción y presupuesto de IA por flota.

## Pendientes reales (no se hicieron)

* `regla_disparo` (sellos con la cita de la evidencia, que puede nombrar a un operador) no
  tiene purga por edad ni entra aún en la cancelación ARCO de un operador: se purgaría en
  una ola de retención.
* La traducción por modelo se prueba con un doble: no hay eval real del LLM sobre frases
  reales (sin banco de frases).
* El render de la pantalla no se vio en un navegador (solo pruebas de página y de
  componentes).

## Reclamo antes de enviar (0660, P9)

* **Qué cierra:** la carrera de dos corridas del cron (Vercel entrega *at-least-once*) que leían los mismos casos nuevos y ambas mandaban el WhatsApp porque el sello llegaba después del envío.
* **Cómo:** `reclamar_disparos_regla` inserta las llaves `(regla, objeto, ciclo)` como `enviando`; solo gana las que no existían (o cuyo arriendo venció). `confirmar_disparos_regla` las pasa a `enviado` solo con el token vigente; `liberar_disparos_regla` borra las del token cuando Meta rechazó.
* **Orden:** primero la frecuencia y el teléfono (lo pospuesto o sin destinatario no reclama nada), luego el reclamo, luego Meta.
* **Límite conocido:** el límite de frecuencia se evalúa antes del reclamo; dos corridas con casos DISTINTOS podrían pasar ambas por el chequeo y mandar dos avisos en la misma hora. No duplica casos; solo puede rozar el tope diario por uno.
* **Arriendo perdido:** si el envío tarda más de 5 minutos y otra corrida retoma la llave, el aviso puede salir dos veces; la corrida lo deja en el log (`reglas.arriendo_perdido_al_confirmar`).
* **Pruebas:** `supabase/tests/0660_reglas_reclamo.sql` + `0660_reglas_reclamo_concurrencia.sh` (8 sesiones reales), bloque 305 de `verificaciones.sql`, `reglas/vigilante.test.ts` (dos corridas solapadas) y los e2e con las RPC en memoria (`reclamo_en_memoria.fixture.ts`).
