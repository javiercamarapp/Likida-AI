// Puerta ÚNICA del carril «avisos» hacia el motor de «sin atender»: re-exporta la API pública del motor real.
export {
  CONFIG_SIN_ATENDER_POR_OMISION, normalizarConfigSinAtender, validarConfigSinAtender, detectarSinAtender, chatSinEquipoConocido,
} from '../sin_atender';
export type {
  AlertaSinAtender, ChatEntrada, ConfigSinAtender, MensajeChat, MotivoSinAtender, NivelAlerta, ResultadoSinAtender, ResumenSinAtender,
} from '../sin_atender/tipos';
