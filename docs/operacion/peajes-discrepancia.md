# Peajes: protocolo de «discrepancia geográfica»

Para la oficina y seguridad de la flota. Documentos hermanos: [peajes-revision-cobros.md](peajes-revision-cobros.md) y [conciliacion-peajes.md](conciliacion-peajes.md).

## Qué es

Un cruce de TAG que no cuadra con lo que se sabe de la unidad: la flota la declaró en taller o siniestrada (candidato crítico, «Cruce con unidad inmovilizada») o el detector marcó cruces atípicos (por ejemplo, dos cruces seguidos que el tiempo no permite). Es una señal para revisar, **no** una acusación: el número de un TAG puede teclearse en la caseta sin la tarjeta física, y también puede ser un error del proveedor o de captura.

## Qué trae el reporte

El módulo `src/lib/likida/peajes/reporte_discrepancia.ts` arma, para cada caso:

1. **Qué pasó**: el texto llano del detector.
2. **Evidencia**: unidad, TAG, caseta, hora del cruce (hora de México) y la última posición GPS conocida de la unidad. Si no hay posición GPS, el reporte lo dice y no afirma dónde estaba la unidad.
3. **Qué hacer**: confirmar los datos, avisar a seguridad, y si se confirma el uso indebido, pedir al proveedor la baja del TAG.

## A quién se avisa

Al teléfono configurado para el aviso de cruces atípicos (`umbrales.aviso.telefono` de la configuración de atípicos). **Si no hay destinatario configurado, el reporte no se envía a nadie** y lo dice; no se manda «por lo menos» al dueño ni al contador. El protocolo actual del cliente (a quién avisar y en cuánto tiempo) está pendiente de que él lo confirme.

## Pasos del protocolo (propuesta, por confirmar con el cliente)

1. Revisar el reporte y confirmar que las fechas de inmovilización y los datos de la unidad son correctos; si no, corregirlos.
2. Avisar a seguridad con la evidencia del reporte.
3. Seguridad valida con el proveedor quién pasó por la caseta a esa hora.
4. Si se confirma el uso indebido del número, pedir al proveedor la baja del TAG. El sistema **no** bloquea ni da de baja el TAG automáticamente (diferido).
5. Registrar el resultado: justificado, o reclamado al proveedor.

## Fuera de alcance

Bloqueo automático de TAG; acusar a una persona; envío sin destinatario configurado.
