# La guardia de producción en el servidor, latencias y página de estado

Ola enterprise E1-A (P0-8, E18, E4, parte de P1-14). Migraciones 0700 y 0701.

## Qué cambió

| Antes | Ahora |
|---|---|
| El vigía de producción (guardia A0) corría en `launchd` en la Mac de Javier, cada 2 h. Mac apagada, dormida o sin red = guardia ausente, sin que nadie lo supiera. | `/api/cron/guardia` (Vercel Cron, `*/5 * * * *`), con `CRON_SECRET`, latido en `cron_latido` (id `guardia`) e interruptor global. |
| Estado de «ya avisé» en `.mejora-diaria/vigia-estado.json` (disco de la Mac). | Estado en el `detalle` del latido de la propia guardia (huellas sha-1, sin títulos ni nombres de flota). |
| Aviso por WhatsApp desde la Mac (`wa-notificar.sh`). | `alertarOperador('guardia.*')`: correo a `ALERTA_EMAIL` y, si hay `ALERTA_WA`, también WhatsApp (los eventos `guardia.*` se suman a los de dinero). |
| Latencias: «no se instrumenta hoy». | p50/p95 por ruta, por cron y por fase de IA en `/admin/observabilidad`, calculados en SQL. |
| Sin página de estado. | `/estado`, pública y de solo lectura, con cinco componentes y 30 días medidos. |

La decisión de qué avisar (`decidirAvisos` en `lib/admin/guardia.ts`) es la MISMA para el cron y para el script de la Mac.

## Costo del cron

288 invocaciones por día, de unos segundos cada una (una lectura de la bandeja, un `GET` a `/api/health` y un puñado de upserts). Se justifica porque: (1) el aviso de un incidente S1/S2 pasa de ≤ 2 h a ≤ 5 min; (2) cada pasada deja una muestra para `/estado`, y 5 minutos es la resolución mínima razonable para hablar de disponibilidad; (3) ya hay seis crons por minuto y cinco cada 5 minutos: este suma ruido, no un orden de magnitud. Si el costo molesta, `*/10` en `vercel.json` y `CADENCIA_MS.guardia` en `lib/admin/salud.ts` (la prueba `salud.test.ts` obliga a que coincidan).

## Qué hace cada pasada

1. **Bandeja.** Clasifica con las reglas del A0 (matriz del runbook). S1/S2 nuevo o fuente ciega nueva = aviso. Una base inalcanzable avisa una vez por racha y avisa cuando vuelve.
2. **Componentes de `/estado`.** `GET /api/health` por la URL pública y los latidos de WhatsApp y correo. Cada medición suma a `estado_dia`; lo que no se pudo medir no se escribe.
3. **Retención** (3:00 hora de México, una vez al día): `purgar_latencia` (14 días, por tandas) y `purgar_estado_dia` (400 días).

Si el interruptor global está apagado: no corre ni mide (latido `saltado`). Si no se puede leer: falla cerrado Y avisa.

## Los cinco componentes: qué miden y qué NO

| Componente | Mide | NO mide |
|---|---|---|
| Aplicación | `/api/health` contestó por el dominio público desde el cron; esquema de la base al día con el código | La red del visitante, la latencia desde otra región |
| Base de datos | La consulta real de `/api/health` | Replicas, rendimiento bajo carga |
| Procesos programados | El agregado de latidos de `/api/health` (cadencia + 20 min, resultado sano; los huecos de configuración declarados no cuentan) | Qué cron falló (no se publica) |
| WhatsApp | Que NUESTRA tubería (`wa-pendientes`, `wa-outbox`) corre al día | La nube de Meta |
| Correo | Que la tubería de envío corre (latido de `buzon-entrega`), solo si hay canal de correo configurado | Que el mensaje llegue al buzón del destinatario |

La página no publica nombres de cron, versiones, motivos de fallo ni datos de flotas. Un día sin medición se pinta «sin medición», no verde.

## Lo que esto NO puede hacer (límite honesto)

Si TODA la plataforma cae (Vercel o la base entera), el cron no corre y `/estado` vive en la misma plataforma. Un monitor EXTERNO sigue siendo lo único que ve eso: apuntar UptimeRobot (o equivalente, plan gratuito) a `/api/health` y, si se quiere, un estado externo. Ese monitor no se contrató desde el código.

Del mismo modo, mientras la base esté caída la guardia sí avisa (por `ALERTA_EMAIL`, sin tocar la base), pero no puede escribir su latido ni el historial.

## Variables y cosas externas

- `CRON_SECRET` (ya existe): sin él el cron responde 500.
- `ALERTA_EMAIL` (hoy el único canal que de verdad llega): sin él, la guardia mide y registra pero no avisa a nadie. `/admin/salud-sistema` lo dice.
- `ALERTA_WA` (opcional): para que los avisos de la guardia también suenen en el teléfono. Texto libre: Meta lo entrega solo con ventana de 24 h abierta.
- `LIKIDA_LATENCIA_MUESTREO` (opcional, 0..1, default 0.1): fracción de peticiones medidas en las rutas instrumentadas.
- `SENTRY_DSN`: independiente de este paquete; sin él los errores no llegan a Sentry (`/admin/observabilidad` lo marca «ciego»).

