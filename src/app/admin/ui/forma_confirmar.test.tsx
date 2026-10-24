import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FormaConAviso } from './forma';

// A37-S16-04: una forma destructiva puede pedir confirmación; sin ella el botón envía directo como siempre.
const accion = async () => null;

describe('FormaConAviso con confirmación', () => {
  it('con `confirmar`, el botón visible NO envía: abre el diálogo y el envío vive dentro de él', () => {
    const html = renderToStaticMarkup(
      <FormaConAviso accion={accion} boton="Ejecutar cancelación" confirmar={{ titulo: 'Ejecutar la cancelación', descripcion: 'No se puede deshacer.', etiquetaConfirmar: 'Sí, ejecutar' }}>
        <input type="hidden" name="solicitudId" value="s-1" />
      </FormaConAviso>,
    );
    const botones = html.split('<button').slice(1).map((t) => `<button${t.slice(0, t.indexOf('</button>'))}`);
    const disparador = botones.find((b) => b.includes('Ejecutar cancelación'))!;
    expect(disparador).toContain('type="button"');
    expect(html).toContain('<dialog');
    expect(html).toContain('No se puede deshacer.');
    expect(botones.find((b) => b.includes('Sí, ejecutar'))).toContain('type="submit"');
    expect(botones.filter((b) => b.includes('type="submit"'))).toHaveLength(1);
  });

  it('sin `confirmar`, el botón sigue siendo el submit de siempre', () => {
    const html = renderToStaticMarkup(<FormaConAviso accion={accion} boton="Guardar"><input name="x" /></FormaConAviso>);
    expect(html).not.toContain('<dialog');
    expect(html).toMatch(/<button type="submit"[^>]*>Guardar<\/button>/);
  });
});
