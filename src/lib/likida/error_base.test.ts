import { describe, it, expect } from 'vitest';
import { errorDeBaseSinRespuesta, esRespuestaHtml, resumirErrorDeBase } from './error_base';

const CLOUDFLARE = '<!DOCTYPE html>\n<!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> <![endif]-->\n<html><head><title>db.example.co | 522: Connection timed out</title></head><body>Error code 522</body></html>';

describe('error_base', () => {
  it('reconoce la página HTML de un proxy y la resume sin etiquetas', () => {
    expect(esRespuestaHtml(CLOUDFLARE)).toBe(true);
    const r = resumirErrorDeBase(CLOUDFLARE);
    expect(r).not.toContain('<');
    expect(r).toContain('522');
    expect(r.length).toBeLessThan(300);
  });

  it('no toca un error normal, solo lo recorta', () => {
    expect(resumirErrorDeBase('duplicate key value')).toBe('duplicate key value');
    expect(resumirErrorDeBase('x'.repeat(500)).length).toBeLessThanOrEqual(201);
  });

  it('«sin respuesta» = red, HTML, 5xx, tope propio o código transitorio; NO un código de esquema', () => {
    expect(errorDeBaseSinRespuesta({ code: '', message: 'TypeError: fetch failed' })).toBe(true);
    expect(errorDeBaseSinRespuesta({ code: '', message: CLOUDFLARE })).toBe(true);
    expect(errorDeBaseSinRespuesta({ message: 'sin respuesta en 8000 ms (tope de consulta)' })).toBe(true);
    expect(errorDeBaseSinRespuesta({ message: 'x', status: 502 })).toBe(true);
    expect(errorDeBaseSinRespuesta({ code: '57014', message: 'statement timeout' })).toBe(true);
    expect(errorDeBaseSinRespuesta({ code: 'PGRST202', message: 'Could not find the function' })).toBe(false);
    expect(errorDeBaseSinRespuesta({ code: '42703', message: 'column does not exist' })).toBe(false);
  });
});
