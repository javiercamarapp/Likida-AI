# Escalación del viaje no aceptado (Agente 8)

Cuando la oficina asigna un viaje, el agente le escribe al chofer y el chofer no contesta, hasta hoy nadie se enteraba: el jefe daba por hecho que arrancó y se
descubría cuando no llegaban fotos, con el viaje ya empezado tarde. Este agente cierra ese hueco: **a las 5 horas sin aceptar** insiste una vez con el chofer y
le avisa al jefe de flota, que es quien puede cambiar de personal. No reasigna solo: quién maneja qué unidad depende de licencias, descansos y acuerdos que no están
en la base, así que se le da el dato y la decisión.

> Estado al 2-oct-2026: construido y probado con dobles (`src/lib/likida/e2e/agente-08-escalacion.e2e.test.ts`, 15 pruebas con feliz, fallo, duplicado, fuera de
> orden y otra flota). Migraciones: `0058` (marcas del viaje) y el índice parcial `viaje_sin_aceptar_idx`; sin migraciones nuevas. **No se ha corrido contra WhatsApp real.**

## Qué mira y cuándo corre

- Cron `/api/cron/escalar`, **cada hora** (minuto 7; `vercel.json`), puerta `CRON_SECRET` (sin secreto responde 500, nunca un 200 que parezca sano). Esa misma corrida
  también hace la cobranza, los relojes legales y el barrido de salud de los agentes (ver `orquestador.md`); cada chequeo corre en su propio `try`, así que si uno
  truena los demás siguen. Respeta las palancas `global` y `agente:conductores` (fail-closed: si no se puede leer una, no corre) y registra latido.
- Un viaje entra a la cola solo si está `abierto`, **Likida ya le avisó al chofer** (`avisado_en` no nulo), `aceptado_en` es nulo y `escalado_en` es nulo. Un viaje que
  Likida nunca avisó o que ya se cerró no entra jamás. El índice parcial `viaje_sin_aceptar_idx` mantiene la consulta corta.
- Lotes de hasta 100 viajes por corrida, **el más viejo primero**: con más vencidos que el lote, lo que no cupo encabeza la corrida siguiente (no hay viaje que quede fuera
  para siempre).

## El plazo es de cada flota

Por omisión 5 horas (`HORAS_PARA_ESCALAR`). La estrategia de cada flota lo cambia (`tenant.config.agentes.conductores.horasEscalacion`, entero de 1 a 48, desde la
pantalla de estrategia del Conductor). La consulta trae candidatos desde el piso de 1 hora y el corte fino lo pone la flota. **Si la configuración de una flota no se
puede leer, sus viajes se saltan esa corrida** (escalar con una estrategia que no se pudo consultar es escalar con datos equivocados) y se grita en el log; la corrida de
la hora siguiente los levanta.

## Qué hace con cada viaje, en este orden

1. **Reclama** el viaje: un UPDATE condicional que pone `escalado_en` ANTES de mandar nada y devuelve solo la fila que ganó. Vercel Cron entrega al menos una vez y dos
   corridas pueden solaparse: quien no gana el claim no manda nada y no lo cuenta como error. Por eso el jefe recibe **un** aviso por viaje, aunque corra dos veces.
2. **Insiste con el chofer** (una vez, mejor esfuerzo): texto que dice cuánto lleva asignado y qué contestar («sí» si ya va, «no» si no le toca; con cualquiera de las dos se
   avisa a su encargado), porque la plantilla de asignación idéntica no se distingue de un duplicado. Si la ventana de 24 h del chofer está cerrada no se gasta el intento de
   texto: va directo a la plantilla de asignación (`avisarAlChofer`). Un rechazo reintentable que ya quedó en `wa_outbox` no se duplica con la plantilla.
3. **Avisa al jefe** de esa flota (teléfono desde `telefonosJefe`), por el selector central `enviarConFallback`: texto dentro de la ventana («{chofer} no ha confirmado el viaje
   {folio} en {horas} horas. Le insistimos una vez más. Si no va a poder, conviene reasignarlo desde Despacho») y, fuera de ella, la plantilla de respaldo
   `recordatorio_cierre` (aprobada hoy; su cuerpo habla de otro evento, por eso es plan B).
4. **Cierra la corrida** por flota: éxito si al menos una escalación se pudo entregar; fallo de flota solo si ninguna salió, y entonces entra al anti-ruido de avisos del
   agente (correo `escalado` con los folios).

## Garantías y lo que NO hace

- **Una sola vez por viaje.** `escalado_en` se queda puesto aunque el aviso al jefe falle o no haya teléfono: la alternativa sería reintentar cada hora para siempre contra un
  número mal capturado. Un fallo queda en el log, en `fallos` del resultado y en la bitácora de corridas; el viaje sigue visible en el panel como escalado sin aceptar.
- **Una flota sin teléfono de jefe** se marca igual, se dice (`escalacion.sin_telefono_de_jefe` es un error, no un aviso) y el chofer sí recibe su recordatorio.
- **Rate limit o bloqueo de Meta**: un rechazo reintentable ya dejó el aviso en `wa_outbox`; el sello se conserva y la corrida siguiente no lo reenvía. Cinco rechazos
  reintentables **seguidos** paran la corrida (es la cuenta de WhatsApp limitada, no cinco teléfonos malos), alertan al operador y dejan el resto intacto.
- **Reloj**: la corrida deja de tomar viajes nuevos a los 40 s (`PLAZO_ESCALACION_MS`) para que la cobranza que sigue en la misma invocación alcance turno; el corte es
  ANTES del claim, así que lo que no alcanzó queda sin sello y se dice cuántos quedaron.
- **Aceptar después de escalar**: el aviso ya salió y no se retira ni se manda otro; el viaje no vuelve a la cola. Aceptar **antes** de que corra el cron evita la escalación.
- **Base caída**: el cron lanza (un error de lectura no es «nadie dejó de aceptar»).
- No reasigna, no cancela, no toca dinero ni escribe a terceros.

## Operación

- Para que el aviso al jefe salga fuera de la ventana de 24 h hace falta la plantilla `recordatorio_cierre` aprobada (ya en uso) y, para el recordatorio al chofer, `viaje_asignado`
  (ver `plantillas-meta.md`).
- Cada flota necesita una cuenta **activa** de oficina con teléfono capturado (`app_user.telefono`; la lista de roles y el mapa por flota los resuelve `telefonosJefe`, que nunca cae al número de otra flota); sin él la escalación queda marcada pero no avisa a nadie.
- Para cambiar el plazo: estrategia del Conductor, «horas de escalación» (1 a 48).
- Si el cron `escalar` envejece, `/api/health` lo declara; el barrido de salud del Orquestador abre una tarea si el latido o la última corrida de un agente fallan.

## Bloqueos externos

1. Número y WABA reales; teléfonos reales de los jefes de flota.
2. Aprobación en Meta de `viaje_asignado` y `recordatorio_cierre` y cotejo de su texto contra el catálogo.
3. Nada se probó contra WhatsApp real.
