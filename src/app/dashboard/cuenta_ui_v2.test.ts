/* eslint-disable security/detect-non-literal-fs-filename -- lee el árbol de FUENTE del propio repo. */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { sinComentarios } from '@/lib/pruebas/codigo';

// FASE 11 · Cuenta: arranque, sesiones MCP, llaves de API, usuarios, soporte, configuración, onboarding, conexiones y mi perfil
// ya viven en el sistema único. Una pantalla que vuelva al kit viejo, a `.card` a mano, a `style=`,
// a una tabla escrita a mano o a un emoji rompe esta prueba.
const RAIZ = join(process.cwd(), 'src/app/dashboard');
const CARPETAS = ['arranque', 'sesiones-mcp'];

function fuentes(dir: string, salida: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const r = join(dir, n);
    if (statSync(r).isDirectory()) fuentes(r, salida);
    else if (/\.(tsx|ts)$/.test(n) && !/\.test\./.test(n)) salida.push(r);
  }
  return salida;
}
const archivos = CARPETAS.flatMap((c) => fuentes(join(RAIZ, c)));
const EMOJI = /\p{Extended_Pictographic}/u;

describe('cuenta sobre ui-v2', () => {
  it('hay archivos que revisar', () => { expect(archivos.length).toBeGreaterThan(3); });
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
