import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SubirReferencia, type ResultadoReferencia } from './subir-referencia';

// ═══════════════════════════════════════════════════════════════════════════
// SUBIR PERSONAJE/LUGAR — el formulario trae los dos tipos del dominio
// (personaje/lugar, el mismo CHECK de la migración 0266), pide nombre y foto
// como obligatorios, y la etiqueta como libre-opcional — nunca al revés.
// ═══════════════════════════════════════════════════════════════════════════

const accionOk = async (_previo: ResultadoReferencia): Promise<ResultadoReferencia> => ({ ok: true });

describe('SubirReferencia — estado inicial honesto', () => {
  it('ofrece los dos tipos del dominio y ninguno más', () => {
    const html = renderToStaticMarkup(<SubirReferencia accion={accionOk} />);
    expect(html).toContain('Personaje');
    expect(html).toContain('Lugar');
  });

  it('nombre y foto son obligatorios; la etiqueta es libre', () => {
    const html = renderToStaticMarkup(<SubirReferencia accion={accionOk} />);
    // React reordena los atributos en el HTML servido (p.ej. `required` sale
    // ANTES que `name`), así que se aísla la ETIQUETA completa de cada
    // <input> en vez de buscar `required` en una ventana de texto contigua.
    const tags = html.match(/<input[^>]*>/g) ?? [];
    const tagDe = (name: string) => tags.find((t) => t.includes(`name="${name}"`));
    expect(tagDe('nombre')).toContain('required');
    expect(tagDe('foto')).toContain('required');
    expect(tagDe('etiqueta')).not.toContain('required');
  });

  it('el input de foto solo acepta el dominio de imagen de la migración 0266', () => {
    const html = renderToStaticMarkup(<SubirReferencia accion={accionOk} />);
    expect(html).toContain('image/jpeg,image/png,image/webp');
  });

  it('sin resultado todavía, no pinta ni error ni éxito', () => {
    const html = renderToStaticMarkup(<SubirReferencia accion={accionOk} />);
    expect(html).not.toContain('Guardado.');
  });
});
