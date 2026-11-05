import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { archivosFuente, leer, RAIZ, rel } from './escanear-fuentes';

// MX-085 / PT-14 (F8): las pantallas más usadas (dashboard y vendedor) no hacen una consulta por iteración. Se midió el árbol el
// 4-nov-2026: 0 casos en src/app/dashboard y src/app/vendedor (los bucles con await-consulta viven en crons y /admin/qa, que no son
// pantallas de uso diario). Esta guarda impide que aparezca el primero; si una pantalla necesita iterar, que traiga las filas con
// un `.in('id', ids)` o una RPC agregada y arme el mapa en memoria.
const BUCLE = /^\s*for\s*(await\s*)?\(.*\bof\b|\.map\(\s*async/;
const CONSULTA_AWAIT = /await\s+[\w$.]*?(\.from\(|\.rpc\(|\bsb\.(?!auth\b)|\badmin\.|supabase\w*\.)/;

export function bucleConConsulta(fuente: string, ventana = 14): number[] {
  const lineas = fuente.split('\n');
  const hallazgos: number[] = [];
  lineas.forEach((l, i) => {
    if (BUCLE.test(l) && CONSULTA_AWAIT.test(lineas.slice(i, i + ventana).join('\n'))) hallazgos.push(i + 1);
  });
  return hallazgos;
}

describe('sin consultas dentro de bucles en las pantallas de uso diario', () => {
  it('src/app/dashboard y src/app/vendedor: cero', () => {
    const casos: string[] = [];
    for (const dir of ['dashboard', 'vendedor']) {
      for (const p of archivosFuente(join(RAIZ, 'src', 'app', dir))) {
        for (const n of bucleConConsulta(leer(p))) casos.push(`${rel(p)}:${n}`);
      }
    }
    expect(casos).toEqual([]);
  });

  it('la heurística detecta el patrón N+1 clásico (mutación) y no marca un bucle sin consulta', () => {
    const malo = ['for (const v of viajes) {', '  const { data } = await sb.from("gasto").select("*").eq("viaje_id", v.id);', '}'].join('\n');
    const bueno = ['for (const v of viajes) {', '  total += v.monto;', '}'].join('\n');
    const mapAsync = ['await Promise.all(ids.map(async (id) => {', '  await admin.rpc("x", { id });', '}));'].join('\n');
    expect(bucleConConsulta(malo)).toEqual([1]);
    expect(bucleConConsulta(bueno)).toEqual([]);
    expect(bucleConConsulta(mapAsync)).toEqual([1]);
  });
});
