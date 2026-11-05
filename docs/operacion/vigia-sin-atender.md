# Vigía por exportación de chats: conversaciones sin atender

Visibilidad HOY sin depender de Meta. No lee WhatsApp en tiempo real: trabaja con los chats exportados que la flota sube en
`/dashboard/agentes/vigia/historial`. Cada tiempo se mide contra la hora de la última exportación de cada chat (foto), no contra el reloj.

## Qué hace
- Pantalla `/dashboard/agentes/vigia/sin-atender`: lista multi-grupo con grupo, prioridad, tiempo sin respuesta, motivo y turno. Es de solo lectura.
- Formulario de revisión: plazos, palabras y nombres del equipo se aplican a ESA revisión y no se guardan.
- Resumen por correo (`sin_atender_aviso/correo.ts`): sobre `enviarAvisoCorreo`. Asunto fijo sin cifras; el cuerpo lleva grupo, prioridad, tiempo
  y motivo, nunca texto de mensajes. Top 12 y «Y N más en la pantalla». Máximo 10 destinatarios.
- Destinatarios (`destinatarios.ts`): servicio al cliente activo con correo (del cliente del grupo o de todos) + directores de nivel 1 del turno
  actual (`filtrarPorTurno`, con zona y festivos de la flota); nivel 2 solo si hay una alerta alta en un grupo crítico. Sin correos = no se envía.

## Candados (todos fallan cerrados, apagado por omisión)
1. La bandera de plataforma `LIKIDA_VIGIA_SIN_ATENDER_CORREO` debe valer `si`.
2. Los interruptores `global` y `agente:vigia` deben leerse «encendido» (ilegible = apagado).
3. Solo `puedeAdministrar`, solo por clic, con fecha de corte obligatoria (no se avisa de conversaciones anteriores).
4. Sin destinatarios con correo o sin alertas no sale nada. Sin Resend configurado el resultado es `sin_configurar` y se muestra tal cual.
5. Idempotencia PARCIAL: la clave es sha256(turno | día local | claves de alerta ordenadas) y `enviarAvisoCorreo` la combina con la flota; Resend
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

## Configuración por flota: sin almacén todavía
No hay tabla ni columna donde guardar palabras clave, equipo, insistencia ni un interruptor por flota. Hoy valen: los plazos de `vigia_config`,
directores con turno, festivos y servicio al cliente (todo editable en el tablero del Vigía) más los parámetros de cada revisión.
`PuertoConfigSinAtender.leer(tenantId)` hoy devuelve null: ahí se enchufa la migración recomendada.

Migración recomendada (PENDIENTE DE AUTORIZACIÓN DE JAVIER; esta ronda no crea migraciones): `vigia_sin_atender_config(tenant_id pk,
palabras_urgentes text[], palabras_clave text[], equipo_hashes text[], insistencia_min int, umbral_urgente_min int, horario_atencion jsonb,
resumen_correo_habilitado boolean default false, actualizado_por, actualizado_en)` con RLS como `0797` y bloque ROLLBACK.

Qué NO existe hoy, para que ningún informe diga lo contrario:
- Horario de atención: el motor lo acepta como campo opcional (`horarioAtencion`, apagado por omisión), pero esta pantalla no lo captura ni lo guarda;
  mientras no haya almacén, la antigüedad son minutos corridos.
- Interruptor por flota del resumen: el interruptor `global` / `agente:vigia` es de plataforma, no por flota; la bandera es de plataforma.
- Palabras clave, equipo y umbrales: se capturan en cada revisión y no se recuerdan.

## Límites honestos
- Llega tan tarde como se suba la exportación; no hay alerta a los 5 o 10 minutos reales.
- Re-exportar el mismo chat duplica filas (la huella solo evita el mismo archivo): el motor deduplica. Por grupo se leen los 1000 mensajes más recientes
  (`max_rows = 1000` del proyecto; pedir más se recortaba en silencio) y la última subida de cada grupo se consulta por grupo, no en bloque.
- La zona de las exportaciones se asume UTC-6 fijo (correcto para CDMX y Monterrey, no para Tijuana ni Cancún).
- Envío manual; un envío programado exigiría estado persistido (migración) y quedó como decisión.
