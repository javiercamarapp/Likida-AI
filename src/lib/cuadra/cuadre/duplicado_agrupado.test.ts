import { describe, it, expect } from 'vitest';
import { cuadrarViaje } from './engine';
import type { Gasto } from '@/types/cuadra';

// ═══════════════════════════════════════════════════════════════════════════
// 1-ago-2026 · DOS LÍNEAS IDÉNTICAS EN EL CIERRE, PALABRA POR PALABRA.
//
// Primer ensayo con tickets reales. El mismo Costco entró TRES veces y el
// mensaje de cierre que leyó el operador decía:
//
//   • Comprobante duplicado: Alimentación folio 3522 por $7,881.05 aparece dos
//     veces (excluido del total).
//   • Comprobante duplicado: Alimentación folio 3522 por $7,881.05 aparece dos
//     veces (excluido del total).
//
// El motor tenía razón —había dos copias sobrantes y las excluyó bien— pero
// repetir el mismo texto se lee como un sistema roto, y ese mensaje se proyecta
// delante de quien decide la compra. Encima "aparece dos veces" era falso:
// aparecía tres.
//
// Una línea por COMPROBANTE repetido, no una por copia.
// ═══════════════════════════════════════════════════════════════════════════

const g = (id: string, over: Partial<Gasto> = {}): Gasto => ({
  id, viajeId: 'v1', concepto: 'alimentacion', monto: 7881.05,
  folio: '3522', fecha: '2026-07-01', ocrConfianza: 0.95, ...over,
} as Gasto);

const cuadre = (gastos: Gasto[]) => cuadrarViaje({
  viajeId: 'v1', anticipo: 10000, gastos,
  politica: [{ concepto: 'alimentacion', topeMonto: 900000 }],
  empresaRfc: 'CCO8605231N4', hoy: '2026-08-01',
});

const dupes = (gastos: Gasto[]) =>
  (cuadre(gastos).diferencias ?? []).filter((d) => d.tipo === 'duplicado');

describe('el mismo comprobante repetido da UNA línea', () => {
  it('tres apariciones → una sola diferencia, y dice TRES', () => {
    const d = dupes([g('a'), g('b'), g('c')]);
    expect(d, 'una línea por copia en vez de una por comprobante').toHaveLength(1);
    expect(d[0].nota).toContain('aparece 3 veces');
    expect(d[0].nota).toContain('2 excluidas del total');
  });

  it('dos apariciones lo dice en singular', () => {
    const d = dupes([g('a'), g('b')]);
    expect(d).toHaveLength(1);
    expect(d[0].nota).toContain('aparece 2 veces');
    expect(d[0].nota).toContain('una excluida del total');
  });

  it('apunta al ORIGINAL, que es el que hay que abrir', () => {
    // El `gastoId` es con lo que el contralor abre el comprobante en el panel.
    // Mandarlo a una copia no le sirve para decidir cuál se queda.
    const d = dupes([g('original'), g('copia1'), g('copia2')]);
    expect(d[0].gastoId).toBe('original');
  });

  it('el impacto en pesos es lo EXCLUIDO, no el valor de una copia', () => {
    // Con tres apariciones se excluyeron dos: $15,762.10, no $7,881.05.
    const d = dupes([g('a'), g('b'), g('c')]);
    expect(d[0].monto).toBe(15762.10);
  });

  it('y el comprobado sigue contando UNA sola vez', () => {
    // Lo que no puede romperse al cambiar la presentación.
    expect(cuadre([g('a'), g('b'), g('c')]).totalComprobado).toBe(7881.05);
  });

  it('dos comprobantes DISTINTOS repetidos dan dos líneas', () => {
    // El límite: agrupar no puede fundir comprobantes que no son el mismo.
    const otro = (id: string) => g(id, { folio: '9999', monto: 500 });
    const d = dupes([g('a'), g('b'), otro('x'), otro('y')]);
    expect(d).toHaveLength(2);
    expect(new Set(d.map((x) => x.gastoId))).toEqual(new Set(['a', 'x']));
  });

  it('sin duplicados no dice nada', () => {
    expect(dupes([g('a'), g('b', { folio: '7777' })])).toEqual([]);
  });
});
