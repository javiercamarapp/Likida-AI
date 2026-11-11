/* eslint-disable security/detect-non-literal-fs-filename -- lee archivos del propio repo */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { entradaDeRuta, pestanaActiva } from './rutas';
import { REDIRECCIONES_308 } from './guardas/redirecciones_308';

// Fase 1: antes de dejar una pantalla como stub 308 se fija DÓNDE vive su función. Esta prueba pasa antes y después del retiro: lo que
// retiramos no tenía dinero, ARCO, seguridad, crons ni soporte; lo poco real que mostraba sigue en otro sitio.
const SRC = join(process.cwd(), 'src');
const ADMIN = join(SRC, 'app/admin');
const leer = (f: string) => readFileSync(join(ADMIN, f), 'utf8');
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('las 4 pantallas retiradas en la Fase 1 no pierden función', () => {
  it('Playground: lo que enseñaba (OCR, Cuadre, WhatsApp) son pestañas vivas de Agentes, y el destino existe', () => {
    for (const h of ['/admin/agente-ocr', '/admin/agente-cuadre', '/admin/agente-whatsapp']) {
      expect(entradaDeRuta(h)?.nombre, h).toBe('Agentes');
      expect(existsSync(join(ADMIN, h.replace('/admin/', ''), 'page.tsx')), h).toBe(true);
    }
    expect(entradaDeRuta('/admin/agentes')?.nombre).toBe('Agentes');
  });

  it('Comunicación: lo único que decía era "el contenido hacia afuera vive en el estudio de marketing" (Crecimiento › Estudio)', () => {
    const e = entradaDeRuta('/admin/marketing');
    expect(e?.nombre).toBe('Crecimiento');
    expect(pestanaActiva(e!, '/admin/marketing')?.nombre).toBe('Estudio');
  });

  it('Configuración: su único dato real, el plan de cada flota, se pinta en Clientes (flotas) y en el Resumen', () => {
    expect(sinComentarios(leer('flotas/page.tsx'))).toMatch(/\{f\.plan\}/);
    expect(sinComentarios(leer('consola.tsx'))).toMatch(/\{f\.plan\}/);
    expect(entradaDeRuta('/admin/flotas')?.nombre).toBe('Clientes');
  });

  it('Conocimiento / RAG: no había función (Likida no tiene RAG); nada del código depende de la pantalla', () => {
    expect(REDIRECCIONES_308['/admin/conocimiento-rag']).toBe('/admin');
  });

  it('ningún archivo del producto enlaza a las direcciones retiradas (solo el stub, el registro y las pruebas las nombran)', () => {
    const viejas = Object.keys(REDIRECCIONES_308).filter((d) => ['/admin/playground', '/admin/conocimiento-rag', '/admin/comunicacion', '/admin/configuracion'].includes(d));
    expect(viejas).toHaveLength(4);
    const archivos = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
      const r = join(dir, n);
      if (statSync(r).isDirectory()) return n === 'node_modules' ? [] : archivos(r);
      return /\.(tsx?|css)$/.test(n) && !/\.test\./.test(n) ? [r] : [];
    });
    const ofensores: string[] = [];
    for (const f of archivos(SRC)) {
      const rel = relative(SRC, f);
      if (viejas.some((v) => rel === `app${v}/page.tsx`) || rel === 'app/admin/guardas/redirecciones_308.ts') continue;
      const t = sinComentarios(readFileSync(f, 'utf8'));
      for (const v of viejas) if (new RegExp(`${v}(?![\\w-])`).test(t)) ofensores.push(`${rel} -> ${v}`);
    }
    expect(ofensores).toEqual([]);
  });
});
