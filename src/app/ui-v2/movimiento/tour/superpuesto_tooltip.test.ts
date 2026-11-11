/* eslint-disable security/detect-non-literal-fs-filename -- lee el fuente del propio proveedor y del Tooltip; rutas fijas relativas a esta prueba. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Regresión (Deploy 2): el Tooltip pinta SIEMPRE su burbuja `.rv-pop.rv-pop--tip` (oculta, para el aria-describedby). El detector de «algo abierto
// encima» del tour usaba `.rv-pop` a secas: con un solo Tooltip en el shell (Guía, Plegar) la invitación al recorrido y las pistas no salían NUNCA.
describe('el detector de superposiciones del tour ignora las burbujas de Tooltip', () => {
  const proveedor = readFileSync(new URL('./proveedor.tsx', import.meta.url), 'utf8');
  const overlay = readFileSync(new URL('../../componentes/overlay.tsx', import.meta.url), 'utf8');
  it('el Tooltip sigue montando su burbuja .rv-pop--tip aunque esté cerrada', () => {
    expect(overlay).toMatch(/role="tooltip"[^>]*className="rv-pop rv-pop--tip"/);
  });
  it('SUPERPUESTO excluye .rv-pop--tip', () => {
    const linea = proveedor.split('\n').find((l) => l.startsWith('const SUPERPUESTO'));
    expect(linea).toBeDefined();
    expect(linea).toContain('.rv-pop:not(.rv-pop--tip)');
    expect(linea).not.toMatch(/\.rv-pop,/);
  });
});
