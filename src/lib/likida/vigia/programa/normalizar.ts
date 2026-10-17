// Normalizador de filas del programa de despacho (T-A4-03).
//
// Función pura: recibe una `FilaCruda` del lector estructural (T-A4-02) y su
// `Seccion`, y devuelve una `FilaPrograma` tipada o el motivo por el que se
// descarta. No escribe en base ni lee red. Reglas:
//  - Nunca se inventa caja ni unidad: vacío es `null` (vacío ≠ 0).
//  - Caja, unidad y línea son TEXTO (trim + mayúsculas); se conservan los ceros a
//    la izquierda y las letras. Nunca se convierten a número.
//  - La cita sale como ISO con la zona de la terminal (IANA, sin asumir horario
//    de verano), o como texto («DIRECTO»), o null con aviso.
//  - Valores de TRANSITO/CCP que no están en el catálogo → `desconocido` + aviso
//    con el texto original; los numéricos se marcan «dato fuera de columna».

import { TZ_MX } from '@/lib/formato';
import type { FilaCruda, ResultadoLector, Seccion, TipoSeccionPrograma } from './lector';

export type Transito =
  | 'patio_nld' | 'en_ruta' | 'pend_cruce' | 'ok' | 'patio_otro' | 'na' | 'vacio' | 'desconocido';
export type Ccp =
  | 'listo' | 'despachado' | 'pend_reque' | 'pend_ccp' | 'falta_complemento' | 'vacio' | 'desconocido';

export const ZONA_HORARIA_POR_DEFECTO = TZ_MX;

export type CodigoAvisoFila =
  | 'transito_desconocido' | 'ccp_desconocido' | 'dato_fuera_de_columna'
  | 'cita_no_reconocida' | 'cita_solo_hora' | 'cita_sin_fecha' | 'ruta_no_reconocida';

export interface AvisoFila {
  codigo: CodigoAvisoFila;
  campo: 'TRANSITO' | 'CCP' | 'CITA' | 'ORIGEN-DESTINO';
  mensaje: string;
  /** Texto original de la celda (recortado), para que la persona lo revise. */
  original: string;
}

export interface RutaPrograma {
  origen: string | null;
  destino: string | null;
  /** Todos los tramos en orden, solo si la ruta trae tres o más («GDL-SIL-GDL»). */
  tramos: string[] | null;
}

export interface FilaPrograma {
  lineaCsv: number;
  /** AAAA-MM-DD de la sección, o null si no se pudo determinar. */
  fecha: string | null;
  tipo: TipoSeccionPrograma;
  /** Valor de la columna «#», o null si la fila no lo trae. */
  num: number | null;
  ruta: RutaPrograma;
  cliente: string | null;
  consignatario: string | null;
  linea: string | null;
  caja: string | null;
  unidad: string | null;
  /** Cita como ISO 8601 con el desfase de `zonaHoraria` (p. ej. 2026-10-05T08:00:00-06:00). */
  citaEn: string | null;
  /** Texto de cita que no es una hora («DIRECTO»); null en otro caso. */
  citaTexto: string | null;
  /** Zona IANA con la que se interpretó la cita. */
  zonaHoraria: string;
  transito: Transito;
  ccp: Ccp;
  /** Columna REQUE tal como viene (trim), si el archivo la trae. */
  reque: string | null;
  comentarios: string | null;
  comentarios2: string | null;
  avisos: AvisoFila[];
}

export type MotivoDescarte = 'sin_caja_unidad_ni_cliente';

export type ResultadoFila =
  | { ok: true; fila: FilaPrograma }
  | { ok: false; lineaCsv: number; motivo: MotivoDescarte; mensaje: string };

export interface OpcionesNormalizar {
  /** Zona IANA de la terminal. Por defecto America/Mexico_City. */
  zonaHoraria?: string;
}

export interface ReporteCalidad {
  /** Filas crudas entregadas por el lector. */
  leidas: number;
  validas: number;
  descartadas: { lineaCsv: number; motivo: MotivoDescarte }[];
  /** Los conteos siguientes son sobre las filas válidas. */
  conCaja: number;
  conUnidad: number;
  sinCaja: number;
  cajaSinUnidad: number;
  unidadSinCaja: number;
  /** Filas válidas con al menos un aviso. */
  conAvisos: number;
}

