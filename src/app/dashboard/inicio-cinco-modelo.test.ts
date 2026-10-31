import { describe, expect, it } from 'vitest';
import type { CorridaRegistrada } from '@/lib/likida/agentes/corridas';
import {
  cifraDeAgente, cuandoMx, esFlotaNueva, estadoDeAgente, filaViajesEnCurso, hechosUltimas24h, pesosCompletos,
} from './inicio-cinco-modelo';
import { cifrasSinDato } from './cinco-agentes-cifras-modelo';

const AHORA = Date.parse('2026-10-31T18:00:00Z'); // 12:00 en México
const corrida = (estado: CorridaRegistrada['estado'], inicio: string, extra: Partial<CorridaRegistrada> = {}): CorridaRegistrada => ({
  id: 'c', inicio, fin: null, estado, disparo: 'cron', tareasHechas: null, tareasTotal: null, resumen: null, error: null, duracionMs: null, ...extra,
});
const d = { kpis: { viajesLiquidados: 42, montoComprobado: 1, diferenciaDetectada: 1, conDiferencias: 5, porRevisar: 3, tasaCuadre: 88 }, cartaPorte: { completas: 38, total: 41 }, escalados: 2, rango: '30' as const };

describe('pesosCompletos', () => {
  it('pesos completos, no el compacto', () => {
    expect(pesosCompletos(3306107.4)).toBe('$3,306,107');
    expect(pesosCompletos(2988680)).toBe('$2,988,680');
  });
  it('sin dato es «—», nunca $0', () => {
    expect(pesosCompletos(null)).toBe('—');
    expect(pesosCompletos(undefined)).toBe('—');
    expect(pesosCompletos(Number.NaN)).toBe('—');
  });
});

describe('estadoDeAgente', () => {
  const o = { registraCorridas: true };
  it('corrida buena de hoy = verde con hora de México', () => {
    expect(estadoDeAgente(corrida('ok', '2026-10-31T13:10:00Z'), AHORA, o)).toEqual({ punto: 'ok', texto: 'Corrió hoy 07:10' });
  });
  it('parcial = ámbar y fallo = rojo, ambos con texto', () => {
    expect(estadoDeAgente(corrida('parcial', '2026-10-31T13:10:00Z'), AHORA, o)).toMatchObject({ punto: 'warn', texto: expect.stringContaining('pendientes') });
    expect(estadoDeAgente(corrida('fallo', '2026-10-31T11:30:00Z'), AHORA, o)).toEqual({ punto: 'bad', texto: 'Falló hoy 05:30' });
  });
  it('una corrida buena de otro día NO se pinta verde (no se afirma que trabajó hoy)', () => {
    const e = estadoDeAgente(corrida('ok', '2026-10-28T13:00:00Z'), AHORA, o);
    expect(e.punto).toBe('muted');
    expect(e.texto).toContain('Última corrida');
  });
  it('sin corridas, lectura fallida, sin registro y próximamente son distintos', () => {
    expect(estadoDeAgente(undefined, AHORA, o)).toEqual({ punto: 'muted', texto: 'Sin corridas registradas' });
    expect(estadoDeAgente(null, AHORA, o)).toMatchObject({ punto: 'warn', texto: 'No se pudo leer la última corrida' });
    expect(estadoDeAgente(undefined, AHORA, { registraCorridas: false })).toMatchObject({ punto: 'muted', texto: expect.stringContaining('abre su tablero') });
    expect(estadoDeAgente(undefined, AHORA, { registraCorridas: true, proximamente: true }).texto).toContain('no está activo');
  });
});

