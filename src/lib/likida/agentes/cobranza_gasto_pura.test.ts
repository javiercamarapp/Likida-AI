import { describe, it, expect } from 'vitest';
import {
  motivoFaltante, planearCobroGasto, armarMensajeGastos, parametrosPlantillaGastos, validarConfigGasto,
  calcularEfectividad, cupoRestante, diasDesde, inicioDelDiaMx, CONFIG_GASTO_DEFAULT, MAX_ITEMS_MENSAJE,
  type GastoDeOperador, type ConfigGasto, type ContactoMedible,
} from './cobranza_gasto_pura';

const AHORA = new Date('2026-10-02T16:00:00Z');
const hace = (dias: number) => new Date(AHORA.getTime() - dias * 86_400_000).toISOString();

const OP1 = { operadorId: 'op-1', nombre: 'Juan Pérez', telefono: '5210000000001' };
const OP2 = { operadorId: 'op-2', nombre: 'Luis Gómez', telefono: null };

function gasto(id: string, extra: Partial<GastoDeOperador> = {}): GastoDeOperador {
  return {
    id, viajeId: 'v-1', folioViaje: 'F-1042', concepto: 'diesel', monto: 1200, fecha: '2026-09-29',
    creadoEn: hace(2), imagenUrl: 'fotos/x.jpg', cfdiUuid: null, ocrConfianza: 0.9,
    cfdiEsquemaAlterno: null, estadoSat: null, operador: OP1, ...extra,
  };
}
const CFG: ConfigGasto = { ...CONFIG_GASTO_DEFAULT, porGasto: true };

describe('motivoFaltante — qué comprobante falta de qué gasto', () => {
  it('un diésel con foto legible y sin CFDI: falta la factura', () => {
    expect(motivoFaltante(gasto('g'), CFG)).toBe('sin_cfdi');
  });
  it('sin foto y sin CFDI: falta todo comprobante', () => {
    expect(motivoFaltante(gasto('g', { imagenUrl: null }), CFG)).toBe('sin_foto');
  });
  it('foto con lectura por debajo del umbral y sin CFDI: ilegible', () => {
    expect(motivoFaltante(gasto('g', { ocrConfianza: 0.3 }), CFG)).toBe('foto_ilegible');
    expect(motivoFaltante(gasto('g', { ocrConfianza: 0.5 }), CFG)).toBe('sin_cfdi'); // el umbral es estricto
  });
  it('una confianza NO medida (null) no se acusa de ilegible: no se inventa un diagnóstico', () => {
    expect(motivoFaltante(gasto('g', { ocrConfianza: null, concepto: 'alimentacion' }), CFG)).toBeNull();
  });
  it('un CFDI cancelado ante el SAT ya no es comprobante, aunque traiga UUID', () => {
    expect(motivoFaltante(gasto('g', { cfdiUuid: 'U-1', estadoSat: 'cancelado' }), CFG)).toBe('cfdi_cancelado');
  });
  it('con CFDI vigente no falta nada', () => {
    expect(motivoFaltante(gasto('g', { cfdiUuid: 'U-1', estadoSat: 'vigente' }), CFG)).toBeNull();
  });
  it('un concepto que no exige factura con ticket legible no se cobra', () => {
    expect(motivoFaltante(gasto('g', { concepto: 'alimentacion' }), CFG)).toBeNull();
    expect(motivoFaltante(gasto('g', { concepto: 'alimentacion' }), { ...CFG, conceptosCfdi: ['alimentacion'] })).toBe('sin_cfdi');
  });
  it('el esquema alterno (monedero / carta porte) no se cobra por falta de CFDI individual', () => {
    expect(motivoFaltante(gasto('g', { cfdiEsquemaAlterno: true }), CFG)).toBeNull();
  });
});

