import { describe, expect, it } from 'vitest';
import { MOTIVO_STAND_BY_PERFIL } from '@/lib/likida/peajes/superficie_perfil';
import { FUERA_DEL_PLAN, responder } from './respuestas';

describe('respuestas de reserva con lo fiscal fuera del plan', () => {
  it('dice que está fuera del plan (mismo texto que el servidor), no «todavía no hay datos»', () => {
    for (const q of ['IVA acreditable del periodo', 'litros de diésel elegibles']) {
      expect(responder(q, null, FUERA_DEL_PLAN).texto).toBe(MOTIVO_STAND_BY_PERFIL);
    }
  });
  it('sin dato (null) sigue diciendo que todavía no hay datos', () => {
    expect(responder('IVA acreditable del periodo', null, null).texto).toMatch(/Todavía no hay datos/i);
  });
});
