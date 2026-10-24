import { describe, expect, it } from 'vitest';
import { ETIQUETA_HTML, MAX_CHARS_HTML, quitarScriptYEstilo } from './html_quitar';
import { htmlATexto } from './contenido';

describe('quitarScriptYEstilo · tiempo lineal (A37-S31-04)', () => {
  it('quita los bloques cerrados (mayúsculas incluidas) y conserva el resto', () => {
    expect(quitarScriptYEstilo('a<script>x()</script>b<STYLE>p{}</STYLE>c')).toBe('a b c');
    expect(quitarScriptYEstilo('sin etiquetas')).toBe('sin etiquetas');
  });

  it('una apertura sin cierre se deja tal cual (igual que la expresión anterior) y no traga el resto', () => {
    expect(quitarScriptYEstilo('a<script>x b<style>q</style> c')).toBe('a<script>x b  c');
  });

  it('250,000 «<script » sin cierre se procesan en milisegundos (la expresión anterior era cuadrática)', () => {
    const html = '<script '.repeat(250_000);
    const t = Date.now();
    const r = htmlATexto(html);
    expect(Date.now() - t).toBeLessThan(1500);
    expect(typeof r).toBe('string');
  });

  it('muchos «<» sueltos sin «>» tampoco son cuadráticos y las etiquetas normales siguen cayendo', () => {
    const t = Date.now();
    const r = htmlATexto(`${'<'.repeat(300_000)}<p>hola</p>`);
    expect(Date.now() - t).toBeLessThan(1500);
    expect(r).toContain('hola');
    expect('x <b>y</b>'.replace(ETIQUETA_HTML, '')).toBe('x y');
  });

  it('recorta la entrada desmesurada antes de procesarla', () => {
    expect(quitarScriptYEstilo('a'.repeat(MAX_CHARS_HTML + 10)).length).toBe(MAX_CHARS_HTML);
  });
});
