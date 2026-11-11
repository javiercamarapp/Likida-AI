import { describe, expect, it } from 'vitest';
import { evaluarFuentes } from './estado';
import { PISO_CADENCIA_RELOJ_MS, RELOJ_DE_FUENTE, entradasDeLatidos, type LatidoParaFuente } from './desde_latidos';
import { CADENCIA_MS, CRONS } from '@/lib/admin/salud';

const AHORA = Date.UTC(2026, 10, 10, 18, 0, 0);
const latido = (haceMs: number, estado: LatidoParaFuente['ultimoEstado'] = 'ok', detalle: Record<string, unknown> = {}): LatidoParaFuente => ({
  ultimoLatido: new Date(AHORA - haceMs).toISOString(), ultimoEstado: estado, detalle,
});

describe('la pieza vista desde el sistema (admin)', () => {
  it('cada fuente apunta a un reloj que existe', () => {
    for (const cron of Object.values(RELOJ_DE_FUENTE)) expect(CRONS).toContain(cron);
  });
  it('latidos ilegibles (null) dan «sin dato» en las seis fuentes: nunca verde', () => {
    const evals = evaluarFuentes(entradasDeLatidos(null), AHORA);
    expect(evals).toHaveLength(6);
    for (const e of evals) { expect(e.estado).toBeNull(); expect(e.requiereAccion).toBe(false); }
  });
  it('un reloj que late dentro de su cadencia deja la fuente al día', () => {
    const evals = evaluarFuentes(entradasDeLatidos({ gps: latido(60_000), tms: latido(60_000) }), AHORA);
    expect(evals.find((e) => e.id === 'gps')?.estado).toBe('al_dia');
  });
  it('un reloj que nunca latió: atrasada; uno vencido por mucho: caída', () => {
    const evals = evaluarFuentes(entradasDeLatidos({
      gps: { ultimoLatido: null, ultimoEstado: null, detalle: {} },
      tms: latido(Math.max(CADENCIA_MS.tms, PISO_CADENCIA_RELOJ_MS) * 10),
    }), AHORA);
    expect(evals.find((e) => e.id === 'gps')?.estado).toBe('atrasada');
    expect(evals.find((e) => e.id === 'tms')?.estado).toBe('caida');
  });
  it('un reloj apagado a propósito por palanca es «sin conectar», no una falla', () => {
    const evals = evaluarFuentes(entradasDeLatidos({ gps: latido(PISO_CADENCIA_RELOJ_MS * 20, 'saltado', { interruptor: 'gps_poller' }) }), AHORA);
    expect(evals.find((e) => e.id === 'gps')?.estado).toBe('sin_conectar');
  });
  it('un latido con resultado «fallo» no se pinta al día aunque sea reciente', () => {
    const evals = evaluarFuentes(entradasDeLatidos({ gps: latido(60_000, 'fallo', { error: 'proveedor 500' }) }), AHORA);
    expect(evals.find((e) => e.id === 'gps')?.estado).not.toBe('al_dia');
  });
});
