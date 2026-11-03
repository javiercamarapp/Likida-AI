// CT-BAS-08: producción tiene dos esquemas de versión en schema_migrations; un
// `supabase db push` re-aplicaría ~256 migraciones. El documento operativo no
// puede volver a recomendarlo como camino de aplicación.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const doc = readFileSync('supabase/APLICAR-EN-PRODUCCION.md', 'utf8');

describe('APLICAR-EN-PRODUCCION.md (CT-BAS-08)', () => {
  it('advierte que nunca se corre db push ni migration repair contra producción', () => {
    expect(doc).toMatch(/NUNCA `supabase db push` NI `supabase migration repair`/);
    expect(doc).toMatch(/dos esquemas de versión|DOS esquemas de versión/i);
  });

  it('describe el procedimiento una por una con respaldo, RPC y sonda de salud', () => {
    expect(doc).toMatch(/El procedimiento correcto/);
    expect(doc).toMatch(/migraciones_aplicadas\(\)/);
    expect(doc).toMatch(/\/api\/health/);
    expect(doc).toMatch(/[Rr]espaldo/);
  });

  it('ninguna línea instruye aplicar con `supabase db push` (solo se menciona para prohibirlo)', () => {
    const ofensivas = doc.split('\n').filter((l) => {
      if (!/supabase db push/.test(l)) return false;
      return !/(NUNCA|NO |Nunca|ver el aviso|cotejan|intentaría|`db push` de)/.test(l);
    });
    expect(ofensivas).toEqual([]);
  });

  it('no deja el bloque de código «supabase db push» como regla corta', () => {
    expect(doc).not.toMatch(/```bash\s*\nsupabase db push\s*\n```/);
  });

  it('las secciones «Pendiente de aplicar» ya aplicadas están marcadas como históricas (CT-BAS-16)', () => {
    expect(doc).toMatch(/Estado verificado el 3-nov-2026/);
    const pendientes = doc.split('\n').filter((l) => l.startsWith('> **') && /Pendiente de aplicar/.test(l));
    expect(pendientes.length).toBeGreaterThan(0);
    for (const l of pendientes) expect(l).toMatch(/Histórico/);
  });
});
