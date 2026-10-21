import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type DbFalsa, type Fila, type RpcResultado } from './db_falsa.test.util';

// ═══════════════════════════════════════════════════════════════════════════
// T-A2-13 — el detector de cruces atípicos dentro de la ingesta, con datos
// SINTÉTICOS (unidades «TC9001/TC9002», casetas «Caseta Ejemplo …»).
// ═══════════════════════════════════════════════════════════════════════════

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const corridas: Array<{ estado: string; error?: string }> = [];
vi.mock('../agentes/corridas', () => ({ registrarCorrida: async (_t: string, _a: string, c: { estado: string; error?: string }) => { corridas.push(c); } }));

const { procesarColaPeajes, recibirArchivoPeaje, MAX_PENDIENTES_POR_FLOTA } = await import('./ingesta');
const { revisarAtipicosDeDesglose } = await import('./revision_atipicos');

const T = '11111111-1111-4111-8111-111111111111';
const ENC = 'Fecha de cobro;Hora;Plaza;Importe;No. TAG;No. economico';

// Decena 1: una fila de relleno el 01/09 (fija el periodo) y TRES cruces la noche del 10/09.
const ARCHIVO_1 = [ENC,
  '01/09/2026;08:00:00;Caseta Ejemplo Dos;50,00;IMDM 20000002;TC9002',
  '10/09/2026;21:00:00;Caseta Ejemplo Uno;100,00;IMDM 20000001;TC9001',
  '10/09/2026;22:00:00;Caseta Ejemplo Uno;100,00;IMDM 20000001;TC9001',
  '10/09/2026;23:00:00;Caseta Ejemplo Uno;100,00;IMDM 20000001;TC9001',
].join('\n');
// Decena 2: una fila de relleno el 11/09 y TRES cruces en la madrugada del 11/09.
const ARCHIVO_2 = [ENC,
  '11/09/2026;07:00:00;Caseta Ejemplo Dos;50,00;IMDM 20000002;TC9002',
  '11/09/2026;00:00:00;Caseta Ejemplo Uno;100,00;IMDM 20000001;TC9001',
  '11/09/2026;01:00:00;Caseta Ejemplo Uno;100,00;IMDM 20000001;TC9001',
  '11/09/2026;02:00:00;Caseta Ejemplo Uno;100,00;IMDM 20000001;TC9001',
].join('\n');

function claimFalso(args: Record<string, unknown>): Fila[] {
  const token = 'tok-' + Math.random().toString(36).slice(2);
  const els = db.tablas.peaje_ingesta_archivo.filter((a) => a.contenido != null && a.estado === 'pendiente').slice(0, args.p_limite as number);
  for (const a of els) { a.estado = 'procesando'; a.reclamo = token; a.reclamado_hasta = new Date(Date.now() + 300_000).toISOString(); a.intentos = (a.intentos as number) + 1; }
  return els.map((a) => ({ id: a.id, tenant_id: a.tenant_id, nombre: a.nombre, proveedor: a.proveedor, intentos: a.intentos, reclamo: a.reclamo, desglose_id: null }));
}

/** `peaje_archivo_encolar` (0850) en memoria — mismo contrato que en cola.test.ts: dedup por huella + tope por flota. */
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

async function ingerir(nombre: string, texto: string) {
  const r = await recibirArchivoPeaje(T, { nombre, proveedor: 'PASE', contenido: Buffer.from(texto) });
  expect(r.ok).toBe(true);
  return procesarColaPeajes({ avisar: async () => {} });
}

beforeEach(() => {
  corridas.length = 0;
  db = crearDbFalsa({
    peaje_ingesta_archivo: [],
    unidad: [], peaje_tag: [], peaje_caseta: [], viaje: [], gasto: [],
    peaje_atipico_config: [{ tenant_id: T, activo: true, umbrales: null }],
  }, { archivo_dummy: () => [], peaje_archivo_reclamar: claimFalso, peaje_archivo_encolar: encolarFalso, peaje_posiciones_ventana: () => [] });
});

describe('atípicos dentro de la ingesta', () => {
  it('dos archivos sintéticos: el patrón que cruza el límite entre ellos se detecta; ninguno solo lo vería', async () => {
    expect(await ingerir('decena-1.csv', ARCHIVO_1)).toMatchObject({ procesados: 1, fallidos: 0 });
    expect(db.tablas.peaje_atipico ?? []).toHaveLength(0); // 3 cruces: bajo el umbral (4)

    expect(await ingerir('decena-2.csv', ARCHIVO_2)).toMatchObject({ procesados: 1, fallidos: 0 });
    const h = db.tablas.peaje_atipico;
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ tenant_id: T, regla: 'repeticion_caseta', unidad_archivo: 'TC9001', estado: 'nuevo' });
    expect((h[0].detalle as { nCruces: number }).nCruces).toBe(6);
    expect(h[0].desglose_id).toBe(String(db.tablas.desglose_peaje[1].id));
  });

  it('re-correr la revisión es idempotente: no duplica ni pisa un estado ya revisado', async () => {
    await ingerir('decena-1.csv', ARCHIVO_1);
    await ingerir('decena-2.csv', ARCHIVO_2);
    db.tablas.peaje_atipico[0].estado = 'justificado';
    const r = await revisarAtipicosDeDesglose(T, String(db.tablas.desglose_peaje[1].id));
    expect(r).toMatchObject({ estado: 'ok', hallazgos: 1, nuevos: 0, yaExistian: 1, desglosesRevisados: 2 });
    expect(db.tablas.peaje_atipico).toHaveLength(1);
    expect(db.tablas.peaje_atipico[0].estado).toBe('justificado');
  });

  it('flag apagado = comportamiento de hoy: no se lee ni se escribe nada de atípicos', async () => {
    db.tablas.peaje_atipico_config = [{ tenant_id: T, activo: false, umbrales: null }];
    await ingerir('decena-1.csv', ARCHIVO_1);
    expect(await ingerir('decena-2.csv', ARCHIVO_2)).toMatchObject({ procesados: 1, fallidos: 0, reintentar: 0 });
    expect(db.tablas.peaje_atipico ?? []).toHaveLength(0);
    expect(db.llamadas.some((l) => l.tabla === 'peaje_atipico')).toBe(false);
    expect(corridas.every((c) => c.estado !== 'parcial')).toBe(true);
  });

  it('sin fila de configuración tampoco corre (apagado de origen)', async () => {
    db.tablas.peaje_atipico_config = [];
    await ingerir('decena-1.csv', ARCHIVO_1);
    await ingerir('decena-2.csv', ARCHIVO_2);
    expect(db.tablas.peaje_atipico ?? []).toHaveLength(0);
  });

  it('si el detector falla, la ingesta termina OK y el latido dice parcial', async () => {
    await ingerir('decena-1.csv', ARCHIVO_1);
    db.fallar('peaje_atipico.upsert', 'falla simulada del guardado');
    db.fallar('peaje_atipico.select', 'falla simulada de lectura');
    const r = await ingerir('decena-2.csv', ARCHIVO_2);
    expect(r).toMatchObject({ tomados: 1, procesados: 1, fallidos: 0, reintentar: 0 });
    expect(db.tablas.peaje_ingesta_archivo.map((a) => a.estado)).toEqual(['procesada', 'procesada']);
    const parcial = corridas.filter((c) => c.estado === 'parcial' && /atípicos/.test(c.error ?? ''));
    expect(parcial).toHaveLength(1);
  });
});
