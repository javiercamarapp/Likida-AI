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
}

/**
 * Póliza en el layout de importación de CONTPAQi: una línea POR MOVIMIENTO,
 * repitiendo la cabecera en cada una (así lo espera el importador).
 *
 * `tipoMovimiento`: 0 = cargo, 1 = abono. Es la convención del formato, no una
 * elección nuestra.
 */
export function aContpaqi(poliza: Poliza, opts: OpcionesContpaqi): string {
  const SEP = ',';
  const cab = [
    'Tipo', 'Numero', 'Fecha', 'Concepto',
    'Cuenta', 'TipoMovimiento', 'Importe', 'Referencia', 'ConceptoMovimiento',
  ].join(SEP);

  const lineas = poliza.movimientos.map((m) =>
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

  return `${cab}\n${lineas.join('\n')}\n`;
}

export interface ArchivosSapB1 {
  /** Cabecera del asiento. */
  cabecera: string;
  /** Renglones del asiento. */
  lineas: string;
}

/**
 * Asiento en el layout del Data Transfer Workbench de SAP Business One, que
 * importa DOS archivos relacionados por `RecordKey`.
 *
 * DTW espera DOS filas de encabezado: la primera con el nombre técnico del
 * campo y la segunda con su descripción. Omitir la segunda es el error más
 * común al armar estos archivos a mano — el importador la consume como si
 * fuera un registro y descarta el primer renglón real.
 */
export function aSapB1(poliza: Poliza, recordKey = 1): ArchivosSapB1 {
  const SEP = '\t';

  const cabecera = [
    ['RecordKey', 'ReferenceDate', 'DueDate', 'TaxDate', 'Memo'].join(SEP),
    ['RecordKey', 'ReferenceDate', 'DueDate', 'TaxDate', 'Memo'].join(SEP),
    [recordKey, poliza.fecha, poliza.fecha, poliza.fecha, poliza.concepto]
      .map((c) => celda(c, SEP))
      .join(SEP),
  ].join('\n');

  const encLineas = ['RecordKey', 'LineNum', 'AccountCode', 'Debit', 'Credit', 'LineMemo', 'Reference1'];
  const lineas = [
    encLineas.join(SEP),
    encLineas.join(SEP),
    ...poliza.movimientos.map((m, i) =>
      [recordKey, i, m.cuenta, pesos(m.cargo), pesos(m.abono), m.concepto, m.referencia]
        .map((c) => celda(c, SEP))
        .join(SEP),
    ),
  ].join('\n');

  return { cabecera: `${cabecera}\n`, lineas: `${lineas}\n` };
}
