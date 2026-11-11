import { describe, it, expect } from 'vitest';
import { semaforoSalud, armarTuTurno, filasCalidad, estadoReal, MAX_TU_TURNO, type EntradaSemaforo } from './centro-mando';
import type { ItemClasificado } from './guardia';
import type { AgenteParado } from './agentes-parados';
import type { CalidadAgente } from './calidad-agentes';

const SANO: EntradaSemaforo = {
  guardia: { juicio: 'ok', haceMin: 3, baseCaidaDesde: null, appCaidaDesde: null },
  bandeja: { s2: 0, fuentesCiegas: 0 },
  extras: [],
  slos: [{ nombre: 'x', cumple: null }],
  frenadosPorBandeja: 0,
};

describe('semaforoSalud', () => {
  it('verde solo cuando todo se leyó y nada pide acción (un SLO sin muestra no es ceguera)', () => {
    expect(semaforoSalud(SANO).nivel).toBe('verde');
  });
  it('rojo si la guardia vio la base o la app caídas', () => {
    const s = semaforoSalud({ ...SANO, guardia: { ...SANO.guardia!, baseCaidaDesde: '2026-11-10T00:00:00Z' } });
    expect(s.nivel).toBe('rojo');
    expect(s.causas[0].href).toBe('/admin/salud-sistema');
    expect(semaforoSalud({ ...SANO, guardia: { ...SANO.guardia!, appCaidaDesde: '2026-11-10T00:00:00Z' } }).nivel).toBe('rojo');
  });
  it('amarillo con S2, cron caído, SLO roto, guardia vencida o agentes frenados', () => {
    expect(semaforoSalud({ ...SANO, bandeja: { s2: 2, fuentesCiegas: 0 } }).nivel).toBe('amarillo');
    expect(semaforoSalud({ ...SANO, extras: [{ id: 'cron_sin_latido', texto: 'x', href: '/admin/crons' }] }).nivel).toBe('amarillo');
    expect(semaforoSalud({ ...SANO, slos: [{ nombre: 'a', cumple: false }] }).nivel).toBe('amarillo');
    expect(semaforoSalud({ ...SANO, guardia: { ...SANO.guardia!, juicio: 'vencido', haceMin: 90 } }).nivel).toBe('amarillo');
    expect(semaforoSalud({ ...SANO, frenadosPorBandeja: 3 }).nivel).toBe('amarillo');
  });
  it('nunca verde con una lectura ciega, y lo dice', () => {
    for (const k of ['guardia', 'bandeja', 'extras', 'slos', 'frenadosPorBandeja'] as const) {
      const s = semaforoSalud({ ...SANO, [k]: null });
      expect(s.nivel, k).toBe('amarillo');
      expect(s.ciegas.length, k).toBeGreaterThan(0);
      expect(s.causas.some((c) => c.texto.includes('No se pudo leer'))).toBe(true);
    }
  });
  it('crons_ilegibles cuenta como ceguera, no como pendiente', () => {
    const s = semaforoSalud({ ...SANO, extras: [{ id: 'crons_ilegibles', texto: 'x', href: '/admin/crons' }] });
    expect(s.ciegas).toEqual(['los latidos de los crons']);
  });
});

const item = (o: Partial<ItemClasificado>): ItemClasificado => ({
  severidad: 'S3', regla: 'r', fuente: 'tickets', titulo: 't', flota: 'F', desde: '2026-11-01T00:00:00Z', vence: null, href: '/admin/soporte', ...o,
});

describe('armarTuTurno', () => {
  const ahora = Date.parse('2026-11-10T12:00:00Z');
  it('máximo 5 filas, con el total real y lo vencido primero', () => {
    const items = [
      ...Array.from({ length: 6 }, (_, i) => item({ titulo: `s3-${i}` })),
      item({ titulo: 'vencido', vence: '2026-11-09T00:00:00Z' }),
    ];
    const t = armarTuTurno({ items, envios: { urgentes: 1, normales: 0 }, frenados: 0 }, ahora);
    expect(t.filas).toHaveLength(MAX_TU_TURNO);
    expect(t.total).toBe(8);
    expect(t.filas[0].titulo).toBe('vencido');
    expect(t.filas[0].etiqueta).toBe('Vencido');
  });
  it('una lectura caída se dice y no se vuelve cero', () => {
    const t = armarTuTurno({ items: null, envios: null, frenados: null }, ahora);
    expect(t.filas).toEqual([]);
    expect(t.ciegas).toHaveLength(3);
  });
  it('sin nada pendiente devuelve vacío sin ciegas', () => {
    const t = armarTuTurno({ items: [], envios: { urgentes: 0, normales: 0 }, frenados: 0 }, ahora);
    expect(t.total).toBe(0);
    expect(t.ciegas).toEqual([]);
  });
});

const parado = (o: Partial<AgenteParado>): AgenteParado => ({
  agente: 'cobranza', nombre: null, ultimaCorrida: null, horasSinCorrer: null, motivo: null, causa: null, ...o,
});

describe('estado real y calidad por agente', () => {
  it('mapea la causa del salto', () => {
    expect(estadoReal(parado({ causa: 'contrapresion_bandeja' }), true)).toBe('bloqueado_bandeja');
    expect(estadoReal(parado({ causa: 'apagado' }), true)).toBe('sin_palanca');
    expect(estadoReal(parado({ causa: 'techo_diario' }), true)).toBe('sin_presupuesto');
    expect(estadoReal(parado({ causa: 'otra' }), true)).toBe('parado');
    expect(estadoReal(undefined, true)).toBe('corriendo');
    expect(estadoReal(undefined, false)).toBe('sin_dato');
  });
  it('une calidad y parados; lo nunca medido queda en null, no en 0', () => {
    const ag: CalidadAgente[] = [{
      agente: 'liquidacion',
      revision: { piezas: 10, revisadasPorHumano: 5, corregidas: 1, tasaRevisionHumana: 0.5, tasaCorreccion: 0.2 },
      escalada: { escaladas: null, tasa: null, nota: '' },
      corridas: { total: 12, medibles: 12, p50Ms: 1, p95Ms: 900, conCosto: 0, costoUsdTotal: null, costoPorCorridaUsd: null },
    }];
    const f = filasCalidad(ag, [parado({ agente: 'peajes', causa: 'otra' })]);
    expect(f.map((x) => x.agente)).toEqual(['peajes', 'liquidacion']);
    const liq = f[1];
    expect(liq.revisionHumana).toBe(0.5);
    expect(liq.p95Ms).toBe(900);
    expect(liq.corridas).toBe(12);
    expect(f[0].revisionHumana).toBeNull();
    expect(f[0].nivel).toBe('L0');
  });
  it('con la bitácora ilegible las corridas son null', () => {
    const f = filasCalidad(null, [parado({ agente: 'peajes' })]);
    expect(f[0].corridas).toBeNull();
  });
});
