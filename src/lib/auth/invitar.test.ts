import { describe, it, expect } from 'vitest';
import { validarInvitacion, descifrarErrorProvision, ROLES_INVITABLES } from './invitar';
import { DatoInvalido } from '@/lib/likida/errores';

// ═══════════════════════════════════════════════════════════════════════════
// LA PUERTA DEL DUEÑO (D6): validar antes de provisionar, traducir después.
//
// Lo que se fija: el rol es fail-closed contra el catálogo (`superadmin` se
// rechaza aunque el select nunca lo ofrezca — una server action es un POST
// alcanzable a mano); el teléfono corto rebota ANTES de crear nada, con el
// MISMO piso que `normalizarTelefonoOficina` (ni más laxo ni más estricto); y
// los dos errores duros de provisionar salen como `DatoInvalido` para que
// `mensajeParaPantalla` no los generice a "falla del sistema".
// ═══════════════════════════════════════════════════════════════════════════

const BASE = { email: 'contralor@flota.mx', nombre: '', rol: 'contador', telefono: '' };

describe('validarInvitacion — el correo', () => {
  it('acepta un correo normal y lo baja a minúsculas (Auth lo guarda así)', () => {
    const v = validarInvitacion({ ...BASE, email: '  Contralor@Flota.MX ' });
    expect(v.email).toBe('contralor@flota.mx');
  });

  it('vacío rebota diciendo para qué sirve', () => {
    expect(() => validarInvitacion({ ...BASE, email: '' })).toThrow(DatoInvalido);
    expect(() => validarInvitacion({ ...BASE, email: '   ' })).toThrow(/entrar al panel/);
  });

  it('sin forma de correo rebota con el valor tecleado', () => {
    expect(() => validarInvitacion({ ...BASE, email: 'contralor.flota.mx' })).toThrow(/no se ve como un correo/);
    expect(() => validarInvitacion({ ...BASE, email: 'a@b' })).toThrow(DatoInvalido);
  });
});

describe('validarInvitacion — el rol es fail-closed contra el catálogo', () => {
  it('acepta exactamente los tres invitables', () => {
    for (const r of ROLES_INVITABLES) {
      expect(validarInvitacion({ ...BASE, rol: r.valor }).rol).toBe(r.valor);
    }
  });

  it('superadmin se rechaza en el servidor aunque el select no lo ofrezca', () => {
    expect(() => validarInvitacion({ ...BASE, rol: 'superadmin' })).toThrow(DatoInvalido);
    expect(() => validarInvitacion({ ...BASE, rol: 'superadmin' })).toThrow(/Ningún otro se puede invitar/);
  });

  it('operador (sin login desde el 7-ago) y cualquier valor desconocido rebotan igual', () => {
    for (const rol of ['operador', 'admin', '', 'FLOTA_ADMIN']) {
      expect(() => validarInvitacion({ ...BASE, rol })).toThrow(DatoInvalido);
    }
  });
});

describe('validarInvitacion — el WhatsApp', () => {
  it('vacío es válido: el teléfono es opcional y no viaja como cadena vacía', () => {
    expect(validarInvitacion(BASE).telefono).toBeUndefined();
  });

  it('corto rebota ANTES de llamar a provisionar, contando los dígitos reales', () => {
    expect(() => validarInvitacion({ ...BASE, telefono: '477 123' })).toThrow(DatoInvalido);
    expect(() => validarInvitacion({ ...BASE, telefono: '477 123' })).toThrow(/6 dígitos/);
  });

  it('10 dígitos con separadores pasan TAL CUAL: normaliza provisionar, no esta capa', () => {
    expect(validarInvitacion({ ...BASE, telefono: ' 477 123 45 67 ' }).telefono).toBe('477 123 45 67');
  });

  it('12 dígitos (52+10) pasan — el piso es el de normalizarTelefonoOficina, no uno inventado', () => {
    expect(validarInvitacion({ ...BASE, telefono: '524771234567' }).telefono).toBe('524771234567');
  });
});

describe('validarInvitacion — el nombre', () => {
  it('opcional: vacío queda undefined, con texto se recorta', () => {
    expect(validarInvitacion(BASE).nombre).toBeUndefined();
    expect(validarInvitacion({ ...BASE, nombre: ' Ana Ruiz ' }).nombre).toBe('Ana Ruiz');
  });
});

describe('descifrarErrorProvision — los errores duros salen verbatim, el resto no', () => {
  it('el duplicado de Supabase Auth se traduce a DatoInvalido sin afirmar que "ya puede entrar"', () => {
    const d = descifrarErrorProvision(new Error('A user with this email address has already been registered'));
    expect(d).toBeInstanceOf(DatoInvalido);
    expect(d?.message).toMatch(/ya tiene una cuenta/);
    // La cuenta podría existir A MEDIAS (Auth sí, app_user no) o en otra
    // flota: afirmar que ya entra sería inventar.
    expect(d?.message).not.toMatch(/ya puede entrar/);
  });

  it('el índice único de app_user.email también cuenta como correo duplicado', () => {
    const d = descifrarErrorProvision(
      new Error('duplicate key value violates unique constraint "app_user_email_key"'),
    );
    expect(d).toBeInstanceOf(DatoInvalido);
  });

  it('el WhatsApp repetido (0059) dice que el alta NO se completó y qué cambiar', () => {
    const d = descifrarErrorProvision(
      new Error('duplicate key value violates unique constraint "app_user_telefono_uniq"'),
    );
    expect(d).toBeInstanceOf(DatoInvalido);
    expect(d?.message).toMatch(/no se completó/);
    expect(d?.message).toMatch(/otro número o sin WhatsApp/);
  });

  it('el teléfono corto de provisionar pasa con su propio mensaje (cinturón y tirantes)', () => {
    const d = descifrarErrorProvision(
      new Error('El teléfono "477" tiene 3 dígitos; un número mexicano necesita 10 más la lada 52.'),
    );
    expect(d).toBeInstanceOf(DatoInvalido);
    expect(d?.message).toMatch(/tiene 3 dígitos/);
  });

  it('un error desconocido devuelve null: debe seguir al log y al genérico honesto', () => {
    expect(descifrarErrorProvision(new Error('connection refused'))).toBeNull();
    expect(descifrarErrorProvision('no soy un Error')).toBeNull();
    expect(descifrarErrorProvision(null)).toBeNull();
  });
});

// ── SEG-7 (auditoría 24): el alta del dueño no es un oráculo de correos ──
describe('esCorreoYaRegistrado / mensajeAltaNeutro', () => {
  it('reconoce las tres formas del duplicado y nada más', async () => {
    const { esCorreoYaRegistrado } = await import('./invitar');
    expect(esCorreoYaRegistrado(new Error('A user with this email address has already been registered'))).toBe(true);
    expect(esCorreoYaRegistrado(new Error('email_exists'))).toBe(true);
    expect(esCorreoYaRegistrado(new Error('duplicate key value violates unique constraint "app_user_email_key"'))).toBe(true);
    expect(esCorreoYaRegistrado(new Error('fetch failed'))).toBe(false);
    expect(esCorreoYaRegistrado('no es Error')).toBe(false);
  });

  it('el mensaje neutro no afirma ni niega que el correo ya tuviera cuenta', async () => {
    const { mensajeAltaNeutro } = await import('./invitar');
    const m = mensajeAltaNeutro('x@flota.mx');
    expect(m).toContain('x@flota.mx');
    expect(m).toMatch(/Si .* no tenía cuenta/);
    expect(m).toMatch(/Si ya la tenía/);
    expect(m).not.toMatch(/ya tiene una cuenta registrada/);
  });
});
