import { describe, expect, it } from 'vitest';
import { archivosFuente, leer, rel } from './escanear-fuentes';
import baseline from './tablas-sin-nombre-baseline.json';

// CT-CAL-09 / CT-PAR-03 (F8): toda <table> de producción tiene nombre accesible (<caption> o aria-label[ledby]) y sus
// <th> de cabecera llevan scope. Las tablas sin nombre que ya existían están en un baseline que SOLO puede bajar:
// una tabla nueva sin nombre, o una existente que empeora, rompe esta prueba.

interface Hallazgo { archivo: string; sinNombre: number; thSinScope: number; total: number }

function escanear(): Hallazgo[] {
  const salida: Hallazgo[] = [];
  for (const p of archivosFuente(undefined, /\.tsx$/)) {
    const t = leer(p);
    const re = /<table\b[\s\S]*?<\/table>/g;
    let m: RegExpExecArray | null;
    let total = 0, sinNombre = 0, thSinScope = 0;
    while ((m = re.exec(t))) {
      total++;
      const b = m[0];
      const apertura = b.slice(0, b.indexOf('>') + 1);
      if (!/<caption\b/.test(b) && !/aria-label(ledby)?=/.test(apertura)) sinNombre++;
      for (const th of b.match(/<th\b[^>]*>/g) ?? []) if (!/scope=|\{\.\.\./.test(th)) thSinScope++;
    }
    if (total) salida.push({ archivo: rel(p), sinNombre, thSinScope, total });
  }
  return salida;
}

describe('tablas accesibles (CT-CAL-09)', () => {
  const hallazgos = escanear();

  it('ningún <th> sin scope', () => {
    expect(hallazgos.filter((h) => h.thSinScope).map((h) => `${h.archivo}: ${h.thSinScope}`)).toEqual([]);
  });

  it('las tablas sin nombre no crecen respecto al baseline', () => {
    const base = baseline as Record<string, number>;
    const peor = hallazgos.filter((h) => h.sinNombre > (base[h.archivo] ?? 0)).map((h) => `${h.archivo}: ${h.sinNombre} > ${base[h.archivo] ?? 0}`);
    expect(peor).toEqual([]);
  });

  it('el baseline no guarda deuda ya pagada (si bajó, actualiza el JSON)', () => {
    const base = baseline as Record<string, number>;
    const actual = new Map(hallazgos.map((h) => [h.archivo, h.sinNombre]));
    const obsoleto = Object.entries(base).filter(([f, n]) => (actual.get(f) ?? 0) < n).map(([f, n]) => `${f}: baseline ${n}, real ${actual.get(f) ?? 0}`);
    expect(obsoleto).toEqual([]);
  });

  it('la prueba detecta una tabla sin nombre (mutación)', () => {
    const re = /<table\b[\s\S]*?<\/table>/;
    const mala = '<table><thead><tr><th>A</th></tr></thead></table>';
    const b = re.exec(mala)![0];
    expect(!/<caption\b/.test(b) && !/aria-label(ledby)?=/.test(b.slice(0, b.indexOf('>') + 1))).toBe(true);
  });
});
