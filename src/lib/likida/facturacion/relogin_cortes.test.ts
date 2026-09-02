import { describe, it, expect } from 'vitest';
import { camposDeEntrada, corteDuro, credencialRechazada } from './relogin_cortes';
import type { CampoInventariado, InventarioPagina } from './adaptadores/playwright_base';

// ═══════════════════════════════════════════════════════════════════════════
// LOS CINCO MUROS QUE EL RE-LOGIN NO PASA, y el sexto que lo detiene.
//
// Esta es la parte del re-login automático que decide cuándo NO seguir, y es
// la que no puede tener falsos negativos: un CAPTCHA que no se detecta es una
// máquina intentando pasar por persona con la cuenta del cliente, y unas
// «credenciales inválidas» que no se detectan son reintentos con una
// contraseña mala hasta que el portal bloquea esa cuenta.
// ═══════════════════════════════════════════════════════════════════════════

const campo = (p: Partial<CampoInventariado> = {}): CampoInventariado => ({
  tag: 'input', type: 'text', id: '', name: '', placeholder: '', etiqueta: '',
  visible: true, opciones: [], ...p,
});

const INV = (p: Partial<InventarioPagina> = {}): InventarioPagina => ({
  url: 'https://portal.example.mx/Account/Login',
  titulo: 'Entrar', campos: [], botones: [], captcha: [], texto: '', ...p,
});

const PASS = campo({ type: 'password', id: 'Password', name: 'Password' });
const USUARIO = campo({ id: 'Usuario', name: 'Usuario' });
const BOTON = { tag: 'button', id: 'btnEntrar', name: '', texto: 'Iniciar sesión', visible: true };

describe('corteDuro — CAPTCHA: no se resuelve, no se rodea, se para', () => {
  it('caza el reCAPTCHA por la marca que el inventario ya extrae', () => {
    const c = corteDuro(INV({ campos: [USUARIO, PASS], captcha: ['https://www.google.com/recaptcha/api.js'] }));
    expect(c?.clase).toBe('captcha');
    // El motivo tiene que decir POR QUÉ no se rodea: es la cuenta del cliente
    // la que se suspende, y esa frase es la que va a la pantalla.
    expect(c?.motivo).toMatch(/no resuelve ni rodea/i);
  });

  it('caza hCaptcha y Turnstile, no solo el de Google', () => {
    expect(corteDuro(INV({ captcha: ['//hcaptcha.com/1/api.js'] }))?.clase).toBe('captcha');
    expect(corteDuro(INV({ captcha: ['cf-turnstile'] }))?.clase).toBe('captcha');
  });

  it('lo caza también cuando solo está el div del widget, sin iframe cargado', () => {
    const c = corteDuro(INV({ campos: [USUARIO, PASS, campo({ id: 'g-recaptcha-response', type: 'hidden', visible: false })] }));
    expect(c?.clase).toBe('captcha');
  });

  it('un login limpio NO es un corte: sin muro, el re-login sigue', () => {
    expect(corteDuro(INV({ campos: [USUARIO, PASS], botones: [BOTON], texto: 'Bienvenido, entra a facturar' }))).toBeNull();
  });
});

describe('corteDuro — los otros cuatro muros', () => {
  it('el segundo factor corta: el código llega al teléfono de una persona', () => {
    const c = corteDuro(INV({ texto: 'Te enviamos un código de verificación a tu correo.' }));
    expect(c?.clase).toBe('segundo_factor');
  });

  it('el segundo factor también por el campo, aunque el texto esté en inglés', () => {
    const c = corteDuro(INV({ campos: [campo({ id: 'otpCode', name: 'otpCode' })] }));
    expect(c?.clase).toBe('segundo_factor');
  });

  it('un `__RequestVerificationToken` de ASP.NET NO es un segundo factor', () => {
    // El falso positivo que detendría todos los re-logins del mundo: medio
    // formulario ASP.NET trae este campo antifalsificación.
    const inv = INV({
      campos: [campo({ type: 'hidden', name: '__RequestVerificationToken', visible: false }), USUARIO, PASS],
      botones: [BOTON],
    });
    expect(corteDuro(inv)).toBeNull();
  });

  it('la pregunta de seguridad corta: esa respuesta no se adivina', () => {
    const c = corteDuro(INV({ texto: 'Responde tu pregunta de seguridad para continuar' }));
    expect(c?.clase).toBe('pregunta_seguridad');
    expect(c?.motivo).toMatch(/no se adivina/i);
  });

  it('el cambio de contraseña obligatorio corta, por el texto', () => {
    const c = corteDuro(INV({ texto: 'Tu contraseña ha expirado. Debes cambiar tu contraseña.' }));
    expect(c?.clase).toBe('cambio_contrasena');
  });

  it('y también por la FORMA: dos campos de contraseña visibles no son un login', () => {
    const c = corteDuro(INV({
      campos: [PASS, campo({ type: 'password', id: 'Confirm', name: 'Confirm' })],
    }));
    expect(c?.clase).toBe('cambio_contrasena');
  });

  it('la cuenta bloqueada corta y lo dice: insistir alarga el bloqueo', () => {
    const c = corteDuro(INV({ texto: 'Tu cuenta está bloqueada por demasiados intentos fallidos.' }));
    expect(c?.clase).toBe('cuenta_bloqueada');
    expect(c?.motivo).toMatch(/no se vuelve a intentar/i);
  });

  it('la cuenta bloqueada GANA sobre el captcha de la misma pantalla', () => {
    // Un portal que bloqueó la cuenta suele seguir enseñando su login con
    // captcha. Llamarle «captcha» mandaría a resolver el muro equivocado.
    const c = corteDuro(INV({
      texto: 'Cuenta bloqueada. Intenta más tarde.',
      captcha: ['https://www.google.com/recaptcha/api.js'],
    }));
    expect(c?.clase).toBe('cuenta_bloqueada');
  });
});

