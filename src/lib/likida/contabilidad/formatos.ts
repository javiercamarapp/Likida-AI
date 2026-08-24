// ═══════════════════════════════════════════════════════════════════════════
// LOS DOS FORMATOS QUE LA LANDING NOMBRA: CONTPAQi y SAP Business One.
//
// ── HASTA DÓNDE LLEGA LO QUE AQUÍ SE AFIRMA ───────────────────────────────
// Estos layouts son los DOCUMENTADOS por cada producto. Que un archivo tenga
// la forma correcta no demuestra que una instancia concreta lo acepte: cada
// empresa configura sus tipos de póliza, sus segmentos de cuenta y su
// numeración. Por eso el módulo no dice «compatible»: dice qué formato genera,
// y la primera importación real contra la instancia del cliente es parte del
// piloto, no un detalle posterior.
//
// Lo que sí se puede afirmar sin verificar nada: esto ya no es un CSV de ocho
// columnas. Trae cuentas, cargos, abonos, referencia y desglose de IVA, que es
// lo que un asiento necesita para existir.
// ═══════════════════════════════════════════════════════════════════════════
import type { Poliza } from './poliza';

/** Escapa un campo para CSV/TXT delimitado. */
function celda(v: unknown, sep: string): string {
  const s = v == null ? '' : String(v);
  return s.includes(sep) || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

const pesos = (n: number) => n.toFixed(2);

/** CONTPAQi usa DD/MM/AAAA en el archivo de pólizas. */
function fechaContpaqi(iso: string): string {
  const [a, m, d] = iso.split('-');
  return d && m && a ? `${d}/${m}/${a}` : iso;
}

export interface OpcionesContpaqi {
  /** Tipo de póliza: 'Dr' diario, 'Ig' ingreso, 'Eg' egreso. Lo fija la flota. */
  tipo: string;
  /** Número de póliza. Lo asigna la contabilidad, no nosotros. */
  numero: number;
  /** Separador del esquema confirmado en la instancia del cliente. */
  separador?: ',' | '\t' | '|';
  /** Encabezado exacto del esquema confirmado. */
  encabezado?: string[];
}

export const ENCABEZADO_CONTPAQI = [
  'Tipo', 'Numero', 'Fecha', 'Concepto', 'Cuenta', 'TipoMovimiento',
  'Importe', 'Referencia', 'ConceptoMovimiento',
] as const;

/**
 * Póliza en el layout de importación de CONTPAQi: una línea POR MOVIMIENTO,
 * repitiendo la cabecera en cada una (así lo espera el importador).
 *
 * `tipoMovimiento`: 0 = cargo, 1 = abono. Es la convención del formato, no una
 * elección nuestra.
 */
export function filasContpaqi(poliza: Poliza, opts: OpcionesContpaqi): string[] {
  const SEP = opts.separador ?? ',';

  return poliza.movimientos.map((m) =>
    [
      opts.tipo,
      opts.numero,
      fechaContpaqi(poliza.fecha),
      poliza.concepto,
      m.cuenta,
      m.cargo > 0 ? 0 : 1,
      pesos(m.cargo > 0 ? m.cargo : m.abono),
      m.referencia,
      m.concepto,
    ]
      .map((c) => celda(c, SEP))
      .join(SEP),
  );
}

/** Una póliza aislada. Para periodos use `archivoContpaqi`: un solo encabezado. */
export function aContpaqi(poliza: Poliza, opts: OpcionesContpaqi): string {
  const sep = opts.separador ?? ',';
  const cab = opts.encabezado ?? [...ENCABEZADO_CONTPAQI];
  return `${cab.map((c) => celda(c, sep)).join(sep)}\n${filasContpaqi(poliza, opts).join('\n')}\n`;
}

export function archivoContpaqi(
  polizas: Poliza[],
  opts: Omit<OpcionesContpaqi, 'numero'> & { numeroInicial?: number },
): string {
  const sep = opts.separador ?? ',';
  const cab = opts.encabezado ?? [...ENCABEZADO_CONTPAQI];
  const filas = polizas.flatMap((p, i) => filasContpaqi(p, { ...opts, numero: (opts.numeroInicial ?? 1) + i }));
  return `${cab.map((c) => celda(c, sep)).join(sep)}\n${filas.join('\n')}\n`;
}

export interface ArchivosSapB1 {
  /** Cabecera del asiento. */
  cabecera: string;
  /** Renglones del asiento. */
  lineas: string;
}

export interface PerfilSapB1 {
  /** Nombres técnicos de la plantilla DTW confirmada por la flota. */
  cabeceraTecnica: string[];
  /** Segunda fila descriptiva de esa misma plantilla. */
  cabeceraVisible: string[];
  lineasTecnica: string[];
  lineasVisible: string[];
}

/**
 * Base OJDT/JDT1 del DTW. `JdtNum` y `Line_ID` son los campos técnicos del
 * asiento; `RecordKey` era un identificador inventado por la primera versión
 * de este export y no pertenece a esos objetos. Una flota puede necesitar
 * columnas adicionales o encabezados de otra versión: por eso el export real
 * exige un `PerfilSapB1` confirmado, en lugar de presentar esta base como una
 * plantilla universal.
 */
export const SAP_B1_BASE: PerfilSapB1 = {
  cabeceraTecnica: ['JdtNum', 'RefDate', 'DueDate', 'TaxDate', 'Memo'],
  cabeceraVisible: ['JdtNum', 'RefDate', 'DueDate', 'TaxDate', 'Memo'],
  lineasTecnica: ['JdtNum', 'Line_ID', 'Account', 'Debit', 'Credit', 'LineMemo', 'Ref1'],
  lineasVisible: ['JdtNum', 'Line_ID', 'Account', 'Debit', 'Credit', 'LineMemo', 'Ref1'],
};

/**
 * Asiento en el layout del Data Transfer Workbench de SAP Business One, que
 * importa DOS archivos relacionados por `RecordKey`.
 *
 * DTW espera DOS filas de encabezado: la primera con el nombre técnico del
 * campo y la segunda con su descripción. Omitir la segunda es el error más
 * común al armar estos archivos a mano — el importador la consume como si
 * fuera un registro y descarta el primer renglón real.
 */
export function aSapB1(poliza: Poliza, jdtNum = 1, perfil: PerfilSapB1 = SAP_B1_BASE): ArchivosSapB1 {
  const SEP = '\t';

  const cabecera = [
    perfil.cabeceraTecnica.join(SEP),
    perfil.cabeceraVisible.join(SEP),
    [jdtNum, poliza.fecha, poliza.fecha, poliza.fecha, poliza.concepto]
      .map((c) => celda(c, SEP))
      .join(SEP),
  ].join('\n');

  const lineas = [
    perfil.lineasTecnica.join(SEP),
    perfil.lineasVisible.join(SEP),
    ...poliza.movimientos.map((m, i) =>
      [jdtNum, i, m.cuenta, pesos(m.cargo), pesos(m.abono), m.concepto, m.referencia]
        .map((c) => celda(c, SEP))
        .join(SEP),
    ),
  ].join('\n');

  return { cabecera: `${cabecera}\n`, lineas: `${lineas}\n` };
}

/** Varias pólizas DTW: DOS archivos y un solo doble encabezado por archivo. */
export function archivoSapB1(polizas: Poliza[], perfil: PerfilSapB1): ArchivosSapB1 {
  const sep = '\t';
  const cabecera = [perfil.cabeceraTecnica.join(sep), perfil.cabeceraVisible.join(sep)];
  const lineas = [perfil.lineasTecnica.join(sep), perfil.lineasVisible.join(sep)];
  for (const [i, poliza] of polizas.entries()) {
    const jdtNum = i + 1;
    cabecera.push([jdtNum, poliza.fecha, poliza.fecha, poliza.fecha, poliza.concepto].map((c) => celda(c, sep)).join(sep));
    for (const [linea, m] of poliza.movimientos.entries()) {
      lineas.push([jdtNum, linea, m.cuenta, pesos(m.cargo), pesos(m.abono), m.concepto, m.referencia].map((c) => celda(c, sep)).join(sep));
    }
  }
  return { cabecera: `${cabecera.join('\n')}\n`, lineas: `${lineas.join('\n')}\n` };
}
