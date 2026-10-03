import { describe, it, expect } from 'vitest';
import { esperarResultado } from './pasos';
import type { PaginaPortal } from './playwright_base';

// `buscar.esperar` apuntaba en 5 guiones a CAMPOS que aparecen tras buscar. Un <input> no tiene textContent: esperarTexto
// los declaraba «siguió VACÍO». esperarResultado acepta un control presente, y sigue rechazando un contenedor de TEXTO vacío.

const op = (t = { v: 0 }) => ({ topeMs: 300, intervaloMs: 100, dormir: async (ms: number) => { t.v += ms; }, ahora: () => t.v });
const pagina = (texto: string | null, esControl?: boolean): PaginaPortal => ({
  abrir: async () => {}, escribir: async () => {}, hacerClic: async () => {}, captura: async () => 'x',
  leerTexto: async () => texto,
  ...(esControl === undefined ? {} : { esControl: async () => esControl }),
});

describe('esperarResultado', () => {
  it('texto no vacío: apareció', async () => {
    expect(await esperarResultado(pagina('Razón social'), '#x', op())).toEqual({ valor: 'Razón social', aparecio: true });
  });
  it('un control de formulario presente (textContent vacío) cuenta como aparecido', async () => {
    expect(await esperarResultado(pagina('', true), '#x', op())).toMatchObject({ aparecio: true, valor: '(campo presente)' });
  });
  it('un contenedor de TEXTO vacío (pre-pintado) NO cuenta: sigue siendo «no llegó»', async () => {
    expect(await esperarResultado(pagina('', false), '#x', op())).toEqual({ valor: null, aparecio: true });
  });
  it('sin la capacidad esControl el comportamiento es el de siempre', async () => {
    expect(await esperarResultado(pagina(''), '#x', op())).toEqual({ valor: null, aparecio: true });
  });
  it('no existe: no apareció', async () => {
    expect(await esperarResultado(pagina(null), '#x', op())).toEqual({ valor: null, aparecio: false });
  });
});
