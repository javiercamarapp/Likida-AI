# Agente 5 «Conductor» — los hitos del viaje por WhatsApp

> Estado al 2-oct-2026: **construido y probado con dobles/fixtures; NO operando.** Todo lo que depende de WhatsApp real (número/WABA, plantillas aprobadas por Meta) está en «Bloqueos externos». Migraciones: `0380_conductor_hitos.sql` (hitos, escalera, escalamiento) y `0385_conductor_validacion_sitios_evidencia.sql` (sitios, validación contra la ubicación, evidencia, acciones de oficina, indicadores). La segunda entrega está descrita desde «Segunda entrega (0385)». Después se sumaron `0603`-`0604` (pin de WhatsApp fuera del GPS, aviso de llegada sin confirmar), `0630` (polígonos nativos de las geocercas) y `0635`-`0637` (hitos por geocerca, señal de vida, sitio derivado); ninguna de las migraciones está aplicada en una base real.

## Qué hace

El cliente de demo (250 camiones) pidió un agente que **pida, persiga, valide y registre** los hitos que el chofer no manda, y que mande los avisos que su sistema actual no manda.

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

- **Aviso al jefe de tráfico por «ya llegué» sin confirmar** (`avisar_llegada_sin_confirmar`, apagado por defecto, 0604): un solo aviso por llegada y ciclo (claim `llegada_sin_confirmar`) al patio responsable, con la hora exacta del mensaje del chofer, a los 10 minutos de gracia y hasta 12 horas después, dentro de la ventana de la flota; texto con respaldo en la plantilla `conductor_llegada_sin_confirmar_v1` (declarada en el catálogo, pendiente de aprobación en Meta). Cubre sin posición, «sin coincidencia» y el viaje sin sitio. Corre en el cron `conductor-hitos` después de la validación.

## Ciclo por geocerca y señal de vida (P2, migraciones 0635-0637)

Corren en el cron `conductor-hitos`, cada una aislada (si una falla, las demás corren y el latido sale `parcial`). Contra una base sin migrar todo sigue funcionando: la detección usa la transición condicional del hito como candado y el aviso de señal de vida queda apagado.

- **Sitio derivado** (`conductor/sitio_derivado.ts`, 0637): un viaje abierto sin sitio de carga o descarga lo recibe cuando el texto de su origen/destino coincide con UN solo sitio activo del catálogo del Conductor (código como palabra completa, nombre exacto, o el nombre completo del sitio dentro del texto; un cliente en el viaje desempata solo si deja a uno). Con duda no asigna nada y queda la excepción «sin sitio para conciliar». Una derivación por (viaje, lado): si la oficina cambia el sitio después, no se pisa. Nunca sobrescribe un sitio ya puesto (convenio o captura manual).
- **Hitos por geocerca** (`conductor/ciclo_gps.ts`, 0635; perilla `detectar_hitos_gps`, encendida por defecto, solo actúa con sitio asignado y GPS de la unidad): el GPS entra al sitio de origen (≥ 2 muestras seguidas dentro; 3 si la geocerca es aproximada) y se registra `llegada_carga`; después de estar dentro y llevar ≥ 2 muestras fuera (con histéresis de 100 m) se registra `salida_carga`; igual para el destino. El hito queda con fuente `sistema`, la hora de la MUESTRA de GPS y validado por `gps`; los sellos `llegada_en`/`descarga_en` se ponen como los pone el chofer, y el aviso a la oficina sale si la flota lo pidió. Lo que el chofer o la oficina ya reportaron no se toca; un hito que una persona corrigió no se vuelve a detectar (`viaje_cruce_geocerca`, único por (viaje, hito)). La llegada al destino con la carga sin cerrar da por omitidos los hitos anteriores, solo si el tractor vino de fuera y origen y destino son sitios distintos. Se lee una ventana de 4 h de muestras por pasada; `regreso` no se detecta. El pin de WhatsApp nunca cuenta como GPS.
- **Sin señal de vida** (`conductor/senal_vida.ts`, 0636; perilla `avisar_senal_vida`, APAGADA por defecto): en tránsito (salió de la carga, no ha llegado a la descarga) y dentro de la ventana de la flota, si la última muestra de GPS tiene más de 45 min (solo unidades que reportaron en las últimas 24 h) o la unidad lleva 60 min dentro de 150 m del mismo punto fuera de un sitio del viaje: aviso 1 al chofer con botones «Sí, estoy» / «Voy a cargar» / «Estoy bien»; a los 20 min sin respuesta, aviso 2; a los 20 min más, aviso al patio responsable con «Ya lo atiendo» (que cierra el episodio). Si el chofer contesta se cierra y se silencia 2 h («Voy a cargar»: 1 h); si el GPS vuelve, se cierra solo. Un episodio abierto por viaje y cada nivel se reclama con UPDATE condicional. Los umbrales son supuestos (constantes de `senal_vida.ts`), no mediciones. Plantillas para aprobar en Meta: `conductor_senal_vida_v1` y `aviso_jefe_senal_vida_v1`.

