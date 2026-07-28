// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 5 · CRÍTICO — NINGUNA CIFRA QUE VE EL COMPRADOR ESTABA PROBADA.
//
// El auditor cambió `mxn(liq.totalComprobado)` por `mxn(liq.totalComprobado * 10)`
// en la línea que imprime el total del PDF (`pdf.ts:241`, mutación M11) y las 628
// pruebas siguieron verdes. Lo mismo al descablear las tres cubetas de
// deducibilidad (`const deduc = null`, `pdf.ts:246`, mutación M10) — que son
// literalmente "la cifra que compra el contralor" según el comentario del motor.
//
// `pdf.test.ts` ya tenía un extractor de texto del PDF que funciona, y lo usaba
// para verificar QUÉ SECCIONES aparecen según el destinatario. No lo usaba ni una
// vez para verificar UN MONTO. La frontera de las pruebas estaba en el `return`
// del motor: todo lo que pasa después —formatear, imprimir, enviar— se probaba
// por estructura, nunca por valor.
//
// Este archivo cierra eso: lee el PDF renderizado y compara CADA cifra impresa
// contra la que trae la liquidación. En el demo del 6-ago es el papel que el
// contralor mira, y un error de una línea llega íntegro al archivo que guarda.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { generarLiquidacionPDF } from './pdf';
import type { Liquidacion, Viaje, Operador } from '@/types/cuadra';

/**
 * Renglones DIBUJADOS del PDF, con su posición: `{ x, y, texto }`.
 *
 * pdf-lib emite cada `drawText` como `1 0 0 1 <x> <y> Tm\n<texto>\nT*`, y escribe
 * las cadenas en HEX (`<466F6C696F> Tj`). Con la posición se puede atar una
 * ETIQUETA a SU MONTO: los dos se dibujan en la misma `y` (el monto alineado a la
 * derecha con `right()`), así que "qué número salió impreso al lado de 'Total
 * comprobado'" es una pregunta que se puede contestar sobre el archivo real y no
 * sobre la intención del código.
 */
async function renglones(bytes: Uint8Array): Promise<Array<{ x: number; y: number; texto: string }>> {
  const { inflateSync } = await import('node:zlib');
  const buf = Buffer.from(bytes);
  let raw = '';
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x73 && buf.subarray(i, i + 6).toString('latin1') === 'stream') {
      let ini = i + 6;
      while (buf[ini] === 0x0d || buf[ini] === 0x0a) ini++;
      const fin = buf.indexOf(Buffer.from('endstream'), ini);
      if (fin < 0) continue;
      try { raw += inflateSync(buf.subarray(ini, fin)).toString('latin1'); } catch { /* no comprimido */ }
      i = fin;
    }
  }
  raw = raw.replace(/<([0-9A-Fa-f]+)>\s*Tj/g, (_m, hex: string) =>
    Buffer.from(hex, 'hex').toString('latin1'));
  const out: Array<{ x: number; y: number; texto: string }> = [];
  for (const m of raw.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm\n([^\n]*)\n/g)) {
    out.push({ x: Number(m[1]), y: Number(m[2]), texto: m[3] });
  }
  return out;
}

type Renglon = { x: number; y: number; texto: string };

/** El número que `mxn()` imprimió, o `null` si el texto no es un monto. */
function comoMonto(texto: string): number | null {
  const m = /^(-?)\$([\d,]+\.\d{2})$/.exec(texto.trim());
  return m ? Number(`${m[1]}${m[2].replace(/,/g, '')}`) : null;
}

/**
 * El MONTO impreso a la derecha de la etiqueta dada. Devuelve `undefined` si la
 * etiqueta no se imprimió — que es justo lo que pasa cuando alguien descablea el
 * bloque entero (M10), y por eso `undefined` tiene que hacer fallar la prueba.
 */
function montoJuntoA(rs: Renglon[], etiqueta: RegExp): number | undefined {
  const i = rs.findIndex((r) => etiqueta.test(r.texto));
  if (i < 0) return undefined;
  // El monto se dibuja inmediatamente después, en la MISMA y (misma hoja, mismo
  // renglón). Se miran los siguientes por si el renderer intercala algo.
  for (const r of rs.slice(i + 1, i + 4)) {
    if (r.y !== rs[i].y) break;
    const n = comoMonto(r.texto);
    if (n !== null) return n;
  }
  return undefined;
}

