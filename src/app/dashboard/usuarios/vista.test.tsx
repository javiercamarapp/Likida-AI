import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VistaUsuarios, type UsuarioRow } from './vista';
import { ROLES_INVITABLES } from '@/lib/auth/invitar';

// ═══════════════════════════════════════════════════════════════════════════
// USUARIOS & ROLES, PROBADA SOBRE EL RENDER (patrón seccion-credenciales, C2).
//
// Lo que se fija: invitar es CONTROL y la forma solo se pinta al dueño; el
// teléfono dice la verdad (número canónico, o que el bot NO reconoce a esa
// persona); y una lectura caída no se pinta como equipo vacío — que es la
// mentira que `exigir()` existe para evitar en el resto del panel.
// ═══════════════════════════════════════════════════════════════════════════

const accion = async () => null;

const CONTADOR_CON_TEL: UsuarioRow = {
  id: 'u-1', nombre: 'Ana Ruiz', email: 'ana@flota.mx', rol: 'contador', telefono: '524771234567',
  activo: true, desactivadoEn: null,
};
const ENCARGADO_SIN_TEL: UsuarioRow = {
  id: 'u-2', nombre: null, email: 'trafico@flota.mx', rol: 'encargado', telefono: null,
  activo: true, desactivadoEn: null,
};
const EX_CONTADOR: UsuarioRow = {
  id: 'u-3', nombre: 'Ex Despacho', email: 'ex@contadores.mx', rol: 'contador', telefono: null,
  activo: false, desactivadoEn: '2026-10-15T18:00:00Z',
};

const acciones = { invitar: accion, cambiarRol: accion, darDeBaja: accion, reactivar: accion, reenviarAcceso: accion };

function pintar(p: { usuarios: UsuarioRow[] | null; puedeInvitar: boolean; userId?: string }) {
  return renderToStaticMarkup(
    <VistaUsuarios
      usuarios={p.usuarios}
      userId={p.userId ?? 'u-9'}
      puedeInvitar={p.puedeInvitar}
      roles={ROLES_INVITABLES}
      acciones={acciones}
    />,
  );
}

describe('la forma de invitar solo se pinta al dueño', () => {
  it('con puedeInvitar, la forma está y su ayuda dice la verdad de cada rol', () => {
    const html = pintar({ usuarios: [CONTADOR_CON_TEL], puedeInvitar: true });
    expect(html).toContain('Invitar a alguien de tu equipo');
    // La ayuda por rol sale de AREAS_POR_ROL, no de marketing: el encargado
    // no ve dinero, el contador no despacha, el dueño ve todo.
    expect(html).toContain('No ve un peso');
    expect(html).toContain('No despacha viajes');
    expect(html).toContain('Todo el panel');
    // Y el teléfono dice para qué sirve.
    expect(html).toContain('el bot no la reconoce');
  });

  it('sin puedeInvitar no hay forma, y se dice por qué en vez de esconderla en silencio', () => {
    const html = pintar({ usuarios: [CONTADOR_CON_TEL], puedeInvitar: false });
    expect(html).not.toContain('Invitar a alguien de tu equipo');
    expect(html).toContain('decisión del dueño de la flota');
  });

  it('la forma NO ofrece superadmin: el catálogo son los tres invitables', () => {
    const html = pintar({ usuarios: [], puedeInvitar: true });
    expect(html).not.toContain('value="superadmin"');
    for (const r of ROLES_INVITABLES) expect(html).toContain(`value="${r.valor}"`);
  });
});

