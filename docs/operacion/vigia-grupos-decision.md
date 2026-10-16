# Vigía: decisión sobre los grupos de WhatsApp

Estado: **decisión de producto pendiente de tres respuestas externas**. Hoy no se promete leer grupos de WhatsApp; el Vigía trabaja con
conversaciones 1:1 y con el histórico exportado. Este documento dice qué se puede decir al cliente, qué no, y qué falta confirmar.

## Qué se pidió y qué se sabe

- El cliente atiende a sus clientes críticos por grupos de WhatsApp creados desde teléfonos de la propia operación. Pidió que el Vigía
  avise cuando un mensaje de esos grupos pide algo y nadie responde en el plazo que la flota fije.
- La API de WhatsApp Business **no lee los grupos de un WhatsApp común**. La API de grupos de Meta, hasta donde se sabe, aplica solo a
  grupos **creados por el número Business**, con un tope pequeño de participantes (se entiende que hasta 8) y con elegibilidad por
  verificar. **Nada de esto está verificado aquí** (sin acceso a la respuesta de Meta ni a la cuenta real): son notas de investigación,
  no hechos.
- El cliente dijo que el correo es el medio oficial y que por WhatsApp se platica; también que cruzar correos contra consultas por
  WhatsApp le parece complicado. Por eso la conciliación correo-WhatsApp no se construye.

## Opciones

| Opción | Qué es | Costo | Riesgo | Qué se puede decir al cliente |
|---|---|---|---|---|
| a | Los clientes críticos pasan a conversación 1:1 con un número Business | Alta de número y tarifas de conversación de Meta (sin cifra en este documento); cambio de hábito del cliente final | Que el cliente final no acepte dejar el grupo | «El Vigía atiende 1:1 hoy. Para cubrir a un cliente crítico, se migra su conversación al número Business.» |
| b | Grupos nuevos creados por el número Business vía API de grupos | Trabajo de integración y alta de elegibilidad | Elegibilidad no confirmada; tope de participantes; los grupos actuales no se pueden importar | «Se está consultando con Meta si es posible; no hay fecha ni garantía.» |
| c | Exportación periódica del chat de cada grupo crítico, que alimenta pendientes y preguntas frecuentes | Trabajo manual de exportar; ya existe la carga del histórico | No avisa a tiempo: trabaja con datos de ayer, no de ahora | «Se aprende de lo que ya se platicó y se priorizan pendientes; no es una alerta inmediata.» |
| d | Correo como canal paralelo (cruzar correos contra consultas por WhatsApp) | Alto | **Descartada**: el cliente la consideró complicada y no la quiere | Nada: no se ofrece. |

Recomendación de trabajo, sujeta a las respuestas de abajo: **a** para los pocos clientes realmente críticos, **c** para todo lo demás,
y **b** solo si Meta confirma elegibilidad. Mientras tanto, **hoy no se promete** lectura de grupos.

## Preguntas que Javier debe hacer (máximo 6)

1. A Meta o al proveedor del número: ¿la API de grupos está disponible para esta cuenta? ¿Hay un tope de participantes y se pueden
   agregar contactos que no han escrito antes?
2. Al cliente: ¿cuántos grupos tiene y cuántos son críticos?
3. Al cliente: ¿desde qué teléfonos están creados los grupos críticos?
4. Al cliente: ¿aceptarían migrar a los clientes críticos a una conversación 1:1 o a un número Business?
5. Al cliente: ¿pueden exportar periódicamente el chat de los grupos críticos y quién lo haría?
6. Al cliente: ¿cuál es el plazo de aviso que quieren (los «5» y «10» minutos hablados son ejemplos) y si cubre horario completo?

## Lo NO verificado

- Que la API de grupos exista para esta cuenta, su tope de participantes y sus reglas de elegibilidad.
- Cuántos grupos hay, desde qué teléfonos y cuáles son críticos.
- Si el cliente acepta la opción a.
- Costos de Meta: no se anotan cifras porque no se confirmaron.

## Anexo: factibilidad verificada (T-A4-46)

Consulta hecha el **2026-10-15** a la documentación pública vigente de Meta (página «Groups API» y «Group messaging» del portal de
desarrolladores de la plataforma de WhatsApp Business, actualizada por Meta el 2026-10-15). Fuente primaria; los artículos de terceros
solo se usaron para contrastar y no cuentan como verificación. Esto es factibilidad **técnica de la API**, no una respuesta del proveedor
ni de la cuenta real: eso sigue pendiente (ver «Lo NO verificado»).

Fuentes consultadas (todas del portal de desarrolladores de Meta, 2026-10-15):

