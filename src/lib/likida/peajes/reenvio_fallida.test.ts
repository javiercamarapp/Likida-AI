import { describe, it, expect, vi } from 'vitest';
import { crearDbFalsa, type DbFalsa, type Fila, type RpcResultado } from './db_falsa.test.util';

// A36-R03-01: un archivo `fallida` (formato sin mapeo, barrido 0856) jamás se
// reprocesaba al reenviarlo: `peaje_archivo_encolar` devuelve duplicado=true y
// los canales (pull/SFTP/correo) lo cuentan como éxito. Regla segura (solo
// código): el reenvío del MISMO contenido de un archivo `fallida` que aún no
// agotó MAX_INTENTOS lo devuelve a `pendiente` con el contenido nuevo (que pudo
// haberse purgado a los 30 días). Con intentos agotados NO se re-encola
// (necesita «reintentar» manual): sigue siendo duplicado y se ve como fallida.

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../agentes/corridas', () => ({ registrarCorrida: async () => {} }));

const { recibirArchivoPeaje, huellaDe, MAX_INTENTOS } = await import('./ingesta');

const T = 'flota-reenvio';
const contenido = Buffer.from('desglose;sin;mapeo');

const fallida = (over: Fila = {}): Fila => ({
  id: 'f1', tenant_id: T, huella: huellaDe(contenido), nombre: 'p.csv', proveedor: 'PASE', origen: 'pull', bytes: contenido.length,
  contenido: null, estado: 'fallida', intentos: 1, proximo_intento_en: '2026-09-01T00:00:00Z',
  reclamo: 'tok', reclamado_hasta: null, desglose_id: null, ultimo_error: 'formato no reconocido', ...over,
});

// El RPC real (0850) devuelve la fila existente tal cual, sea cual sea su estado.
const encolarFalso = (args: Record<string, unknown>): RpcResultado => {
  const ex = db.tablas.peaje_ingesta_archivo.find((a) => a.tenant_id === args.p_tenant && a.huella === args.p_huella);
  return ex ? [{ id: ex.id, estado: ex.estado, duplicado: true }] : [];
};

describe('recibirArchivoPeaje — reenvío de un archivo fallido (A36-R03-01)', () => {
  it('fallida con contenido purgado y intentos < tope: el reenvío la vuelve a poner en cola con el contenido nuevo', async () => {
    db = crearDbFalsa({ peaje_ingesta_archivo: [fallida()] }, { peaje_archivo_encolar: encolarFalso });
    const r = await recibirArchivoPeaje(T, { nombre: 'p.csv', proveedor: 'PASE', contenido }, 'pull');
    expect(r).toMatchObject({ ok: true, id: 'f1', duplicado: false, estado: 'pendiente' });
    const f = db.tablas.peaje_ingesta_archivo[0];
    expect(f.estado).toBe('pendiente');
    expect(f.contenido).not.toBeNull();
    expect(f.reclamo).toBeNull();
    expect(f.ultimo_error).toBeNull();
    // No se reinician los intentos: el tope acota los reenvíos en bucle.
    expect(f.intentos).toBe(1);
  });

  it('fallida con intentos agotados NO se re-encola: sigue duplicado/fallida', async () => {
    db = crearDbFalsa({ peaje_ingesta_archivo: [fallida({ intentos: MAX_INTENTOS })] }, { peaje_archivo_encolar: encolarFalso });
    const r = await recibirArchivoPeaje(T, { nombre: 'p.csv', proveedor: 'PASE', contenido }, 'pull');
    expect(r).toMatchObject({ ok: true, duplicado: true, estado: 'fallida' });
    expect(db.tablas.peaje_ingesta_archivo[0].estado).toBe('fallida');
  });

  it('un archivo ya procesada o pendiente sigue siendo duplicado puro (no se toca)', async () => {
    db = crearDbFalsa({ peaje_ingesta_archivo: [fallida({ estado: 'procesada', intentos: 1 })] }, { peaje_archivo_encolar: encolarFalso });
    const r = await recibirArchivoPeaje(T, { nombre: 'p.csv', proveedor: 'PASE', contenido }, 'pull');
    expect(r).toMatchObject({ ok: true, duplicado: true, estado: 'procesada' });
    expect(db.tablas.peaje_ingesta_archivo[0].contenido).toBeNull();
  });
});

