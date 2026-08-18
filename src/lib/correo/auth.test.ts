import { describe, it, expect, afterEach } from 'vitest';
import {
  caducidadEnPalabras,
  correoDeAuth,
  correoDeAvisoAuth,
  destinoPermitido,
  hookDeCorreoConfigurado,
  minutosDeCaducidad,
  urlDeVerificacion,
  type AccionAuth,
  type AvisoAuth,
} from './auth';
import { armarHtml, aTextoPlano } from './plantilla';

// ═══════════════════════════════════════════════════════════════════════════
// LOS CORREOS DE ACCESO. Lo que se fija aquí es lo que separa este correo del
// de fábrica de Supabase: que sea de Likida, que esté en español, que diga
// CUÁNDO caduca, y —lo único que puede hacer daño— que la liga no pueda
// apuntar a un dominio ajeno.
// ═══════════════════════════════════════════════════════════════════════════

const BASE = 'https://app.likida.ai';
const SB = 'https://abcdefgh.supabase.co';

afterEach(() => {
  delete process.env.AUTH_CORREO_CADUCIDAD_MIN;
});

describe('la liga NO puede llevar a un dominio ajeno', () => {
  it('deja pasar un destino del propio dominio', () => {
    expect(destinoPermitido(`${BASE}/auth/callback?next=/dashboard`, BASE))
      .toBe(`${BASE}/auth/callback?next=/dashboard`);
  });

  it('un dominio ajeno cae al callback propio, no se propaga', () => {
    // Es EL riesgo del correo de acceso: un token válido entregado en un
    // correo con nuestro remitente y nuestro logo, hacia un sitio de otro.
    expect(destinoPermitido('https://likida.ai.evil.com/roba', BASE)).toBe(`${BASE}/auth/callback`);
    expect(destinoPermitido('https://evil.com/roba', BASE)).toBe(`${BASE}/auth/callback`);
  });

  it('el mismo host por http tampoco pasa: se compara el ORIGEN completo', () => {
    expect(destinoPermitido('http://app.likida.ai/auth/callback', BASE)).toBe(`${BASE}/auth/callback`);
  });

  it('sin destino, o con basura, cae al callback en vez de romperse', () => {
    expect(destinoPermitido(undefined, BASE)).toBe(`${BASE}/auth/callback`);
    expect(destinoPermitido('no-es-una-url', BASE)).toBe(`${BASE}/auth/callback`);
  });
});

describe('la URL de verificación', () => {
  it('apunta al verificador de Supabase con el hash y el tipo traducido', () => {
    const u = new URL(urlDeVerificacion({ supabaseUrl: SB, tokenHash: 'abc123', accion: 'login', base: BASE }));
    expect(u.origin).toBe(SB);
    expect(u.pathname).toBe('/auth/v1/verify');
    expect(u.searchParams.get('token')).toBe('abc123');
    // `login` en el payload, `magiclink` en el verificador: traducirlo mal
    // produce un enlace que abre y falla, y eso parece un bug de sesión.
    expect(u.searchParams.get('type')).toBe('magiclink');
  });

  it('las dos mitades del cambio de correo verifican como email_change', () => {
    for (const accion of ['email_change_current', 'email_change_new'] as AccionAuth[]) {
      const u = new URL(urlDeVerificacion({ supabaseUrl: SB, tokenHash: 't', accion, base: BASE }));
      expect(u.searchParams.get('type')).toBe('email_change');
    }
  });

  it('el redirect_to pasa por la lista de permitidos antes de entrar a la liga', () => {
    const u = new URL(urlDeVerificacion({
      supabaseUrl: SB, tokenHash: 't', accion: 'login', base: BASE,
      redirectTo: 'https://evil.com/roba',
    }));
    expect(u.searchParams.get('redirect_to')).toBe(`${BASE}/auth/callback`);
  });
});

