# Vigía: aviso proactivo al cliente

Guía de operación del aviso de viaje (Agente 4). Qué hace, cómo se enciende, cómo se apaga y qué hacer cuando algo falla. El estado general del Vigía
está en [vigia-cliente.md](vigia-cliente.md); el apagado de emergencia y la reversión de las migraciones, en [vigia-aviso-rollback.md](vigia-aviso-rollback.md);
la decisión sobre grupos de WhatsApp, en [vigia-grupos-decision.md](vigia-grupos-decision.md); las plantillas de Meta, en [vigia-meta-checklist.md](vigia-meta-checklist.md).

> Estado al 15-oct-2026: construido y probado con dobles y contra una base local de pruebas. Las migraciones 0795–0799 **no están aplicadas en una base
> real**, el aviso no ha salido a ningún cliente real y las plantillas de Meta no están sometidas. Nada de lo de abajo es «en producción».

## Qué es

Hoy alguien de la flota arma a mano, servicio por servicio, un mensaje con la caja, las placas de la caja, la unidad, sus placas y el operador asignado,
y lo manda al cliente horas antes de la carga. El aviso proactivo lo arma el sistema a partir del programa de despacho de cada terminal y lo deja en una
bandeja para que una persona lo revise (botones «Confirmar y enviar», «Editar», «Copiar y marcar enviado» y «Descartar»). **Por omisión no manda nada solo.**

## El camino de un aviso

```
programa de despacho (Excel/CSV que sube el ejecutivo)
   │  /dashboard/agentes/vigia/programa  → lector → normalizador → filas con historia de cambios (0795)
   ▼
¿LISTO?  caja + unidad + carta porte en el conjunto que la flota eligió  (proxy hoy; color cuando exista la leyenda)
   ▼
RESOLVER  cliente (por alias de la flota) → contacto autorizado → unidad → caja → operador   (0796)
   ▼
COMPONER  texto del aviso con solo los datos que la política de privacidad deja salir
   ▼
AVISO  queda en la bandeja (0797)  →  pendiente_confirmacion      /dashboard/agentes/vigia/avisos
   ▼
CONFIRMACIÓN  una persona lo ve, lo corrige si hace falta y lo aprueba (o lo descarta)
   ▼
ENTREGA  canal ejecutivo_copia: el ejecutivo copia el texto a su chat y pulsa «Copiar y marcar enviado»
         canal cliente_1a1: mensaje directo al contacto del cliente (texto dentro de 24 h, plantilla fuera)
   ▼
enviado  ──(si el programa cambia)──►  nueva versión «cambió la unidad: A → B», otra vez por confirmación
```

Quién lo mueve: el cron `/api/cron/vigia`. La pasada de avisos (generar, entregar lo aprobado y contar la cola atorada) corre **al final de la pasada de
mantenimiento, cada 5 minutos**, no cada minuto, con el mismo reloj que el escalamiento y aislada: si falla, lo demás del Vigía sigue.

Estados de un aviso (`vigia_aviso.estado`; las transiciones las hace cumplir la base):
`borrador → pendiente_confirmacion → aprobado → enviado | fallido`; `sin_destinatario` (no se supo a quién mandarlo: queda visible);
`descartado` y `reemplazado` (por una versión posterior). `enviado`, `descartado` y `reemplazado` son historia y no se editan. Un `fallido` no se reenvía
solo: una persona lo vuelve a `aprobado`. Así no hay reintento infinito ni doble envío.

## «Listo»: proxy hoy, color cuando haya leyenda

La regla de «esta fila ya se puede avisar» (`aviso/listo.ts`) es **provisional y se rotula como tal** («proxy: regla provisional hasta tener el archivo con
colores»): en el CSV del programa no hay una columna «validado», así que se usa **caja + unidad + carta porte en un conjunto configurable** (por omisión
`LISTO` o `DESPACHADO`). Configurable por flota: el conjunto de estatus de carta porte, si un tránsito bloqueante (por ejemplo, pendiente de cruce)
impide avisar, y las secciones del programa que cuentan.

