// El resultado de una carga masiva tal como viaja al navegador: solo datos
// serializables, sin nada de servidor (lo importa el Client Component).

export type PasoImportacion = 'previsualizar' | 'confirmar';

export interface ProblemaFilaUI { fila: number; motivo: string }

export interface MuestraFilaUI { fila: number; titulo: string; detalle: string }

export interface InvitacionUI {
  enviadas: number;
  fallidas: Array<{ nombre: string; motivo: string }>;
  pendientesRestantes: number;
  /** Solo si no se pudo ni preparar el envío. */
  error?: string;
}

export interface ResultadoImportacionUI {
  /** Falló TODO (archivo ilegible, base caída, sin permiso): no hay vista previa. */
  error?: string;
  paso: PasoImportacion;
  /** Huella del archivo (SHA-256 truncado): la confirmación comprueba que es el
   *  MISMO que se revisó. */
  huella: string;
  archivo: string;
  /** Filas con datos que se leyeron del archivo. */
  leidas: number;
  /** Se darían de alta (vista previa) o se dieron de alta (confirmación). */
  nuevas: number;
  /** Ya estaban en la flota: no se tocan. */
  yaEstaban: number;
  /** Filas que NO entran, con su motivo (archivo, patio, otra flota, baja). */
  conProblema: number;
  /** Hasta 10 de las que entrarían, para reconocer el archivo. */
  muestra: MuestraFilaUI[];
  /** Hasta `TOPE_PROBLEMAS_UI`; `conProblema` es el total real. */
  problemas: ProblemaFilaUI[];
  patiosDesconocidos: string[];
  /** Avisos que no son error (p. ej. «sin columna de número económico: se usó la placa»). */
  avisos: string[];
  /** El archivo rebasa el tope de filas: se lee a medias y NO se puede confirmar. */
  excedeTope: boolean;
  /** Solo tras confirmar. */
  confirmado?: boolean;
  invitacion?: InvitacionUI | null;
}

export const TOPE_PROBLEMAS_UI = 300;
export const TOPE_MUESTRA_UI = 10;

/** Lo que el importador de viajes dice del seguimiento del agente (T-A5-04). Todo opcional: sin intento no hay frase. */
export interface SeguimientoImportacion {
  creados: number;
  seguimientoActivado?: number;
  seguimientoOmitidoSinVoluntario?: number;
  seguimientoNoDisponible?: boolean;
}

/** Frases llanas para el acuse de la importación; vacío si no se intentó activar seguimiento. */
export function frasesSeguimiento(r: SeguimientoImportacion): string[] {
  if (r.seguimientoNoDisponible) return ['El seguimiento del agente no está disponible todavía: los viajes se importaron igual, sin seguimiento.'];
  if (r.seguimientoActivado === undefined) return [];
  const activados = r.seguimientoActivado;
  const omitidos = r.seguimientoOmitidoSinVoluntario ?? 0;
  const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);
  const frases = [`Se importaron ${r.creados} ${plural(r.creados, 'viaje', 'viajes')}.`];
  frases.push(activados > 0
    ? `${activados} ${plural(activados, 'quedó', 'quedaron')} en seguimiento del agente (operadores del piloto).`
    : 'Ninguno quedó en seguimiento del agente.');
  if (omitidos > 0) {
    frases.push(`${activados > 0 ? 'Los otros ' : 'Los '}${omitidos} no se siguen porque su operador no está en el piloto.`);
  }
  return frases;
}
