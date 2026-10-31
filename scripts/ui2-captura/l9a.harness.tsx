/* eslint-disable security/detect-non-literal-fs-filename -- el arnés escribe en una ruta de salida propia */
// ARNÉS L9a (login y páginas públicas): renderiza la VISTA real de /login en sus estados y las páginas públicas migradas.
// Uso: UI2_OUT=<dir> npx vitest run --config scripts/ui2-captura/vitest.config.mts l9a
import { describe, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ReactNode } from 'react';

vi.mock('next/navigation', () => ({ redirect() {}, notFound() {}, usePathname: () => '/', useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({ auth: { signOut: async () => {} } }) }));

const { VistaLogin } = await import('@/app/login/vista-login');
const { default: SinAcceso } = await import('@/app/sin-acceso/page');
const { default: Seguridad } = await import('@/app/seguridad/page');
const { default: Privacidad } = await import('@/app/privacidad/page');
const { default: Blog } = await import('@/app/blog/page');
const { default: NoEncontrado } = await import('@/app/not-found');
const { default: Calculadora } = await import('@/app/calculadora/page');
const { default: Demo } = await import('@/app/demo/page');

const OUT = process.env.UI2_OUT ?? path.join(homedir(), 'likida-loop/cierre100/arnes-l9a');
const noop = async () => undefined;

const VISTAS: Record<string, () => ReactNode> = {
  'login-01-reposo': () => VistaLogin({ next: '/dashboard', enviado: false, reenviado: false, entrarConGoogle: noop, entrarConEmail: noop }) as ReactNode,
  'login-02-enviado': () => VistaLogin({ next: '/dashboard', enviado: true, reenviado: false, entrarConGoogle: noop, entrarConEmail: noop }) as ReactNode,
  'login-03-error-caducado': () => VistaLogin({ next: '/dashboard', enviado: false, reenviado: false, error: 'caducado', entrarConGoogle: noop, entrarConEmail: noop }) as ReactNode,
  'pub-01-sin-acceso': () => <SinAcceso />,
  'pub-02-seguridad': () => <Seguridad />,
  'pub-03-privacidad': () => <Privacidad />,
  'pub-04-blog': () => <Blog />,
  'pub-05-404': () => <NoEncontrado />,
  'pub-06-calculadora': () => <Calculadora />,
  'pub-07-demo': () => <Demo />,
};

describe('arnés L9a', () => {
  it('escribe las vistas', () => {
    mkdirSync(path.join(OUT, 'vistas'), { recursive: true });
    for (const [nombre, el] of Object.entries(VISTAS)) {
      writeFileSync(path.join(OUT, 'vistas', `${nombre}.html`), `<div data-vista="${nombre}">${renderToStaticMarkup(el() as never)}</div>`);
    }
  });
});
