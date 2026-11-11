import { describe, expect, it } from 'vitest';
import type { CorridaRegistrada } from '@/lib/likida/agentes/corridas';
import type { SenalesAsistente } from '@/lib/likida/asistente/pasos_cinco_agentes';
import { esperaConexionDe, faseDeAgente } from './inicio-cinco-fase';

const AHORA = Date.parse('2026-11-11T18:00:00Z');
const corrida = (extra: Partial<CorridaRegistrada>): CorridaRegistrada => ({
  id: 'c', inicio: new Date(AHORA - 60_000).toISOString(), fin: null, estado: 'ok', disparo: 'cron', tareasHechas: null, tareasTotal: null, resumen: null, error: null, duracionMs: null, ...extra,
});
const o = { registraCorridas: true };
const SENALES = { tms: null, archivosRecibidos: null, correoPlataforma: null, correoDesglose: null, operadores: null, unidadesActivas: null, patios: null, coordinadores: null, supervisores: null, revisorCartaPorte: null } as SenalesAsistente;

describe('faseDeAgente: solo se afirma lo que se leyó', () => {
  it('corrida sin cerrar de hace 1 min = corriendo; de hace 3 h NO (pudo morirse sin cerrar)', () => {
    expect(faseDeAgente(corrida({}), AHORA, o)).toBe('corriendo');
    expect(faseDeAgente(corrida({ inicio: new Date(AHORA - 3 * 3_600_000).toISOString() }), AHORA, o)).toBe('activo');
  });
  it('corrida cerrada: bien = activo; fallo o parcial = atención', () => {
    expect(faseDeAgente(corrida({ fin: new Date(AHORA).toISOString() }), AHORA, o)).toBe('activo');
    expect(faseDeAgente(corrida({ estado: 'fallo', fin: new Date(AHORA).toISOString() }), AHORA, o)).toBe('atencion');
    expect(faseDeAgente(corrida({ estado: 'parcial' }), AHORA, o)).toBe('atencion');
  });
  it('lectura caída ≠ sin corridas; sin registro y próximamente son distintos', () => {
    expect(faseDeAgente(null, AHORA, o)).toBe('sin_lectura');
    expect(faseDeAgente(undefined, AHORA, o)).toBe('sin_corridas');
    expect(faseDeAgente(undefined, AHORA, { registraCorridas: false })).toBe('sin_corridas');
    expect(faseDeAgente(undefined, AHORA, { registraCorridas: true, proximamente: true })).toBe('proximamente');
  });
  it('«en espera» solo si nunca corrió Y se pudo afirmar la conexión que falta', () => {
    expect(faseDeAgente(undefined, AHORA, { ...o, esperaConexion: true })).toBe('espera');
    expect(faseDeAgente(corrida({ fin: new Date(AHORA).toISOString() }), AHORA, { ...o, esperaConexion: true })).toBe('activo');
  });
});

describe('esperaConexionDe', () => {
  it('sin señales o con señales ilegibles (null) no se afirma ninguna espera', () => {
    for (const c of ['liquidacion', 'peajes', 'carta_porte', 'vigia', 'conductor'] as const) {
      expect(esperaConexionDe(c, null), c).toBe(false);
      expect(esperaConexionDe(c, SENALES), c).toBe(false);
    }
  });
  it('peajes espera con 0 estados de cuenta; conductor con 0 operadores activos; liquidación sin TMS ni archivos', () => {
    expect(esperaConexionDe('peajes', { ...SENALES, archivosRecibidos: 0 })).toBe(true);
    expect(esperaConexionDe('peajes', { ...SENALES, archivosRecibidos: 2 })).toBe(false);
    expect(esperaConexionDe('conductor', { ...SENALES, operadores: { activos: 0, conCorreo: 0 } })).toBe(true);
    expect(esperaConexionDe('conductor', { ...SENALES, operadores: { activos: 4, conCorreo: 0 } })).toBe(false);
    expect(esperaConexionDe('liquidacion', { ...SENALES, tms: 'sin_credencial', archivosRecibidos: 0 })).toBe(true);
    expect(esperaConexionDe('liquidacion', { ...SENALES, tms: 'sin_credencial', archivosRecibidos: 1 })).toBe(false);
  });
  it('carta porte y vigía nunca declaran espera (las señales no la miden)', () => {
    expect(esperaConexionDe('carta_porte', { ...SENALES, archivosRecibidos: 0 })).toBe(false);
    expect(esperaConexionDe('vigia', { ...SENALES, archivosRecibidos: 0 })).toBe(false);
  });
});
