# Jornada: la alerta de tope (cómo se opera)

> Estado: construida y probada en código (pantalla, motor, cron, 26 pruebas E2E con doble de Meta y
> de la base). **No está probada contra Meta ni contra Postgres de producción.** Lo que depende de
> terceros vive en «Bloqueos externos». Es un aviso sobre lo registrado, **no un dictamen jurídico**.

## Qué hace

El registro de jornada (LFT 132 fr. XXXIV, art. 68) dejó de ser solo algo que se mira. Cuando la jornada
**en curso** de un operador llega a los umbrales que eligió la flota (por omisión **80 %** y **95 %** del
tope) o lo rebasa, Likida avisa al encargado y al operador mientras todavía se puede hacer algo.

- **Tope**: el del art. 68 (12 h) o uno **más estricto** (el de la alerta o la «jornada máxima» de los
  umbrales de la flota; rige el menor). Nunca uno mayor a 12 h.
- **Niveles**: `aviso` (≥ umbral de aviso), `crítico` (≥ umbral crítico), `excedido` (≥ 100 %). Una vez por
  (jornada, nivel). Si la primera vez que se mira la jornada ya va al crítico, se avisa **ese** nivel, no
  los tres.
- **Está apagada por omisión**: cada aviso es un mensaje a una persona. La enciende el dueño.

## Cómo se enciende y se configura (pantalla)

`/dashboard/jornada`, sección **«Alerta de tope de jornada»** (debajo de «Los umbrales de tu flota»).

| Campo | Qué significa | Reglas |
| --- | --- | --- |
| Avisar cuando una jornada… | enciende o apaga la alerta de la flota | apagada si nunca se guardó |
| Tope propio (horas) | tope más estricto que la ley | vacío = el de la ley (12 h); máx. 12; vacío **no** es 0 |
| Aviso al (%) / Crítico al (%) | umbrales | 1–98 y 2–99; el de aviso debe ser menor que el crítico |
| Avisar al encargado por | WhatsApp, correo, ambos o no avisarle | con correo hace falta la dirección |
| Avisar al operador por | WhatsApp o no avisarle | solo WhatsApp |

- **Quién configura**: solo quien **administra la flota** (la misma regla que los umbrales de la flota:
  es configuración de la cuenta). El jefe de tráfico ve la configuración y la lista, no la forma. La
  acción vuelve a comprobar el permiso en el servidor; el rol del render no decide nada.
- **Firma y bitácora**: guardar queda con el correo de quien lo hizo y la fecha
  (`jornada_alerta_config.declarada_por_email`) y una anotación `jornada.alerta_tope_configurada`.
  Sin poder confirmar el correo, no se guarda.
- Los errores de validación llegan a la pantalla en palabras; el servidor valida otra vez
  (`EntradaConfigAlerta`) y la base tiene los mismos CHECK.

## Qué se ve: alertas emitidas

La misma sección lista las alertas de **las jornadas de la tabla de arriba** (el periodo y el operador
filtrados): cuándo salió, operador y día, nivel, «horas contra tope» con la fuente del inicio, estado
general y estado **por destinatario**.

| Estado | Qué quiere decir |
| --- | --- |
| Enviada | llegó a todos los destinatarios aplicables |
| Enviada en parte | a alguien sí y a alguien no (el motivo está en la base, `*_motivo`) |
| No llegó | ningún destinatario recibió el aviso por un motivo definitivo (p. ej. plantilla sin aprobar) |
| Sin a quién avisar | no hay encargado con contacto ni operador con teléfono |
| Enviándose | otra corrida lo tiene reclamado (arriendo de 5 min) |

Por destinatario: *enviado*, *no llegó*, *sin destinatario*, *no aplica* (canal apagado), *pendiente*.

**Una lectura caída se dice, nunca se disfraza**: «No se pudo leer la configuración» no equivale a
«apagada» y «No se pudieron leer las alertas» no equivale a «ninguna alerta» (que afirmaría que a nadie
se le avisó). Si la lista de jornadas de la tabla quedó truncada, la sección lo avisa: acota el periodo.

## Cómo corre

- **Cron** `/api/cron/jornada-alertas`, cada 15 min (`vercel.json`). Cadencia a propósito: con el 80 % de
  12 h (9.6 h) a una hora de cron el aviso llegaría hasta una hora tarde.
- Es **distinto** de `/api/cron/jornada` (cada hora; deriva marcas desde viajes y GPS, no manda mensajes).
- Lee, con la RPC `jornadas_en_curso_para_alerta`, solo las flotas con la alerta **encendida**: jornadas
  abiertas, de hoy o ayer (México), con un inicio vivo y sin fin vivo. Las horas las calcula la aplicación
  con el mismo modelo que el tablero (`componerJornada`), no una segunda fórmula.
- **Palanca**: sin `CRON_SECRET` rebota (401); el interruptor global ilegible da **500** (no corre sin
  saber si está apagado); apagado → latido `saltado`. No tiene palanca propia: se apaga **por flota**.
- **Reloj**: una pasada tiene `maxDuration` 60 s con 12 s de margen; lo que no cabe queda en
  `cortadosPorReloj` y el latido sale `parcial`.
- **Envío**: todo sale por `enviarConFallback` (ventana de 24 h abierta → texto; cerrada → plantilla del
  catálogo). Encargados: los contactos de escalamiento nivel 1 del patio del operador, o el jefe de la flota.

### Latido en `/admin/crons` (`jornada-alertas`)

