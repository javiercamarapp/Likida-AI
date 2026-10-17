import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type DbFalsa, type Fila } from './db_falsa.test.util';

// ═══════════════════════════════════════════════════════════════════════════
// T-A2-33 — OBSERVABILIDAD MÍNIMA: nombres de log estables, PII fuera de los
// logs y errores en lenguaje llano. Datos SINTÉTICOS (TAG «IMDM 20000001»,
// unidad «TC9001», casetas «Caseta Ejemplo …»).
// ═══════════════════════════════════════════════════════════════════════════

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
const logs: Array<{ nivel: string; nombre: string; datos: unknown }> = [];
vi.mock('@/lib/logger', () => ({
  logger: {
    info: (nombre: string, datos?: unknown) => logs.push({ nivel: 'info', nombre, datos }),
    warn: (nombre: string, datos?: unknown) => logs.push({ nivel: 'warn', nombre, datos }),
    error: (nombre: string, datos?: unknown) => logs.push({ nivel: 'error', nombre, datos }),
  },
}));
const corridas: Array<{ estado: string; error?: string }> = [];
vi.mock('../agentes/corridas', () => ({ registrarCorrida: async (_t: string, _a: string, c: { estado: string; error?: string }) => { corridas.push(c); } }));

const { procesarColaPeajes, recibirArchivoPeaje, MAX_INTENTOS } = await import('./ingesta');
const { avisarPlazosReclamo } = await import('./aviso_plazo');

const T = '11111111-1111-4111-8111-111111111111';
const ENC = 'Fecha de cobro;Hora;Plaza;Importe;No. TAG;No. economico';
const TAG = 'IMDM 20000001';
const ARCHIVO = [ENC,
  `10/09/2026;21:00:00;Caseta Ejemplo Uno;100,00;${TAG};TC9001`,
  `10/09/2026;22:00:00;Caseta Ejemplo Uno;100,00;${TAG};TC9001`,
].join('\n');

function claimFalso(args: Record<string, unknown>): Fila[] {
  const token = 'tok-' + Math.random().toString(36).slice(2);
  const els = db.tablas.peaje_ingesta_archivo.filter((a) => a.contenido != null && a.estado === 'pendiente').slice(0, args.p_limite as number);
  for (const a of els) { a.estado = 'procesando'; a.reclamo = token; a.reclamado_hasta = new Date(Date.now() + 300_000).toISOString(); a.intentos = (a.intentos as number) + 1; }
  return els.map((a) => ({ id: a.id, tenant_id: a.tenant_id, nombre: a.nombre, proveedor: a.proveedor, intentos: a.intentos, reclamo: a.reclamo, desglose_id: null }));
}

const volcado = () => JSON.stringify(logs) + JSON.stringify(corridas);
const hayPII = (texto: string) => /IMDM|20000001|TC9001|100[.,]00/.test(texto);

beforeEach(() => {
  logs.length = 0; corridas.length = 0;
  db = crearDbFalsa({
    peaje_ingesta_archivo: [], unidad: [], peaje_tag: [], peaje_caseta: [], viaje: [], gasto: [],
    peaje_atipico_config: [{ tenant_id: T, activo: true, umbrales: null }],
  }, { archivo_dummy: () => [], peaje_archivo_reclamar: claimFalso, peaje_posiciones_ventana: () => [] });
});

describe('el detector de atípicos que falla', () => {
  it('log estable `cron.peajes.atipicos_fallo` sin tag/unidad/importe, el archivo queda procesado y el resumen lo cuenta', async () => {
    const r0 = await recibirArchivoPeaje(T, { nombre: 'decena.csv', proveedor: 'PASE', contenido: Buffer.from(ARCHIVO) });
    expect(r0.ok).toBe(true);
    // El mensaje de la base trae justo los valores que NO deben llegar al log.
    db.fallar('peaje_atipico_config.select', `llave duplicada (tag)=(${TAG}) unidad TC9001 monto 100.00`);
    const r = await procesarColaPeajes({ avisar: async () => {} });
    expect(r).toMatchObject({ procesados: 1, fallidos: 0, atipicos: { revisados: 0, hallazgos: 0, fallidos: 1 } });
    expect(db.tablas.peaje_ingesta_archivo[0].estado).toBe('procesada');
    const fallo = logs.filter((l) => l.nombre === 'cron.peajes.atipicos_fallo');
    expect(fallo).toHaveLength(1);
    expect(fallo[0].nivel).toBe('error');
    expect(JSON.stringify(fallo[0].datos)).toMatch(/codigo/);
    expect(hayPII(volcado())).toBe(false);
  });

  it('sin fallo: revisados y hallazgos en el resumen, cero fallidos', async () => {
    await recibirArchivoPeaje(T, { nombre: 'decena.csv', proveedor: 'PASE', contenido: Buffer.from(ARCHIVO) });
    const r = await procesarColaPeajes({ avisar: async () => {} });
    expect(r.atipicos).toEqual({ revisados: 1, hallazgos: 0, fallidos: 0 });
    expect(logs.some((l) => l.nombre === 'cron.peajes.atipicos_fallo')).toBe(false);
  });
});

