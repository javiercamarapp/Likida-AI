import { describe, it, expect } from 'vitest';
import {
  crearFuenteDoble,
  FuenteNoDisponibleError,
  leerRegistrosTT,
  MENSAJE_SIN_EJECUTOR,
  registroAEstatus,
  SinEjecutor,
  type FuenteTrackAndTrace,
  type RegistroTT,
} from './fuente';

// Respuestas SINTÉTICAS inventadas: no se conoce el formato real de Track & Trace (bloqueo B11).
const RESPUESTA_SINTETICA: unknown = [
  { caja: 'CJ0001', unidad: 'U-101', ubicacion: 'EN PATIO', documentos: 'LISTO', observadoEn: '2026-10-05T09:00:00Z' },
  { caja: 'CJ0002', unidad: null, ubicacion: 'Pendiente de cruce', documentos: 'pendiente de requisito', observadoEn: '2026-10-05T09:05:00Z' },
  { caja: 'CJ0003', ubicacion: 'EN RUTA', documentos: '', observadoEn: '2026-10-05T09:10:00Z' },
  { caja: 'CJ0004', unidad: 'U-104', ubicacion: 'ZONA RARA', documentos: 'QUIEN SABE', observadoEn: '2026-10-05T09:15:00Z' },
];

describe('SinEjecutor falla cerrado', () => {
  it('rechaza con un mensaje llano y nunca devuelve datos', async () => {
    const fuente: FuenteTrackAndTrace = new SinEjecutor();
    await expect(fuente.leerControlUnidad()).rejects.toBeInstanceOf(FuenteNoDisponibleError);
    await expect(fuente.leerControlUnidad()).rejects.toThrow(MENSAJE_SIN_EJECUTOR);
  });

  it('el mensaje no es técnico ni trae rutas, llaves o URLs', () => {
    expect(MENSAJE_SIN_EJECUTOR).not.toMatch(/https?:|\/|token|key|secret|ENOTFOUND/i);
  });
});

describe('doble de pruebas', () => {
  it('devuelve copias: modificar el resultado no altera la fuente', async () => {
    const base: RegistroTT[] = [
      { caja: 'CJ0001', unidad: null, ubicacion: 'EN PATIO', documentos: 'LISTO', observadoEn: '2026-10-05T09:00:00Z' },
    ];
    const f = crearFuenteDoble(base);
    const a = await f.leerControlUnidad();
    a[0]!.caja = 'OTRA';
    expect((await f.leerControlUnidad())[0]!.caja).toBe('CJ0001');
  });
});

describe('contrato: respuesta sintética → registros → estatus', () => {
  it('lee, valida y mapea', () => {
    const { registros, descartados } = leerRegistrosTT(RESPUESTA_SINTETICA);
    expect(descartados).toBe(0);
    expect(registros).toHaveLength(4);
    const e = registros.map(registroAEstatus);
    expect(e[0]).toMatchObject({ caja: 'CJ0001', unidad: 'U-101', estado: 'patio', docs: 'listo', fuente: 'track_trace', filaId: null });
    expect(e[1]).toMatchObject({ estado: 'pend_cruce', docs: 'pend_requisito', unidad: null });
    expect(e[2]).toMatchObject({ estado: 'en_ruta', docs: 'desconocido', unidad: null });
  });

  it('textos fuera del mapa → desconocido, nunca se adivina', () => {
    const e = registroAEstatus(leerRegistrosTT(RESPUESTA_SINTETICA).registros[3]!);
    expect(e.estado).toBe('desconocido');
    expect(e.docs).toBe('desconocido');
  });

  it('el mapeo ignora acentos, mayúsculas y espacios de más; la unidad en blanco es null', () => {
    const e = registroAEstatus({
      caja: '  CJ0009 ', unidad: '   ', ubicacion: '  en   patio ', documentos: ' Listo', observadoEn: '2026-10-05T09:00:00Z',
    });
    expect(e).toMatchObject({ caja: 'CJ0009', unidad: null, estado: 'patio', docs: 'listo' });
  });

  it('claves del prototipo como texto no rompen el mapeo', () => {
    const e = registroAEstatus({
      caja: 'CJ1', unidad: null, ubicacion: 'constructor', documentos: '__proto__', observadoEn: '2026-10-05T09:00:00Z',
    });
    expect(e.estado).toBe('desconocido');
    expect(e.docs).toBe('desconocido');
  });

  it('descarta y cuenta lo que no tiene la forma del contrato', () => {
    const { registros, descartados } = leerRegistrosTT([
      { caja: 'CJ0001', ubicacion: 'EN PATIO', documentos: 'LISTO', observadoEn: '2026-10-05T09:00:00Z' },
      null,
      'texto',
      { caja: '', ubicacion: 'EN PATIO', documentos: 'LISTO', observadoEn: '2026-10-05T09:00:00Z' },
      { caja: 'CJ0002', ubicacion: 'EN PATIO', documentos: 'LISTO', observadoEn: 'ayer' },
      { caja: 'CJ0003', ubicacion: 7, documentos: 'LISTO', observadoEn: '2026-10-05T09:00:00Z' },
      { caja: 'CJ0004', ubicacion: 'EN PATIO', documentos: 'LISTO', observadoEn: '2026-10-05T09:00:00Z', unidad: 42 },
    ]);
    expect(registros.map((r) => r.caja)).toEqual(['CJ0001']);
    expect(descartados).toBe(6);
  });

  it('una respuesta que no es lista falla cerrado', () => {
    for (const mala of [null, undefined, {}, 'error 500', 42]) {
      expect(() => leerRegistrosTT(mala)).toThrow(FuenteNoDisponibleError);
    }
  });

  it('lista vacía es válida: cero registros, cero descartes', () => {
    expect(leerRegistrosTT([])).toEqual({ registros: [], descartados: 0 });
  });
});
