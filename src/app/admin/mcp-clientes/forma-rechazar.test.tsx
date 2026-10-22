import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FormaRechazarCliente } from './forma-rechazar';

// HALLAZGO ALTO #2 (auditoría adversarial): "Rechazar" revocaba EN EL ACTO
// todos los tokens OAuth vivos del cliente MCP, con un solo clic y CERO
// diálogo. Se mide aquí lo mismo que `admin/ui/confirmar.test.tsx` mide para
// el primitivo genérico, pero contra ESTA pantalla: que el disparador visible
// no envía nada por sí solo y que el id del cliente viaja en el formulario
// real que sí se envía al confirmar.

const nada = async () => null;

describe('FormaRechazarCliente', () => {
  it('el disparador es type="button" (no envía) — un clic solo no revoca nada', () => {
    const html = renderToStaticMarkup(<FormaRechazarCliente accion={nada} clientId="cliente-1" nombre="Tablero de Tableau" tokensVivos={3} />);
    expect(html).toMatch(/<button type="button"[^>]*>Rechazar<\/button>/);
  });

  it('el diálogo nombra al cliente y dice que la revocación es irreversible y en el acto', () => {
    const html = renderToStaticMarkup(<FormaRechazarCliente accion={nada} clientId="cliente-1" nombre="Tablero de Tableau" tokensVivos={3} />);
    expect(html).toContain('<dialog');
    expect(html).toContain('Rechazar a Tablero de Tableau');
    expect(html).toMatch(/revoca en el acto los 3 tokens oauth vivos/i);
    expect(html).toMatch(/irreversible/i);
  });

  it('HALLAZGO ALTO #1: el diálogo dice EXPLÍCITAMENTE cuántos tokens vivos se van a revocar, no "todos" sin cifra', () => {
    const html = renderToStaticMarkup(<FormaRechazarCliente accion={nada} clientId="cliente-1" nombre="X" tokensVivos={7} />);
    expect(html).toMatch(/revoca en el acto los 7 tokens oauth vivos/i);
    expect(html).not.toMatch(/revoca en el acto todos los tokens/i);
  });

  it('un solo token vivo usa singular, no "los 1 tokens"', () => {
    const html = renderToStaticMarkup(<FormaRechazarCliente accion={nada} clientId="cliente-1" nombre="X" tokensVivos={1} />);
    expect(html).toMatch(/revoca en el acto el único token oauth vivo/i);
    expect(html).not.toMatch(/los 1 tokens/i);
  });

  it('cero tokens vivos lo dice explícito, no silencia la cifra', () => {
    const html = renderToStaticMarkup(<FormaRechazarCliente accion={nada} clientId="cliente-1" nombre="X" tokensVivos={0} />);
    expect(html).toMatch(/no tiene ningún token oauth vivo/i);
    expect(html).not.toMatch(/revoca en el acto/i);
  });

  it('el botón que SÍ envía (dentro del diálogo) es type="submit", y el id del cliente viaja oculto en el mismo formulario', () => {
    const html = renderToStaticMarkup(<FormaRechazarCliente accion={nada} clientId="cliente-77" nombre="Otro cliente" tokensVivos={2} />);
    expect(html).toMatch(/<button type="submit"[^>]*>Sí, rechazar y revocar<\/button>/);
    expect(html).toContain('<input type="hidden" name="cliente" value="cliente-77"');
  });

  it('el botón Cancelar (dentro del diálogo) es type="button" — cancelar no envía el formulario ni revoca nada', () => {
    const html = renderToStaticMarkup(<FormaRechazarCliente accion={nada} clientId="cliente-1" nombre="X" tokensVivos={2} />);
    expect(html).toMatch(/<button type="button"[^>]*>Cancelar<\/button>/);
  });

  it('cerrado por omisión: el <dialog> no lleva el atributo open (no se revoca sin el clic explícito de confirmar)', () => {
    const html = renderToStaticMarkup(<FormaRechazarCliente accion={nada} clientId="cliente-1" nombre="X" tokensVivos={2} />);
    expect(html).not.toMatch(/<dialog[^>]*\sopen/);
  });
});
