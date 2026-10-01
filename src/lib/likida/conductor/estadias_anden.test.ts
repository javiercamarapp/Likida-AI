import { describe, expect, it } from 'vitest';
import type { PoliticaDetencion } from '../estadias/motor';
import {
  calcularEstancias, celdaCsv, COLUMNAS_CSV_ESTADIAS, csvEstadias, excedeUmbral, horaExactaMx, resumirEstadias, valorarEstancias,
  type ContextoEstancias, type ViajeParaCobro,
} from './estadias_anden';
import { hitoVacio } from './memoria.fixture';
import type { HitoFila, TipoHito } from './tipos';

const AHORA = new Date('2026-10-02T22:00:00.000Z');
const ctxVacio: ContextoEstancias = { validaciones: new Map(), evidencias: new Map() };

function hito(tipo: TipoHito, iso: string | null, extra: Partial<HitoFila> = {}): HitoFila {
  return hitoVacio({
    id: `h-${tipo}`, tipo, viajeId: 'v1',
    ...(iso ? { estado: 'recibido', fuente: 'texto', interpretacion: 'regla', mensajeEn: iso, recibidoEn: iso } : {}), ...extra,
  });
}
const T = (hhmm: string) => `2026-10-02T${hhmm}:00.000Z`;

describe('calcularEstancias', () => {
  it('cerrada: llegada→salida, con los minutos exactos', () => {
    const e = calcularEstancias({ id: 'v1', estatus: 'abierto' }, [hito('llegada_carga', T('14:00')), hito('salida_carga', T('16:30'))], AHORA, ctxVacio);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ lugar: 'carga', fase: 'cerrada', minutos: 150 });
  });

  it('las dos paradas se miden por separado', () => {
    const hs = [hito('llegada_carga', T('08:00')), hito('salida_carga', T('09:00')), hito('llegada_descarga', T('15:00')), hito('salida_descarga', T('15:45'))];
    const e = calcularEstancias({ id: 'v1', estatus: 'abierto' }, hs, AHORA, ctxVacio);
    expect(e.map((x) => [x.lugar, x.minutos])).toEqual([['carga', 60], ['descarga', 45]]);
  });

  it('en curso: llegó y no ha salido, con el viaje vivo → los minutos corren hasta ahora', () => {
    const e = calcularEstancias({ id: 'v1', estatus: 'abierto' }, [hito('llegada_carga', T('20:30'))], AHORA, ctxVacio);
    expect(e[0]).toMatchObject({ fase: 'en_curso', minutos: 90 });
  });

  it('viaje liquidado sin salida: NO se inventa la duración', () => {
    const e = calcularEstancias({ id: 'v1', estatus: 'liquidado' }, [hito('llegada_carga', T('20:30'))], AHORA, ctxVacio);
    expect(e[0]).toMatchObject({ fase: 'sin_salida', minutos: null });
  });

  it('salida anterior a la llegada: incoherente, sin minutos negativos', () => {
    const e = calcularEstancias({ id: 'v1', estatus: 'abierto' }, [hito('llegada_carga', T('16:00')), hito('salida_carga', T('15:00'))], AHORA, ctxVacio);
    expect(e[0]).toMatchObject({ fase: 'incoherente', minutos: null });
  });

  it('salida sin llegada (la llegada se omitió): no hay desde cuándo medir', () => {
    const omitida = hitoVacio({ id: 'h-llegada_carga', tipo: 'llegada_carga', viajeId: 'v1', estado: 'omitido', omitidoMotivo: 'inferido_por_salida_carga' });
    const e = calcularEstancias({ id: 'v1', estatus: 'abierto' }, [omitida, hito('salida_carga', T('16:00'))], AHORA, ctxVacio);
    expect(e[0]).toMatchObject({ fase: 'sin_llegada', minutos: null, llegada: null });
  });

  it('sin ningún hito de la parada no hay fila', () => {
    expect(calcularEstancias({ id: 'v1', estatus: 'abierto' }, [hito('regreso', T('10:00'))], AHORA, ctxVacio)).toEqual([]);
  });

  it('una llegada «en el futuro» corre en cero, no en negativo', () => {
    const e = calcularEstancias({ id: 'v1', estatus: 'abierto' }, [hito('llegada_carga', T('23:00'))], AHORA, ctxVacio);
    expect(e[0].minutos).toBe(0);
  });

  it('hora inválida: no hay minutos', () => {
    const e = calcularEstancias({ id: 'v1', estatus: 'abierto' }, [hito('llegada_carga', 'basura')], AHORA, ctxVacio);
    expect(e[0].minutos).toBeNull();
  });

  it('trae la fuente de la hora, el veredicto y las evidencias de cada extremo', () => {
    const hs = [hito('llegada_carga', T('14:00')), hito('salida_carga', T('15:00'), { fuente: 'oficina' })];
    const ctx: ContextoEstancias = { validaciones: new Map([['h-llegada_carga', 'validado']]), evidencias: new Map([['h-salida_carga', 2]]) };
    const [e] = calcularEstancias({ id: 'v1', estatus: 'abierto' }, hs, AHORA, ctx);
    expect(e.llegada).toMatchObject({ fuente: 'chofer', validacion: 'validado', evidencias: 0 });
    expect(e.salida).toMatchObject({ fuente: 'oficina', evidencias: 2 });
  });

  it('usa la hora del MENSAJE, no la de recepción', () => {
    const [e] = calcularEstancias({ id: 'v1', estatus: 'abierto' }, [
      hito('llegada_carga', T('14:00'), { recibidoEn: T('14:40') }), hito('salida_carga', T('15:00'), { recibidoEn: T('15:30') }),
    ], AHORA, ctxVacio);
    expect(e.minutos).toBe(60);
    expect(e.llegada?.recibidoEn).toBe(T('14:40'));
  });
});

