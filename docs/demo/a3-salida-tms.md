# Demo de Carta Porte: de 5 muestras a «subido al TMS (simulado)»

**Duración:** 5 minutos. **Pantalla:** `/dashboard/carta-porte/documentos`. **Todo es sintético y simulado.**
Las muestras `M1`–`M5` son documentos inventados con la **forma** de los formatos que se reciben (JSON, plantilla del
TMS en Excel, PDF en español, PDF en inglés, Excel de dos pestañas). Ningún dato, nombre ni RFC es real.

> **Regla:** lo simulado jamás se presenta como real. La demo termina en **«Subido al TMS (simulado)»**, con el rótulo
> **Simulado** visible en la tarjeta «Envío al sistema del cliente». No se promete subida real al sistema del cliente,
> ni grupos de WhatsApp, ni timbrado (el timbrado lo hace una persona en el TMS).

## Cómo se enciende (solo flotas sintéticas)

La variable `SALIDA_TMS_SIMULADA` lleva los ids de las flotas sintéticas, separados por coma. Una flota que no está en la
lista **nunca** usa el simulador. Con la flota declarada, el envío «sale» por un puerto que acepta toda plantilla sin
tocar red; la referencia devuelta empieza con `SIMULADO-`. Sin la variable, todo queda como antes (modo manual).

## Guion

| Min | Qué se hace | Qué se ve |
|---|---|---|
| 0:00 | Llega por correo el Excel `M5` (dos pestañas, mismo embarcador, fecha `MM/DD/AAAA`) | Entra a la bandeja; las dos pestañas dan dos embarques; la fecha se normaliza |
| 1:00 | Revisar y aprobar `M5` | Aprobar prepara el envío (no crea viaje ni timbra); la tarjeta dice «Listo para enviar» |
| 1:30 | Modo manual: «Descargar plantilla del TMS» | Se descarga la plantilla `.xlsx` (el destino `.xlsx` sí está en el contrato de exportación: `exportacion.ts`, tipo `FormatoExport`) |
| 2:00 | `M1` (JSON) con el destino vacío | El visor marca el destino como faltante: pide a una persona, no inventa |
| 2:45 | `M3` (PDF sin claves SAT) | El catálogo del cliente completa clave, unidad y fracción; lo que no encuentra queda por confirmar |
| 3:30 | `M4` (PDF en inglés, peso en libras) | El peso se convierte a kilos y queda anotado; los datos fiscales de *Notes* se marcan para revisión |
| 4:15 | `M2` (plantilla del TMS) con un requerimiento que aún no existe | Un solo aviso a la oficina; el envío se reintenta con espera creciente |
| 4:45 | El requerimiento ya existe; corre el envío | La tarjeta dice **«Subido al TMS (simulado)»** con el rótulo **Simulado** |

## Qué decir

- «Esto lee cinco formatos distintos y deja una sola plantilla; una persona revisa lo dudoso.»
- «Aquí el envío es **simulado**: demuestra el recorrido, no sube nada a ningún sistema real.»
- «El timbrado no lo hace Likida: lo sigue haciendo una persona en el TMS.»

## Qué NO decir

«Se subió al sistema», «ya está conectado al TMS», «crea el viaje», «timbra».
