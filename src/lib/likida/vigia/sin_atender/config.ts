// Configuración del motor «sin atender»: defaults, acotado (nunca lanza) y validación estricta (mensaje llano).
import { ZONA_POR_OMISION, NOCHE_POR_OMISION, esFechaValida } from '../turnos';
import type { ConfigSinAtender, HorarioAtencion } from './tipos';

export const MAX_PALABRAS = 30;
export const MAX_LARGO_PALABRA = 40;
export const MAX_EQUIPO_HASHES = 500;
export const MAX_FESTIVOS = 400;
export const MAX_MIN = 1440;
export const MAX_VENTANA_MIN = 10_080;
export const MAX_VISTA_PREVIA = 80;

export const CONFIG_SIN_ATENDER_POR_OMISION: ConfigSinAtender = Object.freeze({
  umbralMin: 30,
  umbralCriticoMin: 10,
  umbralUrgenteMin: 10,
  insistenciaMin: 2,
  insistenciaVentanaMin: 120,
  palabrasUrgentes: Object.freeze([]) as readonly string[],
  palabrasClave: Object.freeze(['embarque', 'embarques']) as readonly string[],
  equipoHashes: Object.freeze([]) as readonly string[],
  ventanaRespuestaMin: null,
  zona: ZONA_POR_OMISION,
  festivos: Object.freeze([]) as readonly string[],
  noche: Object.freeze({ ...NOCHE_POR_OMISION }),
  maxAlertasPorChat: 3,
  vistaPreviaMax: 0,
});

const esEntero = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const zonaValida = (z: unknown): z is string => {
  if (typeof z !== 'string' || !z.trim()) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return true; } catch { return false; }
};
const horaValida = (h: unknown): h is number => esEntero(h) && h >= 0 && h <= 23;

function listaTexto(v: unknown, max: number, largo: number): string[] {
  if (!Array.isArray(v)) return [];
  const salida: string[] = [];
  const vistos = new Set<string>();
  for (const x of v) {
    if (typeof x !== 'string') continue;
    const t = x.trim().slice(0, largo);
    const k = t.toLowerCase();
    if (!t || vistos.has(k)) continue;
    vistos.add(k);
    salida.push(t);
    if (salida.length >= max) break;
  }
  return salida;
}

export const horarioValido = (h: unknown): h is HorarioAtencion => {
  if (!h || typeof h !== 'object' || Array.isArray(h)) return false;
  const x = h as { desdeHora?: unknown; hastaHora?: unknown; diasHabiles?: unknown };
  if (!horaValida(x.desdeHora) || !esEntero(x.hastaHora) || x.hastaHora < 1 || x.hastaHora > 24 || x.hastaHora <= x.desdeHora) return false;
  if (x.diasHabiles === undefined) return true;
  return Array.isArray(x.diasHabiles) && x.diasHabiles.length > 0 && x.diasHabiles.every((d) => esEntero(d) && d >= 0 && d <= 6);
};
export const MENSAJE_HORARIO = 'El horario de atención necesita hora de apertura (0-23), hora de cierre mayor (1-24) y días hábiles de 0 a 6.';

