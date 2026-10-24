import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// A37-L-09 — LA HUELLA DEL TEXTO QUE SE ACEPTA.
//
// `aceptacion_legal` guarda «qué versión aceptó quién», pero para Términos y
// Aviso la versión era una cadena escrita a mano: editar /privacidad o
// /terminos sin subirla dejaba las aceptaciones registradas sobre un texto
// distinto, y no había prueba de QUÉ leyó el dueño. Aquí se renderiza la
// página REAL (con la configuración legal neutralizada para que no dependa del
// entorno), se normaliza su texto visible y se compara su SHA-256 con la huella
// registrada en `documentos.ts`. La versión INCLUYE los primeros 8 hex de esa
// huella: no se puede actualizar la huella sin que cambie la versión.
//
// SI ESTA PRUEBA FALLA: cambiaste el texto de la página. Pon la huella nueva
// (el mensaje la imprime) y la versión `AAAA-MM-DD+<8 hex>` con la fecha de hoy.
// Eso hace que cada dueño vuelva a ver «acepta la versión vigente».
// ═══════════════════════════════════════════════════════════════════════════

const ENV_LEGAL = [
  'LEGAL_ENTITY_NAME', 'LEGAL_ENTITY_ADDRESS', 'LEGAL_JURISDICTION', 'LEGAL_CONTACT_EMAIL',
  'LEGAL_DPA_VERSION', 'LEGAL_SLA_VERSION', 'LEGAL_SECURITY_ANNEX_VERSION', 'LEGAL_SUBPROCESSORS_VERSION',
];

/** El texto visible de un HTML estático: sin etiquetas, entidades resueltas, espacios colapsados. */
function textoVisible(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

async function huellaDe(ruta: 'terminos' | 'privacidad'): Promise<string> {
  for (const k of ENV_LEGAL) vi.stubEnv(k, '');
  vi.resetModules();
  const mod = ruta === 'terminos' ? await import('@/app/terminos/page') : await import('@/app/privacidad/page');
  const html = renderToStaticMarkup(createElement(mod.default));
  const texto = textoVisible(html);
  expect(texto.length, 'la página no renderizó texto').toBeGreaterThan(2000);
  return createHash('sha256').update(texto).digest('hex');
}

describe('A37-L-09 — huella del texto renderizado de Términos y Aviso', () => {
  it('la huella registrada de /terminos ES la del texto que se muestra, y la versión la lleva', async () => {
    const doc = await import('./documentos');
    const h = await huellaDe('terminos');
    expect(doc.HUELLA_TERMINOS, `cambió /terminos: HUELLA_TERMINOS = '${h}' y VERSION_TERMINOS = 'AAAA-MM-DD+${h.slice(0, 8)}'`).toBe(h);
    expect(doc.VERSION_TERMINOS).toBe(`${doc.VIGENTE_DESDE_TERMINOS}+${h.slice(0, 8)}`);
  });

  it('la huella registrada de /privacidad ES la del texto que se muestra, y la versión la lleva', async () => {
    const doc = await import('./documentos');
    const h = await huellaDe('privacidad');
    expect(doc.HUELLA_AVISO_PRIVACIDAD, `cambió /privacidad: HUELLA_AVISO_PRIVACIDAD = '${h}' y VERSION_AVISO_PRIVACIDAD = 'AAAA-MM-DD+${h.slice(0, 8)}'`).toBe(h);
    expect(doc.VERSION_AVISO_PRIVACIDAD).toBe(`${doc.VIGENTE_DESDE_AVISO_PRIVACIDAD}+${h.slice(0, 8)}`);
  });

  it('el «Vigente desde» que se imprime sale de la MISMA fecha que la versión (no 2026-09-01 contra 2026-10-01)', async () => {
    const doc = await import('./documentos');
    const { fechaMx } = await import('@/lib/formato');
    vi.resetModules();
    const t = textoVisible(renderToStaticMarkup(createElement((await import('@/app/terminos/page')).default)));
    const p = textoVisible(renderToStaticMarkup(createElement((await import('@/app/privacidad/page')).default)));
    expect(t).toContain(`Vigente desde el ${fechaMx(doc.VIGENTE_DESDE_TERMINOS)}`);
    expect(p).toContain(`Vigente desde el ${fechaMx(doc.VIGENTE_DESDE_AVISO_PRIVACIDAD)}`);
  });
});
