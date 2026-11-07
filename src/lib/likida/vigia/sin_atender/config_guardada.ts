// La configuración de «sin atender» que CADA flota deja guardada (migración 0999, tabla de una fila por flota). PURO: sin red, sin base.
//   · SIN FILA = TODO APAGADO (falla cerrado): sin horario de atención, sin equipo, palabras de arranque y el resumen por correo apagado.
//   · `validarConfigGuardada` es la validación estricta de lo que escribe quien administra (rechaza con mensaje llano, no corrige).
//   · `normalizarFilaConfig` lee una fila de la base sin lanzar: un valor que no cumple vuelve a su valor apagado.
// Lo que se guarda son ajustes de la flota y los nombres de su personal; NUNCA texto de chats.
import type { ConfigSinAtender, HorarioAtencion } from './tipos';
import { MAX_LARGO_PALABRA, MAX_PALABRAS, MAX_MIN, MENSAJE_HORARIO, horarioValido } from './config';

export const MAX_EQUIPO_NOMBRES = 100;
export const MAX_LARGO_NOMBRE = 80;
export const MAX_INSISTENCIA = 50;

export interface ConfigGuardadaSinAtender {
  /** null = sin horario: la espera cuenta minutos corridos. */
  horarioAtencion: HorarioAtencion | null;
  /** Vacío = se usan las palabras de arranque. */
  palabrasClave: string[];
  palabrasUrgentes: string[];
  /** Nombres tal como salen en el chat. Quien revisa los vuelve un código irreversible; aquí viven tal cual los escribió quien administra. */
  equipoNombres: string[];
  insistenciaMin: number;
  umbralUrgenteMin: number;
  /** Interruptor PROPIO de la flota para el resumen por correo. Se suma a la bandera de plataforma y a los interruptores de plataforma. */
  resumenCorreoHabilitado: boolean;
}

/** Lo que vale cuando no hay fila (o la tabla no existe): todo apagado. Congelado. */
export const CONFIG_GUARDADA_POR_OMISION: Readonly<ConfigGuardadaSinAtender> = Object.freeze({
  horarioAtencion: null,
  palabrasClave: Object.freeze([]) as unknown as string[],
  palabrasUrgentes: Object.freeze([]) as unknown as string[],
  equipoNombres: Object.freeze([]) as unknown as string[],
  insistenciaMin: 2,
  umbralUrgenteMin: 10,
  resumenCorreoHabilitado: false,
});

export const copiaConfigGuardadaPorOmision = (): ConfigGuardadaSinAtender => ({ ...CONFIG_GUARDADA_POR_OMISION, palabrasClave: [], palabrasUrgentes: [], equipoNombres: [] });

const esEntero = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

function limpiar(v: unknown, max: number, largo: number, minusculas: boolean): { lista: string[]; excede: boolean } | null {
  if (!Array.isArray(v)) return null;
  const lista: string[] = [];
  const vistos = new Set<string>();
  let excede = false;
  for (const x of v) {
    if (typeof x !== 'string') return null;
    const t = x.replace(/\s+/g, ' ').trim();
    if (t === '') continue;
    if (t.length > largo) excede = true;
    const k = t.toLowerCase();
    if (vistos.has(k)) continue;
    vistos.add(k);
    lista.push(minusculas ? k : t);
  }
  if (lista.length > max) excede = true;
  return { lista, excede };
}

function horarioNormal(h: HorarioAtencion): HorarioAtencion {
  return h.diasHabiles ? { desdeHora: h.desdeHora, hastaHora: h.hastaHora, diasHabiles: [...new Set(h.diasHabiles)].sort((a, b) => a - b) } : { desdeHora: h.desdeHora, hastaHora: h.hastaHora };
}

