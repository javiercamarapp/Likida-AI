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
  /** T-A1-41: consecutivo de liquidación y número de pago del origen; si faltan, el encabezado queda como antes. */
  numeroLiquidacion?: string;
  numeroPago?: string;
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

// ── Formato del cliente (copiado de sus desgloses originales, hoja «Formato») ───────────────────────────────────
// Columnas: B Monto | C:E Concepto (percepción) · G Monto | H:J Concepto | K No Vale (deducción). Fuente Aptos 12,
// cabeceras azul marino con letra blanca, celdas gris claro con borde discontinuo gris, total en caja con borde grueso.
const FILAS_MINIMAS = 9;
const AZUL = '002060';
const GRIS = 'F2F2F2';
const LINEA = '7F7F7F';
const APTOS = { nombre: 'Aptos', tam: 12 } as const;

const BASES: Record<string, EstiloCelda> = {
  etiqueta: { fuente: { ...APTOS, negrita: true }, relleno: 'FFFFFF', alineacion: { h: 'center', v: 'center' } },
  valor: { fuente: { ...APTOS }, relleno: GRIS, borde: { aba: 'thin' }, alineacion: { h: 'center', v: 'center' } },
  valorNegrita: { fuente: { ...APTOS, negrita: true }, relleno: GRIS, borde: { aba: 'thin' }, alineacion: { h: 'center', v: 'center' } },
  fecha: { fuente: { nombre: 'Aptos', tam: 9 }, relleno: GRIS, borde: { aba: 'thin' }, formato: 'fechaLarga', alineacion: { h: 'center', v: 'center' } },
  dias: { fuente: { ...APTOS, negrita: true }, relleno: GRIS, borde: { aba: 'thin' }, formato: 'dias', alineacion: { h: 'center', v: 'center' } },
  cabecera: { fuente: { ...APTOS, negrita: true, color: 'FFFFFF' }, relleno: AZUL, alineacion: { h: 'center', v: 'center' } },
  monto: { fuente: { ...APTOS }, relleno: GRIS, formato: 'contable', alineacion: { h: 'center', v: 'center' } },
  concepto: { fuente: { ...APTOS }, relleno: GRIS, alineacion: { h: 'center', v: 'center' } },
  vale: { fuente: { ...APTOS }, relleno: GRIS, formato: 'texto', alineacion: { h: 'center', v: 'center' } },
  suma: { fuente: { ...APTOS, negrita: true }, relleno: GRIS, formato: 'contable', alineacion: { h: 'center', v: 'center' } },
  cajaEtiqueta: { fuente: { ...APTOS, negrita: true }, relleno: 'FFFFFF', alineacion: { h: 'center', v: 'center' } },
  neto: { fuente: { nombre: 'Aptos', tam: 24, negrita: true, cursiva: true, color: AZUL }, relleno: GRIS, formato: 'contable', alineacion: { h: 'center', v: 'center' } },
  pie: { fuente: { ...APTOS }, alineacion: { h: 'left', v: 'center' } },
  marca: { fuente: { ...APTOS, negrita: true }, alineacion: { h: 'left', v: 'center' } },
};

