import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type DbFalsa, type Fila } from '../peajes/db_falsa.test.util';

// ═══════════════════════════════════════════════════════════════════════════
// E2E AGENTE 2 — PEAJES (archivo del proveedor × gasto × GPS × caseta).
//
// Cadena REAL: POST firmado /api/peajes/ingesta → cola con claim → importar →
// conciliar → bitácora conciliada. DOBLES: base en memoria (db_falsa), RPC de
// reclamo y de posiciones, interruptor del agente. Datos SINTÉTICOS (casetas
// «Ejemplo», TAG ficticios). Complementa peajes/flujo_completo.test.ts (que
// cubre el recorrido feliz, el reenvío y la re-conciliación): aquí el fallo, el
// fuera de orden y el otro tenant, y los casos feliz/duplicado de aislamiento.
// ═══════════════════════════════════════════════════════════════════════════

let db: DbFalsa;
let apagado = false;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/interruptores', () => ({ estaApagado: async () => apagado }));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => true, clientIp: () => '9.9.9.9' }));
vi.mock('../agentes/corridas', () => ({ registrarCorrida: async () => {} }));

const { POST } = await import('@/app/api/peajes/ingesta/route');
const { claveDeFlota, firmarIngesta, procesarColaPeajes } = await import('../peajes/ingesta');
const { bitacoraConciliada } = await import('../peajes/bitacora_conciliada');
const { conciliarDesglose } = await import('../intake/desglose_peaje');

const SECRETO = 'k'.repeat(40);
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const N = { lat: 19.5, lng: -99.2 };

const linea = (fecha: string, hora: string, monto: string, tag = 'IMDM 10000001') => `${fecha};${hora};Caseta Ejemplo Norte;${monto};${tag}`;
const ENCABEZADO = 'Fecha de cobro;Hora;Plaza;Importe;No. TAG';
const archivo = (...ls: string[]) => [ENCABEZADO, ...ls].join('\n');
const L1 = linea('05/08/2026', '10:30:00', '189,50');
const L2 = linea('06/08/2026', '09:00:00', '200,00');

let posiciones: Array<{ unidad_id: string; lat: number; lng: number; medida_en: string }>;

function tenant(T: string, sufijo: string): Record<string, Fila[]> {
  return {
    peaje_ingesta_config: [{ tenant_id: T, rotacion: 1, activa: true }],
    unidad: [{ id: `u-${sufijo}`, tenant_id: T, numero_economico: `E-${sufijo}`, placas: null }],
    peaje_tag: [{ id: `t-${sufijo}`, tenant_id: T, tag: 'IMDM10000001', unidad_id: `u-${sufijo}`, activo: true }],
    peaje_caseta: [{ id: `c-${sufijo}`, tenant_id: T, nombre: 'Caseta Ejemplo Norte', nombre_norm: 'caseta ejemplo norte', alias: [], lat: N.lat, lng: N.lng, radio_m: 300, activa: true }],
    viaje: [{ id: `v-${sufijo}`, tenant_id: T, folio: `V-${sufijo}`, unidad_id: `u-${sufijo}` }],
    gasto: [{ id: `g-${sufijo}`, tenant_id: T, concepto: 'caseta', viaje_id: `v-${sufijo}`, monto: 189.5, fecha: '2026-08-05' }],
  };
}
function base(): Record<string, Fila[]> {
  const a = tenant(A, 'a'); const b = tenant(B, 'b');
  const out: Record<string, Fila[]> = { peaje_ingesta_archivo: [] };
  for (const k of Object.keys(a)) out[k] = [...a[k], ...b[k]];
  return out;
}
function claimFalso(args: Record<string, unknown>): Fila[] {
  const token = 'tok-' + Math.random().toString(36).slice(2);
  const els = db.tablas.peaje_ingesta_archivo.filter((x) => x.contenido != null && x.estado === 'pendiente').slice(0, args.p_limite as number);
  for (const x of els) { x.estado = 'procesando'; x.reclamo = token; x.reclamado_hasta = new Date(Date.now() + 300_000).toISOString(); x.intentos = (x.intentos as number) + 1; }
  return els.map((x) => ({ id: x.id, tenant_id: x.tenant_id, nombre: x.nombre, proveedor: x.proveedor, intentos: x.intentos, reclamo: x.reclamo, desglose_id: null }));
}
const rpcPosiciones = (args: Record<string, unknown>): Fila[] =>
  (args.p_ventanas as Array<{ linea_id: string; unidad_id: string; desde: string; hasta: string }>).flatMap((v) =>
    posiciones.filter((p) => p.unidad_id === v.unidad_id && p.medida_en >= v.desde && p.medida_en <= v.hasta)
      .map((p) => ({ linea_id: v.linea_id, lat: p.lat, lng: p.lng, medida_en: p.medida_en })));

