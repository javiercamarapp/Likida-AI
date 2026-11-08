import type { PasoTraza } from './respuestas';
import type { Conversacion, Turno } from './use-analista';

/** Los dos modos del agente de conversación. Un solo componente (`AgenteConversacion`), dos adaptadores. */
export type ModoAgente = 'cliente' | 'superadmin';

/** Lo que el adaptador de cada modo le entrega a la interfaz compartida. La interfaz no sabe de endpoints: solo de esto. */
export interface Motor {
  historial: Turno[];
  ocupado: boolean;
  /** Solo mientras el agente genera (lo que se puede detener). */
  generando: boolean;
  documento: { nombre: string } | null;
  setDocumento: (d: null) => void;
  conversacionId: string | null;
  convs: Conversacion[] | 'error' | null;
  errorCarga: string | null;
  fasePensando: string;
  pasosVivos: PasoTraza[];
  preguntar: (q: string) => void;
  repetir: (idTurno: string) => void;
  detener: () => void;
  nuevoChat: () => void;
  cargarConversacion: (id: string) => Promise<boolean>;
  /** Sin esta función el modo no admite adjuntos (el copiloto de superadmin no los tiene) y el clip no se pinta. */
  leerArchivo?: (f: File, limpiar: () => void) => Promise<void>;
  /** Carga la lista del historial a demanda (el panel lateral vive en todas las pantallas y no pide nada a la red hasta que se usa). */
  cargarLista?: () => void;
  /** Anexa el resultado de una acción confirmada al hilo (solo superadmin). */
  anexarResultado?: (mensaje: string) => void;
}
