import { describe, expect, it, vi } from 'vitest';
import { avisarPlazosReclamo, textoAvisoPlazo, type DepsAvisoPlazo } from './aviso_plazo';
import type { CandidatoPlazo } from './plazo_reclamo';

const hoy = '2026-10-10';
const c = (lineaId: string, desgloseId: string, fechaCruce: string, monto: number, reclamado = false): CandidatoPlazo => ({ lineaId, desgloseId, fechaCruce, monto, reclamado });

/** Almacén en memoria con la semántica de compare-and-set. */
function deps(extra: Partial<DepsAvisoPlazo> = {}) {
  const reservas = new Set<string>();
  const enviados: Array<{ tel: string; texto: string }> = [];
  const d: DepsAvisoPlazo = {
    reservar: async (t, dg, u) => { const k = `${t}|${dg}|${u}`; if (reservas.has(k)) return false; reservas.add(k); return true; },
    liberar: async (t, dg, u) => { reservas.delete(`${t}|${dg}|${u}`); },
    telefono: async () => '+520000000000',
    enviar: async (tel, texto) => { enviados.push({ tel, texto }); return true; },
    liga: () => 'https://app.example/dashboard/agentes/peajes',
    ...extra,
  };
  return { d, enviados, reservas };
}

describe('avisarPlazosReclamo', () => {
  it('avisa una vez por (desglose, umbral): la segunda corrida no repite', async () => {
    const { d, enviados } = deps();
    const cand = [c('l1', 'dA', '2026-07-12', 300), c('l2', 'dA', '2026-07-13', 100)];
    const r1 = await avisarPlazosReclamo('t1', cand, hoy, d);
    const r2 = await avisarPlazosReclamo('t1', cand, hoy, d);
    expect(r1).toMatchObject({ enviados: 1, yaAvisados: 0, fallidos: 0 });
    expect(r2).toMatchObject({ enviados: 0, yaAvisados: 1 });
    expect(enviados).toHaveLength(1);
    expect(enviados[0].texto).toContain('2 cobros sin reclamar');
    expect(enviados[0].texto).toContain('$400.00');
  });
  it('al cruzar al siguiente umbral vuelve a avisar (30 y luego 7)', async () => {
    const { d, enviados } = deps();
    const cand = [c('l1', 'dA', '2026-07-20', 500)]; // límite 2026-10-20
    await avisarPlazosReclamo('t1', cand, '2026-09-25', d); // faltan 25 -> 30
    await avisarPlazosReclamo('t1', cand, '2026-10-05', d); // faltan 15 -> sigue 30: no repite
    await avisarPlazosReclamo('t1', cand, '2026-10-14', d); // faltan 6 -> 7
    expect(enviados).toHaveLength(2);
  });
  it('un candidato ya reclamado no avisa', async () => {
    const { d, enviados } = deps();
    const r = await avisarPlazosReclamo('t1', [c('l1', 'dA', '2026-07-12', 300, true)], hoy, d);
    expect(enviados).toHaveLength(0);
    expect(r).toMatchObject({ enviados: 0, yaAvisados: 0 });
  });
  it('los vencidos no avisan pero se cuentan como «ya no reclamables»', async () => {
    const { d, enviados } = deps();
    const r = await avisarPlazosReclamo('t1', [c('l1', 'dA', '2026-06-01', 250.5)], hoy, d);
    expect(enviados).toHaveLength(0);
    expect(r).toMatchObject({ vencidosCruces: 1, vencidosMonto: 250.5 });
  });
  it('sin destinatario: no reserva ni envía', async () => {
    const reservar = vi.fn(async () => true);
    const { d, enviados } = deps({ telefono: async () => null, reservar });
    const r = await avisarPlazosReclamo('t1', [c('l1', 'dA', '2026-07-12', 300)], hoy, d);
    expect(r.sinDestinatario).toBe(1);
    expect(reservar).not.toHaveBeenCalled();
    expect(enviados).toHaveLength(0);
  });
  it('si el envío falla, libera la reserva y el siguiente barrido reintenta', async () => {
    let falla = true;
    const { d, enviados } = deps({ enviar: async (tel, texto) => { if (falla) return false; enviados.push({ tel, texto }); return true; } });
    const cand = [c('l1', 'dA', '2026-07-12', 300)];
    const r1 = await avisarPlazosReclamo('t1', cand, hoy, d);
    falla = false;
    const r2 = await avisarPlazosReclamo('t1', cand, hoy, d);
    expect(r1.fallidos).toBe(1);
    expect(r2.enviados).toBe(1);
  });
  it('si enviar lanza, no lanza hacia fuera y libera', async () => {
    const { d, reservas } = deps({ enviar: async () => { throw new Error('red'); } });
    const r = await avisarPlazosReclamo('t1', [c('l1', 'dA', '2026-07-12', 300)], hoy, d);
    expect(r.fallidos).toBe(1);
    expect(reservas.size).toBe(0);
  });
  it('una fecha inválida en los datos no lanza: cuenta como fallo', async () => {
    const { d } = deps();
    const r = await avisarPlazosReclamo('t1', [c('l1', 'dA', 'sin-fecha', 300)], hoy, d);
    expect(r.fallidos).toBe(1);
  });
  it('flotas distintas no comparten reserva', async () => {
    const { d, enviados } = deps();
    const cand = [c('l1', 'dA', '2026-07-12', 300)];
    await avisarPlazosReclamo('t1', cand, hoy, d);
    await avisarPlazosReclamo('t2', cand, hoy, d);
    expect(enviados).toHaveLength(2);
  });
});

describe('textoAvisoPlazo', () => {
  const liga = 'https://app.example/x';
  it('singular, plural y el propio día límite', () => {
    expect(textoAvisoPlazo({ cruces: 1, monto: 10, diasMinimos: 1, fechaLimiteMasProxima: '2026-10-11' }, liga)).toContain('1 cobro sin reclamar');
    expect(textoAvisoPlazo({ cruces: 1, monto: 10, diasMinimos: 1, fechaLimiteMasProxima: '2026-10-11' }, liga)).toContain('vence en 1 día ');
    expect(textoAvisoPlazo({ cruces: 3, monto: 10, diasMinimos: 0, fechaLimiteMasProxima: '2026-10-10' }, liga)).toContain('vence HOY');
  });
  it('no acusa y dice que la regla no está confirmada por escrito', () => {
    const t = textoAvisoPlazo({ cruces: 2, monto: 5, diasMinimos: 7, fechaLimiteMasProxima: '2026-10-17' }, liga);
    expect(t).toContain('no afirma que el cobro sea indebido');
    expect(t).toContain('sin confirmar por escrito');
    expect(t).toContain(liga);
  });
});
