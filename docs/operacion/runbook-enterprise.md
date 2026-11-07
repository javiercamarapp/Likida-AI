# Runbook de operación (enterprise)

Ronda 7. Complementa, no sustituye, a `runbook-incidentes.md` (severidades S1/S2/S3), `GUARDIA-EN-SERVIDOR.md`, `conexion-tms.md`,
`vigia-aviso-rollback.md` y `restauracion-guion-y-acta.md`. Todo lo que aquí se afirma sale del código o de esos documentos; lo que
no se pudo verificar se dice en la sección 6.

## 1. Qué mirar a diario (5 minutos)

1. **Pulso.** `curl -s -H "x-health-token: $HEALTH_TOKEN" https://app.likida.ai/api/health`. Sin token solo contesta que está vivo.
   Con token: `status`, `checks.crons` (`ok`, `degraded`, `config_ausente`, `apagado`, `unknown`), `migracion.{atras,adelante}`.
   `apagado` es neutro a propósito; `degraded` y `unknown` no.
2. **Issue `salud-produccion`** en GitHub: abierto = el pulso falló en el workflow «Salud de producción» (cada 30 min nominales; la
   cadencia real es menor). Se cierra solo al volver a verde.
3. **`/admin/salud-sistema`**: latido de cada uno de los 20 crons de `vercel.json` (todos están en `CRONS` de `src/lib/admin/salud.ts`).
   Un latido `parcial` o `fallo` trae su `detalle`.
4. **`/admin/escalaciones`**: la bandeja que clasifica la guardia (S1/S2/S3).
5. **Correo a `ALERTA_EMAIL`**: un correo por evento y por hora como máximo. Sin `ALERTA_EMAIL` o sin `RESEND_API_KEY` /
   `RESEND_EMAIL_DOMAIN` no sale nada (solo log); `/admin/salud-sistema` lo declara.
6. **Nocturno WebKit** (`E2E WebKit iPhone 14 (nocturno)`): rojo = mirar `docs` del commit que lo arregló (sección 6) antes de suponer
   un defecto del producto.

## 2. Qué señal existe hoy para cada falla

| Falla | Señal visible | Dónde queda |
|---|---|---|
| Lectura del TMS de una flota (conector) | Latido `tms` en `parcial` si hubo error, parcial, sin turno por reloj o alarma de credencial; `fallo` si el cron revienta (alerta `cron.tms`). `cron.tms.flota_atrasada` si una flota lleva más de 2 h sin lectura exitosa. Credencial rechazada: alarma por flota en el resumen. | `/admin/salud-sistema`, `/api/health`, correo (un aviso por hora) |
| Correo de liquidación (desglose) con reintentos agotados | Fila de `liquidacion_entrega_correo` en `fallida` (texto «agotó 5 intentos»); latido `liquidaciones-externas` en `parcial`; **desde esta ronda** correo `cron.liquidaciones_externas.correo_fallido` (solo conteos). Rechazo 4xx del operador o coordinador abre además una excepción para la oficina. | Detalle del desglose, `/admin/salud-sistema`, correo |
| Correo de aviso genérico (`enviarAvisoCorreo`, Carta Porte, Peajes, Vigía) | El resultado vuelve como `rechazado`/`red`/`sin_configurar` y se registra en log; no hay cola con reintentos propia (el módulo de envío no reintenta a propósito). El Vigía tiene respaldo por correo con candado y latido `parcial` con `avisosFallidos`. | Log, latido `vigia` |
| Cada cron | Latido en `cron_latido`; vencido, `sin_latido`, `fallo` o `parcial` degradan `/api/health` y abren el issue; cron que revienta manda `alertarOperador`. | `/api/health`, issue, correo |
| Vigía: barrido (clasificar, escalar) | Latido `vigia`: `parcial` si reloj, fallos de envío, atorados o avisos fallidos; `cron.vigia.avisos_fallidos` por correo; `cron.vigia` si revienta. | `/admin/salud-sistema`, correo |
| Vigía: histórico de chats importado a mano | Resultado por archivo en pantalla (`importado`/`duplicado`/`error`) y `vigia.historial_importar_fallo` en log. Es interactivo: quien sube ve el error al instante. | Pantalla del dueño |
| Vigía: mensajes en vivo por WhatsApp | Depende del webhook de Meta; `wa-pendientes` drena los pendientes y deja latido. **No hay señal propia de «Meta dejó de entregar»**: ver sección 6. | Latido `wa-pendientes` |
| Llave de IA caída / tope de IA | `llm.credencial_caida`, `presupuesto_ia.*` (ver `runbook-incidentes.md`). | Correo |
| Base inalcanzable / app sin respuesta | `guardia.base_inalcanzable`, `guardia.app_sin_respuesta` (correo y, si hay `ALERTA_WA`, WhatsApp). | Correo |