// 0861: el rearme pasa por `peaje_archivo_rearmar` (candado por flota + tope de 50 + tope de intentos en la base).
// Aquí se prueba el contrato del llamador con una base falsa; la atomicidad real la prueba supabase/tests/0861_*.
describe('recibirArchivoPeaje — rearme por la función de la base (0861)', () => {
  const rearmarFalso = (args: Record<string, unknown>): RpcResultado => {
    const f = db.tablas.peaje_ingesta_archivo.find((a) => a.tenant_id === args.p_tenant && a.id === args.p_archivo);
    if (!f) return [{ ok: false, codigo: 'no_existe' }];
    const activos = db.tablas.peaje_ingesta_archivo.filter((a) => a.tenant_id === args.p_tenant && ['pendiente', 'procesando'].includes(a.estado as string)).length;
    if (f.estado !== 'fallida') return [{ ok: false, codigo: 'no_fallida' }];
    if ((f.intentos as number) >= (args.p_max_intentos as number)) return [{ ok: false, codigo: 'intentos_agotados' }];
    if (activos >= 50) return [{ ok: false, codigo: 'cola_llena' }];
    Object.assign(f, { estado: 'pendiente', contenido: args.p_contenido, reclamo: null, ultimo_error: null });
    return [{ ok: true, rearmado: true }];
  };
  const regs = { peaje_archivo_encolar: encolarFalso, peaje_archivo_rearmar: rearmarFalso };

  it('usa la función (con MAX_INTENTOS) y NO escribe la tabla por el camino viejo', async () => {
    db = crearDbFalsa({ peaje_ingesta_archivo: [fallida()] }, regs);
    const r = await recibirArchivoPeaje(T, { nombre: 'p.csv', proveedor: 'PASE', contenido }, 'pull');
    expect(r).toMatchObject({ ok: true, duplicado: false, estado: 'pendiente' });
    const rpc = db.llamadas.filter((l) => l.op === 'rpc' && l.tabla === 'rpc:peaje_archivo_rearmar');
    expect(rpc).toHaveLength(1);
    expect(db.llamadas.filter((l) => l.op === 'update')).toHaveLength(0);
    expect(db.tablas.peaje_ingesta_archivo[0].intentos).toBe(1);
  });

  it('intentos agotados: la función lo niega y el reenvío sigue siendo duplicado/fallida', async () => {
    db = crearDbFalsa({ peaje_ingesta_archivo: [fallida({ intentos: MAX_INTENTOS })] }, regs);
    const r = await recibirArchivoPeaje(T, { nombre: 'p.csv', proveedor: 'PASE', contenido }, 'pull');
    expect(r).toMatchObject({ ok: true, duplicado: true, estado: 'fallida' });
  });

  it('cola llena (50): el rearme se rechaza como un archivo nuevo, para que el canal reintente después', async () => {
    const llenos = Array.from({ length: 50 }, (_, i) => fallida({ id: `p${i}`, huella: String(i).padStart(64, '0'), estado: 'pendiente', contenido: '\\x01' }));
    db = crearDbFalsa({ peaje_ingesta_archivo: [fallida(), ...llenos] }, regs);
    const r = await recibirArchivoPeaje(T, { nombre: 'p.csv', proveedor: 'PASE', contenido }, 'pull');
    expect(r).toMatchObject({ ok: false, codigo: 'cola_llena' });
    expect(db.tablas.peaje_ingesta_archivo[0].estado).toBe('fallida');
  });

  for (const code of ['PGRST202', '42883']) {
    it(`sin la migración 0861 (${code}) cae al UPDATE anterior`, async () => {
      db = crearDbFalsa({ peaje_ingesta_archivo: [fallida()] }, { peaje_archivo_encolar: encolarFalso, peaje_archivo_rearmar: () => ({ error: { message: 'no existe', code } }) });
      const r = await recibirArchivoPeaje(T, { nombre: 'p.csv', proveedor: 'PASE', contenido }, 'pull');
      expect(r).toMatchObject({ ok: true, duplicado: false, estado: 'pendiente' });
      expect(db.tablas.peaje_ingesta_archivo[0].estado).toBe('pendiente');
    });
  }

  it('un error real de la función NO cae al camino viejo: queda como estaba', async () => {
    db = crearDbFalsa({ peaje_ingesta_archivo: [fallida()] }, { peaje_archivo_encolar: encolarFalso, peaje_archivo_rearmar: () => ({ error: { message: 'timeout', code: '57014' } }) });
    const r = await recibirArchivoPeaje(T, { nombre: 'p.csv', proveedor: 'PASE', contenido }, 'pull');
    expect(r).toMatchObject({ ok: true, duplicado: true, estado: 'fallida' });
    expect(db.tablas.peaje_ingesta_archivo[0].estado).toBe('fallida');
  });
});
