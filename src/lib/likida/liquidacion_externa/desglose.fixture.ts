// ═══════════════════════════════════════════════════════════════════════════
// DESGLOSE POR CORREO — el FIXTURE SINTÉTICO ISOMORFO (T-A1-01).
//
// Tiene la MISMA FORMA que un desglose real de bitácora (encabezado con operador, unidad, bitácora y días; bloque de
// percepciones; bloque de deducciones con vale en los anticipos) pero NINGUNA cifra, nombre ni folio real: este repo es
// público. Las cifras reales se prueban solo en local, con un JSON fuera del repo (env `LIKIDA_DESGLOSE_REAL_JSON`) que
// cumple el tipo `DesgloseFixture`, con su bloque `esperado`.
//
// Todo en pesos con dos decimales; la aritmética de comprobación se hace en centavos enteros.
// ═══════════════════════════════════════════════════════════════════════════

export interface RenglonDesglose {
  descripcion: string;
  monto: number;
  /** Número de vale (anticipos). Sin el asterisco que el capturista antepone para que Excel lo acepte. */
  vale?: string;
}

export interface DesgloseFixture {
  operador: { nombre: string };
  unidad: string;
  bitacora: string;
  /** AAAA-MM-DD, inclusivo en ambos extremos. */
  desde: string;
  hasta: string;
  dias: number;
  percepciones: RenglonDesglose[];
  deducciones: RenglonDesglose[];
  esperado: { percepciones: number; deducciones: number; neto: number };
  /**
   * Identidad de composición: la suma de las percepciones nombradas en `izquierda` (p. ej. Sueldo + Viáticos) es igual
   * a la suma de los importes de `derecha` (p. ej. dos pagos fijos más dos bonos). Los importes viven en el fixture.
   */
  identidad: { izquierda: string[]; derecha: number[] };
}

export const DESGLOSE_SINTETICO: DesgloseFixture = {
  operador: { nombre: 'Operador Ejemplo Uno' },
  unidad: '0001',
  bitacora: 'B-0001',
  desde: '2026-10-09',
  hasta: '2026-10-14',
  dias: 6,
  percepciones: [
    { descripcion: 'Sueldo', monto: 4000.0 },
    { descripcion: 'Viáticos', monto: 1500.5 },
    { descripcion: 'Movimiento', monto: 150 },
    { descripcion: 'Taxi', monto: 300 },
    { descripcion: 'Demora cliente', monto: 450 },
    { descripcion: 'KM. Extra', monto: 3000 },
    { descripcion: 'Talacha', monto: 300 },
    { descripcion: 'Movimiento', monto: 150 },
  ],
  deducciones: [
    { descripcion: 'Retención uno', monto: 300.25 },
    { descripcion: 'Retención dos', monto: 800.1 },
    { descripcion: 'Anticipo Ciudad Ejemplo', monto: 1000, vale: '100001' },
    { descripcion: 'Anticipo Ciudad Ejemplo', monto: 1000, vale: '100002' },
    { descripcion: 'Anticipo Ciudad Ejemplo', monto: 500, vale: '100003' },
    { descripcion: 'Descuento financiero', monto: 1400.15 },
  ],
  esperado: { percepciones: 9850.5, deducciones: 5000.5, neto: 4850 },
  // Sueldo 4 000.00 + Viáticos 1 500.50 = 5 500.50 = 2 × 2 000.00 + 2 × 750.25
  identidad: { izquierda: ['Sueldo', 'Viáticos'], derecha: [2000, 2000, 750.25, 750.25] },
};

/** Suma, en centavos, de las percepciones cuya descripción está en `nombres`. */
export const sumaPercepcionesNombradas = (d: DesgloseFixture, nombres: string[]): number =>
  d.percepciones.filter((r) => nombres.includes(r.descripcion)).reduce((a, r) => a + centavos(r.monto), 0);

/** Pesos → centavos enteros (sin errores de coma flotante). */
export const centavos = (pesos: number): number => Math.round(pesos * 100);

/** Suma de un bloque, en centavos. */
export const sumaCentavos = (renglones: RenglonDesglose[]): number =>
  renglones.reduce((a, r) => a + centavos(r.monto), 0);

/**
 * El desglose como CUERPO del contrato vigente (`validarLiquidacionExterna`). El contrato no admite unidad, bitácora ni
 * nombre: la bitácora entra como folio de viaje y el vale como `clave` del concepto.
 */
export function cuerpoLiquidacionDesde(d: DesgloseFixture): Record<string, unknown> {
  const concepto = (tipo: 'percepcion' | 'deduccion') => (r: RenglonDesglose) => ({
    ...(r.vale ? { clave: r.vale } : {}),
    descripcion: r.descripcion,
    tipo,
    monto: r.monto,
  });
  return {
    claveExterna: `DESGLOSE-${d.bitacora}`,
    sistemaOrigen: 'FIXTURE',
    operador: { telefono: '2899900001' },
    viajes: [d.bitacora],
    periodo: { desde: d.desde, hasta: d.hasta },
    conceptos: [...d.percepciones.map(concepto('percepcion')), ...d.deducciones.map(concepto('deduccion'))],
    total: d.esperado.neto,
    moneda: 'MXN',
  };
}

/** Días del periodo, inclusivo (9 → 14 = 6). */
export function diasInclusivos(desde: string, hasta: string): number {
  return (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000 + 1;
}
