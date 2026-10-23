import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { CHECKS_REQUERIDOS, evaluarChecks, esperarChecks } from './ci-requeridos.mjs';

// A36-R07-03: la ruta de release migraba producción sin exigir ci-postgres ni e2e.
const [PG, E2E] = CHECKS_REQUERIDOS;
const ok = (name: string, extra = {}) => ({ name, status: 'completed', conclusion: 'success', started_at: '2026-10-23T10:00:00Z', id: 1, ...extra });
const sha = 'a'.repeat(40);

describe('evaluarChecks', () => {
  it('ok solo con los dos checks en success', () => {
    expect(evaluarChecks({ check_runs: [ok(PG), ok(E2E)] }).estado).toBe('ok');
  });
  it('falla cerrado si falta uno, está rojo o el payload es ajeno', () => {
    expect(evaluarChecks({ check_runs: [ok(PG)] }).estado).toBe('falla');
    expect(evaluarChecks({ check_runs: [ok(PG), ok(E2E, { conclusion: 'failure' })] }).estado).toBe('falla');
    expect(evaluarChecks({ check_runs: [ok(PG), ok(E2E, { conclusion: 'skipped' })] }).estado).toBe('falla');
    expect(evaluarChecks({}).estado).toBe('falla');
    expect(evaluarChecks(null as never).estado).toBe('falla');
  });
  it('en curso es pendiente, pero un rojo manda sobre un pendiente', () => {
    expect(evaluarChecks({ check_runs: [ok(PG), ok(E2E, { status: 'in_progress', conclusion: null })] }).estado).toBe('pendiente');
    expect(evaluarChecks({ check_runs: [ok(PG, { conclusion: 'failure' }), ok(E2E, { status: 'queued', conclusion: null })] }).estado).toBe('falla');
  });
  it('un re-run verde posterior sustituye al rojo anterior (y no al revés)', () => {
    const rojoViejo = ok(PG, { conclusion: 'failure', started_at: '2026-10-23T09:00:00Z', id: 1 });
    const verdeNuevo = ok(PG, { started_at: '2026-10-23T10:00:00Z', id: 2 });
    expect(evaluarChecks({ check_runs: [rojoViejo, verdeNuevo, ok(E2E)] }).estado).toBe('ok');
    const verdeViejo = ok(PG, { started_at: '2026-10-23T09:00:00Z', id: 1 });
    const rojoNuevo = ok(PG, { conclusion: 'failure', started_at: '2026-10-23T10:00:00Z', id: 2 });
    expect(evaluarChecks({ check_runs: [verdeViejo, rojoNuevo, ok(E2E)] }).estado).toBe('falla');
  });
});

describe('esperarChecks', () => {
  it('espera a que termine el pendiente y consulta con GET sin redirects', async () => {
    const resp = (runs: unknown[]) => ({ ok: true, json: async () => ({ check_runs: runs }) });
    const fetch = vi.fn()
      .mockResolvedValueOnce(resp([ok(PG), ok(E2E, { status: 'in_progress', conclusion: null })]))
      .mockResolvedValueOnce(resp([ok(PG), ok(E2E)]));
    const sleep = vi.fn(async () => {});
    const r = await esperarChecks({ repo: 'o/r', sha, token: 't' }, { fetch, sleep, intentos: 5, pausaMs: 1 });
    expect(r.estado).toBe('ok');
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining(`/commits/${sha}/check-runs`), expect.objectContaining({ method: 'GET', redirect: 'error' }));
  });
  it('agota los intentos como pendiente y rechaza HTTP no ok, SHA o repo inválidos', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ check_runs: [] }) }));
    await expect(esperarChecks({ repo: 'o/r', sha, token: 't' }, { fetch: async () => ({ ok: false, status: 403 }) })).rejects.toThrow('HTTP 403');
    const agotado = await esperarChecks({ repo: 'o/r', sha, token: 't' }, { fetch: async () => ({ ok: true, json: async () => ({ check_runs: [ok(PG), ok(E2E, { status: 'queued', conclusion: null })] }) }), sleep: async () => {}, intentos: 2 });
    expect(agotado.estado).toBe('pendiente');
    await expect(esperarChecks({ repo: 'o/r', sha: 'x', token: 't' }, { fetch })).rejects.toThrow('SHA');
    await expect(esperarChecks({ repo: '../x', sha, token: 't' }, { fetch })).rejects.toThrow('GITHUB_REPOSITORY');
  });
});

describe('cableado en los workflows', () => {
  const release = readFileSync('.github/workflows/deploy-preview-promote.yml', 'utf8');
  const job = (n: string) => release.split(`\n  ${n}:\n`)[1]?.split(/\n  [a-z_-]+:\n/)[0] ?? '';
  it('los nombres exigidos coinciden con los `name:` reales de los jobs', () => {
    expect(readFileSync('.github/workflows/ci-postgres.yml', 'utf8')).toContain(`name: ${PG}`);
    expect(readFileSync('.github/workflows/e2e-navegador.yml', 'utf8')).toContain(`name: ${E2E}`);
  });
  it('production_migrations espera a ci_requeridos, que solo lee checks', () => {
    expect(job('production_migrations')).toMatch(/needs: \[[^\]]*ci_requeridos/);
    const j = job('ci_requeridos');
    expect(j).toContain('checks: read');
    expect(j).toContain('scripts/ci/ci-requeridos.mjs');
    expect(j).toContain('inputs.promote == true');
    expect(j).not.toMatch(/secrets\./);
  });
});
