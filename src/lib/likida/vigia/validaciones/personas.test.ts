import { describe, expect, it } from 'vitest';
import { resolverConfig } from './base';
import { validarFichaCompleta, validarFichaTexto, validarLicencia, validarOperadorDisponible } from './personas';
import { contextoBase, fichaBase } from './validaciones.fixture';

const cfg = resolverConfig();

describe('V04 licencia', () => {
  it('vigencia holgada: sin hallazgos', () => {
    expect(validarLicencia(fichaBase(), contextoBase(), cfg)).toEqual([]);
  });
  it('vencida a la fecha del servicio: bloqueo', () => {
    const f = fichaBase();
    f.operador!.vigenciaLicencia = '2026-11-23';
    const hs = validarLicencia(f, contextoBase(), cfg);
    expect(hs[0].severidad).toBe('bloqueo');
    expect(hs[0].mensaje).toContain('vencida');
  });
  it('vigente el mismo día del servicio no está vencida', () => {
    const f = fichaBase();
    f.operador!.vigenciaLicencia = '2026-11-24';
    expect(validarLicencia(f, contextoBase(), cfg)[0].severidad).toBe('aviso');
  });
  it('próxima a vencer (≤ días de aviso): aviso; configurable', () => {
    const f = fichaBase();
    f.operador!.vigenciaLicencia = '2026-12-10';
    expect(validarLicencia(f, contextoBase(), cfg)[0].severidad).toBe('aviso');
    expect(validarLicencia(f, contextoBase(), resolverConfig({ diasAvisoVigencia: 5 }))).toEqual([]);
  });
  it('vence durante el viaje estimado: bloqueo', () => {
    const f = fichaBase();
    f.operador!.vigenciaLicencia = '2026-11-24';
    f.salida = '2026-11-24T20:00';
    f.horasViaje = 10;
    expect(validarLicencia(f, contextoBase(), cfg)[0].mensaje).toContain('antes de que termine el viaje');
  });
  it('sin vigencia, «pendiente» o fecha inválida', () => {
    const f = fichaBase();
    delete f.operador!.vigenciaLicencia;
    expect(validarLicencia(f, contextoBase(), cfg)[0].datoAusente).toBe(true);
    f.operador!.vigenciaLicencia = 'PENDIENTE';
    expect(validarLicencia(f, contextoBase(), cfg)[0].datoAusente).toBe(true);
    f.operador!.vigenciaLicencia = '2026-02-31';
    expect(validarLicencia(f, contextoBase(), cfg)[0].severidad).toBe('bloqueo');
  });
  it('sin cita usa la fecha de referencia', () => {
    const f = fichaBase();
    delete f.cita;
    f.operador!.vigenciaLicencia = '2026-11-22';
    expect(validarLicencia(f, contextoBase(), cfg)[0].severidad).toBe('bloqueo');
  });
  it('el mensaje no repite la licencia ni la fecha', () => {
    const f = fichaBase();
    f.operador!.vigenciaLicencia = '2026-11-01';
    expect(JSON.stringify(validarLicencia(f, contextoBase(), cfg))).not.toContain('2026-11-01');
  });
});

