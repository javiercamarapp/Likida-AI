import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// F1 lote A, carril L1C (CT-SEG-24/26/03, CT-BAS-17): higiene de repo publico.
// Lee archivos del arbol de trabajo; no toca red ni git.
const RAIZ = process.cwd();
const leer = (r: string) => readFileSync(join(RAIZ, r), 'utf8');
const cmp = (a: string, b: string) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

describe('dependencias con aviso (CT-SEG-01/03)', () => {
  const lock = JSON.parse(leer('package-lock.json')).packages as Record<string, { version: string }>;
  it.each([
    ['next', '16.4.3'],
    ['zod', '4.6.6'],
    ['fast-uri', '3.1.9'],
  ])('%s resuelto en el lock es >= %s', (nombre, minima) => {
    expect(cmp(lock[`node_modules/${nombre}`].version, minima)).toBeGreaterThanOrEqual(0);
  });
});

describe('.gitignore de material criptografico (CT-SEG-24)', () => {
  const lineas = leer('.gitignore').split('\n').map((l) => l.trim());
  it.each(['*.key', '*.pem', '*.p12', '*.cer', '.npmrc'])('ignora %s', (p) => {
    expect(lineas).toContain(p);
  });
});

describe('CODEOWNERS (CT-SEG-24)', () => {
  it('existe y asigna un dueno a todo el repo y a los workflows', () => {
    const ruta = '.github/CODEOWNERS';
    expect(existsSync(join(RAIZ, ruta))).toBe(true);
    const reglas = leer(ruta).split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
    expect(reglas.some((l) => /^\*\s+@\S+/.test(l))).toBe(true);
    expect(reglas.some((l) => /^\/\.github\/\s+@\S+/.test(l))).toBe(true);
  });
});

describe('escaneo de secretos en CI (CT-SEG-24)', () => {
  it('secretos.yml corre gitleaks con historial completo, fijado por hash, con permisos minimos', () => {
    const y = leer('.github/workflows/secretos.yml');
    expect(y).toMatch(/gitleaks\/gitleaks-action@[0-9a-f]{40}/);
    expect(y).toMatch(/fetch-depth:\s*0/);
    expect(y).toMatch(/permissions:\s*\n\s+contents:\s*read/);
    expect(y).toMatch(/GITLEAKS_CONFIG/);
  });
  it('.gitleaks.toml extiende las reglas por omision y solo permite fixtures acotados', () => {
    const t = leer('.gitleaks.toml');
    expect(t).toMatch(/\[extend\]\s*\n\s*useDefault\s*=\s*true/);
    expect(t).toMatch(/\[\[allowlists\]\]|\[allowlist\]/);
    // La regla generica solo se perdona en pruebas o en fixtures/datos publicos nombrados: nunca en src/ de produccion.
    const rutas = [...t.matchAll(/^\s*'''([^']+)'''/gm)].map((m) => m[1]).filter((r) => r.startsWith('^src/'));
    for (const r of rutas) expect(r, r).toMatch(/test|permisos_cre/);
  });
});

describe('GitHub Actions fijadas por hash (CT-SEG-24)', () => {
  const dir = join(RAIZ, '.github/workflows');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.yml'))) {
    it(`${f}: todo uses: externo lleva sha de 40 hex`, () => {
      const usos = [...leer(`.github/workflows/${f}`).matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
      for (const u of usos) {
        if (u.startsWith('./')) continue;
        expect(u, u).toMatch(/@[0-9a-f]{40}$/);
      }
    });
  }
});