/** Completa y acota (nunca lanza). `avisos` lista lo que se corrigió, en texto llano. */
export function normalizarConfigSinAtender(entrada: Partial<ConfigSinAtender> | null | undefined): { config: ConfigSinAtender; avisos: string[] } {
  const avisos: string[] = [];
  const e = (entrada && typeof entrada === 'object' ? entrada : {}) as Record<string, unknown>;
  const D = CONFIG_SIN_ATENDER_POR_OMISION;

  const entero = (clave: keyof ConfigSinAtender, nombre: string, min: number, max: number): number => {
    const v = e[clave];
    if (v === undefined) return D[clave] as number;
    if (typeof v !== 'number' || !Number.isFinite(v)) { avisos.push(`${nombre} no es un número; se usó ${D[clave] as number}.`); return D[clave] as number; }
    const r = Math.min(max, Math.max(min, Math.round(v)));
    if (r !== v) avisos.push(`${nombre} se ajustó a ${r} (permitido de ${min} a ${max}).`);
    return r;
  };

  const umbralMin = entero('umbralMin', 'El tiempo de espera', 1, MAX_MIN);
  const umbralCriticoMin = entero('umbralCriticoMin', 'El tiempo de espera de grupos críticos', 1, MAX_MIN);
  const umbralUrgenteMin = entero('umbralUrgenteMin', 'El tiempo de espera de mensajes urgentes', 1, MAX_MIN);
  const insistenciaMin = entero('insistenciaMin', 'El número de mensajes seguidos para insistencia', 0, 50);
  const insistenciaVentanaMin = entero('insistenciaVentanaMin', 'La ventana de insistencia', 1, MAX_VENTANA_MIN);
  const maxAlertasPorChat = entero('maxAlertasPorChat', 'El tope de alertas por chat', 1, 20);
  const vistaPreviaMax = entero('vistaPreviaMax', 'El largo de la vista previa', 0, MAX_VISTA_PREVIA);

  let ventanaRespuestaMin: number | null = D.ventanaRespuestaMin;
  if (e.ventanaRespuestaMin === null) ventanaRespuestaMin = null;
  else if (e.ventanaRespuestaMin !== undefined) {
    const v = e.ventanaRespuestaMin;
    if (typeof v !== 'number' || !Number.isFinite(v)) avisos.push('La ventana de respuesta no es un número; cualquier respuesta posterior cierra el mensaje.');
    else {
      ventanaRespuestaMin = Math.min(MAX_VENTANA_MIN, Math.max(1, Math.round(v)));
      if (ventanaRespuestaMin !== v) avisos.push(`La ventana de respuesta se ajustó a ${ventanaRespuestaMin}.`);
    }
  }

  let zona = D.zona;
  if (e.zona !== undefined) { if (zonaValida(e.zona)) zona = e.zona; else avisos.push('La zona horaria no es válida; se usó la de México.'); }

  const festivos = Array.isArray(e.festivos) ? [...new Set((e.festivos as unknown[]).filter(esFechaValida))].sort().slice(0, MAX_FESTIVOS) : [];
  if (Array.isArray(e.festivos) && festivos.length < (e.festivos as unknown[]).length) avisos.push('Se descartaron festivos con fecha inválida o repetida.');

  let noche = { desdeHora: D.noche.desdeHora, hastaHora: D.noche.hastaHora };
  const n = e.noche as { desdeHora?: unknown; hastaHora?: unknown } | undefined;
  if (n && typeof n === 'object') {
    if (horaValida(n.desdeHora) && horaValida(n.hastaHora)) noche = { desdeHora: n.desdeHora, hastaHora: n.hastaHora };
    else avisos.push('La ventana de noche no es válida; se usó de 20:00 a 07:00.');
  }

  let horarioAtencion: HorarioAtencion | undefined;
  if (e.horarioAtencion !== undefined && e.horarioAtencion !== null) {
    if (horarioValido(e.horarioAtencion)) {
      const h = e.horarioAtencion;
      horarioAtencion = h.diasHabiles ? { desdeHora: h.desdeHora, hastaHora: h.hastaHora, diasHabiles: [...new Set(h.diasHabiles)].sort((a, b) => a - b) } : { desdeHora: h.desdeHora, hastaHora: h.hastaHora };
    } else avisos.push('El horario de atención no es válido; se ignoró y la espera cuenta minutos corridos.');
  }

  const hashes = Array.isArray(e.equipoHashes)
    ? [...new Set((e.equipoHashes as unknown[]).filter((h): h is string => typeof h === 'string').map((h) => h.trim().toLowerCase()).filter((h) => /^[0-9a-f]{6,64}$/.test(h)))].slice(0, MAX_EQUIPO_HASHES)
    : [];

  const palabrasUrgentes = e.palabrasUrgentes === undefined ? [] : listaTexto(e.palabrasUrgentes, MAX_PALABRAS, MAX_LARGO_PALABRA);
  const palabrasClave = e.palabrasClave === undefined ? [...D.palabrasClave] : listaTexto(e.palabrasClave, MAX_PALABRAS, MAX_LARGO_PALABRA);
  for (const [k, v] of [['palabras urgentes', e.palabrasUrgentes], ['palabras clave', e.palabrasClave]] as const) {
    if (Array.isArray(v) && v.length > MAX_PALABRAS) avisos.push(`Solo se usan las primeras ${MAX_PALABRAS} ${k}.`);
  }

  return {
    config: {
      umbralMin, umbralCriticoMin, umbralUrgenteMin, insistenciaMin, insistenciaVentanaMin,
      palabrasUrgentes, palabrasClave, equipoHashes: hashes, ventanaRespuestaMin, zona, festivos, noche,
      maxAlertasPorChat, vistaPreviaMax,
      ...(horarioAtencion ? { horarioAtencion } : {}),
    },
    avisos,
  };
}

