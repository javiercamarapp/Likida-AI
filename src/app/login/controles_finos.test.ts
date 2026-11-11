import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// /login con los controles de Rovaq (paquete I, decisión 7 del dueño: seguir a Rovaq): botón píldora de 999 px con alto 44 (48 en
// móvil) y peso 500; campo con radio de tarjeta (12), relleno 10/16 y borde de 1 px con contraste 3:1. El primario sigue NEGRO
// (decisión 1) y el hover es neutro. El h1 serif de 36 px es marca editorial, no un control.
const CSS = readFileSync(join(__dirname, 'login.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const regla = (sel: string) => CSS.match(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

describe('/login: controles iguales a Rovaq (paquete I)', () => {
  it('el botón es píldora de 999 px, mide --login-hit (44), relleno 10/20, peso 500 y borde de 1 px', () => {
    const r = regla('.login-editorial .login-btn');
    expect(r).toMatch(/min-height:\s*var\(--login-hit\)/);
    expect(r).toMatch(/padding:\s*10px 20px/);
    expect(r).toMatch(/border-radius:\s*999px/);
    expect(r).toMatch(/border:\s*1px solid/);
    expect(r).toMatch(/font:\s*500 14px/);
    expect(CSS).toMatch(/--login-hit:\s*44px/);
  });
  it('el primario sigue negro con hover neutro (sin azul) y el de borde conserva --login-input (3:1, WCAG 1.4.11; Rovaq usa una línea más clara)', () => {
    expect(regla('.login-editorial .login-btn-tinta')).toMatch(/background:\s*#0e0e10/);
    expect(regla('.login-editorial .login-btn-tinta:not(:disabled):hover')).toMatch(/background:\s*#26262b/);
    expect(regla('.login-editorial .login-btn-borde')).toMatch(/border-color:\s*var\(--login-input\)/);
  });
  it('el campo mide --login-hit, relleno 10/16, radio de tarjeta (12) y borde de 1 px con --login-input (3:1)', () => {
    const r = regla('.login-editorial .login-campo');
    expect(r).toMatch(/min-height:\s*var\(--login-hit\)/);
    expect(r).toMatch(/padding:\s*10px 16px/);
    expect(r).toMatch(/border:\s*1px solid var\(--login-input\)/);
    expect(r).toMatch(/border-radius:\s*var\(--login-r-card\)/);
    expect(CSS).toMatch(/--login-r-card:\s*12px/);
    expect(regla('.login-editorial .login-campo:focus-visible')).toMatch(/box-shadow:\s*0 0 0 4px/);
  });
  it('ningún control conserva 52 px, radio 13 ni sombra de relieve; en móvil el botón sube a 48', () => {
    expect(CSS).not.toMatch(/min-height:\s*52px/);
    expect(CSS).not.toMatch(/border-radius:\s*13px/);
    expect(CSS).not.toMatch(/box-shadow:\s*0 8px/);
    expect(CSS).toMatch(/@media \(max-width: 1023px\)[\s\S]*\.login-editorial \.login-btn\s*\{\s*min-height:\s*48px/);
  });
});