describe('excedeUmbral', () => {
  const [carga] = calcularEstancias({ id: 'v1', estatus: 'abierto' }, [hito('llegada_carga', T('19:00'))], AHORA, ctxVacio); // 180 min en curso
  it('sin umbral (null) nunca excede', () => {
    expect(excedeUmbral(carga, { estadiaAlertaCargaMin: null, estadiaAlertaDescargaMin: 15 })).toBe(false);
  });
  it('excede cuando los minutos alcanzan el umbral (>=) y solo en curso', () => {
    expect(excedeUmbral(carga, { estadiaAlertaCargaMin: 180, estadiaAlertaDescargaMin: null })).toBe(true);
    expect(excedeUmbral(carga, { estadiaAlertaCargaMin: 181, estadiaAlertaDescargaMin: null })).toBe(false);
    const [cerrada] = calcularEstancias({ id: 'v1', estatus: 'abierto' }, [hito('llegada_carga', T('10:00')), hito('salida_carga', T('18:00'))], AHORA, ctxVacio);
    expect(excedeUmbral(cerrada, { estadiaAlertaCargaMin: 15, estadiaAlertaDescargaMin: null })).toBe(false);
  });
  it('el umbral de carga no aplica a la descarga', () => {
    const [d] = calcularEstancias({ id: 'v1', estatus: 'abierto' }, [hito('llegada_descarga', T('19:00'))], AHORA, ctxVacio);
    expect(excedeUmbral(d, { estadiaAlertaCargaMin: 15, estadiaAlertaDescargaMin: null })).toBe(false);
    expect(excedeUmbral(d, { estadiaAlertaCargaMin: null, estadiaAlertaDescargaMin: 60 })).toBe(true);
  });
});

const VIAJE: ViajeParaCobro = {
  id: 'v1', folio: 'F-1042', estatus: 'abierto', operadorNombre: 'Juan Pérez', clienteId: 'c1', clienteNombre: 'Cliente A', terminalNombre: 'Tlaquepaque',
  origenSitio: 'Planta Zapopan', destinoSitio: null, origen: 'Zapopan', destino: 'Monterrey',
};
const PACTO: PoliticaDetencion = { horasLibres: 2, tarifaHora: 500, moneda: 'MXN' };

