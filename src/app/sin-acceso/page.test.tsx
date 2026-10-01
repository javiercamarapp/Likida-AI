import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({ auth: { signOut: async () => {} } }) }));

afterEach(() => { delete process.env.NEXT_PUBLIC_SOPORTE_EMAIL; });

describe('/sin-acceso — ya no es un callejón (W2)', () => {
  it('ofrece cerrar sesión e ingresar con otra cuenta (un formulario con server action)', async () => {
    const { default: SinAcceso } = await import('./page');
    const html = renderToStaticMarkup(<SinAcceso />);
    expect(html).toContain('Cerrar sesión e ingresar con otra cuenta');
    expect(html).toMatch(/<form[^>]*>.*<button type="submit"/s);
    expect(html).toContain('Tu cuenta aún no tiene flota');
  });

  it('SIN correo de ayuda configurado no inventa uno', async () => {
    const { default: SinAcceso } = await import('./page');
    const html = renderToStaticMarkup(<SinAcceso />);
    expect(html).not.toContain('mailto:');
    expect(html).not.toContain('@likida.ai');
  });

  it('con NEXT_PUBLIC_SOPORTE_EMAIL ofrece escribir, con asunto', async () => {
    process.env.NEXT_PUBLIC_SOPORTE_EMAIL = 'ayuda@ejemplo.mx';
    const { default: SinAcceso } = await import('./page');
    const html = renderToStaticMarkup(<SinAcceso />);
    expect(html).toContain('href="mailto:ayuda@ejemplo.mx?subject=');
    expect(html).toContain('Escribir a ayuda: ayuda@ejemplo.mx');
  });

  it('un valor marcador ([SENSITIVE]) no se toma por un correo', async () => {
    process.env.NEXT_PUBLIC_SOPORTE_EMAIL = '[SENSITIVE]';
    const { default: SinAcceso } = await import('./page');
    expect(renderToStaticMarkup(<SinAcceso />)).not.toContain('mailto:');
  });
});
