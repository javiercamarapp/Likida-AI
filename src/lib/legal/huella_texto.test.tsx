import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

/**
 * Los atributos que un lector de pantalla o un tooltip PRONUNCIAN o MUESTRAN: `aria-label`, `aria-description`, `title`, `alt`,
 * `placeholder`. Esconder texto nuevo ahí (o en CSS generado, ver abajo) no puede dejar la huella intacta: cuentan como texto.
 */
const ATRIBUTOS_CON_TEXTO = ['aria-label', 'aria-description', 'title', 'alt', 'placeholder'];
function textoDeAtributos(html: string): string {
  const salida: string[] = [];
  for (const a of ATRIBUTOS_CON_TEXTO) {
    for (const m of html.matchAll(new RegExp(`\\s${a}="([^"]*)"`, 'g'))) salida.push(m[1]);
  }
  return salida.join(' ');
}

/** El texto de un HTML estático: visible (sin etiquetas, entidades resueltas, espacios colapsados) MÁS el de los atributos de arriba. */
function textoVisible(html: string): string {
  const visible = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
  const atributos = textoDeAtributos(html).replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return atributos ? `${visible} ${atributos}` : visible;
}

/** Los .css de `src/app` (el marco y los tokens que las páginas cargan). Recorrido de rutas propias del repo. */
function archivosCss(dir: string, salida: string[] = []): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  for (const n of readdirSync(dir)) {
    const ruta = join(dir, n);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (statSync(ruta).isDirectory()) archivosCss(ruta, salida);
    else if (n.endsWith('.css')) salida.push(ruta);
  }
  return salida;
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

  it('el marco no esconde texto nuevo en CSS generado: ninguna regla de las clases renderizadas pinta `content: "texto"`', async () => {
    for (const k of ENV_LEGAL) vi.stubEnv(k, '');
    vi.resetModules();
    for (const ruta of ['terminos', 'privacidad'] as const) {
      const mod = ruta === 'terminos' ? await import('@/app/terminos/page') : await import('@/app/privacidad/page');
      const html = renderToStaticMarkup(createElement(mod.default));
      const clases = new Set([...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean));
      const culpables: string[] = [];
      for (const css of archivosCss('src/app')) {
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        const fuente = readFileSync(css, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        for (const regla of fuente.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
          const sel = regla[1];
          if (!/::?(before|after)/.test(sel)) continue;
          if (!/content:\s*(["'])[^"']+\1/.test(regla[2])) continue;
          const usadas = [...sel.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((m) => m[1]);
          if (usadas.some((c) => clases.has(c))) culpables.push(`${css}: ${sel.trim()}`);
        }
      }
      expect(culpables, `/${ruta}: texto generado por CSS (cuenta como texto nuevo del documento):\n${culpables.join('\n')}`).toEqual([]);
    }
  });

  it('el marco no añade aria-label/title a los documentos: sus atributos de texto son los del propio contenido', async () => {
    for (const k of ENV_LEGAL) vi.stubEnv(k, '');
    vi.resetModules();
    for (const ruta of ['terminos', 'privacidad'] as const) {
      const mod = ruta === 'terminos' ? await import('@/app/terminos/page') : await import('@/app/privacidad/page');
      const html = renderToStaticMarkup(createElement(mod.default));
      // Línea base medida el 31-oct-2026: ninguno. Si el CONTENIDO legal necesitara uno, se sube aquí junto con la huella.
      expect(textoDeAtributos(html), `/${ruta} tiene atributos con texto nuevo`).toBe('');
    }
  });
});
