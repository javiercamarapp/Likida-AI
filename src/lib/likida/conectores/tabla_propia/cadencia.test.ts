import { describe, it, expect } from 'vitest';
import { cadenciaObservada, poleoSugeridoMin } from './calidad';
import type { PosicionTablaPropia } from './contrato';

// T-A5-37 — sintético. «Registra cada minuto, recibimos cada 15»: el búfer llega de golpe (misma hora de recibido).
const fecha = (min: number): string => `2026-10-02 08:${String(Math.floor(min / 1)).padStart(2, '0')}:00`;
const fila = (unidad: string, registroMin: number, recibidoMin: number): PosicionTablaPropia => ({
  unidad, lat: 20.7, lon: -103.4, fechaHoraLocal: fecha(registroMin), velocidadKmh: 0, ignicion: null, fechaRecibidaLocal: fecha(recibidoMin),
});

describe('cadenciaObservada', () => {
  it('lenta: registra cada minuto, recibe en rachas cada 15 → recepción 15, registro 1, sugiere poleo 15', () => {
    const filas: PosicionTablaPropia[] = [];
    for (let t = 0; t < 45; t += 1) filas.push(fila('L-1', t, Math.ceil((t + 1) / 15) * 15)); // llegan juntas en 15, 30, 45
    const c = cadenciaObservada(filas).tabla_propia;
    expect(c.recepcionMin).toBe(15);
    expect(c.registroMin).toBe(1);
    expect(poleoSugeridoMin(c)).toBe(15);
  });
  it('rápida: cada 2 min llega y se registra → 2 / 2', () => {
    const filas = [0, 2, 4, 6, 8].map((t) => fila('R-1', t, t));
    const c = cadenciaObservada(filas).tabla_propia;
    expect(c.recepcionMin).toBe(2);
    expect(poleoSugeridoMin(c)).toBe(2);
  });
  it('separa por proveedor con claveDe y toma la mediana entre unidades', () => {
    const filas = [
      ...[0, 2, 4, 6].map((t) => fila('R-1', t, t)),
      ...[0, 15, 30].map((t) => fila('L-1', t, t)),
      ...[0, 15, 30].map((t) => fila('L-2', t, t)),
    ];
    const c = cadenciaObservada(filas, undefined, (f) => (f.unidad.startsWith('R') ? 'rapida' : 'lenta'));
    expect(c.rapida.recepcionMin).toBe(2);
    expect(c.lenta.recepcionMin).toBe(15);
    expect(c.lenta.unidades).toBe(2);
  });
  it('sin «recibido» no se inventa la recepción; sin dos instantes no hay cifra', () => {
    const sinRecibido = [0, 15, 30].map((t) => ({ ...fila('X-1', t, t), fechaRecibidaLocal: null }));
    const c = cadenciaObservada(sinRecibido).tabla_propia;
    expect(c.recepcionMin).toBeNull();
    expect(c.registroMin).toBe(15);
    expect(poleoSugeridoMin(c)).toBeNull();
    expect(cadenciaObservada([fila('Y-1', 0, 0)]).tabla_propia.registroMin).toBeNull();
    expect(cadenciaObservada([])).toEqual({});
  });
  it('el sugerido se acota a 1–60 y se redondea', () => {
    expect(poleoSugeridoMin({ recepcionMin: 0.2 })).toBe(1);
    expect(poleoSugeridoMin({ recepcionMin: 240 })).toBe(60);
    expect(poleoSugeridoMin({ recepcionMin: 2.4 })).toBe(2);
  });
});

describe('el resumen de la tabla combinada expone la cadencia observada (cableado a la prueba del conector)', () => {
  it('trae la cadencia por tabla y una frase con ella; sin «recibido» no inventa nada', async () => {
    const { resumirTablaCombinada } = await import('./calidad');
    const filas: PosicionTablaPropia[] = [];
    for (let t = 0; t < 45; t += 1) filas.push(fila('L-1', t, Math.ceil((t + 1) / 15) * 15));
    const r = resumirTablaCombinada(filas, 'America/Mexico_City', Date.UTC(2026, 9, 2, 15, 0, 0));
    expect(r.cadencia.tabla_propia).toMatchObject({ recepcionMin: 15, registroMin: 1 });
    expect(r.frases.join(' ')).toMatch(/Cadencia de la fuente: recibe cada ~15 min \(registra cada ~1 min\)/);
    const sinRecibido = filas.map((f) => ({ ...f, fechaRecibidaLocal: undefined }));
    const s = resumirTablaCombinada(sinRecibido, 'America/Mexico_City', Date.UTC(2026, 9, 2, 15, 0, 0));
    expect(s.frases.join(' ')).not.toMatch(/Cadencia de la fuente/);
  });
});
