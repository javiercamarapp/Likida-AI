/* eslint-disable security/detect-non-literal-fs-filename -- el arnés escribe en una ruta de salida propia */
// ARNÉS L9a (login y páginas públicas): renderiza la VISTA real de /login en sus estados y las páginas públicas migradas.
// Uso: UI2_OUT=<dir> npx vitest run --config scripts/ui2-captura/vitest.config.mts l9a
import { describe, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ReactNode } from 'react';

const { VistaLogin } = await import('@/app/login/vista-login');

const OUT = process.env.UI2_OUT ?? path.join(homedir(), 'likida-loop/cierre100/arnes-l9a');
const noop = async () => undefined;

const VISTAS: Record<string, () => ReactNode> = {
  'login-01-reposo': () => VistaLogin({ next: '/dashboard', enviado: false, reenviado: false, entrarConGoogle: noop, entrarConEmail: noop }) as ReactNode,
  'login-02-enviado': () => VistaLogin({ next: '/dashboard', enviado: true, reenviado: false, entrarConGoogle: noop, entrarConEmail: noop }) as ReactNode,
  'login-03-error-caducado': () => VistaLogin({ next: '/dashboard', enviado: false, reenviado: false, error: 'caducado', entrarConGoogle: noop, entrarConEmail: noop }) as ReactNode,
};

describe('arnés L9a', () => {
  it('escribe las vistas', () => {
    mkdirSync(path.join(OUT, 'vistas'), { recursive: true });
    for (const [nombre, el] of Object.entries(VISTAS)) {
      writeFileSync(path.join(OUT, 'vistas', `${nombre}.html`), `<div data-vista="${nombre}">${renderToStaticMarkup(el() as never)}</div>`);
    }
  });
});
