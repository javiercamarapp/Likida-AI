// Puerta ÚNICA del carril «avisos» hacia el motor de «sin atender»: re-exporta la API pública del motor real.
export {
  CONFIG_SIN_ATENDER_POR_OMISION, normalizarConfigSinAtender, validarConfigSinAtender, detectarSinAtender, chatSinEquipoConocido,
  CONFIG_GUARDADA_POR_OMISION, copiaConfigGuardadaPorOmision, validarConfigGuardada, normalizarFilaConfig, aParcialDelMotor,
} from '../sin_atender';
export type {
  AlertaSinAtender, ChatEntrada, ConfigSinAtender, MensajeChat, MotivoSinAtender, NivelAlerta, ResultadoSinAtender, ResumenSinAtender,
} from '../sin_atender/tipos';
export type { ConfigGuardadaSinAtender } from '../sin_atender/config_guardada';
