import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type DbFalsa, type Fila } from '../peajes/db_falsa.test.util';

// ═══════════════════════════════════════════════════════════════════════════
// LA CONCILIACIÓN DE PUNTA A PUNTA contra una base en memoria: importar un
// desglose con hora y TAG, cruzar contra gastos, resolver TAG→unidad y casetas,
// validar con el GPS (Haversine) y escribir el resultado por línea. Verifica la
// lógica de la app y que TODA consulta lleve el filtro de la flota.
// ═══════════════════════════════════════════════════════════════════════════

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const registrarCorrida = vi.fn(async (..._a: unknown[]) => {});
vi.mock('../agentes/corridas', () => ({ registrarCorrida: (...a: unknown[]) => registrarCorrida(...a) }));

const { conciliarDesglose, importarDesglose } = await import('./desglose_peaje');

const T = 'tenant-1';
const OTRO = 'tenant-2';
const CASETA = { lat: 19.5, lng: -99.2 };

const base = (): Record<string, Fila[]> => ({
  desglose_peaje: [{ id: 'd1', tenant_id: T, proveedor: 'PASE' }],
  desglose_peaje_linea: [
    // 1: cuadra con g1, GPS confirma
    { id: 'l1', tenant_id: T, desglose_id: 'd1', indice: 0, fecha: '2026-08-05', monto: 189, caseta: 'Caseta Ejemplo Norte', tag: 'IMDM 10000001', cruce_en: '2026-08-05T16:30:00.000Z' },
    // 2: cuadra con g2 (monto exacto), pero el GPS dice que la unidad estaba lejos
    { id: 'l2', tenant_id: T, desglose_id: 'd1', indice: 1, fecha: '2026-08-06', monto: 250, caseta: 'Caseta Ejemplo Norte', tag: 'IMDM 10000001', cruce_en: '2026-08-06T16:30:00.000Z' },
    // 3: sin gasto, con fondo; la unidad (por TAG) no tiene posiciones
    { id: 'l3', tenant_id: T, desglose_id: 'd1', indice: 2, fecha: '2026-08-07', monto: 300, caseta: 'Caseta Ejemplo Norte', tag: 'IMDM 10000001', cruce_en: '2026-08-07T16:30:00.000Z' },
    // 4: sin fecha
    { id: 'l4', tenant_id: T, desglose_id: 'd1', indice: 3, fecha: null, monto: 99, caseta: 'Caseta Ejemplo Norte', tag: null, cruce_en: null },
    // 5: TAG sin dar de alta, sin hora
    { id: 'l5', tenant_id: T, desglose_id: 'd1', indice: 4, fecha: '2026-08-05', monto: 77, caseta: 'Plaza Rara', tag: 'ZZZZ99999999', cruce_en: null },
  ],
  gasto: [
    { id: 'g1', tenant_id: T, concepto: 'caseta', viaje_id: 'v1', monto: 189, fecha: '2026-08-05' },
    { id: 'g2', tenant_id: T, concepto: 'caseta', viaje_id: 'v1', monto: 250, fecha: '2026-08-06' },
    { id: 'g-diesel', tenant_id: T, concepto: 'diesel', viaje_id: 'v1', monto: 300, fecha: '2026-08-07' },
    { id: 'g-ajeno', tenant_id: OTRO, concepto: 'caseta', viaje_id: 'vx', monto: 300, fecha: '2026-08-07' },
  ],
  viaje: [{ id: 'v1', tenant_id: T, unidad_id: 'u1' }, { id: 'vx', tenant_id: OTRO, unidad_id: 'ux' }],
  peaje_tag: [
    { id: 't1', tenant_id: T, tag: 'IMDM10000001', unidad_id: 'u1', activo: true },
    { id: 't-ajeno', tenant_id: OTRO, tag: 'ZZZZ99999999', unidad_id: 'ux', activo: true },
  ],
  peaje_caseta: [
    { id: 'c1', tenant_id: T, nombre: 'Caseta Ejemplo Norte', nombre_norm: 'caseta ejemplo norte', alias: [], lat: CASETA.lat, lng: CASETA.lng, radio_m: 300, activa: true },
    { id: 'c-inactiva', tenant_id: T, nombre: 'Plaza Rara', nombre_norm: 'plaza rara', alias: [], lat: 19.1, lng: -99.1, radio_m: 300, activa: false },
  ],
});

