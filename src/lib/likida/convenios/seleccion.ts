import type { Instruccion } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// QUÉ CONVENIO LE TOCA A UN VIAJE — puro. Un cliente puede tener varios (cada punto A→B es uno).
//
// La regla es ESCRITA, no adivinada (el criterio de `tarifaSugerida`): se descartan los convenios vencidos, inactivos
// o que CONTRADICEN al viaje (otra planta de carga/descarga, por sitio de catálogo o por texto distinto); entre los que quedan manda el que más coincide (sitio
// de catálogo vale más que el texto del origen/destino). Si queda uno solo, es ese —solo si no hay nada que comparar (sin contradicción): es
// «el convenio del cliente»—. Si quedan varios EMPATADOS sin ninguna coincidencia, NO se elige: mandarle al operador
// la puerta de OTRA ruta es peor que no mandarle nada, y el panel dice que falta ligarlo.
// ═══════════════════════════════════════════════════════════════════════════

export interface ConvenioCandidato {
  id: string;
  nombre: string;
  activo: boolean;
  origen: string | null;
  destino: string | null;
  origenSitioId: string | null;
  destinoSitioId: string | null;
  vigenteDesde: string | null;
  vigenteHasta: string | null;
  instrucciones: Instruccion[];
}

export interface ViajeParaLigar {
  origen: string | null;
  destino: string | null;
  origenSitioId: string | null;
  destinoSitioId: string | null;
}

export type EleccionConvenio =
  | { tipo: 'elegido'; convenio: ConvenioCandidato; puntos: number }
  | { tipo: 'ninguno'; motivo: 'sin_convenios' | 'sin_vigentes' | 'contradice_al_viaje' }
  | { tipo: 'ambiguo'; candidatos: string[] };

const texto = (t: string | null): string =>
  (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const coincideTexto = (a: string, b: string): boolean => a === b || ` ${a} `.includes(` ${b} `) || ` ${b} `.includes(` ${a} `);

const vigente = (c: ConvenioCandidato, hoy: string): boolean =>
  c.activo && (!c.vigenteDesde || c.vigenteDesde <= hoy) && (!c.vigenteHasta || c.vigenteHasta >= hoy);

/** `null` = el convenio contradice al viaje; si no, los puntos de coincidencia. */
function puntos(c: ConvenioCandidato, v: ViajeParaLigar): number | null {
  let p = 0;
  for (const [sitioC, sitioV, txtC, txtV] of [
    [c.origenSitioId, v.origenSitioId, c.origen, v.origen],
    [c.destinoSitioId, v.destinoSitioId, c.destino, v.destino],
  ] as const) {
    if (sitioC && sitioV) { if (sitioC === sitioV) p += 3; else return null; }
    else if (texto(txtC) !== '' && texto(txtV) !== '') {
      // Texto contra texto también CONTRADICE: «Silao» no es «Querétaro». Se acepta que uno contenga al otro por
      // palabras completas («Silao» ⊂ «Silao Guanajuato»); cualquier otra diferencia descarta el convenio.
      if (coincideTexto(texto(txtC), texto(txtV))) p += 2; else return null;
    }
  }
  return p;
}

export function elegirConvenio(candidatos: readonly ConvenioCandidato[], viaje: ViajeParaLigar, hoy: string): EleccionConvenio {
  if (candidatos.length === 0) return { tipo: 'ninguno', motivo: 'sin_convenios' };
  const vivos = candidatos.filter((c) => vigente(c, hoy));
  if (vivos.length === 0) return { tipo: 'ninguno', motivo: 'sin_vigentes' };
  const puntuados = vivos.flatMap((c) => { const p = puntos(c, viaje); return p === null ? [] : [{ c, p }]; });
  if (puntuados.length === 0) return { tipo: 'ninguno', motivo: 'contradice_al_viaje' };
  puntuados.sort((a, b) => b.p - a.p || a.c.nombre.localeCompare(b.c.nombre) || a.c.id.localeCompare(b.c.id));
  const [mejor, segundo] = puntuados;
  if (puntuados.length === 1) return { tipo: 'elegido', convenio: mejor.c, puntos: mejor.p };
  if (mejor.p > (segundo?.p ?? -1)) return { tipo: 'elegido', convenio: mejor.c, puntos: mejor.p };
  return { tipo: 'ambiguo', candidatos: puntuados.filter((x) => x.p === mejor.p).map((x) => x.c.nombre) };
}

/** La planta a la que se acerca el operador: la de carga mientras no haya cargado; después, la de descarga. */
export function ladoActual(hitosResueltos: { llegadaCarga: boolean; salidaCarga: boolean }): 'origen' | 'destino' {
  return hitosResueltos.salidaCarga ? 'destino' : 'origen';
}
