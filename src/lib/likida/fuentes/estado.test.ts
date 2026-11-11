import { describe, expect, it } from 'vitest';
import {
  CADENCIA_FUENTES, FACTOR_ATRASADA, FACTOR_CAIDA, IDS_FUENTE, MUESTRA_MINIMA_30D,
  contarRequiereAccionFuentes, evaluarFuente, evaluarFuentes, resumirFuentes,
  type EntradaFuente, type IdFuente,
} from './estado';

const AHORA = Date.UTC(2026, 10, 10, 18, 0, 0);
const entrada = (id: IdFuente, o: Partial<EntradaFuente> = {}): EntradaFuente => ({
  id, lectura: 'medida', configurada: true, ultimaSenalMs: AHORA - 1000, ...o,
});
const hace = (id: IdFuente, factor: number) => AHORA - CADENCIA_FUENTES[id].esperadaMs * factor;

describe.each(IDS_FUENTE)('estado de la fuente «%s»: los cuatro estados', (id) => {
  it('al día: señal dentro de su cadencia', () => {
    const e = evaluarFuente(entrada(id, { ultimaSenalMs: hace(id, 0.5) }), AHORA);
    expect(e.estado).toBe('al_dia');
    expect(e.tono).toBe('ok');
    expect(e.requiereAccion).toBe(false);
  });
  it('al día todavía a 1.5 veces la cadencia; atrasada pasando ese umbral', () => {
    expect(evaluarFuente(entrada(id, { ultimaSenalMs: hace(id, FACTOR_ATRASADA) }), AHORA).estado).toBe('al_dia');
    const e = evaluarFuente(entrada(id, { ultimaSenalMs: hace(id, FACTOR_ATRASADA + 0.2) }), AHORA);
    expect(e.estado).toBe('atrasada');
    expect(e.requiereAccion).toBe(true);
  });
  it('caída: pasadas 3 veces su cadencia', () => {
    const e = evaluarFuente(entrada(id, { ultimaSenalMs: hace(id, FACTOR_CAIDA + 0.5) }), AHORA);
    expect(e.estado).toBe('caida');
    expect(e.tono).toBe('bad');
    expect(e.requiereAccion).toBe(true);
  });
  it('sin configurar es «sin conectar», NO una falla y NO pide acción', () => {
    const e = evaluarFuente(entrada(id, { configurada: false, ultimaSenalMs: null }), AHORA);
    expect(e.estado).toBe('sin_conectar');
    expect(e.estado).not.toBe('caida');
    expect(e.requiereAccion).toBe(false);
  });
  it('lectura caída es «sin dato» (estado null): jamás al día', () => {
    // Aun con una señal reciente a la mano, si la lectura cayó no se afirma nada.
    const e = evaluarFuente(entrada(id, { lectura: 'caida', ultimaSenalMs: AHORA - 10 }), AHORA);
    expect(e.estado).toBeNull();
    expect(e.estado).not.toBe('al_dia');
    expect(e.tono).toBe('neutral');
    expect(e.requiereAccion).toBe(false);
  });
});

describe('reglas finas', () => {
  it('conectada pero sin una sola señal: atrasada (no caída, no al día)', () => {
    const e = evaluarFuente(entrada('gps', { ultimaSenalMs: null }), AHORA);
    expect(e.estado).toBe('atrasada');
    expect(e.motivo).toBe('sin_senal');
  });
  it('conectada, sin señal y con falla reportada: caída', () => {
    expect(evaluarFuente(entrada('sat', { ultimaSenalMs: null, falla: '305 certificado inválido' }), AHORA).estado).toBe('caida');
  });
  it('una falla reportada sin señal buena posterior no se pinta al día aunque la última señal sea reciente', () => {
    const e = evaluarFuente(entrada('tms', { ultimaSenalMs: AHORA - 60_000, falla: 'timeout' }), AHORA);
    expect(e.estado).not.toBe('al_dia');
    expect(e.falla).toBe('timeout');
  });
  it('muestra chica: el silencio no se afirma (sin dato), pero una señal reciente sí vale como al día', () => {
    const callada = evaluarFuente(entrada('whatsapp', { ultimaSenalMs: hace('whatsapp', 2), muestra30d: MUESTRA_MINIMA_30D - 1 }), AHORA);
    expect(callada.estado).toBeNull();
    expect(callada.motivo).toBe('muestra_chica');
    const reciente = evaluarFuente(entrada('whatsapp', { ultimaSenalMs: hace('whatsapp', 0.2), muestra30d: 1 }), AHORA);
    expect(reciente.estado).toBe('al_dia');
  });
  it('con muestra suficiente el silencio sí cuenta', () => {
    expect(evaluarFuente(entrada('whatsapp', { ultimaSenalMs: hace('whatsapp', 2), muestra30d: MUESTRA_MINIMA_30D }), AHORA).estado).toBe('atrasada');
  });
  it('una cadencia propia (relojes del admin) manda sobre la de la fuente', () => {
    const e = evaluarFuente(entrada('gps', { ultimaSenalMs: AHORA - 40 * 60_000, cadenciaMs: 60 * 60_000 }), AHORA);
    expect(e.estado).toBe('al_dia');
  });
  it('una señal del futuro (reloj desfasado) no da edad negativa', () => {
    const e = evaluarFuente(entrada('gps', { ultimaSenalMs: AHORA + 5 * 60_000 }), AHORA);
    expect(e.haceMs).toBe(0);
    expect(e.estado).toBe('al_dia');
  });
});

describe('resumen (lo que leen la campana y el pie del sidebar)', () => {
  const evals = evaluarFuentes([
    entrada('whatsapp', { ultimaSenalMs: hace('whatsapp', 0.1) }),
    entrada('tms', { ultimaSenalMs: hace('tms', 5) }),
    entrada('gps', { ultimaSenalMs: hace('gps', 2) }),
    entrada('peajes', { configurada: false, ultimaSenalMs: null }),
    entrada('correo', { lectura: 'caida' }),
    entrada('sat', { ultimaSenalMs: hace('sat', 0.5) }),
  ], AHORA);
  const r = resumirFuentes(evals);
  it('cuenta al día, conectadas y las que piden acción', () => {
    expect(r.total).toBe(6);
    expect(r.alDia).toBe(2);
    expect(r.conectadas).toBe(5); // todo menos peajes (sin conectar); la que no se pudo leer sí está conectada para efectos del conteo
    expect(r.requierenAccion.map((x) => x.id).sort()).toEqual(['gps', 'tms']);
  });
  it('sin dato no se cuenta ni como al día ni como falla', () => {
    expect(r.sinDato).toBe(1);
    expect(contarRequiereAccionFuentes(evals)).toBe(2);
  });
});
