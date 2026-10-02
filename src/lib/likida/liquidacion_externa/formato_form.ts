// ═══════════════════════════════════════════════════════════════════════════
// LIQUIDACIÓN EXTERNA — lo que la pantalla del formato hace con lo que la
// persona escribe: teléfonos de copia y de aviso, y los ajustes sobre una
// plantilla ya derivada. PURO (sin base, sin sesión): la página solo orquesta.
// ═══════════════════════════════════════════════════════════════════════════

import { normalizarTelefonoOperador } from '../administracion';
import { DatoInvalido } from '../errores';
import { validarFormato, FormatoInvalido, type FormatoFlota } from './formato_flota';

export const MAX_TELEFONOS = 3;

/**
 * «5512345678, 33 1234 5678» → E.164 sin «+», sin repetidos. Rechaza más de
 * `MAX_TELEFONOS` y cualquier número que no sea celular mexicano (no se
 * recorta ni se adivina: la copia lleva cifras y no puede ir a un número mal
 * tecleado).
 */
export function leerTelefonos(crudo: string, que: string): string[] {
  const partes = crudo.split(/[\n,;]+/).map((p) => p.trim()).filter(Boolean);
  const vistos: string[] = [];
  for (const p of partes) {
    const t = normalizarTelefonoOperador(p);
    if (!vistos.includes(t)) vistos.push(t);
  }
  if (vistos.length > MAX_TELEFONOS) {
    throw new DatoInvalido(`${que}: hasta ${MAX_TELEFONOS} teléfonos (pusiste ${vistos.length}). Una copia a medio equipo ya no es una copia.`);
  }
  return vistos;
}

/** Los ajustes que la pantalla deja tocar de una plantilla ya guardada o derivada. */
export interface AjustesFormato {
  salida: string;
  fechas: string;
  titulo: string;
  mostrarTotal: boolean;
  etiquetaTotal: string;
  /** Encabezados nuevos de las columnas, en el orden actual (vacío = se conserva). */
  encabezados: string[];
  /** Etiquetas nuevas de los datos de arriba, en el orden actual (vacío = se conserva). */
  etiquetasDatos: string[];
}

/** Aplica los ajustes y vuelve a VALIDAR la plantilla entera (lo escrito no se acepta a ciegas). */
export function aplicarAjustes(f: FormatoFlota, a: AjustesFormato): FormatoFlota {
  try {
    return validarFormato({
      ...f,
      titulo: a.titulo.trim() === '' ? null : a.titulo,
      salida: a.salida,
      fechas: a.fechas,
      total: { mostrar: a.mostrarTotal, etiqueta: a.etiquetaTotal.trim() === '' ? f.total.etiqueta : a.etiquetaTotal },
      columnas: f.columnas.map((c, i) => ({ ...c, encabezado: (a.encabezados[i] ?? '').trim() === '' ? c.encabezado : a.encabezados[i] })),
      datos: f.datos.map((d, i) => ({ ...d, etiqueta: (a.etiquetasDatos[i] ?? '').trim() === '' ? d.etiqueta : a.etiquetasDatos[i] })),
    });
  } catch (e) {
    if (e instanceof FormatoInvalido) throw new DatoInvalido(e.message);
    throw e;
  }
}
