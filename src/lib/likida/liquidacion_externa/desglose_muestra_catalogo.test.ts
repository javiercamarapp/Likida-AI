import { describe, it, expect } from 'vitest';
import { claveConcepto, convertirBitacoraMuestra } from './desglose_muestra_tms';
import { BITACORA_MUESTRA, PADRON_MUESTRA } from './desglose_muestra_tms.fixture';
import { aLiquidacionExterna } from './desglose_contrato';
import { aplicarRenombres } from './desglose_reglas';

// Catálogo REAL de conceptos del cliente (valores exactos de `Descripcion`, 11-nov-2026). Datos sintéticos.
const PERCEPCIONES = [
  ['BOLETOS AUTOBUS', 'viaticos'], ['Bono Aut.', 'bono'], ['Bono C.D', 'bono'], ['Bono E.C', 'bono'], ['Bono E.M', 'bono'], ['Bono E.S', 'bono'],
  ['Bono HAZMAT', 'bono'], ['Bono Mes', 'bono'], ['Bono MNLD', 'bono'], ['Bono Pos', 'bono'], ['Bono PR', 'bono'], ['Bono R.L', 'bono'],
  ['Bono Rec.', 'bono'], ['Bono Termo', 'bono'], ['Bono U.I', 'bono'], ['Bono x Vuelta', 'bono'], ['DOMINGO LABORADO', 'domingo_laborado'],
  ['HORA EXTRA', 'hora_extra'], ['Otros', 'otros'], ['SUELDO BLINDADO', 'sueldo'], ['SUELDO GARANTIZADO', 'sueldo'], ['Sueldo Semanal', 'sueldo'],
  ['Sueldo x Vuelta', 'sueldo'], ['TAXI', 'viaticos'], ['Viatico', 'viaticos'], ['Viaticos', 'viaticos'],
] as const;
const DEDUCCIONES = [
  ['Anticipo Nomina', 'anticipo'], ['Anticipo Operador', 'anticipo'], ['Aviso Descuento', 'aviso_descuento'], ['Credito Infonavit', 'infonavit'],
  ['DEV.INFONAVIT', 'infonavit'], ['Fonacot', 'fonacot'], ['Gastos de Viaje', 'gastos_viaje'], ['IMSS', 'imss'], ['Infonavit', 'infonavit'],
  ['ISPT', 'ispt'], ['Prestamo', 'prestamo'],
] as const;

const base = { ...BITACORA_MUESTRA, Operador: 'Operador Ficticio Uno' };
const conv = (o: Record<string, unknown>) => convertirBitacoraMuestra({ ...base, ...o }, { padron: [...PADRON_MUESTRA] });
const codigos = (r: { revision: Array<{ codigo: string }> }) => r.revision.map((m) => m.codigo);
const percepcion = (d: string, monto = 100) => conv({ Percepciones: [{ Descripcion: d, Monto: monto }], Deducciones: [] });
const deduccion = (d: string, monto = 100) => conv({ Percepciones: [{ Descripcion: 'Sueldo Semanal', Monto: 1000 }], Deducciones: [{ Descripcion: d, Monto: monto }] });

