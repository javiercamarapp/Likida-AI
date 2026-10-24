import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { crearDbFalsa, type DbFalsa, type Fila, type RpcResultado } from './db_falsa.test.util';

// ═══════════════════════════════════════════════════════════════════════════
// LA COLA DE INGESTA contra una base en memoria: recepción idempotente, claim
// con lease y token, proceso (importar + cruzar), fallos permanentes vs de
// infraestructura, claim perdido y reproceso sin duplicar.
// ═══════════════════════════════════════════════════════════════════════════

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const registrarCorrida = vi.fn(async (..._a: unknown[]) => {});
vi.mock('../agentes/corridas', () => ({ registrarCorrida: (...a: unknown[]) => registrarCorrida(...a) }));

const {
  recibirArchivoPeaje, procesarColaPeajes, reintentarArchivoPeaje, subirDesglosePorCola, huellaDe, byteaDeBuffer, MAX_PENDIENTES_POR_FLOTA, MAX_INTENTOS,
} = await import('./ingesta');

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
});
afterEach(() => vi.useRealTimers());

describe('recibirArchivoPeaje — idempotente por (flota, huella)', () => {
  it('encola una vez y guarda contenido, huella y tamaño', async () => {
    const r = await recibirArchivoPeaje(T, { nombre: 'pase.csv', proveedor: 'PASE', contenido: buf(CSV) });
    expect(r).toMatchObject({ ok: true, duplicado: false, estado: 'pendiente' });
    expect(db.tablas.peaje_ingesta_archivo).toHaveLength(1);
    expect(db.tablas.peaje_ingesta_archivo[0]).toMatchObject({ tenant_id: T, huella: huellaDe(buf(CSV)), bytes: CSV.length, estado: 'pendiente', origen: 'api' });
  });
  it('el MISMO archivo reenviado (aunque se llame distinto) es el mismo registro, no otro', async () => {
    const a = await recibirArchivoPeaje(T, { nombre: 'pase.csv', proveedor: 'PASE', contenido: buf(CSV) });
    const b = await recibirArchivoPeaje(T, { nombre: 'copia-final-v2.csv', proveedor: null, contenido: buf(CSV) });
    expect(b).toMatchObject({ ok: true, duplicado: true });
    expect(a.ok && b.ok && a.id === b.id).toBe(true);
    expect(db.tablas.peaje_ingesta_archivo).toHaveLength(1);
  });
  it('el mismo archivo en OTRA flota es otro registro', async () => {
    await recibirArchivoPeaje(T, { nombre: 'a.csv', proveedor: null, contenido: buf(CSV) });
    await recibirArchivoPeaje('flota-2', { nombre: 'a.csv', proveedor: null, contenido: buf(CSV) });
    expect(db.tablas.peaje_ingesta_archivo).toHaveLength(2);
  });
  it('un archivo ya procesado que se reenvía contesta duplicado con su estado (no se reprocesa)', async () => {
    db.tablas.peaje_ingesta_archivo = [archivo({ estado: 'procesada', contenido: null })];
    const r = await recibirArchivoPeaje(T, { nombre: 'x.csv', proveedor: null, contenido: buf(CSV) });
    expect(r).toMatchObject({ ok: true, duplicado: true, estado: 'procesada' });
  });
  it(`la cola tiene tope por flota (${MAX_PENDIENTES_POR_FLOTA}): una llave filtrada no llena la tabla`, async () => {
    db.tablas.peaje_ingesta_archivo = Array.from({ length: MAX_PENDIENTES_POR_FLOTA }, (_, i) => archivo({ id: `p${i}`, huella: `h${i}` }));
    const r = await recibirArchivoPeaje(T, { nombre: 'x.csv', proveedor: null, contenido: buf('otro contenido,1\n') });
    expect(r).toMatchObject({ ok: false, codigo: 'cola_llena' });
    // otra flota no se ve afectada
    expect((await recibirArchivoPeaje('flota-2', { nombre: 'x.csv', proveedor: null, contenido: buf('otro contenido,1\n') })).ok).toBe(true);
  });
  it('un error de base se reporta como error, no como éxito', async () => {
    db.fallar('rpc:peaje_archivo_encolar', 'base caída');
    const r = await recibirArchivoPeaje(T, { nombre: 'x.csv', proveedor: null, contenido: buf(CSV) });
    expect(r).toMatchObject({ ok: false, codigo: 'error' });
  });
  // AUDITORÍA ADVERSARIAL (21-oct-2026, HALLAZGO CRÍTICO): el dedup por huella y el tope por flota
  // vivían en dos pasos separados (SELECT + SELECT count + INSERT, sin candado) — dos envíos
  // CONCURRENTES del mismo archivo podían pasar el primer chequeo juntos y los dos insertar, o dos
  // envíos nuevos podían leer el mismo count bajo el tope y los dos entrar. `peaje_archivo_encolar`
  // (0850) junta las tres cosas en una sola llamada con candado de transacción por flota: la prueba
  // de CONCURRENCIA REAL (contra Postgres, dos conexiones de verdad) vive en
  // `supabase/tests/0850_peaje_ingesta_tope_candado_concurrencia.sh`; aquí (con el fake síncrono de
  // supabase-js) solo se confirma que `recibirArchivoPeaje` hace UNA sola llamada atómica, no la
  // carrera de tres.
  it('dos envíos CONCURRENTES del mismo archivo: solo uno inserta, el otro ve duplicado (no hay carrera de tres pasos)', async () => {
    db.tablas.peaje_ingesta_archivo = [];
    const [a, b] = await Promise.all([
      recibirArchivoPeaje(T, { nombre: 'uno.csv', proveedor: null, contenido: buf(CSV) }),
      recibirArchivoPeaje(T, { nombre: 'dos.csv', proveedor: null, contenido: buf(CSV) }),
    ]);
    expect(db.tablas.peaje_ingesta_archivo).toHaveLength(1);
    expect(a.ok && b.ok && a.id === b.id).toBe(true);
    expect([a, b].filter((r) => r.ok && !r.duplicado)).toHaveLength(1);
    expect([a, b].filter((r) => r.ok && r.duplicado)).toHaveLength(1);
  });
});