- **Falla cerrado.** Ante la duda (sección no elegible, dato faltante, conflicto entre color y proxy) **no se avisa**.
- Una fila de **cancelaciones** nunca es «lista», aunque la flota la habilite.
- **El color** (la celda verde o amarilla del Excel del ejecutivo) solo decide si hay una leyenda de colores configurada por la flota. Sin leyenda, o con un color
  sin mapear, nunca se decide por color. Si el color contradice al proxy se devuelve `conflicto` y no se avisa. El mapa de colores en la pantalla de
  configuración dice «Esperando el archivo con colores» hasta que exista la leyenda real: **no se inventa**.
- El lector de xlsx con colores existe y está probado con fixtures sintéticos; falta el archivo real del cliente (bloqueo externo).

## Qué lleva el aviso y qué no

Lleva caja, placas de la caja, estado de la caja, unidad, placas de la unidad y nombre del operador, **solo si el dato existe y la política lo permite**.
Cada dato conserva de dónde salió (sistema, captura a mano o catálogo). Lo que falta aparece como pendiente en la tarjeta de la bandeja, no se inventa.
Un aviso incompleto nunca sale en automático.

La licencia, su vigencia y el teléfono del operador **no salen al cliente** salvo que la dueña de la flota los habilite (ver «Privacidad» más abajo).

## Qué NO hace

- **No lee grupos de WhatsApp en vivo, ni promete leerlos.** La API de WhatsApp Business no lee los grupos de un WhatsApp común. Ver
  [vigia-grupos-decision.md](vigia-grupos-decision.md).
- **No contesta solo.** El alcance inicial es avisar y priorizar (`vigia_config.solo_avisar`, 0798). El aviso de viaje es un mensaje **estructurado** (plantilla),
  no texto libre, y no abre conversación.
- **No envía sin una persona al inicio.** El modo `confirmar` es el de nacimiento; el modo `autonomo` se gana por cliente (ver abajo) y aun así nunca aplica a un aviso
  incompleto, a un cliente con su interruptor apagado ni a una cancelación.
- **No manda cancelaciones ni correcciones solo.** Si el servicio se cancela tras haber avisado, queda un borrador «Se canceló el servicio…» por confirmar.
- **No «des-envía».** Un aviso enviado no se puede retirar (ver [vigia-aviso-rollback.md](vigia-aviso-rollback.md)).
- **No toma el estatus de importación de una fuente que no existe.** El estatus por caja (patio, pendiente de cruce, en ruta) se deriva del programa; el
  formato real del control de unidad de la plataforma de seguimiento se desconoce y no está conectado.
- **No lee el Drive/Sheets del cliente.** La entrada es la subida manual del archivo; la fuente automática es una interfaz sin ejecutor (ver el final).
- **No calcula ahorros ni porcentajes.** Cualquier cifra de impacto necesita una línea base que hoy no existe.

## Reenvío si el programa cambia

Un aviso dado puede quedar viejo («todavía me los pueden cambiar», por ejemplo cuando un operador se niega a un viaje). Cada pasada revisa los avisos de los
últimos 7 días:

- Si cambió lo que el cliente ve (caja, unidad, operador, placas), nace **otra versión** con las líneas «cambió la unidad: A → B». La versión enviada no se toca.
- **Anti-ruido:** se espera `debounce_min` minutos de calma tras el último cambio (10 por omisión), hay un máximo de reenvíos por servicio (`max_reenvios`, 3 por omisión)
  y no se reenvía lo que no cambia nada visible. Pasado el máximo no se manda nada: queda una **alerta interna** «cambia demasiado» en la bandeja.
