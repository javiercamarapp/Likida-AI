/* eslint-disable security/detect-non-literal-fs-filename -- lee el árbol de FUENTE del propio repo. */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { sinComentarios } from '@/lib/pruebas/codigo';

// FASE 9 · P-DAS-DIN: lo fiscal y de dinero que ya vive en el sistema único (arco, legal, politicas, rentabilidad, cotizaciones, combustible-casetas, reglas,
// suscripcion, contador, timbrado, descarga-sat y la lista de carta-porte). Pendiente de migrar: facturacion y carta-porte/documentos y borrador. Una pantalla que vuelva al kit viejo, a `.card` a mano, a `style=`,
// a una tabla escrita a mano o a un emoji rompe esta prueba.
const RAIZ = join(process.cwd(), 'src/app/dashboard');
const CARPETAS = ['arco', 'legal', 'politicas', 'rentabilidad', 'cotizaciones', 'combustible-casetas', 'reglas', 'suscripcion', 'contador', 'timbrado', 'descarga-sat'];
const SUELTOS = ['carta-porte/vista.tsx', 'carta-porte/forma.tsx', 'carta-porte/page.tsx'];

function fuentes(dir: string, salida: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const r = join(dir, n);
    if (statSync(r).isDirectory()) fuentes(r, salida);
    else if (/\.(tsx|ts)$/.test(n) && !/\.test\./.test(n)) salida.push(r);
  }
  return salida;
}
const archivos = [...CARPETAS.flatMap((c) => fuentes(join(RAIZ, c))), ...SUELTOS.map((f) => join(RAIZ, f))];
const EMOJI = /\p{Extended_Pictographic}/u;

describe('dinero y fiscal sobre ui-v2', () => {
  it('hay archivos que revisar', () => { expect(archivos.length).toBeGreaterThan(30); });
  for (const f of archivos) {
    const rel = relative(RAIZ, f);
    it(`${rel}: sin .card a mano, style=, <style>, kit viejo, <table> a mano ni emojis`, () => {
      const src = sinComentarios(readFileSync(f, 'utf8'));
      expect(src, 'className="card"').not.toMatch(/className=["'`{][^"'`}]*\bcard\b/);
      expect(src, 'style={{').not.toMatch(/\bstyle=\{/);
      expect(src, '<style>').not.toMatch(/<style[\s>]/);
      expect(src, 'kit viejo').not.toMatch(/admin\/ui\/(kit|graficas)|StatusPill|TituloSeccion|BarraPagina|StatCard|KpiTile|ChartCard|charts['"]|from '\.\.\/estados'|TituloRecuadro/);
      expect(src, '<table> a mano').not.toMatch(/<table[\s>]/);
      expect(EMOJI.test(readFileSync(f, 'utf8')), 'emoji').toBe(false);
    });
  }
});
