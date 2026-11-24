import { describe, it, expect } from 'vitest';
import { GLOSARIO, buscarTermino, normalizarSigla, terminosEnTexto, glosarioParaPrompt } from './glosario';

describe('glosario del sector', () => {
  it('cada término tiene significado, quién lo usa y riesgo, con ids únicos', () => {
    expect(GLOSARIO.length).toBeGreaterThanOrEqual(35);
    expect(new Set(GLOSARIO.map((x) => x.id)).size).toBe(GLOSARIO.length);
    for (const x of GLOSARIO) {
      expect(x.significado.length, x.id).toBeGreaterThan(15);
      expect(x.quienLoUsa.length, x.id).toBeGreaterThan(2);
      expect(x.riesgo.length, x.id).toBeGreaterThan(10);
      expect(x.siglas.length, x.id).toBeGreaterThan(0);
    }
  });
  it('normaliza y busca siglas con acentos, puntos y mayúsculas', () => {
    expect(normalizarSigla('C.C.P.')).toBe('ccp');
    expect(buscarTermino('CCP')?.id).toBe('ccp');
    expect(buscarTermino('carta porte')?.id).toBe('ccp');
    expect(buscarTermino('Cuenta Espejo')?.id).toBe('cuenta_espejo');
    expect(buscarTermino('DODA')?.id).toBe('doda');
    expect(buscarTermino('quitapón')?.id).toBe('quitapon');
    expect(buscarTermino('prealerta')?.id).toBe('prealerta');
    expect(buscarTermino('')).toBeNull();
    expect(buscarTermino('xyzzy')).toBeNull();
  });
  it('encuentra términos dentro de un mensaje', () => {
    const ids = terminosEnTexto('me ayudan con la CCP y el sello, y el QR de acceso').map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(['ccp', 'sello', 'qr']));
    expect(terminosEnTexto('buenos días')).toEqual([]);
  });
  it('las advertencias clave del agente quedan en el glosario', () => {
    expect(buscarTermino('ccp')?.riesgo).toMatch(/NUNCA/);
    expect(buscarTermino('luz verde')?.riesgo).toMatch(/jamás/);
    expect(buscarTermino('eta')?.riesgo).toMatch(/nunca calcula ni promete/);
  });
  it('arma texto para un prompt, filtrable por categoría', () => {
    const todo = glosarioParaPrompt();
    expect(todo.split('\n')).toHaveLength(GLOSARIO.length);
    const docs = glosarioParaPrompt({ categorias: ['documento'] });
    expect(docs).toContain('DODA');
    expect(docs).not.toContain('Parador autorizado');
    expect(glosarioParaPrompt({ maxTerminos: 2 }).split('\n')).toHaveLength(2);
  });
});
