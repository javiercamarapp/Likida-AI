// Re-exportación delgada: las notificaciones viven en ui-v2 (K2, fase 0). Mismo API.
export {
  MAX_NOTIFICACIONES, agregarNotificacion, duracionDe, useNotificar, useNotificarResultado, ProveedorNotificaciones,
  type TonoNotificacion, type NuevaNotificacion,
} from '../../ui-v2/componentes/notificaciones';
