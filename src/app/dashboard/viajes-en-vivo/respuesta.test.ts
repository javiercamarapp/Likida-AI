import { describe, expect, it } from 'vitest';
import { leerRespuesta, textoDeBloques } from './respuesta';

describe('leerRespuesta', () => {
  it('toma el evento fin del NDJSON e ignora pasos y líneas rotas', () => {
    const nd = [
      JSON.stringify({ t: 'paso', fase: 'inicio', tool: 'tablero_viajes' }), 'basura {', JSON.stringify({ t: 'paso', fase: 'fin', tool: 'tablero_viajes' }),
      JSON.stringify({ t: 'fin', bloques: [{ tipo: 'texto', texto: 'Hay 2 viajes.' }, { tipo: 'cifra', valor: 2, nota: 'en curso' }, { tipo: 'tabla', filas: [['F-1', 'viva'], ['F-2', 'sin_senal']] }], conversacionId: null }),
    ].join('\n');
    expect(leerRespuesta(nd)).toEqual({ ok: true, bloques: [{ tipo: 'texto', texto: 'Hay 2 viajes.' }, { tipo: 'cifra', valor: 2, nota: 'en curso' }, { tipo: 'tabla', filas: [['F-1', 'viva'], ['F-2', 'sin_senal']] }] });
  });
  it('entiende el JSON plano del tope diario (agotado)', () => {
    expect(leerRespuesta(JSON.stringify({ agotado: true, bloques: [{ tipo: 'texto', texto: 'Tope del día.' }] }))).toEqual({ ok: true, bloques: [{ tipo: 'texto', texto: 'Tope del día.' }] });
  });
  it('un error del servidor se dice; una respuesta vacía o sin evento final también', () => {
    expect(leerRespuesta(JSON.stringify({ t: 'error', error: 'el analista no pudo responder en este momento' }))).toEqual({ ok: false, error: 'el analista no pudo responder en este momento' });
    expect(leerRespuesta('')).toMatchObject({ ok: false });
    expect(leerRespuesta(JSON.stringify({ t: 'fin', bloques: [] }))).toMatchObject({ ok: false });
    expect(leerRespuesta(JSON.stringify({ t: 'paso', fase: 'inicio', tool: 'x' }))).toMatchObject({ ok: false });
  });
  it('valida por forma y recorta: bloques inventados, cifras no finitas y exceso se descartan', () => {
    const r = leerRespuesta(JSON.stringify({ t: 'fin', bloques: [{ tipo: 'html', texto: '<script>' }, { tipo: 'cifra', valor: 'x' }, { tipo: 'texto', texto: 'a'.repeat(5000) }, 7, null, ...Array.from({ length: 20 }, () => ({ tipo: 'texto', texto: 'b' }))] }));
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.bloques.length).toBeLessThanOrEqual(6); expect(r.bloques[0]).toMatchObject({ tipo: 'texto' }); expect((r.bloques[0] as { texto: string }).texto).toHaveLength(1200); expect(JSON.stringify(r.bloques)).not.toContain('<script>'); }
  });
  it('textoDeBloques deja solo el texto, acotado', () => {
    expect(textoDeBloques([{ tipo: 'texto', texto: 'uno' }, { tipo: 'cifra', valor: 3 }, { tipo: 'texto', texto: 'dos' }])).toBe('uno dos');
    expect(textoDeBloques([{ tipo: 'cifra', valor: 3 }])).toBe('Listo.');
  });
});
