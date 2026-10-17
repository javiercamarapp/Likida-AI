// Lector ESTRUCTURAL del CSV del programa de despacho (T-A4-02).
//
// Función pura: recibe el texto y devuelve filas crudas, secciones, tabla lateral
// y avisos. No contiene lógica de negocio (caja, listo, cita ISO...): eso es del
// normalizador (T-A4-03). No escribe en base y no exige folio.
//
// Forma del archivo (ver fixtures.ts): delimitador ';', hasta 16 383 columnas
// (casi todas vacías), un título de sección por tipo y día, fila de encabezados
// repetida en cada sección, «COMENTARIOS» dos veces, tabla lateral desde la
// columna 20. Para no materializar 16 383 celdas por fila, cada línea se corta
// a la última celda con contenido antes de dividirla.

export type TipoSeccionPrograma =
  | 'IMPORTACION' | 'EXPORTACION' | 'CANCELACIONES' | 'DOMESTICO' | 'MOV_VACIO' | 'OTRO';

export interface OpcionesLector {
  /** Terminal del archivo (GDL, BJX, MTY...). Solo se devuelve; el lector no la interpreta. */
  terminal: string;
  /** Tope de filas de datos a conservar. Por defecto 60 000; al rebasarlo hay aviso con la cifra. */
  topeFilas?: number;
  /** Índice (0-based) donde empieza la tabla lateral. Por defecto 19 (columna 20). */
  columnaLateral?: number;
}

export const TOPE_FILAS_PROGRAMA = 60_000;
export const COLUMNA_LATERAL_PROGRAMA = 19;

export interface AvisoLector {
  /** Línea 1-based del archivo, o null si el aviso es del archivo completo. */
  lineaCsv: number | null;
  codigo:
    | 'tope_filas' | 'encabezado_desconocido' | 'columna_faltante' | 'titulo_sin_fecha'
    | 'titulo_desconocido' | 'fila_sin_encabezado' | 'seccion_sin_encabezado' | 'encabezado_sin_titulo';
  mensaje: string;
}

export interface Seccion {
  tipo: TipoSeccionPrograma;
  /** AAAA-MM-DD, o null si ni el título ni las secciones previas la traen. */
  fecha: string | null;
  /** true si la fecha viene en el propio título; false si se heredó de la sección anterior. */
  fechaPropia: boolean;
  /** Ruta del título en DOMESTICO y MOV VACIO, tal como viene (espacios colapsados). */
  ruta: string | null;
  titulo: string;
  lineaTitulo: number | null;
  lineaEncabezado: number | null;
  /** Filas de datos leídas (conservadas) en esta sección. */
  filas: number;
}

export interface FilaCruda {
  lineaCsv: number;
  /** Índice en `secciones`. */
  seccion: number;
  /** Texto crudo de cada columna del programa, por nombre normalizado (COMENTARIOS_2 para el segundo). */
  celdas: Record<string, string>;
}

export interface LateralCrudo {
  lineaCsv: number;
  /** Celdas desde la columna lateral, cortadas a la última con contenido. */
  celdas: string[];
}

export interface ResumenLector {
  terminal: string;
  delimitador: string;
  lineas: number;
  /** Filas de datos encontradas en el archivo (aunque se rebase el tope). */
  filasEncontradas: number;
  filasLeidas: number;
}

export interface ResultadoLector {
  filas: FilaCruda[];
  secciones: Seccion[];
  lateral: LateralCrudo[];
  avisos: AvisoLector[];
  resumen: ResumenLector;
}

/** Error en lenguaje llano para el usuario que sube el archivo. */
export class ErrorLectorPrograma extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorLectorPrograma';
  }
}

const MESES: Record<string, number> = {
  ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6, JULIO: 7, AGOSTO: 8,
  SEPTIEMBRE: 9, SETIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12,
};

/** Encabezados que el programa conoce (ya normalizados). Otros generan aviso. */
const ENCABEZADOS_CONOCIDOS = new Set([
  '#', 'SUC', 'TIPO DE VIAJE', 'ORIGEN-DESTINO', 'CLIENTE', 'CONSIGNATARIO', 'LINEA', 'CAJA',
  'COMENTARIOS', 'COMENTARIOS_2', 'CITA', 'CITA LIMITE', 'UNIDAD', 'TRANSITO', 'CCP', 'REQUE',
  'ASIGNACION', 'SALIO',
]);
/** Sin estas columnas el normalizador no puede trabajar: se avisa. */
const ENCABEZADOS_ESPERADOS = [
  'ORIGEN-DESTINO', 'CLIENTE', 'CONSIGNATARIO', 'LINEA', 'CAJA', 'CITA', 'UNIDAD', 'TRANSITO', 'CCP',
];

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function normEncabezado(s: string): string {
  return norm(s).replace(/\s*-\s*/g, '-');
}

