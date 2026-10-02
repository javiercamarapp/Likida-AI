import { haversineM } from './geo';

// ═══════════════════════════════════════════════════════════════════════════
// LOS «CURSOS» DE PEAJES — las rutas autorizadas, y la pregunta «¿este pase
// estaba dentro del curso de la unidad?». PURO: sin base, sin red.
//
// Un curso es la ruta que la flota autoriza a una unidad (o a un convenio A→B):
//
//   · `casetas`  — la lista de casetas autorizadas (catálogo de la flota). Es la
//                  forma que NO espera nada del cliente: sale de los convenios y
//                  del catálogo de casetas que ya existen.
//   · `corredor` — una polilínea con un buffer en metros. La posición GPS más
//                  cercana a la hora del pase debe caer dentro del buffer.
//                  Contrato y fixtures sintéticos; el FORMATO REAL del cliente es
//                  bloqueo externo (12-oct): no se adivina ningún formato.
//
// LA DOCTRINA (la misma del reporte de reclamación):
//   · Fuera de curso se afirma SOLO si TODOS los cursos aplicables se pudieron
//     evaluar y NINGUNO autoriza el pase. Basta que uno no se pueda evaluar (caseta
//     sin resolver en el catálogo, corredor sin una posición cercana al pase) para
//     que el resultado sea «sin dato»: no es evidencia en contra de nadie.
//   · Si varios cursos aplican, el pase queda dentro si CUALQUIERA lo autoriza.
//   · Sin curso aplicable no hay nada que evaluar: «sin curso», jamás «fuera».
//   · Un curso fuera de su vigencia no aplica.
// ═══════════════════════════════════════════════════════════════════════════

export type TipoCurso = 'casetas' | 'corredor';
export interface PuntoCurso { lat: number; lng: number }

/** Un curso ya resuelto para evaluar (lo arma la capa de datos con las casetas del catálogo). */
export interface CursoAplicable {
  id: string;
  codigo: string;
  nombre: string;
  tipo: TipoCurso;
  /** Ids del catálogo de casetas autorizadas (solo `casetas`), en orden de recorrido. */
  casetaIds: readonly string[];
  /** Los nombres de esas casetas, en el mismo orden: para decir el curso en la frase. */
  casetaNombres: readonly string[];
  corredor: { polilinea: readonly PuntoCurso[]; bufferM: number } | null;
  vigenteDesde: string | null;
  vigenteHasta: string | null;
}

/** Un curso de la flota con a quién aplica (lo que guarda la base). */
export interface CursoDeFlota extends CursoAplicable {
  unidadId: string | null;
  convenioId: string | null;
  activo: boolean;
}

/**
 * Los cursos que le aplican a un pase: los ACTIVOS de su unidad y/o del convenio de su viaje. Un curso de unidad y convenio a la
 * vez solo aplica cuando coinciden los dos (la unidad, dentro de ese convenio). Sin unidad resuelta no hay curso de unidad, y sin
 * viaje ligado no hay curso de convenio: no se adivina a quién le tocaba.
 */
export function cursosQueAplican(cursos: readonly CursoDeFlota[], unidadId: string | null, convenioId: string | null): CursoAplicable[] {
  return cursos.filter((c) => {
    if (!c.activo) return false;
    if (c.unidadId !== null && c.unidadId !== unidadId) return false;
    if (c.convenioId !== null && c.convenioId !== convenioId) return false;
    return c.unidadId !== null || c.convenioId !== null;
  });
}

export interface MuestraCurso { t: number; lat: number; lng: number }

/** La posición más cercana a la hora del pase solo vale si no está más lejos en el tiempo que esto. */
export const MAX_DESFASE_CORREDOR_MIN = 10;
/** Un corredor de verdad tiene entre 2 y este número de vértices (el mismo tope que la base, 0665). */
export const MAX_VERTICES_CORREDOR = 2_000;
export const BUFFER_CORREDOR_MIN_M = 25;
export const BUFFER_CORREDOR_MAX_M = 20_000;

const MIN = 60_000;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** ¿El curso vale ese día (AAAA-MM-DD)? Sin fecha legible no se descarta: la evaluación decide con lo que hay. */
export function vigenteEn(c: Pick<CursoAplicable, 'vigenteDesde' | 'vigenteHasta'>, fecha: string): boolean {
  if (!FECHA.test(fecha)) return true;
  if (c.vigenteDesde && FECHA.test(c.vigenteDesde) && fecha < c.vigenteDesde) return false;
  if (c.vigenteHasta && FECHA.test(c.vigenteHasta) && fecha > c.vigenteHasta) return false;
  return true;
}

/**
 * Distancia (m) de un punto a una polilínea, la del segmento más cercano. Cada segmento se proyecta a un plano local
 * (equirectangular centrado en el punto): para segmentos de decenas de km el error es de metros, de sobra para un buffer de
 * cientos de metros. Una polilínea de un solo vértice es un punto. Vacía → Infinity (nada la contiene).
 */
