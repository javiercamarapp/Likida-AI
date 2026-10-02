# Vigía de servicio al cliente (Agente 4)

Atiende por WhatsApp a los **clientes** de la flota (quien espera su carga): clasifica
lo que preguntan, contesta con datos reales del viaje, el gerente aprueba con un
toque, y lo molesto o sin respuesta escala por niveles. Migraciones `0400` y `0401` (base), `0481`-`0482` (costo de IA propio y
adjuntos), `0484` (grupos críticos, histórico exportado y alertas) y `0647` (respuestas rápidas aprobadas). Estado al 2-oct-2026:
construido y probado con dobles; **ninguna de esas migraciones está aplicada en la base real** (ver «Puesta en marcha»).

Antes de este agente, un número que no era chofer, oficina ni proveedor recibía
«no te tengo registrado como operador». Esa regla **se conserva** para cualquier
número que la flota no haya autorizado.

## El camino de un mensaje

```
cliente ──► webhook (idempotencia por wamid, kill switch global, ventana 24 h)
        ──► processor: ¿chofer? ¿oficina? ¿proveedor? ── no ──► atenderMensajeCliente
                                                                │ no está autorizado → «no te tengo registrado» (como siempre)
                                                                ▼
   vigia_recibir_mensaje (RPC atómica: hilo + mensaje, dedupe por wamid, reloj del SLA)
        ──► spam / hilo en manos de una persona → solo se registra
        ──► clasificar (reglas → modelo barato `vigia_cliente`) → molestia → viaje del propio cliente
        ──► borrador con datos reales (o «lo consulto» + escalamiento)
        ──► política: ¿autoenviar o aprobar?
        ──► gerente: Enviar / No enviar / Yo me encargo (botones; plantilla fuera de 24 h)
        ──► enviarAlCliente (consentimiento, baja, 24 h → plantilla)
cron /api/cron/vigia (cada minuto): SLA → nivel 1 (responsable) → nivel 2 (dueño); cada 5 min además: atorados, ciclos muertos, retención
```

Código: `src/lib/likida/vigia/` (`servicio.ts` orquesta; `repo.ts` es el único acceso a datos).
Tablero: `/dashboard/agentes/vigia`. Cron: `/api/cron/vigia` (`* * * * *`).

## Qué garantiza (y dónde está probado)

| Garantía | Dónde |
|---|---|
| Solo contesta a contactos autorizados con constancia de consentimiento; un número activo = una flota | `0400` (índice único parcial, CHECK) · `supabase/tests/0400_vigia_cliente.sql` |
| El tenant y el cliente salen del contacto autorizado, nunca del texto; folio de otro cliente → «no encuentro ese folio», sin confirmar ni negar | `estatus_viaje.test.ts`, `servicio.test.ts` (AISLAMIENTO), `repo.test.ts` |
| Toda consulta lleva `tenant_id`; las dos que cruzan flotas (número del webhook, barrido del cron) están rotuladas | `repo.test.ts` (cliente grabador) |
| Cada cifra de una respuesta sale de un dato; sin dato → «lo consulto» y escala | `redactor.test.ts`, `servicio.test.ts` |
| Prompt injection: el modelo ni ve el texto con intento de manipulación, emite solo un enum, nunca se autoenvía, queda en bitácora | `entrada.test.ts`, `clasificador.test.ts`, `servicio.test.ts` |
| Duplicados y carreras: un wamid = un mensaje; una respuesta del agente por entrante; un envío por aprobación | `supabase/tests/0400_vigia_concurrencia.sh`, `servicio.test.ts` |
| Fuera de 24 h solo plantilla del catálogo; sin consentimiento o con BAJA no se envía | `enviar.test.ts` |
| Escalera por niveles con sello anti-repetición (`vigia_evento.clave`) | `escalamiento.test.ts`, `servicio.test.ts` (barrido) |
| La cola del barrido no se tapa: lo que llegó al nivel 2 no entra, se ordena por próximo vencimiento y una flota con plazo largo no tapa a otra con plazo corto; los ciclos muertos (7 días) se cierran | `cola_barrido.test.ts`, `repo.test.ts` |
| Una respuesta rápida solo reemplaza al «no entendí», nunca se autoenvía y no se pule con modelo; una por pregunta y flota, tope de 200 | `respuestas_rapidas.test.ts`, `ciclo_completo.e2e.test.ts` · `supabase/tests/0647_vigia_respuesta_rapida.sql` |
| Retención y ARCO (supresión) | `0400` (`vigia_purgar`, `vigia_suprimir_contacto`) · SQL test · `repo.test.ts` |

## Puesta en marcha para una flota

1. Aplicar `0400`, `0401`, `0481`, `0482`, `0484` y `0647` (la compuerta de despliegue exige migraciones antes de `[deploy]`; sin la 0484 no hay grupos, histórico ni plazo crítico, y sin la 0647 no hay respuestas rápidas: el Vigía contesta como siempre).
2. Plantillas de Meta: aprobar `vigia_respuesta_cliente_v1`, `vigia_aprobacion_v1` y
   `vigia_escalamiento_v1` (texto exacto en `docs/operacion/plantillas-meta.md`). Sin ellas
   todo funciona **dentro** de la ventana de 24 h; fuera, el envío se rechaza y queda como fallido.
