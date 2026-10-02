import { describe, it, expect, vi } from 'vitest';
import {
  correrAlertasTope, evaluarCurso, nivelDe, topeEfectivoMin, TOPE_LFT_68_MIN,
  type PuertosAlerta, type FilaCandidata, type ConfigAlerta,
} from './alerta_tope';
import type { Asiento, Procedencia, TipoAsiento } from './modelo';

let n = 0;
function a(tipo: TipoAsiento, momento: string, procedencia: Procedencia = 'declarado_operador'): Asiento {
  n += 1;
  return { id: `a-${n}`, tipo, momento, procedencia, origenRef: null, waMessageId: null, viajeId: null, registradoPorEmail: null, nota: null, corrigeA: null, anuladoEn: null, anuladoPorEmail: null, anuladoMotivo: null };
}
const AHORA = new Date('2026-10-02T18:00:00Z');
const hace = (h: number) => new Date(AHORA.getTime() - h * 3_600_000).toISOString();

const CFG: ConfigAlerta = { tenantId: 't1', topeHoras: null, umbralAvisoPct: 80, umbralCriticoPct: 95, canalEncargado: 'whatsapp', canalOperador: 'whatsapp', correoEncargado: null };
const FILA: FilaCandidata = { tenantId: 't1', jornadaId: 'j1', operadorId: 'o1', dia: '2026-10-02', config: CFG };

function puertos(asientos: Asiento[] | null, over: Partial<PuertosAlerta> = {}): PuertosAlerta {
  return {
    candidatas: async () => ({ filas: [FILA], hayMas: false }),
    asientos: async () => asientos,
    politica: async () => null,
    operador: async () => ({ nombre: 'Luis', telefono: '5215500000001', terminalId: null }),
    encargados: async () => [{ nombre: 'Jefe', telefono: '5215500000002' }],
    reclamar: vi.fn(async () => ({ id: 'r1', token: 'tk' })),
    cerrar: vi.fn(async () => true),
    liberar: vi.fn(async () => true),
    enviarWa: vi.fn(async () => ({ ok: true, reintentable: false })),
    enviarCorreo: vi.fn(async () => ({ ok: true, reintentable: false })),
    appUrl: () => 'https://app.test',
    ...over,
  };
}

describe('topes y niveles', () => {
  it('el tope efectivo nunca supera el art. 68 y toma el más estricto', () => {
    expect(topeEfectivoMin({ topeHoras: null }, null)).toBe(TOPE_LFT_68_MIN);
    expect(topeEfectivoMin({ topeHoras: 20 }, null)).toBe(TOPE_LFT_68_MIN);
    expect(topeEfectivoMin({ topeHoras: 10 }, { horasMaxJornada: 9 })).toBe(540);
  });
  it('niveles en 80, 95 y 100 %', () => {
    const c = { umbralAvisoPct: 80, umbralCriticoPct: 95 };
    expect(nivelDe(500, 720, c)).toBeNull();
    expect(nivelDe(577, 720, c)).toBe('aviso');
    expect(nivelDe(690, 720, c)).toBe('critico');
    expect(nivelDe(720, 720, c)).toBe('exceso');
  });
});

