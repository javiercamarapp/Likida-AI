# Vigía: aviso proactivo al cliente

## Privacidad de los datos del operador (T-A4-12)

El aviso puede llevar caja, placas de la caja, estado de la caja, unidad, placas de la unidad y nombre del operador.
La licencia, su vigencia y el teléfono del operador son datos personales de un tercero: **no salen** al cliente salvo
que la dueña de la flota (rol `flota_admin`) los habilite, con constancia de quién y cuándo. Ante cualquier duda
(campo desconocido, constancia incompleta) se ocultan. Código: `src/lib/likida/vigia/aviso/privacidad.ts`.

Pendiente (bloqueo externo B7): la política real de la flota/RH, y el texto del aviso de privacidad para operadores,
que hay que revisar con legal (hoy no existe el aviso para clientes finales). Mientras tanto rige el valor por defecto.

## Fuente automática del programa (T-A4-09)

Hoy el programa de cada terminal entra por subida manual. El contrato `FuenteProgramaDespacho`
(`src/lib/likida/vigia/programa/fuente.ts`) deja lista la interfaz `leer(terminal) -> { contenido, formato, modificadoEn }`;
`SubidaManual` es la implementación vigente y `DriveSinEjecutor` es un stub que falla cerrado («no configurada»): no hace
llamadas de red ni guarda credenciales.

Bloqueo externo B6: el cliente ofreció un correo de acceso de lectura a los Drive/Sheets de cada terminal (la
transcripción lo da dudoso: confirmarlo con él) y falta la cuenta de servicio. Cómo se conectaría, según el correo
real del cliente: OAuth de Google (Drive/Sheets, solo lectura) o Microsoft Graph si resulta ser OneDrive/SharePoint,
con las llaves en el almacén de secretos del despliegue, nunca en el repo (ver la habilidad `conectar-cliente`).
Para leer colores hay que usar la API de Sheets o descargar el xlsx (lector T-A4-08). Hasta entonces: subida manual.
