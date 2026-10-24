import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const parse = (line: string) =>
  execFileSync('bash', ['-c', '. scripts/lib/parsear-env-linea.sh; parsear_env_linea "$1"', 'x', line], { encoding: 'utf8' });

describe('A37-L-10 deploy-vercel.sh', () => {
  it('conserva un # pegado dentro del secreto', () => {
    expect(parse('K=ab#cd')).toBe('K\tab#cd\n');
  });
  it('quita comentario inline solo con espacio antes del #', () => {
    expect(parse('K=abc   # nota')).toBe('K\tabc\n');
  });
  it('quita comillas y respeta # entre comillas', () => {
    expect(parse('K="a #b" # c')).toBe('K\ta #b\n');
    expect(parse("K='x#y'")).toBe('K\tx#y\n');
  });
  it('ignora comentarios y líneas sin asignación', () => {
    expect(parse('# K=1')).toBe('');
    expect(parse('')).toBe('');
  });
  it('no empuja a preview y verifica longitud', () => {
    const sh = readFileSync('scripts/deploy-vercel.sh', 'utf8');
    expect(sh).not.toMatch(/push_env "\$name" "\$val" preview/);
    expect(sh).not.toContain('%%#*');
    expect(sh).toContain('longitud');
  });
});