describe('evaluarCurso: nunca se inventa una hora', () => {
  it('sin inicio no hay medición', () => {
    expect(evaluarCurso([], AHORA.getTime()).estado).toBe('sin_inicio');
  });
  it('inicio del GPS es cota inferior; el declarado no', () => {
    expect(evaluarCurso([a('inicio_jornada', hace(5), 'gps')], AHORA.getTime()).cotaInferior).toBe(true);
    expect(evaluarCurso([a('inicio_jornada', hace(5))], AHORA.getTime()).cotaInferior).toBe(false);
  });
  it('un descanso sin cierre no se descuenta y se dice', () => {
    const c = evaluarCurso([a('inicio_jornada', hace(10)), a('inicio_descanso', hace(4))], AHORA.getTime());
    expect(c.minutos).toBe(600);
    expect(c.descansoSinCierre).toBe(true);
  });
  it('un descanso cerrado sí se descuenta', () => {
    const c = evaluarCurso([a('inicio_jornada', hace(10)), a('inicio_descanso', hace(6)), a('fin_descanso', hace(5))], AHORA.getTime());
    expect(c.minutos).toBe(540);
  });
  it('más de 24 h abierta es cierre no marcado, no un exceso', () => {
    expect(evaluarCurso([a('inicio_jornada', hace(30))], AHORA.getTime()).estado).toBe('sin_cierre_probable');
  });
  it('inicio en el futuro no mide', () => {
    expect(evaluarCurso([a('inicio_jornada', hace(-2))], AHORA.getTime()).estado).toBe('inicio_en_futuro');
  });
});

describe('correrAlertasTope', () => {
  it('bajo el umbral no avisa ni reclama', async () => {
    const p = puertos([a('inicio_jornada', hace(5))]);
    const r = await correrAlertasTope(p, { ahora: AHORA });
    expect(r.bajoUmbral).toBe(1);
    expect(p.reclamar).not.toHaveBeenCalled();
  });
  it('al 80 % avisa al encargado y al operador y cierra enviada', async () => {
    const p = puertos([a('inicio_jornada', hace(10))]);
    const r = await correrAlertasTope(p, { ahora: AHORA });
    expect(r.alertas.aviso).toBe(1);
    expect(p.enviarWa).toHaveBeenCalledTimes(2);
    expect(p.cerrar).toHaveBeenCalledWith(expect.objectContaining({ estado: 'enviada' }));
  });
  it('si el nivel ya fue reclamado no reenvía', async () => {
    const p = puertos([a('inicio_jornada', hace(10))], { reclamar: vi.fn(async () => null) });
    const r = await correrAlertasTope(p, { ahora: AHORA });
    expect(r.yaAvisadas).toBe(1);
    expect(p.enviarWa).not.toHaveBeenCalled();
  });
  it('sin poder leer el expediente no alerta y lo dice', async () => {
    const p = puertos(null);
    const r = await correrAlertasTope(p, { ahora: AHORA });
    expect(r.fallos[0]).toMatch(/no se alerta sin leerlo/);
    expect(p.reclamar).not.toHaveBeenCalled();
  });
  it('rechazo reintentable libera el nivel para la siguiente corrida', async () => {
    const p = puertos([a('inicio_jornada', hace(13))], { enviarWa: vi.fn(async () => ({ ok: false, reintentable: true, motivo: '429' })) });
    const r = await correrAlertasTope(p, { ahora: AHORA });
    expect(r.rechazosReintentables).toBe(1);
    expect(p.liberar).toHaveBeenCalled();
    expect(p.cerrar).not.toHaveBeenCalled();
  });
  it('sin destinatarios se asienta sin_destinatario', async () => {
    const p = puertos([a('inicio_jornada', hace(10))], {
      encargados: async () => [], operador: async () => ({ nombre: 'Luis', telefono: null, terminalId: null }),
    });
    const r = await correrAlertasTope(p, { ahora: AHORA });
    expect(r.sinDestinatario).toBe(1);
    expect(p.cerrar).toHaveBeenCalledWith(expect.objectContaining({ estado: 'sin_destinatario' }));
  });
  it('si la lista de candidatas no se puede leer lanza (no afirma que no hay nada)', async () => {
    const p = puertos([], { candidatas: async () => { throw new Error('42P01'); } });
    await expect(correrAlertasTope(p, { ahora: AHORA })).rejects.toThrow();
  });
  it('el aviso con inicio del GPS dice «al menos»', async () => {
    const p = puertos([a('inicio_jornada', hace(10), 'gps')]);
    await correrAlertasTope(p, { ahora: AHORA });
    const msg = (p.enviarWa as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(JSON.stringify(msg)).toMatch(/al menos/);
  });
});