async function enviar(T: string, contenido: string, opts: { nombre?: string; rotacion?: number; firmarComo?: string; tsDeltaMs?: number } = {}) {
  const cuerpo = JSON.stringify({ nombre: opts.nombre ?? 'corte-pase.csv', proveedor: 'PASE', contenido_base64: Buffer.from(contenido).toString('base64') });
  const ts = Math.floor((Date.now() + (opts.tsDeltaMs ?? 0)) / 1000);
  const firmante = opts.firmarComo ?? T;
  return POST(new Request('https://app.likida.ai/api/peajes/ingesta', {
    method: 'POST', body: cuerpo,
    headers: { 'x-likida-flota': T, 'x-likida-timestamp': String(ts), 'x-likida-firma': firmarIngesta(claveDeFlota(SECRETO, firmante, opts.rotacion ?? 1), firmante, ts, cuerpo) },
  }));
}
const desgloseDe = (T: string) => String(db.tablas.desglose_peaje.find((d) => d.tenant_id === T)!.id);

beforeEach(() => {
  process.env.PEAJES_INGESTA_SECRETO = SECRETO;
  apagado = false;
  posiciones = [{ unidad_id: 'u-a', lat: N.lat + 0.001, lng: N.lng, medida_en: '2026-08-05T16:30:30.000Z' }];
  db = crearDbFalsa(base(), { peaje_archivo_reclamar: claimFalso, peaje_posiciones_ventana: rpcPosiciones });
});

describe('feliz', () => {
  it('firmado → cola → desglose → bitácora: gasto + GPS cerca de la caseta = «cuadra»', async () => {
    expect((await enviar(A, archivo(L1))).status).toBe(202);
    expect(await procesarColaPeajes()).toMatchObject({ tomados: 1, procesados: 1, fallidos: 0 });
    const b = (await bitacoraConciliada(A, desgloseDe(A)))!;
    expect(b.filas[0]).toMatchObject({ estado: 'cuadra', motivo: 'gasto_y_gps', gps: 'confirma', viaje: 'V-a' });
    expect(db.tablas.peaje_ingesta_archivo[0]).toMatchObject({ estado: 'procesada', contenido: null }); // el crudo se purga al procesar
  });
});

