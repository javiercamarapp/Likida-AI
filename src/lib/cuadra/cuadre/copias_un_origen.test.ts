import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { cuadrarViaje, copiasDeComprobante } from './engine';
import { filasImprimibles } from '../liquidacion/omitidos';
import { resumenLaboral } from '../laboral/pagadero';
import { sinComentarios, fuentesDeProduccion } from '@/lib/pruebas/codigo';
import type { Gasto } from '@/types/cuadra';

// ═══════════════════════════════════════════════════════════════════════════
// "¿QUÉ GASTO ES COPIA?" TIENE TRES CONSUMIDORES, Y SE SEPARARON DOS VECES
// EN EL MISMO DÍA.
//
//   1. el CUADRE          las excluye del total comprobado
//   2. el REEMBOLSO       no puede pagar tres veces el mismo ticket
//   3. la TABLA del PDF   imprime una fila por comprobante, no por copia
//
// El 1-ago los tres derivaban la respuesta por su cuenta. Al agrupar las
// apariciones en UNA diferencia, su `gastoId` pasó a ser el ORIGINAL —lo que el
// contralor tiene que abrir— y los que preguntaban a las diferencias se
// rompieron en direcciones opuestas:
//
//   · el reembolso sumaba las copias: el papel mandaba pagar $19,978.10 con un
//     comprobado de $16,297.05;
//   · la tabla escondía el ORIGINAL e imprimía LAS DOS COPIAS, contradiciendo
//     su propia nota al pie ("1 comprobante duplicado" cuando eran 2).
//
// A las diferencias no se les puede preguntar esto: su `gastoId` responde a otra
// pregunta —cuál abrir— y las dos respuestas son distintas A PROPÓSITO.
// ═══════════════════════════════════════════════════════════════════════════

const g = (id: string, over: Partial<Gasto> = {}): Gasto => ({
  id, viajeId: 'v1', concepto: 'alimentacion', monto: 7881.05,
  folio: '3522', ocrConfianza: 0.9, ...over,
} as Gasto);

/** El caso real del ensayo: el Costco tres veces, más una carga. */
const GASTOS = [
  g('costco'), g('copia1'), g('copia2'),
  g('diesel', { concepto: 'diesel', monto: 400, folio: 'D-1' }),
];

const liq = cuadrarViaje({
  viajeId: 'v1', anticipo: 10000, gastos: GASTOS,
  politica: [{ concepto: 'alimentacion', topeMonto: 900000 }],
  empresaRfc: 'CCO8605231N4', hoy: '2026-08-01',
});

describe('los tres consumidores cuentan lo mismo', () => {
  it('el CUADRE cuenta el comprobante una vez', () => {
    expect(liq.totalComprobado).toBe(8281.05);   // 7881.05 + 400
  });

  it('la TABLA imprime una fila por comprobante, no por copia', () => {
    const { filas, duplicados } = filasImprimibles(liq);
    expect(filas.map((f) => f.id), 'imprimió copias en vez del original').toEqual(['costco', 'diesel']);
    expect(duplicados).toBe(2);
  });

  it('y la nota al pie coincide con la diferencia', () => {
    // El PDF decía "1 comprobante duplicado" mientras la diferencia decía
    // "2 excluidas". Dos cifras del mismo hecho, en la misma hoja.
    const { duplicados } = filasImprimibles(liq);
    const dif = (liq.diferencias ?? []).find((d) => d.tipo === 'duplicado')!;
    expect(dif.nota).toContain(`${duplicados} excluidas`);
  });

  it('el REEMBOLSO no paga las copias', () => {
    const lab = resumenLaboral({
      gastos: GASTOS,
      idsNoDeducibles: new Set(GASTOS.map((x) => x.id)),
      idsPorConfirmar: new Set(),
      sobrePolitica: new Set(),
      idsDuplicados: new Set(copiasDeComprobante(GASTOS).keys()),
    })!;
    expect(lab.montoPagadero).toBe(8281.05);
  });

  it('la fila que se imprime es el ORIGINAL, y la diferencia apunta a él', () => {
    // Tienen que ser el mismo gasto: el contralor lee la nota, busca esa fila y
    // abre ese comprobante. Si la diferencia señalara una copia que la tabla no
    // imprime, lo mandaría a buscar algo que no está.
    const { filas } = filasImprimibles(liq);
    const dif = (liq.diferencias ?? []).find((d) => d.tipo === 'duplicado')!;
    expect(filas.some((f) => f.id === dif.gastoId)).toBe(true);
  });
});

describe('y nadie vuelve a deducirlo de las diferencias', () => {
  it('ningún archivo saca los duplicados de `diferencias`', () => {
    // La forma exacta que se rompió: `diferencias.filter(d => d.tipo === 'duplicado')`
    // para saber QUÉ GASTOS son copia. Preguntar por las diferencias para
    // pintarlas está bien; para decidir qué gasto se esconde o se paga, no.
    const culpables = fuentesDeProduccion('src')
      .filter((f) => !f.includes('/cuadre/engine.ts'))
      .filter((f) => /tipo === 'duplicado'[^\n]*\n?[^\n]*gastoId/.test(sinComentarios(readFileSync(f, 'utf8'))));
    expect(
      culpables,
      'derivar "qué gasto es copia" de las diferencias: su gastoId apunta al ORIGINAL, no a las copias. Usa copiasDeComprobante().',
    ).toEqual([]);
  });

  it('los tres consumidores importan la función del motor', () => {
    for (const f of ['src/lib/cuadra/liquidacion/omitidos.ts', 'src/lib/cuadra/liquidacion/pdf.ts']) {
      expect(readFileSync(f, 'utf8'), `${f} no usa copiasDeComprobante`).toContain('copiasDeComprobante');
    }
  });
});
