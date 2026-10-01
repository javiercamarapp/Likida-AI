import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type DbFalsa, type Fila } from './db_falsa.test.util';

// ═══════════════════════════════════════════════════════════════════════════
// DE PUNTA A PUNTA, con datos SINTÉTICOS (no son el formato real de PASE ni
// plazas reales): el proveedor manda su archivo FIRMADO al buzón → el cron lo
// importa y lo cruza (TAG↔unidad, gasto, GPS por caseta con Haversine) → la
// bitácora conciliada sale con cada línea en su estado honesto → todo
// idempotente ante reenvíos y re-conciliaciones.
// ═══════════════════════════════════════════════════════════════════════════

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/interruptores', () => ({ estaApagado: async () => false }));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => true, clientIp: () => '9.9.9.9' }));
vi.mock('../agentes/corridas', () => ({ registrarCorrida: async () => {} }));

const { POST } = await import('@/app/api/peajes/ingesta/route');
const { claveDeFlota, firmarIngesta, procesarColaPeajes } = await import('./ingesta');
const { bitacoraConciliada, bitacoraConciliadaACsv } = await import('./bitacora_conciliada');
const { conciliarDesglose } = await import('../intake/desglose_peaje');

const SECRETO = 'k'.repeat(40);
const T = '11111111-1111-4111-8111-111111111111';
const N = { lat: 19.5, lng: -99.2 }; // «Caseta Ejemplo Norte» (sintética)
const S = { lat: 19.0, lng: -99.0 }; // «Caseta Ejemplo Sur» (sintética)

// El archivo del proveedor (CSV con «;» y coma decimal, hora separada). 8 cruces:
const ARCHIVO = [
  'Fecha de cobro;Hora;Plaza;Importe;No. TAG',
  '05/08/2026;10:30:00;Caseta Ejemplo Norte;189,50;IMDM 10000001', // 1 gasto + GPS cerca        → cuadra
  '05/08/2026;11:30:00;Caseta Ejemplo Sur;100,00;IMDM 10000002',   // 2 gasto, GPS lejos         → por verificar
  '06/08/2026;09:00:00;Caseta Ejemplo Norte;200,00;IMDM 10000001', // 3 sin gasto, sin posiciones → sin respaldo
  '06/08/2026;09:30:00;Caseta Ejemplo Norte;50,00;IMDM 10000003',  // 4 sin gasto, con GPS cerca  → por verificar (solo GPS)
  '07/08/2026;;Caseta Ejemplo Norte;75,00;IMDM 10000001',          // 5 sin hora, sin gasto       → sin respaldo (sin GPS por falta de hora)
  ';;Caseta Ejemplo Norte;60,00;IMDM 10000001',                    // 6 sin fecha                 → por verificar
  '05/08/2026;10:45:00;Plaza Desconocida;30,00;ZZZZ99999999',      // 7 caseta fuera de catálogo, TAG sin alta → sin respaldo
  '05/08/2026;12:00:00;Caseta Ejemplo Norte;189,50;IMDM 10000001', // 8 su gasto (el 1) ya lo usó la línea 1 → por verificar (¿duplicado?)
].join('\n');

const posiciones = [
  { unidad_id: 'u1', lat: N.lat + 0.001, lng: N.lng, medida_en: '2026-08-05T16:30:30.000Z' }, // l1: cerca de Norte
  { unidad_id: 'u2', lat: S.lat + 0.2, lng: S.lng, medida_en: '2026-08-05T17:28:00.000Z' },   // l2: lejos de Sur (envuelve)
  { unidad_id: 'u2', lat: S.lat + 0.2, lng: S.lng + 0.01, medida_en: '2026-08-05T17:32:00.000Z' },
  { unidad_id: 'u3', lat: N.lat, lng: N.lng + 0.001, medida_en: '2026-08-06T15:30:10.000Z' }, // l4: cerca de Norte
];

