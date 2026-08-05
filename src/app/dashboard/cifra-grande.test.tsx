import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CifraGrande from './cifra-grande';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10, MEDIO — "la cifra de cabecera del panel del dueño sale en
// blanco hasta hidratar". El HTML servido SÍ traía el valor real (gracias al
// arreglo de `useCountUp`, auditoría 10 ALTO), pero vivía con `opacity:0`
// hasta que `useInView` confirmara del lado del cliente que el elemento
// estaba en pantalla — y esta cifra vive en el encabezado FIJO, siempre
// visible, así que ese fundido nunca tenía nada que detectar. Mismo
// mecanismo de prueba que `kit.test.tsx`: `renderToStaticMarkup`, el HTML
// que ve un navegador con JS lento, roto o bloqueado.
// ═══════════════════════════════════════════════════════════════════════════

describe('CifraGrande — el HTML servido (antes de hidratar)', () => {
  it('la cifra real NO sale con opacity:0 en el HTML servido', () => {
    const html = renderToStaticMarkup(
      <CifraGrande valor={1234567.89} etiqueta="Señalado por el motor" formato="mxn" />,
    );
    expect(html).not.toMatch(/opacity:\s*0(?!\.\d)/);
  });

  it('el valor servido es la cifra real, no un hueco esperando a React', () => {
    const html = renderToStaticMarkup(
      <CifraGrande valor={1234567.89} etiqueta="Señalado por el motor" formato="mxn" />,
    );
    expect(html).toContain('$1,234,567.89');
  });

  it('un valor que de verdad es cero sí se sirve como "$0.00"', () => {
    const html = renderToStaticMarkup(
      <CifraGrande valor={0} etiqueta="Señalado por el motor" formato="mxn" />,
    );
    expect(html).toContain('$0.00');
  });
});