describe('fallo', () => {
  it('firma inválida, flota desconocida, timestamp viejo y buzón desactivado: 401 sin enseñar cuál fue, y nada se encola', async () => {
    expect((await enviar(A, archivo(L1), { firmarComo: B })).status).toBe(401);                 // firma de otra flota
    expect((await enviar(A, archivo(L1), { tsDeltaMs: -3_600_000 })).status).toBe(401);          // replay con hora vieja
    expect((await enviar('33333333-3333-4333-8333-333333333333', archivo(L1))).status).toBe(401); // flota sin buzón
    db.tablas.peaje_ingesta_config.find((c) => c.tenant_id === A)!.activa = false;
    expect((await enviar(A, archivo(L1))).status).toBe(401);
    expect(db.tablas.peaje_ingesta_archivo).toHaveLength(0);
  });

  it('con el agente apagado contesta 503 (el proveedor reintenta) y al encenderlo el MISMO archivo entra', async () => {
    apagado = true;
    expect((await enviar(A, archivo(L1))).status).toBe(503);
    expect(db.tablas.peaje_ingesta_archivo).toHaveLength(0);
    apagado = false;
    expect((await enviar(A, archivo(L1))).status).toBe(202);
  });

  it('un archivo que no se entiende queda FALLIDO con el motivo (no se reintenta en vano) y no crea líneas ni gastos', async () => {
    expect((await enviar(A, 'esto;no;es;un;desglose\nfoo;bar')).status).toBe(202);
    expect(await procesarColaPeajes()).toMatchObject({ tomados: 1, procesados: 0, fallidos: 1 });
    expect(db.tablas.peaje_ingesta_archivo[0]).toMatchObject({ estado: 'fallida' });
    expect(String(db.tablas.peaje_ingesta_archivo[0].ultimo_error).length).toBeGreaterThan(5);
    expect(db.tablas.desglose_peaje ?? []).toHaveLength(0);
    expect((await procesarColaPeajes()).tomados).toBe(0);
  });

  it('un cuerpo mal formado (firmado) es 400', async () => {
    const cuerpo = 'no-es-json'; const ts = Math.floor(Date.now() / 1000);
    const r = await POST(new Request('https://app.likida.ai/api/peajes/ingesta', { method: 'POST', body: cuerpo, headers: { 'x-likida-flota': A, 'x-likida-timestamp': String(ts), 'x-likida-firma': firmarIngesta(claveDeFlota(SECRETO, A, 1), A, ts, cuerpo) } }));
    expect(r.status).toBe(400);
  });
});

describe('duplicado', () => {
  it('el proveedor reenvía el mismo contenido con otro nombre: 200 duplicado, un solo desglose, un solo gasto usado', async () => {
    await enviar(A, archivo(L1)); await procesarColaPeajes();
    const dup = await enviar(A, archivo(L1), { nombre: 'otra-copia.csv' });
    expect(dup.status).toBe(200);
    expect(await dup.json()).toMatchObject({ duplicado: true });
    expect((await procesarColaPeajes()).tomados).toBe(0);
    expect(db.tablas.desglose_peaje).toHaveLength(1);
  });

  it('dos cruces idénticos en el MISMO archivo no usan el mismo gasto dos veces: el segundo queda «por verificar»', async () => {
    await enviar(A, archivo(L1, L1)); await procesarColaPeajes();
    const f = (await bitacoraConciliada(A, desgloseDe(A)))!.filas;
    expect(f.filter((x) => x.estado === 'cuadra')).toHaveLength(1);
    expect(f.filter((x) => x.motivo === 'contraparte_reclamada')).toHaveLength(1);
  });

  it('re-conciliar dos veces es idempotente', async () => {
    await enviar(A, archivo(L1, L2)); await procesarColaPeajes();
    const id = desgloseDe(A);
    const antes = (await bitacoraConciliada(A, id))!.filas.map((x) => [x.estado, x.motivo]);
    await conciliarDesglose(A, id, 'manual'); await conciliarDesglose(A, id, 'manual');
    expect((await bitacoraConciliada(A, id))!.filas.map((x) => [x.estado, x.motivo])).toEqual(antes);
  });
});

