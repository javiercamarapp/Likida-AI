import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type DbFalsa, type Fila } from './db_falsa.test.util';

// ═══════════════════════════════════════════════════════════════════════════
// A33-06 (migración 0860): `registrarNotaDeCredito` usa la función atómica e idempotente de la base
// (`peaje_nota_credito_registrar`) y, si la migración aún no está aplicada, cae al camino anterior y lo avisa.
// La atomicidad real (candado de fila, dos sesiones) la prueba Postgres: supabase/tests/0860_*.
// Aquí se prueba el contrato del llamador con una base falsa.
// ═══════════════════════════════════════════════════════════════════════════

let db: DbFalsa;
const avisos: Array<[string, unknown]> = [];
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: (m: string, c: unknown) => { avisos.push([m, c]); }, error: vi.fn() } }));
vi.mock('../agentes/corridas', () => ({ registrarCorrida: vi.fn(async () => {}) }));

const R = await import('./repo');
const T = 'tenant-1';
const RECLAMO = '11111111-1111-4111-8111-111111111111';
const reclamo = (): Fila => ({ id: RECLAMO, tenant_id: T, estado: 'enviado', monto_reclamado: 1000, monto_acreditado: 0 });

type Args = Record<string, unknown>;
/** Imita la función de Postgres: idempotente por (reclamo, clave) y suma una sola vez. */
function rpcFalsa(args: Args, vistas: Set<string>, saldo: { v: number }) {
  const k = `${args.p_reclamo}|${args.p_clave}`;
  if (args.p_clave !== null && vistas.has(k)) return [{ ok: true, duplicada: true } as Fila];
  if (args.p_clave !== null) vistas.add(k);
  saldo.v += Number(args.p_monto);
  return [{ ok: true, duplicada: false } as Fila];
}

beforeEach(() => { avisos.length = 0; });