// Posiciones: l1 → una cerca de la caseta; l2 → dos posiciones lejanas que envuelven el cobro.
const posiciones = [
  { unidad_id: 'u1', lat: CASETA.lat + 0.001, lng: CASETA.lng, medida_en: '2026-08-05T16:30:30.000Z' },
  { unidad_id: 'u1', lat: CASETA.lat + 0.1, lng: CASETA.lng, medida_en: '2026-08-06T16:28:00.000Z' },
  { unidad_id: 'u1', lat: CASETA.lat + 0.1, lng: CASETA.lng + 0.01, medida_en: '2026-08-06T16:32:00.000Z' },
];
const rpcPosiciones = (args: Record<string, unknown>): Fila[] => {
  const ventanas = args.p_ventanas as Array<{ linea_id: string; unidad_id: string; desde: string; hasta: string }>;
  expect(args.p_tenant).toBe(T);
  return ventanas.flatMap((v) => posiciones
    .filter((p) => p.unidad_id === v.unidad_id && p.medida_en >= v.desde && p.medida_en <= v.hasta)
    .map((p) => ({ linea_id: v.linea_id, lat: p.lat, lng: p.lng, medida_en: p.medida_en })));
};

beforeEach(() => {
  db = crearDbFalsa(base(), { peaje_posiciones_ventana: rpcPosiciones });
  registrarCorrida.mockClear();
});

const linea = (id: string) => db.tablas.desglose_peaje_linea.find((l) => l.id === id)!;