## API para el sistema del cliente (`/v1`)

| Ruta | Área | Qué |
|---|---|---|
| `GET /v1/hitos` | `operacion` | Hitos con filtros `viajeId`, `folio`, `estado`, `tipo`, `desde` (incremental) y paginación. Trae contacto en andén y coordenadas; **no** el texto crudo del chofer. |
| `GET /v1/hitos/eventos?despues=<id>` | `operacion` | Feed incremental de eventos (recibido, validado, omitido, escalado, corregido, pospuesto, atendido, contacto), sin datos personales. Pull. |
| `GET/PUT /v1/conductor/config` | `administracion` | La estrategia de la flota (escalera, ventana, tope diario, plazos, avisos a oficina) y los contactos de escalamiento. PUT manda solo lo que cambia, se valida entero (llave desconocida = 400); `contactos[]` (`nivel` 1 patio / 2 jefe general, `telefono`, `terminalId?`) REEMPLAZA la lista. |
| `PUT /v1/viajes/{id}/citas` | `administracion` | `citaOrigen`, `citaDestino`, `etaOrigen`, `etaDestino` (ISO **con zona horaria**; `null` borra). Es lo que dice al agente cuándo pedir cada hito. |

Siempre acotado por la flota de la credencial. **No hay webhook saliente**: exige política de destinos (SSRF), secretos y reintentos que no se inventaron aquí (ver pendientes).

## Datos, privacidad y retención

Tablas (todas con RLS: operación de la flota lee —dueño, encargado—, el **contador no**; solo `service_role` escribe): `viaje_hito`, `viaje_hito_aviso` (bitácora + claim; solo los últimos 4 dígitos del teléfono), `viaje_hito_evento` (append-only), `agente_conductor_config`, `conductor_contacto_trafico`, y `viaje.cita_*_en` / `eta_*_en`.

Datos personales nuevos: el nombre de un **tercero** (quien recibe en el andén), coordenadas del chofer, el texto que escribió y los últimos 4 dígitos de quien recibió un aviso.

- **Cancelación ARCO**: un disparador sobre `operador.anonimizado_en` borra contacto, coordenadas, texto y evidencia de sus hitos y los últimos 4 dígitos de sus avisos; **conserva estados e instantes** (evidencia de estadías). No reescribe `ejecutar_arco_cancelacion`.
- **Retención**: `anonimizar_conductor_hitos(p_dias = 365)` y `purgar_conductor_auditoria(p_dias = 365)`, mínimo 30 días, corren a las 03:xx (México) dentro del cron `conductor-hitos`. **El plazo de 365 días es una PROPUESTA** (no hay política de retención decidida para el dato de un tercero; la fija el aviso de privacidad de cada flota / Javier).

## Operación

