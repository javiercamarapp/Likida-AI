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

// A57-OP-01 (auditoría 57, CRÍTICO): el documento ya prohibía `db push` contra
// producción —y las pruebas de arriba lo vigilan— pero SOLO leía el .md. El camino
// EJECUTABLE que ese mismo aviso nombra por su nombre seguía corriendo el push:
// `scripts/aplicar-migraciones-y-humos.sh` y el job `production_migrations` de
// `deploy-preview-promote.yml`. El `--dry-run` que va justo antes no frenaba nada:
// imprimía los ~256 pendientes y la línea siguiente los aplicaba. Una prohibición
// que vive solo en la prosa no es una prohibición.
describe('el camino EJECUTABLE no corre db push sin autorización explícita (A57-OP-01)', () => {
  const sh = readFileSync('scripts/aplicar-migraciones-y-humos.sh', 'utf8');
  const wf = readFileSync('.github/workflows/deploy-preview-promote.yml', 'utf8');

  // Solo el job de PRODUCCIÓN. El `db push` de `prepare_preview` va contra STAGING
  // (`SUPABASE_PROJECT_REF_STAGING`, ref dmhhygwzgudwgcbixuwp) y ahí es legítimo:
  // CT-BAS-08 es sobre los dos esquemas de versión que mezcla la base de PRODUCCIÓN.
  // Guardar staging rompería el preview sin ganar nada, así que el recorte es por job.
  const jobProduccion = (() => {
    const lineas = wf.split('\n');
    const ini = lineas.findIndex((l) => /^  production_migrations:/.test(l));
    expect(ini).toBeGreaterThanOrEqual(0);
    const fin = lineas.findIndex((l, i) => i > ini && /^  [a-z_]+:/.test(l));
    return lineas.slice(ini, fin === -1 ? undefined : fin).join('\n');
  })();

  /**
   * Índice de la guarda y de la primera INVOCACIÓN real de `db push`.
   * «Invocación» = línea que ejecuta la CLI (`npx … db push`) y no es dry-run; si
   * se matchearan todas las líneas con el texto «db push» contarían los comentarios
   * —incluido el de la propia guarda— y la prueba mediría otra cosa.
   */
  const posiciones = (texto: string) => {
    const lineas = texto.split('\n');
    const esInvocacion = (l: string) => /npx\b.*\bdb push\b/.test(l) && !/--dry-run/.test(l);
    return {
      guarda: lineas.findIndex((l) => /DB_PUSH_AUTORIZADO/.test(l) && !/^\s*(#|\/\/)/.test(l)),
      push: lineas.findIndex(esInvocacion),
    };
  };

  it('el script pide DB_PUSH_AUTORIZADO antes de cualquier db push real', () => {
    const { guarda, push } = posiciones(sh);
    expect(push).toBeGreaterThanOrEqual(0);
    expect(guarda).toBeGreaterThanOrEqual(0);
    expect(guarda).toBeLessThan(push);
  });

  it('el job de migraciones de PRODUCCIÓN pide lo mismo antes del push', () => {
    const { guarda, push } = posiciones(jobProduccion);
    expect(push).toBeGreaterThanOrEqual(0);
    expect(guarda).toBeGreaterThanOrEqual(0);
    expect(guarda).toBeLessThan(push);
  });

  it('la guarda manda a leer el documento y cita el ID de la decisión, no solo falla', () => {
    for (const texto of [sh, jobProduccion]) {
      expect(texto).toMatch(/DB_PUSH_AUTORIZADO/);
      expect(texto).toMatch(/CT-BAS-08/);
      expect(texto).toMatch(/APLICAR-EN-PRODUCCION\.md/);
    }
  });
});
