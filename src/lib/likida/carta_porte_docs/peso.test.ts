// T-A3-52 — Peso: unidad, separadores, bruto/neto y cuadre. Todo con datos sintéticos.
import { describe, it, expect } from 'vitest';
import type { Extraccion } from './campos';
import { campoMercancia } from './campos';
import { FACTOR_A_KG } from './catalogos';
import { completarDerivados, NOTA_NETO_COMO_BRUTO } from './derivar';
import { normalizarNumero, normalizarPeso, normalizarValor } from './normalizar';
import { validarExtraccion } from './validacion';
import { cv, extraccionAtlasOk } from './documentos_sinteticos.fixture';

const AHORA = new Date('2026-10-01T12:00:00Z');
const hallazgos = (e: Extraccion, op = {}) => validarExtraccion(e, { ahora: AHORA, ...op }).hallazgos;
const codigos = (e: Extraccion, op = {}) => hallazgos(e, op).map((h) => h.codigo);
const pesoCampo = campoMercancia('peso_kg')!;

/** Un embarque sintético de dos renglones (4 000 + 2 577.99 kg = 6 577.99 kg). */
function embarque(): Extraccion {
  const e = extraccionAtlasOk();
  const base = e.mercancias[0];
  e.mercancias = [
    { ...base, peso_kg: cv('4000') },
    { ...base, peso_kg: cv('2577.99') },
  ];
  delete e.campos.peso_bruto_total;
  return e;
}

describe('separadores del peso: regla explícita y nota', () => {
  it('3,002.00 → 3002 sin nota (coma de miles + punto decimal es inequívoco)', () => {
    const p = normalizarPeso('3,002.00');
    expect(p).toMatchObject({ valor: 3002, ambiguo: false, alternativa: null, notas: [] });
  });
  it('1999.350 → 1999.35 con nota (el punto no puede ser de miles)', () => {
    const p = normalizarPeso('1999.350');
    expect(p.valor).toBe(1999.35);
    expect(p.ambiguo).toBe(false);
    expect(p.notas.join(' ')).toMatch(/punto se leyó como decimal/);
  });
  it('14.029 es ambiguo: se lee 14.029, la nota trae la otra lectura (14029) y pide confirmar', () => {
    const p = normalizarPeso('14.029');
    expect(p).toMatchObject({ valor: 14.029, ambiguo: true, alternativa: 14029 });
    expect(p.notas.join(' ')).toMatch(/14029 kg.*Confírmalo/);
  });
  it('6,578 (coma) es ambiguo en sentido contrario: miles por defecto, alternativa decimal', () => {
    const p = normalizarPeso('6,578 kg');
    expect(p).toMatchObject({ valor: 6578, ambiguo: true, alternativa: 6.578 });
  });
  it('un perfil con separador de miles fijado deja de ser ambiguo', () => {
    expect(normalizarPeso('14.029', '.')).toMatchObject({ valor: 14029, ambiguo: false, notas: [] });
  });
  it('un número JS y un texto no numérico no inventan nada', () => {
    expect(normalizarPeso(310.464)).toMatchObject({ valor: 310.464, ambiguo: false });
    expect(normalizarPeso('pesado').valor).toBeNull();
  });
  it('coincide con normalizarNumero en el valor (solo agrega notas)', () => {
    for (const t of ['3,002.00', '1999.350', '14.029', '310.464', '1.234,50', '6,57799654']) {
      expect(normalizarPeso(t).valor).toBe(normalizarNumero(t).valor);
    }
  });
  it('normalizarValor de peso_kg: lo ambiguo lleva nota «Confírmalo» y baja la confianza; lo inequívoco no', () => {
    const amb = normalizarValor(pesoCampo, '14.029');
    expect(amb.valor).toBe('14.029');
    expect(amb.notas.join(' ')).toMatch(/Confírmalo/);
    expect(amb.penalizacion).toBeGreaterThan(0);
    const ok = normalizarValor(pesoCampo, '3,002.00');
    expect(ok).toMatchObject({ valor: '3002', notas: [], penalizacion: 0 });
  });
  it('una cantidad que NO es peso conserva la nota genérica de siempre', () => {
    const n = normalizarValor(campoMercancia('cantidad')!, '1.500');
    expect(n.notas.join(' ')).toMatch(/ambiguo/);
  });
});