- Palancas: `global` y `agente:conductores` (fail-closed: ilegible = no corre). Latido `conductor-hitos` (parcial = fallos de envío, cortes por reloj o rechazo masivo).
- Config por flota: `agente_conductor_config` (sin fila = defaults del código, `conductor/config.ts`), editable en `/dashboard/agentes/conductores/configuracion` (la ven los roles con acceso a la ruta; solo guarda quien puede administrar; si no se pudo leer la config, la pantalla lo dice en vez de enseñar los defaults como si fueran lo guardado) o con `PUT /v1/conductor/config`.
- Interruptores por flota que nacen APAGADOS (se encienden una flota a la vez): `avisar_oficina_llegada`/`avisar_oficina_salida`, `avisar_llegada_sin_confirmar` (0604), `avisar_senal_vida` (0636), las alertas de estadía y `pedir_foto_evidencia`. Encendidos por defecto: la detección por geocerca (`detectar_hitos_gps`, solo con sitio asignado y GPS de la unidad), la validación de ubicación y la confirmación al chofer.
- Cada paso proactivo del cron `conductor-hitos` corre aislado: si uno falla, los demás corren y el latido sale `parcial`.
- Contactos de escalamiento: `conductor_contacto_trafico`, por el mismo `PUT /v1/conductor/config` (teléfonos normalizados a 52+10).
- Modelo: `LIKIDA_MODEL_CONDUCTOR_HITO` cambia el modelo sin deploy.

## Bloqueos externos (no cerrables por código)

1. **Número/WABA reales y aprobación de Meta** de las plantillas nuevas del Agente 5 (ver `plantillas-meta.md`): `conductor_solicitud_llegada_carga_v1`, `conductor_llegada_carga_sin_cita_v1`, `conductor_contacto_anden_v1`, `conductor_salida_carga_v1`, `conductor_llegada_descarga_v1`, `conductor_salida_descarga_v1`, `conductor_solicitud_regreso_v1`, `conductor_recordatorio_1/2/3_v1`, `aviso_jefe_trafico_v1`, `conductor_llegada_sin_confirmar_v1` (0604), `conductor_senal_vida_v1` y `aviso_jefe_senal_vida_v1` (0636) (+ `aviso_operacion_v1` ya existente para el aviso a oficina). Las funciones que las usan nacen apagadas, así que aprobarlas no es requisito para el demo salvo lo que se vaya a enseñar en vivo. Sin aprobación Meta devuelve 132001 y el agente lo reporta (fail-closed), no lo simula. Los textos son ES-MX propuestos: **no se verificaron contra Meta**.
2. **Datos reales del cliente de demo**: citas/ETA por viaje (su TMS tiene que llamar a `PUT …/citas`), choferes con teléfono, contactos de patio por terminal y jefe general.
3. **GPS/geocercas** reales del cliente de demo: el código ya concilia («ya llegué» contra la posición del tractor) y detecta llegadas y salidas por geocerca, pero solo con fixtures; hace falta el acceso de solo lectura a sus tablas (ver `gps-proveedores.md`) y sus polígonos (los de patio alargado ya se guardan nativos, P1).
4. **Política de retención** del dato del tercero (365 días propuesto).
5. Plazos por defecto sin cita (120/120/480/120/30 min) son **supuestos**: validarlos con su operación.

## Pendientes de la primera entrega (estado actual)

- ~~Validación automática contra geocerca/GPS, editor de geocercas y foto/evidencia por hito~~ → hecho en la 0385 (ver abajo).
- ~~Tablero ampliado~~ → hecho (0385). ~~Pantalla de configuración~~ → hecha: `/dashboard/agentes/conductores/configuracion` (escalera, ventana, contactos y las perillas de la 0385, 0604 y 0635-0636), además de `PUT /v1/conductor/config`.
- ~~Detección por geocerca sin que el chofer escriba, «sin señal de vida» y sitio derivado~~ → hecho (P2, 0635-0637; sección «Ciclo por geocerca y señal de vida»).
- Webhook saliente hacia el sistema del cliente (exige política de destinos/SSRF, secretos y reintentos que no se inventaron).
- Aviso por correo/Notificaciones a la flota cuando el agente no logra entregar escalaciones (el patrón de `escalar_viaje.ts`).
- La migración 0380 reescribe enteros los dominios de `cron_latido` y `agente_definicion_modelo_rol_dominio`; al integrar con otras ramas que también los amplían, **reconciliar las listas** (las pruebas `salud.test.ts` y `agente_definicion_modelo_rol_dominio.test.ts` lo detectan). La 0385 NO toca esos dominios (el cron es el mismo).

---

# Segunda entrega (0385) — sitios, validación, evidencia, estadías y tablero

## 1. Catálogo de sitios (clientes, plantas y andenes)

