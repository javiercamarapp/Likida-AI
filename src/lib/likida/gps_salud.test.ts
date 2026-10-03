import { describe, it, expect } from 'vitest';
import {
  nivelDePosicion, contarPorFrescura, veredictoDePoll, veredictoDePush, MINUTOS_EN_VIVO, MINUTOS_ATRASADA,
  type SaludPoll,
} from './gps_salud';

const AHORA = Date.parse('2026-10-01T15:00:00Z');
const hace = (min: number) => new Date(AHORA - min * 60_000).toISOString();
const base: SaludPoll = { proveedor: 'wialon', ultimoPollEn: hace(2), ultimoCompletoEn: hace(2), erroresSeguidos: 0, ultimaFalla: null, proximoIntentoEn: null, ultimoError: null, backlogPendiente: false };

describe('semáforo de obsolescencia de una posición', () => {
  it('en vivo hasta 30 min, atrasada hasta 6 h, obsoleta después; lo ilegible es obsoleto', () => {
    expect(nivelDePosicion(0)).toBe('en_vivo');
    expect(nivelDePosicion(MINUTOS_EN_VIVO)).toBe('en_vivo');
    expect(nivelDePosicion(MINUTOS_EN_VIVO + 1)).toBe('atrasada');
    expect(nivelDePosicion(MINUTOS_ATRASADA)).toBe('atrasada');
    expect(nivelDePosicion(MINUTOS_ATRASADA + 1)).toBe('obsoleta');
    expect(nivelDePosicion(Number.NaN)).toBe('obsoleta');
    expect(nivelDePosicion(-5)).toBe('obsoleta');
  });
  it('cuenta por nivel', () => {
    expect(contarPorFrescura([1, 10, 100, 500, 9999])).toEqual({ en_vivo: 2, atrasada: 1, obsoleta: 2 });
  });
});

describe('estado de una integración por poll', () => {
  it('sana solo con un poll completo reciente; nunca sincronizada no es verde', () => {
    expect(veredictoDePoll(base, AHORA)).toMatchObject({ estado: 'sana', tono: 'ok' });
    expect(veredictoDePoll({ ...base, ultimoPollEn: null, ultimoCompletoEn: null }, AHORA)).toMatchObject({ estado: 'sin_sincronizar', tono: 'neutral' });
  });
  it('credencial vencida: rojo, en espera con el próximo intento y desde cuándo no sincroniza', () => {
    const v = veredictoDePoll({ ...base, erroresSeguidos: 3, ultimaFalla: 'credencial', proximoIntentoEn: new Date(AHORA + 60 * 60_000).toISOString(), ultimoCompletoEn: hace(300) }, AHORA);
    expect(v).toMatchObject({ estado: 'en_espera', tono: 'bad' });
    expect(v.texto).toMatch(/3 fallas seguidas/); expect(v.texto).toMatch(/recapturarla/); expect(v.texto).toMatch(/Próximo intento en 1 h/); expect(v.texto).toMatch(/hace 5 h/);
  });
  it('proveedor caído: ámbar y se reintenta solo; sin última sincronización lo dice', () => {
    const v = veredictoDePoll({ ...base, erroresSeguidos: 1, ultimaFalla: 'proveedor', proximoIntentoEn: null, ultimoCompletoEn: null }, AHORA);
    expect(v).toMatchObject({ estado: 'con_falla', tono: 'warn' });
    expect(v.texto).toMatch(/Nunca ha sincronizado completo/);
  });
  it('formato inesperado se dice como tal (no «credencial»)', () => {
    expect(veredictoDePoll({ ...base, erroresSeguidos: 1, ultimaFalla: 'formato' }, AHORA).texto).toMatch(/distinto a lo que documenta/);
  });
  it('incompleto sin falla: parcial (huérfanas/privacidad), no verde', () => {
    expect(veredictoDePoll({ ...base, backlogPendiente: true, ultimoError: 'posiciones huérfanas' }, AHORA)).toMatchObject({ estado: 'parcial', tono: 'warn' });
  });
});

describe('estado del push propio', () => {
  const p = { configurado: true, ultimaRecepcionEn: hace(2), ultimoRechazoEn: null, ultimoRechazoMotivo: null };
  it('sin secreto, con secreto sin recepciones, sana, y rechazo posterior a la última recepción', () => {
    expect(veredictoDePush({ ...p, configurado: false }, AHORA).estado).toBe('sin_sincronizar');
    expect(veredictoDePush({ ...p, ultimaRecepcionEn: null }, AHORA).texto).toMatch(/todavía no llega/);
    expect(veredictoDePush(p, AHORA)).toMatchObject({ estado: 'sana', tono: 'ok' });
    const malo = veredictoDePush({ ...p, ultimoRechazoEn: hace(1), ultimoRechazoMotivo: 'firma_invalida' }, AHORA);
    expect(malo).toMatchObject({ estado: 'con_falla' });
    expect(malo.texto).toMatch(/firma inválida/);
  });
  it('sana pero callada más de 6 h: ámbar', () => {
    expect(veredictoDePush({ ...p, ultimaRecepcionEn: hace(500) }, AHORA).tono).toBe('warn');
  });
});