/** Validación estricta de lo que llega de un formulario o de una petición. Rechaza con mensaje llano; nunca corrige en silencio. */
export function validarConfigGuardada(entrada: unknown): { ok: true; valor: ConfigGuardadaSinAtender } | { ok: false; error: string } {
  if (entrada === null || typeof entrada !== 'object' || Array.isArray(entrada)) return { ok: false, error: 'La configuración debe ser un conjunto de valores.' };
  const e = entrada as Record<string, unknown>;
  if (!esEntero(e.insistenciaMin) || e.insistenciaMin < 0 || e.insistenciaMin > MAX_INSISTENCIA) return { ok: false, error: `Los mensajes seguidos para insistencia deben ser un número entero de 0 a ${MAX_INSISTENCIA} (0 la apaga).` };
  if (!esEntero(e.umbralUrgenteMin) || e.umbralUrgenteMin < 1 || e.umbralUrgenteMin > MAX_MIN) return { ok: false, error: `El plazo de lo urgente debe ser un número entero de 1 a ${MAX_MIN} minutos.` };
  const clave = limpiar(e.palabrasClave, MAX_PALABRAS, MAX_LARGO_PALABRA, true);
  if (!clave) return { ok: false, error: 'Las palabras de temas importantes deben ser una lista de textos.' };
  if (clave.excede) return { ok: false, error: `Palabras de temas importantes: máximo ${MAX_PALABRAS}, cada una de hasta ${MAX_LARGO_PALABRA} caracteres.` };
  const urgentes = limpiar(e.palabrasUrgentes, MAX_PALABRAS, MAX_LARGO_PALABRA, true);
  if (!urgentes) return { ok: false, error: 'Las palabras que marcan urgencia deben ser una lista de textos.' };
  if (urgentes.excede) return { ok: false, error: `Palabras de urgencia: máximo ${MAX_PALABRAS}, cada una de hasta ${MAX_LARGO_PALABRA} caracteres.` };
  const equipo = limpiar(e.equipoNombres, MAX_EQUIPO_NOMBRES, MAX_LARGO_NOMBRE, false);
  if (!equipo) return { ok: false, error: 'Los nombres del equipo deben ser una lista de textos.' };
  if (equipo.excede) return { ok: false, error: `Nombres del equipo: máximo ${MAX_EQUIPO_NOMBRES}, cada uno de hasta ${MAX_LARGO_NOMBRE} caracteres.` };
  if (e.horarioAtencion !== null && e.horarioAtencion !== undefined && !horarioValido(e.horarioAtencion)) return { ok: false, error: MENSAJE_HORARIO };
  if (typeof e.resumenCorreoHabilitado !== 'boolean') return { ok: false, error: 'Indica si el resumen por correo está encendido o apagado.' };
  return {
    ok: true,
    valor: {
      horarioAtencion: e.horarioAtencion ? horarioNormal(e.horarioAtencion as HorarioAtencion) : null,
      palabrasClave: clave.lista, palabrasUrgentes: urgentes.lista, equipoNombres: equipo.lista,
      insistenciaMin: e.insistenciaMin, umbralUrgenteMin: e.umbralUrgenteMin, resumenCorreoHabilitado: e.resumenCorreoHabilitado,
    },
  };
}

/** Lee una fila de la base (nombres de columna de la 0999). NUNCA lanza: lo que no cumple vuelve a su valor apagado. */
export function normalizarFilaConfig(fila: unknown): ConfigGuardadaSinAtender {
  const f = (fila && typeof fila === 'object' ? fila : {}) as Record<string, unknown>;
  const base = copiaConfigGuardadaPorOmision();
  const lista = (v: unknown, max: number, largo: number, min: boolean): string[] => {
    const r = limpiar(v, max, largo, min);
    return r ? r.lista.filter((x) => x.length <= largo).slice(0, max) : [];
  };
  return {
    horarioAtencion: horarioValido(f.horario_atencion) ? horarioNormal(f.horario_atencion) : null,
    palabrasClave: lista(f.palabras_clave, MAX_PALABRAS, MAX_LARGO_PALABRA, true),
    palabrasUrgentes: lista(f.palabras_urgentes, MAX_PALABRAS, MAX_LARGO_PALABRA, true),
    equipoNombres: lista(f.equipo_nombres, MAX_EQUIPO_NOMBRES, MAX_LARGO_NOMBRE, false),
    insistenciaMin: esEntero(f.insistencia_min) && f.insistencia_min >= 0 && f.insistencia_min <= MAX_INSISTENCIA ? f.insistencia_min : base.insistenciaMin,
    umbralUrgenteMin: esEntero(f.umbral_urgente_min) && f.umbral_urgente_min >= 1 && f.umbral_urgente_min <= MAX_MIN ? f.umbral_urgente_min : base.umbralUrgenteMin,
    // Fail-closed: solo un `true` literal enciende el resumen de la flota.
    resumenCorreoHabilitado: f.resumen_correo_habilitado === true,
  };
}

/** La configuración guardada vista como parcial del motor. Palabras clave vacías => no se pisan las de arranque. */
export function aParcialDelMotor(g: ConfigGuardadaSinAtender): Partial<ConfigSinAtender> {
  return {
    insistenciaMin: g.insistenciaMin,
    umbralUrgenteMin: g.umbralUrgenteMin,
    palabrasUrgentes: g.palabrasUrgentes,
    ...(g.palabrasClave.length > 0 ? { palabrasClave: g.palabrasClave } : {}),
    ...(g.horarioAtencion ? { horarioAtencion: g.horarioAtencion } : {}),
  };
}
