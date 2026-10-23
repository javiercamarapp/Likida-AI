import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// A36-R07-02 (MEDIO): tras un rollback la base queda ADELANTE del código
// (`migracion.adelante > 0`) y /api/health responde `degraded` + HTTP 503. El
// paso de verificación usaba `curl --fail` + `status == "ok"` y reportaba
// fallido el rollback justo cuando hay migraciones posteriores. Aquí se
// evalúa la expresión jq REAL del workflow contra cuerpos de /api/health.
const workflow = readFileSync('.github/workflows/rollback-production.yml', 'utf8');
const paso = workflow.split('name: Verificar salud del deployment restaurado')[1] ?? '';
const filtro = /jq -e '([^']+)'/.exec(paso)?.[1] ?? '';
const hayJq = spawnSync('jq', ['--version']).status === 0;

function acepta(cuerpo: unknown): boolean {
  return spawnSync('jq', ['-e', filtro], { input: JSON.stringify(cuerpo) }).status === 0;
}
const sano = { status: 'ok', checks: { db: 'ok', crons: 'ok' }, migracion: { atras: 0, adelante: 0 } };

describe('rollback-production: verificación de salud', () => {
  it('no usa curl --fail (un 503 por migraciones adelante no es un rollback fallido)', () => {
    expect(paso).not.toMatch(/curl[^\n]*--fail/);
    expect(filtro).not.toBe('');
  });
  it.skipIf(!hayJq)('acepta ok, y degraded SOLO por migraciones adelante', () => {
    expect(acepta(sano)).toBe(true);
    expect(acepta({ ...sano, status: 'degraded', migracion: { atras: 0, adelante: 3 } })).toBe(true);
    // Deployment viejo anterior al campo `migracion`.
    expect(acepta({ status: 'ok', checks: { db: 'ok' } })).toBe(true);
  });
  it.skipIf(!hayJq)('sigue fallando con db caída, base atrás, crons degradados o cuerpo ajeno', () => {
    expect(acepta({ ...sano, status: 'fail', checks: { db: 'fail', crons: 'ok' } })).toBe(false);
    expect(acepta({ ...sano, status: 'degraded', migracion: { atras: 2, adelante: 0 } })).toBe(false);
    expect(acepta({ ...sano, status: 'degraded', migracion: { atras: 0, adelante: 1 }, checks: { db: 'ok', crons: 'degraded' } })).toBe(false);
    expect(acepta({ ...sano, status: 'degraded', migracion: { atras: null, adelante: 1 } })).toBe(false);
    expect(acepta({ status: 'degraded', checks: { db: 'ok', crons: 'ok' } })).toBe(false);
    expect(acepta({ error: 'x' })).toBe(false);
  });
});