Se **amplía `geocerca`** (0050) en vez de crear otra tabla: tipos nuevos `cliente`, `planta` y `anden`; `codigo` (el del sistema del cliente, único **por flota**), `direccion` (solo referencia), `cliente_id`, `padre_id` (un andén cuelga de su planta, FK compuestas: nada cuelga de otra flota) y `fuente` (`manual` | `csv`). Cada viaje apunta a su **sitio de carga** (`viaje.origen_geocerca_id`) y de **descarga** (`viaje.destino_geocerca_id`).

**Ninguna coordenada se inventa**: no se geocodifica por dirección, no se «arreglan» una lat/lng intercambiadas ni una longitud sin signo (se rechazan y se dice qué parece), una fila sin coordenadas es **error**, y el radio o viene en el archivo o lo declara quien importa. La plantilla de ejemplo trae las coordenadas en blanco a propósito.

| Cómo | Dónde |
|---|---|
| Importador CSV **todo o nada** (idempotente por `codigo`; la base resuelve cliente/padre/nombre y devuelve `Línea N: …`) | `/dashboard/agentes/conductores/sitios`, RPC `importar_sitios_conductor` |
| Editor mínimo (alta, edición, archivar/reactivar) | misma pantalla |
| Asignar el sitio de carga/descarga de un viaje | tablero (forma «Asignar sitios» por viaje) o `PUT /v1/viajes/{id}/sitios` (código o id, resuelto dentro de la flota) |
| Lectura | `GET /v1/sitios` (`operacion`) |

Columnas del CSV: `codigo, nombre, tipo, lat, lng, radio_m, direccion, cliente, padre`. Separador coma, `;` o tabulador (con `;` el decimal puede ser coma). Máx. 2,000 filas y 1 MB. Un CSV con `=`, `+`, `@`… al inicio de una celda se guarda tal cual como texto y se **neutraliza** al exportar.

> `/dashboard/agentes/peajes/configuracion` ya tenía un editor de geocercas sobre la **misma tabla**. Comparten catálogo a propósito; su upsert por `(tenant, nombre)` puede cambiar el `tipo` de un sitio de este catálogo a uno de los suyos (el resto de las columnas no se toca).

## 2. Validación de cada llegada contra la ubicación

Se validan las **llegadas** (carga y descarga); las salidas no (el camión ya se está yendo). Tres veredictos (`viaje_hito_validacion`, uno por hito y ciclo):

| Veredicto | Cuándo | Qué hace con el hito |
|---|---|---|
| `validado` | la posición cae dentro de `radio + tolerancia_ubicacion_m` | lo pasa a `validado` (`validado_por = gps`) |
| `sin_coincidencia` | hay posición y sitio, y cae fuera | **nada**: sigue `recibido`. Se lista en la cola de excepciones «para revisar» con una frase que **no acusa** (puede ser una muestra vieja, otra entrada del sitio o un radio mal capturado) |
| `sin_dato` | no hay sitio asignado, no hay posición, la posición es de otra hora (> `ventana_ubicacion_min`) o las coordenadas no son válidas | nada. **Jamás** se convierte en «no coincide» por defecto |

Fuentes: el **pin de WhatsApp** del chofer (la más directa) y la **posición de GPS** más cercana *en el tiempo* a la hora del mensaje (no «la última»). Haversine con R = 6,371,000 m (la misma aritmética que la RPC de presencia de la 0207). El veredicto **solo mejora** (`sin_dato → sin_coincidencia → validado`, lo garantiza `aplicar_validacion_hito`): una posición lejana posterior no desdice una evidencia positiva.

Tres momentos: al **registrar** la llegada (GPS cercano), cuando llega el **pin** (`atenderPinConductor`) y el **barrido del cron** (reintenta las llegadas de las últimas 3 h que quedaron «sin dato» porque el GPS reporta con minutos de retraso).

**Solicitar la ubicación cuando falta**: si la llegada quedó sin posición **y el viaje tiene sitio asignado**, el motor devuelve el texto de la solicitud y el processor lo manda **después del acuse** con el botón nativo «compartir ubicación». El texto dice para qué se usa («solo se usa para comprobar que estás en el sitio del viaje»). Sin sitio, no se pide (no habría con qué compararlo). Se apaga con `pedir_ubicacion`.

