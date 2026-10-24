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

// A37-L-01 (operabilidad): el runner no tiene `.vercel/`; sin proyecto enlazado y con otra CLI, el único rollback automatizado
// no existía cuando hacía falta. Misma CLI y mismos IDs que el despliegue.
describe('rollback-production: proyecto enlazado y CLI fijada', () => {
  const deploy = readFileSync('.github/workflows/deploy-preview-promote.yml', 'utf8');
  const delDeploy = (k: string) => new RegExp(`^\\s+${k}: ['"]?([^'"\\s]+)['"]?\\s*$`, 'm').exec(deploy)?.[1] ?? null;
  it('declara la organización y el proyecto de Vercel, los mismos que el despliegue', () => {
    expect(delDeploy('VERCEL_ORG_ID')).not.toBeNull();
    expect(workflow).toContain(`VERCEL_ORG_ID: ${delDeploy('VERCEL_ORG_ID')}`);
    expect(workflow).toContain(`VERCEL_PROJECT_ID: ${delDeploy('VERCEL_PROJECT_ID')}`);
    expect(workflow).toMatch(/rollback "\$URL" --scope "\$VERCEL_ORG_ID"/);
  });
  it('usa la versión de la CLI fijada en el despliegue (no una vieja)', () => {
    expect(workflow).toContain(`VERCEL_CLI_VERSION: '${delDeploy('VERCEL_CLI_VERSION')}'`);
    expect(workflow).not.toContain('vercel@41');
  });
});
