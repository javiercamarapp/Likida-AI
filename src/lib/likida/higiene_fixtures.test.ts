import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generadorFixture, mulberry32 } from './fixtures_semilla';

// ═══════════════════════════════════════════════════════════════════════════
// HIGIENE DE FIXTURES: el repo es PÚBLICO, los fixtures llevan la FORMA de los
// datos reales (cabeceras, separadores, columnas) pero NUNCA sus valores.
// Convención: docs/operacion/fixtures-sinteticos.md.
//
// La prueba NO conoce nombres de personas ni de empresas: detecta FORMAS
// (RFC, correo no reservado, teléfono sin marca, importes grandes en fixtures
// de nómina). Así no filtra lo que vigila. Mira el índice de git, no el disco.
// ═══════════════════════════════════════════════════════════════════════════

export interface Hallazgo { ruta: string; linea: number; tipo: string; muestra: string }

// Rutas que cuentan como fixture: carpeta que empieza por `fixtures`, `__fixtures__` o archivo `*.fixture.*`.
export function esRutaFixture(ruta: string): boolean {
  const partes = ruta.split('/');
  const archivo = partes[partes.length - 1];
  return (
    partes.slice(0, -1).some((d) => d === '__fixtures__' || d.startsWith('fixtures')) ||
    /\.fixture\.[a-z]+$/i.test(archivo)
  );
}

const EXT_TEXTO = /\.(ts|tsx|js|json|csv|txt|md|html|xml|sql|yml|yaml)$/i;
const RFC = /(?<![A-Za-z0-9ÑÁ&])[A-ZÑ&]{3,4}(\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[A-Z0-9]{3}(?![A-Za-z0-9])/g;
// RFC genéricos oficiales del SAT (público en general / extranjero): no identifican a nadie.
const RFC_GENERICOS = new Set(['XAXX010101000', 'XEXX010101000']); // grep-limpio:ok
const CORREO = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;
const TLD_RESERVADOS = /(?:\.invalid|\.test|\.example|\.localhost)$|^(?:example\.(?:com|org|net))$/i;
const TELEFONO = /(?<![\dA-Za-z.])(?:\+?52[\s-]?)?(\d{10})(?![\dA-Za-z]|\.\d)/g;
const IMPORTE_GRANDE = /\$\s?(?:\d{1,3}(?:,\d{3})+|\d{5,})/g;
const RUTA_NOMINA = /n[oó]mina|sueldo|salari|payroll|liquidaci[oó]n/i;

/** Escanea el texto de un fixture. `ruta` decide si aplica la regla de importes (nómina). */
export function escanearTexto(ruta: string, texto: string): Hallazgo[] {
  const salida: Hallazgo[] = [];
  const nomina = RUTA_NOMINA.test(ruta);
  texto.split('\n').forEach((linea, i) => {
    const n = i + 1;
    for (const m of linea.matchAll(RFC)) {
      // Homoclave XXX = convención de RFC sintético (no existe como homoclave real).
      if (!RFC_GENERICOS.has(m[0]) && !m[0].endsWith('XXX')) salida.push({ ruta, linea: n, tipo: 'rfc', muestra: m[0] });
    }
    for (const m of linea.matchAll(CORREO)) {
      if (!TLD_RESERVADOS.test(m[1])) salida.push({ ruta, linea: n, tipo: 'correo', muestra: m[0] });
    }
    for (const m of linea.matchAll(TELEFONO)) {
      // Teléfono sintético: marca 28999. Se ignoran los números que son parte de un número más largo con punto/letra.
      if (m[1] === '4294967296') continue; // 2^32: constante de los PRNG de semilla fija, no un teléfono // grep-limpio:ok
      if (!m[1].startsWith('28999')) salida.push({ ruta, linea: n, tipo: 'telefono', muestra: m[1] });
    }
    if (nomina) {
      for (const m of linea.matchAll(IMPORTE_GRANDE)) {
        salida.push({ ruta, linea: n, tipo: 'importe_nomina', muestra: m[0] });
      }
    }
  });
  return salida;
}

/**
 * Allowlist de hallazgos EXISTENTES, por `ruta|tipo|muestra`. Cada entrada se justifica.
 * No se reescriben fixtures de otros frentes: solo se reportan aquí.
 */
const FAKE_TEL = 'teléfono de relleno con dígitos repetidos, inexistente; deuda: migrar a la marca 28999 (reportado a su frente)';
export const ALLOWLIST: Record<string, string> = {
  'src/lib/likida/conectores/fixtures-gps/wialon_search_items.json|telefono|1790000000': 'marca de tiempo epoch (campo "t"), no es un teléfono', // grep-limpio:ok
  'src/lib/likida/conectores/fixtures-gps/wialon_search_items.json|telefono|1790000060': 'marca de tiempo epoch (campo "t"), no es un teléfono', // grep-limpio:ok
  'src/lib/likida/vigia/repo.fixture.ts|telefono|5511110001': FAKE_TEL, // grep-limpio:ok
  'src/lib/likida/vigia/repo.fixture.ts|telefono|5599999999': FAKE_TEL, // grep-limpio:ok
  'src/lib/likida/vigia/repo.fixture.ts|telefono|5588888888': FAKE_TEL, // grep-limpio:ok
};

const clave = (h: Hallazgo) => `${h.ruta}|${h.tipo}|${h.muestra}`;

function listarFixtures(raiz: string): string[] | null {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], {
      cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
    });
    return out.split('\0').filter((r) => r && esRutaFixture(r) && EXT_TEXTO.test(r));
  } catch {
    return null; // sin git (tarball): no hay índice que auditar
  }
}

