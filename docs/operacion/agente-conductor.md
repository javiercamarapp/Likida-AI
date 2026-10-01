# Agente 5 «Conductor» — los hitos del viaje por WhatsApp

> Estado al 2-oct-2026: **construido y probado con dobles/fixtures; NO operando.** Todo lo que depende de WhatsApp real (número/WABA, plantillas aprobadas por Meta) está en «Bloqueos externos». Migración: `0380_conductor_hitos.sql`.

## Qué hace

Innovativos (250 camiones) pidió un agente que **pida, persiga, valide y registre** los hitos que el chofer no manda, y que mande los avisos que su sistema actual no manda.

| Hito (`tipo`) | Qué es |
|---|---|
| `llegada_carga` | Llegó a cargar (y **con quién se reportó** en el andén: nombre y área) |
| `salida_carga` | Terminó de cargar y salió |
| `llegada_descarga` | Llegó al destino a descargar (y con quién se reportó) |
| `salida_descarga` | Terminó de descargar |
| `regreso` | Va de regreso |

Dos caras:

1. **Reactiva** (siempre encendida): el chofer escribe o toca un botón y el hito se registra. «Ya llegué», «ya estoy en andén, me atiende Juan de recibo», «ya cargué», «salgo para allá», «voy con retraso», «me equivoqué»…
2. **Proactiva** (cron `conductor-hitos`, cada 5 min; se apaga con `agente_conductor_config.activo = false` o el kill switch `agente:conductores`): pide cada hito en su momento, persigue con recordatorios escalonados y escala al jefe de tráfico.

## Máquina de estados

```
esperado ──► recibido ──► validado          (validado: confirmado por oficina/GPS/sistema)
   │            ▲
   ├──► omitido ┘   (se infirió por un hito posterior; si llega tarde, se llena)
   └──► escalado    (se agotaron los recordatorios; sigue pendiente y el chofer aún puede responder)
```

Secuencia válida: `llegada_carga → salida_carga → llegada_descarga → salida_descarga → regreso`. Solo se persigue el **hito activo** (el primero pendiente).

Garantías (todas con prueba en `conductor/maquina.test.ts` y `atender.test.ts`):

- **«Ya llegué» a secas se resuelve por el estado del viaje**: sin nada registrado → llegada a *cargar*; con la salida de carga registrada → llegada a *descargar*; con la llegada a carga ya registrada y nada más → **se pregunta** (botones «Llegué a descargar» / «Sigo en la carga»). Una llegada al origen **nunca** sella la del destino (ese era el defecto de las tres columnas de la 0090). El acuse dice «llegaste a CARGAR» y ofrece el botón «Es en descarga» para corregir.
- **Fuera de orden**: un hito posterior marca como `omitido` a los anteriores pendientes (dejan de perseguirse); un hito anterior que llega tarde llena su hueco sin tocar a los demás.
- **Duplicados**: repetir un hito no mueve su hora; el mismo mensaje de WhatsApp (`wa_message_id`) no registra dos veces (unique por flota).
- **Correcciones**: el chofer puede retirar **solo el último** hito registrado, dentro de `ventana_correccion_min` (60 por defecto) y mientras no esté `validado`. Retirarlo regresa a `esperado` también a los omitidos por su causa y reinicia su escalera (`ciclo + 1`).
- **La hora es la del MENSAJE** (Meta), recortada al reloj del servidor si venía del futuro. Nunca se presenta como telemetría del evento físico.
- Los tres sellos de la 0090 (`viaje.llegada_en`, `descarga_en`, `regreso_en`) **se siguen escribiendo** (`llegada_en` = llegada a *descarga*; el primero gana) para no romper la espera en patio ni el tablero.

## Interpretación de respuestas

1. **Botones** de las plantillas: payload `<prefijo>:<viaje_id>` (el uuid se valida y **se comprueba que el viaje sea de ese chofer y de su flota**: el payload llega como texto y se puede teclear a mano).
2. **Reglas deterministas** (`conductor/interprete.ts`) en español de México: verbos, lugares, contacto («me atiende Juan de recibo», «me reporté con el ingeniero Muñoz»), retraso con minutos, sin contacto, correcciones. Candados: palabras de otro tema (diésel, caseta, llanta, choque…) → no es un hito; más de 2 palabras ajenas al vocabulario → no es un hito; una pregunta nunca registra.
3. **Respaldo con modelo**, solo si las reglas no entienden Y el texto parece hablar de un hito: rol `conductor_hito` (Gemini 3.5 Flash-Lite; respaldo cruzado GPT-6 Luna), salida estructurada (zod) **validada** — confianza ≥ 0.8, el nombre del contacto debe aparecer literal en lo que escribió el chofer, y el modelo **no puede retirar ni validar** (esas intenciones no existen en su esquema). El texto del chofer viaja delimitado como dato. Se apaga por flota con `usar_llm`. Costo en `llm_costo` fase `router`.

