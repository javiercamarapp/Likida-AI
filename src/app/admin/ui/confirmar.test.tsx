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
    expect(boton(html, 'Cancelar')).toContain('data-autofocus');
    expect(boton(html, 'Dar de baja')).not.toContain('data-autofocus');
  });

  it('en tono normal el foco inicial cae en confirmar', () => {
    const html = renderToStaticMarkup(<DialogoConfirmar {...base} tono="normal" />);
    expect(boton(html, 'Dar de baja')).toContain('data-autofocus');
    expect(boton(html, 'Cancelar')).not.toContain('data-autofocus');
  });

  it('mientras el server action corre, confirmar se deshabilita (no hay doble envío)', () => {
    const html = renderToStaticMarkup(<DialogoConfirmar {...base} pendiente />);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Un momento…/);
  });

  it('peligro = alertdialog; normal = dialog; el texto va en el cuerpo y describe el diálogo (describedby)', () => {
    const p = renderToStaticMarkup(<DialogoConfirmar {...base} tono="peligro" />);
    const n = renderToStaticMarkup(<DialogoConfirmar {...base} tono="normal" />);
    expect(p).toContain('role="alertdialog"');
    expect(n).not.toContain('role="alertdialog"');
    const id = /aria-describedby="([^"]+)"/.exec(p)![1];
    expect(p).toContain(`id="${id}" class="rv-confirmar__texto"`);
  });

  it('es el Modal del motor único: clases rv-ov, sin <dialog> ni estilos propios en línea', () => {
    const html = renderToStaticMarkup(<DialogoConfirmar {...base} />);
    expect(html).toContain('rv-ov rv-ov--modal');
    expect(html).not.toContain('style=');
    expect(html).not.toContain('rounded-2xl');
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

  it('el botón que confirma puede decir CUÁL salida del formulario eligió (name/value)', () => {
    const html = renderToStaticMarkup(
      <form action="/x">
        <BotonConfirmar etiqueta="Importar" titulo="t" descripcion="d" etiquetaConfirmar="Sí, importar" nombreConfirmar="paso" valorConfirmar="confirmar" tono="normal" />
      </form>,
    );
    const boton = [...html.matchAll(/<button[^>]*>[^<]*<\/button>/g)].map((m) => m[0]).find((b) => b.endsWith('>Sí, importar</button>'))!;
    expect(boton).toContain('type="submit"');
    expect(boton).toContain('name="paso"');
    expect(boton).toContain('value="confirmar"');
  });
});
