import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// F26 ronda 2: el borrador de Carta Porte ya no es una hoja angosta fuera del marco; sigue el esqueleto de Ficha de Rovaq (eyebrow, h1 con
// «Volver», chips, tira de cifras, bloques en dos columnas, tablas). Lo que no va en papel (XML, timbre) se sigue ocultando al imprimir.
const src = readFileSync(join(process.cwd(), 'src/app/dashboard/carta-porte/borrador/[viajeId]/page.tsx'), 'utf8');

describe('borrador de Carta Porte (esqueleto de Ficha)', () => {
  it('usa EsqueletoFicha y no su propio <main> ni h1', () => {
    expect(src).toContain('<EsqueletoFicha');
    expect(src).not.toMatch(/<main\b|<h1\b/);
  });
  it('cero style=, <style> y .card', () => {
    expect(src).not.toMatch(/style=\{|<style\b|\bcard\b|glass-panel/);
  });
  it('lo que no va en papel se oculta con print:hidden (XML, timbre)', () => {
    expect(src.match(/print:hidden/g)!.length).toBeGreaterThanOrEqual(2);
  });
  it('las tablas son TablaBase, no <table> a mano', () => {
    expect(src).not.toMatch(/<table\b/);
    expect(src).toMatch(/<TablaBase\b/);
  });
  it('la flecha de «Volver» la pone el componente: el texto no lleva la suya', () => {
    expect(src).not.toMatch(/ArrowLeft/);
    const es = readFileSync(join(process.cwd(), 'src/lib/i18n/es/dinero.ts'), 'utf8');
    expect(es).toMatch(/volverACartaPorte': 'Volver a Carta Porte'/);
  });
  it('sin emojis ni botones crudos', () => {
    expect(src).not.toMatch(/<button\b/);
    const emojis = [...src].filter((c) => { const n = c.codePointAt(0)!; return (n >= 0x1f000 && n <= 0x1faff) || (n >= 0x2600 && n <= 0x27bf); });
    expect(emojis).toEqual([]);
  });
});
