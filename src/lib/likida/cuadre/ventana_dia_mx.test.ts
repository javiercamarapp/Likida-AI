import { describe, it, expect } from 'vitest';
import { ventanaDelViaje, fechaDudosa } from './fecha_dudosa';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 18 · DAT-28 — LA VENTANA DEL VIAJE VIVÍA EN UTC.
//
// `ventanaDelViaje` cerraba con `ahora.toISOString().slice(0, 10)`, que es el
// día UTC. México va seis horas atrás: de las 18:00 a la medianoche, la
// función ya creía que era mañana. En esas seis horas —las de más tráfico de
// tickets, cuando el operador acaba su jornada— «un comprobante del futuro no
// existe» dejaba de existir: el ticket fechado MAÑANA entraba como bueno.
//
// Y al revés, el 31 de diciembre a las 18:30 de México UTC ya dice 1 de enero:
// `fechaDudosa` juzgaba el ejercicio contra el año que viene.
//
// Las dos primeras pruebas eran ROJAS antes de `hoyMx()`.
// ═══════════════════════════════════════════════════════════════════════════

describe('la ventana se calcula con el día de México, no con el de UTC', () => {
  it('a las 18:01 de México (00:01 UTC del día siguiente) HOY sigue siendo hoy', () => {
    // 2026-08-23T00:01Z = 2026-08-22 18:01 en Mérida.
    const v = ventanaDelViaje('2026-08-20', 3, new Date('2026-08-23T00:01:00Z'));
    expect(v.hoy).toBe('2026-08-22');
    expect(v.fechaMax).toBe('2026-08-22');
  });

  it('y por eso el ticket fechado MAÑANA sigue cayendo fuera de rango', () => {
    const v = ventanaDelViaje('2026-08-20', 3, new Date('2026-08-23T00:01:00Z'));
    expect(fechaDudosa('2026-08-23', v)).toBe('fuera_de_rango');
  });

  it('el 31 de diciembre por la tarde el ejercicio sigue siendo el que corre', () => {
    // 2027-01-01T00:30Z = 2026-12-31 18:30 en México. Con el día UTC, un
    // ticket del 31 de diciembre —el del día— se juzgaba contra 2027.
    const v = ventanaDelViaje('2026-12-28', 3, new Date('2027-01-01T00:30:00Z'));
    expect(v.hoy).toBe('2026-12-31');
    expect(fechaDudosa('2026-12-31', v)).toBeNull();
  });

  it('a media mañana de México el día es el mismo que en UTC (no se rompió nada)', () => {
    const v = ventanaDelViaje('2026-08-20', 3, new Date('2026-08-22T16:00:00Z'));
    expect(v).toEqual({ fechaMin: '2026-08-17', fechaMax: '2026-08-22', hoy: '2026-08-22' });
  });
});

describe('la tolerancia se cuenta desde el inicio del viaje, en días completos', () => {
  it('tres días antes del inicio, exactos', () => {
    const v = ventanaDelViaje('2026-05-10', 3, new Date('2026-05-12T20:00:00Z'));
    expect(v.fechaMin).toBe('2026-05-07');
    expect(fechaDudosa('2026-05-07', v)).toBeNull();
    expect(fechaDudosa('2026-05-06', v)).toBe('fuera_de_rango');
  });

  it('un viaje SIN fecha de inicio ancla en el día de México, no en el de UTC', () => {
    // Antes anclaba en `ahora` (con hora): la resta de días caía a media tarde
    // y `fechaMin` se corría un día según el huso.
    const v = ventanaDelViaje(null, 2, new Date('2026-08-23T03:00:00Z')); // 21:00 del 22 en MX
    expect(v.hoy).toBe('2026-08-22');
    expect(v.fechaMin).toBe('2026-08-20');
  });
});
