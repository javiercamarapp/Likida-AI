import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { crearDbFalsa, type DbFalsa, type Fila, type RpcResultado } from './db_falsa.test.util';

// ═══════════════════════════════════════════════════════════════════════════
// OLA 10 · A2P-06: si el cruce deja líneas sin escribir, el archivo NO se cierra «procesada» ni avisa: vuelve a la cola con backoff.
// ═══════════════════════════════════════════════════════════════════════════

let db: DbFalsa;
let forzarNoEscritas = 0;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const registrarCorrida = vi.fn(async (..._a: unknown[]) => {});
vi.mock('../intake/desglose_peaje', async (orig) => {
  const m = await orig<typeof import('../intake/desglose_peaje')>();
  return { ...m, conciliarDesglose: async (...a: Parameters<typeof m.conciliarDesglose>) => {
    const r = await m.conciliarDesglose(...a);
    return { ...r, noEscritas: forzarNoEscritas };
  } };
});
vi.mock('../agentes/corridas', () => ({ registrarCorrida: (...a: unknown[]) => registrarCorrida(...a) }));

const {
  recibirArchivoPeaje, procesarColaPeajes, reintentarArchivoPeaje, subirDesglosePorCola, huellaDe, byteaDeBuffer, MAX_PENDIENTES_POR_FLOTA, MAX_INTENTOS,
} = await import('./ingesta');
const { anularDesgloseDb } = await import('./repo');

const T = 'flota-1';
const CSV = 'Fecha de cobro;Hora;Plaza;Importe;No. TAG\n05/08/2026;10:30:00;Caseta Ejemplo Norte;189,50;IMDM 10000001\n';
const buf = (s: string) => Buffer.from(s);

/** El claim de la 0376 en memoria: pendientes con turno y procesando con lease vencido. */
let relojClaim = Date.now();
const ahoraClaim = () => Date.now();
function claimFalso(args: Record<string, unknown>): Fila[] {
  const limite = args.p_limite as number;
  const lease = args.p_lease_segundos as number;
  const token = `tok-${Math.random().toString(36).slice(2)}`;
  const elegibles = db.tablas.peaje_ingesta_archivo
    .filter((a) => a.contenido != null && (
      (a.estado === 'pendiente' && Date.parse(a.proximo_intento_en as string) <= ahoraClaim())
      || (a.estado === 'procesando' && a.reclamado_hasta != null && Date.parse(a.reclamado_hasta as string) < ahoraClaim())))
    .slice(0, limite);
  for (const a of elegibles) {
    a.estado = 'procesando';
    a.reclamo = token;
    a.reclamado_hasta = new Date(ahoraClaim() + lease * 1000).toISOString();
    a.intentos = (a.intentos as number) + 1;
  }
  return elegibles.map((a) => ({ id: a.id, tenant_id: a.tenant_id, nombre: a.nombre, proveedor: a.proveedor, intentos: a.intentos, reclamo: a.reclamo, desglose_id: a.desglose_id ?? null }));
}

/**
 * `peaje_archivo_encolar` (0850) en memoria: dedup por huella + tope de `MAX_PENDIENTES_POR_FLOTA`
 * por flota. No simula el candado de transacción (el fake es síncrono: una llamada corre COMPLETA
 * antes de que la siguiente empiece, así que ya es atómica sin necesitar uno) — simula el MISMO
 * contrato que la función de Postgres: dedup primero, tope después, insert al final.
 */
function encolarFalso(args: Record<string, unknown>): RpcResultado {
  const tenantId = args.p_tenant as string;
  const huella = args.p_huella as string;
  const existente = db.tablas.peaje_ingesta_archivo.find((a) => a.tenant_id === tenantId && a.huella === huella);
  if (existente) return [{ id: existente.id, estado: existente.estado, duplicado: true }];
  const pendientes = db.tablas.peaje_ingesta_archivo
    .filter((a) => a.tenant_id === tenantId && ['pendiente', 'procesando'].includes(a.estado as string)).length;
  if (pendientes >= MAX_PENDIENTES_POR_FLOTA) return { error: { message: `tope de ${MAX_PENDIENTES_POR_FLOTA} archivos pendientes por flota`, code: '54000' } };
  const id = `enc-${Math.random().toString(36).slice(2)}`;
  db.tablas.peaje_ingesta_archivo.push({
    id, tenant_id: tenantId, huella, nombre: args.p_nombre, proveedor: args.p_proveedor ?? null, origen: args.p_origen,
    bytes: args.p_bytes, contenido: args.p_contenido, estado: 'pendiente', intentos: 0, proximo_intento_en: new Date(relojClaim - 1000).toISOString(),
    reclamo: null, reclamado_hasta: null, desglose_id: null, ultimo_error: null,
  });
  return [{ id, estado: 'pendiente', duplicado: false }];
}

const archivo = (over: Fila = {}): Fila => ({
  id: 'a1', tenant_id: T, huella: huellaDe(buf(CSV)), nombre: 'pase.csv', proveedor: 'PASE', origen: 'api', bytes: CSV.length,
  contenido: byteaDeBuffer(buf(CSV)), estado: 'pendiente', intentos: 0, proximo_intento_en: new Date(relojClaim - 1000).toISOString(),
  reclamo: null, reclamado_hasta: null, desglose_id: null, ultimo_error: null, ...over,
});

beforeEach(() => {
  relojClaim = Date.now();
  db = crearDbFalsa({ peaje_ingesta_archivo: [] }, { peaje_archivo_reclamar: claimFalso, peaje_archivo_encolar: encolarFalso });
  registrarCorrida.mockClear();
  forzarNoEscritas = 0;
});
afterEach(() => vi.useRealTimers());


describe('A2P-06: cruce con líneas sin escribir', () => {
  it('con noEscritas > 0 el archivo vuelve a la cola con backoff, sin cerrarse procesada ni avisar', async () => {
    db.tablas.peaje_ingesta_archivo = [archivo()];
    forzarNoEscritas = 3;
    const avisar = vi.fn(async () => {});
    const r = await procesarColaPeajes({ avisar });
    expect(r).toMatchObject({ reintentar: 1, procesados: 0, fallidos: 0 });
    const a = db.tablas.peaje_ingesta_archivo[0];
    expect(a.estado).toBe('pendiente');
    expect(a.ultimo_error).toMatch(/3 líneas/);
    expect(a.contenido).not.toBeNull();
    expect(avisar).not.toHaveBeenCalled();
    expect(db.tablas.desglose_peaje).toHaveLength(1);
  });

  it('al reintentar (sin líneas sin escribir) se cierra procesada SIN duplicar el desglose', async () => {
    db.tablas.peaje_ingesta_archivo = [archivo()];
    forzarNoEscritas = 2;
    await procesarColaPeajes();
    forzarNoEscritas = 0;
    db.tablas.peaje_ingesta_archivo[0].proximo_intento_en = new Date(Date.now() - 1000).toISOString();
    const r = await procesarColaPeajes();
    expect(r).toMatchObject({ procesados: 1, reintentar: 0 });
    expect(db.tablas.peaje_ingesta_archivo[0].estado).toBe('procesada');
    expect(db.tablas.desglose_peaje).toHaveLength(1);
  });
});