function base(): Record<string, Fila[]> {
  return {
    peaje_ingesta_config: [{ tenant_id: T, rotacion: 1, activa: true }],
    peaje_ingesta_archivo: [],
    unidad: [
      { id: 'u1', tenant_id: T, numero_economico: 'C2-08', placas: null },
      { id: 'u2', tenant_id: T, numero_economico: 'C2-09', placas: null },
      { id: 'u3', tenant_id: T, numero_economico: 'C2-10', placas: null },
    ],
    peaje_tag: [
      { id: 't1', tenant_id: T, tag: 'IMDM10000001', unidad_id: 'u1', activo: true },
      { id: 't2', tenant_id: T, tag: 'IMDM10000002', unidad_id: 'u2', activo: true },
      { id: 't3', tenant_id: T, tag: 'IMDM10000003', unidad_id: 'u3', activo: true },
    ],
    peaje_caseta: [
      { id: 'cN', tenant_id: T, nombre: 'Caseta Ejemplo Norte', nombre_norm: 'caseta ejemplo norte', alias: [], lat: N.lat, lng: N.lng, radio_m: 300, activa: true },
      { id: 'cS', tenant_id: T, nombre: 'Caseta Ejemplo Sur', nombre_norm: 'caseta ejemplo sur', alias: [], lat: S.lat, lng: S.lng, radio_m: 300, activa: true },
    ],
    viaje: [{ id: 'v1', tenant_id: T, folio: 'V-1', unidad_id: 'u1' }, { id: 'v2', tenant_id: T, folio: 'V-2', unidad_id: 'u2' }],
    gasto: [
      { id: 'g1', tenant_id: T, concepto: 'caseta', viaje_id: 'v1', monto: 189.5, fecha: '2026-08-05' },
      { id: 'g2', tenant_id: T, concepto: 'caseta', viaje_id: 'v2', monto: 100, fecha: '2026-08-05' },
      { id: 'g-otro-dia', tenant_id: T, concepto: 'caseta', viaje_id: 'v1', monto: 20, fecha: '2026-08-20' },
    ],
  };
}

function claimFalso(args: Record<string, unknown>): Fila[] {
  const token = 'tok-' + Math.random().toString(36).slice(2);
  const els = db.tablas.peaje_ingesta_archivo.filter((a) => a.contenido != null && a.estado === 'pendiente').slice(0, args.p_limite as number);
  for (const a of els) { a.estado = 'procesando'; a.reclamo = token; a.reclamado_hasta = new Date(Date.now() + 300_000).toISOString(); a.intentos = (a.intentos as number) + 1; }
  return els.map((a) => ({ id: a.id, tenant_id: a.tenant_id, nombre: a.nombre, proveedor: a.proveedor, intentos: a.intentos, reclamo: a.reclamo, desglose_id: null }));
}
const rpcPosiciones = (args: Record<string, unknown>): Fila[] =>
  (args.p_ventanas as Array<{ linea_id: string; unidad_id: string; desde: string; hasta: string }>).flatMap((v) =>
    posiciones.filter((p) => p.unidad_id === v.unidad_id && p.medida_en >= v.desde && p.medida_en <= v.hasta)
      .map((p) => ({ linea_id: v.linea_id, lat: p.lat, lng: p.lng, medida_en: p.medida_en })));

async function enviar(nombre = 'corte-pase.csv', contenido = ARCHIVO) {
  const cuerpo = JSON.stringify({ nombre, proveedor: 'PASE', contenido_base64: Buffer.from(contenido).toString('base64') });
  const ts = Math.floor(Date.now() / 1000);
  return POST(new Request('https://app.likida.ai/api/peajes/ingesta', {
    method: 'POST', body: cuerpo,
    headers: {
      'x-likida-flota': T, 'x-likida-timestamp': String(ts),
      'x-likida-firma': firmarIngesta(claveDeFlota(SECRETO, T, 1), T, ts, cuerpo),
    },
  }));
}

beforeEach(() => {
  process.env.PEAJES_INGESTA_SECRETO = SECRETO;
  db = crearDbFalsa(base(), { peaje_archivo_reclamar: claimFalso, peaje_posiciones_ventana: rpcPosiciones });
});

