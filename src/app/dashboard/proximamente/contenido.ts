import type { ModuloPerfil } from '@/lib/auth/visibilidad';
import type { ContenidoProximamente } from './proximamente';

/**
 * Qué enseña la pantalla «Próximamente» de cada módulo en fase 2, y a qué
 * pantalla real corresponde (la que se enciende cuando el módulo sale de
 * `MODULOS_PROXIMAMENTE_PERFIL`). Texto fijo: ningún dato de la flota.
 */
export const CONTENIDO_PROXIMAMENTE: Readonly<Partial<Record<ModuloPerfil, ContenidoProximamente & { rutaReal: string }>>> = {
  vigia: {
    nombre: 'Servicio al cliente',
    rutaReal: '/dashboard/agentes/vigia',
    queHara: 'Vigila las conversaciones con tus clientes y te avisa antes de que alguien se quede esperando una respuesta.',
    puntos: [
      'Propone la respuesta y tú la apruebas antes de que salga.',
      'Mide cuánto tiempo lleva cada cliente sin respuesta y escala a la persona indicada.',
      'Detecta clientes molestos y conversaciones atoradas.',
      'Avisa a tus clientes sobre el estado de sus viajes, con tu aprobación.',
    ],
  },
  conductor: {
    nombre: 'Comunicación con operadores',
    rutaReal: '/dashboard/agentes/conductores',
    queHara: 'Se comunica con tus operadores por WhatsApp para que el seguimiento del viaje llegue a tu oficina sin llamadas.',
    puntos: [
      'Pide y registra los hitos del viaje: llegada, carga, descarga y salida.',
      'Controla las estadías y avisa cuando una espera se alarga.',
      'Valida las llegadas contra la ubicación de la unidad.',
      'Escala a tu oficina cuando un operador no responde.',
    ],
  },
};
