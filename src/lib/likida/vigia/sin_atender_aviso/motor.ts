// Puerta ÚNICA del carril «avisos» hacia el motor de «sin atender». Hoy apunta al stub temporal; el integrador cambia SOLO este
// archivo para que re-exporte de `'../sin_atender'` (la API pública del contrato) y borra `detector_temporal.ts`.
export { CONFIG_SIN_ATENDER_POR_OMISION, normalizarConfigSinAtender, validarConfigSinAtender, detectarSinAtender } from './detector_temporal';
export type {
  AlertaSinAtender, ChatEntrada, ConfigSinAtender, MensajeChat, MotivoSinAtender, NivelAlerta, ResultadoSinAtender, ResumenSinAtender,
} from '../sin_atender/tipos';
