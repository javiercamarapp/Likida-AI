import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// K3 · /login al sistema fino de controles (SPEC-CONTROLES-FINOS, D4): alto 40 (--ctl-h-lg, con respaldo porque /login no carga tokens.css),
// radio 8, borde de 1 px y sin sombras de relieve. El h1 serif de 36 px es marca editorial, no un control.
const CSS = readFileSync(join(__dirname, 'login.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const regla = (sel: string) => CSS.match(new RegExp(`${sel.replace(/[.[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

describe('/login: controles finos (K3)', () => {
  it('el botón mide --ctl-h-lg (40) con respaldo, radio 8 y sin pastilla de 52', () => {
    const r = regla('.login-editorial .login-btn');
    expect(r).toMatch(/min-height:\s*var\(--ctl-h-lg,\s*40px\)/);
    expect(r).toMatch(/border-radius:\s*8px/);
    expect(r).toMatch(/border:\s*1px solid/);
    expect(r).not.toMatch(/999px/);
  });
  it('el campo mide --ctl-h-lg (40) con respaldo, radio 8 y borde de 1 px', () => {
    const r = regla('.login-editorial .login-campo');
    expect(r).toMatch(/min-height:\s*var\(--ctl-h-lg,\s*40px\)/);
    expect(r).toMatch(/border:\s*1px solid var\(--login-input\)/);
    expect(r).toMatch(/border-radius:\s*8px/);
  });
  it('ningún control conserva 52 px, radio 13 ni sombra de relieve; en móvil la zona de toque es 44', () => {
    expect(CSS).not.toMatch(/min-height:\s*52px/);
    expect(CSS).not.toMatch(/border-radius:\s*13px/);
    expect(CSS).not.toMatch(/box-shadow:\s*0 8px/);
    expect(CSS).toMatch(/\.login-btn,\s*\.login-editorial \.login-campo\s*\{\s*min-height:\s*44px/);
  });
});