describe('procesarColaPeajes — el camino feliz', () => {
  it('importa, cruza, y cierra: procesada, sin contenido, con su desglose', async () => {
    db.tablas.peaje_ingesta_archivo = [archivo()];
    const r = await procesarColaPeajes();
    expect(r).toEqual({ tomados: 1, procesados: 1, fallidos: 0, reintentar: 0, claimPerdido: 0, barrido: { archivos: 0, estado: 'ok' } });
    const a = db.tablas.peaje_ingesta_archivo[0];
    expect(a).toMatchObject({ estado: 'procesada', contenido: null, ultimo_error: null, reclamo: null });
    expect(a.desglose_id).toBeTruthy();
    expect(db.tablas.desglose_peaje).toHaveLength(1);
    expect(db.tablas.desglose_peaje[0]).toMatchObject({ tenant_id: T, ingesta_archivo_id: 'a1', proveedor: 'PASE' });
    expect(db.tablas.desglose_peaje_linea[0]).toMatchObject({ hora: '10:30:00', cruce_en: '2026-08-05T16:30:00.000Z', monto: 189.5, estatus: 'sin_contraparte', tenant_id: T });
    // el cruce por cron dejó su corrida
    expect(registrarCorrida).toHaveBeenCalledWith(T, 'peajes', expect.objectContaining({ disparo: 'cron' }));
  });

  it('cola vacía: no hace nada y no truena', async () => {
    expect(await procesarColaPeajes()).toEqual({ tomados: 0, procesados: 0, fallidos: 0, reintentar: 0, claimPerdido: 0, barrido: { archivos: 0, estado: 'ok' } });
  });

  it('respeta el límite por corrida', async () => {
    db.tablas.peaje_ingesta_archivo = Array.from({ length: 4 }, (_, i) => archivo({ id: `a${i}`, huella: `h${i}` }));
    const r = await procesarColaPeajes({ limite: 2 });
    expect(r.tomados).toBe(2);
    expect(db.tablas.peaje_ingesta_archivo.filter((a) => a.estado === 'pendiente')).toHaveLength(2);
  });

  it('el backoff se respeta: un archivo con proximo_intento_en futuro no se toma', async () => {
    db.tablas.peaje_ingesta_archivo = [archivo({ proximo_intento_en: new Date(relojClaim + 3_600_000).toISOString() })];
    expect((await procesarColaPeajes()).tomados).toBe(0);
  });
});

