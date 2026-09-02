import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SubirHook } from './subir-hook';

// ═══════════════════════════════════════════════════════════════════════════
// SUBIR HOOK — el formulario nace en su estado inicial: sin archivo elegido,
// sin mensaje de error/éxito, aceptando SOLO los mismos tipos de video que
// el bucket `marketing_hooks_video` (0266) — un `accept` más laxo dejaría
// elegir un archivo que Storage va a rechazar de todos modos, un mal viaje.
// ═══════════════════════════════════════════════════════════════════════════

const pedirFirma = async () => ({ ok: true as const, bucket: 'marketing_hooks_video', path: 'x.mp4', token: 't' });
const guardar = async () => ({ ok: true as const });

describe('SubirHook — estado inicial honesto', () => {
  it('pinta el campo de archivo con el mismo dominio de mime que la migración 0266', () => {
    const html = renderToStaticMarkup(<SubirHook pedirFirma={pedirFirma} guardar={guardar} />);
    expect(html).toContain('video/mp4');
    expect(html).toContain('video/quicktime');
    expect(html).toContain('video/webm');
    expect(html).toContain('video/x-m4v');
  });

  it('el botón de subir nace deshabilitado: sin archivo elegido no hay nada que subir', () => {
    const html = renderToStaticMarkup(<SubirHook pedirFirma={pedirFirma} guardar={guardar} />);
    expect(html).toContain('disabled');
    expect(html).toContain('Subir y guardar hook');
  });

  it('no muestra ningún mensaje de error/éxito antes de que el usuario haga algo', () => {
    const html = renderToStaticMarkup(<SubirHook pedirFirma={pedirFirma} guardar={guardar} />);
    expect(html).not.toContain('Hook guardado.');
  });
});
