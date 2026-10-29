import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type DbFalsa } from './db_falsa.test.util';

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const R = await import('./repo');

const T = 'tenant-1';
const OTRO = 'tenant-2';

describe('sello de avisos (peaje_aviso_enviado, 0937)', () => {
  beforeEach(() => { db = crearDbFalsa({}); });

  it('reservar es un compare-and-set: el primero gana, el segundo no', async () => {
    expect(await R.reservarAvisoPeajes(T, 'plazo', 'd1:30')).toBe(true);
    expect(await R.reservarAvisoPeajes(T, 'plazo', 'd1:30')).toBe(false);
    expect(await R.reservarAvisoPeajes(T, 'plazo', 'd1:7')).toBe(true);
    expect(await R.reservarAvisoPeajes(OTRO, 'plazo', 'd1:30')).toBe(true); // otra flota, otro sello
  });
  it('liberar devuelve el sello solo de esa flota y ese aviso', async () => {
    await R.reservarAvisoPeajes(T, 'plazo', 'd1:30');
    await R.reservarAvisoPeajes(OTRO, 'plazo', 'd1:30');
    await R.liberarAvisoPeajes(T, 'plazo', 'd1:30');
    expect(db.tablas.peaje_aviso_enviado.map((x) => x.tenant_id)).toEqual([OTRO]);
    expect(await R.reservarAvisoPeajes(T, 'plazo', 'd1:30')).toBe(true);
  });
  it('sello de dos fases: confirmar lo vuelve definitivo y soltar una reserva no toca un aviso ya dado', async () => {
    const t0 = new Date('2026-10-15T18:00:00Z');
    expect(await R.reservarAvisoPeajes(T, 'plazo', 'd1:30', t0)).toBe(true);
    await R.confirmarAvisoPeajes(T, 'plazo', 'd1:30', t0);
    await R.confirmarAvisoPeajes(T, 'plazo', 'd1:30', t0); // idempotente
    expect(db.tablas.peaje_aviso_enviado.map((x) => x.clave)).toEqual(['d1:30']); // la reserva se soltó, queda el definitivo
    expect(await R.reservarAvisoPeajes(T, 'plazo', 'd1:30', new Date(t0.getTime() + 3_600_000))).toBe(false);
    await R.liberarAvisoPeajes(T, 'plazo', 'd1:30');
    expect(db.tablas.peaje_aviso_enviado.map((x) => x.clave)).toEqual(['d1:30']);
  });
  it('si el proceso muere tras reservar y antes de enviar, la reserva VENCE y el siguiente barrido la toma (el aviso no se pierde)', async () => {
    const t0 = new Date('2026-10-15T18:00:00Z');
    expect(await R.reservarAvisoPeajes(T, 'plazo', 'd1:30', t0)).toBe(true); // …y el proceso muere aquí
    expect(await R.reservarAvisoPeajes(T, 'plazo', 'd1:30', new Date(t0.getTime() + 60_000))).toBe(false); // reserva vigente: otro proceso no lo duplica
    const tarde = new Date(t0.getTime() + R.LEASE_RESERVA_AVISO_MS + 1);
    expect(await R.reservarAvisoPeajes(T, 'plazo', 'd1:30', tarde)).toBe(true);   // vencida: se toma
    expect(await R.reservarAvisoPeajes(T, 'plazo', 'd1:30', tarde)).toBe(false);  // y de nuevo vigente
    expect(db.tablas.peaje_aviso_enviado).toHaveLength(1);
  });
  it('un error de base lanza (no se confunde con «ya avisado»)', async () => {
    db.fallar('peaje_aviso_enviado.upsert', 'boom');
    await expect(R.reservarAvisoPeajes(T, 'plazo', 'x')).rejects.toThrow(/reservarAvisoPeajes/);
  });
});

describe('listarFlotasConAvisos', () => {
  it('solo las flotas con algún interruptor encendido, con su plazo y su teléfono', async () => {
    db = crearDbFalsa({
      peaje_atipico_config: [
        { tenant_id: T, activo: false, umbrales: { config_peajes: { plazo: { meses: 4, avisoDias: [20] }, interruptores: { aviso_plazo: true } }, aviso: { telefono: ' 5215500000000 ' } } },
        { tenant_id: OTRO, activo: true, umbrales: { config_peajes: { interruptores: { aviso_plazo: false, recordatorio_archivo: false } } } },
        { tenant_id: 'tenant-3', activo: true, umbrales: {} },
      ],
    });
    const r = await R.listarFlotasConAvisos();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ tenantId: T, telefono: '5215500000000' });
    expect(r[0].avisos.plazo).toEqual({ meses: 4, avisoDias: [20] });
    expect(r[0].avisos.interruptores).toEqual({ aviso_plazo: true, recordatorio_archivo: false });
  });
});

