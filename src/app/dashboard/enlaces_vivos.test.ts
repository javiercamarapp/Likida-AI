import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// NINGÚN ENLACE DEL PANEL APUNTA A UNA PANTALLA QUE NO EXISTE (W2 «producto»).
//
// La auditoría de producto buscó «botones y flujos muertos» a mano. Esta prueba
// lo hace por el árbol: cada literal `/dashboard/<ruta>` del código de producción
// tiene que resolver a un `page.tsx` (o a un `route.ts`) real. Una pantalla que se
// borra (como las 17 de agosto) o un enlace con una errata dejan de ser un
// callejón silencioso para ser una prueba en rojo.
//
// Lo que NO hace: validar anclas (`#alta`) ni parámetros, ni enlaces armados con
// variables (`${ruta}`): de un prefijo `/dashboard/x/${id}` solo exige que `x`
// tenga una subruta dinámica.
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = join(process.cwd(), 'src');
const APP = join(RAIZ, 'app');

function recorrer(dir: string, salida: string[] = []): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- recorre el árbol de FUENTE del repo en tiempo de prueba; sin entrada de usuario.
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- ídem.
    if (statSync(p).isDirectory()) recorrer(p, salida);
    else salida.push(p);
  }
  return salida;
}

const archivos = recorrer(RAIZ);
const rutasApp = archivos
  .filter((f) => f.startsWith(APP) && /(?:^|[\\/])(page\.tsx|route\.ts)$/.test(f))
  .map((f) => '/' + relative(APP, f).split(sep).slice(0, -1).join('/'));

const comoRegex = (r: string) => new RegExp('^' + r.replace(/\[\.\.\.[^\]]+\]/g, '.+').replace(/\[[^\]]+\]/g, '[^/]+') + '/?$');
// `/dashboard/[id]` (el detalle de una liquidación) comparte nivel con las pantallas
// estáticas: dejarla casar haría que CUALQUIER `/dashboard/<errata>` pasara. Un
// literal de un solo nivel tiene que ser una pantalla estática; los uuid reales
// llegan por variables (`${id}`), no por literales.
const patrones = rutasApp.filter((r) => r !== '/dashboard/[id]').map(comoRegex);
const existe = (ruta: string) => patrones.some((p) => p.test(ruta));
const tieneHijaDinamica = (prefijo: string) => rutasApp.some((r) => r.startsWith(`${prefijo}/[`));

/** Enlaces que NO son pantallas, con su razón. Cada uno se justifica. */
const EXENTOS: Record<string, string> = {};

interface Hallazgo { archivo: string; ruta: string }

function enlacesRotos(): Hallazgo[] {
  const rotos: Hallazgo[] = [];
  for (const f of archivos) {
    if (!/\.(ts|tsx)$/.test(f) || /\.(test|fixture)\.tsx?$/.test(f)) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- ídem.
    const lineas = readFileSync(f, 'utf8').split('\n');
    for (const linea of lineas) {
      // Los comentarios documentan (a veces con rutas de ejemplo): no son enlaces.
      if (/^\s*(\/\/|\*|\/\*)/.test(linea)) continue;
      for (const m of linea.matchAll(/['"`](\/dashboard(?:\/[A-Za-z0-9_-]+)*)(\/\$\{)?/g)) {
        const ruta = m[1].replace(/\/$/, '') || '/dashboard';
        const dinamica = m[2] !== undefined;
        const ok = dinamica ? (existe(ruta) || tieneHijaDinamica(ruta)) : existe(ruta);
        if (!ok && !(ruta in EXENTOS)) rotos.push({ archivo: relative(RAIZ, f), ruta });
      }
    }
  }
  const vistos = new Set<string>();
  return rotos.filter((h) => { const k = `${h.archivo}|${h.ruta}`; if (vistos.has(k)) return false; vistos.add(k); return true; });
}

describe('los enlaces del panel', () => {
  it('hay rutas que escanear (si no, la prueba pasaría por vacío)', () => {
    expect(rutasApp.length).toBeGreaterThan(60);
    expect(existe('/dashboard/operadores')).toBe(true);
    expect(existe('/dashboard/patios')).toBe(true);
    expect(existe('/dashboard/ruta-que-no-existe')).toBe(false);
  });

  it('cada literal /dashboard/... del código de producción resuelve a una pantalla que existe', () => {
    const rotos = enlacesRotos();
    expect(
      rotos,
      `enlaces a pantallas que NO existen:\n  ${rotos.map((h) => `${h.archivo} → ${h.ruta}`).join('\n  ')}`,
    ).toEqual([]);
  });

  it('la prueba MUERDE: una ruta inventada se detecta como rota', () => {
    expect(existe('/dashboard/inventada/otra')).toBe(false);
    expect(tieneHijaDinamica('/dashboard/carta-porte/borrador')).toBe(true);
    expect(tieneHijaDinamica('/dashboard/operadores')).toBe(false);
  });
});
