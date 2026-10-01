import { opcionesDeEnvio, type ValoresEnvio } from '@/lib/meta/plantillas_catalogo';
import type { BotonAcuse } from '@/lib/meta/client';
import type { PlantillaRespaldo } from '@/lib/meta/enviar_con_fallback';
import { horaYDiaMx } from './mensajes';
import { textoTiempo } from './planificador';
import { ETIQUETA, PREFIJO_BOTON, type HitoFila, type TipoHito } from './tipos';
import type { ViajeContexto } from './repo';

// ═══════════════════════════════════════════════════════════════════════════
// LAS SOLICITUDES Y RECORDATORIOS AL CHOFER, Y EL AVISO AL JEFE — textos puros.
//
// Cada mensaje sale por `enviarConFallback`: ventana de 24 h abierta → texto con
// botones; cerrada → la PLANTILLA del catálogo (plantillas_catalogo.ts), con el
// mismo texto y los mismos botones (payload `<prefijo>:<viaje_id>`). Texto y
// plantilla dicen LO MISMO: el chofer no nota por cuál canal le llegó.
// ═══════════════════════════════════════════════════════════════════════════

export interface MensajeSaliente {
  texto: string;
  botones: BotonAcuse[];
  plantilla: PlantillaRespaldo;
}

function primerNombre(nombre: string | null): string {
  const n = (nombre ?? '').replace(/\s+/g, ' ').trim().split(' ')[0];
  return n ? n.slice(0, 40) : 'chofer';
}

const folioDe = (v: ViajeContexto): string => v.folio || v.id.slice(0, 8);

function lugarDe(v: ViajeContexto, tipo: TipoHito): string {
  const l = (tipo === 'llegada_carga' || tipo === 'salida_carga' ? v.origen : v.destino) ?? '';
  return l.replace(/\s+/g, ' ').trim().slice(0, 60) || 'el lugar del viaje';
}

function b(prefijo: string, viajeId: string, titulo: string): BotonAcuse {
  return { id: `${prefijo}:${viajeId}`, titulo };
}

/** La solicitud (nivel 0) de un hito. */
export function armarSolicitud(hito: HitoFila, v: ViajeContexto, ahora: Date): MensajeSaliente {
  const nombre = primerNombre(v.operadorNombre);
  const folio = folioDe(v);
  const P = PREFIJO_BOTON;
  const valores = (cuerpo: string[]): ValoresEnvio => ({ cuerpo, idsBotones: v.id });

  switch (hito.tipo) {
    case 'llegada_carga': {
      const cita = v.citaOrigenEn ?? v.etaOrigenEn;
      const lugar = lugarDe(v, 'llegada_carga');
      const botones = [b(P.llegadaCarga, v.id, 'Ya llegué'), b(P.retrasoCarga, v.id, 'Voy con retraso'), b(P.pedirUbicacion, v.id, 'Compartir ubicación')];
      if (cita) {
        const hora = horaYDiaMx(new Date(cita), ahora);
        return {
          texto: `Hola ${nombre}, tu viaje ${folio} tiene cita de carga en ${lugar} a las ${hora}. Cuando llegues, toca «Ya llegué» para registrar tu llegada.`,
          botones,
          plantilla: { nombre: 'conductor_solicitud_llegada_carga_v1', ...opcionesDeEnvio('conductor_solicitud_llegada_carga_v1', valores([nombre, folio, lugar, hora])) },
        };
      }
      return {
        texto: `Hola ${nombre}, tu viaje ${folio} carga en ${lugar}. Cuando llegues, toca «Ya llegué» para registrar tu llegada.`,
        botones,
        plantilla: { nombre: 'conductor_llegada_carga_sin_cita_v1', ...opcionesDeEnvio('conductor_llegada_carga_sin_cita_v1', valores([nombre, folio, lugar])) },
      };
    }
    case 'salida_carga':
      return {
        texto: `Hola ${nombre}, ¿ya saliste de la carga del viaje ${folio}? Toca «Ya salí» para registrar tu salida y manda por aquí la foto de tu carta porte o remisión.`,
        botones: [b(P.salidaCarga, v.id, 'Ya salí'), b(P.sigueCargando, v.id, 'Sigo cargando')],
        plantilla: { nombre: 'conductor_salida_carga_v1', ...opcionesDeEnvio('conductor_salida_carga_v1', valores([nombre, folio])) },
      };
    case 'llegada_descarga': {
      const lugar = lugarDe(v, 'llegada_descarga');
      return {
        texto: `Hola ${nombre}, tu viaje ${folio} descarga en ${lugar}. Cuando llegues, toca «Ya llegué» para registrar tu llegada.`,
        botones: [b(P.llegadaDescarga, v.id, 'Ya llegué'), b(P.pedirUbicacion, v.id, 'Compartir ubicación')],
        plantilla: { nombre: 'conductor_llegada_descarga_v1', ...opcionesDeEnvio('conductor_llegada_descarga_v1', valores([nombre, folio, lugar])) },
      };
    }
    case 'salida_descarga':
      return {
        texto: `Hola ${nombre}, ¿ya terminaste de descargar el viaje ${folio}? Toca «Ya salí» para registrar tu salida y manda por aquí la foto del comprobante de entrega.`,
        botones: [b(P.salidaDescarga, v.id, 'Ya salí'), b(P.sigueDescargando, v.id, 'Sigo descargando')],
        plantilla: { nombre: 'conductor_salida_descarga_v1', ...opcionesDeEnvio('conductor_salida_descarga_v1', valores([nombre, folio])) },
      };
    case 'regreso':
      return {
        texto: `Hola ${nombre}, ya registramos tu salida de la descarga del viaje ${folio}. Cuando vayas de regreso, toca «Voy de regreso» para avisarnos.`,
        botones: [b(P.regreso, v.id, 'Voy de regreso'), b(P.aunNoRegreso, v.id, 'Aún no')],
        plantilla: { nombre: 'conductor_solicitud_regreso_v1', ...opcionesDeEnvio('conductor_solicitud_regreso_v1', valores([nombre, folio])) },
      };
  }
}

