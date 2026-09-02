import { describe, it, expect } from 'vitest';
import {
  parsearEmbudo, construirCohortes, mesMx, type TenantAlta, type UsoMensual,
} from './instrumentacion';

// La regla que estas pruebas custodian: «no medido» y «cero medido» son
// respuestas distintas. `producto_evento` nació con la 0251 — todo mes
// anterior a su primer evento tiene que salir null, jamás 0, o el estreno de
// la tabla se pintaría como churn total.

const T = (id: string, creadoEn: string): TenantAlta => ({ id, nombre: id, creadoEn });
const U = (tenantId: string, mes: string, eventos = 5): UsoMensual => ({ tenantId, mes, eventos });

describe('parsearEmbudo', () => {
  it('lee el jsonb de la RPC tal cual', () => {
    expect(parsearEmbudo({ altas: 3, activadas: 2, de_pago: 1 }))
      .toEqual({ altas: 3, activadas: 2, dePago: 1 });
  });

  it('un campo ausente o no numérico LANZA — nunca se rellena con 0', () => {
    expect(() => parsearEmbudo({ altas: 3, activadas: 2 })).toThrow('de_pago');
    expect(() => parsearEmbudo({ altas: '3', activadas: 2, de_pago: 1 })).toThrow('altas');
    expect(() => parsearEmbudo(null)).toThrow('no se inventa un 0');
    expect(() => parsearEmbudo({ altas: NaN, activadas: 2, de_pago: 1 })).toThrow('altas');
  });
});

describe('mesMx', () => {
  it('corta el mes en hora LOCAL de México, no en UTC', () => {
    // Las 04:00Z del 1-sep son las 22:00 del 31-ago en CDMX (UTC-6 fijo).
    expect(mesMx('2026-09-01T04:00:00Z')).toBe('2026-08');
    expect(mesMx('2026-09-01T12:00:00Z')).toBe('2026-09');
  });
});

describe('construirCohortes', () => {
  it('con la tabla VACÍA todo es null («no medido») y desdeMedicion es null — jamás un 0% inventado', () => {
    const r = construirCohortes([T('a', '2026-05-10T12:00:00Z')], [], '2026-08');
    expect(r.desdeMedicion).toBeNull();
    const celdas = r.filas[0].celdas;
    expect(celdas.length).toBeGreaterThan(0);
    expect(celdas.every((c) => c.activas === null)).toBe(true);
  });

  it('los meses ANTERIORES al primer evento salen null; desde ahí se mide de verdad', () => {
    const r = construirCohortes(
      [T('a', '2026-05-10T12:00:00Z'), T('b', '2026-05-20T12:00:00Z')],
      [U('a', '2026-08')],
      '2026-09',
    );
    expect(r.desdeMedicion).toBe('2026-08');
    const fila = r.filas[0];
    expect(fila.cohorte).toBe('2026-05');
    expect(fila.flotas).toBe(2);
    const por = new Map(fila.celdas.map((c) => [c.mes, c.activas]));
    expect(por.get('2026-05')).toBeNull();   // antes de medir: no medido
    expect(por.get('2026-07')).toBeNull();
    expect(por.get('2026-08')).toBe(1);      // medido: a usó, b no
    expect(por.get('2026-09')).toBe(0);      // medido: cero REAL, después del arranque
  });

  it('el cero medido tras el arranque SÍ es cero: una flota sin eventos en un mes medido cuenta como inactiva', () => {
    const r = construirCohortes([T('a', '2026-08-01T12:00:00Z')], [U('a', '2026-08')], '2026-09');
    const por = new Map(r.filas[0].celdas.map((c) => [c.mes, c.activas]));
    expect(por.get('2026-09')).toBe(0);
  });

  it('un GROUP BY con eventos=0 no cuenta como actividad', () => {
    const r = construirCohortes([T('a', '2026-08-01T12:00:00Z')], [U('a', '2026-08', 0)], '2026-08');
    // La fila existe (fija desdeMedicion) pero no vuelve activa a la flota.
    expect(r.desdeMedicion).toBe('2026-08');
    expect(r.filas[0].celdas.find((c) => c.mes === '2026-08')?.activas).toBe(0);
  });

  it('cada cohorte agrupa por mes de alta LOCAL MX y las filas salen ordenadas', () => {
    const r = construirCohortes(
      [
        T('viejo', '2026-03-15T12:00:00Z'),
        // 04:00Z del 1-abr = 22:00 del 31-mar en CDMX → cohorte 2026-03.
        T('frontera', '2026-04-01T04:00:00Z'),
        T('nuevo', '2026-06-02T12:00:00Z'),
      ],
      [],
      '2026-08',
    );
    expect(r.filas.map((f) => f.cohorte)).toEqual(['2026-03', '2026-06']);
    expect(r.filas[0].flotas).toBe(2);
  });

  it('el mes corriente viene marcado enCurso (celda incompleta por definición)', () => {
    const r = construirCohortes([T('a', '2026-07-01T12:00:00Z')], [U('a', '2026-07')], '2026-08');
    const celdas = r.filas[0].celdas;
    expect(celdas.find((c) => c.mes === '2026-08')?.enCurso).toBe(true);
    expect(celdas.find((c) => c.mes === '2026-07')?.enCurso).toBe(false);
  });

  it('la fila de una cohorte se acota a 12 meses — no crece para siempre', () => {
    const r = construirCohortes([T('a', '2024-01-15T12:00:00Z')], [], '2026-08');
    expect(r.filas[0].celdas.length).toBe(12);
  });
});