describe('A37-A2-09: la subida manual del panel pasa por la huella y por el procesador del cron', () => {
  const avisar = vi.fn(async () => 'ok');
  const avisarDiscrepancias = vi.fn(async () => ({ evaluados: 0, enviados: 0, sinDestinatario: 0, pendientes: 0 }));
  const procesar = (o: Parameters<typeof procesarColaPeajes>[0] = {}) => procesarColaPeajes({ ...o, avisar, avisarDiscrepancias });
  beforeEach(() => { avisar.mockClear(); avisarDiscrepancias.mockClear(); });

  it('el archivo se encola, se procesa en línea y dispara el aviso a la oficina y el protocolo de discrepancia', async () => {
    const r = await subirDesglosePorCola(T, { nombre: 'pase.csv', buffer: buf(CSV), proveedor: 'PASE' }, { procesar });
    expect(r).toMatchObject({ ok: true, estado: 'procesado', totalLineas: 1 });
    expect(db.tablas.peaje_ingesta_archivo[0]).toMatchObject({ origen: 'panel', estado: 'procesada', contenido: null });
    expect(db.tablas.desglose_peaje).toHaveLength(1);
    expect(avisar).toHaveBeenCalledWith(T, db.tablas.desglose_peaje[0].id);
    expect(avisarDiscrepancias).toHaveBeenCalledWith(T, db.tablas.desglose_peaje[0].id);
  });

  it('el MISMO archivo subido dos veces, o a mano y luego por otro canal, NO crea un segundo desglose vigente', async () => {
    await subirDesglosePorCola(T, { nombre: 'pase.csv', buffer: buf(CSV), proveedor: 'PASE' }, { procesar });
    const otra = await subirDesglosePorCola(T, { nombre: 'copia.csv', buffer: buf(CSV) }, { procesar });
    expect(otra).toMatchObject({ ok: false, motivo: expect.stringMatching(/ya se recibió/i) });
    const porCorreo = await recibirArchivoPeaje(T, { nombre: 'x.csv', proveedor: null, contenido: buf(CSV) }, 'correo');
    expect(porCorreo).toMatchObject({ ok: true, duplicado: true, estado: 'procesada' });
    expect(db.tablas.desglose_peaje).toHaveLength(1);
  });

  it('el periodo declarado se aplica al desglose creado', async () => {
    await subirDesglosePorCola(T, { nombre: 'pase.csv', buffer: buf(CSV), periodo: { desde: '2026-08-01', hasta: '2026-08-10' } }, { procesar });
    expect(db.tablas.desglose_peaje[0]).toMatchObject({ periodo_oficial_desde: '2026-08-01', periodo_oficial_hasta: '2026-08-10', periodo_origen: 'declarado' });
  });

  it('un archivo ilegible devuelve el motivo y queda fallida en la cola (reintentable), sin desglose', async () => {
    const r = await subirDesglosePorCola(T, { nombre: 'raro.csv', buffer: buf('x1;x2;x3\n1;2;3\n') }, { procesar });
    expect(r).toMatchObject({ ok: false, motivo: expect.stringMatching(/Encabezados leídos/) });
    expect(db.tablas.peaje_ingesta_archivo[0]).toMatchObject({ estado: 'fallida' });
    expect(db.tablas.desglose_peaje ?? []).toHaveLength(0);
  });

  it('si el proceso en línea no alcanza (otros archivos primero), queda en cola y lo dice', async () => {
    const r = await subirDesglosePorCola(T, { nombre: 'pase.csv', buffer: buf(CSV) }, { procesar: async () => ({ tomados: 0, procesados: 0, fallidos: 0, reintentar: 0, claimPerdido: 0 }) });
    expect(r).toMatchObject({ ok: true, estado: 'en_cola' });
    expect(db.tablas.peaje_ingesta_archivo[0]).toMatchObject({ estado: 'pendiente' });
  });

  it('extensión no aceptada, vacío o cola llena: se rechaza sin tocar la cola', async () => {
    expect(await subirDesglosePorCola(T, { nombre: 'x.exe', buffer: buf('a') }, { procesar })).toMatchObject({ ok: false });
    expect(await subirDesglosePorCola(T, { nombre: 'x.csv', buffer: buf('') }, { procesar })).toMatchObject({ ok: false });
    expect(db.tablas.peaje_ingesta_archivo).toHaveLength(0);
    db.tablas.peaje_ingesta_archivo = Array.from({ length: MAX_PENDIENTES_POR_FLOTA }, (_, i) => archivo({ id: `p${i}`, huella: `h${i}` }));
    expect(await subirDesglosePorCola(T, { nombre: 'x.csv', buffer: buf('otro,1\n') }, { procesar })).toMatchObject({ ok: false, motivo: expect.stringMatching(/pendientes/) });
  });
});

