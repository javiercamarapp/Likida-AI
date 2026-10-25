import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// `regla_disparo` NO tiene columna `id` (su clave es compuesta: tenant_id, regla_id, objeto, objeto_id, clave).
// Un `.select('id')` sobre ella falla en la base ("column regla_disparo.id does not exist") y, como los
// llamadores lo tratan como aviso, la retención de evidencia (A37-S56-06) y la anonimización ARCO se
// quedaban sin ejecutar en silencio. Los dobles de prueba no ven esto: esta guarda lee el código.
const ARCHIVOS = ['src/lib/likida/reglas/repo.ts', 'src/lib/likida/repo.ts'];

describe('regla_disparo no se consulta por una columna id que no existe', () => {
  for (const rel of ARCHIVOS) {
    it(`${rel} no hace select/eq/in/order por 'id' sobre regla_disparo`, () => {
      const fuente = readFileSync(join(process.cwd(), rel), 'utf8');
      const fallos: string[] = [];
      for (const m of fuente.matchAll(/\.from\('regla_disparo'\)/g)) {
        const desde = m.index ?? 0;
        const resto = fuente.slice(desde + m[0].length);
        const siguiente = resto.search(/\.from\('/);
        const tramo = siguiente >= 0 ? resto.slice(0, siguiente) : resto.slice(0, 600);
        if (/\.select\('id'\)|\.select\('id,|\.eq\('id'|\.in\('id'|\.order\('id'/.test(tramo)) {
          fallos.push(`línea ${fuente.slice(0, desde).split('\n').length}`);
        }
      }
      expect(fallos).toEqual([]);
    });
  }
});
