import { describe, it, expect } from 'vitest';
import { rutinasVencidas, validarRutina, type RutinaRow, type UnidadTaller, type UltimoServicio } from './mantenimiento';
import { DatoInvalido } from './errores';

const HOY = new Date('2026-08-27T12:00:00Z');

const rutina = (p: Partial<RutinaRow> = {}): RutinaRow => ({
  id: 'r1', nombre: 'Servicio mayor', cadaDias: null, cadaKm: null, activa: true, ...p,
});
const unidad = (p: Partial<UnidadTaller> = {}): UnidadTaller => ({
  id: 'u1', numeroEconomico: 'T-01', kmActual: null, activo: true, ...p,
});
const servicio = (p: Partial<UltimoServicio> = {}): UltimoServicio => ({
  rutinaId: 'r1', unidadId: 'u1', cerradaEn: '2026-01-01T00:00:00Z', kmServicio: null, ...p,
});

describe('rutinasVencidas — el reloj de días', () => {
  it('vence cuando pasaron los días pactados desde el último servicio', () => {
    const r = rutinasVencidas(
      [rutina({ cadaDias: 90 })], [unidad()],
      [servicio({ cerradaEn: '2026-05-01T00:00:00Z' })], HOY, // 118 días
    );
    expect(r).toHaveLength(1);
    expect(r[0].motivo).toBe('vencida_por_dias');
    expect(r[0].diasDesdeServicio).toBe(118);
  });

  it('NO vence dentro del plazo', () => {
    const r = rutinasVencidas(
      [rutina({ cadaDias: 90 })], [unidad()],
      [servicio({ cerradaEn: '2026-08-01T00:00:00Z' })], HOY, // 26 días
    );
    expect(r).toHaveLength(0);
  });

  it('usa el servicio MÁS RECIENTE cuando hay varios', () => {
    const r = rutinasVencidas(
      [rutina({ cadaDias: 90 })], [unidad()],
      [servicio({ cerradaEn: '2025-01-01T00:00:00Z' }), servicio({ cerradaEn: '2026-08-01T00:00:00Z' })],
      HOY,
    );
    expect(r).toHaveLength(0); // el reciente manda: 26 días, al día
  });
});

describe('rutinasVencidas — el reloj de kilómetros y su honestidad', () => {
  it('vence por km cuando el odómetro declarado rebasa la cadencia', () => {
    const r = rutinasVencidas(
      [rutina({ cadaKm: 10_000 })], [unidad({ kmActual: 95_000 })],
      [servicio({ cerradaEn: '2026-08-01T00:00:00Z', kmServicio: 80_000 })], HOY,
    );
    expect(r).toHaveLength(1);
    expect(r[0].motivo).toBe('vencida_por_km');
    expect(r[0].kmDesdeServicio).toBe(15_000);
  });

  it('rutina SOLO por km sin odómetro declarado → sin_odometro, jamás "al día" en silencio', () => {
    const r = rutinasVencidas(
      [rutina({ cadaKm: 10_000 })], [unidad({ kmActual: null })],
      [servicio({ cerradaEn: '2026-08-01T00:00:00Z', kmServicio: 80_000 })], HOY,
    );
    expect(r).toHaveLength(1);
    expect(r[0].motivo).toBe('sin_odometro');
  });

  it('con reloj de días de respaldo, la falta de odómetro no grita: decide el reloj de días', () => {
    const alDia = rutinasVencidas(
      [rutina({ cadaDias: 90, cadaKm: 10_000 })], [unidad({ kmActual: null })],
      [servicio({ cerradaEn: '2026-08-01T00:00:00Z' })], HOY,
    );
    expect(alDia).toHaveLength(0);
  });

  it('"lo que ocurra primero": con días y km, vence en cuanto CUALQUIERA vence', () => {
    const r = rutinasVencidas(
      [rutina({ cadaDias: 365, cadaKm: 10_000 })], [unidad({ kmActual: 95_000 })],
      [servicio({ cerradaEn: '2026-08-01T00:00:00Z', kmServicio: 80_000 })], HOY,
    );
    expect(r).toHaveLength(1);
    expect(r[0].motivo).toBe('vencida_por_km');
  });
});

describe('rutinasVencidas — historial y filtros', () => {
  it('sin historial se PROPONE como arranque, no se afirma vencida', () => {
    const r = rutinasVencidas([rutina({ cadaDias: 90 })], [unidad()], [], HOY);
    expect(r).toHaveLength(1);
    expect(r[0].motivo).toBe('sin_historial');
    expect(r[0].diasDesdeServicio).toBeNull();
  });

  it('rutina inactiva y unidad inactiva no proponen nada', () => {
    expect(rutinasVencidas([rutina({ cadaDias: 1, activa: false })], [unidad()], [], HOY)).toHaveLength(0);
    expect(rutinasVencidas([rutina({ cadaDias: 1 })], [unidad({ activo: false })], [], HOY)).toHaveLength(0);
  });

  it('el reloj de una unidad no contamina a otra', () => {
    const r = rutinasVencidas(
      [rutina({ cadaDias: 90 })],
      [unidad(), unidad({ id: 'u2', numeroEconomico: 'T-02' })],
      [servicio({ unidadId: 'u1', cerradaEn: '2026-08-01T00:00:00Z' })], HOY,
    );
    // u1 al día; u2 sin historial
    expect(r).toHaveLength(1);
    expect(r[0].unidadId).toBe('u2');
    expect(r[0].motivo).toBe('sin_historial');
  });
});

describe('validarRutina', () => {
  it('acepta días, km o ambos; normaliza el nombre', () => {
    expect(validarRutina({ nombre: '  Servicio   mayor ', cadaDias: '90', cadaKm: '' }))
      .toEqual({ nombre: 'Servicio mayor', cadaDias: 90, cadaKm: null });
    expect(validarRutina({ nombre: 'Afinación', cadaDias: '', cadaKm: '10000' }).cadaKm).toBe(10_000);
  });

  it('rechaza la rutina sin ninguna cadencia — sin reloj no hay rutina', () => {
    expect(() => validarRutina({ nombre: 'Vacía', cadaDias: '', cadaKm: '' })).toThrow(DatoInvalido);
  });

  it('rechaza cadencias no enteras, cero o negativas', () => {
    expect(() => validarRutina({ nombre: 'X', cadaDias: '0', cadaKm: '' })).toThrow(DatoInvalido);
    expect(() => validarRutina({ nombre: 'X', cadaDias: '', cadaKm: '-5' })).toThrow(DatoInvalido);
    expect(() => validarRutina({ nombre: 'X', cadaDias: '7.5', cadaKm: '' })).toThrow(DatoInvalido);
  });

  it('rechaza el nombre vacío', () => {
    expect(() => validarRutina({ nombre: '   ', cadaDias: '30', cadaKm: '' })).toThrow(DatoInvalido);
  });
});
