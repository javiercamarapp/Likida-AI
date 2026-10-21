import { describe, it, expect } from 'vitest';
import { cuadrarViaje, gruposSospechososSinFolio } from './engine';
import type { Gasto } from '@/types/likida';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA ADVERSARIAL (21-oct-2026, verificada con prueba real).
//
// `copiasDeComprobante` solo agrupa copias por `cfdiUuid` o por
// `concepto|folioNorm|monto|emisor`. Un gasto SIN folio legible Y SIN UUID de
// CFDI —ticket borroso, folio tapado, comprobante informal que no imprime
// folio— nunca entra a `vistoFolio` ni `vistoUuid`: nunca puede marcarse como
// copia, sin importar cuántas veces se repita el mismo concepto+monto+
// emisor+fecha cercana. El operador podía cobrar el mismo gasto dos o más
// veces sin que el motor lo detectara, y la liquidación podía salir
// "cuadrada" (verde) sobre ese hueco.
//
// LA REGLA DEL PRODUCTO (CLAUDE.md): "nunca inventar una cifra". La solución
// correcta NO es rechazar automáticamente —eso sería inventar una decisión
// sobre un dato ambiguo (dos cargadas de diésel iguales el mismo día pueden
// ser dos comprobantes legítimos)— sino DECLARAR LA SOSPECHA y mandarla a
// revisión humana, igual que ya hace `ocr_baja_confianza`.
// ═══════════════════════════════════════════════════════════════════════════

// `caseta` a propósito, no `alimentacion`: esta última dispara su PROPIA
// regla de soporte (LISR 28-V, `alimentacion_sin_soporte`) cuando no hay
// hospedaje/transporte en el viaje, y eso contaminaría la prueba — ya baja a
// `revisar` por una razón que no es la que se está probando aquí.
const g = (id: string, over: Partial<Gasto> = {}): Gasto => ({
  id, concepto: 'caseta', monto: 450, fecha: '2026-10-15',
  rfcEmisor: 'ABC010101AAA', ocrConfianza: 0.97, ...over,
} as Gasto);

const cuadre = (gastos: Gasto[]) => cuadrarViaje({
  viajeId: 'v1', anticipo: 10_000, gastos, politica: [], hoy: '2026-10-20',
});

const sospechas = (gastos: Gasto[]) =>
  (cuadre(gastos).diferencias ?? []).filter((d) => d.tipo === 'posible_duplicado_sin_folio');

