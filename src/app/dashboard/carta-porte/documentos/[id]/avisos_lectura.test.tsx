import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AvisosLectura } from './avisos_lectura';
import type { MetaExtraccion } from '@/lib/likida/carta_porte_docs/repo';

const base = (extra: Partial<MetaExtraccion> = {}): MetaExtraccion => ({
  origen: 'llm', nivel: 1, escalamientos: [], avisos: [], notasModelo: [], indiciosInyeccion: [], ...extra,
});

describe('A37-A3-03: los avisos de la lectura se MUESTRAN en la revisión', () => {
  it('sin avisos, notas ni revisión humana no pinta nada', () => {
    expect(renderToStaticMarkup(<AvisosLectura meta={base()} />)).toBe('');
    expect(renderToStaticMarkup(<AvisosLectura meta={undefined} />)).toBe('');
  });

  it('muestra los avisos de recorte, las notas del modelo y la revisión humana', () => {
    const html = renderToStaticMarkup(<AvisosLectura meta={base({
      avisos: ['El PDF tiene 25 páginas; se leyeron las primeras 20.'],
      notasModelo: ['No pude leer el peso de la última fila.'],
      revisionHumana: [{ campo: 'destino_cp', renglon: null, codigo: 'desacuerdo', motivo: 'Los niveles discreparon.', valores: ['06600', 'NLE'] }],
    })} />);
    expect(html).toContain('25 páginas');
    expect(html).toContain('No pude leer el peso de la última fila.');
    expect(html).toContain('Los niveles discreparon.');
    expect(html).toContain('«06600»');
  });

  it('lo que la lectura dejó fuera sale como «No se leyó completo» (embarques perdidos)', () => {
    const m = 'El archivo trae 12 embarques pero se leyó el primero.';
    const html = renderToStaticMarkup(<AvisosLectura meta={base({ avisos: [m], lecturaIncompleta: [{ mensaje: m, bloquea: true }] })} />);
    expect(html).toContain('No se leyó completo');
    expect(html.split(m).length - 1).toBe(1);
  });

  it('el texto del modelo se escapa (no inyecta HTML)', () => {
    const html = renderToStaticMarkup(<AvisosLectura meta={base({ notasModelo: ['<img src=x onerror=alert(1)>'] })} />);
    expect(html).not.toContain('<img');
  });
});