| Latido | Cuándo |
| --- | --- |
| `ok` | corrida completa sin fallos |
| `parcial` | corte por reloj, lista truncada (más de 500 jornadas), rechazo masivo de WhatsApp o fallos de jornadas sueltas (no se pudo leer un expediente, sin destinatario…) |
| `fallo` | el motor lanzó (p. ej. no se pudo leer la lista de candidatas, o falta la migración 0502); además llega un correo al operador de la plataforma |
| `saltado` | interruptor global apagado |

El cuerpo de la respuesta trae los conteos (`revisadas`, `enCurso`, `alertas`, `yaAvisadas`,
`sinDestinatario`, `rechazosReintentables`, `cortadosPorReloj`, `listaTruncada`) y hasta 20 fallos.
Si WhatsApp rechaza 5 avisos seguidos por un motivo reintentable (límite de tasa, bloqueo), la corrida se
detiene, los avisos quedan sin reclamar y llega un correo (`wa_rechazo_masivo`).

## Reglas que no se negocian

1. **Nunca se inventa una hora.** Sin inicio vivo no hay alerta; no se estima cuándo empezó.
2. **Una cota inferior se dice «al menos».** Si el inicio lo derivó el GPS o un hito (no lo declaró el
   operador), el aviso dice «11 h (al menos)» y nombra la fuente: un exceso sobre una cota está probado,
   un «va al 80 %» sobre una cota es un piso.
3. **No se acorta la jornada a favor de la empresa.** Solo se descuentan descansos **cerrados**; uno sin
   cierre no se descuenta ni se estima, y el aviso lo dice.
4. **Más de 24 h abierta no es un día largo**, es un cierre que nadie marcó: no se alerta «excedido», se
   cuenta aparte (`sinCierreProbable`) y el tablero la muestra. Un inicio en el futuro (reloj desfasado)
   tampoco alerta.
5. **Una vez por nivel, aunque corran dos instancias.** La fila de `jornada_alerta` es el claim
   (`reclamar_jornada_alerta`); un claim con arriendo vencido (corrida que murió) se retoma una vez.
6. **Un rechazo reintentable (429, red) no consume el nivel**: se suelta el claim y la siguiente corrida
   (15 min después) lo reintenta. Uno definitivo se registra con su motivo.
7. **Una marca tardía no desdice lo avisado.** Un descanso cerrado que llega antes de la corrida baja las
   horas netas y puede evitar el aviso; si el aviso ya salió, no se reenvía ni se borra.

## Si algo no sale (diagnóstico)

| Síntoma | Causa probable | Qué hacer |
| --- | --- | --- |
| Nadie recibe nada | la alerta está apagada (nunca se guardó) | pantalla → encender y guardar |
| Alerta «No llegó» al operador, motivo de plantilla | `jornada_aviso_operador_v1` no aprobada en Meta y la ventana está cerrada | ver `plantillas-meta.md`; no se reintenta (motivo definitivo) |
| «Sin a quién avisar» | no hay contacto de escalamiento nivel 1 ni jefe de la flota, o el operador no tiene teléfono (o está dado de baja) | completar contactos / teléfono |
| Latido `fallo` con «¿migración 0502 sin aplicar?» | falta la 0502 en esa base | aplicarla (ver abajo) |
| Latido `parcial` con `listaTruncada` | más de 500 jornadas en curso con alerta encendida | revisar; el tope de la lista es 500 por pasada |
| Un operador sin aviso aunque pasó el tope | sin inicio vivo, o abierta > 24 h (`sinCierreProbable`) | corregir la marca en la pantalla (anular y capturar) |
| Aviso «al menos» | el inicio vino del GPS o de un hito | es lo correcto: la jornada real fue esa o más larga |

## Datos y retención

`jornada_alerta_config` (por flota; sin teléfonos) y `jornada_alerta` (una fila por jornada y nivel; sin
teléfonos; cuelga de `jornada_dia` con borrado en cascada, así que sigue la retención y el ARCO del
expediente). Ambas deny-all: el panel y el cron usan `service_role` filtrando por flota. Las pruebas SQL
están en `supabase/tests/0502_jornada_alerta_tope.sql`.

## Bloqueos externos (no se simulan)

- **Meta**: aprobar `jornada_aviso_encargado_v1` y `jornada_aviso_operador_v1` (texto exacto en
  `plantillas-meta.md`). Sin ellas, fuera de la ventana de 24 h el aviso no sale por WhatsApp.
- **Migración 0502** aplicada en la base real (junto con las demás pendientes de la cola de la rama).
  Comprobación: `select to_regclass('public.jornada_alerta_config')` no debe ser nulo.
- **Correo** (`canal` correo o ambos): proveedor de correo configurado en el entorno; sin él el aviso por
  correo se asienta como «no llegó» con el motivo «el correo no está configurado en este entorno».

## Dónde está el código

| Pieza | Archivo |
| --- | --- |
| Pantalla y acción de guardado | `src/app/dashboard/jornada/{page,vista,formas}.tsx` |
| Motor (evaluar, niveles, avisos, claim) | `src/lib/likida/jornada/alerta_tope.ts` |
| Puertos reales, configuración y lectura | `src/lib/likida/jornada/alerta_tope_datos.ts` |
| Cron | `src/app/api/cron/jornada-alertas/route.ts` |
| Pruebas | `route.test.ts` (cron), `alerta_tope.test.ts` (motor), `e2e/agente-12-jornada.e2e.test.ts` (cinco casos), `dashboard/jornada/{permisos_patio,alerta_tope_seccion}.test.tsx` (pantalla y permisos) |
| Migración | `supabase/migrations/0502_jornada_alerta_tope.sql` |
