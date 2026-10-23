// A37-S45-01: nadie lee la marca de disputa; el mensaje no puede prometer revisión.
import { describe, it, expect } from 'vitest';
import { mensajeCorregir } from './acuse_ticket';

describe('mensajeCorregir — no promete lo que nadie hace', () => {
  for (const marcado of [true, false]) {
    it(`marcado=${marcado}: no dice que la oficina lo revisará ni lo comparará`, () => {
      const m = mensajeCorregir(marcado);
      expect(m).not.toMatch(/lo marqué/i);
      expect(m).not.toMatch(/tu oficina lo va a comparar/i);
      expect(m).toMatch(/no se entera sola/i);
      expect(m).toMatch(/no me mandes otra foto/i);
    });
  }
});
