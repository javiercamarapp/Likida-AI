import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { restringidasDesdeMigraciones } from './restringidas-desde-migraciones.mjs';

// A37-S02-01: la lista de grants-locales.sql tenía 13 tablas cuando las migraciones revocan ~100.
describe('grants-locales.sql', () => {
  const sql = readFileSync('scripts/ci/e2e/grants-locales.sql', 'utf8');
  it('su lista de tablas restringidas coincide con las migraciones (más bitacora_auditoria)', () => {
    const bloque = sql.slice(sql.indexOf('restringidas text[] := array['), sql.indexOf('];', sql.indexOf('restringidas text[] := array[')));
    const enSql = [...bloque.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]).sort();
    expect(enSql).toEqual([...restringidasDesdeMigraciones(), 'bitacora_auditoria'].sort());
  });
  it('aborta sin la variable es_local y el workflow la pasa', () => {
    expect(sql).toMatch(/\\if :\{\?es_local\}/);
    expect(readFileSync('.github/workflows/e2e-navegador.yml', 'utf8')).toContain('-v es_local=si -f scripts/ci/e2e/grants-locales.sql');
  });
});