No se interpretan «sí»/«ok» a secas (ambiguos): se piden con botón.

## Solicitud proactiva y recordatorios

Cuándo «toca» cada hito (`planificador.ts`):

| Hito | Ancla |
|---|---|
| `llegada_carga` | cita (o ETA) de origen − `anticipo_cita_min` (30); sin cita: aceptación + `espera_sin_cita_min` (120, **supuesto**) |
| `salida_carga` | llegada registrada + `espera_carga_min` (120) |
| `llegada_descarga` | cita (o ETA) de destino − anticipo, nunca antes de la salida de carga; sin cita: salida + `trayecto_sin_eta_min` (480, **supuesto**) |
| `salida_descarga` | llegada registrada + `espera_descarga_min` (120) |
| `regreso` | salida registrada + `regreso_min` (30) |

Un aplazamiento («voy con retraso», «sigo cargando») mueve el ancla `posponer_min` (30; máx. 2 veces por hito: después ya no calla al agente).

Escalera al **chofer** (configurable por flota, default **0 / +15 / +30 / +45** min desde el ancla): nivel 0 = solicitud; 1, 2 y 3 = recordatorios (plantillas 1/2/3). Reglas:

- **Un mensaje por corrida y siempre el nivel más alto ya vencido** (si el cron estuvo caído no salen tres recordatorios de golpe).
- **Claim anti-duplicado**: el aviso se reclama insertando en `viaje_hito_aviso` (unique `(hito, ciclo, clase, nivel)`) **antes** de mandar; dos corridas solapadas mandan uno.
- **Nunca fuera de la ventana de la flota** (`hora_inicio`–`hora_fin`, `dias_semana`, hora de México; default 06:00–22:00 todos los días). Aplica también a la escalación.
- **Tope diario** por chofer (`tope_diario_chofer`, 12).
- Todo sale por `enviarConFallback`: ventana 24 h abierta → texto con botones; cerrada → plantilla del catálogo (texto y plantilla dicen **lo mismo**: prueba `solicitudes.test.ts`).
- Rechazo reintentable de Meta (429…) → se libera el claim y se reintenta; **5 seguidos paran la corrida**. Rechazo no reintentable (plantilla sin aprobar) → el claim queda con el motivo y la escalera avanza.

## Escalamiento al jefe de tráfico

A los `escalar_tras_min` (90) con la escalera agotada:

- **Nivel 1**: patio responsable de la terminal del viaje (`conductor_contacto_trafico`, nivel 1; si no hay, el nivel 1 de toda la flota; si tampoco, el jefe general configurado, y si tampoco, el jefe de la flota — `app_user`).
- **Nivel 2** (`segundo_nivel_min` = 30 después): jefe general. Un teléfono que ya recibió el nivel 1 **no** recibe el 2.
- Mensaje con chofer, hito pendiente, folio, motivo y **última ubicación conocida** (posición de la unidad ≤ 12 h o el pin del chofer) + botón **«Ya lo atiendo»** (`jefe_atiendo:<viaje>`): solo lo acepta un contacto de tráfico o una cuenta de oficina **de esa flota**; detiene toda insistencia. «No existe» y «no es tuyo» contestan lo mismo.
- «Tengo un problema» (botón del recordatorio) escala **ya** al nivel 1, sin esperar.
- Sin ningún destinatario: se marca igual (a la vista en el tablero), se registra el error y no se reintenta cada 5 min.

## Avisos que hoy no salen

- **Confirmación al chofer** de cada hito registrado (hora del mensaje + qué sigue). Se puede apagar (`confirmar_al_chofer`).
- **Aviso a la oficina** con la hora exacta de llegada/salida, **configurable** y apagado por defecto (`avisar_oficina_llegada`, `avisar_oficina_salida`): texto al jefe con respaldo `aviso_operacion_v1`; un solo aviso por hito y ciclo (claim).

## API para el sistema del cliente (`/v1`)

| Ruta | Área | Qué |
|---|---|---|
| `GET /v1/hitos` | `operacion` | Hitos con filtros `viajeId`, `folio`, `estado`, `tipo`, `desde` (incremental) y paginación. Trae contacto en andén y coordenadas; **no** el texto crudo del chofer. |
| `GET /v1/hitos/eventos?despues=<id>` | `operacion` | Feed incremental de eventos (recibido, validado, omitido, escalado, corregido, pospuesto, atendido, contacto), sin datos personales. Pull. |
| `PUT /v1/viajes/{id}/citas` | `administracion` | `citaOrigen`, `citaDestino`, `etaOrigen`, `etaDestino` (ISO **con zona horaria**; `null` borra). Es lo que dice al agente cuándo pedir cada hito. |

