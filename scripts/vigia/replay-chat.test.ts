import { describe, it, expect } from 'vitest';
import { calcularMetricas } from './replay-chat';
import type { MensajeHistorial } from '../../src/lib/likida/vigia/historial/export_whatsapp';

const m = (min: number, rol: 'cliente' | 'equipo', texto: string): MensajeHistorial => ({
  enviadoEn: new Date(Date.UTC(2026, 0, 5, 12, min)).toISOString(), rol, autorHash: 'h', texto,
});

describe('replay-chat: métricas agregadas', () => {
  it('mide esperas por bloque, sin atender y distribuciones', async () => {
    const r = await calcularMetricas([
      m(0, 'cliente', 'hola'), m(5, 'cliente', 'gracias'), m(10, 'equipo', 'listo'),
      m(100, 'cliente', 'hola'), m(200, 'equipo', 'listo'),
      m(300, 'cliente', 'hola'),
    ], 60);
    expect(r.cliente).toBe(4);
    expect(r.equipo).toBe(2);
    expect(r.esperas).toMatchObject({ atendidos: 2, sinAtender: 1, lentos: 1, maxMin: 100 });
    expect(r.intenciones.reduce((s, [, n]) => s + n, 0)).toBe(4);
    expect(r.acciones.reduce((s, [, n]) => s + n, 0)).toBe(4);
  });
  it('el resultado no contiene el texto de los mensajes', async () => {
    const r = await calcularMetricas([m(0, 'cliente', 'frase-unica-xyz'), m(1, 'equipo', 'respuesta-unica-abc')], 60);
    expect(JSON.stringify(r)).not.toMatch(/frase-unica|respuesta-unica/);
  });
});
