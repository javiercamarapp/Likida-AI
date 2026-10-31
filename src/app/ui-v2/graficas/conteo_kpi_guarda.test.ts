import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

// GUARDA ESTÁTICA: `ConteoKpi` es un componente de cliente y la tira de KPI se arma en el servidor. Una FUNCIÓN como prop no
// cruza esa frontera ("Functions cannot be passed directly to Client Components") y tumbó el Resumen con conteo. El formato
// es el único del producto (`numero`), así que el componente solo recibe `valor`. Esta prueba lo fija en el código.
const RAIZ = path.resolve(__dirname, '../../../..');

function archivos(dir: string, salida: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) archivos(p, salida);
    else if (/\.tsx$/.test(e) && !/\.test\.tsx$/.test(e)) salida.push(p);
  }
  return salida;
}

describe('ConteoKpi no recibe funciones', () => {
  it('su firma de props solo declara `valor: number`', () => {
    const src = readFileSync(path.join(__dirname, 'conteo-kpi.tsx'), 'utf8');
    const firma = src.match(/export function ConteoKpi\(([^)]*)\)/)?.[1] ?? '';
    expect(firma).toContain('valor: number');
    expect(firma).not.toContain('=>');
    expect(firma).not.toContain('Function');
    expect(firma.replace(/\s+/g, '')).toBe('{valor}:{valor:number}');
  });

  it('ningún sitio de uso le pasa otra prop que `valor`', () => {
    const usos: string[] = [];
    for (const f of archivos(path.join(RAIZ, 'src'))) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/<ConteoKpi\b([^>]*?)\/?>/gs)) usos.push(`${path.relative(RAIZ, f)}: ${m[1].trim()}`);
    }
    expect(usos.length).toBeGreaterThan(0);
    for (const u of usos) {
      const props = u.split(': ').slice(1).join(': ');
      const nombres = [...props.matchAll(/(\w+)=/g)].map((m) => m[1]);
      expect(nombres, u).toEqual(['valor']);
      expect(props, u).not.toContain('=>');
    }
  });
});
