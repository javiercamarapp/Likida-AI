# Retención de datos personales — tabla dato → tabla → plazo → purga

**Cómo se construyó:** no es una promesa, es una lectura del código. Cada
fila del bloque "con purga real" viene de `mantenimiento_de_datos`
(`supabase/migrations/0258_purga_satelites_prospecto.sql:231-315`, la
definición vigente al 1-sep-2026) — si esa función cambia, esta tabla debe
cambiar con ella. Cada fila del bloque "sin purga" se verificó por su
ausencia: `grep` de la tabla contra el cuerpo de esa función. Regla del
repo (CLAUDE.md): un plazo que no ejecuta ningún código no se declara como
si lo hiciera — por eso hay dos bloques, no uno con una columna optimista.

## Con purga automática (verificada en `mantenimiento_de_datos`)

| Dato | Tabla | Plazo | Función de purga |
|---|---|---|---|
| Registro técnico de mensajes de WhatsApp ya procesados | `wa_mensaje_procesado` | 30 días | `purgar_wa_mensaje_procesado` |
| Peticiones a la API (idempotencia) | `api_idempotencia` | 7 días | `purgar_api_idempotencia` |
| Intake de correo ya procesado | `correo_procesado` | 90 días | `purgar_correo_procesado` |
| Historial de corridas de los agentes | `agente_corrida` | 180 días | `purgar_agente_corrida` |
| Estado de conversación de WhatsApp sin actividad | `wa_conversacion` | 180 días | `purgar_wa_conversacion` |
| Códigos de facturación que nunca encontraron su comprobante | `codigo_pendiente` | 180 días | `purgar_codigo_pendiente` |
| Prospecto: nombre, puesto, correo, teléfono | `prospecto_persona` (+ correos, piezas, dossiers, toques) | 365 días | `purgar_prospecto_persona` |
| Evento comercial del prospecto (anonimiza, no borra la fila) | `comercial_evento` | 365 días | `purgar_comercial_evento` |
| Eventos de WhatsApp pendientes de procesar | `wa_evento_pendiente` | 30 / 90 días (dos etapas) | `purgar_wa_evento_pendiente` |
| **Posición GPS de la unidad** (poller y pin del chofer) | `posicion` | 90 días | `purgar_posicion` |
| Costo de LLM por llamada (se consolida antes) | `llm_costo` | 13 meses | `purgar_llm_costo` |
| Bitácora de auditoría | `bitacora_auditoria` | 365 días | `purgar_bitacora_auditoria` |
| Contacto de cobranza | `cobranza_contacto` | 180 días | `purgar_cobranza_contacto` |
| Archivo de Storage huérfano (sin gasto que lo respalde) | Storage (marcado en `storage_huerfano_candidato`) | 7 días desde que se marca | `limpiar_storage_huerfano` |
| Fotos de comprobantes que SÍ respaldan un gasto | Storage (bucket `comprobantes`) | **No se borran** — CFF art. 30 obliga a conservarlas ≥5 años; la cancelación ARCO las desliga del titular, no las elimina | El ejecutor ARCO (`ejecutar_arco_cancelacion`), no `mantenimiento_de_datos` |

## Sin purga (hueco medido — dueño del código: `datos`, salvo donde se anota otro)

| Dato | Tabla / columna | Lo que el aviso dice hoy | Estado real | Hallazgo |
|---|---|---|---|---|
| Coordenadas del pin de asistencia | `incidencia.lat`, `incidencia.lng` | El aviso dice "90 días" para la ubicación del chat (`privacidad.ts`, categoría GPS) | `anclarUbicacionIncidencia` las escribe y ninguna purga las toca | LEG-6 (dueño: `datos`) |
| Texto libre del reporte de un evento | `incidencia_evento.detalle` | — | Sin purga | LEG-6 (dueño: `datos`) |
| Eventos de cámara/telemetría (todos, no solo los graves) | `evento_seguridad_flota` | Antes de esta auditoría: ningún aviso los mencionaba (LEG-3, cerrado en este ciclo — ver `avisoIntegral` en `privacidad.ts`). El aviso ahora declara la categoría y su finalidad, **sin prometer un plazo de borrado**, precisamente porque esta fila sigue sin purga | Sin purga; `sincronizar_eventos.ts` guarda TODO evento reportado, no solo los `grave` | LEG-3 (texto, cerrado por `legal`) / purga pendiente (dueño: `datos` o quien tome `conectores/`) |
| Registro de jornada laboral derivado del GPS | `jornada_dia`, `jornada_asiento` | Sin plazo declarado | Sin purga | LEG-6 (dueño: `datos`) |
| Contacto de emergencia del operador (nombre, teléfono, parentesco de un familiar) | `contacto_emergencia` | Antes de esta auditoría: 0 menciones. El aviso integral ahora lo declara (LEG-8, cerrado en este ciclo) | Sin purga; no se borra al dar de baja al operador | LEG-8 (texto, cerrado por `legal`) / purga pendiente (dueño: `datos`) |
| Parte de incidente hacia la bandeja de aprobación de Likida — incluye descripción cruda (con datos de salud) y teléfonos de contactos de emergencia | `cola_aprobacion` (tipo `parte_incidente`) | El aviso dice "se guarda para escalarlo a tu empresa" (categoría salud) | Sin purga (la única purga de `cola_aprobacion` es para piezas de tipo `correo_frio`/`correo_seguimiento`, 0258:188); no entra al alcance de la cancelación ARCO | LEG-5 — **NO CERRADO por `legal`**: el código vive en `src/lib/likida/agentes/direccion.ts` y `cola.ts`, fuera de los archivos asignados a este agente. Ver `CIERRE.md` para el diff propuesto (dueño: `agentes`) |
| Mensajes de tickets de soporte | `ticket_mensaje` | — | Sin purga (0 filas en prod al medir, 28-ago-2026) | LEG-6 (dueño: `datos`) |

## Nota sobre `posicion` vs. la señal declarada del aviso

`posicion` sí purga a 90 días — eso lo verifica esta tabla y coincide con lo
que `avisoIntegral()` declara. El hallazgo LEG-1 (compuerta de aviso antes de
la PRIMERA escritura del poller de GPS/cámara) es otro tema: aquí se
documenta CUÁNTO tiempo se conserva un dato ya escrito, no si se debió
escribir sin aviso previo. LEG-1 es de `datos`, no de este documento.

## Cómo se mantiene esta tabla al día

Si `mantenimiento_de_datos` gana o pierde una llamada `purgar_*`, esta tabla
tiene que reflejarlo en el mismo cambio — igual que `docs/legal/
PENDIENTES-ABOGADO.md` para lo contractual. No hay una prueba automática que
lo vigile todavía (candidato para quien posea `supabase/migrations/` y
`mantenimiento_de_datos`): comparar las llamadas `purgar_*` del cuerpo de la
función contra las filas de este archivo.
