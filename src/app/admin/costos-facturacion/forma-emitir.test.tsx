import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FormaEmitirMensualidad } from './forma-emitir';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA ADVERSARIAL, HALLAZGO MEDIO: "Emitir mensualidad" disparaba
// `emitirMensualidad` (acción fiscal real: genera el cobro del periodo, con
// constraint de unicidad por periodo en la base) con un solo clic y CERO
// diálogo. Se mide aquí lo mismo que `admin/mcp-clientes/forma-rechazar.test.tsx`
// y `admin/ui/confirmar.test.tsx` miden para su molde (PR #583), contra ESTA
// pantalla: que el disparador visible NO envía nada por sí solo (type="button"),
// que el `<dialog>` queda cerrado por omisión, y que lo que SÍ envía
// (type="submit") vive dentro del MISMO formulario cuya action es la server
// action real.
// ═══════════════════════════════════════════════════════════════════════════

const nada = async () => null;
const FLOTAS = [{ id: 'tn-1', nombre: 'ACME Logística' }, { id: 'tn-2', nombre: 'Transportes Beta' }];

/** El <button ...>texto</button> cuyo texto es exactamente `texto`. */
const boton = (html: string, texto: string) =>
  [...html.matchAll(/<button[^>]*>[^<]*<\/button>/g)].map((m) => m[0]).find((b) => b.endsWith(`>${texto}</button>`));

function renderizar() {
  return renderToStaticMarkup(
    <FormaEmitirMensualidad accion={nada} flotas={FLOTAS} periodoIni="2026-10-01" periodoFin="2026-10-31" />,
  );
}

describe('FormaEmitirMensualidad', () => {
  it('el disparador "Emitir" es type="button" (no envía) — un clic solo no emite nada', () => {
    const html = renderizar();
    expect(boton(html, 'Emitir')).toContain('type="button"');
  });

  it('sin flota elegida, el disparador queda DESHABILITADO — no hay manera de abrir el diálogo sin elegir', () => {
    const html = renderizar();
    expect(boton(html, 'Emitir')).toContain('disabled');
    // Y el diálogo (aunque cerrado) todavía no nombra ninguna flota — pide elegir primero.
    expect(html).toMatch(/elige una flota primero/i);
  });

  it('el <select> trae TODAS las flotas recibidas, con su id como value', () => {
    const html = renderizar();
    expect(html).toContain('<option value="tn-1">ACME Logística</option>');
    expect(html).toContain('<option value="tn-2">Transportes Beta</option>');
  });

  it('el <dialog> existe pero cerrado por omisión (sin el atributo open) — no se emite sin el clic explícito de confirmar', () => {
    const html = renderizar();
    expect(html).toContain('<dialog');
    expect(html).not.toMatch(/<dialog[^>]*\sopen/);
  });

  it('el botón que SÍ envía (dentro del diálogo) es type="submit", y vive DENTRO del mismo <form> real', () => {
    const html = renderizar();
    const elConfirmar = boton(html, 'Sí, emitir mensualidad');
    expect(elConfirmar).toContain('type="submit"');
    expect(html).toContain('<form');
  });

  it('el botón Cancelar (dentro del diálogo) es type="button" — cancelar no envía el formulario ni emite nada', () => {
    const html = renderizar();
    expect(boton(html, 'Cancelar')).toContain('type="button"');
  });

  it('tono="peligro": el foco inicial del diálogo cae en Cancelar, no en el botón que emite', () => {
    const html = renderizar();
    expect(boton(html, 'Cancelar')).toContain('data-foco-inicial');
    expect(boton(html, 'Sí, emitir mensualidad')).not.toContain('data-foco-inicial');
  });
});
