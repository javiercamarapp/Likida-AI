import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { medirDeuda, pareceEspanol } from './deuda_medicion';

// ═══════════════════════════════════════════════════════════════════════════
// i18n_deuda — LA DEUDA DE TEXTO EN ESPAÑOL FUERA DE DICCIONARIO SOLO BAJA (PLAN-I18N §4, guarda 2).
//
// «Deuda» = un texto en español escrito dentro de un archivo de `src/app` (JSX, atributos visibles, frases en literales) en vez
// de salir de `src/lib/i18n/es/*`. La base `i18n-deuda.json` guarda cuántos hay POR ARCHIVO. La prueba falla si:
//   · un archivo tiene MÁS que su base (subir una deuda no se compensa con bajar otra);
//   · aparece un archivo nuevo con deuda (todo código nuevo nace con diccionario);
//   · un archivo de MIGRADOS (ya traducido por completo) vuelve a tener texto suelto.
//
// CÓMO BAJAR LA BASE al migrar una pantalla (nunca a mano hacia arriba):
//     I18N_DEUDA_REGENERAR=1 npx vitest run src/lib/i18n/i18n_deuda.test.ts --testTimeout=60000
// Solo escribe cifras MENORES O IGUALES a las que ya había (ni sube ni agrega archivos). Subir la base exige editar el JSON a
// mano y que alguien lo revise: es una decisión, no un accidente.
//
// Medida de referencia: `scratchpad/i18n/ast-conteo.cjs` (el plan). Este medidor cuenta solo lo que parece español, por archivo.
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = process.cwd();
const BASE = join(RAIZ, 'src/lib/i18n/i18n-deuda.json');
const ESCANEADO = 'src/app';

/** Archivos ya traducidos por completo: su deuda debe ser 0 y no pueden figurar en la base. */
const MIGRADOS = [
  'src/app/ui-v2/componentes/pie-sidebar.tsx',
  // P1 (F15): el marco del dashboard y de /admin y la pantalla de entrada.
  'src/app/dashboard/shell/sidebar-v2.tsx',
  'src/app/dashboard/shell/navegacion-v2.tsx',
  'src/app/dashboard/shell/barra-inferior.tsx',
  'src/app/dashboard/shell/hoja-mas.tsx',
  'src/app/dashboard/shell/menu-cuenta.tsx',
  'src/app/dashboard/shell/menu-guia.tsx',
  'src/app/dashboard/shell/capa-carga.tsx',
  'src/app/dashboard/shell/cabecera-escritorio.tsx',
  'src/app/dashboard/shell/cabecera-movil.tsx',
  'src/app/dashboard/shell/boton-buscar.tsx',
  'src/app/dashboard/shell/paleta.tsx',
  'src/app/dashboard/shell/saltar-contenido.tsx',
  'src/app/admin/chrome.tsx',
  'src/app/admin/sidebar-nav.tsx',
  'src/app/admin/cabecera-admin.tsx',
  'src/app/admin/navegacion-movil-admin.tsx',
  'src/app/admin/command-palette.tsx',
  'src/app/admin/salir-admin.tsx',
  'src/app/login/vista-login.tsx',
];

interface Base { version: 1; descripcion: string; archivos: Record<string, number> }

function archivos(dir: string, acc: string[] = []): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__fixtures__') continue;
      archivos(p, acc);
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) acc.push(p);
  }
  return acc;
}

// Descarta sin parsear lo que no tiene ni una pista de español (la mayoría de los archivos).
const PISTA = /[áéíóúñ¿¡]|\b(?:de|la|el|que|para|con|por|sin|no|en|se|los|las)\s/i;

function medirTodo(): Record<string, number> {
  const salida: Record<string, number> = {};
  for (const f of archivos(join(RAIZ, ESCANEADO))) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const codigo = readFileSync(f, 'utf8');
    if (!PISTA.test(codigo)) continue;
    const n = medirDeuda(codigo, f);
    if (n > 0) salida[relative(RAIZ, f).split(sep).join('/')] = n;
  }
  return salida;
}

function leerBase(): Base | null {
  return existsSync(BASE) ? (JSON.parse(readFileSync(BASE, 'utf8')) as Base) : null;
}