3. Dueño de la flota, en `/dashboard/agentes/vigia`:
   - dar de alta a los clientes en «Clientes autorizados» (WhatsApp + casilla de consentimiento);
   - «Configuración y SLA»: SLA de respuesta, tiempo para avisar al dueño, retención, liga de su
     aviso de privacidad, y **encender** el Vigía (apagado por omisión: sin fila o apagado = silencio).
4. Registrar el teléfono del gerente (`app_user.telefono`) o asignar un responsable por cliente.
5. Dejar el modo en **Siempre aprobar** hasta tener evidencia; después, si se quiere, pasar a
   «Autoenviar solo preguntas de bajo riesgo ya validadas» (cada tipo de pregunta se gana tras N
   aprobaciones sin editar).

## Lo que el Vigía le dice al cliente (y de dónde sale)

- **Hora de llegada**: sale de la cita o la ETA que el Conductor guarda en el viaje (la cita manda sobre la ETA; `desde_conductor.ts`).
  Dice que es la cita capturada, **no GPS**. Sin cita ni ETA contesta «lo consulto» y **escala al gerente**: no inventa una hora.
- **Dónde va**: el último hito que el operador reportó, con su hora, y si sigue en el andén; es la hora del mensaje del chofer, no
  telemetría, y el texto lo dice. Si la flota tiene posición en `posicion` agrega el último punto con su antigüedad; si no, dice que no la tiene.
- **Documentos**: hoy solo el POD es comprobable; los demás no se inventan.
- **POD adjunto (0482)**: si el POD existe, la respuesta lo lleva, con tres reglas: nunca sin aprobación del gerente (el borrador con
  adjunto es de riesgo medio y muestra «adjuntará: POD»); solo dentro de la ventana de 24 h (si el texto salió como plantilla el archivo no
  sale, queda un evento `adjunto_pendiente` a la vista del gerente); y solo el POD de un viaje de ESE cliente (URL firmada de 10 min). Si el archivo ya no existe o
  Meta lo rechaza queda `adjunto_fallo` y el texto sale igual; el doble toque manda un solo texto y un solo documento.

## Grupos críticos, molestia y la alerta de 10 minutos (0484)

- Cada cliente puede tener **grupos** (`vigia_grupo`) y marcar algunos como **críticos**. Un cliente con algún grupo crítico se atiende con el
  plazo corto `sla_critico_min` (10 por omisión; se aplica el menor entre este y `sla_respuesta_min`).
- **Molestia**: `molestia_aviso_nivel` (2 o 3, por omisión 2) decide desde qué nivel de molestia se avisa al gerente responsable; el nivel 3 siempre sube
  también al dueño. Una queja nunca se autoenvía y «Yo me encargo» detiene al agente en ese hilo.
- **Lo que NO hace**: leer un grupo de WhatsApp **en vivo**. Eso depende de la API de grupos de Meta (elegibilidad y alta del WABA) y no está simulado:
  la API de Business no lee los grupos de un WhatsApp común. Hoy el grupo se alimenta del **histórico exportado**; el camino en vivo exige que los
  grupos críticos migren a un número Business. Verificar la API de grupos de Meta antes de prometer grupos en vivo.
- **Copiloto**: el agente solo sugiere; un humano aprueba y envía. Ningún flujo depende de leer grupos.

## Histórico exportado → preguntas frecuentes y tendencias (0484)

Pantalla `/dashboard/agentes/vigia/historial`. Se sube el `.txt` de «Exportar chat» de WhatsApp o el `.zip` que lo trae (iOS y Android, varios
formatos de fecha; máx. 50,000 mensajes por importación y 1,500 caracteres por mensaje).

- **Privacidad** (datos de clientes finales): el autor nunca se guarda en claro, solo un hash corto con sal de la flota; los teléfonos y correos
  escritos dentro del texto se tapan antes de guardar; las líneas de sistema y lo multimedia omitido se descartan y el reporte lo cuenta.
  Se purga con la misma retención del Vigía (`vigia_historial_purgar`). La misma exportación (huella sha256) no entra dos veces al mismo grupo.
- **Qué calcula** (determinista, sin modelo): temas (ubicación, hora de llegada, documentos, factura/POD, citas y andén, tarifas, quejas, pide hablar
  con alguien y «otros»), preguntas frecuentes con lo que el **equipo** contestó de verdad, tendencia semanal por tema contra las 4 semanas previas y
  tiempos de respuesta contra el umbral. Lo que ninguna regla reconoce es «otros»; no se inventa un tema.
- Las respuestas típicas no se publican solas: el gerente las **aprueba** y pasan a ser respuestas rápidas (siguiente sección). El reporte baja a Excel/PDF.