/** Fecha civil AAAA-MM-DD → número de serie de Excel (días desde 1899-12-30). */
function serialExcel(iso: string): number {
  const { y, m, d } = partes(iso);
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

/** Genera el .xlsx del desglose. Determinista: mismos datos → mismos bytes. Sin fórmulas (los totales son los de la fuente). */
export function generarDesgloseXlsx(d: DatosDesglose): Uint8Array {
  const dias = d.dias ?? (Date.parse(`${d.hasta}T00:00:00Z`) - Date.parse(`${d.desde}T00:00:00Z`)) / 86_400_000 + 1;
  const celdas: CeldaXlsx[] = [];
  const comb: Combinacion[] = [];
  const estilos: Record<string, EstiloCelda> = {};
  /** Estilo base + lados con borde discontinuo gris (letras L, R, T, B). */
  const est = (base: string, lados = ''): string => {
    const k = `${base}|${lados}`;
    if (!estilos[k]) {
      const b = BASES[base]!;
      estilos[k] = lados
        ? { ...b, borde: { ...(lados.includes('L') ? { izq: 'dashed' as const } : {}), ...(lados.includes('R') ? { der: 'dashed' as const } : {}),
            ...(lados.includes('T') ? { arr: 'dashed' as const } : {}), ...(lados.includes('B') ? { aba: 'dashed' as const } : {}), color: LINEA } }
        : b;
    }
    return k;
  };
  const estM = (base: string, lados: Partial<Record<'izq' | 'der' | 'arr' | 'aba', 'medium'>>): string => {
    const k = `${base}|M${Object.keys(lados).sort().join('')}`;
    if (!estilos[k]) estilos[k] = { ...BASES[base]!, borde: lados };
    return k;
  };
  const put = (fila: number, col: number, valor: string | number | null, estilo: string) => celdas.push({ fila, col, valor, estilo });
  /** Combina c1..c2 en una fila: el valor va en la primera; cada celda recibe su estilo (lados por posición). */
  const fusion = (fila: number, c1: number, c2: number, valor: string | number | null, base: string, lados: (pos: 'ini' | 'med' | 'fin') => string) => {
    for (let c = c1; c <= c2; c++) put(fila, c, c === c1 ? valor : null, est(base, lados(c === c1 ? 'ini' : c === c2 ? 'fin' : 'med')));
    comb.push({ filaDesde: fila, colDesde: c1, filaHasta: fila, colHasta: c2 });
  };
  const todos = () => 'LRTB';
  const conceptoLados = (pos: 'ini' | 'med' | 'fin') => (pos === 'med' ? 'TB' : 'RTB');

  // Encabezado: filas 2 y 4 (las 1, 3 y 5 son separadores finos).
  put(2, 2, 'Operador:', est('etiqueta'));
  fusion(2, 3, 5, d.operador, 'valor', () => '');
  put(2, 7, 'Unidad:', est('etiqueta')); put(2, 8, d.unidad ?? null, est('valorNegrita'));
  put(2, 10, 'Bitacora:', est('etiqueta')); put(2, 11, d.bitacora ?? null, est('valorNegrita'));
  put(4, 2, 'De:', est('etiqueta'));
  fusion(4, 3, 5, serialExcel(d.desde), 'fecha', () => '');
  put(4, 7, 'A:', est('etiqueta'));
  fusion(4, 8, 10, serialExcel(d.hasta), 'fecha', () => '');
  put(4, 11, dias, est('dias'));

  // Bloques.
  fusion(6, 2, 5, 'Percepción', 'cabecera', (p) => (p === 'ini' ? 'LRTB' : p === 'fin' ? 'RTB' : 'TB'));
  fusion(6, 7, 11, 'Deducción', 'cabecera', (p) => (p === 'ini' ? 'LRTB' : p === 'fin' ? 'RTB' : 'TB'));
  put(7, 2, 'Monto', est('cabecera', 'LTB'));
  fusion(7, 3, 5, 'Concepto', 'cabecera', (p) => (p === 'ini' ? 'TB' : p === 'fin' ? 'RTB' : 'TB'));
  put(7, 7, 'Monto', est('cabecera', 'LTB'));
  fusion(7, 8, 10, 'Concepto', 'cabecera', (p) => (p === 'ini' ? 'TB' : p === 'fin' ? 'RTB' : 'TB'));
  put(7, 11, 'No Vale', est('cabecera', todos()));

  const filas = Math.max(FILAS_MINIMAS, d.percepciones.length, d.deducciones.length);
  for (let i = 0; i < filas; i++) {
    const p = d.percepciones[i], de = d.deducciones[i], f = 8 + i;
    put(f, 2, p ? p.monto : null, est('monto', todos()));
    fusion(f, 3, 5, p ? p.concepto : null, 'concepto', conceptoLados);
    put(f, 7, de ? de.monto : null, est('monto', todos()));
    fusion(f, 8, 10, de ? de.concepto : null, 'concepto', conceptoLados);
    put(f, 11, de?.vale ?? null, est('vale', todos()));
  }

  const totP = d.totalPercepciones ?? aPesos(d.percepciones.reduce((a, r) => a + aCent(r.monto), 0));
  const totD = d.totalDeducciones ?? aPesos(d.deducciones.reduce((a, r) => a + aCent(r.monto), 0));
  const neto = d.neto ?? aPesos(aCent(totP) - aCent(totD));
  const fTot = 8 + filas;
  put(fTot, 2, totP, est('suma', todos()));
  put(fTot, 7, totD, est('suma', todos()));

  // Caja «Total» con el neto, dos filas combinadas (G:G y H:J), tal cual el original.
  const fBox = fTot + 2;
  put(fBox, 7, 'Total', estM('cajaEtiqueta', { izq: 'medium', der: 'medium', arr: 'medium' }));
  put(fBox + 1, 7, null, estM('cajaEtiqueta', { izq: 'medium', der: 'medium', aba: 'medium' }));
  comb.push({ filaDesde: fBox, colDesde: 7, filaHasta: fBox + 1, colHasta: 7 });
  put(fBox, 8, neto, est('neto', 'RTB'));
  put(fBox, 9, null, est('neto', 'T')); put(fBox, 10, null, est('neto', 'RT'));
  put(fBox + 1, 8, null, est('neto', 'B')); put(fBox + 1, 9, null, est('neto', 'B')); put(fBox + 1, 10, null, est('neto', 'RB'));
  comb.push({ filaDesde: fBox, colDesde: 8, filaHasta: fBox + 1, colHasta: 10 });

  // Datos que el original no trae (número de liquidación, de pago y marca): debajo de la caja, sin alterar el cuerpo.
  let fPie = fBox + 3;
  if (d.marca) { put(fPie, 2, d.marca, 'marca'); fPie++; }
  const extra = [d.numeroLiquidacion ? `Liquidación: ${d.numeroLiquidacion}` : '', d.numeroPago ? `Pago: ${d.numeroPago}` : ''].filter(Boolean).join('   ·   ');
  if (extra) { put(fPie, 2, extra, 'pie'); fPie++; }

  const todosEstilos = { ...BASES, ...estilos };
  return crearLibro({
    hoja: 'Formato',
    celdas,
    combinaciones: comb,
    anchos: { 1: 2.14, 2: 13.71, 3: 13.14, 4: 12.86, 5: 21.71, 6: 1.43, 7: 13.71, 8: 10.86, 9: 10.86, 10: 11.43, 11: 13, 12: 2.14 },
    alturas: { 1: 7.5, 2: 15.75, 3: 7.5, 4: 15.75, 5: 7.5, 6: 15.75, 7: 15.75, [fTot]: 15.75, [fTot + 1]: 7.5, [fBox + 1]: 15.75, [fBox + 2]: 9.75 },
    estilos: todosEstilos,
    orientacion: 'portrait',
    ajustarAnchoPagina: true,
    zoom: 90,
    areaImpresion: { filaDesde: 2, colDesde: 2, filaHasta: Math.max(fBox + 1, fPie - 1), colHasta: 11 },
  });
}
