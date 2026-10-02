import { describe, it, expect } from 'vitest';
import { validarEntradaConvenio, type EntradaConvenio } from './edicion';

const ID = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001';
const CLI = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d0c1';
const SIT = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d0a5';
const ALTA = (o: Partial<EntradaConvenio> = {}): EntradaConvenio => ({
  convenioId: '', clienteId: CLI, nombre: 'Ruta norte', origen: 'Zapopan', destino: 'Tlaquepaque', sitioOrigenId: '', sitioDestinoId: SIT,
  vigenteDesde: '', vigenteHasta: '', notas: '', version: '', instrucciones: [{ categoria: 'puerta', texto: 'Puerta 3', momento: 'ambos', lugar: 'destino' }],
  llevarAViajes: false, reenviar: false, ...o,
});
const EDICION = (o: Partial<EntradaConvenio> = {}): EntradaConvenio => ALTA({ convenioId: ID, clienteId: '', version: '3', ...o });

describe('validarEntradaConvenio', () => {
  it('un alta válida normaliza espacios, vacíos a null y numera el orden de las instrucciones', () => {
    const r = validarEntradaConvenio(ALTA({ nombre: '  Ruta   norte ', origen: ' ', instrucciones: [
      { categoria: 'puerta', texto: ' Puerta   3 ', momento: 'ambos', lugar: 'destino' },
      { categoria: 'documentos', texto: 'Carta porte', momento: 'despacho', lugar: 'ambos' },
    ] }));
    expect(r).toEqual({ ok: true, datos: {
      convenioId: null, clienteId: CLI, nombre: 'Ruta norte', origen: null, destino: 'Tlaquepaque', sitioOrigenId: null, sitioDestinoId: SIT,
      vigenteDesde: null, vigenteHasta: null, notas: null, version: null,
      instrucciones: [
        { categoria: 'puerta', texto: 'Puerta 3', momento: 'ambos', lugar: 'destino', orden: 1 },
        { categoria: 'documentos', texto: 'Carta porte', momento: 'despacho', lugar: 'ambos', orden: 2 },
      ],
    } });
  });

  it('una edición exige la versión y no lleva cliente (el cliente de un convenio no cambia)', () => {
    const ok = validarEntradaConvenio(EDICION({ clienteId: CLI }));
    expect(ok).toMatchObject({ ok: true, datos: { convenioId: ID, clienteId: null, version: 3 } });
    for (const version of ['', '0', 'x', '1.5']) {
      expect(validarEntradaConvenio(EDICION({ version }))).toEqual({ ok: false, errores: [expect.stringContaining('Falta la versión')] });
    }
  });

  it('el alta exige un cliente; el nombre es obligatorio y acotado', () => {
    expect(validarEntradaConvenio(ALTA({ clienteId: '' }))).toEqual({ ok: false, errores: ['Elige el cliente del convenio.'] });
    expect(validarEntradaConvenio(ALTA({ nombre: '   ' }))).toMatchObject({ ok: false, errores: [expect.stringContaining('Ponle nombre')] });
    expect(validarEntradaConvenio(ALTA({ nombre: 'x'.repeat(121) }))).toMatchObject({ ok: false, errores: [expect.stringContaining('120')] });
  });

  it('las fechas se validan (calendario real y orden) y los ids de sitio deben ser uuid', () => {
    expect(validarEntradaConvenio(ALTA({ vigenteDesde: '2026-02-30' }))).toMatchObject({ ok: false, errores: [expect.stringContaining('vigente desde')] });
    expect(validarEntradaConvenio(ALTA({ vigenteHasta: '10/12/2026' }))).toMatchObject({ ok: false, errores: [expect.stringContaining('vigente hasta')] });
    expect(validarEntradaConvenio(ALTA({ vigenteDesde: '2026-12-01', vigenteHasta: '2026-01-01' }))).toMatchObject({ ok: false, errores: [expect.stringContaining('no puede ser anterior')] });
    expect(validarEntradaConvenio(ALTA({ vigenteDesde: '2026-01-01', vigenteHasta: '2026-01-01' })).ok).toBe(true);
    expect(validarEntradaConvenio(ALTA({ sitioOrigenId: 'no-es-uuid' }))).toMatchObject({ ok: false, errores: [expect.stringContaining('sitio de origen')] });
  });

  it('las filas sin texto se ignoran; una fila con tema, momento o planta inventados se rechaza diciendo cuál', () => {
    const r = validarEntradaConvenio(ALTA({ instrucciones: [
      { categoria: 'puerta', texto: '   ', momento: 'ambos', lugar: 'ambos' },
      { categoria: 'inventada', texto: 'x', momento: 'ambos', lugar: 'ambos' },
      { categoria: 'puerta', texto: 'y', momento: 'nunca', lugar: 'ambos' },
      { categoria: 'puerta', texto: 'z', momento: 'ambos', lugar: 'luna' },
    ] }));
    expect(r).toEqual({ ok: false, errores: [
      'Instrucción 1: elige un tema válido.', 'Instrucción 2: elige cuándo se manda.', 'Instrucción 3: elige a qué planta aplica.',
    ] });
    // todas en blanco = una lista vacía, no un error
    expect(validarEntradaConvenio(ALTA({ instrucciones: [{ categoria: 'puerta', texto: '', momento: 'ambos', lugar: 'ambos' }] }))).toMatchObject({ ok: true, datos: { instrucciones: [] } });
  });

  it('el texto largo, la repetida (mismo tema y texto sin importar mayúsculas) y el exceso de filas se dicen', () => {
    const f = (texto: string, categoria = 'puerta') => ({ categoria, texto, momento: 'ambos', lugar: 'ambos' });
    expect(validarEntradaConvenio(ALTA({ instrucciones: [f('x'.repeat(401))] }))).toMatchObject({ ok: false, errores: [expect.stringContaining('400')] });
    expect(validarEntradaConvenio(ALTA({ instrucciones: [f('Puerta 3'), f('puerta  3')] }))).toMatchObject({ ok: false, errores: [expect.stringContaining('repetida')] });
    expect(validarEntradaConvenio(ALTA({ instrucciones: [f('Puerta 3'), f('Puerta 3', 'documentos')] })).ok).toBe(true);
    expect(validarEntradaConvenio(ALTA({ instrucciones: Array.from({ length: 41 }, (_, n) => f(`i${n}`)) }))).toMatchObject({ ok: false, errores: [expect.stringContaining('hasta 40')] });
  });

  it('junta TODOS los problemas de una vez (no uno por intento)', () => {
    const r = validarEntradaConvenio(ALTA({ clienteId: '', nombre: '', vigenteDesde: 'mal', notas: 'n'.repeat(1001) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores).toHaveLength(4);
  });
});