describe('la caducidad se DICE, no se insinúa', () => {
  it('el default son los 60 minutos de fábrica de Supabase (mailer_otp_exp 3600 s)', () => {
    expect(minutosDeCaducidad()).toBe(60);
  });

  it('se puede pisar cuando el proyecto cambia su OTP expiration', () => {
    process.env.AUTH_CORREO_CADUCIDAD_MIN = '15';
    expect(minutosDeCaducidad()).toBe(15);
  });

  it('un valor imposible NO se cree: se cae al default en vez de prometer mal', () => {
    for (const malo of ['0', '-5', 'ayer', '99999']) {
      process.env.AUTH_CORREO_CADUCIDAD_MIN = malo;
      expect(minutosDeCaducidad()).toBe(60);
    }
  });

  it('se dice como lo diría una persona', () => {
    expect(caducidadEnPalabras(15)).toBe('15 minutos');
    expect(caducidadEnPalabras(60)).toBe('1 hora');
    expect(caducidadEnPalabras(120)).toBe('2 horas');
    expect(caducidadEnPalabras(90)).toBe('90 minutos');
  });
});

describe('el correo de acceso (magic link) — el que ve un contralor primero', () => {
  const c = correoDeAuth({ accion: 'login', liga: `${SB}/auth/v1/verify?token=t`, codigo: '123456', minutos: 60 });

  it('está en español y dice cuándo caduca — no "expires shortly"', () => {
    expect(c.asunto).toBe('Tu acceso a Likida');
    expect(c.parrafos.join(' ')).toContain('1 hora');
    expect(JSON.stringify(c)).not.toMatch(/sign in|expires shortly/i);
  });

  it('lleva la liga literal: los escáneres corporativos queman el enlace del botón', () => {
    expect(c.enlaceLiteral).toBe(true);
    expect(c.boton?.href).toContain('/auth/v1/verify');
  });

  it('NO pinta el código de 6 dígitos: hoy no hay pantalla donde teclearlo', () => {
    // Un código sin dónde capturarse es un callejón sin salida con aire de
    // instrucción. El día que /login tenga esa pantalla, se enciende aquí.
    expect(c.codigo).toBeUndefined();
    expect(aTextoPlano(c)).not.toContain('123456');
  });

  it('trae la línea que lo vuelve inofensivo para quien no lo pidió', () => {
    expect(c.nota).toMatch(/Si no fuiste tú/);
    expect(c.nota).toMatch(/jamás te va a pedir/i);
  });

  it('sale por la plantilla de la marca: logo incrustado y pie', () => {
    const html = armarHtml(c);
    expect(html).toContain('cid:likida-logo');
    expect(html).toContain(c.porQueLoRecibes);
    expect(html).toContain('Entrar a Likida');
  });
});

describe('todas las acciones quedan redactadas', () => {
  const TODAS: AccionAuth[] = [
    'login', 'signup', 'invite', 'recovery',
    'email_change', 'email_change_current', 'email_change_new', 'reauthentication',
  ];

  it.each(TODAS)('%s tiene asunto, avance, cuerpo y pie propios', (accion) => {
    const c = correoDeAuth({ accion, liga: `${SB}/auth/v1/verify?token=t`, codigo: '123456', minutos: 60 });
    expect(c.asunto.length).toBeGreaterThan(8);
    expect(c.avance.length).toBeGreaterThan(8);
    expect(c.parrafos.length).toBeGreaterThan(0);
    expect(c.porQueLoRecibes.length).toBeGreaterThan(8);
    // Con el hook encendido, Supabase ya no manda nada por su cuenta: una
    // acción sin redactar no llegaría fea — no llegaría.
    expect(armarHtml(c)).toContain('cid:likida-logo');
  });

  it('todas menos la reautenticación llevan botón; la reautenticación lleva código', () => {
    for (const accion of TODAS) {
      const c = correoDeAuth({ accion, liga: `${SB}/auth/v1/verify?token=t`, codigo: '123456', minutos: 60 });
      if (accion === 'reauthentication') {
        expect(c.boton).toBeUndefined();
        expect(c.codigo).toBe('123456');
        expect(armarHtml(c)).toContain('123456');
      } else {
        expect(c.boton?.href).toContain('/auth/v1/verify');
      }
    }
  });

  it('el cambio de correo nombra la dirección nueva y sube el tono', () => {
    const c = correoDeAuth({
      accion: 'email_change', liga: 'https://x.co/v', codigo: '1', minutos: 60,
      correoNuevo: 'nuevo@flota.mx',
    });
    expect(c.parrafos.join(' ')).toContain('nuevo@flota.mx');
    expect(c.tono).toBe('atencion');
    expect(c.nota).toMatch(/NO abras el enlace/);
  });

  it('sin dirección nueva no se inventa una', () => {
    const c = correoDeAuth({ accion: 'email_change', liga: 'https://x.co/v', codigo: '1', minutos: 60 });
    expect(c.parrafos.join(' ')).toContain('la dirección nueva');
    expect(c.parrafos.join(' ')).not.toContain('undefined');
  });
});

