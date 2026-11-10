/* eslint-disable security/detect-non-literal-fs-filename -- lee archivos del propio repo */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AGENTES, NEGOCIO, PLATAFORMA, CONTROL, SISTEMA, TODAS_LAS_RUTAS, entradaDeRuta, pestanaActiva } from './rutas';

// El menú de /admin pasó de 43 a 16 entradas SIN perder pantallas: cada página sigue siendo una ruta propia, agrupada como pestaña.
const ENTRADAS = [...AGENTES, ...NEGOCIO, ...PLATAFORMA, ...CONTROL, ...SISTEMA];
const paginaExiste = (href: string) => existsSync(join(__dirname, href.replace('/admin', '') || '', 'page.tsx')) || href === '/admin';

describe('menú de /admin agrupado en pestañas', () => {
  it('tiene 15 entradas más el Resumen (16 en el sidebar; antes 43)', () => { expect(ENTRADAS).toHaveLength(15); });

  it('conserva lo que el dueño pidió que se quede: Copiloto, Cerebro de ventas y los paneles de cada agente', () => {
    const todas = TODAS_LAS_RUTAS.map((r) => r.href);
    for (const h of ['/admin/copiloto', '/admin/mapa-prospectos', '/admin/agente-ocr', '/admin/agente-cuadre', '/admin/agente-whatsapp', '/admin/model-ops', '/admin/evals', '/admin/qa', '/admin/agentes']) {
      expect(todas, h).toContain(h);
    }
  });

  it('cada ruta del menú y de las pestañas es una página que existe (sin enlaces muertos)', () => {
    const rotas = TODAS_LAS_RUTAS.filter((r) => !paginaExiste(r.href)).map((r) => r.href);
    expect(rotas).toEqual([]);
  });

  it('ninguna ruta aparece en dos entradas distintas', () => {
    const vistas = new Map<string, string>();
    for (const it of ENTRADAS) {
      for (const h of new Set([it.href, ...(it.pestanas ?? []).map((p) => p.href)])) {
        expect(vistas.get(h), `${h} repetida`).toBeUndefined();
        vistas.set(h, it.nombre);
      }
    }
  });

  it('una ruta pertenece a su grupo aunque sea una pestaña o lleve parámetro', () => {
    expect(entradaDeRuta('/admin/agente-ocr')?.nombre).toBe('Agentes');
    expect(entradaDeRuta('/admin/qa/abc-123')?.nombre).toBe('Calidad');
    expect(entradaDeRuta('/admin/flotas/xyz')?.nombre).toBe('Clientes');
    expect(entradaDeRuta('/admin/mapa-prospectos')?.nombre).toBe('Ventas');
    expect(entradaDeRuta('/admin')).toBeNull();
    expect(entradaDeRuta('/admin/mi-perfil')).toBeNull();
  });

  it('la pestaña activa es la de href más largo que coincide', () => {
    const calidad = entradaDeRuta('/admin/qa/abc')!;
    expect(pestanaActiva(calidad, '/admin/qa/abc')?.nombre).toBe('Pruebas reales');
    expect(pestanaActiva(calidad, '/admin/evals')?.nombre).toBe('Exámenes');
  });

  it('cada pestaña tiene nombre corto y no se repite dentro de su grupo', () => {
    for (const it of ENTRADAS) {
      const nombres = (it.pestanas ?? []).map((p) => p.nombre);
      expect(new Set(nombres).size).toBe(nombres.length);
      for (const n of nombres) expect(n.length).toBeLessThanOrEqual(18);
    }
  });
});