function formatoMiles(n: number): string {
  const d = String(n);
  let out = '';
  for (let i = 0; i < d.length; i++) {
    if (i > 0 && (d.length - i) % 3 === 0) out += ' ';
    out += d[i];
  }
  return out;
}

function esFechaValida(a: number, m: number, d: number): boolean {
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

/** «05 DE OCTUBRE 2026» (tolera espacios dobles, acentos y «DE» antes del año) → AAAA-MM-DD. */
export function leerFechaTitulo(titulo: string): string | null {
  const m = /(\d{1,2}) DE ([A-Z]+) (?:DE )?(\d{4})/.exec(norm(titulo));
  if (!m) return null;
  const mes = MESES[m[2]];
  if (!mes) return null;
  const d = Number(m[1]);
  const a = Number(m[3]);
  if (!esFechaValida(a, mes, d)) return null;
  return `${a}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function clasificarTitulo(titulo: string): { tipo: TipoSeccionPrograma; ruta: string | null } | null {
  const t = norm(titulo);
  if (/^IMPORTACION\b/.test(t)) return { tipo: 'IMPORTACION', ruta: null };
  if (/^EXPORTACION\b/.test(t)) return { tipo: 'EXPORTACION', ruta: null };
  if (/^CANCELACION(ES)?\b/.test(t)) return { tipo: 'CANCELACIONES', ruta: null };
  let m = /^DOMESTICO\b\s*(.*)$/.exec(t);
  if (m) return { tipo: 'DOMESTICO', ruta: rutaDeTitulo(m[1]) };
  m = /^MOV (?:DE )?VACIOS?\b\s*(.*)$/.exec(t);
  if (m) return { tipo: 'MOV_VACIO', ruta: rutaDeTitulo(m[1]) };
  return null;
}

function rutaDeTitulo(resto: string): string | null {
  const r = resto.replace(/\s+/g, ' ').trim();
  return r === '' ? null : r;
}

interface ColumnaPrograma { indice: number; nombre: string }

/** Convierte la fila de encabezados en columnas con nombre único (el 2.º «COMENTARIOS» → COMENTARIOS_2). */
function leerEncabezados(celdas: string[], hasta: number): ColumnaPrograma[] {
  const vistos = new Map<string, number>();
  const out: ColumnaPrograma[] = [];
  for (let i = 0; i < Math.min(celdas.length, hasta); i++) {
    const base = normEncabezado(celdas[i]);
    if (base === '') continue;
    const n = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, n);
    out.push({ indice: i, nombre: n === 1 ? base : `${base}_${n}` });
  }
  return out;
}

/** Mínimo de rótulos conocidos distintos para tratar una fila como encabezado (T-A4-49). */
export const UMBRAL_ROTULOS_ENCABEZADO = 4;

/**
 * Cuenta los rótulos conocidos distintos de una fila. El encabezado es la fila con más
 * rótulos conocidos (no la que trae justo «CAJA» y «ORIGEN-DESTINO»): el programa de cada
 * terminal es «muy parecido» pero no idéntico, y puede faltarle o sobrarle alguna columna.
 */
function contarRotulosConocidos(celdas: string[], hasta: number): { total: number; cajaYOrigen: boolean } {
  const vistos = new Set<string>();
  for (let i = 0; i < Math.min(celdas.length, hasta); i++) {
    const c = celdas[i];
    if (c === '' || c.length > 40) continue;
    const n = normEncabezado(c);
    if (ENCABEZADOS_CONOCIDOS.has(n)) vistos.add(n);
  }
  return { total: vistos.size, cajaYOrigen: vistos.has('CAJA') && vistos.has('ORIGEN-DESTINO') };
}

export function leerProgramaCsv(textoCrudo: string, opciones: OpcionesLector): ResultadoLector {
  const topeFilas = opciones.topeFilas ?? TOPE_FILAS_PROGRAMA;
  const lateralDesde = opciones.columnaLateral ?? COLUMNA_LATERAL_PROGRAMA;
  const texto = textoCrudo.charCodeAt(0) === 0xfeff ? textoCrudo.slice(1) : textoCrudo;
  if (texto.replace(/[;,\s]/g, '') === '') {
    throw new ErrorLectorPrograma('El archivo está vacío: no trae ninguna fila del programa.');
  }
  const delim = texto.includes(';') ? ';' : ',';
  const cDelim = delim.charCodeAt(0);

  const filas: FilaCruda[] = [];
  const secciones: Seccion[] = [];
  const lateral: LateralCrudo[] = [];
  const avisos: AvisoLector[] = [];
  const nombresDesconocidos = new Set<string>();
  const firmasAvisadas = new Set<string>();

  let columnas: ColumnaPrograma[] | null = null;
  let sec: Seccion | null = null;
  let ultimaFecha: string | null = null;
  let hayEncabezado = false;
  let rotulosVigentes = 0;
  let filasDesdeEncabezado = 0;
  let filasEncontradas = 0;
  let avisoSinEncabezado = false;
  let lineaNo = 0;

  const aviso = (lineaCsv: number | null, codigo: AvisoLector['codigo'], mensaje: string) => {
    avisos.push({ lineaCsv, codigo, mensaje });
  };

  const nuevaSeccion = (titulo: string, linea: number | null, tipo: TipoSeccionPrograma, ruta: string | null) => {
    const fecha = leerFechaTitulo(titulo);
    let fechaPropia = fecha !== null;
    let f = fecha;
    if (f === null) {
      f = ultimaFecha;
      fechaPropia = false;
      if (tipo !== 'OTRO') {
        aviso(
          linea,
          'titulo_sin_fecha',
          f
            ? `La sección «${titulo.replace(/\s+/g, ' ').trim()}» no trae fecha; se usó la de la sección anterior (${f}).`
            : `La sección «${titulo.replace(/\s+/g, ' ').trim()}» no trae fecha y no hay una sección anterior de la que tomarla.`,
        );
      }
    } else {
      ultimaFecha = f;
    }
    sec = {
      tipo, fecha: f, fechaPropia, ruta, titulo: titulo.replace(/\s+/g, ' ').trim(),
      lineaTitulo: linea, lineaEncabezado: null, filas: 0,
    };
    secciones.push(sec);
  };

  let pos = 0;
  const largo = texto.length;
  for (;;) {
    // Una fila lógica puede abarcar varias líneas físicas cuando una celda entre
    // comillas trae un salto de línea literal (export de Excel a CSV). Se acumulan
    // líneas mientras el número de comillas de la fila sea impar (comilla abierta
    // sin cerrar); `lineaNo` cuenta TODAS las líneas físicas consumidas (para que
    // `resumen.lineas` siga siendo el total real), pero la fila se reporta con la
    // línea donde empezó.
    const inicioRegistro = pos;
    const lineaDelRegistro = lineaNo + 1;
    // Solo se cuentan comillas dentro de las columnas del programa (antes de la
    // tabla lateral): la marca de tiempo de la lateral trae a veces una comilla
    // suelta (sin pareja) que NO es una celda sin cerrar (ver fixtures.ts /
    // «marca de tiempo con comilla final»), y no debe disparar una unión de líneas.
    let comillas = 0;
    let columna = 0;
    let finRegistro = pos;
    for (;;) {
      let e = texto.indexOf('\n', pos);
      const ultimaLinea = e === -1;
      if (ultimaLinea) e = largo;
      lineaNo++;
      for (let i = pos; i < e; i++) {
        const ch = texto.charCodeAt(i);
        if (ch === cDelim) columna++;
        else if (ch === 34 && columna < lateralDesde) comillas++;
      }
      finRegistro = e;
      if (ultimaLinea) { pos = e; break; }
      pos = e + 1;
      if (comillas % 2 === 0) break;
    }

    // Cortar relleno final (delimitadores, CR, espacios) sin dividir toda la línea.
    let fin = finRegistro;
    while (fin > inicioRegistro) {
      const ch = texto.charCodeAt(fin - 1);
      if (ch === cDelim || ch === 13 || ch === 32 || ch === 9) fin--;
      else break;
    }
    if (fin > inicioRegistro) {
      const celdas = texto.slice(inicioRegistro, fin).split(delim);
      procesarLinea(celdas, lineaDelRegistro);
    }
    if (pos >= largo) break;
  }

  function procesarLinea(celdas: string[], linea: number) {
    const tope = Math.min(celdas.length, lateralDesde);
    let pobladas = 0;
    let primera = -1;
    for (let i = 0; i < tope; i++) {
      if (celdas[i].trim() !== '') {
        pobladas++;
        if (primera === -1) primera = i;
      }
    }

    // 1) Título de sección: una sola celda poblada en las columnas del programa.
    if (pobladas === 1) {
      const texto1 = celdas[primera];
      const clase = clasificarTitulo(texto1);
      const parecePlano = primera === 0 && !/^[\d.,]+$/.test(texto1.trim());
      if (clase || parecePlano) {
        const t = clase ?? { tipo: 'OTRO' as TipoSeccionPrograma, ruta: null };
        if (!clase) {
          aviso(linea, 'titulo_desconocido', `Título de sección no reconocido: «${texto1.replace(/\s+/g, ' ').trim()}».`);
        }
        nuevaSeccion(texto1, linea, t.tipo, t.ruta);
        return;
      }
    }

    // 2) Fila de encabezados: la de mayor número de rótulos conocidos (>= umbral). Las repetidas
    //    en secciones siguientes se absorben; dos candidatos seguidos sin datos en medio: gana el de más rótulos.
    //    Compatibilidad: «CAJA» + «ORIGEN-DESTINO» con >= 4 celdas pobladas sigue contando como encabezado.
    const cuenta = pobladas >= UMBRAL_ROTULOS_ENCABEZADO ? contarRotulosConocidos(celdas, lateralDesde) : null;
    const rotulos = cuenta?.total ?? 0;
    if (cuenta && (rotulos >= UMBRAL_ROTULOS_ENCABEZADO || cuenta.cajaYOrigen)) {
      if (
        columnas && filasDesdeEncabezado === 0 && rotulos <= rotulosVigentes
        && (sec as Seccion | null)?.lineaEncabezado != null
      ) return;
      const cols = leerEncabezados(celdas, lateralDesde);
      if (!sec) {
        aviso(linea, 'encabezado_sin_titulo', 'Hay encabezados antes de cualquier título de sección; se tratan como una sección sin tipo.');
        nuevaSeccion('', null, 'OTRO', null);
      }
      const s = sec as Seccion | null;
      if (s && (s.lineaEncabezado === null || filasDesdeEncabezado === 0)) s.lineaEncabezado = linea;
      columnas = cols;
      rotulosVigentes = rotulos;
      filasDesdeEncabezado = 0;
      hayEncabezado = true;
      const firma = cols.map((c) => c.nombre).join('|');
      if (!firmasAvisadas.has(firma)) {
        firmasAvisadas.add(firma);
        const presentes = new Set(cols.map((c) => c.nombre));
        const faltan = ENCABEZADOS_ESPERADOS.filter((n) => !presentes.has(n));
        if (faltan.length > 0) {
          aviso(linea, 'columna_faltante', `Al encabezado le faltan columnas esperadas: ${faltan.join(', ')}.`);
        }
        for (const c of cols) {
          if (!ENCABEZADOS_CONOCIDOS.has(c.nombre) && !nombresDesconocidos.has(c.nombre)) {
            nombresDesconocidos.add(c.nombre);
            aviso(linea, 'encabezado_desconocido', `Encabezado desconocido «${c.nombre}»; se conserva tal cual.`);
          }
        }
      }
      return;
    }

    // 3) Tabla lateral (columnas posteriores a las del programa): siempre aparte.
    if (celdas.length > lateralDesde) {
      let hayLateral = false;
      for (let i = lateralDesde; i < celdas.length; i++) {
        if (celdas[i].trim() !== '') { hayLateral = true; break; }
      }
      if (hayLateral && lateral.length < topeFilas) {
        lateral.push({ lineaCsv: linea, celdas: celdas.slice(lateralDesde) });
      }
    }

    // 4) Fila de datos: al menos una celda del programa con contenido.
    if (pobladas === 0) return;
    if (!columnas) {
      if (!avisoSinEncabezado) {
        avisoSinEncabezado = true;
        aviso(linea, 'fila_sin_encabezado', 'Hay filas de datos antes de la primera fila de encabezados; se ignoran.');
      }
      return;
    }
    if (!sec) {
      nuevaSeccion('', null, 'OTRO', null);
    }
    const s = sec as Seccion;
    if (s.lineaEncabezado === null) {
      if (!firmasAvisadas.has(`sin-enc:${secciones.length}`)) {
        firmasAvisadas.add(`sin-enc:${secciones.length}`);
        aviso(linea, 'seccion_sin_encabezado', `La sección «${s.titulo}» no trae encabezados; se usaron los de la sección anterior.`);
      }
    }
    filasEncontradas++;
    filasDesdeEncabezado++;
    if (filas.length >= topeFilas) return;
    const obj: Record<string, string> = {};
    for (const c of columnas) obj[c.nombre] = c.indice < celdas.length ? celdas[c.indice] : '';
    filas.push({ lineaCsv: linea, seccion: secciones.length - 1, celdas: obj });
    s.filas++;
  }

  if (!hayEncabezado) {
    throw new ErrorLectorPrograma(
      `No se encontró la fila de encabezados del programa (debe traer al menos ${UMBRAL_ROTULOS_ENCABEZADO} rótulos conocidos, como «ORIGEN-DESTINO», «CAJA», «CLIENTE» o «UNIDAD»). `
      + 'Revisa que sea el CSV del programa de despacho.',
    );
  }
  if (filasEncontradas > filas.length) {
    aviso(
      null,
      'tope_filas',
      `Archivo recortado: se leyeron ${formatoMiles(filas.length)} de ${formatoMiles(filasEncontradas)} filas: el archivo rebasa el tope de ${formatoMiles(topeFilas)}.`,
    );
  }

  return {
    filas, secciones, lateral, avisos,
    resumen: {
      terminal: opciones.terminal, delimitador: delim, lineas: lineaNo,
      filasEncontradas, filasLeidas: filas.length,
    },
  };
}
