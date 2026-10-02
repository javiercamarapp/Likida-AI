import type { ConfigConductor } from './config';
import type { ContactoTrafico } from './escalamiento';

// ═══════════════════════════════════════════════════════════════════════════
// LA PANTALLA DE CONFIGURACIÓN DE FLOTA DEL AGENTE 5 — lo puro: de FormData al cuerpo que ya valida
// `validarCambioConfig` (el MISMO que `PUT /v1/conductor/config`: una sola validación, dos puertas) y de la
// config a los textos que se pintan en los campos.
//
// El formulario SIEMPRE manda todo (una casilla sin marcar no viaja en un FormData: «ausente» es «apagado»),
// así que aquí no hay «solo lo que cambia»: lo que el dueño ve es lo que queda guardado.
// ═══════════════════════════════════════════════════════════════════════════

/** Cuántas filas en blanco se ofrecen para dar de alta contactos nuevos en cada guardado. */
export const FILAS_NUEVAS_CONTACTO = 3;
export const MAX_FILAS_CONTACTO = 20;

export const CASILLAS: ReadonlyArray<keyof ConfigConductor> = [
  'activo', 'usarLlm', 'confirmarAlChofer', 'avisarOficinaLlegada', 'avisarOficinaSalida', 'pedirFotoEvidencia', 'fotoRegistraHito', 'validarUbicacion', 'pedirUbicacion',
];

export const NUMEROS: ReadonlyArray<keyof ConfigConductor> = [
  'escalarTrasMin', 'segundoNivelMin', 'horaInicio', 'horaFin', 'topeDiarioChofer', 'anticipoCitaMin', 'esperaSinCitaMin', 'esperaCargaMin',
  'trayectoSinEtaMin', 'esperaDescargaMin', 'regresoMin', 'posponerMin', 'ventanaCorreccionMin', 'toleranciaUbicacionM', 'ventanaUbicacionMin',
];

/** Alertas de estadía: vacío = apagada (null), no 0. */
export const NUMEROS_OPCIONALES: ReadonlyArray<keyof ConfigConductor> = ['estadiaAlertaCargaMin', 'estadiaAlertaDescargaMin'];

export const NOMBRES_DIA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'] as const;

type Origen = { get(k: string): unknown };
const texto = (fd: Origen, k: string): string => (typeof fd.get(k) === 'string' ? (fd.get(k) as string).trim() : '');

/** «0, 15, 30, 45» → [0, 15, 30, 45]. Un valor que no es número entero no se descarta: se avisa. */
export function leerEscalera(t: string): { ok: number[] } | { error: string } {
  const partes = t.split(/[\s,;]+/).filter((x) => x !== '');
  if (partes.length === 0) return { error: 'Escribe los minutos de la escalera, separados por comas (por ejemplo 0, 15, 30, 45).' };
  const nums = partes.map((p) => (/^\d{1,4}$/.test(p) ? Number(p) : NaN));
  if (nums.some((n) => Number.isNaN(n))) return { error: 'La escalera solo admite minutos enteros separados por comas (por ejemplo 0, 15, 30, 45).' };
  return { ok: nums };
}

export interface FilaContactoForma { nivel: number; nombre: string; telefono: string; terminalId: string }

/** Las filas de contactos que mandó el formulario, sin las vacías. Una fila a medias NO se descarta: la valida el servidor. */
export function leerFilasContacto(fd: Origen): FilaContactoForma[] {
  const n = Math.min(Math.max(Number(texto(fd, 'c_filas')) || 0, 0), MAX_FILAS_CONTACTO + FILAS_NUEVAS_CONTACTO);
  const filas: FilaContactoForma[] = [];
  for (let i = 0; i < n; i++) {
    const nombre = texto(fd, `c_nombre_${i}`);
    const telefono = texto(fd, `c_tel_${i}`);
    // Vaciar el teléfono y el nombre de una fila existente es QUITAR ese contacto.
    if (nombre === '' && telefono === '') continue;
    filas.push({ nivel: Number(texto(fd, `c_nivel_${i}`)) || 1, nombre, telefono, terminalId: texto(fd, `c_patio_${i}`) });
  }
  return filas;
}

/** El cuerpo con la forma de `PUT /v1/conductor/config`, o el error de lectura en palabras. */
export function cuerpoDesdeFormulario(fd: Origen): { ok: Record<string, unknown> } | { error: string } {
  const cuerpo: Record<string, unknown> = {};
  for (const k of CASILLAS) cuerpo[k] = fd.get(`f_${k}`) !== null && fd.get(`f_${k}`) !== undefined && fd.get(`f_${k}`) !== 'no';
  for (const k of NUMEROS) cuerpo[k] = texto(fd, `f_${k}`);
  for (const k of NUMEROS_OPCIONALES) {
    const t = texto(fd, `f_${k}`);
    cuerpo[k] = t === '' ? null : t;
  }
  const esc = leerEscalera(texto(fd, 'f_solicitudesMin'));
  if ('error' in esc) return { error: esc.error };
  cuerpo.solicitudesMin = esc.ok;
  cuerpo.diasSemana = [1, 2, 3, 4, 5, 6, 7].filter((d) => fd.get(`f_dia_${d}`) !== null && fd.get(`f_dia_${d}`) !== undefined);
  cuerpo.contactos = leerFilasContacto(fd).map((f) => ({
    nivel: f.nivel, nombre: f.nombre, telefono: f.telefono, terminalId: f.terminalId === '' ? null : f.terminalId,
  }));
  return { ok: cuerpo };
}

/** Los valores de los campos tal como se pintan (todo texto, listo para `defaultValue`). */
export function valoresDeForma(c: ConfigConductor): Record<string, string> {
  const v: Record<string, string> = { solicitudesMin: c.solicitudesMin.join(', ') };
  for (const k of NUMEROS) v[k] = String(c[k] as number);
  for (const k of NUMEROS_OPCIONALES) v[k] = c[k] === null ? '' : String(c[k]);
  return v;
}

/** ¿Qué llaves cambiaron? Para la bitácora: nombres y valores de configuración, NUNCA teléfonos. */
export function llavesCambiadas(antes: ConfigConductor, despues: ConfigConductor): string[] {
  return (Object.keys(despues) as Array<keyof ConfigConductor>).filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(despues[k])).sort();
}

export function mismosContactos(a: readonly ContactoTrafico[], b: readonly ContactoTrafico[]): boolean {
  const k = (c: ContactoTrafico) => `${c.terminalId ?? ''}|${c.nivel}|${c.telefono}|${c.nombre}`;
  const A = a.map(k).sort(); const B = b.map(k).sort();
  return A.length === B.length && A.every((x, i) => x === B[i]);
}