## Cómo decide avisar (ronda 19)

- **Histéresis de la app:** hacen falta DOS sondeos fallidos seguidos de `/api/health` para avisar y para marcar la app «caída» en `/estado`; un fallo aislado (arranque en frío, timeout de 8 s) no hace nada. La racha y el inicio de la caída viajan en el `detalle` del latido; el inicio va en la huella del aviso, así el piso de 1 h de `alerta.ts` no silencia una caída nueva que llegue tras una recuperación.
- **Un health que no es health** (401/403 de firewall, 404, redirección, HTML de mantenimiento) deja la app «sin medición» y avisa `guardia.app_sin_medicion`; nunca la pinta operativa.
- **El dedup solo anota «ya avisé» si el aviso salió** (canal configurado, fuera del piso y sin rechazo del proveedor).
- **Bandeja rota con la base sana** no es «base inalcanzable»: se aísla, el latido queda `parcial` y se sigue midiendo; a la segunda pasada seguida avisa `guardia.sin_vista`.
- **Limitación declarada (M4):** el estado de dedup vive en la base. Con la base caída se usa la memoria del proceso (un aviso por racha, y «base volvió» al primer latido sano de la MISMA instancia); un arranque en frío u otra instancia la pierde: a lo más un aviso repetido bajo el piso de 1 h, nunca silencio.
- **Latencias:** `webhook.whatsapp` y `dashboard.chat` miden hasta el acuse / primer byte, no el procesamiento posterior. La escritura de la muestra va en `after()` y nunca retrasa la respuesta. La purga corre solo en la ventana 3:00-3:04 MX (si ese tick falla se pospone 24 h; la capacidad sobra).

## Al desplegar

1. Aplicar las migraciones 0700 y 0701 ANTES del código (la guardia escribe en tablas nuevas y el CHECK de `cron_latido` debe admitir `guardia`).
   Si el código sale antes (error de orden), degrada sin perder lo importante: `registrarCosto` reintenta sin `duracion_ms` (el costo de IA no se pierde) y el latido `guardia` deja `cron.latido_migracion_pendiente` en el log en vez de lanzar; pero `/api/health` verá `guardia` sin latido. `scripts/ci/compuerta-deploy.mjs` ya frena el build si la base va atrás de la última migración.
2. Después de desplegar, `/api/health` queda `degraded` hasta el primer latido de `guardia` (≤ 5 min), como cualquier cron nuevo (OP-P4). La compuerta de despliegue y `salud-produccion.yml` leen ese campo: no re-disparar un `[deploy]` en esa ventana.
3. Retirar el `launchd` de la Mac cuando se confirme el primer latido: `launchctl bootout gui/$(id -u)/com.likida.vigia-produccion` (y quitar el plist de `~/Library/LaunchAgents`). Dos vigías avisando lo mismo por canales distintos es ruido. El script `scripts/mejora-diaria/vigia-produccion.mts` queda como herramienta manual.

## Rutinas locales: qué se movió y qué se queda en la Mac

El plan pide mover «solo las críticas». De los ~22 `com.likida.*.plist`, la ÚNICA que el plan marca como crítica (P0-8) es el vigía de producción: ya está en el servidor.

Se quedan en la Mac, por una razón de fondo y no de pereza: cada `rutina.sh <nombre>` corre `claude -p` con la suscripción de Javier en un taller aislado (`likida-mejoras`), abre ramas/PR y usa herramientas locales (WebSearch, Higgsfield, render de video). Un cron de Vercel no tiene esa suscripción ni ese entorno, y llevarlas allá obligaría a pagar la API por cada corrida y a darle al servidor credenciales de GitHub: es otro paquete, no una migración de un cron.

| Rutina | Qué hace | Por qué se queda |
|---|---|---|
| `dof-diario`, `experto-fiscal`, `auditoria-semanal`, `automejora-semanal`, `mejora-diaria`, `documentacion-quincenal`, `salud-mensual`, `reporte-enjambre`, `jarvis-brief` | Análisis y mejora con `claude -p` local; dejan veredicto o PR | Usan la suscripción local; no son del camino de un cliente |
| `noticias-diaria`, `promos-diaria`, `guiones-semanal`, `contenido-fiscal-semanal`, `visuales-semanal`, `video-semanal`, `render-video`, `alianzas-semanal`, `competencia-semanal`, `tam-semanal`, `prospeccion-decisores`, `fundraising-mensual` | Marketing y ventas de Likida: piezas a aprobación | Idem; además producen archivos locales (video, imágenes) |
| `bus-orden` (cada 5 min) | Lado Mac del bus de mando: ejecuta órdenes de `bus_orden` | Ejecuta las rutinas locales; sin Mac no hay rutinas que ordenar. Su atraso lo mide el SLO «órdenes del bus sin atender» |

Riesgo que queda: si la Mac se apaga, estas rutinas no corren (nadie dependía de ellas para operar un cliente). Lo operativo —WhatsApp, facturación, vigía de servicio, guardia— ya corre en Vercel.