Configurable por flota (`PUT /v1/conductor/config`): `validarUbicacion` (true), `toleranciaUbicacionM` (150 m, **supuesto** no medición, 0–5,000), `ventanaUbicacionMin` (30, 5–180), `pedirUbicacion` (true).

**Bug corregido de la primera entrega**: `adjuntarUbicacionAHito` se llamaba dentro del bloque `if (!viajeId)` del processor, donde `viajeId` es siempre nulo: el pin **nunca** se adjuntaba. Ahora se llama en la rama del pin **con** viaje (`atenderPinConductor`), cubierto por `processor_hitos.test.ts`.

## 3. Foto/evidencia por hito (sello, andén, sello de recibido)

Mismo criterio y pipeline que el POD: el **caption** decide qué papel es (`sello`, `andén`, `recibido` y formas cerradas; «mi sello de diésel» **no** cuenta y sigue como comprobante). El processor resuelve **primero** a qué hito va (sin hito no paga la descarga y se lo dice al chofer: «primero dime ya llegué»), descarga, sube al bucket `comprobantes` con el helper del POD (nombre por hito: la misma foto como evidencia de dos hitos son dos archivos) y registra en `viaje_hito_evidencia` (ruta + sha256; único por mensaje de WhatsApp y por foto/hito/ciclo). No es un gasto: no toca el OCR, la liquidación ni la barrera del «listo».

- Ver la foto: `GET /v1/evidencias/{id}` → 302 a una **URL firmada de 10 min** del bucket privado; la ruta debe colgar del prefijo de la flota. Desde el tablero, un enlace por foto.
- **Retención y ARCO**: `purgar_conductor_evidencia(p_dias = 365, mín. 30)` (en el cron de las 03:xx) y el disparador de cancelación ARCO desligan la ruta y **encolan el archivo en `storage_huerfano_candidato`** (Supabase prohíbe borrar de `storage.objects` desde SQL, 0165); el borrado real lo hace `borrarStorageMarcado` por la Storage API. El plazo de 365 días es una **propuesta**.
- Invitación opcional (`pedir_foto_evidencia`, apagada): el acuse de cada hito agrega «si puedes, manda la foto del sello y escribe “sello”».

## 4. Estadías en andén

`llegada→salida` de **cada parada** (carga y descarga), con la hora exacta del mensaje del chofer (o la declarada por la oficina), de dónde salió, el veredicto de ubicación y las fotos. Fases: `cerrada`, `en_curso` (llegó y no ha salido; los minutos corren), `sin_salida` (viaje cerrado sin salida: **no se inventa** la duración), `incoherente` (salida antes que llegada) y `sin_llegada`.

- **Alerta por exceso** (`estadia_alerta_carga_min` / `estadia_alerta_descarga_min`, `NULL` = apagada, que es el default): UN aviso al patio responsable con la hora exacta de la llegada; claim `alerta_estadia` sobre el hito de llegada; solo dentro de la ventana de la flota; por `enviarConFallback` (ventana abierta → texto; cerrada → `aviso_operacion_v1`).
- **Exportable para cobro**: `GET /v1/estadias?desde=&hasta=&formato=csv|json` (**área `dinero`**; el jefe de tráfico no ve pesos). Reusa `calcularDetencion` y el pacto de `politica_detencion` (0207; el del cliente gana): sin horas libres no hay «excedido», sin tarifa no hay monto, una parada `en_curso` no es cobrable (monto en blanco). CSV con BOM, fórmulas neutralizadas, `X-Estadias-Truncada` si hay más viajes de los que una lectura trae. **Supuesto declarado**: las horas libres del pacto se aplican **por parada**. Es una *propuesta*: el contralor decide y factura.
- Pantalla `/dashboard/agentes/conductores/estadias` (operación, **cero pesos**): periodo, filtros, tiempo medio **solo sobre paradas cerradas** y «sobre N».

## 5. Tablero de hitos (`/dashboard/agentes/conductores`)

