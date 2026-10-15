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
