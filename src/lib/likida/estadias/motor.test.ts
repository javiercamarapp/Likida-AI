import { describe, it, expect } from 'vitest';
import {
  armarEpisodios, calcularDetencion, resolverPolitica, resumirEstadias, ventanaDeViaje,
  type ContextoEstadias, type PoliticaDetencion, type ViajeParaEstadia,
} from './motor';

// El motor de estadías es puro: hitos + política + presencia entran, episodios
// salen. Cada prueba fija una regla de la casa — la que la rompa tiene que
// explicar por qué el episodio ahora miente.

const AHORA = '2026-08-25T20:00:00.000Z';

const politica = (horasLibres: number | null, tarifaHora: number | null, moneda = 'MXN'): PoliticaDetencion =>
  ({ horasLibres, tarifaHora, moneda });

describe('ventanaDeViaje — el reloj de los hitos', () => {
  it('sin llegada sellada no hay episodio', () => {
    expect(ventanaDeViaje({ llegadaEn: null, regresoEn: null, estatus: 'abierto' }, AHORA)).toBeNull();
  });

  it('llegada y regreso sellados = cerrado, con los minutos puerta a puerta', () => {
    const v = ventanaDeViaje({
      llegadaEn: '2026-08-25T10:00:00.000Z',
      regresoEn: '2026-08-25T15:30:00.000Z',
      estatus: 'liquidado',
    }, AHORA);
    expect(v).toEqual({ fase: 'cerrado', minutosSitio: 330 });
  });

  it('llegada sin regreso con el viaje vivo = corriendo contra ahora', () => {
    const v = ventanaDeViaje({
      llegadaEn: '2026-08-25T18:00:00.000Z', regresoEn: null, estatus: 'abierto',
    }, AHORA);
    expect(v).toEqual({ fase: 'corriendo', minutosSitio: 120 });
  });

  it('en_cuadre también corre: el chofer puede estar liquidando desde el sitio', () => {
    const v = ventanaDeViaje({
      llegadaEn: '2026-08-25T19:00:00.000Z', regresoEn: null, estatus: 'en_cuadre',
    }, AHORA);
    expect(v?.fase).toBe('corriendo');
  });

  it('viaje liquidado sin regreso: la salida NO es medible y los minutos quedan en null, no en "lo que haya durado"', () => {
    const v = ventanaDeViaje({
      llegadaEn: '2026-08-20T10:00:00.000Z', regresoEn: null, estatus: 'liquidado',
    }, AHORA);
    expect(v).toEqual({ fase: 'sin_salida_medible', minutosSitio: null });
  });

  it('regreso antes que llegada = sellos incoherentes, jamás minutos negativos', () => {
    const v = ventanaDeViaje({
      llegadaEn: '2026-08-25T12:00:00.000Z',
      regresoEn: '2026-08-25T11:00:00.000Z',
      estatus: 'liquidado',
    }, AHORA);
    expect(v).toEqual({ fase: 'sellos_incoherentes', minutosSitio: null });
  });

  it('una llegada "en el futuro" corriendo produce 0 minutos, no negativos', () => {
    const v = ventanaDeViaje({
      llegadaEn: '2026-08-25T21:00:00.000Z', regresoEn: null, estatus: 'abierto',
    }, AHORA);
    expect(v).toEqual({ fase: 'corriendo', minutosSitio: 0 });
  });

  it('cruce de medianoche CDMX: el reloj mide milisegundos entre timestamptz, sin puentes de calendario', () => {
    // Llega 23:50 de Mérida (04:50Z del día siguiente) y regresa 01:10 local.
    const v = ventanaDeViaje({
      llegadaEn: '2026-08-25T04:50:00.000Z',
      regresoEn: '2026-08-25T06:10:00.000Z',
      estatus: 'liquidado',
    }, AHORA);
    expect(v).toEqual({ fase: 'cerrado', minutosSitio: 80 });
  });
});

describe('resolverPolitica — el pacto del cliente gana', () => {
  const porCliente = new Map([['c1', politica(2, 500)]]);
  const flota = politica(4, 300);

  it('cliente con pacto propio usa el suyo', () => {
    expect(resolverPolitica('c1', porCliente, flota)).toEqual({ politica: politica(2, 500), origen: 'cliente' });
  });

  it('cliente sin pacto cae al de flota', () => {
    expect(resolverPolitica('c2', porCliente, flota)).toEqual({ politica: flota, origen: 'flota' });
  });

  it('viaje sin cliente cae al de flota', () => {
    expect(resolverPolitica(null, porCliente, flota).origen).toBe('flota');
  });

  it('sin ningún pacto: sin_politica, no un pacto de ceros', () => {
    expect(resolverPolitica('c2', new Map(), null)).toEqual({ politica: null, origen: 'sin_politica' });
  });
});