- **Línea de tiempo** por viaje con los 5 hitos: hora del mensaje, fuente, contacto en andén, veredicto, fotos y quién actuó desde la oficina y por qué.
- **Semáforo** con la **misma escalera que el agente**: `completo`, `a_tiempo`, `atrasado` (ya pasó el primer recordatorio), `sin_reporte` (escalado, o pasó el umbral de escalación aunque el cron aún no escale), `sin_ancla` (un viaje sin hitos o sin de qué colgarse **no** se pinta verde).
- **Cola de excepciones** (más urgente primero): escalado sin atender (3), sin reporte / sin coincidencia / estadía excedida (2), atrasado / horas incoherentes (1). «Sin dato» **no** es excepción, con una salvedad: un «ya llegué» de un viaje **sin sitio asignado** sale como **«Llegada sin sitio para conciliar»** (1), porque la llegada se sella con el puro aviso del chofer y ninguna posición lo contrastó; la solución es asignar el sitio al viaje (o validarla a mano).
- **Filtros** por patio, cliente, chofer, semáforo y periodo de indicadores; el filtro mueve **todo** lo de debajo.
- **Indicadores** (agregados en SQL, `conductor_indicadores`): tasa de hitos reportados **sin insistencia** (resuelto con a lo más un mensaje del agente en el ciclo vigente y sin escalar), tiempo medio de respuesta (solo donde el agente pidió el hito), escalados, validados con ubicación. Sin datos dice «sin datos», nunca 0. La ventana filtra por `viaje_hito.updated_at` (hitos con actividad en el periodo) y así se rotula.
- **Acciones del jefe** (dueño de flota, encargado y superadmin; **el contador no ve ni la pantalla**; el permiso lo comprueba el servidor, no el botón): **capturar a mano** (hora de México no futura ni anterior a la aceptación; omite los pendientes anteriores), **validar** y **marcar atendido**. Todas con **motivo obligatorio (5–200)** y bitácora `conductor_accion_oficina` (append-only: quién, cuándo, por qué) escrita en la **misma transacción** que el cambio. Un hito capturado queda `fuente = oficina`.

## 6. Servicios para los demás agentes (`conductor/servicios.ts`)

| Servicio | Para quién | Qué entrega |
|---|---|---|
| `estatusViaje(tenant, viaje)` | el futuro **Vigía** | último hito, siguiente hito con su **cita/ETA** (la cita manda), semáforo, y si el chofer está en andén (parada y minutos). No es telemetría y lo dice |
| `estadiasDelPeriodo(...)` / `estadiasDeViaje(tenant, viaje)` | **liquidación** / cobro | las estancias con el pacto de detención aplicado y el monto **propuesto** |
| `evidenciaJornadaDeViaje(tenant, operador, día)` | **jornada** | el último hito del día (cota inferior del **fin**) y el primero (**informativo, NO usable como inicio**) |

**Lo que NO hace, a propósito (jornada)**: no escribe en `jornada_asiento`. (a) `jornada/derivar.ts` ya dejó escrito que «ya llegué» no es «empecé a trabajar»: un inicio derivado de un hito acortaría la jornada registrada; (b) el único escritor de marcas derivadas es el derivador (claims con lease, versionado y la puerta del aviso de privacidad, 0319/0325): un segundo escritor sin esa puerta crearía expedientes de personas que nunca recibieron su aviso. La RPC `asentar_extremo_jornada_derivado` ya admite procedencia `hito_viaje` para el **fin**; engancharla es trabajo del dueño de ese protocolo (ver pendientes). Tampoco se cableó la liquidación (PDF) para consumir las estadías: el servicio está listo y probado.

## 7. Pruebas