describe('libras ↔ kilos entre documentos hermanos', () => {
  it('BOL sintético en libras convertido a kg coincide con el libro que trae coma-miles equivalente en kg', () => {
    const libras = 14500; // BOL en inglés: 14 500 LBS
    const bol = embarque();
    bol.mercancias = [{ ...bol.mercancias[0], peso_kg: cv(String(libras)), peso_unidad: cv('LBR') }];
    const convertido = completarDerivados(bol);
    const kgBol = Number(convertido.mercancias[0].peso_kg.valor);
    expect(kgBol).toBeCloseTo(libras * FACTOR_A_KG.LBR, 2);
    expect(convertido.mercancias[0].peso_kg.notas?.join(' ')).toMatch(/Convertido de libras/);

    // El libro del mismo embarque trae «6,577.99» (coma-miles) kg.
    const libro = embarque();
    libro.mercancias = [{ ...libro.mercancias[0], peso_kg: cv(String(normalizarPeso('6,577.99').valor)) }];
    expect(codigos(libro, { pesoReferencia: { kg: kgBol, fuente: 'el BOL en libras' } })).not.toContain('peso_fuentes_difieren');
    expect(codigos(libro, { pesoReferencia: { kg: kgBol, fuente: 'el BOL en libras' } })).not.toContain('peso_factor_1000');
  });
  it('una diferencia de más de 1 % contra el documento hermano bloquea con el texto llano', () => {
    const e = embarque();
    const h = hallazgos(e, { pesoReferencia: { kg: 6700, fuente: 'el BOL en libras' } }).find((x) => x.codigo === 'peso_fuentes_difieren');
    expect(h).toMatchObject({ severidad: 'bloqueo', mensaje: expect.stringMatching(/difiere más de 1 % del de el BOL en libras/) });
    expect(validarExtraccion(e, { ahora: AHORA, pesoReferencia: { kg: 6700, fuente: 'el BOL' } }).listoParaAprobar).toBe(false);
  });
  it('dentro de 1 % no hay hallazgo', () => {
    expect(codigos(embarque(), { pesoReferencia: { kg: 6577.99 * 1.009, fuente: 'x' } })).not.toContain('peso_fuentes_difieren');
  });
  it('sin referencia no se evalúa nada (no se inventa)', () => {
    expect(codigos(embarque())).not.toContain('peso_fuentes_difieren');
    expect(codigos(embarque(), { pesoReferencia: { kg: 0, fuente: 'x' } })).not.toContain('peso_fuentes_difieren');
  });
});

describe('error de 1000×', () => {
  it('libro con el valor 1000× contra el documento hermano ⇒ bloqueo peso_factor_1000', () => {
    const e = embarque();
    e.mercancias = e.mercancias.map((m) => ({ ...m, peso_kg: cv(String(Number(m.peso_kg.valor) * 1000)) }));
    const h = hallazgos(e, { pesoReferencia: { kg: 6577.99, fuente: 'el BOL' } }).filter((x) => x.codigo === 'peso_factor_1000');
    expect(h).toHaveLength(1);
    expect(h[0].severidad).toBe('bloqueo');
  });
  it('también en sentido inverso (1/1000)', () => {
    const e = embarque();
    e.mercancias = e.mercancias.map((m) => ({ ...m, peso_kg: cv(String(Number(m.peso_kg.valor) / 1000)) }));
    expect(codigos(e, { pesoReferencia: { kg: 6577.99, fuente: 'el BOL' } })).toContain('peso_factor_1000');
  });
  it('total del documento (14.029 leído como 14029) vs suma de renglones en la otra escala ⇒ bloqueo', () => {
    const e = embarque();
    e.campos.peso_bruto_total = cv('6.578'); // el punto era de miles: 6 578 kg
    expect(codigos(e)).toContain('peso_factor_1000');
    expect(codigos(e)).toContain('suma_peso');
  });
  it('sin factor 1000 la diferencia con el hermano no se llama factor', () => {
    expect(codigos(embarque(), { pesoReferencia: { kg: 7000, fuente: 'x' } })).not.toContain('peso_factor_1000');
  });
});