Siempre acotado por la flota de la credencial. **No hay webhook saliente**: exige política de destinos (SSRF), secretos y reintentos que no se inventaron aquí (ver pendientes).

## Datos, privacidad y retención

Tablas (todas con RLS: operación de la flota lee —dueño, encargado—, el **contador no**; solo `service_role` escribe): `viaje_hito`, `viaje_hito_aviso` (bitácora + claim; solo los últimos 4 dígitos del teléfono), `viaje_hito_evento` (append-only), `agente_conductor_config`, `conductor_contacto_trafico`, y `viaje.cita_*_en` / `eta_*_en`.

Datos personales nuevos: el nombre de un **tercero** (quien recibe en el andén), coordenadas del chofer, el texto que escribió y los últimos 4 dígitos de quien recibió un aviso.

- **Cancelación ARCO**: un disparador sobre `operador.anonimizado_en` borra contacto, coordenadas, texto y evidencia de sus hitos y los últimos 4 dígitos de sus avisos; **conserva estados e instantes** (evidencia de estadías). No reescribe `ejecutar_arco_cancelacion`.
- **Retención**: `anonimizar_conductor_hitos(p_dias = 365)` y `purgar_conductor_auditoria(p_dias = 365)`, mínimo 30 días, corren a las 03:xx (México) dentro del cron `conductor-hitos`. **El plazo de 365 días es una PROPUESTA** (no hay política de retención decidida para el dato de un tercero; la fija el aviso de privacidad de cada flota / Javier).

## Operación

- Palancas: `global` y `agente:conductores` (fail-closed: ilegible = no corre). Latido `conductor-hitos` (parcial = fallos de envío, cortes por reloj o rechazo masivo).
- Config por flota: `agente_conductor_config` (sin fila = defaults del código, `conductor/config.ts`). No hay pantalla todavía (ver pendientes).
- Contactos de escalamiento: `conductor_contacto_trafico` (alta por SQL/servidor hoy; teléfonos en forma 52+10).
- Modelo: `LIKIDA_MODEL_CONDUCTOR_HITO` cambia el modelo sin deploy.

## Bloqueos externos (no cerrables por código)

1. **Número/WABA reales y aprobación de Meta** de las plantillas nuevas del Agente 5 (ver `plantillas-meta.md`): `conductor_solicitud_llegada_carga_v1`, `conductor_llegada_carga_sin_cita_v1`, `conductor_contacto_anden_v1`, `conductor_salida_carga_v1`, `conductor_llegada_descarga_v1`, `conductor_salida_descarga_v1`, `conductor_solicitud_regreso_v1`, `conductor_recordatorio_1/2/3_v1`, `aviso_jefe_trafico_v1` (+ `aviso_operacion_v1` ya existente para el aviso a oficina). Sin aprobación Meta devuelve 132001 y el agente lo reporta (fail-closed), no lo simula. Los textos son ES-MX propuestos: **no se verificaron contra Meta**.
2. **Datos reales de Innovativos**: citas/ETA por viaje (su TMS tiene que llamar a `PUT …/citas`), choferes con teléfono, contactos de patio por terminal y jefe general.
3. **GPS/geocercas** de Innovativos para la validación automática (hoy `validado` solo se alcanza por oficina/sistema; ver pendientes).
4. **Política de retención** del dato del tercero (365 días propuesto).
5. Plazos por defecto sin cita (120/120/480/120/30 min) son **supuestos**: validarlos con su operación.

## Pendientes conocidos (no hechos en esta tarea)

- Validación automática contra geocerca/GPS (`validado` por `gps`), editor de geocercas y foto/evidencia por hito (el modelo ya tiene `fuente = 'foto'`, `evidencia_ruta` y coordenadas; no hay cableado de la foto como hito).
- Tablero ampliado y pantalla de configuración (escalera, ventana, contactos) en `/dashboard/agentes/conductores`; hoy el tablero sigue mostrando los 6 sellos de siempre.
- Webhook saliente hacia el sistema del cliente.
- Un pin de ubicación se **adjunta** al hito recién registrado (≤ 30 min); no registra un hito por sí solo.
- Aviso por correo/Notificaciones a la flota cuando el agente no logra entregar escalaciones (el patrón de `escalar_viaje.ts`).
- La migración 0380 reescribe enteros los dominios de `cron_latido` y `agente_definicion_modelo_rol_dominio`; al integrar con otras ramas que también los amplían, **reconciliar las listas** (las pruebas `salud.test.ts` y `agente_definicion_modelo_rol_dominio.test.ts` lo detectan).