describe('fuera de orden', () => {
  it('el archivo trae las líneas desordenadas por fecha: cada una se concilia por su fecha, igual que ordenado', async () => {
    db.tablas.gasto.push({ id: 'g2-a', tenant_id: A, concepto: 'caseta', viaje_id: 'v-a', monto: 200, fecha: '2026-08-06' });
    await enviar(A, archivo(L2, L1)); await procesarColaPeajes();
    const f = (await bitacoraConciliada(A, desgloseDe(A)))!.filas;
    expect(f.every((x) => x.estado === 'cuadra' || x.estado === 'por_verificar')).toBe(true);
    expect(f.find((x) => x.monto === 189.5)).toMatchObject({ estado: 'cuadra', motivo: 'gasto_y_gps' });
    expect(f.find((x) => x.monto === 200)).toMatchObject({ estado: 'cuadra', motivo: 'gasto' }); // sin posiciones ese día
  });

  it('el GPS reporta DESPUÉS del archivo: la línea nace sin respaldo de GPS y al re-conciliar se confirma sin tocar el resto', async () => {
    posiciones = [];
    await enviar(A, archivo(L1, L2)); await procesarColaPeajes();
    const id = desgloseDe(A);
    const antes = (await bitacoraConciliada(A, id))!.filas;
    expect(antes[0]).toMatchObject({ gps: 'sin datos' });
    posiciones = [{ unidad_id: 'u-a', lat: N.lat, lng: N.lng + 0.001, medida_en: '2026-08-05T16:30:10.000Z' }];
    await conciliarDesglose(A, id, 'manual');
    const despues = (await bitacoraConciliada(A, id))!.filas;
    expect(despues[0]).toMatchObject({ estado: 'cuadra', gps: 'confirma' });
    expect(despues[1].estado).toBe(antes[1].estado);
  });

  it('un archivo VIEJO llega después del nuevo: son desgloses distintos, ninguno pisa al otro', async () => {
    await enviar(A, archivo(L2)); await procesarColaPeajes();
    await enviar(A, archivo(L1), { nombre: 'corte-anterior.csv' }); await procesarColaPeajes();
    expect(db.tablas.desglose_peaje).toHaveLength(2);
    expect(db.tablas.desglose_peaje_linea).toHaveLength(2);
  });
});

describe('otro tenant', () => {
  it('cada flota concilia contra SU gasto, SU unidad y SU GPS: el mismo TAG y la misma caseta en dos flotas no se cruzan', async () => {
    // la unidad de B pasó LEJOS (dos posiciones que envuelven la hora del cruce)
    posiciones.push({ unidad_id: 'u-b', lat: N.lat + 0.3, lng: N.lng, medida_en: '2026-08-05T16:28:00.000Z' }, { unidad_id: 'u-b', lat: N.lat + 0.3, lng: N.lng + 0.01, medida_en: '2026-08-05T16:32:00.000Z' });
    await enviar(A, archivo(L1)); await enviar(B, archivo(L1)); await procesarColaPeajes();
    const fa = (await bitacoraConciliada(A, desgloseDe(A)))!.filas[0];
    const fb = (await bitacoraConciliada(B, desgloseDe(B)))!.filas[0];
    expect(fa).toMatchObject({ estado: 'cuadra', viaje: 'V-a', unidad: 'E-a' });
    expect(fb).toMatchObject({ estado: 'por_verificar', motivo: 'gps_no_coincide', viaje: 'V-b', unidad: 'E-b' });
  });

  it('la bitácora de A no se puede leer con el tenant de B', async () => {
    await enviar(A, archivo(L1)); await procesarColaPeajes();
    expect(await bitacoraConciliada(B, desgloseDe(A))).toBeNull();
  });

  it('el gasto de la flota B no respalda una línea de la flota A', async () => {
    db.tablas.gasto = db.tablas.gasto.filter((g) => g.tenant_id !== A);
    await enviar(A, archivo(L1)); await procesarColaPeajes();
    const f = (await bitacoraConciliada(A, desgloseDe(A)))!.filas[0];
    expect(f.motivo).not.toBe('gasto_y_gps');
    expect(f.viaje).not.toBe('V-b');
  });
});

describe('reclamación al proveedor (cruces fuera de geocerca/ruta)', () => {
  // La Ola 3 (w3-agentes-1-4 + convenios) construye el reporte de reclamación PASE × GPS × geocerca/«curso».
  // La interfaz esperada se documenta en docs/e2e/matriz-agentes.md; sin implementación no se finge en verde.
  it.todo('INTEGRACIÓN PENDIENTE (Ola 3, reporte de reclamación): un cruce cuyo GPS está FUERA del curso autorizado sale en el reporte de descuento con su evidencia (unidad, hora, distancia) y NUNCA se acusa de fraude');
  it.todo('INTEGRACIÓN PENDIENTE (Ola 3, geocercas de tabla propia): las geocercas/cursos del cliente reemplazan al catálogo de casetas como base del cruce, por flota');
});
