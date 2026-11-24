// ═══════════════════════════════════════════════════════════════════════════
// REGLAS POR CLIENTE — lo que cambia de un cliente a otro vive aquí como CONFIGURACIÓN por flota, nunca como código.
//
// Cada cliente de una flota (o el intermediario que le escribe) tiene su horario límite de datos, sus formatos, su forma de
// autorizar y sus requisitos de planta. Este módulo solo define la FORMA de esa configuración y valores por omisión genéricos
// (los que valen para cualquier flota). Los valores reales de cada cliente se cargan por flota, fuera del repositorio.
//
// Regla de oro: lo que no está configurado vale `null` («no configurado»), NUNCA un número inventado. Un `null` hace que el
// motor pida el dato a una persona en vez de afirmar o prometer algo.
// PURO: sin base, sin red, sin modelo.
// ═══════════════════════════════════════════════════════════════════════════

export type Canal = 'whatsapp' | 'correo' | 'ambos';
export type Autoridad = 'cliente' | 'flota' | 'gerencia' | 'dueno';

export const CAMPOS_FICHA_OBLIGATORIOS_POR_OMISION = [
  'linea', 'numeroCaja', 'placasCaja', 'estadoCaja', 'eco', 'placaTracto', 'operadorNombre', 'ref', 'cita',
] as const;

/** Los 8 campos de un QR de acceso (formato genérico de ingreso a recinto). */
export const CAMPOS_QR_POR_OMISION = [
  'operadorNombre', 'placaTracto', 'numeroCaja', 'color', 'anio', 'modelo', 'marca', 'lineaTransportista',
] as const;

/** Catálogo de 6 estados de planta (adoptable como general). */
export const ESTADOS_PLANTA_POR_OMISION = [
  'Esperando acceso',
  'En sitio esperando rampa',
  'En rampa esperando carga',
  'En rampa, carga en proceso',
  'En rampa, cargado esperando liberación',
  'Cargado esperando documentos',
] as const;

/** Lista de verificación de fotos del paquete de salida a ruta (checklist interno, nunca autoriza la salida). */
export const FOTOS_SALIDA_POR_OMISION = [
  'sellos de la caja con número legible', 'sello de botella', 'número de caja visible', 'candado electrónico marcando cerrado',
  'GPS de la caja visible', 'BOL firmado',
] as const;

export interface ReglasPorCliente {
  /** Hora local límite («HH:MM») para entregar la ficha de datos. null = sin límite configurado. */
  horarioLimiteDatos: string | null;
  /** Hora local («HH:MM») en que la flota publica los datos del día siguiente. null = sin acordar. */
  horaPublicacionDatos: string | null;
  /** Canal(es) en que el cliente exige recibir datos. */
  canal: Canal;
  /** El cliente exige copia por correo con la referencia en el asunto. */
  correoConRefEnAsunto: boolean;
  /** El cliente exige PDF (no imagen) para los datos. */
  exigePdf: boolean;
  /** Campos que una ficha debe traer para este cliente (claves de plantilla). */
  camposFichaObligatorios: readonly string[];
  /** Campos del QR de acceso, si el cliente lo usa. */
  camposQr: readonly string[];
  /** Quién autoriza cada decisión. */
  quienAutoriza: {
    salida: Autoridad;
    cambioUnidadOperador: Autoridad;
    cancelacion: Autoridad;
    cobros: Autoridad;
    extraordinarios: Autoridad;
  };
  /** Estados de planta que el cliente reconoce, en orden. */
  estadosPlanta: readonly string[];
  requisitosPlanta: {
    prealertaRequerida: boolean;
    qrRequerido: boolean;
    /** Sin sello registrado el cliente no comparte prealerta. */
    selloAntesDePrealerta: boolean;
    fotosSalida: readonly string[];
  };
  /** Plazo (horas) para entregar el POD tras la entrega. null = sin plazo configurado. */
  plazoPodHoras: number | null;
  /** Documento que el cliente acepta como POD (texto libre configurable). null = no configurado. */
  documentoPod: string | null;
  /** Etiqueta de zona horaria que se muestra junto a cada hora («Centro», «frontera»…). null = no configurada. */
  zonaHoraria: string | null;
  /** Solo se responde a contactos de la lista autorizada del cliente. Endurecer a true es siempre válido. */
  soloContactosAutorizados: boolean;
}

export const REGLAS_POR_OMISION: ReglasPorCliente = Object.freeze({
  horarioLimiteDatos: null,
  horaPublicacionDatos: null,
  canal: 'whatsapp',
  correoConRefEnAsunto: false,
  exigePdf: false,
  camposFichaObligatorios: Object.freeze([...CAMPOS_FICHA_OBLIGATORIOS_POR_OMISION]),
  camposQr: Object.freeze([...CAMPOS_QR_POR_OMISION]),
  quienAutoriza: Object.freeze({ salida: 'cliente', cambioUnidadOperador: 'flota', cancelacion: 'cliente', cobros: 'gerencia', extraordinarios: 'dueno' }),
  estadosPlanta: Object.freeze([...ESTADOS_PLANTA_POR_OMISION]),
  requisitosPlanta: Object.freeze({
    prealertaRequerida: false, qrRequerido: false, selloAntesDePrealerta: false, fotosSalida: Object.freeze([...FOTOS_SALIDA_POR_OMISION]),
  }),
  plazoPodHoras: null,
  documentoPod: null,
  zonaHoraria: null,
  soloContactosAutorizados: true,
}) as ReglasPorCliente;