describe('la lista dice la verdad de cada renglón', () => {
  it('pinta rol y teléfono canónico cuando lo hay', () => {
    const html = pintar({ usuarios: [CONTADOR_CON_TEL], puedeInvitar: true });
    expect(html).toContain('contador');
    expect(html).toContain('524771234567');
  });

  it('sin teléfono dice la consecuencia, no un guion: el bot no lo reconoce', () => {
    const html = pintar({ usuarios: [ENCARGADO_SIN_TEL], puedeInvitar: true });
    expect(html).toContain('sin WhatsApp — el bot no lo reconoce');
  });

  it('sin nombre cae al correo — un invitado recién dado de alta no es un renglón anónimo', () => {
    const html = pintar({ usuarios: [ENCARGADO_SIN_TEL], puedeInvitar: true });
    expect(html).toContain('trafico@flota.mx');
  });

  it('marca "(tú)" solo en la fila de la sesión', () => {
    const html = pintar({ usuarios: [CONTADOR_CON_TEL, ENCARGADO_SIN_TEL], puedeInvitar: true, userId: 'u-2' });
    expect(html.match(/\(tú\)/g)).toHaveLength(1);
  });

  it('el rol se pinta con su rótulo de roles.ts, no con el valor crudo', () => {
    const html = pintar({ usuarios: [CONTADOR_CON_TEL], puedeInvitar: false });
    expect(html).toContain('Contador');
    expect(html).not.toContain('>contador<');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24, SEG-1 / H5: la baja, el cambio de rol y el reenvío EXISTEN.
// Aquí decía «no promete baja ni cambio de rol» y la pantalla lo confesaba
// textual; ahora se fija lo contrario, y a quién se le ofrece.
// ═══════════════════════════════════════════════════════════════════════════
describe('gestión del equipo: baja, rol y reenvío', () => {
  it('el dueño ve Dar de baja, Cambiar rol y Reenviar acceso en cada cuenta activa ajena', () => {
    const html = pintar({ usuarios: [CONTADOR_CON_TEL], puedeInvitar: true });
    expect(html).toContain('Dar de baja');
    expect(html).toContain('Cambiar rol');
    expect(html).toContain('Reenviar acceso');
    expect(html).not.toContain('todavía no existe');
  });

  it('a un rol sin puedeAdministrar no se le pinta ninguna acción, y se le dice por qué', () => {
    const html = pintar({ usuarios: [CONTADOR_CON_TEL], puedeInvitar: false });
    expect(html).not.toContain('Dar de baja');
    expect(html).not.toContain('Cambiar rol');
    expect(html).toContain('decisión del dueño de la flota');
  });

  it('la propia cuenta no se ofrece para baja ni cambio de rol', () => {
    const html = pintar({ usuarios: [CONTADOR_CON_TEL], puedeInvitar: true, userId: 'u-1' });
    expect(html).not.toContain('Dar de baja');
    expect(html).toContain('la administra otro dueño');
  });

  it('una cuenta dada de baja sigue en la lista, dice desde cuándo, y solo ofrece Reactivar', () => {
    const html = pintar({ usuarios: [EX_CONTADOR], puedeInvitar: true });
    expect(html).toContain('dada de baja');
    expect(html).toContain('Reactivar');
    expect(html).not.toContain('Dar de baja');
    expect(html).not.toContain('Reenviar acceso');
  });

  it('una fila de superadmin no se administra desde el panel del cliente', () => {
    const html = pintar({ usuarios: [{ ...CONTADOR_CON_TEL, id: 'u-s', rol: 'superadmin' }], puedeInvitar: true });
    expect(html).toContain('Cuenta de Likida');
    expect(html).not.toContain('Dar de baja');
  });

  it('la pantalla dice que hay bitácora y revocación de sesión — porque las hay', () => {
    const html = pintar({ usuarios: [CONTADOR_CON_TEL], puedeInvitar: true });
    expect(html).toContain('bitácora de auditoría');
    expect(html).toContain('su sesión se revoca');
  });
});

describe('lectura caída ≠ equipo vacío', () => {
  it('null pinta el error y NO la lista ni el vacío', () => {
    const html = pintar({ usuarios: null, puedeInvitar: true });
    expect(html).toContain('No se pudo cargar el equipo');
    expect(html).not.toContain('No hay cuentas dadas de alta');
    // Con la lectura ciega tampoco se ofrece invitar: no se sabe qué hay.
    expect(html).not.toContain('Invitar a alguien de tu equipo');
  });

  it('el vacío real sí lo dice, con la forma disponible para el dueño', () => {
    const html = pintar({ usuarios: [], puedeInvitar: true });
    expect(html).toContain('No hay cuentas dadas de alta');
    expect(html).toContain('Invitar a alguien de tu equipo');
  });
});