describe('claim anti-duplicado', () => {
  it('dos corridas SEGUIDAS no toman el mismo archivo: la segunda ve el lease vigente', async () => {
    db.tablas.peaje_ingesta_archivo = [archivo(), archivo({ id: 'a2', huella: 'h2' })];
    const [x, y] = [claimFalso({ p_limite: 1, p_lease_segundos: 300 }), claimFalso({ p_limite: 5, p_lease_segundos: 300 })];
    expect(x.map((f) => f.id)).toEqual(['a1']);
    expect(y.map((f) => f.id)).toEqual(['a2']);
    expect(claimFalso({ p_limite: 5, p_lease_segundos: 300 })).toEqual([]);
  });

  it('un worker que murió (lease vencido) suelta el archivo: el siguiente cron lo procesa, con un intento más', async () => {
    db.tablas.peaje_ingesta_archivo = [archivo({ estado: 'procesando', intentos: 1, reclamo: 'tok-muerto', reclamado_hasta: new Date(relojClaim - 60_000).toISOString() })];
    const r = await procesarColaPeajes();
    expect(r.procesados).toBe(1);
    expect(db.tablas.peaje_ingesta_archivo[0].intentos).toBe(2);
  });

  it('CLAIM PERDIDO: si otro se quedó con el archivo mientras éste trabajaba, éste NO pisa el resultado', async () => {
    db.tablas.peaje_ingesta_archivo = [archivo()];
    // Mientras el worker importa, "otro worker" toma el claim (token distinto).
    const original = db.cliente.from;
    db.cliente.from = (t: string) => {
      if (t === 'desglose_peaje_linea') db.tablas.peaje_ingesta_archivo[0].reclamo = 'tok-del-otro';
      return original(t);
    };
    const r = await procesarColaPeajes();
    expect(r.claimPerdido).toBe(1);
    expect(r.procesados).toBe(0);
    expect(db.tablas.peaje_ingesta_archivo[0]).toMatchObject({ estado: 'procesando', reclamo: 'tok-del-otro' });
  });

  it('el reproceso tras un crash (importó pero no cerró) NO duplica el desglose', async () => {
    db.tablas.peaje_ingesta_archivo = [archivo()];
    // Primera corrida: el cierre falla DESPUÉS de importar y cruzar.
    db.fallar('peaje_ingesta_archivo.update', 'se cayó al cerrar');
    await procesarColaPeajes();
    expect(db.tablas.desglose_peaje).toHaveLength(1);
    // Se recupera la base y vence el lease.
    db = Object.assign(db, {});
    // (reinicio de fallos: se crea de nuevo la fachada conservando tablas)
    const tablas = db.tablas;
    db = crearDbFalsa(tablas, { peaje_archivo_reclamar: claimFalso });
    db.tablas.peaje_ingesta_archivo[0].reclamado_hasta = new Date(relojClaim - 1000).toISOString();
    db.tablas.peaje_ingesta_archivo[0].estado = 'procesando';
    const r = await procesarColaPeajes();
    expect(r.procesados).toBe(1);
    expect(db.tablas.desglose_peaje).toHaveLength(1);
    expect(db.tablas.desglose_peaje_linea).toHaveLength(1);
  });
});