describe('el recorrido completo', () => {
  it('recibe firmado, procesa, cruza y entrega la bitácora conciliada con cada línea en su estado honesto', async () => {
    expect((await enviar()).status).toBe(202);
    const r = await procesarColaPeajes();
    expect(r).toMatchObject({ tomados: 1, procesados: 1, fallidos: 0 });

    const desgloseId = String(db.tablas.desglose_peaje[0].id);
    const b = (await bitacoraConciliada(T, desgloseId))!;
    expect(b.filas).toHaveLength(8);
    const f = b.filas;

    expect(f[0]).toMatchObject({ estado: 'cuadra', motivo: 'gasto_y_gps', viaje: 'V-1', unidad: 'C2-08', casetaCatalogo: 'Caseta Ejemplo Norte', gps: 'confirma', monto: 189.5, hora: '10:30:00' });
    expect(f[1]).toMatchObject({ estado: 'por_verificar', motivo: 'gps_no_coincide', gps: 'no coincide', unidad: 'C2-09' });
    expect(f[1].gpsDistanciaM).toBeGreaterThan(20_000);
    expect(f[2]).toMatchObject({ estado: 'sin_respaldo', motivo: 'sin_gasto_sin_gps', gps: 'sin datos', gpsNota: expect.stringMatching(/no tiene posiciones/) });
    expect(f[3]).toMatchObject({ estado: 'por_verificar', motivo: 'solo_gps', gps: 'confirma', unidad: 'C2-10' });
    expect(f[4]).toMatchObject({ estado: 'sin_respaldo', gps: 'sin datos', gpsNota: expect.stringMatching(/no trae la hora/) });
    expect(f[5]).toMatchObject({ estado: 'por_verificar', motivo: 'sin_fecha', fecha: '' });
    expect(f[6]).toMatchObject({ estado: 'sin_respaldo', gps: 'sin datos', unidad: '', casetaCatalogo: '' });
    expect(f[7]).toMatchObject({ estado: 'por_verificar', motivo: 'contraparte_reclamada' });

    expect(b.resumen).toMatchObject({ total: 8, cuadra: 1, sinRespaldo: 3, porVerificar: 4 });
    expect(b.sinEvaluarGps).toBe(0);
  });

  it('el CSV final trae la leyenda y no acusa: ningún estado dice «fraude» ni «indebido» sin negarlo', async () => {
    await enviar();
    await procesarColaPeajes();
    const csv = bitacoraConciliadaACsv((await bitacoraConciliada(T, String(db.tablas.desglose_peaje[0].id)))!);
    expect(csv).toMatch(/^# Bitácora conciliada/);
    expect(csv).toMatch(/Resumen: 8 líneas · cuadra 1/);
    expect(csv.toLowerCase()).not.toMatch(/fraude|robo|ilegal/);
    for (const l of csv.split('\n')) if (/indebido/i.test(l)) expect(l).toMatch(/no afirma|NO afirma|no se afirma/i);
  });

  it('reenviar el mismo archivo (el proveedor reintenta) NO crea otro desglose', async () => {
    await enviar();
    await procesarColaPeajes();
    const dup = await enviar('copia-renombrada.csv');
    expect(dup.status).toBe(200);
    expect(await dup.json()).toMatchObject({ duplicado: true, estado: 'procesada' });
    expect((await procesarColaPeajes()).tomados).toBe(0);
    expect(db.tablas.desglose_peaje).toHaveLength(1);
    expect(db.tablas.desglose_peaje_linea).toHaveLength(8);
  });

  it('re-conciliar tras cargar el gasto faltante mueve la línea de «sin respaldo» a «cuadra» y no toca las demás', async () => {
    await enviar();
    await procesarColaPeajes();
    const desgloseId = String(db.tablas.desglose_peaje[0].id);
    const antes = (await bitacoraConciliada(T, desgloseId))!.filas.map((x) => x.estado);
    // llega el ticket rezagado de la línea 3 (06/08, $200.00, viaje de u1) …
    db.tablas.gasto.push({ id: 'g3', tenant_id: T, concepto: 'caseta', viaje_id: 'v1', monto: 200, fecha: '2026-08-06' });
    await conciliarDesglose(T, desgloseId, 'manual');
    const despues = (await bitacoraConciliada(T, desgloseId))!.filas;
    expect(antes[2]).toBe('sin_respaldo');
    expect(despues[2]).toMatchObject({ estado: 'cuadra', motivo: 'gasto' }); // sin GPS (u1 no tiene posiciones ese día), pero con gasto
    expect(despues.map((x) => x.estado).filter((_, i) => i !== 2 && i !== 7)).toEqual(antes.filter((_, i) => i !== 2 && i !== 7));
  });

  it('sin catálogo de casetas ni TAGs el flujo sigue: nada se acusa, todo dice qué falta', async () => {
    db.tablas.peaje_caseta = [];
    db.tablas.peaje_tag = [];
    await enviar();
    await procesarColaPeajes();
    const b = (await bitacoraConciliada(T, String(db.tablas.desglose_peaje[0].id)))!;
    expect(b.filas.every((x) => x.gps !== 'no coincide' && x.gps !== 'confirma')).toBe(true);
    expect(b.filas.every((x) => x.estado !== 'cuadra' || x.motivo === 'gasto')).toBe(true);
  });
});