describe('calcularDetencion — null jamás 0', () => {
  it('sin minutos medibles no hay excedente ni monto', () => {
    const d = calcularDetencion(null, politica(2, 500));
    expect(d.minutosExcedentes).toBeNull();
    expect(d.monto).toBeNull();
    expect(d.motivoSinMonto).toBe('sin_minutos');
  });

  it('sin horas libres pactadas no se afirma "excedido" — se pide pactar', () => {
    const d = calcularDetencion(600, politica(null, 500));
    expect(d.minutosExcedentes).toBeNull();
    expect(d.monto).toBeNull();
    expect(d.motivoSinMonto).toBe('sin_horas_libres_pactadas');
  });

  it('sin política no hay umbral', () => {
    expect(calcularDetencion(600, null).motivoSinMonto).toBe('sin_horas_libres_pactadas');
  });

  it('dentro de las horas libres: excedente 0 REAL y sin monto (no hay cobro que proponer)', () => {
    const d = calcularDetencion(90, politica(2, 500));
    expect(d.minutosExcedentes).toBe(0);
    expect(d.monto).toBeNull();
    expect(d.motivoSinMonto).toBe('dentro_de_horas_libres');
  });

  it('exactamente las horas libres sigue dentro', () => {
    expect(calcularDetencion(120, politica(2, 500)).motivoSinMonto).toBe('dentro_de_horas_libres');
  });

  it('excedido sin tarifa: los minutos se dicen, el monto no se inventa', () => {
    const d = calcularDetencion(200, politica(2, null));
    expect(d.minutosExcedentes).toBe(80);
    expect(d.monto).toBeNull();
    expect(d.motivoSinMonto).toBe('sin_tarifa_pactada');
  });

  it('excedido con tarifa: hora o fracción iniciada — 80 minutos son 2 horas cobrables', () => {
    const d = calcularDetencion(200, politica(2, 500));
    expect(d).toEqual({
      horasLibres: 2, minutosExcedentes: 80, horasCobrables: 2,
      monto: 1000, moneda: 'MXN', motivoSinMonto: null,
    });
  });

  it('un minuto excedido ya es una hora cobrable (la unidad no trabajó esa hora)', () => {
    const d = calcularDetencion(121, politica(2, 350.5));
    expect(d.horasCobrables).toBe(1);
    expect(d.monto).toBe(350.5);
  });

  it('horas libres con fracción (2.5 h) redondean el umbral al minuto', () => {
    const d = calcularDetencion(151, politica(2.5, 100));
    expect(d.minutosExcedentes).toBe(1);
  });
});

// ── El armado completo ──────────────────────────────────────────────────────

const viajeBase: ViajeParaEstadia = {
  id: 'v1', folio: 'F-101', origen: 'Mérida', destino: 'CDMX',
  clienteId: 'c1', unidadId: 'u1', estatus: 'liquidado',
  llegadaEn: '2026-08-25T10:00:00.000Z',
  descargaEn: '2026-08-25T11:00:00.000Z',
  regresoEn: '2026-08-25T16:00:00.000Z',
};

const ctxBase: ContextoEstadias = {
  politicaFlota: politica(4, 300),
  politicaPorCliente: new Map([['c1', politica(2, 500)]]),
  clientePorId: new Map([['c1', { nombre: 'CEDIS Norte', geocercaId: 'g1' }]]),
  geocercaPorId: new Map([['g1', { nombre: 'Patio CEDIS Norte' }]]),
  unidadPorId: new Map([['u1', { economico: 'T-07' }]]),
  presenciaPorViaje: new Map([['v1', { primera: '2026-08-25T10:05:00.000Z', ultima: '2026-08-25T15:40:00.000Z', n: 62 }]]),
};