- `supabase/tests/0385_conductor_validacion_sitios.sql` corre contra **Postgres real** (CHECKs, unicidad, FK compuestas entre flotas, «solo mejora», atomicidad hito+bitácora, append-only incluso para `service_role`, indicadores, retención/ARCO de la evidencia, RLS —el contador no ve—, funciones no ejecutables por `authenticated`). `0385_conductor_concurrencia.sh` repite lo atómico con **sesiones reales en paralelo** (24 veredictos mezclados, 12 capturas, 12 atenciones, 8 importaciones del mismo catálogo; el importador se serializa por flota con un advisory lock). Las pruebas SQL y la de concurrencia se agregaron (junto con la de la 0380, que faltaba) a `ci-postgres.yml`.
- `conductor/ciclo_completo.e2e.test.ts` (53): ciclo completo con dobles de WhatsApp y el **selector real** `enviarConFallback` — viaje feliz con validación y evidencia, chofer que no contesta (escalera exacta minuto a minuto, patio a los 90, jefe a los 120, «Ya lo atiendo»), fuera de orden, duplicados y corridas solapadas, chofer/flota equivocados, fuera de ventana de 24 h (plantilla del catálogo con los mismos botones, registro de ventana viejo, plantilla sin aprobar, 429), validación sin acusar y aislamiento entre flotas en la misma pasada; y el bloque de P2: el tractor llega y sale solo por geocerca (hitos `sistema` con la hora de la muestra, sin un mensaje del chofer), duplicado y barridos solapados, el que ya avisó manda, flota equivocada, perilla apagada, y la señal de vida (aviso 1 con tres botones, aviso 2, jefe de tráfico, «Sí, estoy», «Voy a cargar», el GPS que vuelve, unidad sin GPS, fuera de ventana).
- `e2e/agente-10-gps.e2e.test.ts` (17): del poll del proveedor al asentador y al barrido de validación; `conectores/tabla_propia/e2e.test.ts`: su CSV de posiciones y geocercas contra la validación de llegada, con el patio alargado junto a la carretera.
- Unitarias: geometría, veredicto, CSV, estadías y su CSV, alertas, evidencia, tablero, acciones y permisos, servicios, rutas `/v1`, pantallas (SSR) y que ninguna pantalla de operación formatea dinero.

## 8. Supuestos y límites (honestos)

- Tolerancia de 150 m, ventana de ±30 min, 12 h de vida de una foto sobre su hito, 3 h de reintento de validaciones sin dato y la regla del semáforo (atrasado = primer recordatorio) son **supuestos de ingeniería**, no mediciones; la flota ajusta los que son perilla.
- El pin de WhatsApp **no trae precisión** (HDOP): no se puede distinguir un pin exacto de uno impreciso. Por eso `sin_coincidencia` no acusa.
- `leerHitosDeOperador` (evidencia de jornada) mira los viajes creados en los 14 días previos al día pedido.
- Las lecturas del tablero/estadías están acotadas (400 viajes activos; 1,500 viajes por periodo) y **lo dicen** cuando recortan.
- Nada se probó contra WhatsApp, GPS ni Storage reales: dobles y fixtures. Los textos ES-MX de las solicitudes de ubicación/foto no pasan por Meta (son texto libre dentro de la ventana de 24 h abierta por el mismo mensaje del chofer); no hay plantilla nueva.

## 9. Pendientes reales

- **Reparto justo del cron** (paquete P9): hoy la cola de hitos se toma por `aceptado_en ASC` cruzando flotas con tope de 400 por pasada, así que con muchas flotas activas una puede quedarse esperando; y el cierre de viajes abiertos viejos. Un `.sh` de concurrencia con sesiones reales sobre el claim de `viaje_hito_aviso` (como el de la 0385).
- **Umbrales de la señal de vida** (45 min sin muestra, 60 min parado, 20 min entre avisos): son supuestos de ingeniería; medirlos con los datos reales de GPS de la flota.
- **Jornada**: enganchar el fin derivado de hitos al derivador con su puerta de aviso de privacidad (la RPC ya acepta `hito_viaje`); y que la **liquidación** consuma `estadiasDeViaje`.
- Evidencia: no hay visor integrado ni recorte/compresión de la foto, ni detección de la foto repetida entre viajes; la retención de 365 días es propuesta.
- Concurrencia: lo nuevo de la 0385 (veredictos, captura/atención de oficina, importador) **sí** se probó con sesiones reales en paralelo (`0385_conductor_concurrencia.sh`). Sigue **sin** probarse así el claim de avisos de la 0380 (`viaje_hito_aviso`): su garantía es un unique y se probó en una sola sesión y con concurrencia simulada en memoria.
- `ci-postgres.yml`: se agregaron las dos líneas SQL; no se ejecutó CI (sin push, por instrucción).
- Aplicar la 0385 (y la 0380) a la base real requiere autorización y respaldo previo; hoy solo se aplicó a una base local desechable.
