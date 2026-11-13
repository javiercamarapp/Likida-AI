# Conectar una línea de WhatsApp propia a una flota

Una flota puede tener varias líneas (por terminal o por propósito) de la MISMA app de Meta de Likida. La firma del webhook
(`WHATSAPP_APP_SECRET`) no cambia; lo que cambia por línea es el `phone_number_id` y su token. Tabla: `tenant_whatsapp_linea` (migración 1006).

Mientras una línea está `pendiente`, la flota sigue enviando por el número global. Una línea `pausada` o con `token_vencido` falla cerrado:
no se cae al número global.

## Antes de empezar

- La migración 1006 aplicada en la base destino (la aplica el dueño; no la corre este flujo).
- Entorno local: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LIKIDA_COFRE_LLAVE` (la misma del servidor). No se imprimen.
- El uuid de la flota (`--tenant`) y, si aplica, el de la terminal (`--terminal`).

## Paso a paso

1. **Registrar el número en el Administrador de WhatsApp** de la cuenta de WhatsApp Business del proveedor (la WABA): Administrador de WhatsApp,
   Teléfonos, Agregar número de teléfono.
2. **Verificar con el código SMS** (o llamada) que Meta envía al número. El número no debe estar activo en la app de WhatsApp normal.
3. **Nombre visible**: capturarlo y esperar su aprobación; sin nombre aprobado la calidad y el límite de envío quedan restringidos.
4. **Plantillas**: las plantillas son por WABA. Si la WABA es otra, mandar de nuevo las plantillas del producto (ver
   `scripts/mandar-plantillas-meta-fase0.sh`) y confirmar que quedan aprobadas antes de activar.
5. **Token permanente**: en el negocio de Meta, crear un usuario del sistema con acceso a la WABA y generar un token que no expira con los permisos
   `whatsapp_business_messaging` y `whatsapp_business_management`. Anotar el `phone_number_id` y el `waba_id` (Administrador de WhatsApp, Herramientas de API).
6. **Webhook**: confirmar que la app de Meta está suscrita a esa WABA (campos `messages`). El script lo comprueba con `--activar`.
7. **Alta** (pide el token en un diálogo oculto; nunca por argumentos):

   ```
   ! node scripts/conectar-linea-whatsapp.mjs --tenant <uuid> --phone-number-id <id> --waba-id <id> \
       --numero "+52 55 1234 5678" --etiqueta "Servicio al cliente" --proposito servicio_cliente --principal --dry-run
   ```

   Quitar `--dry-run` cuando el resultado sea el esperado. El script relee a Meta (solo GET), cifra el token con el cofre v2 (atado a
   `tenantId:phoneNumberId`) y guarda la línea `pendiente`. La primera vez baja `tsx` con `npx`.
8. **Verificación entrante**: con la línea aún `pendiente`, un mensaje al número NO se procesa (se descarta a propósito). Activar y volver a probar.
9. **Activar**: repetir con `--activar` en la alta, o pasar la línea a `activa` solo después de ver la suscripción del webhook. `--activar` exige
   `--waba-id`, verifica `subscribed_apps` y, con `--principal`, usa el cambio atómico de principal.
10. **Verificación entrante y saliente**: escribir al número desde un teléfono de prueba y confirmar que la conversación llega a la flota correcta;
    responder desde el panel y confirmar que sale por ese número (el remitente que ve el teléfono es el de la línea). Una prueba de envío
    llama a Meta real: hacerla a propósito, con un teléfono propio.

## Varias líneas

- Sin criterio, el envío usa la **principal** activa; sin principal y con una sola activa, esa. Con varias activas y sin principal, el envío
  falla (`ambigua`) en lugar de elegir al azar: marcar una principal.
- Criterios disponibles: línea, terminal y propósito (`servicio_cliente`, `operadores`, `oficina`, `general`).
- Solo hay una principal **activa** por flota; el cambio es atómico (`tenant_whatsapp_linea_hacer_principal`).

## Si el token vence

Meta contesta el código 190: la línea pasa sola a `token_vencido`, deja de enviar (no cae al número global) y sigue recibiendo.

1. Generar un token nuevo del usuario del sistema (paso 5).
2. Registrar el nuevo token: hoy la rotación es dar de baja (`pausada`) la línea vieja y dar de alta de nuevo con el mismo flujo en otra fila no es posible
   (el `phone_number_id` es único); por eso la rotación se hace actualizando `token_cifrado` y `token_pistas` con el mismo cifrado v2 y volviendo el estado
   a `activa`. Pendiente: una herramienta de rotación; hasta entonces, pedirlo al equipo técnico, nunca pegar el token en un chat.
3. Verificar entrante y saliente (paso 10).
