// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 5 · CRÍTICO — el mensaje de WhatsApp se probaba por estructura, no
// por valor.
//
// `resumen.test.ts` (15 pruebas) verifica exhaustivamente QUIÉN VE QUÉ, y su
// fixture principal fija `diferencia: 0`. Con eso, la rama del signo se EJECUTA
// pero nunca se AFIRMA. El auditor:
//
//   · cambió `mxn(liq.totalComprobado)` por `× 10` (M14, `resumen.ts:51`) → verde;
//   · invirtió el signo de la diferencia (M16, `resumen.ts:54`), de modo que
//     "Sobró $X del anticipo (a favor de la empresa)" pasara a decir
//     "Pusiste $X de tu bolsa (a favor tuyo)" → verde.
//
// Este mensaje es la RESPUESTA AUTORITATIVA: lo que la guardia manda cuando el
// modelo narró cifras sin tool. Invertir de quién es la diferencia le dice al
// operador que la empresa le debe cuando es él quien debe, o al revés. Es dinero
// que alguien va a cobrar o a pagar leyendo esta línea.
//
// Aquí se afirma el VALOR de cada cifra y la DIRECCIÓN de la diferencia en sus
// tres ramas (positiva, negativa y cero).
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { resumenCuadre } from './resumen';
import type { Liquidacion } from '@/types/likida';

/**
 * El caso de oro. Las cifras no se pueden confundir entre sí: comprobado
 * (4,812.50), anticipo (5,000.00) y diferencia (187.50) son tres números
 * distintos, y ×10 de cualquiera de ellos tampoco coincide con ninguno.
 */
const oro = (extra: Partial<Liquidacion> = {}): Omit<Liquidacion, 'id' | 'creadaEn'> => ({
  viajeId: 'v1', totalComprobado: 4812.5, totalAnticipo: 5000, diferencia: 187.5,
  estatus: 'con_diferencias', diferencias: [], gastos: [],
  totalDeducible: 3000, totalNoDeducible: 612, totalPorConfirmar: 1200.5,
  iepsAcreditable: 0, litrosDieselAcreditables: 0, ivaAcreditable: 0, peajeAcreditable: 0,
  ...extra,
});

describe('resumenCuadre — las cifras del mensaje son las del motor', () => {
  // MUTACIÓN M14: `• Comprobado: ${mxn(liq.totalComprobado)}` → `× 10`.
  // Sobrevivía con 628/628 verde. El operador lee $48,125.00 donde comprobó
  // $4,812.50 y reclama —o le reclaman— la diferencia.
  it('el comprobado del mensaje es EXACTAMENTE el del motor (M14: ×10)', () => {
    const texto = resumenCuadre(oro(), true, 'operador');
    expect(texto).toContain('• Comprobado: $4,812.50');
    expect(texto).not.toContain('$48,125.00');
  });

  it('el anticipo del mensaje es EXACTAMENTE el del motor', () => {
    expect(resumenCuadre(oro(), true, 'operador')).toContain('• Anticipo: $5,000.00');
  });

  // CONTROL de las dos de arriba: si el mensaje trajera las cifras cambiadas de
  // lugar (comprobado donde va el anticipo), las dos afirmaciones anteriores
  // seguirían encontrando "$4,812.50" y "$5,000.00" en el texto. Esta las ata a
  // su renglón.
  it('cada cifra va en SU renglón, no intercambiadas', () => {
    const lineas = resumenCuadre(oro(), true, 'operador').split('\n');
    expect(lineas.find((l) => l.startsWith('• Comprobado:'))).toBe('• Comprobado: $4,812.50');
    expect(lineas.find((l) => l.startsWith('• Anticipo:'))).toBe('• Anticipo: $5,000.00');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTACIÓN M16 — se invierte el signo de la diferencia.
//
// `diferencia` es "+ a favor empresa, - a favor operador" (así lo documenta
// `types/likida.ts`). Las dos ramas dicen cosas opuestas y ninguna prueba las
// afirmaba: el fixture de `resumen.test.ts` tiene `diferencia: 0`, que cae en la
// tercera.
//
// Las tres ramas se prueban aquí con montos distintos, y cada una NIEGA
// explícitamente el texto de la otra: sin esa negación, intercambiar las ramas
// deja la prueba verde porque las dos frases siguen apareciendo en el archivo.
// ═══════════════════════════════════════════════════════════════════════════
describe('resumenCuadre — de quién es la diferencia', () => {
  it('sobró anticipo (+187.50) → a favor de la EMPRESA', () => {
    const texto = resumenCuadre(oro({ diferencia: 187.5 }), true, 'operador');
    expect(texto).toContain('• Sobró $187.50 del anticipo (a favor de la empresa)');
    expect(texto).not.toMatch(/de tu bolsa|a favor tuyo/);
  });

  it('el operador puso de su bolsa (-812.50) → a favor de ÉL, y en positivo', () => {
    // El monto se imprime con el signo ya volteado (`mxn(-liq.diferencia)`):
    // un "-$812.50" en el mensaje se lee como una deuda del chofer.
    const texto = resumenCuadre(oro({ totalAnticipo: 4000, diferencia: -812.5 }), true, 'operador');
    expect(texto).toContain('• Pusiste $812.50 de tu bolsa (a favor tuyo)');
    expect(texto).not.toMatch(/Sobró|a favor de la empresa/);
    expect(texto).not.toContain('-$812.50');
  });

  it('diferencia cero → cuadra exacto, sin frase de a favor de nadie', () => {
    const texto = resumenCuadre(oro({ totalAnticipo: 4812.5, diferencia: 0 }), true, 'operador');
    expect(texto).toContain('• Cuadra exacto');
    expect(texto).not.toMatch(/a favor|de tu bolsa/);
  });

  it('un peso de diferencia ya se declara: el redondeo no se traga la cifra', () => {
    expect(resumenCuadre(oro({ diferencia: 0.5 }), true, 'operador'))
      .toContain('• Sobró $0.50 del anticipo (a favor de la empresa)');
  });
});

// El bloque de acreditables es lo que Likida vende. Sus cifras también salen del
// motor y también se imprimían sin prueba de valor.
describe('resumenCuadre — los acreditables del mensaje son los del motor', () => {
  it('litros en LITROS, IVA y peaje en pesos, con los valores del motor', () => {
    const texto = resumenCuadre(
      oro({ litrosDieselAcreditables: 300, ivaAcreditable: 1116.4, peajeAcreditable: 500 }),
      true, 'contralor',
    );
    expect(texto).toContain('• Diésel elegible para el estímulo de IEPS: 300 L');
    expect(texto).toContain('• IVA: $1,116.40');
    expect(texto).toContain('• Peaje 50%: $500.00');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDITORÍA 7 · REINCIDENTE POR CUARTA RONDA — el mensaje de WhatsApp
  // interpolaba `liq.litrosDieselAcreditables` crudo, mientras el PDF
  // (`acreditable.ts:95`) y el panel (`utils.ts:48`) usan `toLocaleString`. Con
  // menos de 1,000 L no divergen (sin separador de millares que agregar); un
  // viaje real de carga federal cruza ese umbral sin esfuerzo, y ahí WhatsApp
  // decía "1850.5 L" y el PDF "1,850.5 L": el mismo número, dos formatos.
  // ═══════════════════════════════════════════════════════════════════════════
  it('litros por encima de 1,000: mismo separador de millares que el PDF y el panel', () => {
    const texto = resumenCuadre(oro({ litrosDieselAcreditables: 1850.5 }), true, 'contralor');
    expect(texto).toContain('1,850.5 L');
    expect(texto).not.toContain('1850.5 L');
  });
});
