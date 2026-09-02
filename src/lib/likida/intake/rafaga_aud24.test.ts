import { describe, it, expect } from 'vitest';
import { lineaIncidencias, type Incidencia } from './rafaga';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 — el párrafo que resume la ráfaga, dos huecos:
//
// · AGEN-8 (MEDIO): «De tus 5 fotos» contaba lo que vio ESTA invocación. La
//   cadena se parte entre el webhook y el cron (LOTE = 40/min), así que el
//   chofer que mandó 5 leía «Anotado ✅», «De tus 2 fotos…», «De tus 2
//   fotos…». Regla del producto: nunca inventar una cifra.
// · AGEN-11 (BAJO): la foto repetida no tenía frase, así que la resta entre
//   las fotos que mandó y los comprobantes que hay quedaba sin explicar.
// ═══════════════════════════════════════════════════════════════════════════

const i = (tipo: Incidencia['tipo'], monto?: number): Incidencia => ({ tipo, monto });

describe('AGEN-8 · el resumen no afirma un total que no midió', () => {
  it('con varias fotos, habla de «las fotos que me mandaste» y NO de un número', () => {
    const t = lineaIncidencias(2, [i('ilegible'), i('ilegible')])!;
    expect(t).toContain('De las fotos que me mandaste,');
    expect(t, 'el 2 era el lote de la invocación, no su fajo').not.toMatch(/De tus \d+ fotos/);
  });

  it('los números que SÍ se midieron siguen ahí: cuántas fallaron y por qué', () => {
    const t = lineaIncidencias(5, [i('ilegible'), i('fallo_tecnico')])!;
    expect(t).toMatch(/\*1\* no la pude leer/);
    expect(t).toMatch(/\*1\* se me trabó de mi lado/);
  });

  it('con una sola foto no hay encabezado (su propio mensaje ya habló)', () => {
    const t = lineaIncidencias(1, [i('ilegible')])!;
    expect(t.startsWith('*1*')).toBe(true);
  });
});

describe('AGEN-11 · la foto repetida se nombra y no pide nada', () => {
  it('una repetida: lo dice, con el monto del comprobante que ya tenía', () => {
    const t = lineaIncidencias(3, [i('repetida', 1000)])!;
    expect(t).toMatch(/\*1\* venía repetida \(ya la tenía\)/);
    expect(t).toContain('$1,000.00');
    expect(t, 'no hay nada que reenviar: el comprobante ya está en el viaje').not.toMatch(/Reenv/);
  });

  it('varias repetidas concuerdan en plural', () => {
    const t = lineaIncidencias(6, [i('repetida', 100), i('repetida', 200)])!;
    expect(t).toMatch(/\*2\* venían repetidas \(ya las tenía\)/);
  });

  it('sin monto conocido, no se inventa uno', () => {
    const t = lineaIncidencias(3, [i('repetida')])!;
    expect(t).toMatch(/\*1\* venía repetida \(ya la tenía\)\.$/);
  });

  it('mezclada con una ilegible: cada una con su frase, y la luz solo para la ilegible', () => {
    const t = lineaIncidencias(4, [i('repetida', 100), i('ilegible')])!;
    expect(t).toMatch(/no la pude leer/);
    expect(t).toMatch(/venía repetida/);
    expect(t).toMatch(/buena luz/);
  });
});
