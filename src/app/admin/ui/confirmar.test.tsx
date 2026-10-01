import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DialogoConfirmar, BotonConfirmar } from './confirmar';

// El diálogo de confirmación es el `<dialog>` NATIVO: foco atrapado, fondo
// inerte, Esc y devolución del foco los pone el navegador. Aquí se fija lo que
// el HTML tiene que declarar para que eso sirva.

describe('DialogoConfirmar', () => {
  const base = { abierto: false, titulo: 'Dar de baja a Juan Pérez', descripcion: 'Dejará de recibir mensajes del bot.', etiquetaConfirmar: 'Dar de baja', onCancelar: () => {} };

  it('es un <dialog> con título y descripción asociados (aria-labelledby/-describedby)', () => {
    const html = renderToStaticMarkup(<DialogoConfirmar {...base} />);
    expect(html).toContain('<dialog');
    expect(html).toMatch(/aria-labelledby="[^"]+"/);
    expect(html).toMatch(/aria-describedby="[^"]+"/);
    const idTitulo = /aria-labelledby="([^"]+)"/.exec(html)![1];
    expect(html).toContain(`id="${idTitulo}"`);
    expect(html).toContain('Dar de baja a Juan Pérez');
  });

  /** El <button ...>texto</button> cuyo texto es exactamente `texto`. */
  const boton = (html: string, texto: string) =>
    [...html.matchAll(/<button[^>]*>[^<]*<\/button>/g)].map((m) => m[0]).find((b) => b.endsWith(`>${texto}</button>`))!;

  it('en tono peligro el foco inicial cae en CANCELAR, no en el botón rojo', () => {
    const html = renderToStaticMarkup(<DialogoConfirmar {...base} tono="peligro" />);
    expect(boton(html, 'Cancelar')).toContain('data-foco-inicial');
    expect(boton(html, 'Dar de baja')).not.toContain('data-foco-inicial');
  });

  it('en tono normal el foco inicial cae en confirmar', () => {
    const html = renderToStaticMarkup(<DialogoConfirmar {...base} tono="normal" />);
    expect(boton(html, 'Dar de baja')).toContain('data-foco-inicial');
    expect(boton(html, 'Cancelar')).not.toContain('data-foco-inicial');
  });

  it('mientras el server action corre, confirmar se deshabilita (no hay doble envío)', () => {
    const html = renderToStaticMarkup(<DialogoConfirmar {...base} pendiente />);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Un momento…/);
  });

  it('cerrado por omisión: no lleva el atributo open', () => {
    expect(renderToStaticMarkup(<DialogoConfirmar {...base} />)).not.toMatch(/<dialog[^>]*\sopen/);
  });
});

describe('BotonConfirmar', () => {
  it('el disparador es type="button" (no envía) y el confirmar del diálogo es type="submit" (envía el formulario)', () => {
    const html = renderToStaticMarkup(
      <form action="/x">
        <BotonConfirmar etiqueta="Borrar patio" titulo="Borrar Patio Norte" descripcion="Quedarán 12 operadores sin patio." etiquetaConfirmar="Borrar" />
      </form>,
    );
    expect(html).toMatch(/<button type="button"[^>]*>Borrar patio<\/button>/);
    expect(html).toMatch(/<button type="submit"[^>]*>Borrar<\/button>/);
    expect(html).toContain('Quedarán 12 operadores sin patio.');
  });
});
