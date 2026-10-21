import { describe, it, expect, vi } from 'vitest';
import { crearDbFalsa, type DbFalsa, type Fila, type RpcResultado } from './db_falsa.test.util';

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../agentes/corridas', () => ({ registrarCorrida: async () => {} }));

const { recibirArchivoPeaje, huellaDe, byteaDeBuffer, MAX_PENDIENTES_POR_FLOTA } = await import('./ingesta');

const T = 'flota-race';
const buf = (s: string) => Buffer.from(s);

const archivo = (over: Fila = {}): Fila => ({
  id: 'a1', tenant_id: T, huella: huellaDe(buf('x')), nombre: 'p.csv', proveedor: 'PASE', origen: 'api', bytes: 1,
  contenido: byteaDeBuffer(buf('x')), estado: 'pendiente', intentos: 0, proximo_intento_en: new Date().toISOString(),
  reclamo: null, reclamado_hasta: null, desglose_id: null, ultimo_error: null, ...over,
});

// ═══════════════════════════════════════════════════════════════════════════
// 0850 — ANTES de la corrección, `recibirArchivoPeaje` hacía un SELECT count de
// pendientes y un INSERT por separado (sin candado): este archivo reproducía el
// TOCTOU con `Promise.all` — ambos envíos veían el mismo count bajo el tope y
// los dos insertaban, rebasándolo (51+).
//
// DESPUÉS de la corrección, `recibirArchivoPeaje` hace UNA sola llamada a
// `peaje_archivo_encolar` (0850), que junta dedup + candado de transacción por
// flota + tope + insert en la base. Aquí (fake síncrono de supabase-js) esa
// atomicidad se simula registrando `peaje_archivo_encolar` con el MISMO
// contrato que la función real: una llamada corre completa antes de que la
// siguiente empiece. La prueba de concurrencia REAL (dos conexiones de
// Postgres de verdad) vive en
// `supabase/tests/0850_peaje_ingesta_tope_candado_concurrencia.sh`.
// ═══════════════════════════════════════════════════════════════════════════
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
    bytes: args.p_bytes, contenido: args.p_contenido, estado: 'pendiente', intentos: 0, proximo_intento_en: new Date().toISOString(),
    reclamo: null, reclamado_hasta: null, desglose_id: null, ultimo_error: null,
  });
  return [{ id, estado: 'pendiente', duplicado: false }];
}

describe('TOCTOU en recibirArchivoPeaje (verificación independiente)', () => {
  it(`dos envíos CONCURRENTES con contenido DISTINTO, un hueco por debajo del tope (${MAX_PENDIENTES_POR_FLOTA}), ya NO pasan ambos ni superan el tope`, async () => {
    db = crearDbFalsa(
      { peaje_ingesta_archivo: Array.from({ length: MAX_PENDIENTES_POR_FLOTA - 1 }, (_, i) => archivo({ id: `p${i}`, huella: `h${i}` })) },
      { peaje_archivo_encolar: encolarFalso },
    );
    expect(db.tablas.peaje_ingesta_archivo).toHaveLength(MAX_PENDIENTES_POR_FLOTA - 1);

    const [r1, r2] = await Promise.all([
      recibirArchivoPeaje(T, { nombre: 'uno.csv', proveedor: null, contenido: buf('contenido-A') }),
      recibirArchivoPeaje(T, { nombre: 'dos.csv', proveedor: null, contenido: buf('contenido-B') }),
    ]);

    const pendientesFinal = db.tablas.peaje_ingesta_archivo.filter((f) => f.tenant_id === T && ['pendiente', 'procesando'].includes(f.estado as string)).length;

    console.log('r1=', r1, 'r2=', r2, 'pendientesFinal=', pendientesFinal);

    // Lo que el comentario del código PROMETE: nunca más de MAX_PENDIENTES_POR_FLOTA.
    // Antes de la 0850 esto fallaba: ambos insertaban y el tope quedaba superado.
    expect(pendientesFinal).toBeLessThanOrEqual(MAX_PENDIENTES_POR_FLOTA);
    expect([r1.ok, r2.ok].filter(Boolean).length).toBeLessThanOrEqual(1);
  });
});