describe('planearCobroGasto — cadencia escalonada por gasto y fusión por chofer', () => {
  it('un gasto de 2 días con cadencia 1/3/7 toca el tier 1 y los gastos de un chofer van en UN grupo', () => {
    const plan = planearCobroGasto(
      [gasto('g1'), gasto('g2', { imagenUrl: null, monto: 300 })], CFG, new Map(), AHORA,
    );
    expect(plan.paraContactar).toHaveLength(1);
    expect(plan.paraContactar[0].items.map((i) => [i.gastoId, i.tier, i.motivo])).toEqual([
      ['g1', 1, 'sin_cfdi'], ['g2', 1, 'sin_foto'],
    ]);
  });

  it('el tier consume los menores: tras contactar el 3 no vuelve el 1, y el 7 llega a su día', () => {
    const g = gasto('g1', { creadoEn: hace(4) });
    expect(planearCobroGasto([g], CFG, new Map([['g1', [1]]]), AHORA).paraContactar[0].items[0].tier).toBe(3);
    expect(planearCobroGasto([g], CFG, new Map([['g1', [3]]]), AHORA).paraContactar).toHaveLength(0);
    const viejo = gasto('g1', { creadoEn: hace(8) });
    expect(planearCobroGasto([viejo], CFG, new Map([['g1', [3]]]), AHORA).paraContactar[0].items[0].tier).toBe(7);
  });

  it('un gasto de hoy (0 días) no alcanza ningún tier: está pendiente pero NO en la cola', () => {
    const plan = planearCobroGasto([gasto('g1', { creadoEn: hace(0) })], CFG, new Map(), AHORA);
    expect(plan.paraContactar).toHaveLength(0);
    expect(plan.pendientes).toHaveLength(1);
    expect(plan.pendientes[0].tier).toBeNull();
  });

  it('el chofer sin teléfono va aparte, dicho, y no pierde su lugar', () => {
    const plan = planearCobroGasto([gasto('g1'), gasto('g2', { operador: OP2 })], CFG, new Map(), AHORA);
    expect(plan.paraContactar.map((g) => g.operador.operadorId)).toEqual(['op-1']);
    expect(plan.sinTelefono.map((g) => g.operador.operadorId)).toEqual(['op-2']);
  });

  it('lo resuelto no aparece en ningún lado', () => {
    const plan = planearCobroGasto([gasto('g1', { cfdiUuid: 'U', estadoSat: 'vigente' })], CFG, new Map(), AHORA);
    expect(plan.pendientes).toHaveLength(0);
    expect(plan.paraContactar).toHaveLength(0);
  });

  it('el grupo más atrasado va primero y dentro del grupo lo más viejo primero', () => {
    const plan = planearCobroGasto([
      gasto('a', { creadoEn: hace(2), operador: { ...OP1, operadorId: 'op-a' } }),
      gasto('b', { creadoEn: hace(9), operador: { ...OP1, operadorId: 'op-b' } }),
      gasto('c', { creadoEn: hace(4), operador: { ...OP1, operadorId: 'op-b' } }),
    ], CFG, new Map(), AHORA);
    expect(plan.paraContactar.map((g) => g.operador.operadorId)).toEqual(['op-b', 'op-a']);
    expect(plan.paraContactar[0].items.map((i) => i.gastoId)).toEqual(['b', 'c']);
  });
});

describe('el mensaje fusionado y la plantilla de respaldo', () => {
  const items = planearCobroGasto([gasto('g1'), gasto('g2', { imagenUrl: null, concepto: 'caseta', monto: 85.5 })], CFG, new Map(), AHORA)
    .paraContactar[0].items;

  it('dice QUÉ falta de CADA gasto, con concepto, monto, fecha y viaje — sin inventar nada', () => {
    const t = armarMensajeGastos(items, 'Tráfico Norte', 'Hazlo hoy.');
    expect(t).toContain('Te faltan comprobantes de 2 gastos');
    expect(t).toContain('· Diésel $1,200.00');
    expect(t).toContain('(viaje F-1042): falta la factura (CFDI)');
    expect(t).toContain('· Casetas $85.50');
    expect(t).toContain('falta la foto del ticket');
    expect(t).toContain('Hazlo hoy.');
    expect(t).toContain('— Tráfico Norte');
  });

  it('en singular y con tope de renglones: resume el resto en vez de mandar un muro de texto', () => {
    expect(armarMensajeGastos(items.slice(0, 1), '', '')).toContain('Te falta el comprobante de 1 gasto');
    const muchos = Array.from({ length: MAX_ITEMS_MENSAJE + 3 }, (_, i) => ({ ...items[0], gastoId: `g${i}` }));
    const t = armarMensajeGastos(muchos, '', '');
    expect(t.split('\n').filter((l) => l.startsWith('· '))).toHaveLength(MAX_ITEMS_MENSAJE);
    expect(t).toContain('…y 3 más');
  });

  it('la plantilla lleva 3 parámetros de una sola línea y sin valores vacíos', () => {
    const [nombre, cuantos, primero] = parametrosPlantillaGastos('  Juan\n Pérez ', items);
    expect(nombre).toBe('Juan Pérez');
    expect(cuantos).toBe('2');
    expect(primero).not.toMatch(/\n/);
    expect(primero).toContain('Diésel');
    expect(parametrosPlantillaGastos(null, items)[0]).toBe('Operador');
    expect(parametrosPlantillaGastos(null, [])[2]).toBe('revisa tus gastos');
  });
});

