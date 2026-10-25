import { describe, it, expect } from 'vitest';
import { rotarPorHora, rotarGruposPorHora } from './rotacion_barrido';

const H = 3_600_000;
const hora = (n: number) => new Date(n * H + 123_456);

describe('A37-S56-10: rotar el arranque del barrido por hora', () => {
  it('la misma hora da el mismo orden (determinista) y no pierde ni duplica elementos', () => {
    const xs = ['a', 'b', 'c', 'd'];
    expect(rotarPorHora(xs, hora(1000))).toEqual(rotarPorHora(xs, hora(1000)));
    for (let h = 1000; h < 1010; h++) expect([...rotarPorHora(xs, hora(h))].sort()).toEqual(xs);
  });

  it('horas consecutivas arrancan en flotas distintas: nadie queda siempre al final', () => {
    const xs = ['a', 'b', 'c'];
    const primeros = new Set([0, 1, 2].map((i) => rotarPorHora(xs, hora(3000 + i))[0]));
    expect(primeros).toEqual(new Set(xs));
  });

  it('listas de 0 o 1 elemento no cambian', () => {
    expect(rotarPorHora([], hora(5))).toEqual([]);
    expect(rotarPorHora(['x'], hora(5))).toEqual(['x']);
  });

  it('por grupos: las reglas de una flota no se parten y el arranque rota entre flotas', () => {
    const rs = [{ t: 'A', i: 1 }, { t: 'A', i: 2 }, { t: 'B', i: 3 }, { t: 'C', i: 4 }, { t: 'C', i: 5 }];
    const arranques = new Set<string>();
    for (let h = 0; h < 3; h++) {
      const out = rotarGruposPorHora(rs, (r) => r.t, hora(6000 + h));
      expect(out).toHaveLength(5);
      arranques.add(out[0].t);
      // cada flota sigue contigua (salvo la vuelta circular)
      expect(out.map((r) => r.i).sort()).toEqual([1, 2, 3, 4, 5]);
    }
    expect(arranques).toEqual(new Set(['A', 'B', 'C']));
  });
});
