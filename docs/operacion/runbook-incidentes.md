# Runbook de incidentes S1, S2 y S3

CT-INF-16 (F5, 4-nov-2026). Este documento junta en un solo lugar lo que ya existe disperso: la matriz de severidad que aplica
`src/lib/admin/guardia.ts`, los primeros pasos de `docs/conocimiento/DEPLOY.md` («Algo se rompió»), el rollback de
`.github/workflows/rollback-production.yml` y los interruptores de `src/lib/likida/interruptores.ts`. No inventa herramientas nuevas.

Quién lee esto: quien reciba un aviso de `ALERTA_EMAIL` (hoy, Javier). Lo que NO existe todavía y se dice a propósito: segundo
destinatario, `ALERTA_WA` definido en Vercel y monitor externo independiente de la plataforma (INF-10, panel de Javier).

## 1. Qué severidad es

| Sev. | Definición | Ejemplos reales del repo | Quién la detecta |
|---|---|---|---|
| **S1** | El sistema **miente o ejecuta de más**: una cifra falsa afirmada, un mensaje o CFDI que no debía salir, dinero mal calculado, datos de una flota vistos por otra. | Liquidación cerrada con monto equivocado; WhatsApp a quien no correspondía; fuga entre flotas. | Una persona o Sentry. **Ningún código lo detecta**: `guardia.ts` no deriva S1 de la bandeja y lo declara en vez de fingir. |
| **S2** | **Una función dejó de operar, pero nada miente**; o un plazo legal está por vencer. | Corrida de agente en fallo; fuente ciega de la bandeja; ticket con SLA vencido; ARCO a menos de 5 días del plazo (LFPDPPP art. 31); `/api/health` en `degraded`; llave de IA caída (`llm.credencial_caida`); tope de IA al 100 % (`presupuesto_ia.tope_tenant`). | Bandeja (corrida en fallo, fuente ciega, SLA vencido, ARCO): `guardia.ts` la clasifica y `/api/cron/guardia` (cada 5 min) manda un correo por `ALERTA_EMAIL` por cada S1/S2 **nuevo**. `/api/health` `degraded`: `salud-produccion`. Llave de IA y tope de IA: **no pasan por la clasificación de la guardia**; son correos directos de `alertarOperador` (ver nota abajo). |
| **S3** | Espera una decisión humana; **el sistema opera**. | Ticket dentro de SLA; ARCO dentro de plazo; talachas, facturas de proveedor o liquidaciones por revisar; tope de IA al 80 % (`presupuesto_ia.tope_80`). | La bandeja `/admin/escalaciones`: se ve al abrirla y **no manda correo**. Excepción: el tope de IA al 80 % no está en la bandeja, solo llega como correo de `alertarOperador`. |

**Qué manda correo y qué no, según el código.** Todo aviso al operador es un correo de `alertarOperador` a `ALERTA_EMAIL` (con
tope de un correo por evento por hora; sin `ALERTA_EMAIL` no sale nada y solo queda en el log). El segundo canal, `ALERTA_WA` (WhatsApp, solo
dinero y `guardia.*`), existe en el código pero hoy no está definido en Vercel (sección 7). Quién lo dispara:

- `/api/cron/guardia` (cada 5 min) clasifica la bandeja y manda `guardia.incidente_nuevo` solo por S1/S2 nuevos o fuentes ciegas
  nuevas; además `guardia.base_inalcanzable`, `guardia.base_volvio` y `guardia.app_sin_respuesta`. Un incidente solo se da por
  «visto» si el correo salió; si no salió, se reintenta en la siguiente pasada.
- `llm.credencial_caida` lo manda `src/lib/llm/credencial.ts` al primer 401/402/403 de una llamada al modelo (no la guardia). La
  sonda de llave (que también avisa si falta `OPENROUTER_API_KEY`) y el barrido de topes de IA (`presupuesto_ia.tope_80` y
  `presupuesto_ia.tope_tenant`) solo corren si `IA_GOBIERNO=encendido`, colgados del cron de la guardia, una pasada de cada tres
  (~15 min). El aviso de tope se registra en la base una vez por flota, día y nivel; si el correo no sale, la marca se libera y el
  siguiente barrido lo reintenta.

Regla de duda: ante la duda entre S1 y S2, es **S1** hasta demostrar que ningún dato falso salió. Un guardia que se calla es peor
que no tener guardia (la fuente ciega es S2 por sí misma).

## 2. Los primeros diez minutos (todas las severidades)

1. **Confirmar el pulso.** `curl -s https://app.likida.ai/api/health`. Mirar `status`, `checks.crons`, `migracion.{atras,adelante,motivo}`
   y `ratelimit`. `degraded` con `migracion.atras > 0` es la base sin migraciones que el código ya pide; `adelante > 0` es el
   esquema aplicado con un build sin publicar. Ver `DEPLOY.md`, punto 6 de «Algo se rompió».
2. **Mirar el issue `salud-produccion`** en GitHub: si hay uno abierto, ya trae el motivo y la corrida que lo abrió.
3. **Logs.** `vercel logs https://app.likida.ai --since 1h`. La retención de esa vista es corta y no hay log drain: si el
   incidente importa, copiar las líneas antes de cerrar la pestaña. Los identificadores salen como huella `id:xxxxxxxxxxxx`
   (`huellaId` de `src/lib/logger.ts` convierte un UUID a su huella).