describe('cifraDeAgente', () => {
  it('conteos reales por agente', () => {
    expect(cifraDeAgente('liquidacion', { d }).valor).toBe('3');
    expect(cifraDeAgente('carta_porte', { d }).valor).toBe('38 / 41');
    expect(cifraDeAgente('conductor', { d }).valor).toBe('2');
  });
  it('lectura fallida = sin valor y error, nunca 0', () => {
    for (const [clave, parcial] of [['liquidacion', { kpis: null }], ['conductor', { escalados: null }]] as const) {
      const c = cifraDeAgente(clave, { d: { ...d, ...parcial } });
      expect(c.valor).toBeNull();
      expect(c.error).toBe(true);
    }
  });
  it('Carta Porte sin viajes abiertos o no afirmable es sin dato', () => {
    expect(cifraDeAgente('carta_porte', { d: { ...d, cartaPorte: { completas: 0, total: 0 } } }).valor).toBeNull();
    expect(cifraDeAgente('carta_porte', { d: { ...d, cartaPorte: null } }).valor).toBeNull();
  });
  it('Servicio al cliente no inventa cifra', () => {
    expect(cifraDeAgente('vigia', { d }).valor).toBeNull();
  });
  it('Peajes: con pesos, candidatos; sin pesos, tareas de la corrida; si no hay nada, sin dato', () => {
    const sin = cifrasSinDato('No se pudo leer el estado de cuenta.', true);
    expect(cifraDeAgente('peajes', { d, pesos: sin })).toMatchObject({ valor: null, error: true });
    const con = { ...sin, extemporaneos: { ...sin.extemporaneos, n: 26, valor: 12511, periodo: 'octubre de 2026', sello: 'Estimado' as const, reintentar: false } };
    expect(cifraDeAgente('peajes', { d, pesos: con }).valor).toBe('26');
    expect(cifraDeAgente('peajes', { d, corridaPeajes: corrida('ok', '2026-10-31T13:10:00Z', { tareasHechas: 8, tareasTotal: 8 }) }).valor).toBe('8 de 8');
    expect(cifraDeAgente('peajes', { d }).valor).toBeNull();
  });
});

describe('hechosUltimas24h', () => {
  const h = (cuando: string) => ({ tipo: 'escalado' as const, folio: 'V-1', operador: null, cuando });
  it('deja solo las últimas 24 h; null se queda null', () => {
    const r = hechosUltimas24h([h('2026-10-31T10:00:00Z'), h('2026-10-30T10:00:00Z'), h('2026-10-29T10:00:00Z')], AHORA);
    expect(r).toHaveLength(1);
    expect(hechosUltimas24h(null, AHORA)).toBeNull();
  });
});

describe('esFlotaNueva', () => {
  const vacio = { corridas: [undefined, undefined, undefined, undefined], enCurso: 0, d: { cierres: [{ inicio: 'x', etiqueta: 'x', valor: 0, parcial: false }], hechos: [] } };
  it('todo vacío = nueva', () => expect(esFlotaNueva(vacio)).toBe(true));
  it('una corrida, un viaje abierto o un cierre = ya opera', () => {
    expect(esFlotaNueva({ ...vacio, corridas: [corrida('ok', '2026-10-31T13:00:00Z'), undefined] })).toBe(false);
    expect(esFlotaNueva({ ...vacio, enCurso: 3 })).toBe(false);
    expect(esFlotaNueva({ ...vacio, d: { ...vacio.d, cierres: [{ inicio: 'x', etiqueta: 'x', valor: 2, parcial: false }] } })).toBe(false);
  });
  it('una lectura fallida NO afirma que es nueva (null ≠ 0)', () => {
    expect(esFlotaNueva({ ...vacio, corridas: [null] })).toBe(false);
    expect(esFlotaNueva({ ...vacio, enCurso: null })).toBe(false);
    expect(esFlotaNueva({ ...vacio, d: { cierres: null, hechos: [] } })).toBe(false);
    expect(esFlotaNueva({ ...vacio, d: { ...vacio.d, hechos: null } })).toBe(false);
  });
});

describe('filaViajesEnCurso y cuandoMx', () => {
  it('0 no inventa fila; null se confiesa; n>0 informa con su enlace', () => {
    expect(filaViajesEnCurso(0, '/dashboard/viajes')).toBeNull();
    expect(filaViajesEnCurso(null, null)).toMatchObject({ sinPendiente: true, detalle: expect.stringContaining('No es cero') });
    expect(filaViajesEnCurso(4, '/dashboard/viajes')).toMatchObject({ titulo: '4 viajes en curso', href: '/dashboard/viajes', severidad: 'info' });
    expect(filaViajesEnCurso(1, null)?.titulo).toBe('1 viaje en curso');
  });
  it('cuándo: hoy, ayer y fecha', () => {
    expect(cuandoMx('2026-10-31T13:02:00Z', AHORA)).toBe('hoy 07:02');
    expect(cuandoMx('2026-10-30T16:10:00Z', AHORA)).toBe('ayer 10:10');
    expect(cuandoMx('basura', AHORA)).toBe('—');
  });
});
