import { describe, it, expect } from 'vitest';
import { fechaLarga } from './saludo';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10, BAJO — "Martes, 4 De Agosto De 2026". `toLocaleDateString`
// da la fecha toda en minúsculas ("martes, 4 de agosto de 2026") y los tres
// paneles que la pintan (dashboard/page.tsx, admin/page.tsx,
// inicio-operacion.tsx) la subían con la clase CSS `capitalize` de
// Tailwind — que capitaliza CADA palabra, incluidos los dos "de". El
// arreglo capitaliza en JS, una sola vez, solo el primer carácter.
// ═══════════════════════════════════════════════════════════════════════════

describe('fechaLarga — capitalizada al inicio, no palabra por palabra', () => {
  it('el primer carácter sale en mayúscula', () => {
    const f = fechaLarga(new Date('2026-08-04T18:00:00.000Z')); // martes en CDMX
    expect(f.charAt(0)).toBe(f.charAt(0).toUpperCase());
  });

  it('las preposiciones "de" NO se capitalizan — el bug exacto de CSS `capitalize`', () => {
    const f = fechaLarga(new Date('2026-08-04T18:00:00.000Z'));
    expect(f).not.toMatch(/\bDe\b/);
    expect(f).toContain(' de ');
  });

  it('el resto de la fecha (día de la semana, mes) sigue en minúsculas', () => {
    const f = fechaLarga(new Date('2026-08-04T18:00:00.000Z'));
    expect(f).toBe('Martes, 4 de agosto de 2026');
  });
});
