import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { clasificar, ETIQUETA_COMPLETO } from './cambios-ci.mjs';

const pr = (perfil: 'verificar' | 'postgres' | 'e2e', archivos: string[] | null, etiquetas: string[] = []) =>
  clasificar(perfil, archivos, { evento: 'pull_request', etiquetas }).relevante;

describe('cambios-ci: filtro de los checks pesados', () => {
  it('fuera de un PR (master, dispatch, schedule) corre siempre todo', () => {
    for (const perfil of ['verificar', 'postgres', 'e2e'] as const) {
      expect(clasificar(perfil, ['docs/x.md'], { evento: 'push' }).relevante).toBe(true);
      expect(clasificar(perfil, ['docs/x.md'], { evento: 'workflow_dispatch' }).relevante).toBe(true);
    }
  });

  it('la etiqueta ci-completo fuerza la corrida completa', () => {
    expect(pr('verificar', ['docs/x.md'], [ETIQUETA_COMPLETO])).toBe(true);
    expect(pr('postgres', ['README.md'], [ETIQUETA_COMPLETO])).toBe(true);
    expect(pr('e2e', ['docs/x.md'], ['otra', ETIQUETA_COMPLETO])).toBe(true);
  });

  it('falla abierto: diff ilegible o vacío corre todo', () => {
    expect(pr('verificar', null)).toBe(true);
    expect(pr('postgres', [])).toBe(true);
    expect(pr('e2e', null)).toBe(true);
  });

  it('solo documentación: se salta todo lo pesado', () => {
    const docs = ['docs/operacion/ci-costos.md', 'README.md', 'CLAUDE.md', 'src/lib/x/NOTAS.md', '.github/ISSUE_TEMPLATE/a.yml'];
    expect(pr('verificar', docs)).toBe(false);
    expect(pr('postgres', docs)).toBe(false);
    expect(pr('e2e', docs)).toBe(false);
  });

  it('código: `verificar` siempre corre; un solo archivo no documental basta', () => {
    expect(pr('verificar', ['docs/a.md', 'src/lib/x.ts'])).toBe(true);
    expect(pr('verificar', ['package.json'])).toBe(true);
    expect(pr('verificar', ['.github/workflows/ci.yml'])).toBe(true);
  });

  it('Postgres: solo supabase/, scripts/ci/, workflows y migraciones_verificadas.test.ts', () => {
    expect(pr('postgres', ['supabase/migrations/1000_x.sql'])).toBe(true);
    expect(pr('postgres', ['scripts/ci/banco-tenant.mjs'])).toBe(true);
    expect(pr('postgres', ['.github/workflows/ci-postgres.yml'])).toBe(true);
    expect(pr('postgres', ['src/lib/likida/migraciones_verificadas.test.ts'])).toBe(true);
    expect(pr('postgres', ['src/app/dashboard/page.tsx', 'src/lib/likida/otra.ts', 'public/a.png', 'package.json'])).toBe(false);
  });

  it('Playwright: app, componentes, lib, public, suite, config de build y pila local', () => {
    for (const f of ['src/app/a.tsx', 'src/components/b.tsx', 'src/lib/c.ts', 'public/d.svg', 'pruebas-navegador/e.nav.ts',
      'package-lock.json', 'next.config.ts', 'vercel.json', '.github/workflows/e2e-navegador.yml',
      'supabase/seed.sql', 'supabase/migrations/1000_x.sql', 'scripts/ci/e2e/iniciar-pila.mjs']) {
      expect(pr('e2e', [f]), f).toBe(true);
    }
    expect(pr('e2e', ['scripts/ci/lint-ratchet.mjs', 'scripts/aplicar.sh', 'LICENSE'])).toBe(false);
  });

  it('un perfil desconocido es un error, no un verde silencioso', () => {
    expect(() => clasificar('inventado' as never, ['a'])).toThrow('perfil desconocido');
  });
});

describe('cableado: el check requerido NUNCA queda sin reportar', () => {
  const wf = (n: string) => readFileSync(`.github/workflows/${n}`, 'utf8');
  const requeridos = ['ci.yml', 'ci-postgres.yml', 'e2e-navegador.yml'];

  it('ningún workflow con check requerido filtra con `paths`/`paths-ignore` en `on:`', () => {
    for (const n of requeridos) expect(wf(n), n).not.toMatch(/^\s+paths(-ignore)?:/m);
  });

  it('los tres se disparan en PR, push a master y a mano; el push de ramas sueltas lo cubre ci-rapido.yml', () => {
    for (const n of requeridos) {
      const t = wf(n);
      expect(t, n).toMatch(/\n  pull_request:\n/);
      expect(t, n).toMatch(/\n  push:\n    branches: \[master, main\]\n/);
      expect(t, n).toContain('workflow_dispatch:');
      expect(t, n).toContain('node scripts/ci/cambios-ci.mjs');
    }
    expect(wf('ci-rapido.yml')).toMatch(/branches-ignore:\s*\[master, main\]/);
  });

  it('todo paso posterior al filtro está condicionado a `relevante` (salvo la limpieza inocua)', () => {
    for (const n of requeridos) {
      const pasos = wf(n).split('\n      - ').slice(1);
      const iFiltro = pasos.findIndex((p) => p.includes('cambios-ci.mjs'));
      expect(iFiltro, `${n}: falta el paso filtro`).toBeGreaterThan(-1);
      const sinCondicion = pasos
        .slice(iFiltro + 1)
        .filter((p) => !p.includes("steps.cambios.outputs.relevante == 'true'"))
        .map((p) => p.split('\n')[0]);
      // La única excepción permitida: matar el servidor (pkill/kill) y no hacer nada si no existe.
      for (const p of sinCondicion) expect(p, `${n}: paso sin condicionar`).toMatch(/Detener/);
    }
  });
});