/** El recordatorio `nivel` (1, 2, 3+) de un hito; `minutosPendiente` = desde que tocaba. */
export function armarRecordatorio(hito: HitoFila, v: ViajeContexto, nivel: number, minutosPendiente: number): MensajeSaliente {
  const nombre = primerNombre(v.operadorNombre);
  const folio = folioDe(v);
  const que = ETIQUETA[hito.tipo].chofer;
  const tiempo = textoTiempo(minutosPendiente);
  const botones = [b(PREFIJO_BOTON.recordatorioRegistrar, v.id, 'Registrar ahora'), b(PREFIJO_BOTON.recordatorioProblema, v.id, 'Tengo un problema')];
  const n = Math.min(Math.max(nivel, 1), 3);

  if (n === 1) {
    return {
      texto: `Hola ${nombre}, todavía no tenemos registrado «${que}» del viaje ${folio}. Toca «Registrar ahora» o responde por aquí.`,
      botones,
      plantilla: { nombre: 'conductor_recordatorio_1_v1', ...opcionesDeEnvio('conductor_recordatorio_1_v1', { cuerpo: [nombre, que, folio], idsBotones: v.id }) },
    };
  }
  if (n === 2) {
    return {
      texto: `Hola ${nombre}, segundo aviso: sigue pendiente «${que}» del viaje ${folio} desde hace ${tiempo}. Si ya lo hiciste, toca «Registrar ahora»; si tienes un problema, dinos qué pasó.`,
      botones,
      plantilla: { nombre: 'conductor_recordatorio_2_v1', ...opcionesDeEnvio('conductor_recordatorio_2_v1', { cuerpo: [nombre, que, folio, tiempo], idsBotones: v.id }) },
    };
  }
  return {
    texto: `Hola ${nombre}, último aviso antes de avisar a tu jefe de tráfico: «${que}» del viaje ${folio} sigue pendiente desde hace ${tiempo}. Responde ahora para evitar la escalación.`,
    botones,
    plantilla: { nombre: 'conductor_recordatorio_3_v1', ...opcionesDeEnvio('conductor_recordatorio_3_v1', { cuerpo: [nombre, que, folio, tiempo], idsBotones: v.id }) },
  };
}

export type MotivoEscalacion = 'sin_respuesta' | 'sin_telefono' | 'problema_reportado';

const TEXTO_MOTIVO: Record<MotivoEscalacion, (n: number) => string> = {
  sin_respuesta: (n) => `sin respuesta a ${n} ${n === 1 ? 'aviso' : 'avisos'}`,
  sin_telefono: () => 'el chofer no tiene teléfono registrado',
  problema_reportado: () => 'el chofer reportó un problema',
};

/** El aviso al jefe de tráfico (nivel 1 = patio responsable, 2 = jefe general), con botón «Ya lo atiendo». */
export function armarEscalacion(
  hito: HitoFila, v: ViajeContexto, nivel: 1 | 2, motivo: MotivoEscalacion, avisosAlChofer: number, ubicacion: string,
): MensajeSaliente {
  const chofer = (v.operadorNombre ?? 'El chofer').replace(/\s+/g, ' ').trim().slice(0, 60) || 'El chofer';
  const folio = folioDe(v);
  const que = `su ${ETIQUETA[hito.tipo].corta}`;
  const porque = TEXTO_MOTIVO[motivo](avisosAlChofer);
  const prefijo = nivel === 2 ? 'Segundo aviso, nadie del patio lo atendió. ' : '';
  return {
    texto: `${prefijo}Atención, jefe de tráfico: ${chofer} no ha registrado «${que}» del viaje ${folio} (${porque}). Última ubicación conocida: ${ubicacion}. Revísalo en el tablero o llámale.`,
    botones: [b(PREFIJO_BOTON.jefeAtiendo, v.id, 'Ya lo atiendo')],
    plantilla: {
      nombre: 'aviso_jefe_trafico_v1',
      ...opcionesDeEnvio('aviso_jefe_trafico_v1', { cuerpo: [chofer, que, folio, porque, ubicacion], idsBotones: v.id }),
    },
  };
}

