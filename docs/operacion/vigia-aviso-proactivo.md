# Vigía: aviso proactivo al cliente

## Privacidad de los datos del operador (T-A4-12)

El aviso puede llevar caja, placas de la caja, estado de la caja, unidad, placas de la unidad y nombre del operador.
La licencia, su vigencia y el teléfono del operador son datos personales de un tercero: **no salen** al cliente salvo
que la dueña de la flota (rol `flota_admin`) los habilite, con constancia de quién y cuándo. Ante cualquier duda
(campo desconocido, constancia incompleta) se ocultan. Código: `src/lib/likida/vigia/aviso/privacidad.ts`.

Pendiente (bloqueo externo B7): la política real de la flota/RH, y el texto del aviso de privacidad para operadores,
que hay que revisar con legal (hoy no existe el aviso para clientes finales). Mientras tanto rige el valor por defecto.
