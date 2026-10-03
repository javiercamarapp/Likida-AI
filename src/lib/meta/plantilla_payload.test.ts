import { describe, it, expect } from 'vitest';
import {
  armarComponentesPlantilla, normalizarParametro, MAX_ENCABEZADO_TEXTO, MAX_PAYLOAD_BOTON,
  MAX_PARAMETRO_CUERPO, MAX_BOTONES_PLANTILLA,
} from './plantilla_payload';

// El contrato de Meta (ver la cabecera del módulo): header → body → botones.

function ok(op: Parameters<typeof armarComponentesPlantilla>[0]) {
  const r = armarComponentesPlantilla(op);
  if (!r.ok) throw new Error(`esperaba ok: ${r.error}`);
  return r.componentes;
}
function error(op: Parameters<typeof armarComponentesPlantilla>[0]) {
  const r = armarComponentesPlantilla(op);
  if (r.ok) throw new Error('esperaba error');
  return r.error;
}

describe('felices', () => {
  it('sin nada: components undefined (el payload de siempre no cambia de forma)', () => {
    expect(ok({})).toBeUndefined();
    expect(ok({ parametros: [], botones: [] })).toBeUndefined();
  });

  it('solo cuerpo: idéntico al formato histórico', () => {
    expect(ok({ parametros: ['Juan', 'F-1'] })).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: 'Juan' }, { type: 'text', text: 'F-1' }] },
    ]);
  });

  it('encabezado de texto', () => {
    expect(ok({ encabezado: { tipo: 'texto', texto: 'Aviso' } })).toEqual([
      { type: 'header', parameters: [{ type: 'text', text: 'Aviso' }] },
    ]);
  });

  it('encabezado de documento por link, con nombre de archivo', () => {
    expect(ok({ encabezado: { tipo: 'documento', link: 'https://x.test/liq.pdf', nombreArchivo: 'liquidacion-F1.pdf' } })).toEqual([
      { type: 'header', parameters: [{ type: 'document', document: { link: 'https://x.test/liq.pdf', filename: 'liquidacion-F1.pdf' } }] },
    ]);
  });

  it('encabezado de documento por media id, sin nombre', () => {
    expect(ok({ encabezado: { tipo: 'documento', id: '1234' } })).toEqual([
      { type: 'header', parameters: [{ type: 'document', document: { id: '1234' } }] },
    ]);
  });

  it('encabezado de imagen por link y por id', () => {
    expect(ok({ encabezado: { tipo: 'imagen', link: 'https://x.test/a.jpg' } })![0]).toEqual(
      { type: 'header', parameters: [{ type: 'image', image: { link: 'https://x.test/a.jpg' } }] });
    expect(ok({ encabezado: { tipo: 'imagen', id: '77' } })![0]).toEqual(
      { type: 'header', parameters: [{ type: 'image', image: { id: '77' } }] });
  });

  it('botones de respuesta rápida y URL, en orden de índice aunque se den desordenados', () => {
    const c = ok({
      botones: [
        { tipo: 'url', indice: 2, sufijo: 'abc123' },
        { tipo: 'respuesta_rapida', indice: 1, payload: 'no:v1' },
        { tipo: 'respuesta_rapida', indice: 0, payload: 'si:v1' },
      ],
    });
    expect(c).toEqual([
      { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: 'si:v1' }] },
      { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'no:v1' }] },
      { type: 'button', sub_type: 'url', index: '2', parameters: [{ type: 'text', text: 'abc123' }] },
    ]);
  });

  it('todo junto sale header, body, botones — en ese orden', () => {
    const c = ok({
      botones: [{ tipo: 'respuesta_rapida', indice: 0, payload: 'p' }],
      parametros: ['a'],
      encabezado: { tipo: 'texto', texto: 'h' },
    })!;
    expect(c.map((x) => x.type)).toEqual(['header', 'body', 'button']);
  });
});

