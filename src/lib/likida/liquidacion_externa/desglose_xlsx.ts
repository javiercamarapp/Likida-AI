import { crearLibro, type CeldaXlsx, type Combinacion, type EstiloCelda } from './xlsx_minimo';

// ═══════════════════════════════════════════════════════════════════════════
// RENDERER «DESGLOSE IDÉNTICO» (T-A1-10): el .xlsx que recibe el operador, con el layout de la foto del impreso:
// encabezado, bloque «Percepción» (Monto | Concepto), bloque «Deducción» (Monto | Concepto | No Vale), totales por
// bloque y caja «Total» con el neto. Solo VALORES (nunca fórmulas): los totales son los de la fuente; Likida no
// recalcula. Sin título de empresa, sin pie y sin marca (R12) salvo que se pase `marca` expresamente.
// El layout es el de la foto; T-A1-11 lo ajusta con el Excel original (BLOQUEO EXTERNO).
// ═══════════════════════════════════════════════════════════════════════════

export interface RenglonXlsx {
  concepto: string;
  monto: number;
  /** Número de vale, SIN asterisco. Se escribe como texto. */
  vale?: string;
}

export interface DatosDesglose {
  operador: string;
  unidad?: string;
  bitacora?: string;
  /** AAAA-MM-DD (fecha civil). */
  desde: string;
  hasta: string;
  /** Días de la fuente; si falta, hasta−desde+1. */
  dias?: number;
  percepciones: RenglonXlsx[];
  deducciones: RenglonXlsx[];
  /** Totales de la fuente. Si faltan, se suman los renglones (en centavos) y se escriben como número. */
  totalPercepciones?: number;
  totalDeducciones?: number;
  neto?: number;
  /** Por defecto null: sin marca. */
  marca?: string | null;
}

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'] as const;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'] as const;

function partes(iso: string): { y: number; m: number; d: number } {
  const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!r) throw new Error(`Fecha inválida (se espera AAAA-MM-DD): ${iso}`);
  const y = Number(r[1]), m = Number(r[2]), d = Number(r[3]);
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) throw new Error(`Fecha inexistente: ${iso}`);
  return { y, m, d };
}

