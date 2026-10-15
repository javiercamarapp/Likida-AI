// Generador de fixtures SINTÉTICOS con la forma del programa de despacho
// (CSV con ';', 16 383 columnas, un título por sección y día, encabezados
// repetidos, tabla lateral desde la columna 20, ORIGEN-DESTINO en una celda).
// Todo dato es inventado: nada de clientes, consignatarios ni claves reales.
// SOLO para pruebas (.test.ts); no se importa desde código de producción.
//
// Devuelve el texto CSV (no se guarda ningún archivo de 16 383 columnas) y el
// ORÁCULO esperado, calculado en la misma pasada que genera el texto, para que
// T-A4-02/03 comparen sin duplicar lógica.

export type TipoSeccion = 'IMPORTACION' | 'EXPORTACION' | 'CANCELACIONES' | 'DOMESTICO' | 'MOV_VACIO';
export type TransitoEnum =
  | 'patio_nld' | 'en_ruta' | 'pend_cruce' | 'ok' | 'patio_otro' | 'na' | 'vacio' | 'desconocido';
export type CcpEnum =
  | 'listo' | 'despachado' | 'pend_reque' | 'pend_ccp' | 'falta_complemento' | 'vacio' | 'desconocido';

export const COLUMNAS_PROGRAMA = 16383;
/** Columnas propias del programa (índices 0..16). */
export const ENCABEZADOS_PROGRAMA = [
  '#', 'SUC', 'TIPO DE VIAJE', 'ORIGEN-DESTINO', 'CLIENTE', 'CONSIGNATARIO', 'LINEA', 'CAJA',
  'COMENTARIOS', 'CITA', 'CITA LIMITE', 'UNIDAD', 'COMENTARIOS', 'TRANSITO', 'CCP', 'ASIGNACION', 'SALIO',
] as const;
/** La tabla lateral empieza en la columna 20 (índice 19). */
export const INDICE_LATERAL = 19;
const COLUMNAS_MINIMAS = 25;

export interface OpcionesPrograma {
  /** Días consecutivos desde `fechaInicio` (por defecto 3). */
  dias?: number;
  /** AAAA-MM-DD; por defecto 2026-10-05 (lunes). */
  fechaInicio?: string;
  /** Secciones de cada día, en orden (por defecto las cinco). */
  secciones?: TipoSeccion[];
  /** Filas de datos por sección (por defecto 12). */
  filasPorSeccion?: number;
  /** Total EXACTO de filas de datos; sustituye a `filasPorSeccion` (prueba de tope: 70 000). */
  totalFilas?: number;
  /** Ancho de cada fila. Por defecto 16 383; para 70 000 filas baja a ~26 (si no, serían ~1 GB). */
  columnas?: number;
  /** Semilla del generador: misma semilla = mismo texto. */
  semilla?: number;
  /** Incluir los casos sucios (por defecto true). */
  sucios?: boolean;
  /** Código de terminal de la columna SUC (por defecto GDL). */
  terminal?: string;
}

export interface FilaOraculo {
  /** Línea física 1-based del archivo. */
  lineaCsv: number;
  fecha: string; // AAAA-MM-DD
  tipo: TipoSeccion;
  /** Ruta de la sección (solo DOMESTICO y MOV_VACIO), tal como viene en el título. */
  rutaSeccion: string | null;
  /** Valor de la columna '#', o null si la fila no lo trae. */
  num: number | null;
  suc: string;
  tipoViaje: string;
  /** Celda ORIGEN-DESTINO completa. */
  origenDestino: string;
  cliente: string | null;
  consignatario: string | null;
  /** LINEA con trim (el CSV trae «LNA » con espacio final en algún caso). */
  linea: string | null;
  /** Texto con trim y mayúsculas; los ceros a la izquierda se conservan. */
  caja: string | null;
  unidad: string | null;
  /** 'DIRECTO' si la cita lo dice; null en otro caso. */
  citaTexto: string | null;
  /** Hora local de pared AAAA-MM-DDTHH:mm (sin zona); «8:00» solo hereda la fecha de la sección. */
  citaLocal: string | null;
  transito: TransitoEnum;
  ccp: CcpEnum;
  comentarios: string | null;
  comentarios2: string | null;
  /** Sin CAJA, UNIDAD ni CLIENTE: T-A4-03 la descarta. */
  descartable: boolean;
}