describe('conciliarDesglose: tag↔unidad, caseta y GPS', () => {
  it('escribe estatus, unidad, caseta y veredicto GPS por línea', async () => {
    const r = await conciliarDesglose(T, 'd1', 'cron');
    expect(r).toMatchObject({ total: 5, cuadra: 2, noCuadra: 0, sinContraparte: 3, noEscritas: 0, gpsConfirma: 1, gpsNoCoincide: 1, gpsSinDatos: 3 });

    // 1: gasto + GPS confirma, unidad por TAG
    expect(linea('l1')).toMatchObject({ estatus: 'cuadra', viaje_id: 'v1', unidad_id: 'u1', caseta_id: 'c1', gps_veredicto: 'confirma' });
    expect(linea('l1').gps_distancia_m).toBeGreaterThan(100);
    expect(linea('l1').gps_distancia_m).toBeLessThan(120);

    // 2: gasto, pero el GPS NO coincide (se manda a revisión en la bitácora, no se acusa aquí)
    expect(linea('l2')).toMatchObject({ estatus: 'cuadra', gps_veredicto: 'no_coincide', caseta_id: 'c1' });
    expect(linea('l2').gps_distancia_m).toBeGreaterThan(5000);

    // 3: sin gasto (el diésel no cuenta; g2 está en la ventana pero es de OTRO monto y ya la usó l2), con fondo de 2 gastos de caseta
    expect(linea('l3')).toMatchObject({ estatus: 'sin_contraparte', unidad_id: 'u1', gps_veredicto: 'sin_datos', gps_detalle: { motivo: 'sin_posiciones_ventana', muestras: 0, unidad_origen: 'tag' } });
    expect(linea('l3').detalle).toMatchObject({ motivo: 'sin_gastos_en_ventana', fondo_gastos: 2 });

    // 4: sin fecha
    expect(linea('l4')).toMatchObject({ estatus: 'sin_contraparte', gps_veredicto: 'sin_datos', gps_detalle: { motivo: 'sin_fecha' } });

    // 5: TAG de OTRA flota (no se mezcla), sin hora
    expect(linea('l5')).toMatchObject({ unidad_id: null, gps_veredicto: 'sin_datos' });
  });

  it('TODA consulta lleva el filtro de la flota — nada se lee ni se escribe sin tenant_id', async () => {
    await conciliarDesglose(T, 'd1', 'manual');
    for (const l of db.llamadas.filter((x) => x.op !== 'rpc')) {
      expect(l.filtros.some(([c, o, v]) => c === 'tenant_id' && o === 'eq' && v === T), `${l.tabla}.${l.op} sin tenant`).toBe(true);
    }
    // y el RPC de posiciones recibe SIEMPRE el tenant (lo verifica la fábrica del RPC con expect)
  });

  it('es idempotente: re-conciliar deja exactamente lo mismo', async () => {
    await conciliarDesglose(T, 'd1');
    const antes = JSON.stringify(db.tablas.desglose_peaje_linea);
    await conciliarDesglose(T, 'd1');
    expect(JSON.stringify(db.tablas.desglose_peaje_linea)).toBe(antes);
  });

  it('al dar de alta el TAG después, el siguiente cruce LO USA (recalculable)', async () => {
    await conciliarDesglose(T, 'd1');
    expect(linea('l5').unidad_id).toBeNull();
    db.tablas.peaje_tag.push({ id: 't9', tenant_id: T, tag: 'ZZZZ99999999', unidad_id: 'u1', activo: true });
    await conciliarDesglose(T, 'd1');
    expect(linea('l5').unidad_id).toBe('u1');
  });

  it('un TAG dado de baja (activo=false) no casa unidad: la línea que cuadra usa la unidad de SU viaje para el GPS, y lo dice', async () => {
    db.tablas.peaje_tag[0].activo = false;
    await conciliarDesglose(T, 'd1');
    expect(linea('l1').unidad_id).toBeNull();
    expect(linea('l1').gps_detalle).toMatchObject({ unidad_origen: 'viaje' });
    // La que NO cuadra y no tiene TAG vigente no tiene unidad: sin_unidad, sin acusar.
    expect(linea('l3')).toMatchObject({ gps_veredicto: 'sin_datos', gps_detalle: { motivo: 'sin_unidad', unidad_origen: null } });
  });

  it('sin catálogo de casetas: todas «sin_caseta», ninguna acusación', async () => {
    db.tablas.peaje_caseta = [];
    const r = await conciliarDesglose(T, 'd1');
    expect(r.gpsNoCoincide).toBe(0);
    expect(linea('l1').gps_detalle).toMatchObject({ motivo: 'sin_caseta' });
  });

  it('un desglose de OTRA flota no existe para esta (no deja corrida fantasma)', async () => {
    await expect(conciliarDesglose(OTRO, 'd1')).rejects.toThrow(/no existe/);
    expect(registrarCorrida).not.toHaveBeenCalled();
  });

  it('un fallo al leer los TAGs LANZA y registra corrida fallida: un mapa a medias no se usa', async () => {
    db.fallar('peaje_tag.select', 'base caída');
    await expect(conciliarDesglose(T, 'd1')).rejects.toThrow(/base caída/);
    expect(registrarCorrida).toHaveBeenCalledWith(T, 'peajes', expect.objectContaining({ estado: 'fallo' }));
    // Y no se escribió NADA a medias.
    expect(db.llamadas.some((l) => l.tabla === 'desglose_peaje_linea' && l.op === 'update')).toBe(false);
  });

  it('un fallo en el RPC de posiciones LANZA (no se inventan «sin posiciones»)', async () => {
    db.fallar('rpc:peaje_posiciones_ventana', 'rpc caído');
    await expect(conciliarDesglose(T, 'd1')).rejects.toThrow(/rpc caído/);
  });

  it('si algunas líneas no se pueden escribir: estado parcial, con la cuenta', async () => {
    db.fallar('desglose_peaje_linea.update', 'disco lleno');
    const r = await conciliarDesglose(T, 'd1');
    expect(r.noEscritas).toBe(5);
    expect(registrarCorrida).toHaveBeenCalledWith(T, 'peajes', expect.objectContaining({ estado: 'parcial' }));
  });
});