describe('el secreto del hook se mide, pero no se sobreafirma', () => {
  it('dice si está puesto', () => {
    delete process.env.SUPABASE_AUTH_HOOK_SECRET;
    expect(hookDeCorreoConfigurado()).toBe(false);
    process.env.SUPABASE_AUTH_HOOK_SECRET = 'v1,whsec_abc';
    expect(hookDeCorreoConfigurado()).toBe(true);
    delete process.env.SUPABASE_AUTH_HOOK_SECRET;
  });
});

describe('los avisos de seguridad — las siete que nadie mira hasta que importan', () => {
  const TODOS: AvisoAuth[] = [
    'email_changed', 'password_changed', 'phone_changed',
    'mfa_enrolled', 'mfa_unenrolled', 'identity_linked', 'identity_unlinked',
  ];

  it.each(TODOS)('%s sale con la marca, en español y sin botón', (tipo) => {
    const c = correoDeAvisoAuth(tipo);
    const html = armarHtml(c, { logo: 'url' });
    expect(html).toContain('/images/logo.png');
    expect(c.boton).toBeUndefined();      // no hay nada que confirmar
    expect(c.codigo).toBeUndefined();
    expect(c.asunto).toMatch(/Likida/);
    expect(JSON.stringify(c)).not.toMatch(/your |was changed|contact support/i);
  });

  it.each(TODOS)('%s dice qué hacer si no fuiste tú, y que no se puede apagar', (tipo) => {
    const c = correoDeAvisoAuth(tipo);
    expect(c.nota).toMatch(/Si no fuiste tú/);
    // Un aviso de seguridad silenciable no es un aviso: el pie lo dice.
    expect(c.porQueLoRecibes).toMatch(/no se pueden desactivar/);
  });

  it('las variables Go de Supabase sobreviven el escapado', () => {
    // Las rellena el motor de Supabase, no el nuestro. No traen < & ni
    // comillas, así que pasan intactas por esc() — sin sentinela.
    const html = armarHtml(correoDeAvisoAuth('identity_linked'), { logo: 'url' });
    expect(html).toContain('{{ .Provider }}');
    expect(html).toContain('{{ .Email }}');
    expect(armarHtml(correoDeAvisoAuth('email_changed'))).toContain('{{ .OldEmail }}');
    expect(armarHtml(correoDeAvisoAuth('mfa_enrolled'))).toContain('{{ .FactorType }}');
  });

  it('quitar un candado pesa más que ponerlo', () => {
    // Agregar un factor es rutina; quitarlo es la señal de que alguien está
    // debilitando la cuenta. El tono lo distingue con una palabra, no con
    // una banda de color.
    expect(correoDeAvisoAuth('mfa_enrolled').tono).toBeUndefined();
    expect(correoDeAvisoAuth('mfa_unenrolled').tono).toBe('atencion');
    expect(correoDeAvisoAuth('identity_linked').tono).toBeUndefined();
    expect(correoDeAvisoAuth('identity_unlinked').tono).toBe('atencion');
  });

  it('la de contraseña NO finge que Likida tiene contraseñas', () => {
    // Likida entra por enlace (decisión 4-ago, no se reabre). Si este correo
    // llega, significa que alguien le puso una contraseña a la cuenta — y eso
    // es lo que dice, en vez de traducir el texto de fábrica.
    const c = correoDeAvisoAuth('password_changed');
    expect(c.parrafos.join(' ')).toMatch(/no usa contraseña/);
    expect(c.tono).toBe('urgente');
  });
});
