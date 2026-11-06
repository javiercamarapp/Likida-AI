# Vigía por exportación de chats: conversaciones sin atender

Visibilidad HOY sin depender de Meta. No lee WhatsApp en tiempo real: trabaja con los chats exportados que la flota sube en
`/dashboard/agentes/vigia/historial`. Cada tiempo se mide contra la hora de la última exportación de cada chat (foto), no contra el reloj.

## Qué hace
- Pantalla `/dashboard/agentes/vigia/sin-atender`: lista multi-grupo con grupo, prioridad, tiempo sin respuesta, motivo y turno. Es de solo lectura.
- Formulario de revisión: es una PRUEBA. Plazos, palabras y nombres del equipo se aplican a ESA revisión y no se guardan; se suman a la configuración guardada de la flota (abajo).
- «Configuración de tu flota» (solo quien administra): guarda lo que valdrá en cada revisión de esa flota, incluida la que corre al subir un chat.
- Resumen por correo (`sin_atender_aviso/correo.ts`): sobre `enviarAvisoCorreo`. Asunto fijo sin cifras; el cuerpo lleva grupo, prioridad, tiempo
  y motivo, nunca texto de mensajes. Top 12 y «Y N más en la pantalla». Máximo 10 destinatarios.
- Destinatarios (`destinatarios.ts`): servicio al cliente activo con correo (del cliente del grupo o de todos) + directores de nivel 1 del turno
  actual (`filtrarPorTurno`, con zona y festivos de la flota); nivel 2 solo si hay una alerta alta en un grupo crítico. Sin correos = no se envía.

## Candados (todos fallan cerrados, apagado por omisión)
1. La bandera de plataforma `LIKIDA_VIGIA_SIN_ATENDER_CORREO` debe valer `si`.
2. Los interruptores `global` y `agente:vigia` deben leerse «encendido» (ilegible = apagado).
3. El interruptor PROPIO de la flota (`resumen_correo_habilitado`, migración 0999) debe ser `true`: sin fila, sin tabla o ilegible = apagado. Se vuelve a comprobar al mandar.
4. Solo `puedeAdministrar`, solo por clic, con fecha de corte obligatoria (no se avisa de conversaciones anteriores).
5. Sin destinatarios con correo o sin alertas no sale nada. Sin Resend configurado el resultado es `sin_configurar` y se muestra tal cual.
6. Idempotencia PARCIAL: la clave es sha256(turno | día local | claves de alerta ordenadas) y `enviarAvisoCorreo` la combina con la flota; Resend
   deduplica por 24 h. Solo protege un repetido con el MISMO turno, el mismo día local y el mismo conjunto de alertas; un clic a las 19:59 y otro
   a las 20:01 (cambio de turno) mandan dos correos. No hay lectura de bitácora por flota para detectar duplicados en el servidor y la bitácora
   asienta cada clic como envío. La pantalla y el texto de ayuda lo dicen así («normalmente no se duplica», no «no se duplica»).

## Privacidad
El texto de los chats ya se conserva 180 días (importación existente). Este módulo no lo registra en logs, no lo manda a IA ni a servicios externos
y no lo persiste de nuevo. La pantalla muestra una vista previa acotada a 160 caracteres; el correo nunca.

## Después de subir un chat
`importarHistorialPanel` corre el detector sobre la flota (sin guardar nada, sin IA, sin texto en logs) y agrega al mensaje de éxito cuántas
conversaciones de ESE grupo quedaron sin atender (y cuántas de prioridad alta). Si la revisión falla o no hay lectura, la importación ya guardada
sigue siendo un éxito y el mensaje sale como antes. El enlace a la pantalla sigue en la sección de importación.

## Configuración por flota (migración 0999, `vigia_sin_atender_config`)
Una fila por flota; **sin fila (o con la tabla sin aplicar) todo está apagado**: sin horario de atención, palabras de arranque (`embarque`, `embarques`),
sin lista de equipo, insistencia 2, plazo de lo urgente 10 min y resumen por correo apagado. Se edita en «Configuración de tu flota» (solo administración,
acción `guardarConfigAccion`, el tenant sale de la sesión) y queda asentado en la bitácora con conteos, nunca con nombres ni texto de mensajes.

| Campo | Qué hace | Rango |
| --- | --- | --- |
| `horario_atencion` | La espera fuera de ese horario (y en días no hábiles o festivos) no cuenta. null = minutos corridos. | apertura 0-23, cierre 1-24 mayor, días 0-6 |
| `palabras_clave` / `palabras_urgentes` | Temas importantes / urgencia. Vacío = las de arranque / ninguna. | hasta 30, 40 caracteres |
| `equipo_nombres` | Nombres del personal tal como salen en el chat; al revisar se vuelven un código irreversible con la sal de la flota. Se suman a los escritos en la prueba. | hasta 100, 80 caracteres |
| `insistencia_min` | Mensajes seguidos del cliente sin respuesta que cuentan como insistencia (0 la apaga). | 0-50 |
| `umbral_urgente_min` | Plazo de lo urgente. | 1-1440 |
| `resumen_correo_habilitado` | Interruptor propio de la flota para el resumen por correo. Se SUMA a la bandera y a los interruptores de plataforma. | true / false (default false) |

Lectura: `leerConfigSinAtender(tenantId)` en `vigia/repo.ts` (tabla ausente `42P01`/`PGRST205` = valores de arranque; otro error lanza). Escritura:
`guardarConfigSinAtender`, tras `validarConfigGuardada` (rechaza con mensaje llano, no corrige). La pantalla dice que el horario de atención se respeta
SOLO cuando hay uno guardado.

Privacidad: los nombres del equipo SÍ se guardan tal como se escriben (son personal de la flota, no texto de chats); el formulario de subir un chat sigue sin
guardar los suyos. Los mensajes de los chats no se guardan aquí.

Qué NO existe hoy, para que ningún informe diga lo contrario:
- Interruptor por flota del resumen: existe, pero NO enciende nada por sí solo; sin la bandera de plataforma y los interruptores no sale correo.
- Envío programado: sigue siendo solo por clic.

## Límites honestos
- Llega tan tarde como se suba la exportación; no hay alerta a los 5 o 10 minutos reales.
- Re-exportar el mismo chat duplica filas (la huella solo evita el mismo archivo): el motor deduplica. Por grupo se leen los 1000 mensajes más recientes
  (`max_rows = 1000` del proyecto; pedir más se recortaba en silencio) y la última subida de cada grupo se consulta por grupo, no en bloque.
- La zona de las exportaciones se asume UTC-6 fijo (correcto para CDMX y Monterrey, no para Tijuana ni Cancún).
- Envío manual; un envío programado exigiría estado persistido (migración) y quedó como decisión.