export interface OpcionesNormalizarPrograma extends OpcionesNormalizar {
  /** Zona por terminal (clave = terminal del lector); gana sobre `zonaHoraria`. */
  zonasPorTerminal?: Record<string, string>;
}

export interface ProgramaNormalizado {
  filas: FilaPrograma[];
  calidad: ReporteCalidad;
}

// ---------------------------------------------------------------------------
// Utilidades de texto

function sinAcentos(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Texto en mayúsculas sin acentos y con espacios colapsados, para comparar catálogos. */
function clave(s: string): string {
  return sinAcentos(s).toUpperCase().replace(/\s+/g, ' ').trim();
}

/** trim (incluye espacios no separables) → null si queda vacío. */
function textoONull(s: string | undefined): string | null {
  if (s === undefined) return null;
  const t = s.replace(/^[\s ]+|[\s ]+$/g, '');
  return t === '' ? null : t;
}

function mayusculasONull(s: string | undefined): string | null {
  const t = textoONull(s);
  return t === null ? null : t.toUpperCase();
}

function recortar(s: string, max = 80): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

const ES_NUMERICO = /^[+-]?\d+[.,]?\d*$/;

// ---------------------------------------------------------------------------
// Ruta

export function normalizarRuta(celda: string | undefined): RutaPrograma | null {
  const t = textoONull(celda);
  if (t === null) return null;
  const partes = t.split(/\s*-\s*/).map((p) => p.trim().toUpperCase()).filter((p) => p !== '');
  if (partes.length < 2) return null;
  if (partes.length === 2) return { origen: partes[0], destino: partes[1], tramos: null };
  return { origen: partes[0], destino: partes[partes.length - 1], tramos: partes };
}

// ---------------------------------------------------------------------------
// Zona horaria (IANA, sin asumir horario de verano)

const formateadores = new Map<string, Intl.DateTimeFormat>();

function formateadorDe(zona: string): Intl.DateTimeFormat {
  let f = formateadores.get(zona);
  if (!f) {
    // Lanza RangeError si la zona no existe: el error se ve al construir, no por fila.
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zona, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    formateadores.set(zona, f);
  }
  return f;
}

/** Desfase de la zona respecto de UTC, en minutos, en el instante dado. */
function desfaseMinutos(zona: string, instanteMs: number): number {
  const partes = formateadorDe(zona).formatToParts(new Date(instanteMs));
  const v: Record<string, number> = {};
  for (const p of partes) if (p.type !== 'literal') v[p.type] = Number(p.value);
  const comoUtc = Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second);
  return Math.round((comoUtc - Math.floor(instanteMs / 1000) * 1000) / 60_000);
}

const dos = (n: number) => String(n).padStart(2, '0');

function formatoDesfase(min: number): string {
  const signo = min < 0 ? '-' : '+';
  const a = Math.abs(min);
  return `${signo}${dos(Math.floor(a / 60))}:${dos(a % 60)}`;
}

/** Hora de pared local de la zona → ISO con desfase. */
export function citaIsoConZona(
  a: number, m: number, d: number, h: number, mi: number, zona: string,
): string {
  const pared = Date.UTC(a, m - 1, d, h, mi);
  let off = desfaseMinutos(zona, pared);
  // Segunda pasada: el desfase puede diferir si hubo un cambio entre la suposición y el instante real.
  const off2 = desfaseMinutos(zona, pared - off * 60_000);
  if (off2 !== off) off = off2;
  return `${a}-${dos(m)}-${dos(d)}T${dos(h)}:${dos(mi)}:00${formatoDesfase(off)}`;
}