describe('parámetros: lo que Meta rechaza (#132018) se normaliza o se detiene antes', () => {
  it('colapsa saltos de línea, tabuladores y espacios repetidos', () => {
    expect(normalizarParametro('a\nb\t\tc     d')).toBe('a b c d');
    expect(ok({ parametros: ['Ruta:\nGDL →   MTY'] })![0]).toEqual(
      { type: 'body', parameters: [{ type: 'text', text: 'Ruta: GDL → MTY' }] });
  });
  it('rechaza un parámetro vacío o solo espacios, diciendo cuál', () => {
    expect(error({ parametros: ['ok', '  \n '] })).toMatch(/\{\{2\}\}.*vacío/);
    expect(error({ parametros: [''] })).toMatch(/\{\{1\}\}/);
  });
  it('rechaza un parámetro de más de 1,024 caracteres', () => {
    expect(error({ parametros: ['x'.repeat(MAX_PARAMETRO_CUERPO + 1)] })).toMatch(/pasa de/);
    expect(ok({ parametros: ['x'.repeat(MAX_PARAMETRO_CUERPO)] })).toBeDefined();
  });
  it('entrada hostil: null/undefined/objetos no truenan, se rechazan como vacíos', () => {
    expect(error({ parametros: [undefined as unknown as string] })).toMatch(/vacío/);
    expect(error({ parametros: [null as unknown as string] })).toMatch(/vacío/);
  });
});

describe('encabezado: validaciones', () => {
  it('texto vacío o de más de 60', () => {
    expect(error({ encabezado: { tipo: 'texto', texto: ' ' } })).toMatch(/vacío/);
    expect(error({ encabezado: { tipo: 'texto', texto: 'x'.repeat(MAX_ENCABEZADO_TEXTO + 1) } })).toMatch(/60/);
  });
  it('medio: exactamente uno de link/id', () => {
    expect(error({ encabezado: { tipo: 'imagen' } as never })).toMatch(/exactamente uno/);
    expect(error({ encabezado: { tipo: 'documento', link: 'https://x.test/a.pdf', id: '1' } as never })).toMatch(/exactamente uno/);
  });
  it('el link debe ser https y URL válida', () => {
    expect(error({ encabezado: { tipo: 'imagen', link: 'http://x.test/a.jpg' } })).toMatch(/https/);
    expect(error({ encabezado: { tipo: 'imagen', link: 'no es url' } })).toMatch(/URL válida/);
    expect(error({ encabezado: { tipo: 'imagen', link: 'javascript:alert(1)' } })).toMatch(/https/);
  });
  it('nombre de archivo vacío o larguísimo', () => {
    expect(error({ encabezado: { tipo: 'documento', link: 'https://x.test/a.pdf', nombreArchivo: ' ' } })).toMatch(/nombre del archivo/);
    expect(error({ encabezado: { tipo: 'documento', link: 'https://x.test/a.pdf', nombreArchivo: 'a'.repeat(300) } })).toMatch(/nombre del archivo/);
  });
  it('un tipo desconocido no pasa', () => {
    expect(error({ encabezado: { tipo: 'video', link: 'https://x.test/v.mp4' } as never })).toMatch(/no soportado/);
  });
});

describe('botones: validaciones', () => {
  it('payload vacío o demasiado largo', () => {
    expect(error({ botones: [{ tipo: 'respuesta_rapida', indice: 0, payload: ' ' }] })).toMatch(/payload/);
    expect(error({ botones: [{ tipo: 'respuesta_rapida', indice: 0, payload: 'p'.repeat(MAX_PAYLOAD_BOTON + 1) }] })).toMatch(/pasa de/);
  });
  it('sufijo URL vacío, con espacios o gigante', () => {
    expect(error({ botones: [{ tipo: 'url', indice: 0, sufijo: '' }] })).toMatch(/sufijo/);
    expect(error({ botones: [{ tipo: 'url', indice: 0, sufijo: 'a b' }] })).toMatch(/espacios/);
    expect(error({ botones: [{ tipo: 'url', indice: 0, sufijo: 'a'.repeat(2001) }] })).toMatch(/largo/);
  });
  it('índice repetido, negativo, fuera de rango o no entero', () => {
    const b = (indice: number) => ({ tipo: 'respuesta_rapida' as const, indice, payload: 'p' });
    expect(error({ botones: [b(0), b(0)] })).toMatch(/repetido/);
    expect(error({ botones: [b(-1)] })).toMatch(/inválido/);
    expect(error({ botones: [b(MAX_BOTONES_PLANTILLA)] })).toMatch(/inválido/);
    expect(error({ botones: [b(1.5)] })).toMatch(/inválido/);
  });
  it('más de 10 botones', () => {
    const muchos = Array.from({ length: 11 }, (_, i) => ({ tipo: 'respuesta_rapida' as const, indice: i, payload: 'p' }));
    expect(error({ botones: muchos })).toMatch(/hasta 10/);
  });
  it('NO existe un botón de solicitud de ubicación en plantillas (la API no lo ofrece)', () => {
    expect(error({ botones: [{ tipo: 'location_request', indice: 0 } as never] })).toMatch(/no soportado/);
  });
});