describe('valorarEstancias y resumirEstadias', () => {
  const hs = [hito('llegada_carga', T('10:00')), hito('salida_carga', T('14:10')), hito('llegada_descarga', T('18:00')), hito('salida_descarga', T('19:30'))];
  const estancias = calcularEstancias({ id: 'v1', estatus: 'abierto' }, hs, AHORA, ctxVacio);

  it('con pacto del cliente: excedente y monto por parada (hora o fracción iniciada)', () => {
    const f = valorarEstancias(VIAJE, estancias, { porCliente: new Map([['c1', PACTO]]), flota: null });
    // carga: 250 min − 120 libres = 130 → 3 h cobrables × 500 = 1,500; descarga: 90 min, dentro de las 2 h.
    expect(f[0].detencion).toMatchObject({ minutosExcedentes: 130, horasCobrables: 3, monto: 1500, moneda: 'MXN' });
    expect(f[1].detencion).toMatchObject({ minutosExcedentes: 0, monto: null, motivoSinMonto: 'dentro_de_horas_libres' });
    expect(f[0].origenPolitica).toBe('cliente');
    expect(f[0].sitio).toBe('Planta Zapopan');
    expect(f[1].sitio).toBe('Monterrey'); // sin sitio asignado cae al texto del viaje, rotulado como lo que es
  });

  it('el pacto del cliente gana sobre el de la flota', () => {
    const f = valorarEstancias(VIAJE, estancias, { porCliente: new Map([['c1', PACTO]]), flota: { horasLibres: 0, tarifaHora: 9999, moneda: 'MXN' } });
    expect(f[0].detencion.monto).toBe(1500);
  });

  it('sin pacto NO hay monto (null-jamás-0) y el motivo lo dice', () => {
    const f = valorarEstancias(VIAJE, estancias, { porCliente: new Map(), flota: null });
    expect(f[0].detencion).toMatchObject({ monto: null, motivoSinMonto: 'sin_horas_libres_pactadas' });
    expect(f[0].origenPolitica).toBe('sin_politica');
  });

  it('pacto sin tarifa: excedente medido, sin monto', () => {
    const f = valorarEstancias(VIAJE, estancias, { porCliente: new Map(), flota: { horasLibres: 2, tarifaHora: null, moneda: 'MXN' } });
    expect(f[0].detencion).toMatchObject({ minutosExcedentes: 130, monto: null, motivoSinMonto: 'sin_tarifa_pactada' });
  });

  it('el resumen suma solo lo cerrado y nunca mezcla monedas', () => {
    const f = valorarEstancias(VIAJE, estancias, { porCliente: new Map([['c1', PACTO]]), flota: null });
    const r = resumirEstadias(f);
    expect(r).toMatchObject({ paradas: 2, cerradas: 2, enCurso: 0, minutosCerradas: 340, minutosExcedentes: 130, montoPropuesto: { MXN: 1500 }, sinPacto: 0 });
    const usd = resumirEstadias([
      ...f,
      ...valorarEstancias({ ...VIAJE, id: 'v2', clienteId: 'c2' }, estancias, { porCliente: new Map([['c2', { horasLibres: 0, tarifaHora: 10, moneda: 'USD' }]]), flota: null }),
    ]);
    expect(Object.keys(usd.montoPropuesto).sort()).toEqual(['MXN', 'USD']);
  });

  it('el resumen cuenta sin pacto y en curso, y deja excedentes en null cuando ninguna tenía pacto', () => {
    const en = calcularEstancias({ id: 'v1', estatus: 'abierto' }, [hito('llegada_carga', T('20:00'))], AHORA, ctxVacio);
    const r = resumirEstadias(valorarEstancias(VIAJE, [...estancias, ...en], { porCliente: new Map(), flota: null }));
    expect(r.enCurso).toBe(1);
    expect(r.sinPacto).toBe(2);
    expect(r.minutosExcedentes).toBeNull();
    expect(r.montoPropuesto).toEqual({});
  });
});