describe('credencialRechazada — el candado innegociable', () => {
  it('lo caza en español y dice que NO se reintenta', () => {
    const c = credencialRechazada(INV({ texto: 'Usuario o contraseña incorrectos' }));
    expect(c?.clase).toBe('credencial_invalida');
    expect(c?.motivo).toMatch(/NO se vuelve a intentar/);
    expect(c?.motivo).toMatch(/bloquee la cuenta/i);
  });

  it('lo caza en inglés y con otras redacciones del mismo hecho', () => {
    expect(credencialRechazada(INV({ texto: 'Invalid username or password' }))?.clase).toBe('credencial_invalida');
    expect(credencialRechazada(INV({ texto: 'Los datos de acceso son incorrectos' }))?.clase).toBe('credencial_invalida');
    expect(credencialRechazada(INV({ texto: 'El correo y la contraseña no coinciden' }))?.clase).toBe('credencial_invalida');
  });

  it('NO lo ve donde no lo hay: un login en blanco no es un rechazo', () => {
    expect(credencialRechazada(INV({ campos: [USUARIO, PASS], texto: 'Escribe tu usuario y tu contraseña' }))).toBeNull();
  });

  it('no vive dentro de `corteDuro`: solo se mira DESPUÉS de enviar', () => {
    // Mirarlo antes convertiría el mensaje que dejó un intento humano fallido
    // en un candado que nadie pidió.
    expect(corteDuro(INV({ texto: 'Usuario o contraseña incorrectos' }))).toBeNull();
  });
});

describe('camposDeEntrada — qué se llena, leído de la página', () => {
  it('encuentra el usuario por su nombre y la contraseña por su `type`', () => {
    const c = camposDeEntrada(INV({ campos: [USUARIO, PASS], botones: [BOTON] }));
    expect(c).toEqual({ usuario: '#Usuario', contrasena: '#Password', boton: '#btnEntrar' });
  });

  it('cae a `[name="…"]` cuando el campo no tiene id', () => {
    const c = camposDeEntrada(INV({
      campos: [campo({ name: 'correo' }), campo({ type: 'password', name: 'clave' })],
    }));
    expect(c).toEqual({ usuario: '[name="correo"]', contrasena: '[name="clave"]', boton: null });
  });

  it('sin campo de contraseña NO inventa nada', () => {
    expect(camposDeEntrada(INV({ campos: [USUARIO] }))).toBeNull();
  });

  it('con contraseña pero sin ningún campo de texto identificable, tampoco', () => {
    expect(camposDeEntrada(INV({ campos: [PASS] }))).toBeNull();
  });

  it('elige el campo de texto ANTERIOR a la contraseña cuando ninguno se nombra', () => {
    // El buscador de sucursales que algunos portales ponen DESPUÉS del login
    // no puede ganarle al campo de usuario.
    const c = camposDeEntrada(INV({
      campos: [campo({ id: 'txt1' }), PASS, campo({ id: 'txtBuscar' })],
    }));
    expect(c?.usuario).toBe('#txt1');
  });

  it('ignora la contraseña OCULTA de Megasur y toma la visible', () => {
    const c = camposDeEntrada(INV({
      campos: [
        campo({ type: 'password', id: 'oculto', visible: false }),
        USUARIO,
        PASS,
      ],
    }));
    expect(c?.contrasena).toBe('#Password');
  });
});
