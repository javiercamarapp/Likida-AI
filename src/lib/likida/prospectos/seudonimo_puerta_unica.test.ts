/* eslint-disable security/detect-non-literal-fs-filename --
 * Esta prueba ES un barrido del árbol de src/: lee archivos cuyo nombre sale
 * de readdirSync sobre nuestro propio repo, en tiempo de test, sin entrada
 * externa. El patrón es el mismo de qa-panel.test.ts (vigilancia por grep). */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// ═══════════════════════════════════════════════════════════════════════════
// LA PUERTA ÚNICA, VIGILADA CON GREP — auditoría 19, CRÍTICO (legal C2 / C.18).
//
// Dos veces se escapó un dato personal de prospecto hacia el modelo por el
// mismo agujero: primero el nombre del decisor (auditoría 18, C2 — se cerró
// con el marcador en el Cerebro), luego `prospecto.notas` cruda en el Redactor
// (seis pasadas de auditoría). El patrón del fallo fue siempre el mismo: la
// protección vivía pegada a UN llamador, y el llamador nuevo no la encontró.
//
// Esta prueba convierte la regla en código, al estilo de qa-panel.test.ts:
// recorre TODO src/, y a cada archivo que (a) llama al modelo y (b) lee
// `notas` de la tabla `prospecto`, le exige (1) importar la puerta única
// (`notasSinPersona` de lib/likida/prospectos/seudonimo) y (2) no interpolar
// las notas crudas en ningún template. Un agente futuro que se salte la
// puerta pone esta prueba en rojo ANTES de llegar a producción.
//
// La heurística es deliberadamente conservadora: puede dar un falso positivo
// (un archivo que lee notas y llama al modelo con OTRA cosa) y eso está bien
// — el costo de revisar un falso positivo es minutos; el de la fuga es un
// dato personal en un proveedor externo y una ronda más de auditoría.
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = join(__dirname, '..', '..', '..', '..');

/** Todos los .ts de src/, sin tests ni definiciones. */
function archivosTs(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) {
      if (nombre === 'node_modules') continue;
      salida.push(...archivosTs(ruta));
      continue;
    }
    if (!/\.tsx?$/.test(nombre)) continue;
    if (/\.test\.tsx?$|\.d\.ts$/.test(nombre)) continue;
    salida.push(ruta);
  }
  return salida;
}

const LLAMA_AL_MODELO = /\bgenerate(?:Structured|Response|WithTools|Text)\s*\(/;
/** Lee `notas` de la tabla prospecto: un select de `prospecto` cuya lista de
 *  columnas incluye `notas` (con o sin espacios, en cualquier posición). */
function leeNotasDeProspecto(fuente: string): boolean {
  if (!/\.from\(\s*['"]prospecto['"]\s*\)/.test(fuente)) return false;
  return /\.select\(\s*['"`][^'"`]*\bnotas\b[^'"`]*['"`]/.test(fuente);
}
/** Interpolación directa de notas en un template — el patrón exacto de la
 *  fuga de las seis pasadas (`${prospecto.notas...}`, `${p.notas...}`). */
const NOTAS_CRUDAS_EN_TEMPLATE = /\$\{\s*\w+\.notas\b/;

/**
 * Exentos SOLO de la exigencia de importar la puerta — MEDIDOS uno por uno:
 *
 * · investigador.ts: lee `notas` y llama al modelo, pero las notas NUNCA
 *   entran a su prompt (verificado 28-ago-2026: el `messages` lleva solo
 *   `prospecto.empresa` + el texto de las páginas públicas del sitio; las
 *   notas se usan LOCALMENTE en `cosecharCorreosDeNotas` y
 *   `correosVerificados`, que no salen del proceso). El candado de
 *   interpolación cruda (`${*.notas}`) le sigue aplicando: si algún día sus
 *   notas entran a un template, esta prueba truena igual.
 *
 * Añadir un archivo aquí exige repetir esa medición y escribirla — un
 * renglón sin medición en este arreglo es exactamente el agujero que esta
 * prueba existe para cerrar.
 */
const EXENTOS_DE_IMPORTAR = ['/src/lib/likida/agentes/investigador.ts'];

describe('la puerta única de datos de prospecto hacia el modelo', () => {
  const archivos = archivosTs(join(RAIZ, 'src'));

  it('encuentra a los dos llamadores conocidos (si esto falla, la heurística se quedó ciega)', () => {
    // El autotest de la vigilancia: si un refactor mueve o renombra a los dos
    // consumidores conocidos y esta lista queda vacía, la prueba estaría
    // "pasando" por no vigilar nada. Se exige encontrarlos.
    const vigilados = archivos.filter((r) => {
      const f = readFileSync(r, 'utf8');
      return LLAMA_AL_MODELO.test(f) && leeNotasDeProspecto(f);
    });
    const nombres = vigilados.map((r) => r.replace(RAIZ, ''));
    expect(nombres.some((n) => n.includes('redactor'))).toBe(true);
  });

  it('todo archivo que llama al modelo y lee prospecto.notas importa la puerta y no interpola las notas crudas', () => {
    const violaciones: string[] = [];
    for (const ruta of archivos) {
      const fuente = readFileSync(ruta, 'utf8');
      if (!LLAMA_AL_MODELO.test(fuente) || !leeNotasDeProspecto(fuente)) continue;
      const importaPuerta = /from\s+['"](?:@\/lib\/likida\/prospectos\/seudonimo|\.{1,2}\/(?:\.\.\/)*(?:likida\/)?prospectos\/seudonimo)['"]/.test(fuente)
        && /\bnotasSinPersona\b/.test(fuente);
      const exento = EXENTOS_DE_IMPORTAR.some((e) => ruta.replace(RAIZ, '') === e);
      if (!importaPuerta && !exento) {
        violaciones.push(`${ruta.replace(RAIZ, '')}: llama al modelo y lee prospecto.notas SIN importar notasSinPersona de lib/likida/prospectos/seudonimo`);
      }
      if (NOTAS_CRUDAS_EN_TEMPLATE.test(fuente)) {
        violaciones.push(`${ruta.replace(RAIZ, '')}: interpola \${*.notas} crudo en un template — las notas tienen que pasar por notasSinPersona ANTES`);
      }
    }
    expect(violaciones, violaciones.join('\n')).toEqual([]);
  });

  it('la puerta se define UNA sola vez (dos definiciones vuelven a ser dos criterios)', () => {
    const definiciones = archivos.filter((r) => /export function notasSinPersona\b/.test(readFileSync(r, 'utf8')));
    expect(definiciones.map((r) => r.replace(RAIZ, ''))).toEqual(['/src/lib/likida/prospectos/seudonimo.ts']);
  });
});
