/**
 * Mensaje ÚNICO con el que se rechaza guardar una liquidación por la vía vieja (WhatsApp) cuando la flota entrega por
 * correo. Lo comparten `POST /v1/liquidaciones-externas` y el recurso `liquidaciones` del conector TMS: la misma regla
 * y el mismo texto en las dos puertas, para que ninguna deje liquidaciones huérfanas (recibidas pero sin forma de llegar
 * a nadie). Vive aparte (sin imports) para que ambas puertas lo usen sin arrastrar el servicio ni la base.
 */
export const MENSAJE_CANAL_CORREO_SIN_WHATSAPP =
  'Esta flota entrega las liquidaciones por correo, no por WhatsApp. `POST /v1/liquidaciones-externas` solo '
  + 'arma la entrega por WhatsApp: esta liquidación quedaría recibida pero sin forma de llegar a nadie. Usa '
  + '`POST /v1/liquidaciones-externas/desgloses`, que es el camino que además genera y adjunta el Excel por correo.';
