import { describe, it, expect } from 'vitest';
import { segmentarHilos } from './hilos';
import { cli, eq } from './fixtures';

const P = { urgentes: [] as string[], clave: ['embarque'] };

describe('segmentarHilos', () => {
  it('un mensaje del equipo cierra lo pendiente', () => {
    const r = segmentarHilos([cli(0, 'dónde está mi carga?'), eq(5, 'ya reviso')], null, P);
    expect(r.hilos).toEqual([]);
    expect(r.hayEquipo).toBe(true);
  });

  it('los sustantivos consecutivos forman un solo hilo', () => {
    const r = segmentarHilos([eq(0, 'hola'), cli(1, 'una pregunta?'), cli(2, 'sigues ahí?'), cli(3, 'mi embarque')], null, P);
    expect(r.hilos).toHaveLength(1);
    expect(r.hilos[0]).toHaveLength(3);
    expect(r.hilos[0][0].pregunta).toBe(true);
    expect(r.hilos[0][2].clave).toBe(true);
  });

  it('cortesía, monitoreo y vacío se ignoran y se cuentan', () => {
    const r = segmentarHilos([eq(0, 'hola'), cli(1, 'UNIDAD 12 DETENIDA'), cli(2, ''), eq(3, 'x')], null, P);
    expect(r.ignorados).toBe(2);
    expect(r.hilos).toEqual([]);
  });

  it('un «gracias» del cliente cierra la conversación', () => {
    const r = segmentarHilos([eq(0, 'hola'), cli(1, 'necesito el estatus'), cli(2, 'gracias'), cli(3, 'ok')], null, P);
    expect(r.hilos).toEqual([]);
    expect(r.ignorados).toBe(2);
  });

  it('un «gracias» no cierra lo que el cliente pregunta después', () => {
    const r = segmentarHilos([eq(0, 'hola'), cli(1, 'gracias'), cli(2, 'otra duda: dónde está?')], null, P);
    expect(r.hilos).toHaveLength(1);
  });

  it('una respuesta fuera de ventana no cierra y deja hilo aparte', () => {
    const r = segmentarHilos([cli(0, 'primero'), cli(50, 'segundo'), eq(60, 'tarde'), cli(61, 'tercero')], 30, P);
    expect(r.hilos.map((h) => h.length)).toEqual([1, 1]);   // «primero» quedó abierto; «segundo» (10 min) se cerró; «tercero» abierto
  });

  it('sin mensajes del equipo hayEquipo es falso', () => {
    expect(segmentarHilos([cli(0, 'hola?')], null, P).hayEquipo).toBe(false);
  });

  it('urgencia propia y su negación', () => {
    const urg = { urgentes: ['retraso'], clave: [] as string[] };
    const si = segmentarHilos([eq(0, 'x'), cli(1, 'hay retraso en mi carga')], null, urg);
    const no = segmentarHilos([eq(0, 'x'), cli(1, 'un retraso, sin prisa')], null, urg);
    expect(si.hilos[0][0].urgente).toBe(true);
    expect(no.hilos[0][0].urgente).toBe(false);
  });
});
