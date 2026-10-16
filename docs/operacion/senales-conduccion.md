# Señales de conducción del proveedor de telemática (spike T-A5-65)

**Para qué sirve.** El Conductor nunca debe escribirle al chofer con la unidad en marcha. La política de las flotas es no usar el
teléfono manejando, y el proveedor de telemática puede detectar «teléfono en la mano» y levantar una incidencia: un mensaje
nuestro con la unidad rodando le da al chofer el argumento «ustedes me lo mandaron». Además, una detención por tráfico o semáforo
no es «estacionado». La compuerta `puedeEscribirAlChofer` (`conductor/compuerta_movimiento.ts`) decide con GPS; este spike
define qué más puede aportarle el proveedor y cómo entra.

**Estado: spike, sin conexión real.** Nada de este documento se ha probado contra una cuenta viva de ningún proveedor.

## Qué señales importan

| Señal | Efecto en la compuerta | Si el proveedor no la da |
| --- | --- | --- |
| Velocidad sostenida > 5 km/h | NO escribe (`conduciendo`), también dentro de un patio | Rige solo-GPS (desplazamiento) |
| Ignición encendida con unidad quieta fuera de un sitio | NO escribe (`ignicion_encendida`): atasco o semáforo | Rige solo-GPS |
| Evento reciente de «teléfono en la mano» | NO escribe: se trata como `conduciendo` | Rige solo-GPS |

Regla común: **ausencia de señal = regla solo-GPS**, la más conservadora (pide 3 muestras quietas o el equivalente lento). Una
lectura de más de 10 minutos, con hora futura o sin hora se descarta; ni frena ni libera.

## Qué campos lee hoy el repo de cada proveedor

Fuente: `conectores/posiciones_proveedores.ts`, `conectores/posiciones.ts` y `conectores/tabla_propia`. «En el repo» = el lector
del repo ya extrae el campo hacia `posicion`; **no** significa que se haya visto en una cuenta real.

| Proveedor | Velocidad | Ignición | Teléfono en la mano |
| --- | --- | --- | --- |
| Wialon | sí (`pos.s`) | no (se guarda `null`) | no |
| Geotab | sí (`speed`) | no (se guarda `null`) | no |
| Navixy | sí (`gps.speed`) | sí (`ignition`, booleano) | no |
| Samsara | sí (`speedMilesPerHour`, convertida a km/h) | no | no |
| Tabla propia de la flota | opcional según su mapeo | opcional según su mapeo | no |

El «teléfono en la mano» no lo lee ningún lector. En Samsara los eventos de seguridad de cámara (`conectores/eventos_seguridad.ts`)
traen etiquetas de distracción y celular según su documentación; falta confirmar con la cuenta real el nombre exacto de la
etiqueta, su latencia y si el scope del token los incluye.

## Cadencia

La cadencia de poleo ya se configura por proveedor o por unidad (`poleoMin`, `poleoPorClaveMin`, T-A5-37). La cadencia real de
ignición y velocidad **no está verificada**: depende del plan y de la configuración de cada flota (típicamente de decenas de
segundos a minutos). La vigencia de 10 minutos de una lectura (`VIGENCIA_SENAL_MIN`) se recalibra cuando haya datos reales.

## Qué falta (bloqueo externo)

1. Una cuenta (o fixtures de contrato reales) del proveedor de la flota para confirmar los campos de ignición y velocidad y su cadencia.
2. Confirmar si el proveedor expone el evento «teléfono en la mano» por API y con qué latencia.
3. Un adaptador por proveedor que implemente `SenalesConduccion` y lea de lo ya asentado en `posicion` o del evento; el cableado
   de `leerSenalExtra` a la compuerta en el flujo real del chofer es T-A5-68.

## Qué hay construido

- `conductor/senales_conduccion.ts`: interfaz `SenalesConduccion`, traducción `aSenalExtra`, lector tolerante a fallos `leerSenalExtra`, puerto apagado `senalesApagadas`,
  doble de prueba `crearDobleSenales` y la tabla `CAPACIDADES_PROVEEDOR` (ninguna `verificadoEnVivo`).
- Nace apagado: sin adaptador, ningún camino real entrega señal y la compuerta cae a solo-GPS. Sin red, sin credenciales y sin
  coordenadas en logs. El perfil de la fase 1 sigue mostrando el Conductor como «Próximamente».