function fechaValida(a: number, m: number, d: number): boolean {
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

interface ResultadoCita { citaEn: string | null; citaTexto: string | null; avisos: AvisoFila[] }

function normalizarCita(celda: string | undefined, fechaSeccion: string | null, zona: string): ResultadoCita {
  const t = textoONull(celda);
  const vacio: ResultadoCita = { citaEn: null, citaTexto: null, avisos: [] };
  if (t === null) return vacio;
  if (clave(t) === 'DIRECTO') return { citaEn: null, citaTexto: 'DIRECTO', avisos: [] };

  const completa = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/.exec(t);
  if (completa) {
    const [d, m, a, h, mi] = [completa[1], completa[2], completa[3], completa[4], completa[5]].map(Number);
    if (fechaValida(a, m, d) && h <= 23 && mi <= 59) {
      return { citaEn: citaIsoConZona(a, m, d, h, mi, zona), citaTexto: null, avisos: [] };
    }
  } else {
    const soloHora = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (soloHora) {
      const h = Number(soloHora[1]);
      const mi = Number(soloHora[2]);
      if (h <= 23 && mi <= 59) {
        const mf = fechaSeccion ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaSeccion) : null;
        if (!mf) {
          return {
            citaEn: null, citaTexto: null,
            avisos: [{
              codigo: 'cita_sin_fecha', campo: 'CITA', original: recortar(t),
              mensaje: 'La cita trae solo la hora y la sección no tiene fecha; no se pudo completar.',
            }],
          };
        }
        return {
          citaEn: citaIsoConZona(Number(mf[1]), Number(mf[2]), Number(mf[3]), h, mi, zona),
          citaTexto: null,
          avisos: [{
            codigo: 'cita_solo_hora', campo: 'CITA', original: recortar(t),
            mensaje: `La cita trae solo la hora; se usó la fecha de la sección (${fechaSeccion}).`,
          }],
        };
      }
    }
  }
  return {
    citaEn: null, citaTexto: null,
    avisos: [{
      codigo: 'cita_no_reconocida', campo: 'CITA', original: recortar(t),
      mensaje: `No se reconoció la cita «${recortar(t)}»; queda sin fecha.`,
    }],
  };
}

// ---------------------------------------------------------------------------
// Catálogos TRANSITO y CCP

function normalizarTransito(celda: string | undefined): { valor: Transito; aviso: AvisoFila | null } {
  const t = textoONull(celda);
  if (t === null) return { valor: 'vacio', aviso: null };
  const k = clave(t);
  if (k === 'PATIO NLD') return { valor: 'patio_nld', aviso: null };
  if (k === 'EN RUTA') return { valor: 'en_ruta', aviso: null };
  if (k === 'PEND CRUCE') return { valor: 'pend_cruce', aviso: null };
  if (k === 'OK') return { valor: 'ok', aviso: null };
  if (k === 'N/A' || k === 'NA') return { valor: 'na', aviso: null };
  if (/^PATIO\b/.test(k)) return { valor: 'patio_otro', aviso: null };
  if (ES_NUMERICO.test(k)) {
    return {
      valor: 'desconocido',
      aviso: {
        codigo: 'dato_fuera_de_columna', campo: 'TRANSITO', original: recortar(t),
        mensaje: `TRANSITO trae «${recortar(t)}», un número: dato fuera de columna.`,
      },
    };
  }
  return {
    valor: 'desconocido',
    aviso: {
      codigo: 'transito_desconocido', campo: 'TRANSITO', original: recortar(t),
      mensaje: `TRANSITO «${recortar(t)}» no está en el catálogo.`,
    },
  };
}

function normalizarCcp(celda: string | undefined): { valor: Ccp; aviso: AvisoFila | null } {
  const t = textoONull(celda);
  if (t === null) return { valor: 'vacio', aviso: null };
  const k = clave(t);
  if (k === 'LISTO') return { valor: 'listo', aviso: null };
  if (k === 'DESPACHADO') return { valor: 'despachado', aviso: null };
  if (k === 'PEND REQUE CCP') return { valor: 'pend_reque', aviso: null };
  if (k === 'PEND CCP') return { valor: 'pend_ccp', aviso: null };
  if (k === 'FALTA DE COMPLEMENTO') return { valor: 'falta_complemento', aviso: null };
  if (ES_NUMERICO.test(k)) {
    return {
      valor: 'desconocido',
      aviso: {
        codigo: 'dato_fuera_de_columna', campo: 'CCP', original: recortar(t),
        mensaje: `CCP trae «${recortar(t)}», un número: dato fuera de columna.`,
      },
    };
  }
  return {
    valor: 'desconocido',
    aviso: {
      codigo: 'ccp_desconocido', campo: 'CCP', original: recortar(t),
      mensaje: `CCP «${recortar(t)}» no está en el catálogo.`,
    },
  };
}

// ---------------------------------------------------------------------------
// Fila