## 3. Qué hacer si falla cada cosa

- **TMS `parcial` o flota atrasada.** Leer `detalle` del latido `tms`: `credencialRechazada` = pedir credencial nueva a la flota y
  capturarla en `/dashboard/conexiones`; `conError`/`parciales` = ver `logger` `cron.tms.parcial` (sin datos del cliente). Para
  detener UNA flota sin perder la credencial: `tms_mapeo.activo = false` de sus filas (no existe interruptor por flota; ver
  `conexion-tms.md` §5 «Cómo se revierte la conexión completa», punto 3, y §8.3). El conector solo LEE. Antes de activar un mapeo
  nuevo, la prueba en seco de `conexion-tms.md` §8.2.
- **Correo de liquidación fallido.** Abrir el desglose de la liquidación: la entrega `fallida` trae `ultimo_error`. «Agotó 5
  intentos» con 429/5xx/red = problema de Resend o de red: esperar y que una persona reenvíe desde el desglose. «Sin confirmar» =
  puede haber salido ya; **no reenviar a ciegas**, una persona confirma con el destinatario (un doble envío de pago no se arregla).
  401/403 de Resend = llave o dominio sin verificar (`RESEND_API_KEY`, `RESEND_EMAIL_DOMAIN`): la fila no gasta intentos y espera.
- **Cron `fallo`/vencido.** Seguir `runbook-incidentes.md` §4. Si está apagado por interruptor, `/api/health` lo muestra como
  `apagado`, y tras 3 días (`DIAS_APAGADO_ALERTA`) lo avisa: no dejarlo olvidado.
- **Vigía no atiende.** Revisar `vigia` en `/admin/salud-sistema`; apagado de emergencia en `vigia-aviso-rollback.md`.
- **WebKit nocturno rojo.** No es del producto hasta demostrar lo contrario: ver sección 6.

## 4. Rollback

### Código (deploy)
1. GitHub, Actions, «Vercel rollback production»: `deployment_url` = deployment estable anterior (URL o ID exacto) y
   `confirmation` = `ROLLBACK_PRODUCTION`. Equivale a promover el deploy anterior en Vercel (también se puede hacer desde el panel de
   Vercel: Deployments, el anterior, Promote to Production).
2. Verificar con `/api/health` (con token) que `version` cambió.
3. **Un rollback de código no deshace migraciones.** Si el build revertido traía una, mirar `migracion.adelante` y no tocar el
   esquema sin respaldo.
4. Cada push o merge con `[deploy]` en el asunto provoca un build facturable; decir cuántos antes de hacerlo.

### Migraciones
Cada migración nueva debe llevar su línea o bloque `-- REVERSA` en la cabecera (ej. `0999_vigia_sin_atender_config.sql`,
`0990_llm_alerta_tope_persistida.sql`). Verificado hoy: **57 de 552 archivos** de `supabase/migrations/` contienen la palabra
`REVERSA`; las anteriores no tienen reversa escrita y revertirlas es a mano. La reversa solo se corre con respaldo previo y nunca
con datos nuevos de clientes encima sin revisarla. Los aditivos (tabla nueva que el código tolera ausente, como `0999`) son la
reversa más segura.

## 5. Cómo apagar cada agente o modo (nombres reales del código)

**Interruptores de la tabla `interruptor`** (`src/lib/likida/interruptores.ts`; panel `/admin/observabilidad` o ⌘K). Sin fila =
encendido; ilegible = apagado y avisa. `global` corta todos los crons de agentes. Por agente: `agente:liquidacion`, `agente:facturas`,
`agente:cobranza`, `agente:conductores`, `agente:peajes`, `agente:proveedores`, `agente:ventas`, `agente:redactor`, `agente:vigia`,
`agente:carta_porte`, `agente:carta_porte_salida_tms`, `agente:descarga_sat`, `agente:orquestador`, `agente:orquestador_semanal`, entre
otros (la lista completa es `INTERRUPTORES`). Frenos temporales: `cobranza:rechazo_masivo_whatsapp`.

