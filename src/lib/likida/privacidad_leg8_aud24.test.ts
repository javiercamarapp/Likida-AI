import { describe, it, expect } from 'vitest';
import { avisoIntegral, type DatosIntegral } from './privacidad';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24, LEG-8 (MEDIO, reincidente ×3): el contacto de emergencia del
// operador (`contacto_emergencia`, 0198 — nombre, teléfono, parentesco de un
// familiar que nunca aceptó ningún aviso) no aparecía en ningún aviso.
// ═══════════════════════════════════════════════════════════════════════════

const FLOTA: DatosIntegral = {
  razonSocial: 'TRANSPORTES DEL SURESTE SA DE CV',
  domicilio: 'Av. Itzáes 500, Mérida, Yucatán',
  urlAvisoIntegral: 'https://transportesdelsureste.mx/privacidad',
  contactoPrivacidad: null,
  gps: 'sin_conector',
};

describe('LEG-8 · el aviso integral enumera el contacto de emergencia', () => {
  it('declara el nombre, teléfono y parentesco del contacto, y su única finalidad', () => {
    const t = avisoIntegral(FLOTA).flatMap((s) => s.parrafos).join(' ');
    expect(t).toMatch(/contacto de emergencia/i);
    expect(t).toMatch(/parentesco/i);
    expect(t).toMatch(/no le llama por su cuenta|Likida no le llama/i);
  });
});