- El cambio de color o de estatus **no** cuenta como cambio visible (decisión abierta con el cliente).
- El cambio de la cita no tiene renglón en el texto del aviso y no genera reenvío.
- Durante la primera ventana de autonomía de un cliente (`diasCambioOperadorConfirma`, 7 días), un reenvío por cambio de operador exige confirmación humana.

## Modo, canal y ventana de envío

| Ajuste | Valores | Por omisión | Dónde |
|---|---|---|---|
| Encendido | `habilitado` | **apagado** (sin fila de configuración = apagado) | pantalla de avisos, solo la dueña (`flota_admin`) |
| Modo | `confirmar` / `autonomo` | `confirmar` | ídem |
| Canal | `ejecutivo_copia` / `cliente_1a1` | `ejecutivo_copia` | ídem |
| Horas antes de la cita (`horas_antes_cita`) | 0–72, vacío = en cuanto esté listo | vacío | ídem |
| Ventana de envío (`ventana_envio`) | `{}` sin restricción, o `{ desde, hasta }` en HH:MM; si desde > hasta cruza la medianoche | sin restricción | ídem |
| Zona horaria (`zona`) | zona IANA | `America/Mexico_City` | base |
| Reenvíos y calma | `max_reenvios` 0–20, `debounce_min` 0–1440 | 3 y 10 | pantalla |
| Confirmaciones para ganar el autónomo | `autonomo_min_confirmaciones` 0–1000 | 5 | pantalla |

- **Modo autónomo.** Se gana por cliente: hacen falta N confirmaciones consecutivas **sin editar**; cualquier edición humana o fallo reinicia la cuenta. El interruptor
  de un cliente lo devuelve siempre a confirmar. Hasta tener evidencia, dejar `confirmar`.
- **Ventana de envío.** Lo que impide enviar por la hora **no consume** el aviso: sigue `aprobado` y sale en la pasada siguiente dentro de la ventana. Una
  ventana ilegible se trata como cerrada (falla cerrado).
- **Tiempos de generación** con N = `horas_antes_cita` y cita C: antes de C − N no se genera; después de C ya no (avisar un equipo de un viaje que salió no sirve);
  una cita sin hora («DIRECTO») o N vacío se genera en cuanto la fila está lista. Se mira el día de hoy y las 48 h siguientes; a lo sumo 200 filas por pasada
  (el resto entra en la siguiente).
- **Canal `ejecutivo_copia`:** el aviso queda `enviado` cuando el ejecutivo pulsa «Copiar y marcar enviado»; el sistema no toca a Meta para eso. Opcionalmente le
  manda el texto al WhatsApp del ejecutivo (una vez por aviso) y eso no cambia el estado.
- **Canal `cliente_1a1`:** pasa por todas las puertas del Vigía: agente encendido, contacto de esa flota, activo, con consentimiento y sin baja (BAJA), texto acotado y
  selector de ventana de 24 h (dentro, texto; fuera, plantilla del catálogo, jamás texto libre). Las plantillas son `vigia_aviso_viaje_v1` y `vigia_aviso_cambio_v1`
  (para reenvíos); mientras Meta no las apruebe, fuera de 24 h el envío se rechaza (código 132001) y el aviso queda `fallido` con un motivo llano.

## Privacidad y datos personales

Política (`aviso/privacidad.ts`, tabla `vigia_politica_datos`): ante cualquier duda —campo desconocido, constancia incompleta, sin regla— **se oculta**. Hay una regla
general de la flota y reglas por cliente que mandan sobre ella. Habilitar la licencia, la vigencia o el teléfono del operador deja constancia de quién y cuándo.
`vigia_aviso.datos` guarda **qué campos entraron y de dónde salieron**, no teléfonos ni licencias; `error` guarda un código o una frase corta, nunca el cuerpo de la
respuesta de un tercero. Los registros del sistema (`vigia.aviso.*`) llevan solo contadores y códigos: ni texto, ni cliente, ni operador, ni teléfono, ni placas.

