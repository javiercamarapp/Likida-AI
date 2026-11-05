import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
/* eslint-disable security/detect-non-literal-fs-filename -- recorre el código fuente del propio repo; las rutas salen de readdirSync, no de una entrada externa */
import { rutaPermitidaEnPerfil, RUTAS_STAND_BY_PERFIL_CINCO_AGENTES, claveRutaPerfil } from '@/lib/auth/visibilidad';

// ═══════════════════════════════════════════════════════════════════════════
// PT-07 / CT-A345-26 (F2): desde las pantallas de A1 Liquidación y A2 Peajes no sale ningún enlace
// a una ruta que el perfil `cinco_agentes` deja en stand-by (rebotaría al Resumen sin explicación).
//
// Estática a propósito: recorre el código fuente de las dos áreas y de las pantallas que cuelgan de
// ellas. Un enlace a una ruta fuera de la lista cerrada del perfil solo se admite si lo protege, en
// las 15 líneas anteriores (o en la misma), una compuerta de perfil: `puedeVerRuta(...)`,
// `puedeVer…` o `superficie.…`. Es la prueba que exige PT-07 («0 enlaces a rutas stand-by desde A1/A2»).
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = process.cwd();
const AREAS = [
  'src/app/dashboard/agentes/liquidacion',
  'src/app/dashboard/agentes/peajes',
  'src/app/dashboard/[id]',
  'src/lib/likida/liquidacion_externa',
  'src/lib/likida/peajes',
];

function archivos(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) { salida.push(...archivos(ruta)); continue; }
    if (/\.(ts|tsx)$/.test(nombre) && !/\.test\./.test(nombre)) salida.push(ruta);
  }
  return salida;
}

const COMPUERTA = /puedeVerRuta|puedeVer[A-Z]\w*|superficie\.\w+/;
const ENLACE = /[`'"](\/dashboard\/[A-Za-z0-9_\-/]*)(\$\{)?/g;

interface Hallazgo { archivo: string; linea: number; ruta: string }

function enlacesSinCompuerta(): { todos: number; sueltos: Hallazgo[] } {
  const sueltos: Hallazgo[] = [];
  let todos = 0;
  for (const area of AREAS) {
    for (const archivo of archivos(join(RAIZ, area))) {
      const lineas = readFileSync(archivo, 'utf8').split('\n');
      lineas.forEach((texto, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(texto)) return; // comentarios
        for (const m of texto.matchAll(ENLACE)) {
          todos++;
          // `/dashboard/${id}` es el detalle de una liquidación: se pliega a `[id]`.
          const ruta = m[2] ? '/dashboard/[id]' : claveRutaPerfil(m[1]);
          if (rutaPermitidaEnPerfil('cinco_agentes', ruta)) continue;
          const ventana = lineas.slice(Math.max(0, i - 15), i + 1).join('\n');
          if (COMPUERTA.test(ventana)) continue;
          sueltos.push({ archivo: relative(RAIZ, archivo), linea: i + 1, ruta });
        }
      });
    }
  }
  return { todos, sueltos };
}

describe('PT-07 — A1 y A2 no enlazan a rutas en stand-by del perfil cinco_agentes', () => {
  it('el recorrido sí ve enlaces (la prueba no pasa en vacío)', () => {
    expect(enlacesSinCompuerta().todos).toBeGreaterThan(20);
  });

  it('0 enlaces a rutas fuera de la lista cerrada del perfil sin una compuerta de perfil al lado', () => {
    const { sueltos } = enlacesSinCompuerta();
    expect(sueltos.map((h) => `${h.archivo}:${h.linea} → ${h.ruta}`)).toEqual([]);
  });

  it('el detector sí atrapa un enlace a stand-by (control negativo)', () => {
    // `/dashboard/combustible-casetas` es stand-by del perfil: sin compuerta, el recorrido lo marcaría.
    expect(RUTAS_STAND_BY_PERFIL_CINCO_AGENTES).toContain('/dashboard/combustible-casetas');
    expect(rutaPermitidaEnPerfil('cinco_agentes', '/dashboard/combustible-casetas')).toBe(false);
    expect(COMPUERTA.test('{superficie.cfdiYTickets && (')).toBe(true);
    expect(COMPUERTA.test('<Link href={`/dashboard/combustible-casetas`}')).toBe(false);
  });
});