describe('armarEpisodios — el paquete citable', () => {
  it('un episodio cerrado con pacto de cliente, monto y evidencia GPS medida', () => {
    const [e] = armarEpisodios([viajeBase], ctxBase, AHORA);
    expect(e.fase).toBe('cerrado');
    expect(e.minutosSitio).toBe(360);
    expect(e.origenPolitica).toBe('cliente');
    expect(e.detencion.monto).toBe(2000); // 4 h excedentes × $500
    expect(e.sitioNombre).toBe('Patio CEDIS Norte');
    expect(e.unidadEconomico).toBe('T-07');
    expect(e.evidencia).toEqual({
      tipo: 'medida',
      primeraEnSitio: '2026-08-25T10:05:00.000Z',
      ultimaEnSitio: '2026-08-25T15:40:00.000Z',
      posiciones: 62,
    });
  });

  it('cliente sin sitio dibujado: la evidencia dice sin_sitio_del_cliente, no inventa coordenadas', () => {
    const ctx = { ...ctxBase, clientePorId: new Map([['c1', { nombre: 'CEDIS Norte', geocercaId: null }]]) };
    const [e] = armarEpisodios([viajeBase], ctx, AHORA);
    expect(e.evidencia).toEqual({ tipo: 'sin_medicion', motivo: 'sin_sitio_del_cliente' });
    // El reloj de hitos sigue: el monto no depende del GPS.
    expect(e.detencion.monto).toBe(2000);
  });

  it('sitio dibujado y CERO posiciones en el radio: sin_posiciones_en_sitio — un hueco declarado, jamás "no estuvo ahí"', () => {
    const ctx = { ...ctxBase, presenciaPorViaje: new Map() };
    const [e] = armarEpisodios([viajeBase], ctx, AHORA);
    expect(e.evidencia).toEqual({ tipo: 'sin_medicion', motivo: 'sin_posiciones_en_sitio' });
  });

  it('viaje sin unidad: sin_unidad', () => {
    const ctx = ctxBase;
    const [e] = armarEpisodios([{ ...viajeBase, unidadId: null }], ctx, AHORA);
    expect(e.evidencia).toEqual({ tipo: 'sin_medicion', motivo: 'sin_unidad' });
    expect(e.unidadEconomico).toBeNull();
  });

  it('los viajes sin llegada no producen episodio', () => {
    expect(armarEpisodios([{ ...viajeBase, llegadaEn: null }], ctxBase, AHORA)).toHaveLength(0);
  });

  it('orden de la cola: monto propuesto primero, luego lo que corre', () => {
    const conMonto = viajeBase; // $2,000
    const corriendo: ViajeParaEstadia = {
      ...viajeBase, id: 'v2', clienteId: null, regresoEn: null, estatus: 'abierto',
      llegadaEn: '2026-08-25T19:30:00.000Z',
    };
    const dentro: ViajeParaEstadia = {
      ...viajeBase, id: 'v3', regresoEn: '2026-08-25T11:00:00.000Z',
    };
    const orden = armarEpisodios([dentro, corriendo, conMonto], ctxBase, AHORA).map((e) => e.viajeId);
    expect(orden).toEqual(['v1', 'v2', 'v3']);
  });
});

describe('resumirEstadias', () => {
  it('suma solo los montos que existen; sin ninguno, el total es null (no $0)', () => {
    const sinMonto = armarEpisodios(
      [{ ...viajeBase, regresoEn: '2026-08-25T11:00:00.000Z' }],
      ctxBase, AHORA,
    );
    expect(resumirEstadias(sinMonto).montoPropuesto).toBeNull();

    const conMonto = armarEpisodios([viajeBase], ctxBase, AHORA);
    const r = resumirEstadias(conMonto);
    expect(r.montoPropuesto).toBe(2000);
    expect(r.moneda).toBe('MXN');
    expect(r.conMonto).toBe(1);
  });

  it('monedas mezcladas: el agregado se calla y los renglones hablan', () => {
    const ctx: ContextoEstadias = {
      ...ctxBase,
      politicaPorCliente: new Map([
        ['c1', politica(2, 500, 'MXN')],
        ['c2', politica(2, 100, 'USD')],
      ]),
      clientePorId: new Map([
        ['c1', { nombre: 'A', geocercaId: null }],
        ['c2', { nombre: 'B', geocercaId: null }],
      ]),
    };
    const eps = armarEpisodios([viajeBase, { ...viajeBase, id: 'v2', clienteId: 'c2' }], ctx, AHORA);
    const r = resumirEstadias(eps);
    expect(r.conMonto).toBe(2);
    expect(r.montoPropuesto).toBeNull();
    expect(r.moneda).toBeNull();
  });

  it('cuenta lo corriendo, lo sin política y lo sin salida medible', () => {
    const eps = armarEpisodios([
      { ...viajeBase, id: 'a', regresoEn: null, estatus: 'abierto' },
      { ...viajeBase, id: 'b', clienteId: 'c9', regresoEn: null, estatus: 'liquidado' },
    ], { ...ctxBase, politicaFlota: null }, AHORA);
    const r = resumirEstadias(eps);
    expect(r.corriendo).toBe(1);
    expect(r.sinSalidaMedible).toBe(1);
    expect(r.sinPolitica).toBe(1); // 'b' no tiene pacto propio ni de flota
  });
});