describe('csvEstadias', () => {
  const hs = [hito('llegada_carga', T('16:32'), { fuente: 'oficina' }), hito('salida_carga', T('19:02'))];
  const ctx: ContextoEstancias = { validaciones: new Map([['h-llegada_carga', 'sin_coincidencia']]), evidencias: new Map([['h-salida_carga', 1]]) };
  const estancias = calcularEstancias({ id: 'v1', estatus: 'abierto' }, hs, AHORA, ctx);
  const filas = valorarEstancias({ ...VIAJE, operadorNombre: '=CMD|calc' }, estancias, { porCliente: new Map([['c1', PACTO]]), flota: null });
  const csv = csvEstadias(filas);
  const lineas = csv.replace('﻿', '').trim().split('\r\n');

  it('trae BOM, la cabecera completa y una fila por parada', () => {
    expect(csv.startsWith('﻿')).toBe(true);
    expect(lineas[0].split(',')).toEqual([...COLUMNAS_CSV_ESTADIAS]);
    expect(lineas).toHaveLength(2);
  });

  it('lleva la hora EXACTA de México con segundos, la fuente, el veredicto y las evidencias', () => {
    // 16:32Z = 10:32 en México (UTC-6).
    expect(lineas[1]).toContain('2026-10-02 10:32:00');
    expect(lineas[1]).toContain('captura de oficina');
    expect(lineas[1]).toContain('sin coincidencia');
    expect(lineas[1]).toContain('mensaje del chofer');
  });

  it('neutraliza la inyección de fórmulas en celdas de texto', () => {
    expect(lineas[1]).toContain("'=CMD|calc");
    expect(lineas[1]).not.toMatch(/,=CMD/);
  });

  it('una parada en curso NO trae monto (no es un cobro hasta que cierre)', () => {
    const en = calcularEstancias({ id: 'v1', estatus: 'abierto' }, [hito('llegada_carga', T('10:00'))], AHORA, ctxVacio);
    const l = csvEstadias(valorarEstancias(VIAJE, en, { porCliente: new Map([['c1', PACTO]]), flota: null })).trim().split('\r\n')[1].split(',');
    const cab = [...COLUMNAS_CSV_ESTADIAS];
    expect(l[cab.indexOf('monto_propuesto')]).toBe('');
    expect(l[cab.indexOf('estado')]).toContain('en curso');
  });

  it('sin filas: solo la cabecera', () => {
    expect(csvEstadias([]).trim().split('\r\n')).toHaveLength(1);
  });
});

describe('celdaCsv / horaExactaMx', () => {
  it('escapa comas, comillas y saltos', () => {
    expect(celdaCsv('a,b')).toBe('"a,b"');
    expect(celdaCsv('di "hola"')).toBe('"di ""hola"""');
    expect(celdaCsv('l1\nl2')).toBe('"l1\nl2"');
  });
  it('prefija lo que parece fórmula pero deja pasar números negativos legítimos', () => {
    for (const t of ['=1+1', '+52', '-cmd', '@SUM(A1)', '\tx']) expect(celdaCsv(t).startsWith("'") || celdaCsv(t).startsWith('"\'')).toBe(true);
    expect(celdaCsv(-5)).toBe('-5');
    expect(celdaCsv(null)).toBe('');
  });
  it('la hora exacta es de México y vacía si no es fecha', () => {
    expect(horaExactaMx('2026-10-03T03:00:00.000Z')).toBe('2026-10-02 21:00:00');
    expect(horaExactaMx('2026-10-02T06:00:00.000Z')).toBe('2026-10-02 00:00:00');
    expect(horaExactaMx(null)).toBe('');
    expect(horaExactaMx('x')).toBe('');
  });
});