/** Para lo que llega de un formulario: rechaza con mensaje llano en vez de corregir. */
export function validarConfigSinAtender(entrada: unknown): { ok: true; valor: ConfigSinAtender } | { ok: false; error: string } {
  if (entrada === null || typeof entrada !== 'object' || Array.isArray(entrada)) return { ok: false, error: 'La configuración debe ser un conjunto de valores.' };
  const e = entrada as Record<string, unknown>;
  const rango = (clave: string, nombre: string, min: number, max: number): string | null => {
    const v = e[clave];
    if (v === undefined) return null;
    if (!esEntero(v) || v < min || v > max) return `${nombre} debe ser un número entero de ${min} a ${max}.`;
    return null;
  };
  const errores = [
    rango('umbralMin', 'El tiempo de espera', 1, MAX_MIN),
    rango('umbralCriticoMin', 'El tiempo de espera de grupos críticos', 1, MAX_MIN),
    rango('umbralUrgenteMin', 'El tiempo de espera de mensajes urgentes', 1, MAX_MIN),
    rango('insistenciaMin', 'Los mensajes seguidos para insistencia', 0, 50),
    rango('insistenciaVentanaMin', 'La ventana de insistencia', 1, MAX_VENTANA_MIN),
    rango('maxAlertasPorChat', 'El tope de alertas por chat', 1, 20),
    rango('vistaPreviaMax', 'El largo de la vista previa', 0, MAX_VISTA_PREVIA),
  ].find((x) => x !== null);
  if (errores) return { ok: false, error: errores };
  if (e.ventanaRespuestaMin !== undefined && e.ventanaRespuestaMin !== null && (!esEntero(e.ventanaRespuestaMin) || e.ventanaRespuestaMin < 1 || e.ventanaRespuestaMin > MAX_VENTANA_MIN)) {
    return { ok: false, error: `La ventana de respuesta debe ser vacía o un número entero de 1 a ${MAX_VENTANA_MIN}.` };
  }
  if (e.zona !== undefined && !zonaValida(e.zona)) return { ok: false, error: 'La zona horaria no es válida.' };
  for (const [clave, nombre] of [['palabrasUrgentes', 'Las palabras urgentes'], ['palabrasClave', 'Las palabras clave']] as const) {
    const v = e[clave];
    if (v === undefined) continue;
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) return { ok: false, error: `${nombre} deben ser una lista de textos.` };
    if (v.length > MAX_PALABRAS) return { ok: false, error: `${nombre}: máximo ${MAX_PALABRAS}.` };
    if (v.some((x: string) => x.trim().length > MAX_LARGO_PALABRA)) return { ok: false, error: `${nombre}: cada una de hasta ${MAX_LARGO_PALABRA} caracteres.` };
  }
  if (e.equipoHashes !== undefined && (!Array.isArray(e.equipoHashes) || e.equipoHashes.length > MAX_EQUIPO_HASHES || e.equipoHashes.some((h) => typeof h !== 'string' || !/^[0-9a-fA-F]{6,64}$/.test(h.trim())))) {
    return { ok: false, error: 'La lista del equipo tiene un identificador inválido o demasiados.' };
  }
  if (e.festivos !== undefined && (!Array.isArray(e.festivos) || e.festivos.length > MAX_FESTIVOS || e.festivos.some((f) => !esFechaValida(f)))) {
    return { ok: false, error: 'Los festivos deben ser fechas reales con formato AAAA-MM-DD.' };
  }
  if (e.noche !== undefined) {
    const n = e.noche as { desdeHora?: unknown; hastaHora?: unknown } | null;
    if (!n || typeof n !== 'object' || !horaValida(n.desdeHora) || !horaValida(n.hastaHora)) return { ok: false, error: 'La ventana de noche necesita horas enteras de 0 a 23.' };
  }
  if (e.horarioAtencion !== undefined && e.horarioAtencion !== null && !horarioValido(e.horarioAtencion)) return { ok: false, error: MENSAJE_HORARIO };
  const { config } = normalizarConfigSinAtender(e as Partial<ConfigSinAtender>);
  return { ok: true, valor: config };
}
