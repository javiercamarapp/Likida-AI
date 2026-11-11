import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/font/google', () => ({ Fraunces: () => ({ variable: '--f' }), Instrument_Sans: () => ({ variable: '--i' }) }));

const { VistaLogin } = await import('./vista-login');
const { mensajeDeError } = await import('@/lib/auth/motivo_login');
const { login: loginEs } = await import('@/lib/i18n/es/login');
const { login: loginEn } = await import('@/lib/i18n/en/login');
const { crearTraductor } = await import('@/lib/i18n/traducir');

const base = { next: '/dashboard', enviado: false, reenviado: false, entrarConGoogle: () => {}, entrarConEmail: () => {} };
const en = crearTraductor<typeof loginEs>('en', loginEn, loginEs);
const html = (props: Partial<Parameters<typeof VistaLogin>[0]>) => renderToStaticMarkup(VistaLogin({ ...base, ...props }));

describe('/login por idioma', () => {
  it('sin traductor dice lo de siempre, en español, sin atributo lang', () => {
    const h = html({});
    expect(h).toContain('Bienvenido a Likida');
    expect(h).toContain('Continuar con correo');
    expect(h).toContain('<a href="/terminos">Términos de Servicio</a>');
    expect(h).not.toContain('lang=');
  });

  it('con el traductor en inglés cambia el texto y conserva los dos enlaces legales', () => {
    const h = html({ tr: en, enviado: true });
    expect(h).toContain('Welcome to Likida');
    expect(h).toContain('Continue with email');
    expect(h).toContain('We sent a link to your email.');
    expect(h).toContain('<a href="/terminos">Terms of Service</a>');
    expect(h).toContain('<a href="/privacidad">Privacy Notice</a>');
    expect(h).toContain('lang="en"');
    expect(h).not.toContain('Bienvenido');
  });

  it('cada motivo de fallo dice lo mismo que `mensajeDeError` en español y habla del enlace, no de la cuenta, en inglés', () => {
    for (const motivo of ['caducado', 'caducado_reciente', 'navegador', '1']) {
      expect(html({ error: motivo })).toContain(mensajeDeError(motivo).replace(/&/g, '&amp;'));
      expect(html({ error: motivo, tr: en })).not.toContain('Algo falló');
    }
    expect(html({ error: 'caducado', tr: en })).toContain('That link was already used or has expired.');
  });
});
