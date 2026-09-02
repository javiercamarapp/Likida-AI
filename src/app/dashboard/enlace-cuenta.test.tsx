import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · H29 — el link a "Mi cuenta" apagaba la previsualización.
//
// Mismo contrato que `sidebar-nav.tsx` (`useSufijoYRol`, ajeno a este
// agente): `tenant` gana sobre `vista`; sin ninguno, un superadmin real cae
// a `?vista=demo` (las subpáginas ya lo mandaron ahí); `rol` viaja siempre
// que exista.
// ═══════════════════════════════════════════════════════════════════════════

let params = new URLSearchParams();
vi.mock('next/navigation', () => ({ useSearchParams: () => params }));

const { EnlaceCuenta } = await import('./enlace-cuenta');

function href(rol: string, qs: string): string {
  params = new URLSearchParams(qs);
  const html = renderToStaticMarkup(<EnlaceCuenta rol={rol}>x</EnlaceCuenta>);
  return (html.match(/href="([^"]*)"/)?.[1] ?? '').replaceAll('&amp;', '&');
}

describe('EnlaceCuenta — el link a /cuenta conserva la previsualización', () => {
  it('rol real, sin query: va a /cuenta a secas', () => {
    expect(href('flota_admin', '')).toBe('/cuenta');
  });

  it('superadmin sin ningún parámetro: cae a ?vista=demo (igual que sidebar-nav)', () => {
    expect(href('superadmin', '')).toBe('/cuenta?vista=demo');
  });

  it('?tenant=X viaja tal cual — tenant gana sobre vista', () => {
    expect(href('superadmin', 'tenant=t-otra&vista=demo')).toBe('/cuenta?tenant=t-otra');
  });

  it('?vista=demo sin tenant también viaja', () => {
    expect(href('superadmin', 'vista=demo')).toBe('/cuenta?vista=demo');
  });

  it('?rol= (previsualización de rol) se añade siempre que exista', () => {
    expect(href('superadmin', 'tenant=t-otra&rol=encargado')).toBe('/cuenta?tenant=t-otra&rol=encargado');
    expect(href('superadmin', 'rol=encargado')).toBe('/cuenta?vista=demo&rol=encargado');
  });
});