// El caso de oro. Las cifras están elegidas para que NINGUNA se pueda confundir
// con otra: si el PDF imprime el anticipo donde va el comprobado, o multiplica,
// o suma mal las cubetas, el número cambia y la prueba lo ve.
//
//   comprobado 4,812.50 = deducible 3,000.00 + por confirmar 1,200.50 + no ded. 612.00
//   anticipo   5,000.00
//   diferencia   187.50  (a favor de la EMPRESA: sobró anticipo)
//
// Los montos de los dos comprobantes (4,000.00 y 812.50) tampoco coinciden con
// ninguna cubeta, para que "aparece $3,000.00 en el papel" no se pueda satisfacer
// por accidente desde otro renglón.
const LIQ: Liquidacion = {
  id: 'l-oro', viajeId: 'v1', creadaEn: '2026-05-02T10:00:00Z',
  totalComprobado: 4812.5, totalAnticipo: 5000, diferencia: 187.5, estatus: 'con_diferencias',
  totalDeducible: 3000, totalNoDeducible: 612, totalPorConfirmar: 1200.5,
  iepsAcreditable: 0, litrosDieselAcreditables: 300, ivaAcreditable: 480, peajeAcreditable: 125,
  diferencias: [],
  gastos: [
    { id: 'g1', concepto: 'diesel', monto: 4000, folio: 'A1', fecha: '2026-05-01', cfdiUuid: 'u1' },
    { id: 'g2', concepto: 'hospedaje', monto: 812.5, folio: 'B2', fecha: '2026-05-01' },
  ],
};
const VIAJE: Viaje = { id: 'v1', folio: 'VJ-1', origen: 'Mérida', destino: 'Cancún', anticipo: 5000 };
const OPERADOR: Operador = { id: 'o1', nombre: 'Juan Pérez', telefono: '+52', terminal: 'Mérida' };

const delPdf = async (liq: Liquidacion = LIQ) =>
  renglones(await generarLiquidacionPDF(liq, VIAJE, OPERADOR));