describe('desglosesRecientesParaAvisos', () => {
  it('trae solo los vigentes de la flota recibidos desde la fecha, con el periodo oficial (o el medido)', async () => {
    db = crearDbFalsa({
      desglose_peaje: [
        { id: 'a', tenant_id: T, anulado_en: null, creado_en: '2026-10-01T00:00:00Z', periodo_oficial_desde: '2026-09-21', periodo_oficial_hasta: '2026-09-30', periodo_desde: '2026-09-18', periodo_hasta: '2026-09-30' },
        { id: 'b', tenant_id: T, anulado_en: null, creado_en: '2026-10-02T00:00:00Z', periodo_oficial_desde: null, periodo_oficial_hasta: null, periodo_desde: '2026-10-01', periodo_hasta: '2026-10-10' },
        { id: 'c', tenant_id: T, anulado_en: '2026-10-03T00:00:00Z', creado_en: '2026-10-03T00:00:00Z' },
        { id: 'd', tenant_id: OTRO, anulado_en: null, creado_en: '2026-10-04T00:00:00Z' },
        { id: 'e', tenant_id: T, anulado_en: null, creado_en: '2026-01-01T00:00:00Z' },
      ],
    });
    const r = await R.desglosesRecientesParaAvisos(T, '2026-08-01T00:00:00-06:00');
    expect(r.map((x) => x.id).sort()).toEqual(['a', 'b']);
    expect(r.find((x) => x.id === 'a')).toMatchObject({ periodoDesde: '2026-09-21', periodoHasta: '2026-09-30' });
    expect(r.find((x) => x.id === 'b')).toMatchObject({ periodoDesde: '2026-10-01', periodoHasta: '2026-10-10' });
  });
});

// H759-1: un aviso bloqueado por configuración se aparta con backoff y tope (no acapara la cola global del barrido).
describe('posponerAviso (H759-1)', () => {
  const t0 = new Date('2026-10-28T12:00:00Z');
  const fila = (extra: Record<string, unknown> = {}) => ({ id: 'd1', tenant_id: T, aviso_requerido: true, aviso_esperas: 0, aviso_proximo_en: null, aviso_oficina_en: null, anulado_en: null, ...extra });

  it('el backoff duplica desde 15 min y topa en 24 h', () => {
    expect([1, 2, 3, 4, 8, 9, 12].map((n) => R.esperaAvisoMs(n) / 60_000)).toEqual([15, 30, 60, 120, 1440, 1440, 1440]);
  });

  it('la primera vez cuenta una espera y fija la próxima revisión; sigue en la cola', async () => {
    db = crearDbFalsa({ desglose_peaje: [fila()] });
    expect(await R.posponerAviso(T, 'd1', t0)).toEqual({ esperas: 1, salioDeLaCola: false });
    const f = db.tablas.desglose_peaje[0];
    expect(f.aviso_esperas).toBe(1);
    expect(f.aviso_proximo_en).toBe(new Date(t0.getTime() + 15 * 60_000).toISOString());
    expect(f.aviso_requerido).toBe(true);
  });

  it('al llegar al tope sale de la cola (aviso_requerido=false) y deja de ofrecerse', async () => {
    db = crearDbFalsa({ desglose_peaje: [fila({ aviso_esperas: R.TOPE_ESPERAS_AVISO - 1 })] });
    expect(await R.posponerAviso(T, 'd1', t0)).toEqual({ esperas: R.TOPE_ESPERAS_AVISO, salioDeLaCola: true });
    expect(db.tablas.desglose_peaje[0].aviso_requerido).toBe(false);
  });

  it('solo toca el desglose de SU flota y uno sin avisar/no anulado', async () => {
    db = crearDbFalsa({ desglose_peaje: [fila(), fila({ id: 'd2', anulado_en: '2026-10-01T00:00:00Z' })] });
    expect(await R.posponerAviso(OTRO, 'd1', t0)).toBeNull();
    expect(await R.posponerAviso(T, 'd2', t0)).toBeNull();
    expect(db.tablas.desglose_peaje.map((f) => f.aviso_esperas)).toEqual([0, 0]);
  });

  it('un error de base no lanza (devuelve null)', async () => {
    db = crearDbFalsa({ desglose_peaje: [fila()] });
    db.fallar('desglose_peaje.update', 'boom');
    expect(await R.posponerAviso(T, 'd1', t0)).toBeNull();
  });

  it('volver a marcar como requerido (reevaluación) reinicia la espera', async () => {
    db = crearDbFalsa({ desglose_peaje: [fila({ aviso_requerido: false, aviso_esperas: 12, aviso_proximo_en: '2026-11-01T00:00:00Z' })] });
    await R.marcarAvisoRequerido(T, 'd1');
    expect(db.tablas.desglose_peaje[0]).toMatchObject({ aviso_requerido: true, aviso_esperas: 0, aviso_proximo_en: null });
  });
});