/** `2026-10-09` → `viernes, 9 de octubre de 2026`. Tabla propia (sin Intl/ICU); la fecha es civil, sin zona. */
export function fechaLarga(iso: string): string {
  const { y, m, d } = partes(iso);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DIAS_SEMANA[dow]}, ${d} de ${MESES[m - 1]} de ${y}`;
}

const aCent = (p: number): number => Math.round(p * 100);
const aPesos = (c: number): number => c / 100;

const FILAS_MINIMAS = 12;
const BORDE = { izq: 'thin', der: 'thin', arr: 'thin', aba: 'thin' } as const;
const PUNTEADO = { izq: 'dotted', der: 'dotted', arr: 'dotted', aba: 'dotted' } as const;

const ESTILOS: Record<string, EstiloCelda> = {
  etiqueta: { fuente: { negrita: true }, alineacion: { h: 'left', v: 'center' } },
  valor: { alineacion: { h: 'left', v: 'center' } },
  cabecera: { fuente: { negrita: true, color: 'FFFFFF' }, relleno: '404040', borde: BORDE, alineacion: { h: 'center', v: 'center' } },
  monto: { formato: 'contable', borde: PUNTEADO },
  concepto: { formato: 'texto', borde: PUNTEADO, alineacion: { h: 'left', ajustar: true } },
  vale: { formato: 'texto', borde: PUNTEADO, alineacion: { h: 'center' } },
  totalMonto: { formato: 'contable', fuente: { negrita: true }, borde: BORDE },
  totalEtiqueta: { fuente: { negrita: true }, borde: BORDE, alineacion: { h: 'left' } },
  cajaTotal: { fuente: { negrita: true }, borde: BORDE, alineacion: { h: 'center', v: 'center' } },
  neto: { formato: 'contable', fuente: { negrita: true, tam: 16 }, borde: BORDE, alineacion: { h: 'center', v: 'center' } },
  marca: { fuente: { negrita: true, tam: 12 }, alineacion: { h: 'left' } },
};

/** Genera el .xlsx del desglose. Determinista: mismos datos → mismos bytes. Sin fórmulas. */
export function generarDesgloseXlsx(d: DatosDesglose): Uint8Array {
  const dias = d.dias ?? (Date.parse(`${d.hasta}T00:00:00Z`) - Date.parse(`${d.desde}T00:00:00Z`)) / 86_400_000 + 1;
  const celdas: CeldaXlsx[] = [];
  const comb: Combinacion[] = [];
  const put = (fila: number, col: number, valor: string | number | null, estilo: string) => celdas.push({ fila, col, valor, estilo });
  const fusion = (fila: number, c1: number, c2: number, valor: string, estilo: string) => {
    put(fila, c1, valor, estilo);
    for (let c = c1 + 1; c <= c2; c++) put(fila, c, '', estilo);
    comb.push({ filaDesde: fila, colDesde: c1, filaHasta: fila, colHasta: c2 });
  };

  // Columnas: A Monto | B Concepto | C Monto | D Concepto | E No Vale | F (aire) | G–H caja Total
  let fila = 1;
  if (d.marca) { put(fila, 1, d.marca, 'marca'); fila++; }
  const f0 = fila;
  put(f0, 1, 'Operador:', 'etiqueta'); fusion(f0, 2, 5, d.operador, 'valor');
  put(f0 + 1, 1, 'Unidad:', 'etiqueta'); put(f0 + 1, 2, d.unidad ?? '', 'valor');
  put(f0 + 1, 3, 'Bitácora:', 'etiqueta'); put(f0 + 1, 4, d.bitacora ?? '', 'valor');
  put(f0 + 2, 1, 'De:', 'etiqueta'); fusion(f0 + 2, 2, 5, fechaLarga(d.desde), 'valor');
  put(f0 + 3, 1, 'A:', 'etiqueta'); fusion(f0 + 3, 2, 5, fechaLarga(d.hasta), 'valor');
  put(f0 + 3, 7, `${dias} días`, 'etiqueta');

  const fGrupo = f0 + 5;
  fusion(fGrupo, 1, 2, 'Percepción', 'cabecera');
  fusion(fGrupo, 3, 5, 'Deducción', 'cabecera');
  put(fGrupo + 1, 1, 'Monto', 'cabecera'); put(fGrupo + 1, 2, 'Concepto', 'cabecera');
  put(fGrupo + 1, 3, 'Monto', 'cabecera'); put(fGrupo + 1, 4, 'Concepto', 'cabecera'); put(fGrupo + 1, 5, 'No Vale', 'cabecera');

  const filas = Math.max(FILAS_MINIMAS, d.percepciones.length, d.deducciones.length);
  const fCuerpo = fGrupo + 2;
  for (let i = 0; i < filas; i++) {
    const p = d.percepciones[i], de = d.deducciones[i], f = fCuerpo + i;
    put(f, 1, p ? p.monto : null, 'monto'); put(f, 2, p ? p.concepto : null, 'concepto');
    put(f, 3, de ? de.monto : null, 'monto'); put(f, 4, de ? de.concepto : null, 'concepto'); put(f, 5, de?.vale ?? null, 'vale');
  }

  const totP = d.totalPercepciones ?? aPesos(d.percepciones.reduce((a, r) => a + aCent(r.monto), 0));
  const totD = d.totalDeducciones ?? aPesos(d.deducciones.reduce((a, r) => a + aCent(r.monto), 0));
  const neto = d.neto ?? aPesos(aCent(totP) - aCent(totD));
  const fTot = fCuerpo + filas;
  put(fTot, 1, totP, 'totalMonto'); put(fTot, 2, 'Total percepciones', 'totalEtiqueta');
  put(fTot, 3, totD, 'totalMonto'); put(fTot, 4, 'Total deducciones', 'totalEtiqueta'); put(fTot, 5, '', 'totalEtiqueta');

  fusion(fGrupo, 7, 8, 'Total', 'cajaTotal');
  put(fGrupo + 1, 7, neto, 'neto'); put(fGrupo + 1, 8, null, 'neto');
  put(fGrupo + 2, 7, null, 'neto'); put(fGrupo + 2, 8, null, 'neto');
  comb.push({ filaDesde: fGrupo + 1, colDesde: 7, filaHasta: fGrupo + 2, colHasta: 8 });

  return crearLibro({
    hoja: 'Desglose',
    celdas,
    combinaciones: comb,
    anchos: { 1: 16, 2: 32, 3: 16, 4: 32, 5: 12, 6: 3, 7: 14, 8: 14 },
    alturas: { [fGrupo]: 22 },
    estilos: ESTILOS,
    orientacion: 'landscape',
    ajustarAnchoPagina: true,
    areaImpresion: { filaDesde: 1, colDesde: 1, filaHasta: fTot, colHasta: 8 },
  });
}
