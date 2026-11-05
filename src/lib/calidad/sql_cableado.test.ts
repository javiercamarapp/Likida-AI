/* eslint-disable security/detect-non-literal-fs-filename -- recorre el árbol del repo con rutas propias (nada viene de entrada externa) */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RAIZ } from './escanear-fuentes';

// CT-CAL-03 / CT-CAL-04 (F8): una prueba SQL que nadie corre no prueba nada. Toda prueba de `supabase/tests` con prefijo >= 0700
// (y toda migración >= 0900) debe estar cableada en `ci-postgres.yml`. Lo anterior a 0700 son rondas viejas de familias cuya última
// ronda sí corre; la lista de abajo es cerrada y solo puede bajar.
const DIR = join(RAIZ, 'supabase', 'tests');
const workflow = readFileSync(join(RAIZ, '.github', 'workflows', 'ci-postgres.yml'), 'utf8');
const pruebas = readdirSync(DIR).filter((f) => /^\d{4}_.*\.(sql|sh)$/.test(f));

const SIN_CABLEAR: Record<string, string> = {
  '0336_capacidad_r5_red.sql': 'CI (5-nov-2026) falla con «R5-01: primer viaje del dia operativo actual no reabrio/convergio»: la prueba quedó atrás de la 0336 vigente. Pendiente: revisar si es la prueba o la función (L8B)',
  '0336_capacidad_r5_concurrencia.sh': 'depende del mismo escenario que 0336_capacidad_r5_red.sql; se cablea junto con ella',
  '0337_gps_r5_red.sql': 'no se cableó tras el fallo de 0336 r5 (misma ronda, sin evidencia de que corra limpia); revisar junto con 0336',
  '0337_gps_r5_concurrencia.sh': 'usa mktemp en /private/tmp (macOS); en el runner Linux no existe. Pendiente portarlo a $TMPDIR',
};

describe('pruebas SQL cableadas en CI (CT-CAL-04)', () => {
  it('toda prueba >= 0700 corre en ci-postgres.yml, salvo las declaradas', () => {
    const sueltas = pruebas.filter((f) => f.slice(0, 4) >= '0700' && !workflow.includes(f) && !(f in SIN_CABLEAR));
    expect(sueltas).toEqual([]);
  });

  it('la lista de excepciones no guarda pruebas que ya corren o ya no existen', () => {
    const obsoletas = Object.keys(SIN_CABLEAR).filter((f) => !pruebas.includes(f) || workflow.includes(f));
    expect(obsoletas).toEqual([]);
  });

  it('toda migración >= 0900 la nombra por número alguna prueba de supabase/tests', () => {
    const textos = pruebas.map((f) => [f, readFileSync(join(DIR, f), 'utf8')] as const);
    const migraciones = [...new Set(readdirSync(join(RAIZ, 'supabase', 'migrations')).filter((f) => /^\d{4}_.*\.sql$/.test(f)).map((f) => f.slice(0, 4)))].filter((n) => n >= '0900');
    const sinPrueba = migraciones.filter((n) => !textos.some(([f, t]) => f.startsWith(n) || t.includes(n)));
    expect(sinPrueba, 'migración nueva sin prueba SQL contra Postgres efímero').toEqual([]);
  });
});