export function distanciaAPolilineaM(p: PuntoCurso, polilinea: readonly PuntoCurso[]): number {
  if (polilinea.length === 0) return Number.POSITIVE_INFINITY;
  if (polilinea.length === 1) return haversineM(p, polilinea[0]);
  const kLat = 111_320;
  const kLng = 111_320 * Math.cos((p.lat * Math.PI) / 180);
  const xy = (q: PuntoCurso) => ({ x: (q.lng - p.lng) * kLng, y: (q.lat - p.lat) * kLat });
  let mejor = Number.POSITIVE_INFINITY;
  for (let i = 0; i < polilinea.length - 1; i++) {
    const a = xy(polilinea[i]); const b = xy(polilinea[i + 1]);
    const dx = b.x - a.x; const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    // Proyección del origen (el punto) sobre el segmento a→b, acotada a [0, 1].
    const u = l2 === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / l2));
    const d = Math.hypot(a.x + u * dx, a.y + u * dy);
    if (d < mejor) mejor = d;
  }
  return mejor;
}

export type MotivoSinDatoCurso = 'caseta_sin_resolver' | 'corredor_sin_posicion';

export type EvaluacionCurso =
  | { estado: 'sin_curso' }
  | { estado: 'dentro'; curso: string }
  /** Hay curso, pero el dato no alcanza para afirmar nada (NO es evidencia en contra). */
  | { estado: 'sin_dato'; motivo: MotivoSinDatoCurso }
  | {
      estado: 'fuera';
      /** Los cursos que aplicaban y no autorizan el pase. */
      cursos: Array<{ nombre: string; tipo: TipoCurso; casetaNombres: readonly string[] }>;
      /** Solo si algún corredor aplicó: lo medido contra el más cercano. */
      corredor: { nombre: string; distanciaM: number; bufferM: number } | null;
    };

export interface EntradaCurso {
  /** AAAA-MM-DD del pase, para la vigencia. */
  fecha: string;
  /** La caseta del catálogo a la que se resolvió el pase (null = sin resolver). */
  casetaId: string | null;
  cruceMs: number | null;
  muestras: readonly MuestraCurso[];
  cursos: readonly CursoAplicable[];
}

const muestraCercana = (cruceMs: number, muestras: readonly MuestraCurso[]): MuestraCurso | null => {
  let mejor: MuestraCurso | null = null;
  for (const m of muestras) {
    if (!Number.isFinite(m.t) || !Number.isFinite(m.lat) || !Number.isFinite(m.lng)) continue;
    if (mejor === null || Math.abs(m.t - cruceMs) < Math.abs(mejor.t - cruceMs)) mejor = m;
  }
  return mejor && Math.abs(mejor.t - cruceMs) <= MAX_DESFASE_CORREDOR_MIN * MIN ? mejor : null;
};

/** ¿Este pase estaba dentro de los cursos que le aplican? Ver la doctrina arriba. */
export function evaluarCurso(e: EntradaCurso): EvaluacionCurso {
  const aplican = e.cursos.filter((c) => vigenteEn(c, e.fecha));
  if (aplican.length === 0) return { estado: 'sin_curso' };

  let inconcluso: MotivoSinDatoCurso | null = null;
  const fuera: Array<{ nombre: string; tipo: TipoCurso; casetaNombres: readonly string[] }> = [];
  let corredor: { nombre: string; distanciaM: number; bufferM: number } | null = null;

  for (const c of aplican) {
    if (c.tipo === 'casetas') {
      if (e.casetaId === null) { inconcluso ??= 'caseta_sin_resolver'; continue; }
      if (c.casetaIds.includes(e.casetaId)) return { estado: 'dentro', curso: c.nombre };
      fuera.push({ nombre: c.nombre, tipo: 'casetas', casetaNombres: c.casetaNombres });
      continue;
    }
    if (!c.corredor || c.corredor.polilinea.length < 2) { inconcluso ??= 'corredor_sin_posicion'; continue; }
    const m = e.cruceMs === null ? null : muestraCercana(e.cruceMs, e.muestras);
    if (!m) { inconcluso ??= 'corredor_sin_posicion'; continue; }
    const d = distanciaAPolilineaM(m, c.corredor.polilinea);
    if (d <= c.corredor.bufferM) return { estado: 'dentro', curso: c.nombre };
    fuera.push({ nombre: c.nombre, tipo: 'corredor', casetaNombres: [] });
    if (corredor === null || d < corredor.distanciaM) corredor = { nombre: c.nombre, distanciaM: Math.round(d), bufferM: c.corredor.bufferM };
  }
  if (inconcluso) return { estado: 'sin_dato', motivo: inconcluso };
  return { estado: 'fuera', cursos: fuera, corredor };
}
