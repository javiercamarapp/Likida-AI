import { describe, expect, it } from 'vitest';
import { HORAS_HABILES_SILENCIO, evaluarSilencio, horasHabilesEntre } from './silencio';

// Hora de la CDMX (UTC-6): lunes 9-nov-2026 a las 10:00 = 16:00Z.
const lunes10 = Date.UTC(2026, 10, 9, 16, 0, 0);
const h = (n: number) => n * 3_600_000;

describe('horasHabilesEntre (lunes a sábado, 8:00 a 20:00 CDMX)', () => {
  it('cuenta las horas corridas dentro del horario', () => {
    expect(horasHabilesEntre(lunes10, lunes10 + h(3))).toBeCloseTo(3);
  });
  it('la noche no cuenta: de 18:00 a 9:00 del día siguiente son 2 + 1 horas hábiles', () => {
    const lunes18 = Date.UTC(2026, 10, 10, 0, 0, 0);
    expect(horasHabilesEntre(lunes18, lunes18 + h(15))).toBeCloseTo(3);
  });
  it('el domingo no cuenta', () => {
    const sabado19 = Date.UTC(2026, 10, 15, 1, 0, 0); // sábado 14-nov 19:00 CDMX
    // sábado 19-20 (1 h) + domingo (0) + lunes 8:00-9:00 (1 h)
    expect(horasHabilesEntre(sabado19, sabado19 + h(38))).toBeCloseTo(2);
  });
  it('rangos vacíos o invertidos dan 0', () => {
    expect(horasHabilesEntre(lunes10, lunes10)).toBe(0);
    expect(horasHabilesEntre(lunes10, lunes10 - 1)).toBe(0);
  });
});

describe('regla de silencio del webhook', () => {
  const ahora = lunes10 + h(HORAS_HABILES_SILENCIO + 1);
  it('con viajes abiertos y 0 eventos jamás NO alarma: es una fuente sin conectar', () => {
    // Nunca hubo un evento: la fuente no está conectada (flota nueva). No es silencio y no alarma.
    const r = evaluarSilencio({ viajesAbiertos: 3, ultimoEvento: { leido: true, ms: null }, ahoraMs: ahora });
    expect(r.estado).toBe('sin_conectar');
    expect(r.hayAlerta).toBe(false);
  });
  it('con viajes abiertos y el último evento hace más del umbral hábil: alerta', () => {
    const r = evaluarSilencio({ viajesAbiertos: 24, ultimoEvento: { leido: true, ms: lunes10 }, ahoraMs: ahora });
    expect(r.hayAlerta).toBe(true);
    expect(r.horasHabilesSinEvento).toBeGreaterThanOrEqual(HORAS_HABILES_SILENCIO);
  });
  it('SIN viajes abiertos no hay alerta, aunque no haya eventos', () => {
    const r = evaluarSilencio({ viajesAbiertos: 0, ultimoEvento: { leido: true, ms: null }, ahoraMs: ahora });
    expect(r.estado).toBe('sin_viajes');
    expect(r.hayAlerta).toBe(false);
  });
  it('un evento reciente (dentro del umbral) no alerta', () => {
    const r = evaluarSilencio({ viajesAbiertos: 5, ultimoEvento: { leido: true, ms: ahora - h(2) }, ahoraMs: ahora });
    expect(r.estado).toBe('ok');
    expect(r.hayAlerta).toBe(false);
  });
  it('de noche el reloj no corre: 14 horas corridas de madrugada no son silencio', () => {
    const noche = Date.UTC(2026, 10, 10, 2, 0, 0); // lunes 20:00 CDMX
    const r = evaluarSilencio({ viajesAbiertos: 5, ultimoEvento: { leido: true, ms: noche }, ahoraMs: noche + h(12) });
    expect(r.hayAlerta).toBe(false);
  });
  it('lo no leído es «sin dato»: ni alerta ni calma', () => {
    expect(evaluarSilencio({ viajesAbiertos: null, ultimoEvento: { leido: true, ms: null }, ahoraMs: ahora })).toMatchObject({ estado: 'sin_dato', hayAlerta: false });
    expect(evaluarSilencio({ viajesAbiertos: 4, ultimoEvento: { leido: false }, ahoraMs: ahora })).toMatchObject({ estado: 'sin_dato', hayAlerta: false });
  });
});