describe('EL CASO DEL AUDITOR: 3 gastos idénticos sin folio ni UUID', () => {
  const tresIdenticos = [
    g('a', { imgHash: 'hash-a' }),
    g('b', { imgHash: 'hash-b' }),
    g('c', { imgHash: 'hash-c' }),
  ];

  it('gruposSospechososSinFolio los agrupa como UN grupo de 3', () => {
    const grupos = gruposSospechososSinFolio(tresIdenticos);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].map((x) => x.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('cuadrarViaje los declara sospechosos y manda la liquidación a revisar', () => {
    const l = cuadre(tresIdenticos);
    const d = sospechas(tresIdenticos);
    expect(d).toHaveLength(1);
    expect(d[0].nota).toContain('3 comprobantes');
    expect(d[0].nota).toContain('sin folio ni UUID de CFDI');
    expect(l.estatus).toBe('revisar');
  });

  it('NO excluye nada del total — no hay certeza de cuál (si alguno) es copia', () => {
    const l = cuadre(tresIdenticos);
    expect(l.totalComprobado).toBe(1350); // 450 × 3, ninguno excluido
  });

  it('el impacto declarado es $0: no se afirma cuánto se duplicó', () => {
    const d = sospechas(tresIdenticos);
    expect(d[0].monto).toBe(0);
  });

  it('corre IGUAL con OCR de alta confianza: el problema es la ausencia de folio/UUID, no la lectura', () => {
    const altaConfianza = [
      g('a', { imgHash: 'hash-a', ocrConfianza: 0.999 }),
      g('b', { imgHash: 'hash-b', ocrConfianza: 0.999 }),
      g('c', { imgHash: 'hash-c', ocrConfianza: 0.999 }),
    ];
    const d = sospechas(altaConfianza);
    expect(d).toHaveLength(1);
    // Y de paso: con esa confianza NO dispara `ocr_baja_confianza`, así que la
    // única razón por la que esta liquidación sale a revisar es la sospecha.
    const tipos = cuadre(altaConfianza).diferencias.map((x) => x.tipo);
    expect(tipos).not.toContain('ocr_baja_confianza');
    expect(tipos).toContain('posible_duplicado_sin_folio');
  });
});

describe('lo que NO debe disparar la sospecha (para no inventar certeza donde no la hay)', () => {
  it('dos comprobantes YA son patrón (2+), no hace falta llegar a tres', () => {
    const grupos = gruposSospechososSinFolio([g('a'), g('b')]);
    expect(grupos).toHaveLength(1);
  });

  it('un solo comprobante no produce ningún grupo', () => {
    expect(gruposSospechososSinFolio([g('a')])).toHaveLength(0);
  });

  it('SIN FECHA no se agrupa — no se puede afirmar "cercano" sin saber el día', () => {
    const grupos = gruposSospechososSinFolio([
      g('a', { fecha: undefined }),
      g('b', { fecha: undefined }),
    ]);
    expect(grupos).toHaveLength(0);
  });

  it('distinto EMISOR no se agrupa', () => {
    const grupos = gruposSospechososSinFolio([
      g('a', { rfcEmisor: 'ABC010101AAA' }),
      g('b', { rfcEmisor: 'XYZ020202BBB' }),
    ]);
    expect(grupos).toHaveLength(0);
  });

  it('distinto DÍA no se agrupa', () => {
    const grupos = gruposSospechososSinFolio([
      g('a', { fecha: '2026-10-15' }),
      g('b', { fecha: '2026-10-20' }),
    ]);
    expect(grupos).toHaveLength(0);
  });

  it('distinto MONTO no se agrupa', () => {
    const grupos = gruposSospechososSinFolio([
      g('a', { monto: 450 }),
      g('b', { monto: 451 }),
    ]);
    expect(grupos).toHaveLength(0);
  });

  it('un gasto CON folio nunca entra a esta función — eso ya lo ve `copiasDeComprobante`', () => {
    const grupos = gruposSospechososSinFolio([
      g('a', { folio: '100' }),
      g('b', { folio: '100' }),
      g('c', { folio: '100' }),
    ]);
    expect(grupos).toHaveLength(0);
  });

  it('un gasto CON cfdiUuid nunca entra a esta función', () => {
    const grupos = gruposSospechososSinFolio([
      g('a', { cfdiUuid: 'aaaaaaaa-1111-2222-3333-444444444444' }),
      g('b', { cfdiUuid: 'aaaaaaaa-1111-2222-3333-444444444444' }),
    ]);
    expect(grupos).toHaveLength(0);
  });

  it('3 comprobantes con folio real (aunque igual en todo lo demás) NO disparan la sospecha nueva', () => {
    const conFolio = [
      g('a', { folio: '900', folioNorm: '900' }),
      g('b', { folio: '900', folioNorm: '900' }),
      g('c', { folio: '900', folioNorm: '900' }),
    ];
    expect(sospechas(conFolio)).toHaveLength(0);
  });
});

describe('REGRESIÓN: el caso de folio con ceros a la izquierda (corrección 1-ago-2026) sigue intacto', () => {
  it('`05461` y `5461` siguen colapsando como copia confirmada (`duplicado`), no como sospecha', () => {
    const gastos = [
      g('a', { folio: '05461', folioNorm: '5461' }),
      g('b', { folio: '5461', folioNorm: '5461' }),
    ];
    const diferencias = cuadre(gastos).diferencias.map((d) => d.tipo);
    expect(diferencias).toContain('duplicado');
    expect(diferencias).not.toContain('posible_duplicado_sin_folio');
  });

  it('la liquidación sigue excluyendo la copia del total comprobado, como siempre', () => {
    const gastos = [
      g('a', { folio: '05461', folioNorm: '5461' }),
      g('b', { folio: '5461', folioNorm: '5461' }),
    ];
    const l = cuadre(gastos);
    expect(l.totalComprobado).toBe(450); // una sola, no 900
  });
});
