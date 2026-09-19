import { describe, it, expect } from 'vitest';
import { copiasDeComprobante } from './engine';
import type { Gasto } from '@/types/likida';

// ═══════════════════════════════════════════════════════════════════════════
// FIS-C3 / ARQ32C3-C2 (auditoría 32 c3, CRÍTICO) — EL ESPEJO TS↔SQL SE ROMPIÓ
// POR EL EJE DEL EMISOR, Y LO ROMPIÓ ESTA MISMA RAMA.
//
// Dos auditores independientes —fiscal, desde la norma, y arquitectura, desde
// la estructura— llegaron al mismo sitio con pesos medidos contra Postgres 16:
//
//   · Las migraciones 0357/0358/0359 enseñaron al SQL que el folio SE REINICIA
//     POR EMISOR: dos tickets legítimos de $2,500 con folio 1234, de dos
//     gasolineras distintas, son DOS comprobantes, no uno.
//   · `copiasDeComprobante` —el criterio del motor, el que imprime el PDF y el
//     que `desde_db.ts:184-192` usa para restar el previo del 15 %— se quedó
//     mirando `concepto|folioNorm|monto`, SIN emisor.
//
// Resultado medido sobre las mismas dos filas: `/dashboard/fiscal` dice
// 2 comprobantes / $5,000 / $689.66 de IVA, y el PDF del mismo viaje dice
// 1 / $2,500 con un renglón «duplicado» sobre un ticket real. Antes de la 0359
// coincidían. Es textualmente lo que CLAUDE.md prohíbe: «una cifra fiscal que
// se lee distinto en dos pantallas se lee como dos cálculos».
//
// LA SEMÁNTICA QUE SE ESPEJA ES LA DE LA 0358, no la de la 0357: el emisor
// discrimina SÓLO CUANDO SE CONOCE, y la fila sin emisor hereda el del grupo
// en vez de abrir partición propia. Es el único campo de la llave que el OCR
// puede perder entero (`ocr.ts:560`), y por eso la 0357 —que lo metió a secas—
// trajo dos CRÍTICOS que la 0358 tuvo que cerrar. Los tres casos van abajo.
// ═══════════════════════════════════════════════════════════════════════════

const base = (over: Partial<Gasto>): Gasto => ({
  id: 'x', concepto: 'diesel', monto: 2500, folio: '1234', folioNorm: '1234',
  ...over,
} as unknown as Gasto);

describe('FIS-C3 · `copiasDeComprobante` espeja el dedup por emisor de la 0358', () => {
  it('CASO 1 — dos emisores CONOCIDOS y distintos: NO son copias (el folio se reinicia por estación)', () => {
    const copias = copiasDeComprobante([
      base({ id: 'a', rfcEmisor: 'PEM010101AAA' }),
      base({ id: 'b', rfcEmisor: 'GAS020202BBB' }),
    ]);
    expect(
      copias.size,
      'dos tickets reales de $2,500 con folio 1234 de estaciones distintas: el PDF marcaba uno como duplicado',
    ).toBe(0);
  });

  it('CASO 2 — el MISMO emisor conocido: siguen siendo copias (dos fotos del mismo ticket)', () => {
    const copias = copiasDeComprobante([
      base({ id: 'a', rfcEmisor: 'PEM010101AAA' }),
      base({ id: 'b', rfcEmisor: 'PEM010101AAA' }),
    ]);
    expect(copias.get('b')).toBe('a');
    expect(copias.size).toBe(1);
  });

  it('CASO 3 — el OCR perdió el emisor en UNA de las dos: la fila sin emisor HEREDA el del grupo', () => {
    // Éste es el que la 0357 rompió y la 0358 cerró: con el emisor ausente
    // abriendo partición propia, dos fotos del MISMO ticket de $2,500 sumaban
    // $5,000 y el PDF negaba $375 de deducción legítima.
    const copias = copiasDeComprobante([
      base({ id: 'a', rfcEmisor: 'PEM010101AAA' }),
      base({ id: 'b', rfcEmisor: undefined }),
    ]);
    expect(
      copias.get('b'),
      'sin herencia del grupo, la foto con el RFC perdido se cuenta como un ticket más',
    ).toBe('a');
  });

  it('CASO 3 bis — la herencia no depende del orden en que llegan las filas', () => {
    const copias = copiasDeComprobante([
      base({ id: 'a', rfcEmisor: undefined }),
      base({ id: 'b', rfcEmisor: 'PEM010101AAA' }),
    ]);
    expect(copias.get('b')).toBe('a');
    expect(copias.size).toBe(1);
  });

  it('CASO 4 — NADIE del grupo trae emisor: se comporta exactamente como antes de la 0357', () => {
    const copias = copiasDeComprobante([
      base({ id: 'a', rfcEmisor: undefined }),
      base({ id: 'b', rfcEmisor: undefined }),
    ]);
    expect(copias.get('b')).toBe('a');
    expect(copias.size).toBe(1);
  });

  it('el emisor NO cruza grupos: distinto monto sigue siendo distinto comprobante', () => {
    const copias = copiasDeComprobante([
      base({ id: 'a', monto: 2500, rfcEmisor: 'PEM010101AAA' }),
      base({ id: 'b', monto: 1800, rfcEmisor: undefined }),
    ]);
    expect(copias.size).toBe(0);
  });

  it('el UUID sigue mandando sobre el folio: un CFDI con emisor distinto no cambia la regla dura', () => {
    const copias = copiasDeComprobante([
      base({ id: 'a', cfdiUuid: 'UUID-1', rfcEmisor: 'PEM010101AAA' }),
      base({ id: 'b', cfdiUuid: 'uuid-1', rfcEmisor: 'GAS020202BBB' }),
    ]);
    expect(copias.get('b'), 'el mismo folio fiscal es el mismo comprobante, venga de donde venga').toBe('a');
  });
});
