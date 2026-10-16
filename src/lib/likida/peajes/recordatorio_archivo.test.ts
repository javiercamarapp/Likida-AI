import { describe, expect, it } from 'vitest';
import {
  decenaCubierta, decenaVencida, recordarArchivoDecenal, textoRecordatorioArchivo,
  type DepsRecordatorio, type DesgloseCobertura,
} from './recordatorio_archivo';

const d = (desde: string, hasta: string, anulado = false): DesgloseCobertura => ({ periodoDesde: desde, periodoHasta: hasta, anulado });
const ON = { activo: true, diasGracia: 2 };

/** Almacén en memoria con la semántica de compare-and-set. */
function deps(extra: Partial<DepsRecordatorio> = {}) {
  const reservas = new Set<string>();
  const enviados: Array<{ tel: string; texto: string }> = [];
  const dep: DepsRecordatorio = {
    reservar: async (t, dc) => { const k = `${t}|${dc}`; if (reservas.has(k)) return false; reservas.add(k); return true; },
    liberar: async (t, dc) => { reservas.delete(`${t}|${dc}`); },
    telefono: async () => '+520000000000',
    enviar: async (tel, texto) => { enviados.push({ tel, texto }); return true; },
    liga: () => 'https://app.example/dashboard/agentes/peajes',
    ...extra,
  };
  return { dep, enviados, reservas };
}

describe('decenaVencida (meses de 28, 29, 30 y 31 días)', () => {
  it('mes de 30 días: la decena 21–30 vence el 2 del mes siguiente', () => {
    expect(decenaVencida('2026-10-01', 2)).toMatchObject({ desde: '2026-09-11', hasta: '2026-09-20' });
    expect(decenaVencida('2026-10-02', 2)).toMatchObject({ desde: '2026-09-21', hasta: '2026-09-30' });
  });
  it('mes de 31 días: cierra el 31', () => {
    expect(decenaVencida('2026-12-02', 2)).toMatchObject({ desde: '2026-11-21', hasta: '2026-11-30' });
    expect(decenaVencida('2026-08-02', 2)).toMatchObject({ desde: '2026-07-21', hasta: '2026-07-31' });
  });
  it('febrero de 28 y de 29 días', () => {
    expect(decenaVencida('2026-03-02', 2)).toMatchObject({ desde: '2026-02-21', hasta: '2026-02-28' });
    expect(decenaVencida('2028-03-02', 2)).toMatchObject({ desde: '2028-02-21', hasta: '2028-02-29' });
    expect(decenaVencida('2026-03-01', 2)).toMatchObject({ desde: '2026-02-11', hasta: '2026-02-20' });
  });
  it('cruce de año', () => {
    expect(decenaVencida('2027-01-02', 2)).toMatchObject({ desde: '2026-12-21', hasta: '2026-12-31' });
  });
  it('diasGracia 0: el mismo día del cierre ya cuenta; no antes', () => {
    expect(decenaVencida('2026-09-10', 0)).toMatchObject({ hasta: '2026-09-10' });
    expect(decenaVencida('2026-09-10', 1)).toMatchObject({ hasta: '2026-08-31' });
  });
  it('usa el día de México, no el UTC', () => {
    // 2026-10-02 03:00 UTC = 2026-10-01 21:00 en México: todavía no pasan 2 días del 30-sep.
    expect(decenaVencida(new Date('2026-10-02T03:00:00Z'), 2)).toMatchObject({ hasta: '2026-09-20' });
  });
});

describe('decenaCubierta', () => {
  const dec = { desde: '2026-09-21', hasta: '2026-09-30' };
  it('un archivo que cubre la decena completa (o varias) la cubre', () => {
    expect(decenaCubierta(dec, [d('2026-09-21', '2026-09-30')])).toBe(true);
    expect(decenaCubierta(dec, [d('2026-09-01', '2026-09-30')])).toBe(true);
  });
  it('una cobertura parcial, otra decena, sin periodo o anulado NO la cubre', () => {
    expect(decenaCubierta(dec, [d('2026-09-21', '2026-09-28')])).toBe(false);
    expect(decenaCubierta(dec, [d('2026-09-11', '2026-09-20')])).toBe(false);
    expect(decenaCubierta(dec, [{ periodoDesde: null, periodoHasta: null }])).toBe(false);
    expect(decenaCubierta(dec, [d('2026-09-21', '2026-09-30', true)])).toBe(false);
  });
});