- https://developers.facebook.com/documentation/business-messaging/whatsapp/groups
- https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/get-started
- https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/reference
- https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/groups-messaging

### Lista de verificación

| Punto | Resultado | Estado |
|---|---|---|
| ¿La API de grupos existe para el número del negocio? | Sí. Abierta a negocios con cuenta oficial verificada (OBA). | Verificado (doc Meta, 2026-10-15) |
| ¿Disponible para cualquier número? | No. Excluye números de la app WhatsApp Business (coexistencia) y números de Multi-solution Conversations. | Verificado (doc Meta) |
| Tope de participantes | 8 por grupo. Si el número del negocio ocupa uno de los 8 no lo dice la fuente primaria. | Tope verificado; ocupación del lugar NO verificada |
| Cantidad de grupos | Hasta 10,000 por número. 1 negocio de Cloud API por grupo. | Verificado (doc Meta) |
| ¿Grupos creados por el número del negocio? | Sí: la API crea el grupo; los participantes entran **solo con liga de invitación** que el negocio les envía. | Verificado (doc Meta) |
| ¿Añadir el número a un grupo que ya existe (creado desde un teléfono de la operación)? | La documentación solo describe grupos creados por la API; no describe unirse a grupos existentes. No hay vía documentada. | No documentado: se trata como NO posible hasta que Meta diga lo contrario |
| Recibir mensajes del grupo | Hay webhook de mensajes de grupo con identificador del grupo y del participante. | Verificado (doc Meta) |
| Menciones (que el cliente «arrobe» al número) | No se encontró texto sobre menciones en lo consultado. | NO verificado |
| ¿Recibe todos los mensajes del grupo o solo los dirigidos al número? | No se encontró texto. | NO verificado |
| Tipos de mensaje | Texto, medios y plantillas de texto o medios. No hay mensajes interactivos, llamadas, editar ni borrar. | Verificado (doc Meta) |
| Plantillas fuera de ventana | Se admiten plantillas en grupos; las plantillas de grupos deben ser propias (no reutilizar las 1:1) y no tienen métricas. Reglas de ventana de 24 h en grupos: no encontradas. | Plantillas verificadas; ventana NO verificada |
| Precio | Por mensaje, con página propia de precios; no se anotan cifras aquí. | Existe tarifa; cifra NO verificada |

### Lo que cambia respecto a las opciones

- **a (1:1 para críticos)**: sin cambios; no depende de la API de grupos.
- **b (grupos nuevos con el número del negocio)**: pasa de «elegibilidad por confirmar» a **técnicamente posible** si el número es de Cloud
  API con cuenta oficial verificada y no está en coexistencia. Pero los grupos actuales **no se pueden importar** y solo caben 8
  personas por grupo: el cliente final tendría que aceptar entrar a un grupo nuevo por liga.
- **c (exportación del chat)**: sin cambios.
- Meter el número en **todos** los grupos existentes de clientes, como se propuso, **no tiene vía documentada**. Es la parte de la idea que
  hoy no se puede afirmar.

### Regla de respuesta (ETA y unidad)

1. La respuesta con ETA o datos de la unidad solo sale si el dato del sistema tiene frescura de **N minutos o menos**. N lo fija la flota
   (el valor de esta ficha es un parámetro, no una cifra decidida; tomar el de los límites de SLA ya configurados).
2. Si no hay dato, o el dato es más viejo que N: no se inventa ni se dice «no sé». Se responde que se conecta al cliente con servicio al
   cliente y se avisa a una persona de servicio al cliente con el viaje consultado (flujo de T-A4-27).
3. La respuesta solo usa campos que el sistema tiene; nunca estima por su cuenta.

### Qué se puede decir hoy al cliente

- «Hoy atendemos conversaciones 1:1 y analizamos el histórico exportado.»
- «Estamos verificando con Meta si es posible un número del negocio en grupos nuevos de hasta 8 personas; no hay fecha ni garantía.»
- Cuando el sistema no tenga el dato, la persona recibe un aviso y servicio al cliente le contesta.
- **No** decir: que el número ya está o estará en sus grupos actuales, que lee grupos en vivo, que contesta cuando lo mencionan, ni cifras de
  costo.

### Pendiente de respuesta externa

- Proveedor del número: si el número actual es de Cloud API con cuenta oficial verificada o está en coexistencia (esto decide si la API
  de grupos aplica).
- Meta: menciones, mensajes recibidos en grupos y reglas de ventana (puntos marcados NO verificado arriba).
- Dueño: si acepta grupos nuevos de hasta 8 o 1:1 para los críticos.
