/* eslint-disable security/detect-non-literal-fs-filename -- recorre el propio árbol de src */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hrefsDelMenu, menuPorPerfil } from '@/app/dashboard/shell/menu-por-perfil';
import { ANCLAS_DERIVADAS, anclaNav } from './anclas';
import { ANCLA_BLOQUE, ANCLA_TITULO, PANTALLAS } from './pantallas';
import { AGENTES, construirRecorridoAgente } from './agentes';
import { construirRecorrido } from './tour';
import { ROLES_MATRIZ } from './cobertura';

const SRC = join(process.cwd(), 'src');
function codigo(dir: string, salida: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const r = join(dir, n);
    if (statSync(r).isDirectory()) { if (n !== 'node_modules') codigo(r, salida); continue; }
    if (/\.(tsx|ts)$/.test(n) && !/\.test\./.test(n)) salida.push(r);
  }
  return salida;
}
const FUENTE = codigo(join(SRC, 'app')).map((f) => readFileSync(f, 'utf8')).join('\n');

/** ¿Hay en el marcado un elemento con esa ancla? (literal en el código de la pantalla). */
function existeEnMarcado(ancla: string): boolean {
  const q = ancla.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`data-(onboarding|tour)=["'{]+\`?["']?${q}["'\`}]|ancla(Tour|Onboarding)\\(\\s*['"\`]${q}['"\`]`).test(FUENTE);
}

describe('anclas del recorrido', () => {
  it('las dos anclas universales existen: el encabezado de toda pantalla y la estructura del primer bloque', () => {
    expect(existeEnMarcado(ANCLA_TITULO)).toBe(true);
    expect(Object.keys(ANCLAS_DERIVADAS)).toContain(ANCLA_BLOQUE);
    const marco = readFileSync(join(SRC, 'app/ui-v2/componentes/marco-pagina.tsx'), 'utf8');
    expect(marco).toContain('rv-marco');
    expect(readFileSync(join(SRC, 'app/ui-v2/componentes/encabezado-pagina.tsx'), 'utf8')).toContain('rv-encabezado');
  });

  it('el ítem del menú de cada pantalla lleva su ancla nav-<ruta> (mismo cálculo que el menú)', () => {
    expect(FUENTE).toMatch(/data-tour=\{`nav-\$\{anclaDe\(item\.href\)\}`\}/);
    expect(FUENTE).toMatch(/data-tour=\{`nav-\$\{anclaDe\(it\.href\)\}`\}/);
    expect(FUENTE).toContain('data-tour="nav-notificaciones"');
  });

  it('cada ancla que cita un paso (recorridos de rol y de agente) existe en el marcado', () => {
    const citadas = new Set<string>();
    for (const perfil of [null, 'cinco_agentes'] as const) for (const rol of ROLES_MATRIZ) {
      for (const modo of ['corto', 'completo'] as const) for (const p of construirRecorrido(rol, perfil, modo)?.pasos ?? []) if (p.ancla) citadas.add(p.ancla);
      for (const ag of AGENTES) for (const p of construirRecorridoAgente(ag, rol, perfil)?.pasos ?? []) if (p.ancla) citadas.add(p.ancla);
    }
    const menus = new Set<string>();
    for (const perfil of [null, 'cinco_agentes'] as const) for (const rol of ROLES_MATRIZ) for (const h of hrefsDelMenu(menuPorPerfil(rol, perfil))) menus.add(anclaNav(h));
    const faltan = [...citadas].filter((a) => !(a.startsWith('nav-') ? menus.has(a) : Object.hasOwn(ANCLAS_DERIVADAS, a) || existeEnMarcado(a)));
    expect(faltan).toEqual([]);
  });

  it('las anclas propias de cada pantalla del catálogo existen', () => {
    const faltan: string[] = [];
    for (const [ruta, d] of Object.entries(PANTALLAS)) {
      for (const a of [d.clave.ancla, d.accion?.ancla]) if (a && !Object.hasOwn(ANCLAS_DERIVADAS, a) && !existeEnMarcado(a)) faltan.push(`${ruta}: ${a}`);
    }
    expect(faltan).toEqual([]);
  });

  it('el ancla de CADA pantalla vive en el archivo de SU pantalla: encabezado compartido (MarcoPagina/EncabezadoPagina) y anclas propias', () => {
    const DASH = join(SRC, 'app/dashboard');
    const archivosDe = (ruta: string): string[] => {
      const rel = ruta.replace(/^\/dashboard\/?/, '');
      if (rel === '') return readdirSync(DASH).filter((n) => /\.tsx$/.test(n) && !/\.test\./.test(n)).map((n) => join(DASH, n));
      const dir = join(DASH, rel);
      return existsSync(dir) ? codigo(dir) : [];
    };
    const sinEncabezado: string[] = [];
    const faltan: string[] = [];
    for (const [ruta, d] of Object.entries(PANTALLAS)) {
      const texto = archivosDe(ruta).map((f) => readFileSync(f, 'utf8')).join('\n');
      if (!/MarcoPagina|EncabezadoPagina/.test(texto)) {
        sinEncabezado.push(ruta);
        // Sin el encabezado compartido, la pantalla pone el ancla de título en su propio encabezado.
        if (!/data-onboarding="pantalla\.titulo"/.test(texto)) faltan.push(`${ruta}: pantalla.titulo propio`);
      }
      for (const a of [d.clave.ancla, d.accion?.ancla]) {
        if (!a || Object.hasOwn(ANCLAS_DERIVADAS, a) || a === ANCLA_TITULO) continue;
        const q = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (!new RegExp(`['"\`]${q}['"\`]`).test(texto)) faltan.push(`${ruta}: ${a}`);
      }
    }
    expect(faltan).toEqual([]);
    expect(sinEncabezado).toEqual(SIN_ENCABEZADO_COMPARTIDO);
  });
});

/** Pantallas del menú que NO usan el encabezado compartido: su paso «qué es» degrada (ancla ausente) en vez de resaltar el título. */
const SIN_ENCABEZADO_COMPARTIDO: string[] = ['/dashboard/chat', '/dashboard/onboarding'];