describe('errores en lenguaje llano para quien ve la bitácora', () => {
  it('formato ilegible: causa + qué hacer', async () => {
    await recibirArchivoPeaje(T, { nombre: 'raro.csv', proveedor: 'PASE', contenido: Buffer.from('Col1,Col2\n1,2\n') });
    await procesarColaPeajes({ avisar: async () => {} });
    const c = corridas.find((x) => x.estado === 'fallo');
    expect(c?.error).toContain('raro.csv');
    expect(c?.error).toMatch(/vuelve a subirlo\.$/);
  });

  it('agotar los intentos por la base: corrida de fallo sin el mensaje técnico y con qué hacer; el log no lleva el mensaje', async () => {
    await recibirArchivoPeaje(T, { nombre: 'decena.csv', proveedor: 'PASE', contenido: Buffer.from(ARCHIVO) });
    db.tablas.peaje_ingesta_archivo[0].intentos = MAX_INTENTOS - 1;
    db.fallar('desglose_peaje.insert', `timeout con (tag)=(${TAG})`);
    const r = await procesarColaPeajes({ avisar: async () => {} });
    expect(r.fallidos).toBe(1);
    const c = corridas.find((x) => x.estado === 'fallo');
    expect(c?.error).toMatch(/decena\.csv/);
    expect(c?.error).toMatch(/avisa a soporte/);
    expect(c?.error).not.toMatch(/timeout|IMDM/);
    // (Los logs de intake/desglose_peaje.ts traen el mensaje de la base: pendiente aparte, ver T-A2-33.md.)
    const cola = logs.filter((l) => l.nombre === 'peajes.cola.fallo');
    expect(cola).toHaveLength(1);
    expect(hayPII(JSON.stringify(cola) + JSON.stringify(corridas))).toBe(false);
  });
});

describe('el aviso de plazos que falla', () => {
  const candidatos = [{ lineaId: 'l1', desgloseId: 'd1', fechaCruce: '2026-06-20', monto: 100, reclamado: false }];
  const deps = { reservar: async () => true, liberar: async () => {}, enviar: async () => true, liga: () => 'https://x.test', telefono: async () => '2899900000' };

  it('destinatario ilegible: log estable `cron.peajes.plazos_fallo` con paso y código, sin datos de línea', async () => {
    const r = await avisarPlazosReclamo(T, candidatos, '2026-09-15', { ...deps, telefono: async () => { throw new Error(`falla con ${TAG} TC9001`); } });
    expect(r.fallidos).toBe(1);
    const l = logs.filter((x) => x.nombre === 'cron.peajes.plazos_fallo');
    expect(l).toHaveLength(1);
    expect(l[0].datos).toMatchObject({ paso: 'destinatario' });
    expect(hayPII(JSON.stringify(l))).toBe(false);
  });

  it('envío que lanza: mismo nombre de log, paso `aviso`, sin el mensaje', async () => {
    const r = await avisarPlazosReclamo(T, candidatos, '2026-09-15', { ...deps, enviar: async () => { throw new Error(`boom ${TAG}`); } });
    expect(r.fallidos).toBe(1);
    const l = logs.filter((x) => x.nombre === 'cron.peajes.plazos_fallo');
    expect(l).toHaveLength(1);
    expect(l[0].datos).toMatchObject({ paso: 'aviso' });
    expect(hayPII(JSON.stringify(l))).toBe(false);
  });
});