4. **Anotar la hora de inicio** (hora de México) y qué flotas pudieron verse afectadas. Sin esa nota la bitácora del incidente
   no se puede reconstruir.

## 3. S1 — el sistema miente o ejecuta de más

Objetivo: **dejar de hacer daño primero, entender después.**

1. **Apagar lo que ejecuta.** Interruptores (`/admin/observabilidad` o ⌘K): `global` corta todos los crons de agentes; los hay por
   agente (`agente:liquidacion`, `agente:facturas`, `agente:cobranza`, `agente:conductores`, `agente:peajes`, `agente:proveedores`,
   `agente:ventas`, `agente:redactor`). Sin fila = encendido; un interruptor ilegible falla **cerrado** (apagado) y avisa.
   Apagado es neutro para el health, pero después de 3 días (`DIAS_APAGADO_ALERTA`) el health lo avisa: no dejarlo olvidado.
2. **Si el defecto está en el último build: rollback.** GitHub → Actions → «Vercel rollback production» → `deployment_url`
   (el deployment estable anterior, HTTPS explícito) y `confirmation` = `ROLLBACK_PRODUCTION`. Verificar después con `/api/health`
   que `version` cambió. **Un rollback no deshace migraciones**: si el build nuevo traía una, revisar `migracion.adelante` y no
   revertir el esquema sin respaldo previo (ver `docs/operacion/restauracion-guion-y-acta.md`).
3. **Contener los datos.** Si salió algo al cliente (WhatsApp, correo, PDF, CFDI), listar a quién y cuándo desde la bitácora
   del agente; **no** mandar correcciones al cliente desde el sistema: lo decide Javier.
4. **Preservar evidencia** antes de corregir: líneas de log, filas afectadas (consulta de solo lectura), versión del build.
5. **Corregir con una prueba que reproduzca el caso**, no solo el síntoma.
6. **Cerrar.** Reencender los interruptores uno por uno, verificar con una flota de prueba y dejar nota en el wiki
   (qué falló, desde cuándo, a quién tocó, qué lo detectó y qué lo hubiera detectado antes).

## 4. S2 — algo dejó de operar, nada miente

1. Identificar **qué función** y desde cuándo: `/admin/salud-sistema` (latidos por cron) y `/admin/escalaciones`.
2. Casos frecuentes:
   - **Cron muerto o `parcial`**: leer el `detalle` del latido; si es un hueco de configuración declarado (falta una variable),
     llega por `alertarHuecoConfiguracion` una vez por semana y no es una regresión.
   - **Llave de IA caída** (`llm.credencial_caida`, `claseDeStatus`): 401 = llave inválida, 402 = saldo agotado, 403 = permiso o
     moderación. Con 401/402 repetidos el circuito corta las llamadas (60 s) y el sistema degrada a determinístico. Rotar o
     recargar en el panel de OpenRouter y `credencialExito` lo cierra solo; si `IA_GOBIERNO=encendido`, la sonda (cada 15 min,
     `GET /api/v1/key`) lo confirma sin gastar tokens. El 18-23 de octubre la llave estuvo muerta sin que nadie lo supiera: por
     eso existe el aviso al primer fallo.
   - **Tope de IA al 100 %** (`presupuesto_ia.tope_tenant`): subir `tenant.config.presupuestoLlmUsdDia` de esa flota solo si es un
     día legítimo de volumen; si no, buscar qué agente se comió el presupuesto (`/admin/consumo`).
   - **WhatsApp sin fotos**: token caducado, ver «Rotar el token de WhatsApp» en `DEPLOY.md`.
   - **Base inalcanzable**: la guardia avisa una vez por racha por `ALERTA_EMAIL` (sin tocar la base) y avisa cuando vuelve.
3. **ARCO a menos de 5 días del plazo**: es S2 por incumplimiento legal inminente, no por falla técnica; se atiende hoy.
4. Si la función estuvo caída más de un turno de operación, avisar a las flotas afectadas con un texto de Javier, no automático.

## 5. S3 — se atiende en el día

Entran a la lista del día de `/admin/escalaciones`. No despiertan a nadie. Se revisan con el borrador que la guardia ya armó; si
un S3 envejece pasa a S2 por regla (SLA vencido, ARCO a 5 días).

## 6. Qué NO hacer

- No correr migraciones ni `supabase config push` para «arreglar rápido» en producción (ver `DEPLOY.md`).
- No borrar filas para que un panel «cuadre»: un cero solo es cero cuando alguien lo midió.
- No subir un tope de IA o un interruptor sin anotar quién, cuándo y por qué.
- No prometerle tiempos al cliente desde el sistema.

## 7. Lo que falta fuera del código (se dice, no se disimula)

| Falta | Quién | Efecto mientras no esté |
|---|---|---|
| Monitor externo (UptimeRobot o equivalente) a `/api/health` | Javier (gasto, decisión D10) | Si cae TODA la plataforma, la guardia tampoco corre y nadie avisa. |
| `ALERTA_WA` en Vercel (Sensitive) | Javier | Las alertas de dinero y de la guardia solo llegan por correo. |
| Segundo destinatario de alertas | Javier | Un solo punto de falla humano. |
| `IA_GOBIERNO=encendido` y migración 0990 aplicada | Javier (corre la migración) | Sin la sonda de llave ni el aviso de tope al 80 %; el aviso al 100 % y al primer 401/402/403 sí funcionan. |