describe('recordarArchivoDecenal', () => {
  const hoy = '2026-10-02';
  it('decena cubierta -> silencio', async () => {
    const { dep, enviados } = deps();
    const r = await recordarArchivoDecenal('t1', hoy, [d('2026-09-21', '2026-09-30')], ON, dep);
    expect(r.estado).toBe('cubierta');
    expect(enviados).toHaveLength(0);
  });
  it('archivo ausente -> 1 aviso, no 2 (segunda corrida: ya recordado)', async () => {
    const { dep, enviados } = deps();
    const r1 = await recordarArchivoDecenal('t1', hoy, [d('2026-09-01', '2026-09-20')], ON, dep);
    const r2 = await recordarArchivoDecenal('t1', '2026-10-03', [d('2026-09-01', '2026-09-20')], ON, dep);
    expect(r1).toEqual({ estado: 'enviado', decena: '2026-09-21/2026-09-30' });
    expect(r2.estado).toBe('ya_recordado');
    expect(enviados).toHaveLength(1);
    expect(enviados[0].texto).toContain('2026-09-21 a 2026-09-30');
  });
  it('la siguiente decena vuelve a recordar (una por decena)', async () => {
    const { dep, enviados } = deps();
    await recordarArchivoDecenal('t1', '2026-10-02', [], ON, dep);
    await recordarArchivoDecenal('t1', '2026-10-12', [], ON, dep);
    expect(enviados).toHaveLength(2);
  });
  it('si el archivo llega después, ya no avisa', async () => {
    const { dep, enviados } = deps();
    const r = await recordarArchivoDecenal('t1', '2026-10-05', [d('2026-09-21', '2026-09-30')], ON, dep);
    expect(r.estado).toBe('cubierta');
    expect(enviados).toHaveLength(0);
  });
  it('sin destinatario -> no envía ni reserva (queda para cuando lo configuren)', async () => {
    const { dep, enviados, reservas } = deps({ telefono: async () => null });
    const r = await recordarArchivoDecenal('t1', hoy, [], ON, dep);
    expect(r.estado).toBe('sin_destinatario');
    expect(enviados).toHaveLength(0);
    expect(reservas.size).toBe(0);
    const vacio = deps({ telefono: async () => '   ' });
    expect((await recordarArchivoDecenal('t1', hoy, [], ON, vacio.dep)).estado).toBe('sin_destinatario');
  });
  it('apagado (default) -> no consulta destinatario ni envía', async () => {
    let consultas = 0;
    const { dep, enviados } = deps({ telefono: async () => { consultas++; return '+520000000000'; } });
    const r = await recordarArchivoDecenal('t1', hoy, [], { activo: false, diasGracia: 2 }, dep);
    expect(r.estado).toBe('apagado');
    expect(consultas).toBe(0);
    expect(enviados).toHaveLength(0);
  });
  it('envío rechazado -> libera la reserva y el siguiente barrido reintenta', async () => {
    let falla = true;
    const { dep, enviados, reservas } = deps({ enviar: async (tel, texto) => { if (falla) return false; enviados.push({ tel, texto }); return true; } });
    const r1 = await recordarArchivoDecenal('t1', hoy, [], ON, dep);
    expect(r1.estado).toBe('fallido');
    expect(reservas.size).toBe(0);
    falla = false;
    const r2 = await recordarArchivoDecenal('t1', hoy, [], ON, dep);
    expect(r2.estado).toBe('enviado');
  });
  it('una dependencia que lanza no tumba al llamador y libera la reserva', async () => {
    const { dep, reservas } = deps({ enviar: async () => { throw new Error('red'); } });
    const r = await recordarArchivoDecenal('t1', hoy, [], ON, dep);
    expect(r.estado).toBe('fallido');
    expect(reservas.size).toBe(0);
  });
  it('flotas distintas no comparten la reserva', async () => {
    const { dep, enviados } = deps();
    await recordarArchivoDecenal('t1', hoy, [], ON, dep);
    await recordarArchivoDecenal('t2', hoy, [], ON, dep);
    expect(enviados).toHaveLength(2);
  });
  it('el texto no lleva nombres ni montos y dice que es un recordatorio', () => {
    const t = textoRecordatorioArchivo({ desde: '2026-09-21', hasta: '2026-09-30', etiqueta: '21 a 30' }, 'https://app.example/x');
    expect(t).toContain('recordatorio');
    expect(t).not.toMatch(/\$\d/);
  });
});