describe('suma de renglones contra el total del documento', () => {
  it('suma ≠ total ⇒ hallazgo bloqueante', () => {
    const e = embarque(); e.campos.peso_bruto_total = cv('7000');
    expect(hallazgos(e).find((h) => h.codigo === 'suma_peso')).toMatchObject({ severidad: 'bloqueo' });
  });
  it('suma = total (3,002.00 normalizado) ⇒ sin hallazgo de suma', () => {
    const e = embarque();
    e.mercancias = [{ ...e.mercancias[0], peso_kg: cv(String(normalizarPeso('1,500.50').valor)) }, { ...e.mercancias[1], peso_kg: cv('1501.5') }];
    e.campos.peso_bruto_total = cv(String(normalizarPeso('3,002.00').valor));
    const c = codigos(e);
    expect(c).not.toContain('suma_peso');
    expect(c).not.toContain('peso_suma');
    expect(c).not.toContain('peso_factor_1000');
  });
});

describe('bruto/neto', () => {
  it('JSON/documento con solo neto ⇒ el neto se usa como bruto y queda la nota', () => {
    const e = embarque();
    e.mercancias[0].peso_tipo = cv('neto');
    completarDerivados(e);
    expect(e.mercancias[0].peso_kg.valor).toBe('4000');
    expect(e.mercancias[0].peso_kg.notas).toContain(NOTA_NETO_COMO_BRUTO);
    expect(e.mercancias[1].peso_kg.notas ?? []).not.toContain(NOTA_NETO_COMO_BRUTO);
  });
  it('«peso por embalaje» recibe el mismo trato', () => {
    const e = embarque(); e.mercancias[1].peso_tipo = cv('Peso por embalaje');
    completarDerivados(e);
    expect(e.mercancias[1].peso_kg.notas).toContain(NOTA_NETO_COMO_BRUTO);
  });
  it('es idempotente: correr los derivados dos veces no repite la nota', () => {
    const e = embarque(); e.mercancias[0].peso_tipo = cv('neto');
    completarDerivados(e); completarDerivados(e);
    expect(e.mercancias[0].peso_kg.notas!.filter((n) => n === NOTA_NETO_COMO_BRUTO)).toHaveLength(1);
  });
  it('un peso que ya es bruto, o que un humano fijó, no recibe nota', () => {
    const e = embarque(); e.mercancias[0].peso_tipo = cv('bruto');
    e.mercancias[1].peso_tipo = cv('neto'); e.mercancias[1].peso_kg = cv('2577.99', 1, 'humano');
    completarDerivados(e);
    expect(e.mercancias[0].peso_kg.notas ?? []).toEqual([]);
    expect(e.mercancias[1].peso_kg.notas ?? []).toEqual([]);
  });
});

describe('A37-A3-08 — unidad de masa distinta de kg escrita dentro del peso', () => {
  it('«24.5 TON» no pasa como 24.5 kg en silencio: nota «Confírmalo» y baja la confianza', () => {
    const r = normalizarValor(pesoCampo, '24.5 TON');
    expect(r.valor).toBe('24.5');
    expect(r.notas.join(' ')).toMatch(/Confírmalo/);
    expect(r.notas.join(' ')).toMatch(/TON/i);
    expect(r.penalizacion).toBeGreaterThanOrEqual(0.3);
  });
  it('«1,200 lb» también se marca', () => {
    const r = normalizarValor(pesoCampo, '1200 lb');
    expect(r.notas.join(' ')).toMatch(/Confírmalo/);
  });
  it('«3,002.00 kg» sigue sin nota ni penalización', () => {
    const r = normalizarValor(pesoCampo, '3,002.00 kg');
    expect(r.notas).toEqual([]);
    expect(r.penalizacion).toBe(0);
  });
  it('el hallazgo de validación es «confirmar» (normalizacion_dudosa) para el peso en toneladas', () => {
    const e = embarque();
    const n = normalizarValor(pesoCampo, '24.5 TON');
    e.mercancias[0].peso_kg = { ...cv(n.valor as string), notas: n.notas };
    expect(codigos(e)).toContain('normalizacion_dudosa');
  });
});
