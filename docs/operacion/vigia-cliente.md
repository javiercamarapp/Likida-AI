# Vigía de servicio al cliente (Agente 4)

Atiende por WhatsApp a los **clientes** de la flota (quien espera su carga): clasifica
lo que preguntan, contesta con datos reales del viaje, el gerente aprueba con un
toque, y lo molesto o sin respuesta escala por niveles. Migraciones `0400` y `0401`.

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
cron /api/cron/vigia (cada 5 min): SLA → nivel 1 (responsable) → nivel 2 (dueño), atorados, retención
```

Código: `src/lib/likida/vigia/` (`servicio.ts` orquesta; `repo.ts` es el único acceso a datos).
Tablero: `/dashboard/agentes/vigia`. Cron: `/api/cron/vigia` (`*/5 * * * *`).

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
| Retención y ARCO (supresión) | `0400` (`vigia_purgar`, `vigia_suprimir_contacto`) · SQL test · `repo.test.ts` |

## Puesta en marcha para una flota

1. Aplicar `0400` y `0401` (la compuerta de despliegue exige migraciones antes de `[deploy]`).
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

## Lo que NO existe todavía (dicho sin adornos)

- **ETA / cita por viaje**: Likida no guarda ninguna (no hay columna). Hoy toda pregunta de hora de
  llegada contesta «la consulto con tu ejecutivo» y escala. El día que exista, `estatusViajeReal`
  solo tiene que llenar `etaIso`.
- **GPS**: la posición sale de `posicion` (casi ninguna flota la tiene aún); sin posición dice que no la tiene.
- **Documentos pendientes**: hoy solo el POD (`pod`) es comprobable; no se inventan los demás.
- **Entrega del archivo** de la factura o el POD: el Vigía dice el estado y avisa al gerente; no adjunta archivos.
- **Coexistencia de WhatsApp** (que los chats de servicio que la flota ya tiene en su número lleguen
  a Likida): no hay código; depende de Meta y del número real de la flota.
- **Aviso de privacidad para clientes finales**: el texto legal no existe en Likida (el aviso integral
  cubre choferes). La liga configurable y la primera respuesta (que explica el asistente, la liga y la
  baja con BAJA) están listas; el documento lo redacta legal.
- **Solicitud ARCO de un cliente por WhatsApp**: `PRIVACIDAD` registra la solicitud a nombre de su
  flota; la supresión de sus chats la ejecuta el dueño desde su fila en el tablero.

## Variables de entorno

| Variable | Efecto |
|---|---|
| `LIKIDA_MODEL_VIGIA_CLIENTE` | Cambia el modelo del rol (default `google/gemini-3.5-flash-lite`). |
| `LIKIDA_VIGIA_MODELO=no` | Apaga el clasificador por modelo: quedan solo las reglas. |
| `LIKIDA_VIGIA_PULIR=si` | Enciende el pulido de redacción (apagado por omisión); su salida pasa por la guardia de cifras/ligas y se tira si falla. |

## Operación

- Si el cron `vigia` envejece, `/api/health` lo declara; `salud.ts` espera un latido cada 5 minutos.
- Un mensaje «aprobado» que no llegó a «enviado» en 5 minutos se marca fallido **sin reenviar**
  (podría haber salido): se revisa a mano en el tablero.
- Costo de IA: una clasificación por modelo solo ocurre cuando las reglas no reconocen el mensaje;
  se carga al presupuesto de IA de la flota (fase `chat` del ledger).
