import { describe, it, expect } from 'vitest';
import { evaluarMolestia, type EntradaMolestia } from './molestia';

const base: EntradaMolestia = {
  texto: '¿Dónde va mi viaje?', intencion: 'ubicacion', entradasSinRespuesta: 1, minutosEsperando: 0, slaRespuestaMin: 30,
};
const con = (c: Partial<EntradaMolestia>) => evaluarMolestia({ ...base, ...c });

describe('detector de molestia', () => {
  it('una pregunta normal no es molestia', () => {
    expect(con({})).toEqual({ nivel: 0, puntos: 0, motivos: [] });
  });

  it('lenguaje fuerte: avisa (nivel 2)', () => {
    const r = con({ texto: 'Esto es una porquería, pésimo servicio', intencion: 'queja' });
    expect(r.nivel).toBeGreaterThanOrEqual(2);
    expect(r.motivos).toContain('lenguaje_fuerte');
    expect(r.motivos).toContain('queja');
  });

  it('lenguaje leve: se anota, no avisa', () => {
    const r = con({ texto: 'Es urgente que me digan dónde va' });
    expect(r.nivel).toBe(1);
    expect(r.motivos).toEqual(['lenguaje_de_molestia']);
  });

  it('MAYÚSCULAS y signos repetidos suman', () => {
    const r = con({ texto: 'DONDE ESTA MI CAMION!!!' });
    expect(r.motivos).toEqual(expect.arrayContaining(['mayusculas', 'signos_repetidos']));
    expect(r.nivel).toBe(2);
  });

  it('un texto corto en mayúsculas («OK», «F-1042») no cuenta como gritar', () => {
    expect(con({ texto: 'OK' }).motivos).not.toContain('mayusculas');
    expect(con({ texto: 'VIAJE F-1042' }).motivos).not.toContain('mayusculas');
  });

  it('la insistencia sube con los mensajes sin respuesta (3 → leve, 5 → alta)', () => {
    expect(con({ entradasSinRespuesta: 2 }).nivel).toBe(0);
    const tres = con({ entradasSinRespuesta: 3 });
    expect(tres.motivos).toContain('insistencia');
    expect(tres.nivel).toBe(1);
    const cinco = con({ entradasSinRespuesta: 5 });
    expect(cinco.motivos).toContain('insistencia_alta');
    expect(cinco.nivel).toBe(2);
  });

  it('el tiempo sin respuesta: sobre el SLA suma 1, el doble suma 2', () => {
    expect(con({ minutosEsperando: 29 }).nivel).toBe(0);
    expect(con({ minutosEsperando: 30 }).motivos).toContain('espera_sobre_sla');
    expect(con({ minutosEsperando: 60 }).motivos).toContain('espera_doble_sla');
    expect(con({ minutosEsperando: 60 }).nivel).toBe(2);
  });

  it('el SLA configurado cambia el umbral', () => {
    expect(con({ minutosEsperando: 20, slaRespuestaMin: 10 }).motivos).toContain('espera_doble_sla');
    expect(con({ minutosEsperando: 20, slaRespuestaMin: 120 }).motivos).toEqual([]);
  });

  it('suma de señales llega a crítico (nivel 3)', () => {
    const r = con({ texto: 'PÉSIMO SERVICIO!!! EXIJO UNA RESPUESTA', intencion: 'queja', entradasSinRespuesta: 5, minutosEsperando: 90 });
    expect(r.nivel).toBe(3);
    expect(r.puntos).toBeGreaterThanOrEqual(4);
  });

  it('pedir un humano suma 1 pero solo no alcanza para avisar por molestia', () => {
    const r = con({ texto: 'quiero hablar con una persona', intencion: 'pide_humano' });
    expect(r.nivel).toBe(1);
  });

  it('palabras con frontera: «ya», «mal» o «asco» dentro de otra palabra no disparan', () => {
    expect(con({ texto: 'Mi carga va en una unidad tipo caja seca, pasa por Pachuca y Mazatlán' }).nivel).toBe(0);
    expect(con({ texto: 'el casco del operador y la calle Asconio' }).nivel).toBe(0);
  });

  it('los motivos son categorías: nunca citan el texto del cliente', () => {
    const r = con({ texto: 'Ladrones, son unos estafadores', intencion: 'queja' });
    for (const m of r.motivos) expect(m).toMatch(/^[a-z_]+$/);
  });

  it('entradas basura no rompen', () => {
    expect(() => con({ texto: '', entradasSinRespuesta: -3, minutosEsperando: Number.NaN, slaRespuestaMin: 0 })).not.toThrow();
  });
});
