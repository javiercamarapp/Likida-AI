// S-05 / A39-S57-01 (CRÍTICO), lado BASE: ¿puede la flota escribir `tenant` (y con ello el RFC del candado SAT) con su
// JWT, saltándose la aplicación? Prueba de fuente sobre las migraciones, con la evidencia que cierra el hallazgo:
//   · 0078: `tenant_self` deja de ser `for all` y queda SOLO `for select` (nadie escribe `tenant` por PostgREST);
//   · ninguna migración posterior vuelve a crear una política de escritura sobre `tenant`;
//   · ninguna migración otorga INSERT/UPDATE/ALL de `tenant` a anon/authenticated/public;
//   · 0925: el RFC que autoriza un buzón es `rfc_sat_verificado`, columna que NINGUNA ruta de flota escribe
//     (lo vigila `rfc_verificado_solo_likida.test.ts`);
//   · 0947: revoca todo a anon/authenticated sobre las tablas de `public` (sin excepción para `tenant`).
// El hallazgo está CERRADO en el repo: no hace falta migración 0953. Si esta prueba falla, el candado se reabrió.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

const DIR = 'supabase/migrations';
const migraciones = readdirSync(DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()
  .map((f) => ({ f, sql: readFileSync(`${DIR}/${f}`, 'utf8').replace(/--[^\n]*/g, '') }));
const despuesDe = (n: string) => migraciones.filter((m) => m.f.slice(0, 4) > n);

describe('A39-S57-01 · la flota no puede escribir tenant (ni su RFC) por la base', () => {
  it('0078 deja tenant_self solo para SELECT', () => {
    const m = migraciones.find((x) => x.f.startsWith('0078_'))!;
    expect(m.sql).toMatch(/create policy tenant_self on tenant for select/i);
    expect(m.sql).toMatch(/drop policy if exists tenant_self on tenant/i);
  });

  it('ninguna migración posterior a 0078 crea una política de escritura sobre tenant', () => {
    const POLITICA = /create\s+policy\s+\S+\s+on\s+(?:public\.)?tenant\s+for\s+(all|insert|update|delete)\b/i;
    const culpables = despuesDe('0078').filter((m) => POLITICA.test(m.sql)).map((m) => m.f);
    expect(culpables).toEqual([]);
  });

  it('ninguna migración otorga escritura sobre tenant a anon, authenticated o public', () => {
    const GRANT = /grant\s+[^;]*\b(insert|update|all)\b[^;]*\bon\s+(?:table\s+)?(?:public\.)?tenant\b[^;]*\bto\s+[^;]*\b(anon|authenticated|public)\b/i;
    const culpables = migraciones.filter((m) => GRANT.test(m.sql)).map((m) => m.f);
    expect(culpables).toEqual([]);
  });

  it('0925 separa tenant.rfc (lo edita la flota) de rfc_sat_verificado (el único que autoriza un buzón)', () => {
    const m = migraciones.find((x) => x.f.startsWith('0925_'))!;
    expect(m.sql).toMatch(/add column if not exists rfc_sat_verificado text/i);
  });

  it('0947 revoca todo a anon/authenticated sobre las tablas de public, sin excepción para tenant', () => {
    const m = migraciones.find((x) => x.f.startsWith('0947_'))!;
    expect(m.sql).toMatch(/revoke all on table %s from anon, authenticated/i);
    // La única lectura que 0947 devuelve a authenticated es app_user; tenant no aparece en ningún grant de 0947.
    expect(m.sql).not.toMatch(/grant[^;]*\btenant\b/i);
  });
});
