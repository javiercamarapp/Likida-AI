import { describe, it, expect } from 'vitest';
import { anclaDe, planificar } from './planificador';
import { CONFIG_CONDUCTOR_DEFAULT, type ConfigConductor } from './config';
import { hitoVacio, viajeBase } from './memoria.fixture';
import { TIPOS_HITO, type HitoFila, type TipoHito } from './tipos';

// T-A5-05: el ancla de los viajes que entran por archivo. Hora de México = UTC-6; 2026-10-06 es martes.
// Citas y folios 100 % sintéticos.
const mx = (hhmm: string, dia = '2026-10-06') => new Date(`${dia}T${hhmm}:00-06:00`);
const cfg = (c: Partial<ConfigConductor> = {}): ConfigConductor => ({ ...CONFIG_CONDUCTOR_DEFAULT, solicitudesMin: [0, 15, 30, 45], diasSemana: [1, 2, 3, 4, 5, 6, 7], esperaCargaMin: 120, ...c });
const hitos = (estados: Partial<Record<TipoHito, Partial<HitoFila>>> = {}): HitoFila[] =>
  TIPOS_HITO.map((tipo, i) => hitoVacio({ id: `h${i}`, tipo, viajeId: 'v1', ...(estados[tipo] ?? {}) }));

const importado = (extra = {}) => viajeBase({ aceptadoEn: mx('05:00').toISOString(), aceptadoOrigen: 'importacion', ...extra });
const delChofer = (extra = {}) => viajeBase({ aceptadoEn: mx('05:00').toISOString(), aceptadoOrigen: 'chofer', ...extra });

describe('anclaDe — viajes de importación', () => {
  it('salida de carga SIN llegada registrada: cita de carga + espera de carga (07:00 + 120 min = 09:00)', () => {
    const a = anclaDe(hitos()[1], importado({ citaOrigenEn: mx('07:00').toISOString() }), hitos(), cfg({ esperaCargaMin: 120 }));
    expect(a?.toISOString()).toBe(mx('09:00').toISOString());
  });

  it('salida de carga sin llegada y sin cita: no hay ancla (no cae a aceptación + 8 h)', () => {
    expect(anclaDe(hitos()[1], importado(), hitos(), cfg())).toBeNull();
  });

  it('salida de carga CON llegada registrada: manda la llegada, igual que siempre', () => {
    const hs = hitos({ llegada_carga: { estado: 'recibido', fuente: 'texto', mensajeEn: mx('08:00').toISOString(), recibidoEn: mx('08:00').toISOString() } });
    const a = anclaDe(hs[1], importado({ citaOrigenEn: mx('07:00').toISOString() }), hs, cfg({ esperaCargaMin: 90 }));
    expect(a?.toISOString()).toBe(mx('09:30').toISOString());
  });

  it('llegada a carga sin cita ni ETA: sin ancla (no se inventa uno desde la aceptación)', () => {
    expect(anclaDe(hitos()[0], importado(), hitos(), cfg())).toBeNull();
  });

  it('llegada a carga con cita: igual que un viaje del chofer', () => {
    const v = { citaOrigenEn: mx('09:00').toISOString() };
    expect(anclaDe(hitos()[0], importado(v), hitos(), cfg())?.toISOString()).toBe(anclaDe(hitos()[0], delChofer(v), hitos(), cfg())?.toISOString());
  });
});

describe('anclaDe — no regresión para el flujo del chofer', () => {
  it('chofer, llegada a carga sin cita: aceptación + plazo por defecto (como antes)', () => {
    const a = anclaDe(hitos()[0], delChofer(), hitos(), cfg({ esperaSinCitaMin: 120 }));
    expect(a?.toISOString()).toBe(mx('07:00').toISOString());
  });

  it('chofer, salida de carga sin llegada: respaldo de aceptación + trayecto (como antes)', () => {
    const a = anclaDe(hitos()[1], delChofer({ citaOrigenEn: mx('07:00').toISOString() }), hitos(), cfg({ trayectoSinEtaMin: 480 }));
    expect(a?.toISOString()).toBe(mx('13:00').toISOString());
  });

  it('origen nulo (filas viejas): se comporta como el chofer', () => {
    const a = anclaDe(hitos()[0], viajeBase({ aceptadoEn: mx('05:00').toISOString(), aceptadoOrigen: null }), hitos(), cfg({ esperaSinCitaMin: 120 }));
    expect(a?.toISOString()).toBe(mx('07:00').toISOString());
  });
});

describe('planificar — viajes de importación', () => {
  const entrada = (viaje: ReturnType<typeof viajeBase>, ahora: Date) =>
    planificar({ viaje, hitos: hitos(), config: cfg(), enviadosHoyChofer: 0, avisos: [], ahora });

  it('sin cita: {tipo:nada, motivo:sin_cita_importada} aunque pasen horas desde la aceptación', () => {
    expect(entrada(importado(), mx('12:00'))).toEqual({ tipo: 'nada', motivo: 'sin_cita_importada' });
  });

  it('con cita 07:00 (anticipo 30): a las 06:29 todavía no toca y a las 06:30 se le escribe al chofer', () => {
    const v = importado({ citaOrigenEn: mx('07:00').toISOString(), operadorTelefono: '+520000000000' });
    expect(entrada(v, mx('06:29'))).toEqual({ tipo: 'nada', motivo: 'no_toca' });
    expect(entrada(v, mx('06:30')).tipo).toBe('chofer');
  });

  it('el viaje del chofer sin cita sigue persiguiéndose por la aceptación (no regresión)', () => {
    const v = delChofer({ operadorTelefono: '+520000000000' });
    expect(entrada(v, mx('07:00')).tipo).toBe('chofer');
  });
});