describe('fallos', () => {
  it('formato ilegible → fallida CON el motivo (encabezados leídos), conserva el contenido y deja corrida de fallo; NO reintenta solo', async () => {
    const raro = 'Col1,Col2\n1,2\n';
    db.tablas.peaje_ingesta_archivo = [archivo({ contenido: byteaDeBuffer(buf(raro)), nombre: 'raro.csv' })];
    const r = await procesarColaPeajes();
    expect(r).toMatchObject({ fallidos: 1, procesados: 0, reintentar: 0 });
    const a = db.tablas.peaje_ingesta_archivo[0];
    expect(a.estado).toBe('fallida');
    expect(a.ultimo_error).toMatch(/Encabezados leídos/);
    expect(a.contenido).not.toBeNull();
    expect(db.tablas.desglose_peaje ?? []).toHaveLength(0);
    expect(registrarCorrida).toHaveBeenCalledWith(T, 'peajes', expect.objectContaining({ estado: 'fallo', disparo: 'cron', error: expect.stringContaining('raro.csv') }));
    // y una segunda corrida no lo vuelve a tomar
    expect((await procesarColaPeajes()).tomados).toBe(0);
  });

  it('declarar el mapeo y reintentar desde el panel lo procesa', async () => {
    const raro = 'x1;x2;x3;x4\n05/08/2026;10:30;Caseta Ejemplo Norte;189,50\n';
    db.tablas.peaje_ingesta_archivo = [archivo({ contenido: byteaDeBuffer(buf(raro)), nombre: 'raro.csv' })];
    await procesarColaPeajes();
    expect(db.tablas.peaje_ingesta_archivo[0].estado).toBe('fallida');
    db.tablas.peaje_mapeo_columnas = [{ id: 'm', tenant_id: T, proveedor_norm: 'pase', proveedor: 'PASE', activo: true, columnas: { fecha: 'A', hora: 'B', caseta: 'C', monto: 'D' } }];
    expect(await reintentarArchivoPeaje(T, 'a1')).toBe(true);
    expect(db.tablas.peaje_ingesta_archivo[0]).toMatchObject({ estado: 'pendiente', intentos: 0, ultimo_error: null });
    const r = await procesarColaPeajes();
    expect(r.procesados).toBe(1);
    expect(db.tablas.desglose_peaje_linea[0]).toMatchObject({ monto: 189.5, hora: '10:30:00' });
  });

  it('A37-A2-01: un archivo de correo/SFTP (proveedor null) se reintenta declarando el proveedor y usa su mapeo', async () => {
    const raro = 'x1;x2;x3;x4\n05/08/2026;10:30;Caseta Ejemplo Norte;189,50\n';
    db.tablas.peaje_ingesta_archivo = [archivo({ contenido: byteaDeBuffer(buf(raro)), nombre: 'raro.csv', proveedor: null, origen: 'correo' })];
    await procesarColaPeajes();
    expect(db.tablas.peaje_ingesta_archivo[0].estado).toBe('fallida');
    db.tablas.peaje_mapeo_columnas = [{ id: 'm', tenant_id: T, proveedor_norm: 'pase', proveedor: 'PASE', activo: true, columnas: { fecha: 'A', hora: 'B', caseta: 'C', monto: 'D' } }];
    // Sin proveedor el reintento vuelve a fallar para siempre; con proveedor declarado, no.
    expect(await reintentarArchivoPeaje(T, 'a1', 'PASE')).toBe(true);
    expect(db.tablas.peaje_ingesta_archivo[0]).toMatchObject({ estado: 'pendiente', proveedor: 'PASE' });
    expect((await procesarColaPeajes()).procesados).toBe(1);
    expect(db.tablas.desglose_peaje[0]).toMatchObject({ proveedor: 'PASE' });
  });

  it('A37-A2-01: un proveedor de más de 60 caracteres no se acepta al reintentar', async () => {
    db.tablas.peaje_ingesta_archivo = [archivo({ id: 'f1', estado: 'fallida', proveedor: null })];
    expect(await reintentarArchivoPeaje(T, 'f1', 'P'.repeat(61))).toBe(false);
    expect(db.tablas.peaje_ingesta_archivo[0]).toMatchObject({ estado: 'fallida', proveedor: null });
  });

  it('reintentar: solo fallidas, solo de la flota, solo con contenido', async () => {
    db.tablas.peaje_ingesta_archivo = [
      archivo({ id: 'f1', estado: 'fallida', huella: 'h1' }),
      archivo({ id: 'f2', estado: 'fallida', contenido: null, huella: 'h2' }),
      archivo({ id: 'p1', estado: 'pendiente', huella: 'h3' }),
    ];
    expect(await reintentarArchivoPeaje(T, 'f2')).toBe(false);
    expect(await reintentarArchivoPeaje(T, 'p1')).toBe(false);
    expect(await reintentarArchivoPeaje('flota-2', 'f1')).toBe(false);
    expect(await reintentarArchivoPeaje(T, 'f1')).toBe(true);
  });

  it('fallo de INFRAESTRUCTURA (la base no deja escribir): vuelve a la cola con backoff y el error visible', async () => {
    db.tablas.peaje_ingesta_archivo = [archivo()];
    db.fallar('desglose_peaje.insert', 'timeout de base');
    const r = await procesarColaPeajes();
    expect(r).toMatchObject({ reintentar: 1, fallidos: 0, procesados: 0 });
    const a = db.tablas.peaje_ingesta_archivo[0];
    expect(a.estado).toBe('pendiente');
    expect(a.ultimo_error).toMatch(/timeout de base|No se pudo guardar/);
    expect(Date.parse(a.proximo_intento_en as string)).toBeGreaterThan(Date.now() + 30_000);
    expect(a.contenido).not.toBeNull();
  });

  it(`al intento ${MAX_INTENTOS} se rinde: fallida con «se agotaron los intentos»`, async () => {
    db.tablas.peaje_ingesta_archivo = [archivo({ intentos: MAX_INTENTOS - 1 })];
    db.fallar('desglose_peaje.insert', 'timeout de base');
    const r = await procesarColaPeajes();
    expect(r).toMatchObject({ fallidos: 1, reintentar: 0 });
    expect(db.tablas.peaje_ingesta_archivo[0]).toMatchObject({ estado: 'fallida' });
    expect(String(db.tablas.peaje_ingesta_archivo[0].ultimo_error)).toMatch(/Se agotaron 5 intentos/);
  });

  it('un archivo en cola sin contenido legible es fallo de infraestructura, no excepción', async () => {
    db.tablas.peaje_ingesta_archivo = [archivo({ contenido: 'no-es-bytea' })];
    const r = await procesarColaPeajes();
    expect(r.reintentar).toBe(1);
  });

  it('si el RPC del claim falla, la corrida LANZA (el cron deja latido de fallo)', async () => {
    db.fallar('rpc:peaje_archivo_reclamar', 'rpc caído');
    await expect(procesarColaPeajes()).rejects.toThrow(/rpc caído/);
  });

  it('un archivo malo no frena a los buenos de la misma corrida', async () => {
    db.tablas.peaje_ingesta_archivo = [
      archivo({ id: 'malo', huella: 'hm', contenido: byteaDeBuffer(buf('Col1,Col2\n1,2\n')) }),
      archivo({ id: 'bueno', huella: 'hb' }),
    ];
    const r = await procesarColaPeajes();
    expect(r).toMatchObject({ tomados: 2, procesados: 1, fallidos: 1 });
  });

  it('TODA consulta a tablas de la flota lleva su tenant_id', async () => {
    db.tablas.peaje_ingesta_archivo = [archivo()];
    await procesarColaPeajes();
    for (const l of db.llamadas.filter((x) => x.op !== 'rpc')) {
      if (l.op === 'insert' || l.op === 'upsert') {
        const filas = (Array.isArray(l.payload) ? l.payload : [l.payload]) as Array<Record<string, unknown>>;
        expect(filas.every((f) => f.tenant_id === T), `${l.tabla}.${l.op}`).toBe(true);
      } else {
        expect(l.filtros.some(([c, o, v]) => c === 'tenant_id' && o === 'eq' && v === T), `${l.tabla}.${l.op}`).toBe(true);
      }
    }
  });

  it('el reloj: sin tiempo, deja el resto con su lease para el siguiente cron', async () => {
    db.tablas.peaje_ingesta_archivo = [archivo(), archivo({ id: 'a2', huella: 'h2' })];
    const r = await procesarColaPeajes({ venceEn: Date.now() - 1 });
    expect(r.procesados).toBe(0);
    expect(db.tablas.peaje_ingesta_archivo.every((a) => a.estado === 'procesando')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A35-R12-rendimiento-01 (migración 0856): un archivo que muere a mitad de proceso demasiadas veces
// deja de reclamarse, el barrido lo manda a `fallida` y la oficina se entera en la bitácora.
// ═══════════════════════════════════════════════════════════════════════════
describe('procesarColaPeajes — barrido de procesando vencidos (0856)', () => {
  const barridoFalso = (filas: Fila[]) => (args: Record<string, unknown>): RpcResultado => {
    expect(args).toEqual({ p_max_intentos: 3, p_gracia_minutos: 60 });
    return filas;
  };

  it('barre ANTES de reclamar y avisa en la bitácora con una frase legible', async () => {
    const orden: string[] = [];
    db = crearDbFalsa({ peaje_ingesta_archivo: [] }, {
      peaje_archivo_barrer_vencidos: (a) => { orden.push('barrer'); return barridoFalso([{ id: 'x1', tenant_id: T, nombre: 'enorme.xlsx', intentos: 3 }])(a); },
      peaje_archivo_reclamar: (a) => { orden.push('reclamar'); return claimFalso(a); },
    });
    const r = await procesarColaPeajes({ limite: 3 });
    expect(orden).toEqual(['barrer', 'reclamar']);
    expect(r.barrido).toEqual({ archivos: 1, estado: 'ok' });
    expect(registrarCorrida).toHaveBeenCalledTimes(1);
    const [tenant, agente, corrida] = registrarCorrida.mock.calls[0] as [string, string, { estado: string; error: string }];
    expect(tenant).toBe(T);
    expect(agente).toBe('peajes');
    expect(corrida.estado).toBe('fallo');
    expect(corrida.error).toContain('enorme.xlsx');
    expect(corrida.error).toContain('3 veces');
    expect(corrida.error).toMatch(/reprocesarlo desde el panel/);
  });

  it('sin vencidos: no avisa nada y el barrido queda ok con 0', async () => {
    db = crearDbFalsa({ peaje_ingesta_archivo: [] }, { peaje_archivo_barrer_vencidos: barridoFalso([]), peaje_archivo_reclamar: claimFalso });
    const r = await procesarColaPeajes({ limite: 3 });
    expect(r.barrido).toEqual({ archivos: 0, estado: 'ok' });
    expect(registrarCorrida).not.toHaveBeenCalled();
  });

  it('una base SIN la migración (la RPC no existe) no tumba la cola: lo dice y sigue procesando', async () => {
    db = crearDbFalsa({ peaje_ingesta_archivo: [archivo()] }, {
      peaje_archivo_barrer_vencidos: () => ({ error: { message: 'Could not find the function public.peaje_archivo_barrer_vencidos', code: 'PGRST202' } }),
      peaje_archivo_reclamar: claimFalso,
    });
    const r = await procesarColaPeajes({ limite: 3 });
    expect(r.barrido).toEqual({ archivos: 0, estado: 'no_disponible' });
    expect(r.procesados).toBe(1);
  });

  it('un error cualquiera del barrido tampoco tumba la cola, pero queda marcado como error', async () => {
    db = crearDbFalsa({ peaje_ingesta_archivo: [archivo()] }, {
      peaje_archivo_barrer_vencidos: () => ({ error: { message: 'timeout', code: '57014' } }),
      peaje_archivo_reclamar: claimFalso,
    });
    const r = await procesarColaPeajes({ limite: 3 });
    expect(r.barrido).toEqual({ archivos: 0, estado: 'error' });
    expect(r.procesados).toBe(1);
  });

  it('si no se puede escribir la bitácora, el barrido igual cuenta el archivo (no se pierde el aviso en el log)', async () => {
    registrarCorrida.mockRejectedValueOnce(new Error('bitácora caída'));
    db = crearDbFalsa({ peaje_ingesta_archivo: [] }, {
      peaje_archivo_barrer_vencidos: barridoFalso([{ id: 'x1', tenant_id: T, nombre: 'a.csv', intentos: 3 }]),
      peaje_archivo_reclamar: claimFalso,
    });
    const r = await procesarColaPeajes({ limite: 3 });
    expect(r.barrido).toEqual({ archivos: 1, estado: 'ok' });
  });
});
