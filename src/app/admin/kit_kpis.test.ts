import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// R9: los KPI de /admin viven en una rejilla que reparte el ancho (la última fila se estira), no en columnas fijas con una tarjeta
// suelta y medio renglón vacío. El filete de color de dato lo pone `Cifra` (StatCard/KpiTile) en todas.
function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? archivos(p) : /\.tsx$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}

describe('rejilla de KPI del kit', () => {
  it('kit.css define .kit-kpis con envoltura y estiramiento de la última fila', () => {
    const css = readFileSync(join(__dirname, 'ui/kit.css'), 'utf8');
    expect(css).toMatch(/\.kit-kpis\s*{[^}]*flex-wrap:\s*wrap/);
    expect(css).toMatch(/\.kit-kpis\s*>\s*\*\s*{[^}]*flex:\s*1 1/);
  });

  it('ninguna fila de StatCard/KpiTile usa columnas fijas de grid', () => {
    const malos: string[] = [];
    for (const f of archivos(__dirname)) {
      const L = readFileSync(f, 'utf8').split('\n');
      L.forEach((l, i) => {
        if (/className="[^"]*\bgrid\b[^"]*grid-cols-/.test(l) && /<(StatCard|KpiTile)\b/.test(L.slice(i + 1, i + 6).join(' '))) malos.push(`${f}:${i + 1}`);
      });
    }
    expect(malos).toEqual([]);
  });
});
