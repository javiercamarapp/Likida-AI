import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { VistaLogin } from './vista-login';

// L9a (verificador B1/B2): el login no comunica el error con rojo ni deja los controles bajo 3:1.
// eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta fija del propio repo
const CSS = readFileSync(new URL('./login.css', import.meta.url), 'utf8');
const noop = async () => undefined;
const base = { next: '/dashboard', enviado: false, reenviado: false, entrarConGoogle: noop, entrarConEmail: noop };
const html = (o: object) => renderToStaticMarkup(VistaLogin({ ...base, ...o }) as never);

function luz(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const razon = (a: string, b: string) => { const [x, y] = [luz(a), luz(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const token = (n: string) => CSS.match(new RegExp(`--${n}:\\s*(#[0-9a-fA-F]{6})`))![1];

describe('login: estados accesibles', () => {
  it('B2: el error se distingue del éxito sin rojo (icono, borde izquierdo de tinta y peso), y sigue siendo role=alert', () => {
    const error = html({ error: 'caducado' });
    const enviado = html({ enviado: true });
    expect(error).toContain('role="alert"');
    expect(error).toContain('data-tipo="error"');
    expect(error).toContain('lucide-octagon-alert');
    expect(enviado).toContain('data-tipo="enviado"');
    expect(enviado).toContain('lucide-mail-check');
    expect(enviado).not.toContain('lucide-octagon-alert');
    expect(error).not.toContain('lucide-mail-check');
    const regla = CSS.match(/\.login-message\[data-tipo="error"\]\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(regla).toMatch(/border-left:\s*4px solid var\(--login-ink\)/);
    expect(regla).toMatch(/font-weight:\s*600/);
    expect(CSS).not.toMatch(/--color-bad|--bad\b|#d70015|#ac2440/);
  });

  it('B1: el borde del campo y del botón secundario usa --login-input y mide ≥3:1 contra el fondo', () => {
    expect(CSS).toMatch(/\.login-campo\s*\{[^}]*border:\s*1px solid var\(--login-input\)/);
    expect(CSS).toMatch(/\.login-btn-borde\s*\{[^}]*border-color:\s*var\(--login-input\)/);
    expect(razon(token('login-input'), token('login-bg'))).toBeGreaterThanOrEqual(3);
    expect(razon(token('login-input'), token('login-soft'))).toBeGreaterThanOrEqual(2.5);
  });

  it('el texto de apoyo y los avisos pasan 4.5:1', () => {
    expect(razon(token('login-muted'), token('login-bg'))).toBeGreaterThanOrEqual(4.5);
    expect(razon(token('login-muted'), token('login-soft'))).toBeGreaterThanOrEqual(4.5);
  });
});