describe('tope diario', () => {
  it('cupoRestante nunca baja de cero', () => {
    expect(cupoRestante(0, 1)).toBe(1);
    expect(cupoRestante(1, 1)).toBe(0);
    expect(cupoRestante(5, 2)).toBe(0);
  });
  it('inicioDelDiaMx es la medianoche de México, no la de UTC', () => {
    // 2026-10-02 03:30Z es todavía el 1-oct a las 21:30 en México.
    expect(inicioDelDiaMx(new Date('2026-10-02T03:30:00Z')).toISOString()).toBe('2026-10-01T06:00:00.000Z');
    expect(inicioDelDiaMx(new Date('2026-10-02T16:00:00Z')).toISOString()).toBe('2026-10-02T06:00:00.000Z');
  });
  it('diasDesde cuenta días completos y tolera fechas ilegibles', () => {
    expect(diasDesde(hace(2.5), AHORA)).toBe(2);
    expect(diasDesde('basura', AHORA)).toBe(0);
    expect(diasDesde(new Date(AHORA.getTime() + 86_400_000).toISOString(), AHORA)).toBe(0);
  });
});

describe('validarConfigGasto', () => {
  it('normaliza y ordena', () => {
    expect(validarConfigGasto({ porGasto: true, tiersGasto: [7, 1, 3], maxMensajesDia: 2, conceptosCfdi: ['diesel', 'diesel'], umbralFoto: 0.6 }))
      .toEqual({ ok: { porGasto: true, tiersGasto: [1, 3, 7], maxMensajesDia: 2, conceptosCfdi: ['diesel'], umbralFoto: 0.6 } });
  });
  it.each([
    [{ tiersGasto: [] }], [{ tiersGasto: [1, 1] }], [{ tiersGasto: [1, 2, 3, 4, 5, 6] }], [{ tiersGasto: [0] }],
    [{ maxMensajesDia: 0 }], [{ maxMensajesDia: 4 }], [{ umbralFoto: 0.05 }], [{ umbralFoto: 0.99 }],
    [{ conceptosCfdi: ['mordidas'] }],
  ])('rechaza %j', (c) => {
    expect('error' in validarConfigGasto(c)).toBe(true);
  });
});

describe('calcularEfectividad', () => {
  const c = (extra: Partial<ContactoMedible>): ContactoMedible => ({
    tier: 1, motivo: 'sin_cfdi', enviado: true, creadoEn: '2026-10-01T10:00:00Z', resueltoEn: null, resueltoPor: null, ...extra,
  });
  it('mide solo lo ENVIADO y calcula tasa y mediana', () => {
    const e = calcularEfectividad([
      c({ resueltoEn: '2026-10-01T12:00:00Z', resueltoPor: 'chofer' }),
      c({ resueltoEn: '2026-10-01T16:00:00Z', resueltoPor: 'chofer', tier: 3 }),
      c({ resueltoEn: '2026-10-02T10:00:00Z', resueltoPor: 'cierre', tier: 3 }),
      c({}),
      c({ motivo: 'sin_foto' }),
      c({ enviado: false }),
    ]);
    expect(e).toMatchObject({ avisos: 5, resueltosPorChofer: 2, cerradosSinResolver: 1, abiertos: 2 });
    expect(e.tasa).toBeCloseTo(0.4);
    expect(e.medianaHoras).toBe(4); // horas: 2 y 6 → 4
    expect(e.porTier).toEqual([{ tier: 1, avisos: 3, resueltos: 1 }, { tier: 3, avisos: 2, resueltos: 1 }]);
    expect(e.porMotivo.find((m) => m.motivo === 'sin_foto')).toEqual({ motivo: 'sin_foto', avisos: 1, resueltos: 0 });
  });
  it('con menos de 5 avisos no publica un porcentaje; sin resueltos no hay mediana', () => {
    const e = calcularEfectividad([c({}), c({})]);
    expect(e.tasa).toBeNull();
    expect(e.medianaHoras).toBeNull();
    expect(calcularEfectividad([]).avisos).toBe(0);
  });
});
