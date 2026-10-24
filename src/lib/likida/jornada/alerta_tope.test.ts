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
    datosDelOperador: async () => ({ nombre: 'Luis', telefono: '5215500000001', terminalId: null }),
    encargados: async () => [{ nombre: 'Jefe', telefono: '5215500000002' }],
    reclamar: vi.fn(async () => ({ id: 'r1', token: 'tk' })),
    marcarEnviada: vi.fn(async () => true),
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
  it('en cuanto hay un envío real confirmado se marca el candado ANTES de cerrar (0845)', async () => {
    const orden: string[] = [];
    const p = puertos([a('inicio_jornada', hace(10))], {
      marcarEnviada: vi.fn(async () => { orden.push('marcar'); return true; }),
      cerrar: vi.fn(async () => { orden.push('cerrar'); return true; }),
    });
    await correrAlertasTope(p, { ahora: AHORA });
    // A37-S47-06: se marca tras el PRIMER envío confirmado (el del encargado); el operador aún está pendiente y el cierre fija el final.
    expect(p.marcarEnviada).toHaveBeenCalledTimes(1);
    expect(p.marcarEnviada).toHaveBeenCalledWith(expect.objectContaining({
      encargado: expect.objectContaining({ estado: 'enviado' }), operador: expect.objectContaining({ estado: 'pendiente' }),
    }));
    expect(orden).toEqual(['marcar', 'cerrar']);
  });
  it('un reclamo retomado tras un envío real ya confirmado NO reenvía nada: cierra con lo preservado', async () => {
    const p = puertos([a('inicio_jornada', hace(10))], {
      datosDelOperador: vi.fn(async () => ({ nombre: 'Luis', telefono: '5215500000001', terminalId: null })),
      reclamar: vi.fn(async (): ReturnType<PuertosAlerta['reclamar']> => ({
        id: 'r1', token: 'tk',
        yaEnviado: {
          minutos: 500, topeMin: 720, cota: true, fuente: 'gps' as Procedencia, descansoSinCierre: true,
          encargado: { canal: 'whatsapp', estado: 'enviado', motivo: null },
          operador: { canal: 'whatsapp', estado: 'fallido', motivo: 'plantilla sin aprobar' },
        },
      })),
    });
    const r = await correrAlertasTope(p, { ahora: AHORA });
    expect(p.enviarWa).not.toHaveBeenCalled();
    expect(p.enviarCorreo).not.toHaveBeenCalled();
    expect(p.datosDelOperador).not.toHaveBeenCalled(); // no hace falta: nada que redactar ni a quién enviarle
    expect(p.marcarEnviada).not.toHaveBeenCalled();
    expect(p.cerrar).toHaveBeenCalledWith(expect.objectContaining({
      estado: 'parcial',
      encargado: { canal: 'whatsapp', estado: 'enviado', motivo: null },
      operador: { canal: 'whatsapp', estado: 'fallido', motivo: 'plantilla sin aprobar' },
    }));
    expect(r.alertas.aviso).toBe(1);
  });
  it('una flota con perfil (0770) se SALTA: ni se revisa, ni se reclama, ni se avisa; las demás siguen', async () => {
    const p = puertos([a('inicio_jornada', hace(10))]);
    const r = await correrAlertasTope(p, { ahora: AHORA, excluirTenants: new Set(['t1']) });
    expect(r.revisadas).toBe(0);
    expect(p.reclamar).not.toHaveBeenCalled();
    expect(p.enviarWa).not.toHaveBeenCalled();
    const q = puertos([a('inicio_jornada', hace(10))]);
    const r2 = await correrAlertasTope(q, { ahora: AHORA, excluirTenants: new Set(['otra-flota']) });
    expect(r2.alertas.aviso).toBe(1);
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
  it('rechazo reintentable que de verdad NO se pudo encolar (sin `encolado`) sí libera el nivel', async () => {
    // `encolado` ausente (no `true`): Meta nunca aceptó dejarlo pendiente en `wa_outbox`, así que
    // nada va a llegar solo. Sin liberar, este nivel nunca se reintentaría.
    const p = puertos([a('inicio_jornada', hace(13))], { enviarWa: vi.fn(async () => ({ ok: false, reintentable: true, motivo: '429' })) });
    const r = await correrAlertasTope(p, { ahora: AHORA });
    expect(r.rechazosReintentables).toBe(1);
    expect(p.liberar).toHaveBeenCalled();
    expect(p.cerrar).not.toHaveBeenCalled();
  });
  it('HALLAZGO 1 (A12): un rechazo ENCOLADO (ya en wa_outbox) NO libera el nivel — se cerraría dos veces si se liberara', async () => {
    // `encolado: true` (429/5xx o token 190 vencido, RES-1): el cliente de Meta YA dejó el mensaje en
    // `wa_outbox` y se va a entregar solo. Antes, `enviarWa` descartaba este campo y `correrAlertasTope`
    // llamaba `p.liberar`, así que la corrida siguiente volvía a reclamar y mandaba un SEGUNDO WhatsApp
    // real para el mismo (jornada, nivel).
    const p = puertos([a('inicio_jornada', hace(13))], {
      enviarWa: vi.fn(async () => ({ ok: false, reintentable: false, encolado: true, motivo: 'token vencido' })),
    });
    const r = await correrAlertasTope(p, { ahora: AHORA });
    expect(r.rechazosReintentables).toBe(1);
    expect(p.liberar).not.toHaveBeenCalled();
    // Se cierra como una falla normal (sin liberar, sin volver a reclamar): el outbox entrega solo.
    expect(p.cerrar).toHaveBeenCalledWith(expect.objectContaining({ estado: 'fallida' }));
  });
  it('HALLAZGO 1 (A12): con un solo destinatario reintentable (429) encolado y el otro reintentable sin encolar, tampoco libera', async () => {
    // El encargado queda encolado (429, RES-1) y el operador falla reintentable pero SIN encolar
    // (p. ej. el teléfono no tiene WhatsApp registrado del lado de Meta, sin cola). Basta con que
    // UNO esté encolado para que liberar duplicaría ese envío: no se libera.
    const p = puertos([a('inicio_jornada', hace(13))], {
      enviarWa: vi.fn(async (_tel: string, _msg: unknown, _tenantId: string, _ahora: Date, contexto: string) => (
        contexto === 'jornada.alerta_encargado'
          ? { ok: false, reintentable: true, encolado: true, motivo: '429' }
          : { ok: false, reintentable: true, motivo: '429 sin cola' }
      )),
    });
    await correrAlertasTope(p, { ahora: AHORA });
    expect(p.liberar).not.toHaveBeenCalled();
    expect(p.cerrar).toHaveBeenCalledWith(expect.objectContaining({ estado: 'fallida' }));
  });
  it('sin destinatarios se asienta sin_destinatario', async () => {
    const p = puertos([a('inicio_jornada', hace(10))], {
      encargados: async () => [], datosDelOperador: async () => ({ nombre: 'Luis', telefono: null, terminalId: null }),
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

  describe('HALLAZGO 2 (A12): el corte por rechazo masivo es por flota, no global', () => {
    it('una flota con el canal roto NO bloquea a las demás flotas de la misma corrida', async () => {
      // La RPC real ordena por (tenant_id, jornada_id): la flota rota viene PRIMERO, como en producción.
      const filasRota: FilaCandidata[] = Array.from({ length: 6 }, (_, i) => ({
        tenantId: 'flota-rota', jornadaId: `j-rota-${i + 1}`, operadorId: 'o-rota', dia: '2026-10-02', config: CFG,
      }));
      const filasSanas: FilaCandidata[] = ['flota-sana-1', 'flota-sana-2', 'flota-sana-3'].map((t) => (
        { tenantId: t, jornadaId: `j-${t}`, operadorId: `o-${t}`, dia: '2026-10-02', config: CFG }
      ));
      let claimSeq = 0;
      const p = puertos([a('inicio_jornada', hace(10))], {
        candidatas: async () => ({ filas: [...filasRota, ...filasSanas], hayMas: false }),
        reclamar: vi.fn(async () => { claimSeq += 1; return { id: `r${claimSeq}`, token: `tk${claimSeq}` }; }),
        enviarWa: vi.fn(async (_tel: string, _msg: unknown, tenantId: string) => (
          tenantId === 'flota-rota' ? { ok: false, reintentable: true, motivo: '429' } : { ok: true, reintentable: false }
        )),
      });
      const r = await correrAlertasTope(p, { ahora: AHORA });
      expect(r.cortadaPorRechazoMasivo).toBe(true);
      expect(r.tenantCausanteRechazoMasivo).toBe('flota-rota');
      // Las 5 primeras filas de la flota rota se intentan (y se liberan); la 6ª se SALTA sin reclamar.
      expect(r.rechazosReintentables).toBe(5);
      // Las 3 flotas sanas, que vienen DESPUÉS en la lista, SÍ se avisan en la MISMA corrida.
      expect(r.alertas.aviso).toBe(3);
      expect(r.revisadas).toBe(5 + 3);
    });
  });
});


describe('A37-S47-06: el candado «ya enviado» se fija tras el primer envío, no al final del reparto', () => {
  it('la marca ocurre ANTES del segundo destinatario: si la invocación muere a medias, no se reenvía a los primeros', async () => {
    const orden: string[] = [];
    let envios = 0;
    const p = puertos([a('inicio_jornada', hace(10))], {
      encargados: async () => [
        { nombre: 'Jefe 1', telefono: '5215500000002' }, { nombre: 'Jefe 2', telefono: '5215500000003' }, { nombre: 'Jefe 3', telefono: '5215500000004' },
      ],
      marcarEnviada: vi.fn(async () => { orden.push('marcar'); return true; }),
      enviarWa: vi.fn(async () => { envios++; orden.push(`wa${envios}`); if (envios === 2) throw new Error('la invocación murió'); return { ok: true, reintentable: false }; }),
    });
    const r = await correrAlertasTope(p, { ahora: AHORA });
    expect(orden.slice(0, 3)).toEqual(['wa1', 'marcar', 'wa2']);
    expect(p.marcarEnviada).toHaveBeenCalledTimes(1);
    // El error del segundo envío no se traga, y el candado ya quedó fijado antes de morir.
    expect(r.fallos.join(' ')).toContain('la invocación murió');
  });

  it('si la marca falla (false), se reintenta con el siguiente envío confirmado', async () => {
    const marcar = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const p = puertos([a('inicio_jornada', hace(10))], { marcarEnviada: marcar });
    const r = await correrAlertasTope(p, { ahora: AHORA });
    expect(marcar).toHaveBeenCalledTimes(2); // tras el encargado (falla) y tras el operador (entra)
    expect(r.fallos).toEqual([]);
  });

  it('si la marca nunca entra, no se calla: queda en fallos y aun así se cierra', async () => {
    const p = puertos([a('inicio_jornada', hace(10))], { marcarEnviada: vi.fn(async () => false) });
    const r = await correrAlertasTope(p, { ahora: AHORA });
    expect(r.fallos.join(' ')).toContain('candado');
    expect(p.cerrar).toHaveBeenCalled();
  });
});