describe('registrarNotaDeCredito con la función de la base (0860)', () => {
  it('manda la clave de idempotencia; el mismo envío repetido (doble clic) suma una sola vez', async () => {
    const vistas = new Set<string>(); const saldo = { v: 0 };
    db = crearDbFalsa({ peaje_reclamo: [reclamo()] }, { peaje_nota_credito_registrar: (a) => rpcFalsa(a, vistas, saldo) });
    const entrada = { reclamoId: RECLAMO, monto: 300, fecha: '2026-09-10', referencia: 'NC-1', versionVista: 'enviado:0' };
    expect((await R.registrarNotaDeCredito(T, entrada)).ok).toBe(true);
    expect((await R.registrarNotaDeCredito(T, entrada)).ok).toBe(true); // el reintento no falla, tampoco duplica
    expect(saldo.v).toBe(300);
    const llamadas = db.llamadas.filter((l) => l.op === 'rpc');
    expect(llamadas).toHaveLength(2);
    // sin camino viejo: ninguna escritura directa a las tablas
    expect(db.llamadas.filter((l) => l.op === 'insert' || l.op === 'update')).toHaveLength(0);
    expect(avisos).toHaveLength(0);
  });

  it('otra nota (otro monto o otro estado visto) lleva otra clave y sí se registra', async () => {
    const vistas = new Set<string>(); const saldo = { v: 0 };
    db = crearDbFalsa({ peaje_reclamo: [reclamo()] }, { peaje_nota_credito_registrar: (a) => rpcFalsa(a, vistas, saldo) });
    const base = { reclamoId: RECLAMO, fecha: '2026-09-10', referencia: 'NC-1' };
    await R.registrarNotaDeCredito(T, { ...base, monto: 300, versionVista: 'enviado:0' });
    await R.registrarNotaDeCredito(T, { ...base, monto: 200, versionVista: 'enviado:0' });
    await R.registrarNotaDeCredito(T, { ...base, monto: 300, versionVista: 'acreditado_parcial:300' });
    expect(saldo.v).toBe(800);
  });

  it('pasa la flota y los datos normalizados a la función, y traduce sus rechazos', async () => {
    const recibidos: Args[] = [];
    db = crearDbFalsa({}, { peaje_nota_credito_registrar: (a) => { recibidos.push(a); return [{ ok: false, codigo: 'sin_enviar' } as Fila]; } });
    const r = await R.registrarNotaDeCredito(T, { reclamoId: RECLAMO, monto: 50, fecha: '2026-09-10', referencia: '  NC-9  ' });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('debía rechazarse');
    expect(r.motivo).toMatch(/marcalo como enviado|márcalo como enviado/i);
    expect(recibidos[0]).toMatchObject({ p_tenant: T, p_reclamo: RECLAMO, p_monto: 50, p_fecha: '2026-09-10', p_referencia: 'NC-9', p_clave: null });
    db = crearDbFalsa({}, { peaje_nota_credito_registrar: () => [{ ok: false, codigo: 'no_existe' } as Fila] });
    const r2 = await R.registrarNotaDeCredito(T, { reclamoId: RECLAMO, monto: 50, fecha: '2026-09-10' });
    expect(r2.ok).toBe(false);
  });

  it('un error real de la función NO cae al camino viejo (no se arriesga a duplicar)', async () => {
    db = crearDbFalsa({ peaje_reclamo: [reclamo()] }, { peaje_nota_credito_registrar: () => ({ error: { message: 'timeout', code: '57014' } }) });
    const r = await R.registrarNotaDeCredito(T, { reclamoId: RECLAMO, monto: 50, fecha: '2026-09-10', versionVista: 'enviado:0' });
    expect(r.ok).toBe(false);
    expect(db.llamadas.filter((l) => l.op === 'insert' || l.op === 'update')).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A36-R03-05 · la RPC 0860 no vetaba un reclamo `rechazado` ni topaba lo acreditado contra lo reclamado. Antes de la 0861
// el veto vive en el llamador TypeScript (lectura previa; no es atómico); la 0861 lo repite dentro de la función, bajo el candado.
// ═══════════════════════════════════════════════════════════════════════════
describe('registrarNotaDeCredito — vetos del llamador (A36-R03-05)', () => {
  const nuevoRpc = () => { const llamadas: Args[] = []; return { llamadas, fn: (a: Args) => { llamadas.push(a); return [{ ok: true, duplicada: false } as Fila]; } }; };

  it('un reclamo RECHAZADO no recibe notas de crédito: no revive en silencio ni llega a la función', async () => {
    const rpc = nuevoRpc();
    db = crearDbFalsa({ peaje_reclamo: [{ ...reclamo(), estado: 'rechazado' }] }, { peaje_nota_credito_registrar: rpc.fn });
    const r = await R.registrarNotaDeCredito(T, { reclamoId: RECLAMO, monto: 300, fecha: '2026-09-10', versionVista: 'rechazado:0' });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('debía rechazarse');
    expect(r.motivo).toMatch(/rechaz/i);
    expect(rpc.llamadas).toHaveLength(0);
  });

  it('una nota que deja lo acreditado por ENCIMA de lo reclamado (1,000.00): se rechaza con cifras; al centavo exacto sí pasa', async () => {
    const rpc = nuevoRpc();
    db = crearDbFalsa({ peaje_reclamo: [{ ...reclamo(), estado: 'acreditado_parcial', monto_acreditado: 700.5 }] }, { peaje_nota_credito_registrar: rpc.fn });
    const alta = await R.registrarNotaDeCredito(T, { reclamoId: RECLAMO, monto: 299.51, fecha: '2026-09-10' }); // 1,000.01
    expect(alta.ok).toBe(false);
    if (alta.ok) throw new Error('debía rechazarse');
    expect(alta.motivo).toContain('1,000.00');
    expect(alta.motivo).toContain('700.50');
    expect(rpc.llamadas).toHaveLength(0);
    const justa = await R.registrarNotaDeCredito(T, { reclamoId: RECLAMO, monto: 299.5, fecha: '2026-09-10' }); // 1,000.00
    expect(justa.ok).toBe(true);
    expect(rpc.llamadas).toHaveLength(1);
  });

  it('el reintento IDÉNTICO (doble clic) tras completar el reclamo no se vuelve un error: la función lo reconoce como duplicado', async () => {
    const vistas = new Set<string>();
    db = crearDbFalsa({ peaje_reclamo: [reclamo()], peaje_reclamo_nota: [] }, {
      peaje_nota_credito_registrar: (a) => {
        if (vistas.has(String(a.p_clave))) return [{ ok: true, duplicada: true } as Fila];
        vistas.add(String(a.p_clave));
        db.tablas.peaje_reclamo_nota.push({ tenant_id: T, reclamo_id: RECLAMO, clave_idempotencia: a.p_clave });
        Object.assign(db.tablas.peaje_reclamo[0], { monto_acreditado: 1000, estado: 'acreditado' });
        return [{ ok: true, duplicada: false } as Fila];
      },
    });
    const entrada = { reclamoId: RECLAMO, monto: 1000, fecha: '2026-09-10', referencia: 'NC-1', versionVista: 'enviado:0' };
    expect((await R.registrarNotaDeCredito(T, entrada)).ok).toBe(true);
    expect((await R.registrarNotaDeCredito(T, entrada)).ok).toBe(true);
    // pero una nota NUEVA sobre el reclamo ya completo sí se rechaza
    expect((await R.registrarNotaDeCredito(T, { ...entrada, monto: 50, versionVista: 'acreditado:1000' })).ok).toBe(false);
  });
});

// 0861: la función de la base ahora veta y topa de forma atómica. Si otra sesión cambió el reclamo entre la lectura previa y la función,
// la función contesta con un código nuevo y el llamador lo traduce (no el error genérico).
describe('registrarNotaDeCredito — códigos nuevos de la función 0861', () => {
  it('`rechazado` de la función (carrera con otra sesión) se traduce al mismo mensaje del veto', async () => {
    db = crearDbFalsa({ peaje_reclamo: [reclamo()] }, { peaje_nota_credito_registrar: () => [{ ok: false, codigo: 'rechazado' } as Fila] });
    const r = await R.registrarNotaDeCredito(T, { reclamoId: RECLAMO, monto: 50, fecha: '2026-09-10', versionVista: 'enviado:0' });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('debía rechazarse');
    expect(r.motivo).toMatch(/rechaz/i);
  });

  it('`excede_reclamado` trae las cifras de la base y se muestran', async () => {
    db = crearDbFalsa({ peaje_reclamo: [reclamo()] }, {
      peaje_nota_credito_registrar: () => [{ ok: false, codigo: 'excede_reclamado', monto_acreditado: 900, monto_reclamado: 1000 } as Fila],
    });
    const r = await R.registrarNotaDeCredito(T, { reclamoId: RECLAMO, monto: 150, fecha: '2026-09-10' });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('debía rechazarse');
    expect(r.motivo).toContain('1,050.00');
    expect(r.motivo).toContain('1,000.00');
    expect(r.motivo).toContain('900.00');
  });

  it('un código desconocido sigue siendo error genérico (compatibilidad con funciones futuras)', async () => {
    db = crearDbFalsa({ peaje_reclamo: [reclamo()] }, { peaje_nota_credito_registrar: () => [{ ok: false, codigo: 'algo_nuevo' } as Fila] });
    const r = await R.registrarNotaDeCredito(T, { reclamoId: RECLAMO, monto: 50, fecha: '2026-09-10' });
    expect(r.ok).toBe(false);
  });
});

describe('registrarNotaDeCredito sin la migración 0860 (camino anterior)', () => {
  for (const code of ['PGRST202', '42883']) {
    it(`cae al camino anterior y lo avisa (${code})`, async () => {
      db = crearDbFalsa({ peaje_reclamo: [reclamo()] }, { peaje_nota_credito_registrar: () => ({ error: { message: 'no existe la función', code } }) });
      const r = await R.registrarNotaDeCredito(T, { reclamoId: RECLAMO, monto: 400, fecha: '2026-09-10', referencia: 'NC-1', versionVista: 'enviado:0' });
      expect(r.ok).toBe(true);
      expect(db.tablas.peaje_reclamo[0]).toMatchObject({ monto_acreditado: 400, estado: 'acreditado_parcial' });
      expect(db.tablas.peaje_reclamo_nota).toHaveLength(1);
      expect(avisos.map((a) => a[0])).toContain('revision_cobros.nota_sin_0860');
    });
  }
});