describe('catálogo real: cada concepto se acepta en su lado y se muestra con su Descripcion original', () => {
  it.each(PERCEPCIONES)('percepción «%s» ⇒ %s', (d, cat) => {
    const r = percepcion(d);
    expect(r.revision, d).toEqual([]);
    expect(r.categorias[0].categoria).toBe(cat);
    expect(r.desglose?.percepciones[0].concepto).toBe(d);
  });
  it.each(DEDUCCIONES)('deducción «%s» ⇒ %s', (d, cat) => {
    const r = deduccion(d);
    expect(r.revision, d).toEqual([]);
    expect(r.categorias.find((c) => c.donde === 'Deducciones[0]')?.categoria).toBe(cat);
    expect(r.desglose?.deducciones[0].concepto).toBe(d);
  });

  it('cada concepto en el lado CONTRARIO va a revisión (`concepto_lado_inesperado`), salvo «Otros» de percepción que no existe como deducción tampoco', () => {
    for (const [d] of PERCEPCIONES) expect(codigos(deduccion(d)), `${d} en deducciones`).toContain('concepto_lado_inesperado');
    for (const [d] of DEDUCCIONES) expect(codigos(percepcion(d)), `${d} en percepciones`).toContain('concepto_lado_inesperado');
  });

  it('tolera mayúsculas, acentos, puntos y espacios dobles', () => {
    for (const d of ['bono e.c', 'BONO  E C', ' Bono   E.C ', 'viático', 'VIÁTICOS', 'sueldo   semanal', 'Hora  Extra', 'hora extra.', 'Bono R.L.', 'Bono x  Vuelta']) {
      expect(percepcion(d).revision, d).toEqual([]);
    }
    for (const d of ['dev. infonavit', 'DEV INFONAVIT', 'Crédito  Infonavit', 'préstamo', 'i.m.s.s'.replace(/\./g, ''), 'Gastos  de  viaje', 'ISPT.', 'aviso  descuento']) {
      expect(deduccion(d).revision, d).toEqual([]);
    }
    expect(claveConcepto(' Bono  E.C. ')).toBe('bono e c');
    expect(claveConcepto('DEV.INFONAVIT')).toBe('dev infonavit');
  });

  it('un concepto que no es del catálogo sigue yendo a revisión (no hay comodín)', () => {
    expect(codigos(percepcion('Bonificacion inventada'))).toContain('concepto_desconocido');
    expect(codigos(deduccion('Descuento'))).toContain('concepto_desconocido');
  });

  it('el catálogo completo en una sola bitácora cuadra con su Neto', () => {
    const percs = PERCEPCIONES.map(([d], i) => ({ Descripcion: d, Monto: 100 + i }));
    const deds = DEDUCCIONES.map(([d], i) => ({ Descripcion: d, Monto: 10 + i }));
    const neto = percs.reduce((a, r) => a + r.Monto, 0) - deds.reduce((a, r) => a + r.Monto, 0);
    const r = conv({ Percepciones: percs, Deducciones: deds, Neto: neto });
    expect(r.revision).toEqual([]);
    expect(r.netoCentavos).toBe(neto * 100);
  });
});

describe('«Dif en registro»: ajuste de redondeo en ambos bloques', () => {
  const ajustes = (p: number | null, d: number | null, extra: Record<string, unknown> = {}) => conv({
    Percepciones: [{ Descripcion: 'Sueldo Semanal', Monto: 1000 }, ...(p === null ? [] : [{ Descripcion: 'Dif en registro', Monto: p }])],
    Deducciones: [{ Descripcion: 'IMSS', Monto: 100 }, ...(d === null ? [] : [{ Descripcion: 'DIF EN REGISTRO', Monto: d }])],
    ...extra,
  });

  it('en percepciones suma y en deducciones resta, y se conserva el renglón con su texto original', () => {
    const a = ajustes(0.37, null);
    expect(a.revision).toEqual([]);
    expect(a.netoCentavos).toBe(100_000 + 37 - 10_000);
    expect(a.desglose?.percepciones.map((r) => r.concepto)).toContain('Dif en registro');
    const b = ajustes(null, 0.37);
    expect(b.revision).toEqual([]);
    expect(b.netoCentavos).toBe(100_000 - 10_000 - 37);
    expect(b.desglose?.deducciones.map((r) => r.concepto)).toContain('DIF EN REGISTRO');
  });

  it('permite los dos a la vez y el neto del cliente cuadra al centavo', () => {
    const r = ajustes(0.5, 0.25, { Neto: 900.25 });
    expect(r.revision).toEqual([]);
    expect(aLiquidacionExterna(r.desglose!, { sistemaOrigen: 't' }).totalOrigen).toBe('origen');
  });

  it('sin el ajuste, el neto del cliente (que sí lo incluye) NO cuadra: por eso no se descarta', () => {
    expect(codigos(ajustes(null, null, { Neto: 900.5 }))).toEqual(['total_no_cuadra']);
  });

  it('el ajuste no se renombra ni se agrupa: sale en el Excel tal cual', () => {
    const r = ajustes(0.5, null);
    expect(aplicarRenombres(r.desglose!.percepciones, []).map((x) => x.concepto)).toContain('Dif en registro');
  });

  it('TOPE: menos de 1.00 es redondeo (0.99 pasa); 1.00 o más va a revisión `ajuste_redondeo_excesivo` en cualquier bloque', () => {
    expect(ajustes(0.99, null).revision).toEqual([]);
    expect(ajustes(null, 0.99).revision).toEqual([]);
    expect(codigos(ajustes(1, null))).toEqual(['ajuste_redondeo_excesivo']);
    expect(codigos(ajustes(null, 25.5))).toEqual(['ajuste_redondeo_excesivo']);
  });

  it('monto 0 se ignora como cualquier renglón en cero', () => {
    const r = ajustes(0, null);
    expect(r.revision).toEqual([]);
    expect(r.ignorados.length).toBe(1);
  });
});