export function auditar(raiz: string): Hallazgo[] | null {
  const rutas = listarFixtures(raiz);
  if (rutas === null) return null;
  const hallazgos: Hallazgo[] = [];
  for (const r of rutas) {
    let texto: string;
    try { texto = readFileSync(join(raiz, r), 'utf8'); } catch { continue; }
    hallazgos.push(...escanearTexto(r, texto));
  }
  return hallazgos.filter((h) => !(clave(h) in ALLOWLIST));
}

describe('higiene de fixtures sintéticos', () => {
  it('los fixtures rastreados no contienen RFC, correos reales, teléfonos sin marca ni importes de nómina', () => {
    const raiz = process.env.HIGIENE_RAIZ ?? process.cwd();
    const h = auditar(raiz);
    if (h === null) return;
    expect(
      h,
      h.length === 0 ? '' : `Datos con forma real en fixtures (repo PÚBLICO): ${h.slice(0, 5).map((x) => `${x.ruta}:${x.linea} [${x.tipo}]`).join('; ')}`,
    ).toEqual([]);
  });

  it('cada entrada de la allowlist está justificada', () => {
    for (const [k, motivo] of Object.entries(ALLOWLIST)) {
      expect(motivo.trim().length, `sin justificación: ${k}`).toBeGreaterThan(10);
    }
  });

  it('negativo: un RFC válido (persona moral y física) se detecta; los genéricos del SAT no', () => {
    const t = ['rfc,ABC850314K12', 'rfc,ABCD850314K12', 'rfc,XAXX010101000', 'rfc,XEXX010101000', 'rfc,ABC850314XXX'].join('\n'); // grep-limpio:ok
    const h = escanearTexto('a/fixtures/x.csv', t);
    expect(h.map((x) => x.tipo)).toEqual(['rfc', 'rfc']);
    expect(h.map((x) => x.linea)).toEqual([1, 2]);
  });

  it('negativo: un correo de dominio real se detecta; .invalid, .test y example.com no', () => {
    const t = 'a@gmail.com b@demo.invalid c@x.test d@example.com e@empresa.com.mx'; // grep-limpio:ok
    const h = escanearTexto('a/fixtures/x.json', t);
    expect(h.map((x) => x.muestra)).toEqual(['a@gmail.com', 'e@empresa.com.mx']); // grep-limpio:ok
  });

  it('negativo: un teléfono de 10 dígitos sin la marca 28999 se detecta (también con +52); con marca no', () => {
    const t = 'tel 5512345678 | +52 9981234567 | 2899912345 | version 1.2345678901'; // grep-limpio:ok
    const h = escanearTexto('a/fixtures/x.csv', t);
    expect(h.map((x) => x.muestra)).toEqual(['5512345678', '9981234567']); // grep-limpio:ok
    expect(escanearTexto('a/fixtures/prng.ts', 'return x / 4294967296;')).toEqual([]);
  });

  it('negativo: importes con $ de más de 4 cifras solo cuentan en fixtures de nómina/liquidación', () => {
    const t = 'total $12,345.00 y $99999 pero $850';
    expect(escanearTexto('a/fixtures/nomina.csv', t).map((x) => x.muestra)).toEqual(['$12,345', '$99999']);
    expect(escanearTexto('a/fixtures/peajes.csv', t)).toEqual([]);
  });

  it('esRutaFixture reconoce fixtures*/, __fixtures__/ y *.fixture.*, y nada más', () => {
    for (const r of ['src/x/fixtures/a.csv', 'src/x/fixtures-gps/a.json', 'src/__fixtures__/a.ts', 'src/x/memoria.fixture.ts']) {
      expect(esRutaFixture(r), r).toBe(true);
    }
    for (const r of ['src/x/mi_fixtures.ts', 'src/x/prueba.test.ts', 'docs/fixturesque.md']) {
      expect(esRutaFixture(r), r).toBe(false);
    }
  });

  it('el generador de semilla fija es determinista y respeta las marcas sintéticas', () => {
    const a = generadorFixture(42);
    const b = generadorFixture(42);
    const sec = (g: ReturnType<typeof generadorFixture>) => [g.unidad(), g.telefono(), g.correo('op'), g.importe(100, 900)];
    expect(sec(a)).toEqual(sec(b));
    expect(mulberry32(1)()).toBe(mulberry32(1)());
    const g = generadorFixture(7);
    for (let i = 0; i < 200; i++) {
      expect(g.unidad()).toMatch(/^TC9\d{3}$/);
      expect(g.telefono()).toMatch(/^28999\d{5}$/);
      expect(g.correo()).toMatch(/@demo\.invalid$/);
      const imp = g.importe(10, 20);
      expect(imp).toBeGreaterThanOrEqual(10);
      expect(imp).toBeLessThanOrEqual(20);
    }
  });

  it('lo generado por el generador pasa el propio escáner', () => {
    const g = generadorFixture(2026);
    const filas = Array.from({ length: 50 }, () => `${g.unidad()};${g.telefono()};${g.correo()}`).join('\n');
    expect(escanearTexto('src/fixtures/gen.csv', filas)).toEqual([]);
  });
});
