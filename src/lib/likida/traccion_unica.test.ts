import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TRACCION_PUBLICABLE, NOMBRES_TRACCION_CAZADOS, nombreTraccionNoAutorizado, FRASE_TRACCION } from './traccion';
import { verificarFormatoCampana } from './agentes/cola';
import { revisarReglasEditoriales, ARTICULOS } from './marketing/articulos';
import { guardarBorrador } from './agentes/contenido';

// A37-S26-06: UNA sola fuente de nombres de tracción autorizados. Las plantillas,
// el prompt del redactor y las guardias de salida la leen; ninguna puede instruir
// a nombrar a un tercero que la puerta de salida veta.
const raiz = join(__dirname, '..', '..', '..');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- rutas fijas del propio repo, sin entrada de usuario.
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8');

describe('A37-S26-06: la tracción tiene una sola fuente', () => {
  it('la frase de la casa no nombra a nadie mientras TRACCION_PUBLICABLE esté vacía', () => {
    expect(TRACCION_PUBLICABLE).toHaveLength(0);
    expect(FRASE_TRACCION).toBe('en pláticas con transportistas');
    for (const n of NOMBRES_TRACCION_CAZADOS) expect(FRASE_TRACCION).not.toContain(n);
  });

  it('el prompt del redactor, el parte de alianzas y los artículos NO instruyen a nombrar al prospecto', () => {
    for (const f of ['src/lib/likida/agentes/contenido.ts', 'src/lib/likida/agentes/crecimiento.ts', 'src/lib/likida/marketing/articulos.ts']) {
      const fuente = leer(f);
      for (const n of NOMBRES_TRACCION_CAZADOS) {
        // los comentarios que explican el hallazgo no cuentan: solo texto que sale
        const salida = fuente.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
        expect(salida, `${f} nombra "${n}"`).not.toContain(n);
      }
    }
    for (const a of ARTICULOS) {
      const t = JSON.stringify(a);
      for (const n of NOMBRES_TRACCION_CAZADOS) expect(t, a.slug).not.toContain(n);
    }
  });

  it('la guardia editorial de contenido veta el nombre aunque venga con «en pláticas»', () => {
    const faltas = revisarReglasEditoriales('Estamos en pláticas con transportistas como Grupo GAL.');
    expect(faltas.join(' ')).toMatch(/GAL/);
    expect(guardarBorrador('Estamos en pláticas con transportistas como Grupo GAL.', [], '').texto).toBeNull();
  });

  it('el correo y el contenido coinciden: lo que uno veta, el otro también', () => {
    for (const n of NOMBRES_TRACCION_CAZADOS) {
      const txt = `Hablamos con ${n} en pláticas.`;
      expect(nombreTraccionNoAutorizado(txt)).toBe(n);
      expect(() => verificarFormatoCampana(txt)).toThrow(/tracción/);
      expect(revisarReglasEditoriales(txt).length).toBeGreaterThan(0);
    }
  });
});