describe('el medidor de deuda', () => {
  it('cuenta JSX, atributos visibles y frases en español; ignora clases, imports, identificadores e inglés', () => {
    const codigo = [
      "import x from './no se cuenta aquí.ts';",
      "export const A = () => (<div className=\"flex items-center gap-2 de la\" data-x=\"sin texto\" title=\"Cerrar sesión\">",
      '  <p>No hay viajes para mostrar</p>',
      '  <span>{"Falta el RFC del emisor"}</span>',
      '  <b>OK</b><i>Loading the data</i>',
      "  <input placeholder={ok ? 'Escribe aquí' : 'Más información'} />",
      '</div>);',
      "const m = 'viaje_hito'; const e = 'The trip is closed';",
    ].join('\n');
    // title, <p>, <span>, y los dos placeholders = 5
    expect(medirDeuda(codigo)).toBe(5);
  });

  it('un texto no se cuenta dos veces (atributo visible con expresión adentro)', () => {
    expect(medirDeuda('const A = () => <X apoyo={`No se pudo leer ${n} filas`} />;')).toBe(1);
  });

  it('pareceEspanol: acento o varias palabras vacías; no un «no» suelto ni inglés', () => {
    expect(pareceEspanol('Cerrar sesión')).toBe(true);
    expect(pareceEspanol('Falta el RFC del emisor')).toBe(true);
    expect(pareceEspanol('no')).toBe(false);
    expect(pareceEspanol('Loading the data')).toBe(false);
    expect(pareceEspanol('flex items-center')).toBe(false);
  });
});

describe('la deuda de texto en español fuera de diccionario SOLO BAJA', () => {
  it('ningún archivo sube, ninguno nuevo aparece y los migrados están en 0', { timeout: 180_000 }, () => {
    const actual = medirTodo();
    const base = leerBase();

    if (process.env.I18N_DEUDA_REGENERAR === '1') {
      const previo = base?.archivos ?? null;
      const archivosNuevos: Record<string, number> = {};
      for (const [f, n] of Object.entries(actual)) {
        // Con base previa: nunca sube ni agrega. Sin base previa: es la primera medición.
        const tope = previo ? previo[f] : n;
        if (tope === undefined) continue;
        const v = Math.min(n, tope);
        if (v > 0) archivosNuevos[f] = v;
      }
      const ordenado = Object.fromEntries(Object.entries(archivosNuevos).sort(([a], [b]) => a.localeCompare(b)));
      const nuevaBase: Base = {
        version: 1,
        descripcion: 'Deuda i18n por archivo (textos en español fuera de diccionario en src/app). Solo baja. Regenerar: I18N_DEUDA_REGENERAR=1 npx vitest run src/lib/i18n/i18n_deuda.test.ts',
        archivos: ordenado,
      };
      writeFileSync(BASE, `${JSON.stringify(nuevaBase, null, 1)}\n`);
    }

    const vigente = leerBase();
    expect(vigente, 'falta src/lib/i18n/i18n-deuda.json (primera vez: I18N_DEUDA_REGENERAR=1)').not.toBeNull();
    const tope = vigente!.archivos;

    const suben = Object.entries(actual).filter(([f, n]) => f in tope && n > tope[f]).map(([f, n]) => `${f}: ${tope[f]} -> ${n}`);
    const nuevos = Object.entries(actual).filter(([f]) => !(f in tope)).map(([f, n]) => `${f}: ${n} texto(s) en español sin diccionario`);
    const migradosConDeuda = MIGRADOS.filter((f) => (actual[f] ?? 0) > 0 || f in tope).map((f) => `${f}: ${actual[f] ?? 0}`);

    expect(suben, 'estos archivos ahora tienen MÁS texto en español fuera de diccionario (muévelo a src/lib/i18n/es/*)').toEqual([]);
    expect(nuevos, 'archivo nuevo con texto en español fuera de diccionario (usa useT/getT con un namespace)').toEqual([]);
    expect(migradosConDeuda, 'archivo ya migrado con texto suelto').toEqual([]);
  });

  it('la base no guarda ceros ni cifras raras', () => {
    const base = leerBase();
    expect(base).not.toBeNull();
    for (const [f, n] of Object.entries(base!.archivos)) {
      expect(Number.isInteger(n) && n > 0, `${f}: ${n}`).toBe(true);
      expect(f.startsWith(`${ESCANEADO}/`), f).toBe(true);
    }
  });
});