Pendiente de la flota y del área legal (bloqueo externo B7): la política real sobre datos del operador y el aviso de privacidad para operadores y clientes finales. Hasta
entonces rige el valor por omisión (oculto). La cancelación de un operador por derechos ARCO **anonimiza** al operador pero no dispara el borrado en cascada de lo capturado a
mano en `vigia_dato_viaje_manual`: limpiarlo desde ARCO exige redefinir esa función en una migración posterior, que no existe todavía. Hasta entonces, esa captura se
borra a mano por solicitud.

## Encender el aviso, paso a paso (cuando haya base real)

Nada de esto se hace sin la autorización del dueño de la plataforma; cada paso tiene su verificación.

1. **Migraciones.** Aplicar 0795 a 0799 en orden, con copia de seguridad de la base antes (ver [vigia-aviso-rollback.md](vigia-aviso-rollback.md)). Verificar que `/api/health`
   dice que la base no va atrás de `supabase/migrations`.
2. **Plantillas.** Someter a Meta las del Vigía ([vigia-meta-checklist.md](vigia-meta-checklist.md)). Sin ellas el canal `cliente_1a1` solo sirve dentro de la ventana de 24 h;
   el canal `ejecutivo_copia` no las necesita.
3. **Programa.** En `/dashboard/agentes/vigia/programa`, subir el archivo del día de una terminal y leer lo que se entendió (filas, días, las que no se pudieron leer y por qué).
   Si el resumen no coincide con el archivo, no seguir.
4. **Clientes y contactos.** Dar de alta los clientes con su alias (es lo que une una fila del programa con un cliente) y su contacto autorizado, con constancia de consentimiento.
   Un alias repetido deja el aviso en «cliente ambiguo»: no se adivina.
5. **Catálogo.** Cargar las unidades y las cajas (número, placas, estado) y, para los operadores que el sistema no conoce, la captura a mano por servicio.
6. **Privacidad.** Revisar la regla general de la flota. Dejar licencia, vigencia y teléfono apagados.
7. **Configuración.** En `/dashboard/agentes/vigia/avisos` (solo la dueña): modo `confirmar`, canal `ejecutivo_copia`, el conjunto de carta porte que cuenta como listo,
   las horas antes de la cita y la ventana de envío. **Encender al final.**
8. **Primera pasada.** Esperar hasta 5 minutos. Los avisos aparecen en la bandeja como `pendiente_confirmacion`. Revisar uno por uno contra el programa.
9. **Seguimiento.** Vigilar `/admin/crons`: el latido del Vigía cuenta `avisosCreados`, `avisosEnviados`, `avisosFallidos` y `avisosPendientesViejos`.
10. **Pasar a `cliente_1a1` o a `autonomo` solo con evidencia**: plantillas aprobadas, avisos confirmados sin editar, y el visto bueno del cliente.

## Apagado de emergencia

`vigia_aviso_config.habilitado = false` (pantalla o SQL). Detalle, limpieza de la cola y reversión de migraciones en
[vigia-aviso-rollback.md](vigia-aviso-rollback.md). Un aviso ya enviado no se puede retirar.

## Estados vacíos y errores comunes

