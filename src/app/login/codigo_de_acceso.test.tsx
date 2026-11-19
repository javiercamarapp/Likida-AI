import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { VistaLogin } from './vista-login';

// ═══════════════════════════════════════════════════════════════════════════
// ENTRAR CON EL CÓDIGO DE 6 DÍGITOS (17-nov-2026).
//
// El enlace mágico de un solo uso falló dos veces en la primera prueba con una persona real de la flota: abierto desde
// un navegador distinto al que lo pidió (la cookie PKCE no estaba: `callback_navegador`) y ya gastado o vencido
// (`callback_caducado`, típico de un correo de empresa que abre los enlaces antes que la persona). El código que trae el
// mismo correo se escribe en /login, en el navegador de quien entra, y funciona desde cualquier lado.
//
// Los server actions de la página no se exportan: igual que `limite_por_cuenta.test.ts`, la lógica se vigila leyendo la
// fuente, y el marcado se prueba renderizando `VistaLogin`.
// ═══════════════════════════════════════════════════════════════════════════

// eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta fija del propio repo
const PAGINA = readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8');
const ACCION = PAGINA.slice(PAGINA.indexOf('async function entrarConCodigo'), PAGINA.indexOf('// TEMA: esta pantalla'));

const noop = async () => undefined;
const base = { next: '/dashboard', enviado: false, reenviado: false, entrarConGoogle: noop, entrarConEmail: noop };
const html = (o: object) => renderToStaticMarkup(VistaLogin({ ...base, ...o }) as never);

describe('server action entrarConCodigo', () => {
  it('canjea el código con verifyOtp de tipo email (el que corresponde a signInWithOtp)', () => {
    expect(ACCION).toMatch(/verifyOtp\(\{ email, token: codigo, type: 'email' \}\)/);
  });

  it('rechaza lo que no sea de 6 dígitos ANTES de gastar límites o llamar a Supabase', () => {
    const iFormato = ACCION.indexOf('[0-9]{6}');
    const iLimite = ACCION.indexOf("dentroDelLimite('login:codigo')");
    const iVerificar = ACCION.indexOf('verifyOtp');
    expect(iFormato).toBeGreaterThan(-1);
    expect(iLimite).toBeGreaterThan(iFormato);
    expect(iVerificar).toBeGreaterThan(iLimite);
  });

  it('limita por IP y por cuenta antes de verificar, con ventana CORTA (5 min) y techo estrecho', () => {
    expect(ACCION).toMatch(/dentroDelLimiteCodigo\(email\)/);
    expect(PAGINA).toMatch(/login:codigo-cuenta-ip:\$\{email\}:\$\{ip\}`, 5, 5 \* 60_000/);
    expect(PAGINA).toMatch(/login:codigo-cuenta:\$\{email\}`, 15, 5 \* 60_000/);
  });

  it('formato, límite, código malo y cuenta inexistente salen como el MISMO error (sin oráculo de enumeración)', () => {
    expect(ACCION).toMatch(/error=codigo/);
    expect(ACCION).not.toMatch(/error=(1|caducado|navegador)/);
    // Un solo punto de salida de error: nadie distingue «cuenta inexistente» de «código malo».
    expect((ACCION.match(/volver\(\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('acertar y fallar tardan lo mismo (piso de tiempo) y el fallo queda registrado sin el correo en claro', () => {
    expect(ACCION).toMatch(/conPisoDeTiempo\(\(\) => sb\.auth\.verifyOtp/);
    expect(ACCION).toMatch(/registrarLoginFallido\(\{ motivo: 'codigo_invalido', email \}\)/);
  });

  it('el destino tras entrar respeta la misma allowlist de rutas propias que el enlace', () => {
    expect(ACCION).toMatch(/destinoPermitido\(rawNext\)/);
    expect(ACCION).toMatch(/redirect\(dest\)/);
  });

  it('no da de alta a nadie: verifyOtp sobre un correo sin cuenta falla, y aquí no hay shouldCreateUser', () => {
    expect(ACCION).not.toMatch(/shouldCreateUser|signUp|createUser/);
  });
});

describe('VistaLogin: el bloque del código', () => {
  const conAccion = { entrarConCodigo: noop };

  it('no se pinta si la página no le pasa la acción', () => {
    expect(html({ enviado: true })).not.toContain('name="codigo"');
  });

  it('no estorba en la pantalla inicial', () => {
    expect(html(conAccion)).not.toContain('name="codigo"');
  });

  it('aparece al pedir el correo y ante enlace usado, vencido, de otro navegador o código malo', () => {
    for (const o of [{ enviado: true }, { error: 'caducado' }, { error: 'caducado_reciente' }, { error: 'navegador' }, { error: 'codigo' }]) {
      const marcado = html({ ...conAccion, ...o });
      expect(marcado, JSON.stringify(o)).toContain('name="codigo"');
      expect(marcado).toContain('autoComplete="one-time-code"');
      expect(marcado).toContain('inputMode="numeric"');
    }
  });

  it('no aparece con el error genérico (no hay nada que canjear)', () => {
    expect(html({ ...conAccion, error: '1' })).not.toContain('name="codigo"');
  });

  it('el mensaje del error de código no habla de la cuenta y los textos de enlace ofrecen el código', () => {
    expect(html({ ...conAccion, error: 'codigo' })).toContain('Ese código no es válido o ya venció');
    expect(html({ ...conAccion, error: 'navegador' })).toContain('código de 6 dígitos');
    expect(html({ ...conAccion, error: 'caducado' })).toContain('código de 6 dígitos');
  });
});
