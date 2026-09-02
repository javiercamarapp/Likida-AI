import { describe, it, expect } from 'vitest';
import { avisoProspectos } from './privacidad';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24, LEG-4 (ALTO): `avisoProspectos` sustituía el dato ausente por
// un marcador rojo (🔴 razón social pendiente 🔴) DENTRO de la misma frase
// donde iría el nombre real de la responsable — un documento público que se
// leía como roto, no "en actualización". Se reemplaza por una frase completa
// y honesta, igual que hace `avisoIntegral` para el mismo caso.
// ═══════════════════════════════════════════════════════════════════════════

const CON_DATOS = { razonSocial: 'Likida Operaciones SA de CV', domicilio: 'Calle 43 147A, Mérida, Yuc.', contacto: 'privacidad@likida.ai' };
const SIN_DATOS = { razonSocial: null, domicilio: null, contacto: 'privacidad@likida.ai' };

describe('LEG-4 · avisoProspectos sin marcadores rojos hardcodeados', () => {
  it('con los datos capturados, los pinta tal cual — sin emoji', () => {
    const s = avisoProspectos(CON_DATOS)[0];
    expect(s.pendiente).toBe(false);
    expect(s.parrafos[0]).toContain('Likida Operaciones SA de CV');
    expect(s.parrafos[0]).toContain('Calle 43 147A, Mérida, Yuc.');
    expect(s.parrafos.join(' ')).not.toMatch(/🔴/);
  });

  it('sin los datos, dice "en actualización" en vez de imprimir un marcador rojo', () => {
    const s = avisoProspectos(SIN_DATOS)[0];
    expect(s.pendiente).toBe(true);
    const texto = s.parrafos.join(' ');
    expect(texto).not.toMatch(/🔴/);
    expect(texto).toMatch(/en actualización/);
    // No inventa la razón social ni el domicilio.
    expect(texto).not.toMatch(/\*\*null\*\*/);
  });

  it('el aviso completo, en cualquiera de los dos casos, nunca trae el marcador rojo', () => {
    for (const d of [CON_DATOS, SIN_DATOS]) {
      const texto = avisoProspectos(d).flatMap((s) => s.parrafos).join(' ');
      expect(texto).not.toMatch(/🔴/);
    }
  });
});