export interface LateralOraculo {
  lineaCsv: number;
  consecutivo: string;
  unidad: string;
  marcaTiempo: string; // con la comilla final tal como viene
  codigo: string;
  letra: string;
}

export interface SeccionOraculo {
  tipo: TipoSeccion;
  fecha: string;
  /** false: el título no trae fecha (CANCELACIONES); la fecha es la del día. */
  fechaPropia: boolean;
  rutaSeccion: string | null;
  lineaTitulo: number;
  lineaEncabezado: number;
  filas: number;
}

export interface OraculoPrograma {
  filas: FilaOraculo[];
  secciones: SeccionOraculo[];
  lateral: LateralOraculo[];
  /** Líneas totalmente vacías (solo relleno). */
  lineasVacias: number[];
  resumen: {
    lineasTotales: number;
    columnas: number;
    titulos: number;
    encabezados: number;
    filasDatos: number;
    descartables: number;
    conCaja: number;
    conUnidad: number;
    sinCaja: number;
    cajaSinUnidad: number;
    unidadSinCaja: number;
    porTipo: Record<TipoSeccion, number>;
  };
}

export interface ProgramaSintetico {
  texto: string;
  oraculo: OraculoPrograma;
}

const TODAS: TipoSeccion[] = ['IMPORTACION', 'EXPORTACION', 'CANCELACIONES', 'DOMESTICO', 'MOV_VACIO'];
const DIAS = ['DOMINGO', 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO'];
const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE',
  'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
const RUTAS_DOMESTICO = ['MTY-GDL', 'GDL - JUAREZ', 'JRZ-GDL'];
const RUTA_VACIO = 'GDL - SIL - GDL';
const CLIENTES = ['CLIENTE SINT 01', 'CLIENTE SINT 02', 'CLIENTE SINT 03', 'CLIENTE SINT 04', 'CLIENTE SINT 05'];
const CONSIGNATARIOS = ['CONSIG SINT A', 'CONSIG SINT B', 'CONSIG SINT C'];
const LINEAS = ['LNA', 'LNB', 'LNC'];
const TRANSITOS_CRUDOS = ['PATIO NLD', 'EN RUTA', 'PEND CRUCE', 'OK', 'PATIO EXT', 'N/A', '', ' '];
const CCP_CRUDOS = ['LISTO', 'DESPACHADO', 'PEND REQUE CCP', 'PEND CCP', 'LISTO', 'DESPACHADO', ''];
const ORIGENES = ['NLD', 'MTY', 'JRZ'];

// PRNG determinista (mulberry32).
function prng(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dos = (n: number) => String(n).padStart(2, '0');
const cuatro = (n: number) => String(n).padStart(4, '0');

function transitoEnum(crudo: string): TransitoEnum {
  const v = crudo.trim().toUpperCase();
  if (v === '') return 'vacio';
  if (v === 'PATIO NLD') return 'patio_nld';
  if (v === 'EN RUTA') return 'en_ruta';
  if (v === 'PEND CRUCE') return 'pend_cruce';
  if (v === 'OK') return 'ok';
  if (v === 'PATIO EXT') return 'patio_otro';
  if (v === 'N/A') return 'na';
  return 'desconocido';
}

function ccpEnum(crudo: string): CcpEnum {
  const v = crudo.trim().toUpperCase();
  if (v === '') return 'vacio';
  if (v === 'LISTO') return 'listo';
  if (v === 'DESPACHADO') return 'despachado';
  if (v === 'PEND REQUE CCP') return 'pend_reque';
  if (v === 'PEND CCP') return 'pend_ccp';
  if (v === 'FALTA DE COMPLEMENTO') return 'falta_complemento';
  return 'desconocido'; // incluye «550»: dato fuera de columna
}

const vacioANull = (s: string): string | null => (s.trim() === '' ? null : s.trim());

function tituloSeccion(
  tipo: TipoSeccion, fecha: Date, ruta: string | null, dia: number, sucios: boolean, unidades: number,
): { texto: string; fechaPropia: boolean } {
  const dd = dos(fecha.getUTCDate());
  const mes = MESES[fecha.getUTCMonth()];
  const anio = fecha.getUTCFullYear();
  const nomDia = DIAS[fecha.getUTCDay()];
  const doble = sucios && dia % 2 === 1; // espacios dobles en días impares
  const sp = doble ? '  ' : ' ';
  const cuando = `${nomDia} ${dd} DE ${mes}${sp}${anio}`;
  switch (tipo) {
    case 'IMPORTACION': {
      const cifra = dia % 3 === 2 ? '' : `${unidades} `; // a veces sin cifra
      return {
        texto: `IMPORTACION${sp}${cuando} /// ${cifra}UNIDADES DISPONIBLES // SALEN HOY`,
        fechaPropia: true,
      };
    }
    case 'EXPORTACION':
      return { texto: `EXPORTACION${sp}${cuando}`, fechaPropia: true }; // sin sufijo
    case 'CANCELACIONES':
      return { texto: 'CANCELACIONES', fechaPropia: false };
    case 'DOMESTICO':
      return { texto: `DOMESTICO ${ruta}`, fechaPropia: false };
    case 'MOV_VACIO':
      return { texto: `MOV VACIO ${ruta}`, fechaPropia: false };
  }
}

const fechaIso = (f: Date) => `${f.getUTCFullYear()}-${dos(f.getUTCMonth() + 1)}-${dos(f.getUTCDate())}`;

export function construirProgramaSinteticoConOraculo(op: OpcionesPrograma = {}): ProgramaSintetico {
  const dias = op.dias ?? 3;
  const secciones = op.secciones ?? TODAS;
  const columnas = op.columnas ?? COLUMNAS_PROGRAMA;
  const sucios = op.sucios ?? true;
  const terminal = op.terminal ?? 'GDL';
  const semilla = op.semilla ?? 1;
  if (!Number.isInteger(dias) || dias < 1 || dias > 400) throw new RangeError('dias fuera de rango');
  if (!Number.isInteger(columnas) || columnas < COLUMNAS_MINIMAS || columnas > COLUMNAS_PROGRAMA) {
    throw new RangeError(`columnas debe estar entre ${COLUMNAS_MINIMAS} y ${COLUMNAS_PROGRAMA}`);
  }
  if (secciones.length === 0) throw new RangeError('secciones vacío');
  const totalSecciones = dias * secciones.length;
  let porSeccion: (idx: number) => number;
  if (op.totalFilas !== undefined) {
    if (!Number.isInteger(op.totalFilas) || op.totalFilas < 0 || op.totalFilas > 1_000_000) {
      throw new RangeError('totalFilas fuera de rango');
    }
    const base = Math.floor(op.totalFilas / totalSecciones);
    const resto = op.totalFilas % totalSecciones;
    porSeccion = (idx) => base + (idx < resto ? 1 : 0);
  } else {
    const n = op.filasPorSeccion ?? 12;
    if (!Number.isInteger(n) || n < 0) throw new RangeError('filasPorSeccion fuera de rango');
    porSeccion = () => n;
  }
  const [a, m, d] = (op.fechaInicio ?? '2026-10-05').split('-').map(Number);
  const inicio = new Date(Date.UTC(a, m - 1, d));
  if (Number.isNaN(inicio.getTime())) throw new RangeError('fechaInicio inválida');

  const rnd = prng(semilla);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];

  const lineas: string[] = [];
  const oraculo: OraculoPrograma = {
    filas: [], secciones: [], lateral: [], lineasVacias: [],
    resumen: {
      lineasTotales: 0, columnas, titulos: 0, encabezados: 0, filasDatos: 0, descartables: 0, conCaja: 0,
      conUnidad: 0, sinCaja: 0, cajaSinUnidad: 0, unidadSinCaja: 0,
      porTipo: { IMPORTACION: 0, EXPORTACION: 0, CANCELACIONES: 0, DOMESTICO: 0, MOV_VACIO: 0 },
    },
  };

  /** Cierra una fila: celdas + relleno hasta `columnas`. `crlf` solo en un caso sucio. */
  const emitir = (celdas: string[], crlf = false): number => {
    const k = Math.max(celdas.length, 1); // una fila vacía sigue siendo una celda vacía
    lineas.push(celdas.join(';') + ';'.repeat(Math.max(0, columnas - k)) + (crlf ? '\r' : ''));
    return lineas.length; // número de línea 1-based
  };

  let seccionIdx = 0;
  let consecutivo = 0;
  for (let dia = 0; dia < dias; dia++) {
    const fecha = new Date(inicio.getTime() + dia * 86_400_000);
    for (const tipo of secciones) {
      const n = porSeccion(seccionIdx);
      const ruta = tipo === 'DOMESTICO' ? RUTAS_DOMESTICO[dia % RUTAS_DOMESTICO.length]
        : tipo === 'MOV_VACIO' ? RUTA_VACIO : null;
      const titulo = tituloSeccion(tipo, fecha, ruta, dia, sucios, 10 + ((dia * 7 + seccionIdx) % 30));
      const lineaTitulo = emitir([titulo.texto]);
      oraculo.resumen.titulos++;
      const lineaEnc = emitir([...ENCABEZADOS_PROGRAMA]);
      oraculo.resumen.encabezados++;
      oraculo.secciones.push({
        tipo, fecha: fechaIso(fecha), fechaPropia: titulo.fechaPropia, rutaSeccion: ruta,
        lineaTitulo, lineaEncabezado: lineaEnc, filas: n,
      });

      for (let i = 1; i <= n; i++) {
        // Valores base.
        const origen = pick(ORIGENES);
        const origenDestino = tipo === 'IMPORTACION' ? `${origen}-${terminal}`
          : tipo === 'EXPORTACION' ? `${terminal}-${origen}`
          : ruta ?? `${origen}-${terminal}`;
        let cliente = pick(CLIENTES);
        const consignatario = pick(CONSIGNATARIOS);
        let linea = pick(LINEAS);
        // Caja: texto; cada 5.ª solo dígitos con ceros a la izquierda.
        const nCaja = 1000 + Math.floor(rnd() * 8000);
        let caja = i % 5 === 0 ? `00${nCaja}` : `ZC${cuatro(nCaja)}`;
        const nUni = 1000 + Math.floor(rnd() * 8000);
        let unidad = i % 3 === 0 ? String(nUni) : `ZU${cuatro(nUni)}`;
        if (rnd() < 0.25) unidad = ''; // en export a veces falta la unidad
        let comentarios = rnd() < 0.3 ? `NOTA SINT ${i}` : '';
        const comentarios2 = rnd() < 0.2 ? `OBS SINT ${i}` : '';
        const hora = `${8 + Math.floor(rnd() * 10)}:${rnd() < 0.5 ? '00' : '30'}`;
        let cita = `${dos(fecha.getUTCDate())}/${dos(fecha.getUTCMonth() + 1)}/${fecha.getUTCFullYear()} ${hora}`;
        let citaLimite = rnd() < 0.5 ? cita : '';
        let transito = pick(TRANSITOS_CRUDOS);
        let ccp = pick(CCP_CRUDOS);
        let num: string = String(i);
        let crlf = false;
        let vacia = false;

        if (sucios) {
          switch (i) {
            case 1: linea = `${linea} `; break; // LINEA con espacio final
            case 2: cita = 'DIRECTO'; citaLimite = ''; break;
            case 3: cita = '8:00'; break; // solo hora
            case 4: ccp = '550'; break; // dato fuera de columna
            case 5: ccp = 'FALTA DE COMPLEMENTO'; break;
            case 6: transito = ' '; break; // solo un espacio
            case 7: caja = ''; unidad = `ZU${cuatro(nUni)}`; break; // unidad sin caja
            case 8: caja = `ZC${cuatro(nCaja)}`; unidad = ''; break; // caja sin unidad
            case 9: caja = ''; unidad = ''; cliente = ''; comentarios = 'SOLO COMENTARIO'; break; // descartable
            case 10: num = ''; break; // fila sin '#'
            case 11: crlf = true; break; // termina en CRLF
            default: break;
          }
        }
        if (n >= 1 && i === n && sucios) vacia = true; // fila vacía tras la última fila de la sección

        const celdas: string[] = [
          num, terminal, tipo === 'IMPORTACION' ? 'IMPO' : tipo === 'EXPORTACION' ? 'EXPO'
            : tipo === 'CANCELACIONES' ? 'CANC' : tipo === 'DOMESTICO' ? 'DOM' : 'VACIO',
          origenDestino, cliente, consignatario, linea, caja, comentarios, cita, citaLimite, unidad,
          comentarios2, transito, ccp, '', '',
        ];
        // Tabla lateral en las columnas 20-24 de algunas filas.
        const conLateral = i % 7 === 0;
        let lateral: LateralOraculo | null = null;
        if (conLateral) {
          consecutivo++;
          while (celdas.length < INDICE_LATERAL) celdas.push('');
          const marca = `2026-10-${dos(1 + (consecutivo % 28))} ${dos(consecutivo % 24)}:${dos(consecutivo % 60)}:${dos((consecutivo * 7) % 60)}"`;
          const uni = `ZU${cuatro(2000 + consecutivo)}`;
          const cod = String(100000 + consecutivo * 13);
          const letra = 'PRS'[consecutivo % 3];
          celdas.push(String(consecutivo), uni, marca, cod, letra);
          lateral = { lineaCsv: 0, consecutivo: String(consecutivo), unidad: uni, marcaTiempo: marca, codigo: cod, letra };
        }
        const lineaCsv = emitir(celdas, crlf);
        if (lateral) { lateral.lineaCsv = lineaCsv; oraculo.lateral.push(lateral); }

        // Oráculo de la fila.
        const cajaN = vacioANull(caja)?.toUpperCase() ?? null;
        const unidadN = vacioANull(unidad)?.toUpperCase() ?? null;
        const citaT = cita.trim().toUpperCase() === 'DIRECTO' ? 'DIRECTO' : null;
        let citaLocal: string | null = null;
        if (!citaT) {
          const mc = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{1,2}):(\d{2})$/.exec(cita);
          if (mc) citaLocal = `${mc[3]}-${mc[2]}-${mc[1]}T${dos(Number(mc[4]))}:${mc[5]}`;
          else {
            const mh = /^(\d{1,2}):(\d{2})$/.exec(cita);
            if (mh) citaLocal = `${fechaIso(fecha)}T${dos(Number(mh[1]))}:${mh[2]}`;
          }
        }
        const clienteN = vacioANull(cliente);
        const fila: FilaOraculo = {
          lineaCsv, fecha: fechaIso(fecha), tipo, rutaSeccion: ruta,
          num: num === '' ? null : Number(num), suc: terminal, tipoViaje: celdas[2], origenDestino,
          cliente: clienteN, consignatario: vacioANull(consignatario), linea: vacioANull(linea),
          caja: cajaN, unidad: unidadN, citaTexto: citaT, citaLocal,
          transito: transitoEnum(transito), ccp: ccpEnum(ccp),
          comentarios: vacioANull(comentarios), comentarios2: vacioANull(comentarios2),
          descartable: cajaN === null && unidadN === null && clienteN === null,
        };
        oraculo.filas.push(fila);
        const r = oraculo.resumen;
        r.filasDatos++;
        r.porTipo[tipo]++;
        if (fila.descartable) r.descartables++;
        if (cajaN) r.conCaja++; else r.sinCaja++;
        if (unidadN) r.conUnidad++;
        if (cajaN && !unidadN) r.cajaSinUnidad++;
        if (unidadN && !cajaN) r.unidadSinCaja++;

        if (vacia) oraculo.lineasVacias.push(emitir([]));
      }
      seccionIdx++;
    }
  }
  oraculo.resumen.lineasTotales = lineas.length;
  // Cada línea (salvo la última) termina en \n; las que llevan \r terminan en CRLF.
  const texto = lineas.length === 0 ? '' : lineas.join('\n') + '\n';
  return { texto, oraculo };
}

/** Solo el texto CSV. */
export function construirProgramaSintetico(op: OpcionesPrograma = {}): string {
  return construirProgramaSinteticoConOraculo(op).texto;
}
