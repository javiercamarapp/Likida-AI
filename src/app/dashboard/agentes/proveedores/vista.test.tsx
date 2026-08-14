import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SeccionBuzon } from './vista';

// ═══════════════════════════════════════════════════════════════════════════
// EL GATEO DEL BUZÓN, PROBADO SOBRE EL RENDER (C1, auditoría 4).
//
// Lo que se fija: generar/rotar es CONTROL y el botón solo se pinta al dueño
// (`puedeAdministrar`); los estados degradados dicen la verdad — una lectura
// caída NO se enseña como "sin buzón", y sin RESEND_EMAIL_DOMAIN se dice qué
// falta en vez de armar una dirección que no existe. Mismo patrón que
// `tablero-operacion.test.tsx`: se renderiza el componente REAL.
// ═══════════════════════════════════════════════════════════════════════════

const accion = async () => null;
const acciones = { generarBuzon: accion, rotarBuzon: accion };
const DIRECCION = 'f-abcdefghjkmnpqrstvwxyz23@mail.likida.ai';

function pintar(p: {
  buzon: { token: string | null; direccion: string | null } | null;
  dominioConfigurado: boolean;
  puedeAdministrarBuzon: boolean;
}) {
  return renderToStaticMarkup(<SeccionBuzon {...p} acciones={acciones} />);
}

describe('SeccionBuzon — estados honestos', () => {
  it('lectura caída: dice que no se pudo leer y NO ofrece generar', () => {
    const html = pintar({ buzon: null, dominioConfigurado: true, puedeAdministrarBuzon: true });
    expect(html).toContain('No se pudo leer el buzón');
    // Ofrecer "Generar" sobre una lectura caída rotaría un buzón vivo sin querer.
    expect(html).not.toContain('Generar dirección');
    expect(html).not.toContain('Rotar');
  });

  it('sin RESEND_EMAIL_DOMAIN: dice QUÉ falta y no pinta botones', () => {
    const html = pintar({
      buzon: { token: null, direccion: null }, dominioConfigurado: false, puedeAdministrarBuzon: true,
    });
    expect(html).toContain('RESEND_EMAIL_DOMAIN');
    expect(html).not.toContain('Generar dirección');
  });
});

describe('SeccionBuzon — el gateo por rol', () => {
  it('con buzón y siendo dueño: la dirección completa Y el rotar (con su advertencia antes)', () => {
    const html = pintar({
      buzon: { token: 'abcdefghjkmnpqrstvwxyz23', direccion: DIRECCION },
      dominioConfigurado: true, puedeAdministrarBuzon: true,
    });
    expect(html).toContain(DIRECCION);
    expect(html).toContain('Rotar e invalidar la anterior');
    expect(html).toContain('invalida la actual en el acto');
  });

  it('con buzón sin ser dueño: la dirección se ve (es dato de la flota), rotar NO', () => {
    const html = pintar({
      buzon: { token: 'abcdefghjkmnpqrstvwxyz23', direccion: DIRECCION },
      dominioConfigurado: true, puedeAdministrarBuzon: false,
    });
    expect(html).toContain(DIRECCION);
    expect(html).not.toContain('Rotar');
  });

  it('sin buzón y siendo dueño: el botón de generar', () => {
    const html = pintar({
      buzon: { token: null, direccion: null }, dominioConfigurado: true, puedeAdministrarBuzon: true,
    });
    expect(html).toContain('Generar dirección');
  });

  it('sin buzón sin ser dueño: sin botón, y se dice a quién pedírselo', () => {
    const html = pintar({
      buzon: { token: null, direccion: null }, dominioConfigurado: true, puedeAdministrarBuzon: false,
    });
    expect(html).not.toContain('Generar dirección');
    expect(html).toContain('dueño de la flota');
  });
});
