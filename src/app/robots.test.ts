import { describe, it, expect } from 'vitest';
import robots from './robots';

describe('robots.txt', () => {
  const regla = (robots().rules as Array<{ disallow: string[]; allow: string[] }>)[0];

  it('el software no se indexa: paneles, API, auth y la cuenta', () => {
    for (const r of ['/admin', '/dashboard', '/api', '/login', '/auth', '/cuenta', '/vendedor']) expect(regla.disallow).toContain(r);
  });

  it('/demo (una simulación) y /mcp (la autorización de una integración privada) tampoco', () => {
    expect(regla.disallow).toContain('/demo');
    expect(regla.disallow).toContain('/mcp');
  });

  it('lo público sigue indexable', () => {
    for (const r of ['/blog', '/calculadora', '/privacidad', '/terminos']) expect(regla.allow).toContain(r);
  });
});