describe('el PDF imprime las cifras del motor, no otras', () => {
  // CONTROL. Si el extractor no leyera montos de verdad, todo lo de abajo pasaría
  // por vacío. Esta prueba tiene que fallar si el extractor se rompe.
  it('el extractor de esta prueba de verdad lee montos del PDF renderizado', async () => {
    const rs = await delPdf();
    const montos = rs.map((r) => comoMonto(r.texto)).filter((n): n is number => n !== null);
    expect(montos.length, 'el extractor no encontró ni un monto en el PDF').toBeGreaterThan(4);
    expect(rs.some((r) => /Total comprobado/.test(r.texto))).toBe(true);
  });

  // MUTACIÓN M11: `mxn(liq.totalComprobado)` → `mxn(liq.totalComprobado * 10)`.
  // Sobrevivía con 628/628 en verde. Con $4,812.50 impreso como $48,125.00, el
  // contralor archiva un papel que dice que su operador gastó diez veces más.
  it('el "Total comprobado" impreso es EXACTAMENTE el del motor (M11: ×10)', async () => {
    expect(montoJuntoA(await delPdf(), /^Total comprobado$/)).toBe(4812.5);
  });

  // Mismo riesgo, otra línea: el anticipo es la otra mitad de la resta que el
  // contralor hace de cabeza al leer el papel.
  it('el "Anticipo entregado" impreso es EXACTAMENTE el del motor', async () => {
    expect(montoJuntoA(await delPdf(), /^Anticipo entregado$/)).toBe(5000);
  });

  // La diferencia se imprime en VALOR ABSOLUTO y el signo vive en la etiqueta.
  // Que el número esté bien y la etiqueta invertida es un error que se lee como
  // "la empresa te debe" cuando es al revés — el mismo bug que M16 mete en el
  // WhatsApp.
  it('la diferencia impresa lleva su monto y a favor de QUIÉN', async () => {
    const rs = await delPdf();
    expect(montoJuntoA(rs, /^Diferencia a favor de la empresa$/)).toBe(187.5);
    expect(rs.some((r) => /Diferencia a favor del operador/.test(r.texto))).toBe(false);
  });

  it('si el operador puso dinero de su bolsa, el papel dice que es a favor de ÉL', async () => {
    // Anticipo 4,000 contra 4,812.50 comprobado: la empresa le debe 812.50.
    const l: Liquidacion = { ...LIQ, totalAnticipo: 4000, diferencia: -812.5 };
    const rs = await delPdf(l);
    expect(montoJuntoA(rs, /^Diferencia a favor del operador$/)).toBe(812.5);
    expect(rs.some((r) => /Diferencia a favor de la empresa/.test(r.texto))).toBe(false);
  });

  it('cuando cuadra exacto lo dice, y no imprime una diferencia de cero', async () => {
    const l: Liquidacion = { ...LIQ, totalAnticipo: 4812.5, diferencia: 0 };
    const rs = await delPdf(l);
    expect(rs.some((r) => /^Cuadra exacto$/.test(r.texto))).toBe(true);
    expect(rs.some((r) => /Diferencia a favor/.test(r.texto))).toBe(false);
  });

  it('cada comprobante imprime SU monto, no el de otro renglón', async () => {
    const rs = await delPdf();
    // La tabla dibuja concepto → folio → fecha → estado → monto en la misma `y`.
    const montosDeTabla = rs
      .filter((r) => /^(Combustible|Hospedaje)$/.test(r.texto))
      .map((r) => rs.filter((o) => o.y === r.y).map((o) => comoMonto(o.texto)).find((n) => n !== null && n !== undefined));
    expect(montosDeTabla).toEqual([4000, 812.5]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTACIÓN M10 — `const deduc = filasDeducibilidad(liq)` → `null`.
//
// El PDF deja de imprimir las tres cubetas y sigue en verde. Es el desglose que
// el propio motor documenta como "la cifra que compra el contralor": cuánto de lo
// que gastó el operador sobrevive una revisión del SAT. Sin él, el papel es un
// estado de cuenta cualquiera.
//
// `deducibilidad.test.ts` prueba la FUNCIÓN que arma los renglones. Nadie probaba
// que el PDF la llamara.
// ═══════════════════════════════════════════════════════════════════════════
describe('el PDF imprime las tres cubetas y suman el total comprobado', () => {
  it('las tres cubetas están impresas con su monto (M10: descablearlas)', async () => {
    const rs = await delPdf();
    expect(montoJuntoA(rs, /^Deducible para ISR$/)).toBe(3000);
    expect(montoJuntoA(rs, /^Por confirmar$/)).toBe(1200.5);
    expect(montoJuntoA(rs, /^No deducible$/)).toBe(612);
  });

  it('los tres renglones impresos SUMAN el total comprobado impreso', async () => {
    // La invariante que hace que el papel no se contradiga a sí mismo. Se afirma
    // sobre lo IMPRESO, no sobre el objeto: es lo que ve quien lo lee.
    const rs = await delPdf();
    const suma = (montoJuntoA(rs, /^Deducible para ISR$/) ?? NaN)
      + (montoJuntoA(rs, /^Por confirmar$/) ?? NaN)
      + (montoJuntoA(rs, /^No deducible$/) ?? NaN);
    expect(suma).toBeCloseTo(montoJuntoA(rs, /^Total comprobado$/) ?? NaN, 2);
  });

  it('una cubeta en cero no se imprime, pero las otras dos siguen sumando el total', async () => {
    const l: Liquidacion = { ...LIQ, totalDeducible: 3612, totalNoDeducible: 0, totalPorConfirmar: 1200.5 };
    const rs = await delPdf(l);
    expect(montoJuntoA(rs, /^No deducible$/)).toBeUndefined();
    expect((montoJuntoA(rs, /^Deducible para ISR$/) ?? NaN) + (montoJuntoA(rs, /^Por confirmar$/) ?? NaN))
      .toBeCloseTo(4812.5, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Los LITROS son el beneficio más grande que Likida le enseña a una flota, y el
// único dato del bloque de acreditables que NO va en pesos a propósito: el
// estímulo del LIF 2026 art. 20-A es cuota semanal del DOF × litros, y el motor
// no puede calcularlo. Si el papel los imprimiera en pesos estaría inventando.
// ═══════════════════════════════════════════════════════════════════════════
describe('el PDF imprime los acreditables con las cifras del motor', () => {
  it('los litros de diésel salen en LITROS y son los del motor', async () => {
    const rs = await delPdf();
    const i = rs.findIndex((r) => /Di.sel elegible para el est.mulo de IEPS/.test(r.texto));
    expect(i, 'no se imprimió el renglón de diésel elegible').toBeGreaterThanOrEqual(0);
    expect(rs[i + 1].texto.trim()).toBe('300 L');
  });

  it('el IVA y el peaje acreditables son los del motor', async () => {
    const rs = await delPdf();
    expect(montoJuntoA(rs, /^IVA acreditable/)).toBe(480);
    expect(montoJuntoA(rs, /^Est.mulo de peaje 50%/)).toBe(125);
  });

  it('sin nada acreditable el bloque no aparece (no se inventa una sección vacía)', async () => {
    const l: Liquidacion = { ...LIQ, litrosDieselAcreditables: 0, ivaAcreditable: 0, peajeAcreditable: 0 };
    const rs = await delPdf(l);
    expect(rs.some((r) => /ACREDITABLE \/ RECUPERABLE/.test(r.texto))).toBe(false);
  });
});