## Lo que NO existe todavía (dicho sin adornos)

- **Coexistencia de WhatsApp** (que los chats de servicio que la flota ya tiene en su número lleguen
  a Likida): no hay código; depende de Meta y del número real de la flota.
- **Otros documentos** además del POD (factura, carta porte): el Vigía dice el estado y avisa al gerente; no los adjunta.
- **Respaldo por correo** cuando la plantilla no está aprobada o la ventana está cerrada, y lista de directores por nivel en lugar de un solo teléfono (paquete P14, necesita Resend).
- **Aviso de privacidad para clientes finales**: el texto legal no existe en Likida (el aviso integral
  cubre choferes). La liga configurable y la primera respuesta (que explica el asistente, la liga y la
  baja con BAJA) están listas; el documento lo redacta legal. **Antes de cualquier uso con clientes finales.**
- **Solicitud ARCO de un cliente por WhatsApp**: `PRIVACIDAD` registra la solicitud a nombre de su
  flota; la supresión de sus chats la ejecuta el dueño desde su fila en el tablero.

## Respuestas rápidas aprobadas (0647)

El reporte del histórico (`/dashboard/agentes/vigia/historial`) calcula las preguntas frecuentes y lo que el equipo suele contestar.
Desde ahí, el dueño o el encargado **aprueba** (y puede corregir) la respuesta de una pregunta: queda guardada con la pregunta que
la originó. Cuándo se usa:

- Solo cuando el cliente escribe algo que el Vigía **no entendió** («otro») y se parece a una pregunta aprobada (mismas palabras
  con contenido que las FAQs, parecido ≥ 0.5, al menos dos palabras). Una pregunta de dato del viaje (ubicación, hora, documentos,
  factura) se contesta SIEMPRE con el dato real de ese viaje; una queja o «quiero hablar con alguien» las atiende una persona.
- El borrador sale con ese texto, riesgo medio, **siempre al gerente** (lo no entendido nunca se autoenvía, ni en modo
  «autoenviar bajo riesgo»), con la advertencia «es una respuesta rápida que tú aprobaste: revisa que conteste lo que preguntó el
  cliente». El pulido con modelo no la toca.
- Cada uso se cuenta (`vigia_respuesta_rapida_usar`, atómico) y se ve en la pantalla; una respuesta se retira sin borrarla.
- Tope: 200 aprobadas por flota. Sin la 0647 en la base no hay respuestas rápidas y el Vigía contesta como siempre.

## Reporte de preguntas frecuentes y tendencias en Excel o PDF

`GET /api/export/vigia-faqs?[grupo=<uuid>]&formato=xlsx|pdf` (botones en la pantalla del histórico). Mismas cifras que la pantalla:
preguntas frecuentes con la respuesta del equipo, temas por semana con su cambio contra las 4 semanas previas y tiempos de
respuesta contra el umbral. Puertas: área `operacion` + `puedeExportar`, rate limit por IP y por flota, grupo buscado con la flota
de la sesión (otro grupo = 404), sin las tablas de la 0484 = 409.

## Cuándo llega la alerta de «más de 10 minutos»

El plazo de un cliente con grupo crítico es de 10 min (`sla_critico_min`, mínimo 5). El cron del Vigía pasa **cada minuto**
(decisión de la ronda 08: con `*/5` la alerta salía entre el minuto 10 y el 15; ahora sale entre el 10 y el 11). Un webhook no
puede sustituir al cron: la alerta nace de que NO llegó nada, así que alguien tiene que mirar el reloj. La pasada de cada
minuto es una lectura acotada (≤100 hilos, sin modelo) que casi siempre vuelve vacía; atorados, ciclos muertos y retención
corren solo en los minutos múltiplo de 5. Cuesta ~1,440 invocaciones diarias de una función de segundos: si en producción
se prefiere abaratar, volver a `*/5` en `vercel.json` y `CADENCIA_MS.vigia` (el plazo efectivo sube hasta 5 min).

## Variables de entorno

| Variable | Efecto |
|---|---|
| `LIKIDA_MODEL_VIGIA_CLIENTE` | Cambia el modelo del rol (default `google/gemini-3.5-flash-lite`). |
| `LIKIDA_VIGIA_MODELO=no` | Apaga el clasificador por modelo: quedan solo las reglas. |
| `LIKIDA_VIGIA_PULIR=si` | Enciende el pulido de redacción (apagado por omisión); su salida pasa por la guardia de cifras/ligas y se tira si falla. |

## Operación

- Si el cron `vigia` envejece, `/api/health` lo declara; `salud.ts` espera un latido cada minuto.
- Un mensaje «aprobado» que no llegó a «enviado» en 5 minutos se marca fallido **sin reenviar**
  (podría haber salido): se revisa a mano en el tablero.
- Costo de IA: una clasificación por modelo solo ocurre cuando las reglas no reconocen el mensaje;
  se carga al presupuesto de IA de la flota (fase `chat` del ledger).