describe('importarDesglose: guarda la hora y el instante del cobro', () => {
  const csv = 'Fecha de cobro;Hora;Plaza;Importe;No. TAG\n05/08/2026;10:30:00;Caseta Ejemplo Norte;189,50;IMDM 10000001\n06/08/2026;;Caseta Ejemplo Sur;100,00;\n';

  it('hora y cruce_en (UTC) cuando el archivo la trae; NULL cuando no', async () => {
    db = crearDbFalsa({});
    const r = await importarDesglose(T, { nombre: 'pase.csv', buffer: Buffer.from(csv), proveedor: 'PASE' });
    expect(r).toMatchObject({ ok: true, totalLineas: 2 });
    const [a, b] = db.tablas.desglose_peaje_linea;
    expect(a).toMatchObject({ fecha: '2026-08-05', hora: '10:30:00', cruce_en: '2026-08-05T16:30:00.000Z', monto: 189.5, tenant_id: T });
    expect(b).toMatchObject({ fecha: '2026-08-06', hora: null, cruce_en: null, tag: null });
  });

  it('usa el mapeo declarado del proveedor', async () => {
    db = crearDbFalsa({
      peaje_mapeo_columnas: [{ id: 'm1', tenant_id: T, proveedor_norm: 'pase', proveedor: 'PASE', activo: true, columnas: { fecha: 'A', caseta: 'C', monto: 'D', hora: 'B' } }],
    });
    const raro = 'x1;x2;x3;x4\n05/08/2026;10:30;Caseta Ejemplo Norte;189,50\n';
    const r = await importarDesglose(T, { nombre: 'raro.csv', buffer: Buffer.from(raro), proveedor: 'pase ' });
    expect(r.ok).toBe(true);
    expect(db.tablas.desglose_peaje_linea[0]).toMatchObject({ monto: 189.5, hora: '10:30:00' });
  });

  it('reproceso idempotente: el mismo archivo de la cola no crea un segundo desglose', async () => {
    db = crearDbFalsa({});
    const a = await importarDesglose(T, { nombre: 'pase.csv', buffer: Buffer.from(csv), ingestaArchivoId: 'arch-1' });
    const b = await importarDesglose(T, { nombre: 'pase.csv', buffer: Buffer.from(csv), ingestaArchivoId: 'arch-1' });
    expect(a.ok && b.ok).toBe(true);
    expect(db.tablas.desglose_peaje).toHaveLength(1);
    expect(db.tablas.desglose_peaje_linea).toHaveLength(2);
    if (b.ok) expect(b.avisos.join(' ')).toMatch(/ya estaba importado/);
  });

  it('un worker que murió tras insertar el desglose y ANTES de las líneas: se limpia la cáscara y se rehace', async () => {
    db = crearDbFalsa({ desglose_peaje: [{ id: 'cascara', tenant_id: T, ingesta_archivo_id: 'arch-2' }] });
    const r = await importarDesglose(T, { nombre: 'pase.csv', buffer: Buffer.from(csv), ingestaArchivoId: 'arch-2' });
    expect(r.ok).toBe(true);
    expect(db.tablas.desglose_peaje.some((d) => d.id === 'cascara')).toBe(false);
    expect(db.tablas.desglose_peaje).toHaveLength(1);
    expect(db.tablas.desglose_peaje_linea).toHaveLength(2);
  });

  it('un archivo que no se entiende devuelve el motivo y no guarda NADA', async () => {
    db = crearDbFalsa({});
    const r = await importarDesglose(T, { nombre: 'x.csv', buffer: Buffer.from('a,b\n1,2\n') });
    expect(r.ok).toBe(false);
    expect(db.tablas.desglose_peaje ?? []).toHaveLength(0);
  });

  it('el tope de líneas se dice, no se importa a medias', async () => {
    db = crearDbFalsa({});
    const filas = ['Fecha,Caseta,Importe'].concat(Array.from({ length: 5001 }, () => '05/08/2026,Caseta Ejemplo Norte,10.00')).join('\n');
    const r = await importarDesglose(T, { nombre: 'enorme.csv', buffer: Buffer.from(filas) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/tope/);
    expect(db.tablas.desglose_peaje ?? []).toHaveLength(0);
  });
});
