import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// EXCEPCION DE MARCO DECLARADA (11-nov-2026): el borrador de Carta Porte es una hoja para imprimir. No usa `MarcoPagina` (el papel no
// lleva sidebar ni cabecera) y conserva su titulo h1; las tablas del papel son TablaBase. Todo lo demas sigue la regla del sistema: sin `style=`,
// sin `.card`, sin piezas del kit viejo y con los enlaces como `BotonEnlace` (ocultos al imprimir).
const src = readFileSync(join(process.cwd(), 'src/app/dashboard/carta-porte/borrador/[viajeId]/page.tsx'), 'utf8');

describe('borrador imprimible de Carta Porte (excepcion de marco)', () => {
  it('declara la excepcion y no usa MarcoPagina', () => {
    expect(src).toMatch(/EXCEPCION DE MARCO/);
    expect(src).not.toContain('Marco' + 'Pagina');
  });
  it('un solo h1 y el CSS de impresion limpio: cero style=, <style> y .card', () => {
    expect(src.match(/<h1\b/g)).toHaveLength(1);
    expect(src).not.toMatch(/style=\{|<style\b|\bcard\b|glass-panel/);
  });
  it('lo que no va en papel se oculta con print:hidden (volver, XML, timbre)', () => {
    expect(src.match(/print:hidden/g)!.length).toBeGreaterThanOrEqual(3);
  });
  it('las tablas son TablaBase, no <table> a mano', () => {
    expect(src).not.toMatch(/<table\b/);
    expect(src).toMatch(/<TablaBase\b/);
  });
  it('sin emojis ni botones crudos', () => {
    expect(src).not.toMatch(/<button\b/);
    expect(src).not.toMatch(/[\u{1F000}-\u{1FAFF}☀-➿]/u);
  });
});