function numeroDeFila(celda: string | undefined): number | null {
  const t = textoONull(celda);
  if (t === null || !/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

export function normalizarFila(
  cruda: FilaCruda, seccion: Seccion, opciones: OpcionesNormalizar = {},
): ResultadoFila {
  const zona = opciones.zonaHoraria ?? ZONA_HORARIA_POR_DEFECTO;
  const c = cruda.celdas;

  const caja = mayusculasONull(c.CAJA);
  const unidad = mayusculasONull(c.UNIDAD);
  const cliente = textoONull(c.CLIENTE)?.replace(/\s+/g, ' ') ?? null;

  if (caja === null && unidad === null && cliente === null) {
    return {
      ok: false, lineaCsv: cruda.lineaCsv, motivo: 'sin_caja_unidad_ni_cliente',
      mensaje: 'La fila no trae caja, unidad ni cliente.',
    };
  }

  const avisos: AvisoFila[] = [];

  let ruta = normalizarRuta(c['ORIGEN-DESTINO']);
  if (ruta === null) {
    const original = textoONull(c['ORIGEN-DESTINO']);
    if (original !== null) {
      avisos.push({
        codigo: 'ruta_no_reconocida', campo: 'ORIGEN-DESTINO', original: recortar(original),
        mensaje: `ORIGEN-DESTINO «${recortar(original)}» no se pudo separar en origen y destino.`,
      });
    }
    ruta = { origen: null, destino: null, tramos: null };
  }

  const cita = normalizarCita(c.CITA, seccion.fecha, zona);
  avisos.push(...cita.avisos);
  const transito = normalizarTransito(c.TRANSITO);
  if (transito.aviso) avisos.push(transito.aviso);
  const ccp = normalizarCcp(c.CCP);
  if (ccp.aviso) avisos.push(ccp.aviso);

  return {
    ok: true,
    fila: {
      lineaCsv: cruda.lineaCsv,
      fecha: seccion.fecha,
      tipo: seccion.tipo,
      num: numeroDeFila(c['#']),
      ruta,
      cliente,
      consignatario: textoONull(c.CONSIGNATARIO)?.replace(/\s+/g, ' ') ?? null,
      linea: mayusculasONull(c.LINEA),
      caja,
      unidad,
      citaEn: cita.citaEn,
      citaTexto: cita.citaTexto,
      zonaHoraria: zona,
      transito: transito.valor,
      ccp: ccp.valor,
      reque: textoONull(c.REQUE),
      comentarios: textoONull(c.COMENTARIOS),
      comentarios2: textoONull(c.COMENTARIOS_2),
      avisos,
    },
  };
}

// ---------------------------------------------------------------------------
// Programa completo + reporte de calidad

export function normalizarPrograma(
  lectura: Pick<ResultadoLector, 'filas' | 'secciones' | 'resumen'>,
  opciones: OpcionesNormalizarPrograma = {},
): ProgramaNormalizado {
  const zona = opciones.zonasPorTerminal?.[lectura.resumen.terminal]
    ?? opciones.zonaHoraria ?? ZONA_HORARIA_POR_DEFECTO;
  formateadorDe(zona); // falla pronto y una sola vez si la zona no existe

  const calidad: ReporteCalidad = {
    leidas: lectura.filas.length, validas: 0, descartadas: [], conCaja: 0, conUnidad: 0,
    sinCaja: 0, cajaSinUnidad: 0, unidadSinCaja: 0, conAvisos: 0,
  };
  const filas: FilaPrograma[] = [];
  for (const cruda of lectura.filas) {
    const r = normalizarFila(cruda, lectura.secciones[cruda.seccion], { zonaHoraria: zona });
    if (!r.ok) {
      calidad.descartadas.push({ lineaCsv: r.lineaCsv, motivo: r.motivo });
      continue;
    }
    const f = r.fila;
    filas.push(f);
    calidad.validas++;
    if (f.caja !== null) calidad.conCaja++; else calidad.sinCaja++;
    if (f.unidad !== null) calidad.conUnidad++;
    if (f.caja !== null && f.unidad === null) calidad.cajaSinUnidad++;
    if (f.unidad !== null && f.caja === null) calidad.unidadSinCaja++;
    if (f.avisos.length > 0) calidad.conAvisos++;
  }
  return { filas, calidad };
}