const esHora = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const esLista = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.length <= 40 && v.every((x) => typeof x === 'string' && x.trim().length > 0 && x.length <= 80);
const esAutoridad = (v: unknown): v is Autoridad => v === 'cliente' || v === 'flota' || v === 'gerencia' || v === 'dueno';
const esObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Mezcla una configuración parcial (típicamente cargada por flota, sin confiar en ella) sobre la base. Todo valor con forma inválida
 * se IGNORA y queda el de la base: nunca lanza. Un `null` explícito en un campo anulable significa «no configurado».
 * Nota: `decidirAccion` no depende de `soloContactosAutorizados` para los datos del operador (siempre exige solicitante verificado).
 */
export function mezclarReglas(base: ReglasPorCliente, parcial: unknown): ReglasPorCliente {
  if (!esObj(parcial)) return base;
  const p = parcial;
  const qa = esObj(p.quienAutoriza) ? p.quienAutoriza : {};
  const rp = esObj(p.requisitosPlanta) ? p.requisitosPlanta : {};
  const hora = (k: 'horarioLimiteDatos' | 'horaPublicacionDatos'): string | null => (p[k] === null ? null : esHora(p[k]) ? (p[k] as string) : base[k]);
  const num = (v: unknown, def: number | null): number | null => (v === null ? null : typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 720 ? v : def);
  const txt = (v: unknown, def: string | null): string | null => (v === null ? null : typeof v === 'string' && v.trim() && v.length <= 120 ? v.trim() : def);
  const bool = (v: unknown, def: boolean): boolean => (typeof v === 'boolean' ? v : def);
  return {
    horarioLimiteDatos: hora('horarioLimiteDatos'),
    horaPublicacionDatos: hora('horaPublicacionDatos'),
    canal: p.canal === 'whatsapp' || p.canal === 'correo' || p.canal === 'ambos' ? p.canal : base.canal,
    correoConRefEnAsunto: bool(p.correoConRefEnAsunto, base.correoConRefEnAsunto),
    exigePdf: bool(p.exigePdf, base.exigePdf),
    camposFichaObligatorios: esLista(p.camposFichaObligatorios) ? p.camposFichaObligatorios : base.camposFichaObligatorios,
    camposQr: esLista(p.camposQr) ? p.camposQr : base.camposQr,
    quienAutoriza: {
      salida: esAutoridad(qa.salida) ? qa.salida : base.quienAutoriza.salida,
      cambioUnidadOperador: esAutoridad(qa.cambioUnidadOperador) ? qa.cambioUnidadOperador : base.quienAutoriza.cambioUnidadOperador,
      cancelacion: esAutoridad(qa.cancelacion) ? qa.cancelacion : base.quienAutoriza.cancelacion,
      cobros: esAutoridad(qa.cobros) ? qa.cobros : base.quienAutoriza.cobros,
      extraordinarios: esAutoridad(qa.extraordinarios) ? qa.extraordinarios : base.quienAutoriza.extraordinarios,
    },
    estadosPlanta: esLista(p.estadosPlanta) ? p.estadosPlanta : base.estadosPlanta,
    requisitosPlanta: {
      prealertaRequerida: bool(rp.prealertaRequerida, base.requisitosPlanta.prealertaRequerida),
      qrRequerido: bool(rp.qrRequerido, base.requisitosPlanta.qrRequerido),
      selloAntesDePrealerta: bool(rp.selloAntesDePrealerta, base.requisitosPlanta.selloAntesDePrealerta),
      fotosSalida: esLista(rp.fotosSalida) ? rp.fotosSalida : base.requisitosPlanta.fotosSalida,
    },
    plazoPodHoras: num(p.plazoPodHoras, base.plazoPodHoras),
    documentoPod: txt(p.documentoPod, base.documentoPod),
    zonaHoraria: txt(p.zonaHoraria, base.zonaHoraria),
    soloContactosAutorizados: bool(p.soloContactosAutorizados, base.soloContactosAutorizados),
  };
}

/** Reglas efectivas de un cliente: omisión genérica + lo configurado por la flota. */
export function reglasDeCliente(configurado: unknown): ReglasPorCliente {
  return mezclarReglas(REGLAS_POR_OMISION, configurado);
}

/** Minutos del día de «HH:MM», o null si no es una hora válida. */
export function minutosDeHora(hhmm: string | null | undefined): number | null {
  if (!hhmm || !esHora(hhmm)) return null;
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}
