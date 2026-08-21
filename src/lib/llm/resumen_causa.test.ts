import { describe, it, expect } from 'vitest';
import { resumenCausa } from './openrouter';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 1, CRÍTICO (Operabilidad) — el fallo de OCR/tools salía al log como
// el string fijo "Falló generación estructurada" y la causa real (401, provider
// caído, schema) quedaba enterrada en `.cause`. `resumenCausa` la desentierra.
// ═══════════════════════════════════════════════════════════════════════════

describe('resumenCausa — desentierra la causa real de la cadena .cause', () => {
  it('un 401 en el error envuelto sale como status + mensaje, no se pierde', () => {
    const apiErr = Object.assign(new Error('Unauthorized'), { status: 401 });
    const wrap = Object.assign(new Error('Connection error.'), { cause: apiErr });
    const r = resumenCausa(wrap);
    expect(r).toContain('401');
    expect(r).toContain('Unauthorized');
  });

  it('cava varios niveles: SDK → APIError → undici', () => {
    const undici = Object.assign(new Error('getaddrinfo ENOTFOUND api'), { code: 'ENOTFOUND' });
    const api = Object.assign(new Error('Connection error.'), { cause: undici });
    const r = resumenCausa(api);
    expect(r).toContain('ENOTFOUND');
  });

  it('sin causa devuelve el propio mensaje, nunca vacío', () => {
    expect(resumenCausa(new Error('schema inválido'))).toContain('schema inválido');
    expect(resumenCausa(null)).toBe('sin detalle de causa');
  });

  it('nunca es el string fijo sin más: aporta señal distinguible', () => {
    const err = Object.assign(new Error('Falló generación estructurada'), {
      cause: Object.assign(new Error('rate limited'), { status: 429 }),
    });
    const r = resumenCausa(err);
    expect(r).toContain('429');
    expect(r).not.toBe('Falló generación estructurada');
  });
});
