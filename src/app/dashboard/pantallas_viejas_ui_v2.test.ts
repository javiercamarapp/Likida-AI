/* eslint-disable security/detect-non-literal-fs-filename -- lee el árbol de FUENTE del propio repo. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { sinComentarios } from '@/lib/pruebas/codigo';
import { medirDeuda } from '@/lib/i18n/deuda_medicion';

// W16 · las dos pantallas viejas que ve el cliente piloto: la bandeja de «Documentos de clientes» y el detalle de liquidación.
// Son fiscales y de dinero: ninguna vuelve al kit viejo, a `.card` a mano, a `style=`, a una tabla escrita a mano, a un emoji ni
// a un texto en español fuera del diccionario (es/en). La conducta (montos, estados, PDF, acciones y su puerta) la fijan
// `carta-porte/documentos/vista.test.tsx` y `[id]/detalle_conducta.test.tsx`.
const RAIZ = join(process.cwd(), 'src/app/dashboard');
const ARCHIVOS = [
  'carta-porte/documentos/vista.tsx',
  'carta-porte/documentos/forma_accion.tsx',
  '[id]/detalle.tsx',
  '[id]/vista.tsx',
  '[id]/revision-panel.tsx',
  '[id]/reasignar-forma.tsx',
  '[id]/page.tsx',
];
const EMOJI = /\p{Extended_Pictographic}/u;

describe('pantallas viejas migradas a ui-v2 (documentos de clientes y detalle de liquidación)', () => {
  for (const f of ARCHIVOS) {
    const bruto = readFileSync(join(RAIZ, f), 'utf8');
    const src = sinComentarios(bruto);
    it(`${relative(RAIZ, join(RAIZ, f))}: sin .card a mano, style=, <style>, kit viejo, <table> a mano ni emojis`, () => {
      expect(src, 'className="card"').not.toMatch(/className=["'`{][^"'`}]*\bcard\b/);
      expect(src, 'style={{').not.toMatch(/\bstyle=\{/);
      expect(src, '<style>').not.toMatch(/<style[\s>]/);
      expect(src, 'kit viejo').not.toMatch(/admin\/ui\/(kit|graficas|forma|confirmar|aviso)|StatusPill|TituloSeccion|BarraPagina|StatCard|KpiTile|ChartCard|charts['"]|from '\.\.\/(\.\.\/)?estados'|TituloRecuadro/);
      expect(src, '<table> a mano').not.toMatch(/<table[\s>]/);
      expect(EMOJI.test(bruto), 'emoji').toBe(false);
    });
    it(`${f}: no hay colores hex ni tamaños de letra fuera de la escala`, () => {
      expect(src, 'hex').not.toMatch(/#[0-9a-fA-F]{3,8}\b(?![\w-])/);
      // `ETIQUETA` (forma_accion) sirve a la pantalla de revisión de un documento, que aún no migra: su tamaño suelto es de esa pantalla.
      if (!f.endsWith('forma_accion.tsx')) expect(src, 'tamaño suelto').not.toMatch(/text-\[(1[0-9]|2[0-9])px\]/);
    });
    it(`${f}: ningún texto en español fuera del diccionario`, () => {
      // `page.tsx` conserva 1 texto heredado (la pista de `mensajeParaPantalla`): la base de la deuda i18n solo puede bajar.
      expect(medirDeuda(bruto, f)).toBeLessThanOrEqual(f === '[id]/page.tsx' ? 1 : 0);
    });
  }

  it('el detalle monta UN marco de pantalla y la bandeja también (un solo h1 lo pone MarcoPagina)', () => {
    for (const f of ['carta-porte/documentos/vista.tsx', '[id]/detalle.tsx']) {
      const src = sinComentarios(readFileSync(join(RAIZ, f), 'utf8'));
      expect(src, f).toMatch(/<(?:MarcoPagina|Esqueleto(?:TablaMaestra|PanelCifras|Ficha|Configuracion|Portada))[\s>]/);
      expect(src, f).not.toMatch(/<h1[\s>]/);
    }
  });

  it('lo destructivo pide una ventana del sistema que dice la consecuencia (quitar formato y rechazar liquidación)', () => {
    const doc = sinComentarios(readFileSync(join(RAIZ, 'carta-porte/documentos/vista.tsx'), 'utf8'));
    expect(doc).toMatch(/BotonEnvio variante="peligro"[\s\S]*?confirmar=\{\{/);
    const rev = sinComentarios(readFileSync(join(RAIZ, '[id]/revision-panel.tsx'), 'utf8'));
    expect(rev).toMatch(/<BotonConfirmar/);
  });
});
