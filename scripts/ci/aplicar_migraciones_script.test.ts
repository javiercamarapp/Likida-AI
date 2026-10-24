import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// A37-L-09 (operabilidad): `aplicar-migraciones-y-humos.sh` migra PRODUCCIÓN. Antes usaba `supabase@latest` +
// `--include-all` sin dry-run, sin comprobar la base ni pedir el respaldo. Se fija por texto (el script toca la base real).
const sh = readFileSync('scripts/aplicar-migraciones-y-humos.sh', 'utf8');
const deploy = readFileSync('.github/workflows/deploy-preview-promote.yml', 'utf8');

describe('aplicar-migraciones-y-humos.sh: no migra producción a ciegas', () => {
  it('fija la CLI de Supabase a la misma versión que el workflow de despliegue (nada de @latest)', () => {
    const version = /SUPABASE_CLI_VERSION: '([^']+)'/.exec(deploy)?.[1];
    expect(version).toBeTruthy();
    expect(sh).not.toContain('supabase@latest');
    expect(sh).toContain(`SUPABASE_CLI_VERSION="\${SUPABASE_CLI_VERSION:-${version}}"`);
  });
  it('--include-all es opt-in (INCLUIR_TODAS=1), no el valor por defecto', () => {
    const lineasPush = sh.split('\n').filter((l) => /db push/.test(l) && /npx/.test(l));
    expect(lineasPush.length).toBeGreaterThanOrEqual(2);
    for (const l of lineasPush) expect(l).not.toContain('--include-all');
    expect(sh).toContain('INCLUIR_TODAS');
  });
  it('hace dry-run ANTES del push real, y pide el respaldo y valida la base ANTES de cualquier npx', () => {
    const iDry = sh.indexOf('--dry-run');
    const iPush = sh.indexOf('db push', iDry + 1);
    expect(iDry).toBeGreaterThan(0);
    expect(iPush).toBeGreaterThan(iDry);
    const iNpx = sh.indexOf('npx --yes "supabase@');
    expect(sh.indexOf('RESPALDO_VERIFICADO')).toBeLessThan(iNpx);
    expect(sh.indexOf('REF_PRODUCCION')).toBeLessThan(iNpx);
  });
});

// A37-L-02 (operabilidad): el rojo del respaldo nocturno tiene dueño.
describe('backup-storage.yml: el rojo abre issue', () => {
  const wf = readFileSync('.github/workflows/backup-storage.yml', 'utf8');
  it('puede escribir issues, abre uno en failure() sin duplicar y lo cierra al volver a verde', () => {
    expect(wf).toMatch(/permissions:\n  contents: read\n(?:  #[^\n]*\n)*  issues: write/);
    expect(wf).toMatch(/if: failure\(\)[\s\S]*gh issue create[\s\S]*--label respaldo-fallido/);
    expect(wf).toContain('no se duplica');
    expect(wf).toMatch(/if: success\(\)[\s\S]*gh issue close/);
  });
});