| Lo que se ve | Qué significa | Arreglo |
|---|---|---|
| «Aún no hay avisos de viaje. Cuando el programa del día tenga servicios con caja y unidad, aparecerán aquí para que los revises.» | No hay filas listas en hoy ni en las próximas 48 h, o el aviso está apagado | Subir el programa; revisar el conjunto de carta porte «listo» y que el aviso esté encendido |
| «El aviso de viaje está apagado: no se arman ni se envían avisos nuevos hasta que el dueño lo encienda.» | Sin fila de configuración o `habilitado = false` | La dueña lo enciende en la pantalla de avisos |
| «No hay avisos esperando a nadie.» | Todo lo armado ya se envió o se descartó | Nada |
| Aviso en `sin_destinatario` | No se resolvió a quién mandarlo: `sin_cliente`, `cliente_ambiguo`, `sin_contacto` | Dar de alta el alias o el contacto autorizado y después pasar el aviso otra vez a confirmación (la base permite `sin_destinatario` → `pendiente_confirmacion`); la generación no lo rehace sola, porque una fila que ya tiene un aviso no genera otro |
| Aviso con campos pendientes (`sin_unidad`, `unidad_no_registrada`, `unidad_ambigua`, `sin_caja`, `sin_operador`) | Falta el dato en el programa o en el catálogo | Completarlo (catálogo o captura a mano) y revisar la tarjeta en la bandeja; si el contenido cambia, nace otra versión |
| Aviso `fallido` | Falló el envío: sin consentimiento, plantilla no aprobada (132001), número sin WhatsApp, rechazo de Meta | Leer el motivo en la tarjeta, corregir y volver a aprobar |
| Aviso `pendiente_confirmacion` por más de 2 horas | Nadie lo revisó; cuenta en `avisosPendientesViejos` y el latido queda `parcial` | Revisar la bandeja; si es recurrente, ver quién confirma y a qué hora |
| Latido `parcial` con `avisosFallidos` | Hubo fallos de envío en la pasada. Con 3 o más en la misma pasada se avisa por correo al operador del sistema (a lo sumo uno por hora) | Revisar la bandeja de fallidos |
| «Cambia demasiado» (alerta interna) | Una fila superó `max_reenvios` | Revisar el programa con el ejecutivo; no se envía más solo |
| «La base de datos todavía no está lista para guardar el programa» o «…para los avisos de viaje. Avísale a soporte.» | 42P01 / PGRST205: la 0795 o la 0797 no están en esa base | Aplicar las migraciones |
| No salen avisos pero todo está encendido | Fuera de la ventana de envío, o la pasada de 5 minutos aún no corrió | Revisar `ventana_envio` y la zona; esperar la siguiente pasada |

---

## Detalle de dos piezas

### Privacidad de los datos del operador (T-A4-12)

El aviso puede llevar caja, placas de la caja, estado de la caja, unidad, placas de la unidad y nombre del operador.
La licencia, su vigencia y el teléfono del operador son datos personales de un tercero: **no salen** al cliente salvo
que la dueña de la flota (rol `flota_admin`) los habilite, con constancia de quién y cuándo. Ante cualquier duda
(campo desconocido, constancia incompleta) se ocultan. Código: `src/lib/likida/vigia/aviso/privacidad.ts`.

Pendiente (bloqueo externo B7): la política real de la flota/RH, y el texto del aviso de privacidad para operadores,
que hay que revisar con legal (hoy no existe el aviso para clientes finales). Mientras tanto rige el valor por defecto.

### Fuente automática del programa (T-A4-09)

Hoy el programa de cada terminal entra por subida manual. El contrato `FuenteProgramaDespacho`
(`src/lib/likida/vigia/programa/fuente.ts`) deja lista la interfaz `leer(terminal) -> { contenido, formato, modificadoEn }`;
`SubidaManual` es la implementación vigente y `DriveSinEjecutor` es un stub que falla cerrado («no configurada»): no hace
llamadas de red ni guarda credenciales.

Bloqueo externo B6: el cliente ofreció un correo de acceso de lectura a los Drive/Sheets de cada terminal (la
transcripción lo da dudoso: confirmarlo con él) y falta la cuenta de servicio. Cómo se conectaría, según el correo
real del cliente: OAuth de Google (Drive/Sheets, solo lectura) o Microsoft Graph si resulta ser OneDrive/SharePoint,
con las llaves en el almacén de secretos del despliegue, nunca en el repo (ver la habilidad `conectar-cliente`).
Para leer colores hay que usar la API de Sheets o descargar el xlsx (lector T-A4-08). Hasta entonces: subida manual.
