import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// AUDITORÍA 35, R09-operabilidad-01 (ALTO): el respaldo de Storage usaba una
// lista fija de cuatro buckets y omitía en silencio `buzon-facturas`,
// `cartaporte-docs` y `agente-insumos` (evidencia fiscal, CFF art. 30).
// Prueba ESTÁTICA (sin red ni Postgres): cruza los buckets que crean las
// migraciones contra la lista única del respaldo y falla si falta alguno.

const RAIZ = process.cwd();
// eslint-disable-next-line security/detect-non-literal-fs-filename -- lee archivos fijos del propio repo (rutas literales que arma el llamador) durante la prueba
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8');

/** Buckets que las migraciones crean: `insert into storage.buckets … values ('id', …)`. */
function bucketsDeMigraciones(): Map<string, string> {
  const dir = join(RAIZ, 'supabase/migrations');
  const out = new Map<string, string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- recorre las migraciones del propio repo; el nombre sale de readdirSync sobre una carpeta fija
    const sql = readFileSync(join(dir, f), 'utf8').replace(/--.*$/gm, '');
    const bloques = sql.matchAll(/insert\s+into\s+storage\.buckets\b[\s\S]*?\bvalues\s*(\([\s\S]*?\))\s*(?:on\s+conflict|;)/gi);
    for (const b of bloques) {
      const id = /^\(\s*'([^']+)'/.exec(b[1])?.[1];
      if (id) out.set(id, f);
    }
  }
  return out;
}

/** Lista única del respaldo: un bucket por línea, `#` comenta. */
function bucketsDelRespaldo(): string[] {
  return leer('scripts/respaldo-buckets.txt')
    .split('\n')
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter(Boolean);
}

describe('R09-operabilidad-01: el respaldo de Storage cubre todos los buckets', () => {
  it('la prueba encuentra los buckets de las migraciones (guarda contra un regex roto)', () => {
    const ids = [...bucketsDeMigraciones().keys()];
    expect(ids).toEqual(expect.arrayContaining(['comprobantes', 'liquidaciones', 'buzon-facturas', 'cartaporte-docs', 'agente-insumos']));
    expect(ids.length).toBeGreaterThanOrEqual(9);
  });

  it('cada bucket creado por una migración está en scripts/respaldo-buckets.txt', () => {
    const respaldados = new Set(bucketsDelRespaldo());
    const faltan = [...bucketsDeMigraciones()].filter(([id]) => !respaldados.has(id)).map(([id, f]) => `${id} (${f})`);
    expect(faltan, `Buckets creados en migraciones y ausentes del respaldo: ${faltan.join(', ')}`).toEqual([]);
  });

  it('la lista del respaldo no trae buckets que ninguna migración crea (nombres con typo)', () => {
    const creados = new Set(bucketsDeMigraciones().keys());
    const sobran = bucketsDelRespaldo().filter((b) => !creados.has(b));
    expect(sobran).toEqual([]);
  });

  it('el script y el workflow usan la lista única, sin una copia propia que vuelva a divergir', () => {
    const sh = leer('scripts/respaldo-storage.sh');
    expect(sh).toContain('respaldo-buckets.txt');
    expect(sh).not.toMatch(/RESPALDO_BUCKETS:-[a-z]/);
    const wf = leer('.github/workflows/backup-storage.yml');
    expect(wf).not.toMatch(/RESPALDO_BUCKETS:.*'[a-z]+ [a-z]+/);
  });
});
