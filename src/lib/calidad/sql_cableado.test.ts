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
  '0336_capacidad_r5_red.sql': 'CI (4-nov-2026, hora local) falla con «R5-01: primer viaje del dia operativo actual no reabrio/convergio»: la prueba quedó atrás de la 0336 vigente. NO está descartada una regresión real de la función (calcular_input_version_jornada / jornada_dia): la prueba depende del reloj audit_0336_reloj y el push fallido fue pasada la medianoche UTC. Pendiente con dueño en L8B: correr contra la base de integ/f2-f5 con el reloj fijado a otra hora para separar defecto de prueba de defecto de función',
  '0336_capacidad_r5_concurrencia.sh': 'depende del mismo escenario que 0336_capacidad_r5_red.sql; se cablea junto con ella',
  '0337_gps_r5_red.sql': 'no se cableó tras el fallo de 0336 r5 (misma ronda, no se intentó correrla, no hay evidencia de que pase ni de que falle); revisar junto con 0336',
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

  // A51-PRU-03 — Esto era `t.includes(n)` con `n` = los cuatro dígitos pelados, y
  // así una migración contaba como probada si ese número aparecía en CUALQUIER
  // sitio de cualquier prueba SQL: dentro de un teléfono sintético, de una clave
  // del SAT, de un importe o de un tope de bytes. No es hipotético: el teléfono
  // `525500801006` de `0801_conductor_sembrar_por_perfil.sql:36` daba por probada
  // de antemano a la migración **1006**, que no existe todavía. Reproducido: con
  // `t.includes`, un `1006_*.sql` vacío y sin una sola prueba pasaba 3 de 3.
  //
  // Ahora se exige una referencia que solo puede ser deliberada, en una de cuatro
  // formas —y las cuatro son las que el repo ya usa, no se inventó ninguna:
  //   1. el nombre del archivo de prueba empieza por el número (`1004_….sql`);
  //   2. el texto cita el PREFIJO de la migración (`1004_liquidacion_…`);
  //   3. el texto dice «migración 1004» / «mig. 1004»;
  //   4. el texto declara una FAMILIA con barras, que es cómo una sola prueba
  //      cubre varias migraciones hermanas: `-- 0946/0947/0948 (Ola 1 …)` en
  //      `0946_tenant_buzon_token_y_grants_cerrados.sql:1`, o `-- 0950/0951/0952`
  //      en `0950_telefono_identidad.sql:2`.
  // Con esta regla las 42 migraciones >= 0900 de hoy siguen verdes —las cinco que
  // solo pasaban por subcadena (0947, 0948, 0951, 0952, 0954) lo hacen por la
  // forma 4, que es legítima— y no hizo falta lista de excepciones.
  // Sin regex con cuantificador anidado (`detect-unsafe-regex`, y el repo ya tuvo
  // que arreglar uno): el texto se parte por lo que NO es dígito ni barra, y de
  // los pedazos resultantes se miran los que llevan barra.
  const NI_DIGITO_NI_BARRA = /[^\d/]+/;

  /** ¿La prueba `archivo` nombra la migración `n` a propósito? */
  function nombraLaMigracion(n: string, archivo: string, texto: string): boolean {
    if (archivo.startsWith(n)) return true;                                   // 1
    if (new RegExp(`\\b${n}_`).test(texto)) return true;                        // 2
    if (new RegExp(`(?:migraci[oó]n(?:es)?|mig\\.?|migration)\\s*0*${n}\\b`, 'i').test(texto)) return true; // 3
    for (const pedazo of texto.split(NI_DIGITO_NI_BARRA)) {                   // 4
      if (pedazo.includes('/') && pedazo.split('/').includes(n)) return true;
    }
    return false;
  }

  it('toda migración >= 0900 la nombra A PROPÓSITO alguna prueba de supabase/tests', () => {
    const textos = pruebas.map((f) => [f, readFileSync(join(DIR, f), 'utf8')] as const);
    const migraciones = [...new Set(readdirSync(join(RAIZ, 'supabase', 'migrations')).filter((f) => /^\d{4}_.*\.sql$/.test(f)).map((f) => f.slice(0, 4)))].filter((n) => n >= '0900');
    const sinPrueba = migraciones.filter((n) => !textos.some(([f, t]) => nombraLaMigracion(n, f, t)));
    expect(sinPrueba, 'migración nueva sin prueba SQL contra Postgres efímero').toEqual([]);
  });

  it('A51-PRU-03 · un número suelto dentro de un dato NO cuenta como prueba', () => {
    // El caso exacto que desarmaba la guarda, fijado para que no vuelva: el
    // teléfono sintético `525500801006` contiene «1006» y no prueba nada.
    const semilla = readFileSync(join(DIR, '0801_conductor_sembrar_por_perfil.sql'), 'utf8');
    expect(semilla, 'cambió la semilla: reelige el ejemplo').toContain('525500801006');
    expect(semilla.includes('1006'), 'la subcadena sigue ahí, que es el punto').toBe(true);
    expect(nombraLaMigracion('1006', '0801_conductor_sembrar_por_perfil.sql', semilla)).toBe(false);
  });
});
