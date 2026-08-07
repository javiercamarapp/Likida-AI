import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resumenLaboral } from './pagadero';
import { copiasDeComprobante } from '@/lib/likida/cuadre/engine';
import { sinComentarios } from '@/lib/pruebas/codigo';
import type { Gasto } from '@/types/likida';

// ═══════════════════════════════════════════════════════════════════════════
// 1-ago-2026 · EL PAPEL MANDABA PAGAR TRES VECES EL MISMO TICKET.
//
// Lo encontró Javier leyendo el primer PDF real y notando que un número no
// cuadraba. El párrafo de reembolso decía:
//
//     "$19,978.10 no son deducibles todavía, pero el operador puso el dinero:
//      se le reembolsan igual."
//
// …cuando el total comprobado del MISMO papel eran $16,297.05. Un párrafo que
// dice cuánto pagarle a alguien no puede pedir más de lo comprobado.
//
// La diferencia era exacta al centavo: $15,762.10, las dos copias sobrantes del
// mismo ticket de Costco. `resumenLaboral` recorría TODOS los gastos, incluidas
// las copias que el cuadre ya había excluido del total.
//
// Es la familia de siempre en este repo —el mismo hecho calculado en dos sitios
// que se separan— pero con la peor consecuencia posible: no un número raro en
// una pantalla, sino una instrucción de PAGO.
// ═══════════════════════════════════════════════════════════════════════════

const g = (id: string, over: Partial<Gasto> = {}): Gasto => ({
  id, viajeId: 'v1', concepto: 'alimentacion', monto: 7881.05,
  folio: '3522', ocrConfianza: 0.9, ...over,
} as Gasto);

/** El caso real: el Costco tres veces, y una carga de diésel aparte. */
const GASTOS = [g('costco'), g('copia1'), g('copia2'), g('diesel', { id: 'diesel', concepto: 'diesel', monto: 400, folio: 'D-1' })];

const resumen = (idsDuplicados?: Set<string>) => resumenLaboral({
  gastos: GASTOS,
  idsNoDeducibles: new Set(['costco', 'copia1', 'copia2', 'diesel']),
  idsPorConfirmar: new Set(),
  sobrePolitica: new Set(),
  idsDuplicados,
});

describe('el reembolso no cuenta las copias', () => {
  it('con las copias marcadas, paga el ticket UNA vez', () => {
    const dups = new Set(copiasDeComprobante(GASTOS).keys());
    expect(dups.size, 'no detectó las dos copias').toBe(2);
    expect(resumen(dups)!.montoPagadero).toBe(8281.05);   // 7881.05 + 400
  });

  it('sin marcarlas lo paga TRES veces — el bug que se vio en el PDF', () => {
    // El control. Sin él, la prueba de arriba pasaría igual con el bug puesto,
    // porque no distingue "lo arreglé" de "el caso no se daba".
    expect(resumen(undefined)!.montoPagadero).toBe(24043.15);  // 7881.05 × 3 + 400
  });

  it('y el texto que lee el contralor cambia con ello', () => {
    const dups = new Set(copiasDeComprobante(GASTOS).keys());
    expect(resumen(dups)!.texto).toContain('$8,281.05');
    expect(resumen(dups)!.texto).not.toContain('$24,043.15');
  });
});

describe('la detección de copias vive en UN solo sitio', () => {
  it('el PDF usa la función del motor, no su propia copia', () => {
    // Reconstruir la regla aquí sería reproducir el bug con otra forma: dos
    // criterios de "qué es un duplicado" que se separan con el tiempo.
    const pdf = sinComentarios(readFileSync('src/lib/likida/liquidacion/pdf.ts', 'utf8'));
    expect(pdf).toMatch(/copiasDeComprobante\(liq\.gastos\)/);
    expect(pdf).toMatch(/from '\.\.\/cuadre\/engine'/);
  });

  it('la primera aparición es el ORIGINAL y las demás sus copias', () => {
    const m = copiasDeComprobante(GASTOS);
    expect(m.get('copia1')).toBe('costco');
    expect(m.get('copia2')).toBe('costco');
    expect(m.has('costco'), 'el original no puede ser copia de sí mismo').toBe(false);
  });
});