describe('V10 ficha completa', () => {
  it('ficha completa: sin hallazgos', () => {
    expect(validarFichaCompleta(fichaBase(), contextoBase(), cfg)).toEqual([]);
  });
  it('campos ausentes o «pendiente» se reportan uno por uno, sin rellenar', () => {
    const f = fichaBase();
    f.operador!.nombre = 'PENDIENTE';
    delete f.unidad!.eco;
    const hs = validarFichaCompleta(f, contextoBase(), cfg);
    expect(hs.map((h) => h.camposInvolucrados[0]).sort()).toEqual(['operador.nombre', 'unidad.eco']);
    expect(hs.every((h) => h.datoAusente)).toBe(true);
  });
  it('celular cortado', () => {
    const f = fichaBase();
    f.operador!.celular = '55500011';
    expect(validarFichaCompleta(f, contextoBase(), cfg)[0].camposInvolucrados).toEqual(['operador.celular']);
    expect(validarFichaCompleta(f, contextoBase(), resolverConfig({ digitosCelular: 8 }))).toEqual([]);
  });
  it('nombre sin ambos apellidos', () => {
    const f = fichaBase();
    f.operador!.nombre = 'Operador Uno';
    expect(validarFichaCompleta(f, contextoBase(), cfg)[0].mensaje).toContain('apellidos');
  });
  it('blindado sin team, drop quitapon sin QP', () => {
    const f = fichaBase();
    f.blindado = true;
    f.dropQuitapon = true;
    const hs = validarFichaCompleta(f, contextoBase(), cfg);
    expect(hs.map((h) => h.camposInvolucrados[0]).sort()).toEqual(['qp', 'team.nombre']);
    f.team = { nombre: 'Operador Dos Apellido Tres' };
    f.qp = 'XX-1';
    expect(validarFichaCompleta(f, contextoBase(), cfg)).toEqual([]);
  });
  it('sensibles solo son obligatorios si la política los exige', () => {
    const f = fichaBase();
    delete f.operador!.licencia;
    expect(validarFichaCompleta(f, contextoBase(), cfg)).toEqual([]);
    expect(validarFichaCompleta(f, contextoBase(), resolverConfig({ exigirSensibles: true }))[0].camposInvolucrados).toEqual(['operador.licencia']);
  });
  it('QR con menos de 8 campos', () => {
    const f = fichaBase();
    f.modoQr = true;
    f.qr = { operador: 'x', placas: 'x', caja: 'x', color: 'x', anio: '2020', modelo: 'x' };
    const hs = validarFichaCompleta(f, contextoBase(), cfg);
    expect(hs[0].mensaje).toContain('6 de 8');
    expect(hs[0].camposInvolucrados).toEqual(['qr.marca', 'qr.linea']);
  });
  it('campos obligatorios configurables por cliente', () => {
    const f = fichaBase();
    const c = resolverConfig({ camposObligatorios: ['ref', 'qp'] });
    expect(validarFichaCompleta(f, contextoBase(), c)[0].camposInvolucrados).toEqual(['qp']);
  });
  it('en texto usa los faltantes de la plantilla reconocida', () => {
    const texto = 'Linea: LIN\nNumero: 1\nPlacas: AAA123';
    const hs = validarFichaTexto(texto);
    expect(hs.map((h) => h.camposInvolucrados[0])).toEqual(['estado']);
    expect(validarFichaTexto('hola')[0].severidad).toBe('info');
  });
});

describe('V12 operador no disponible', () => {
  it('disponible: sin hallazgos', () => {
    expect(validarOperadorDisponible(fichaBase(), contextoBase())).toEqual([]);
  });
  it('descanso o no disponible: bloqueo', () => {
    const f = fichaBase();
    f.operador!.estado = 'descanso';
    expect(validarOperadorDisponible(f, contextoBase())[0].severidad).toBe('bloqueo');
    f.operador!.estado = 'no_disponible';
    expect(validarOperadorDisponible(f, contextoBase())[0].severidad).toBe('bloqueo');
  });
  it('descanso que termina antes de la salida no bloquea', () => {
    const f = fichaBase();
    f.operador!.estado = 'descanso';
    f.operador!.descansoHasta = '2026-11-24T06:00';
    f.salida = '2026-11-24T08:00';
    expect(validarOperadorDisponible(f, contextoBase())).toEqual([]);
    f.operador!.descansoHasta = '2026-11-24T10:00';
    expect(validarOperadorDisponible(f, contextoBase())[0].severidad).toBe('bloqueo');
  });
  it('menos horas disponibles que el viaje: aviso', () => {
    const f = fichaBase();
    f.operador!.horasDisponibles = 6;
    f.horasViaje = 14;
    expect(validarOperadorDisponible(f, contextoBase())[0].severidad).toBe('aviso');
  });
  it('sin estado: dato ausente informativo', () => {
    const f = fichaBase();
    delete f.operador!.estado;
    expect(validarOperadorDisponible(f, contextoBase())[0].datoAusente).toBe(true);
  });
});