| Qué | Cómo se apaga |
|---|---|
| Todos los crons de agentes | Interruptor `global` |
| Entrega del desglose por correo y reintentos de liquidación | Interruptor `agente:liquidacion`. Verificado en `src/app/api/cron/liquidaciones-externas/route.ts`: el cron consulta primero `global` y después `agente:liquidacion`; con cualquiera apagado salta (latido `saltado`) y con cualquiera ilegible no corre (500, latido `fallo`) |
| Sincronizador TMS (cron `tms`) | Solo `global`; por flota: `tms_mapeo.activo = false` o desactivar la credencial en `/dashboard/conexiones` (irreversible: hay que recapturar). Detalle en `conexion-tms.md` §8.3 |
| Vigía de servicio al cliente por flota | Tabla `vigia_config`, columna `habilitado` (migración 0400; `false` por omisión y sin fila = apagado) puesta en `false` |
| Aviso proactivo de viaje del Vigía | `vigia_aviso_config.habilitado = false` (`vigia-aviso-rollback.md`) |
| Resumen/correo de «sin atender» del Vigía | Variable `LIKIDA_VIGIA_SIN_ATENDER_CORREO` distinta de `si` (solo `si` lo enciende) |
| Pulido de redacción del Vigía | `LIKIDA_VIGIA_PULIR` distinto de `si` (apagado por omisión) |
| Clasificador por modelo del Vigía | `LIKIDA_VIGIA_MODELO=no` (quedan solo reglas) |
| Gobierno de IA (sonda de llave y topes 80 %) | `IA_GOBIERNO` distinto de `encendido` |
| Enviador de campañas | `LIKIDA_ENVIADOR_ENCENDIDO` (solo el valor exacto documentado en `enviador.ts` lo enciende) |
| Facturación real | `FACTURACION_MODO` distinto de `emitir` queda en `ensayo` |
| MFA escalonado (flota_admin y contador) | `LIKIDA_TOTP_ESCALONADO=obligatorio` lo enciende; apagado por omisión. No está en el workflow nocturno WebKit. |
| Canal de correo completo | Quitar `RESEND_API_KEY` (los avisos devuelven `sin_configurar`) |
| UI v2 forzada (solo pruebas) | `LIKIDA_UI_V2_FORZAR=1`; se ignora si `VERCEL_ENV=production` |

Cambiar una variable de Vercel exige redeploy para tomar efecto y un redeploy es un build; los interruptores de la tabla y las
banderas en base actúan sin build.

## 6. Lo que NO está resuelto

- **Restauración de la base: nunca se ha ensayado** (`DEPLOY.md`: «Última prueba de restauración: nunca»). RPO 24 h y RTO 4 h son
  objetivos declarados, no demostrados. El guion está en `restauracion-guion-y-acta.md`; lo corre Javier.
- **WhatsApp en tiempo real depende de Meta.** La verificación de negocio figura como rechazada en `avisos-correo.md`; los avisos
  tienen segundo canal por correo, pero la entrada en vivo de mensajes no tiene señal propia de «Meta dejó de entregar».
- **Monitor externo a `/api/health`** no existe (gasto, decisión de Javier): si cae toda la plataforma, la guardia tampoco corre.
- **`ALERTA_WA` y segundo destinatario de alertas** no están definidos; todo aviso es un correo a una sola persona.
- **Reintentos del correo genérico**: `enviarAvisoCorreo` no reintenta ni cola (a propósito); un aviso que no salió solo queda en
  log. Solo el desglose de liquidación y el Vigía tienen cola con reintentos.
- **Interruptor por flota del TMS**: no existe (pendiente A37-TRANSVERSAL-08).
- **Conector TMS**: ninguna flota real está conectada; el contrato del API del cliente no está confirmado.
- **Migraciones sin reversa escrita**: 495 de 552.
- **Prueba nocturna WebKit.** Causa diagnosticada por lectura, no ejecutada en WebKit: `next start` corre con `NODE_ENV=production`
  y `COOKIES_DE_SESION` fuerza `Secure`; la sesión se guarda en Chromium (acepta `Secure` sobre `http://localhost`) y WebKit en Linux
  no envía esas cookies sobre `http://localhost`, así que `/dashboard` rebota a `/login?next=`. La prueba ahora inyecta las cookies
  de localhost sin `Secure`. Falta confirmar en la siguiente corrida nocturna (`workflow_dispatch` la adelanta); si sigue en rojo, el
  dato que falta es la traza (`e2e-webkit-falla`, 7 días de retención) con las cookies de la petición a `/dashboard`. Nota: este
  proyecto nunca estuvo en verde (dos corridas, una cancelada).
