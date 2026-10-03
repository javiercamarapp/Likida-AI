import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearMemoriaControl } from '../autofactura/control.fixture';
import { crearMemoriaVinculacion } from '../autofactura/memoria.fixture';
import './reloj_adelantado.fixture';
import type { ResultadoLoteAgente, TicketDeLote } from '../facturacion/agente';

// ═══════════════════════════════════════════════════════════════════════════
// E2E DEL AGENTE 6 — AUTOFACTURA, CICLO COMPLETO (0540 vinculación, 0542 control de emisión).
//
// Lo que corre de VERDAD: `facturarLoteAlVuelo` (claim, marca de «emisión en curso», cupo, escritura del UUID),
// `decidirEmision`/`registrarResultado` (el control de la 0542), y los módulos de la vinculación asistida
// (`iniciarVinculacion` → `reclamarVinculacion` → `completarVinculacion`).
// Lo que es DOBLE: el portal (`facturarLoteConAgente`, con su propio libro de lo que «emitió»), la base de
// `gasto` (en memoria, con los mismos filtros condicionales que usa el claim), los puertos del control y de la
// vinculación (memorias que replican las RPC de 0540/0542) y el mandato legal.
//
// Los cinco casos del criterio (g): feliz, fallo, duplicado, fuera de orden y otra flota.
//
// LO QUE NO ESTÁ AQUÍ, A PROPÓSITO:
//   · La cancelación de CFDI por API (SW sapien 201/202/205/400, mig. 0541) es de CARTA PORTE, no de autofactura:
//     lo emitido por un portal de tercero NO tiene API de cancelación y lo cancela una persona. Sus casos viven en
//     `carta_porte_cancelacion.test.ts`; fingirlos aquí sería probar un doble.
//   · El portal REAL: ningún portal está verificado contra el sitio real (`verificaciones.json`); la primera
//     emisión sigue supervisada (docs/operacion/agente-autofactura.md).
// ═══════════════════════════════════════════════════════════════════════════

type Fila = Record<string, unknown>;

// ── La base de `gasto`, en memoria, con las condiciones del claim ──────────────────────────────────────────
const gastos: Fila[] = [];
const escrituras: Array<{ patch: Fila; filtros: number }> = [];

function evaluarOr(f: Fila, expr: string): boolean {
  return expr.split(/,(?=\w+\.(?:is|lt)\.)/).some((p) => {
    const m = /^(\w+)\.(is|lt)\.(.*)$/.exec(p);
    if (!m) return false;
    const [, col, op, val] = m;
    const v = f[col] ?? null;
    if (op === 'is') return val === 'null' && v === null;
    return v !== null && Date.parse(String(v)) < Date.parse(val);
  });
}

function consulta() {
  const filtros: Array<(f: Fila) => boolean> = [];
  let op: 'select' | 'update' = 'select';
  let patch: Fila = {};
  let devolver = false;
  const ejecutar = () => {
    const filas = gastos.filter((f) => filtros.every((p) => p(f)));
    if (op === 'select') return { data: filas.map((f) => ({ ...f })), error: null };
    escrituras.push({ patch: { ...patch }, filtros: filtros.length });
    for (const f of filas) Object.assign(f, patch);
    return { data: devolver ? filas.map((f) => ({ id: f.id })) : null, error: null };
  };
  const q: Record<string, unknown> = {
    select() { if (op === 'update') devolver = true; return q; },
    update(p: Fila) { op = 'update'; patch = p; return q; },
    eq(c: string, v: unknown) { filtros.push((f) => f[c] === v); return q; },
    in(c: string, vs: unknown[]) { filtros.push((f) => vs.includes(f[c])); return q; },
    is(c: string, v: unknown) { filtros.push((f) => (f[c] ?? null) === v); return q; },
    or(expr: string) { filtros.push((f) => evaluarOr(f, expr)); return q; },
    // La resolución es SÍNCRONA al `then`: el UPDATE condicional del claim es atómico, como en Postgres.
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(ejecutar()).then(res, rej); },
  };
  return q;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (t: string) => { if (t !== 'gasto') throw new Error(`tabla inesperada en el E2E: ${t}`); return consulta(); },
  }),
}));

// ── El portal (doble) ──────────────────────────────────────────────────────────────────────────────────────
interface FalloDePortal { requiereCaptcha?: boolean; emisionSinConfirmar?: boolean; error?: string }
const portal = {
  llamadas: [] as Array<{ tenantId: string; comercio: string; modo: string; gastoIds: string[] }>,
  /** Lo que el portal de verdad habría emitido: una factura por sesión en modo `emitir`. */
  emitidos: [] as Array<{ tenantId: string; uuid: string; gastoIds: string[] }>,
  fallo: null as FalloDePortal | null,
  n: 0,
};

const { facturarLoteConAgente, adaptadorDe } = vi.hoisted(() => ({ facturarLoteConAgente: vi.fn(), adaptadorDe: vi.fn() }));
vi.mock('../facturacion/agente', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../facturacion/agente')>()),
  facturarLoteConAgente, adaptadorDe,
}));

let memoria = crearMemoriaControl();
vi.mock('../autofactura/control_emision_repo', () => ({ crearDepsControl: () => memoria.deps }));

const mandatoFlotaVigente = vi.fn(async (_t: string) => true);
vi.mock('@/lib/legal/aceptacion', () => ({ mandatoFlotaVigente: (t: string) => mandatoFlotaVigente(t) }));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { facturarLoteAlVuelo, BLOQUEO_EMISION_EN_CURSO } = await import('../facturacion/al_vuelo');
const vinc = await import('../autofactura/vinculacion_remota');

// ── Datos ──────────────────────────────────────────────────────────────────────────────────────────────────
const A = 'tenant-a';
const B = 'tenant-b';
const HOY = '2026-10-02';
const T0 = Date.parse('2026-10-02T15:00:00.000Z');
/** El cron corre cada 15 min; el claim vive 10. Cada corrida de la prueba es de un «turno» distinto. */
const turno = (k: number) => new Date(T0 + k * 20 * 60_000).toISOString();

function gasto(id: string, tenant: string, o: Fila = {}): Fila {
  return {
    id, tenant_id: tenant, concepto: 'diesel', monto: 400, fecha: HOY, folio: `F-${id}`,
    rfc_emisor: null, cfdi_uuid: null, cfdi_orden: null, ocr_confianza: 0.95,
    ocr_extra: { urlFacturacion: 'https://facturacion.enerser.com.mx/', webId: '650', estacion: 'E1' },
    autofactura_intentada_en: null, autofactura_bloqueada_en: null, autofactura_bloqueo: null,
    ...o,
  };
}
const fila = (id: string) => gastos.find((g) => g.id === id)!;

function correr(tenantId: string, gastoIds: string[], k: number, modo: 'ensayo' | 'emitir' = 'emitir') {
  return facturarLoteAlVuelo({ tenantId, comercio: 'enerser', gastoIds, modo, hoy: HOY, ahora: turno(k) });
}

/** Una flota con la emisión real encendida y el portal verificado, en fase supervisada (el default). */
function prepararFlota(tenant: string, extra: Parameters<typeof memoria.encender>[1] = {}) {
  memoria.encender(tenant, extra);
}

beforeEach(() => {
  gastos.length = 0;
  escrituras.length = 0;
  portal.llamadas.length = 0; portal.emitidos.length = 0; portal.fallo = null; portal.n = 0;
  memoria = crearMemoriaControl({ verificados: ['enerser'] });
  mandatoFlotaVigente.mockReset(); mandatoFlotaVigente.mockResolvedValue(true);
  process.env.FACTURACION_MANDATO_ACEPTADO = 'si';
  adaptadorDe.mockReset(); adaptadorDe.mockReturnValue({ comercio: 'enerser', portal: 'x', facturar: vi.fn() });
  facturarLoteConAgente.mockReset();
  facturarLoteConAgente.mockImplementation(async (a: { tenantId: string; comercio: string; tickets: TicketDeLote[]; modo: 'ensayo' | 'emitir' }): Promise<ResultadoLoteAgente> => {
    const ids = a.tickets.map((t) => t.gastoId);
    portal.llamadas.push({ tenantId: a.tenantId, comercio: a.comercio, modo: a.modo, gastoIds: ids });
    if (portal.fallo) {
      return { modo: a.modo, ok: false, capturado: {}, porGasto: ids.map((gastoId) => ({ gastoId, incluido: false })), ...portal.fallo };
    }
    if (a.modo !== 'emitir') return { modo: a.modo, ok: true, capturado: {}, porGasto: ids.map((gastoId) => ({ gastoId, incluido: true })) };
    const uuid = `0000000${++portal.n}-AAAA-4BBB-8CCC-DDDDEEEEFFFF`;
    portal.emitidos.push({ tenantId: a.tenantId, uuid, gastoIds: ids });
    return { modo: a.modo, ok: true, capturado: {}, porGasto: ids.map((gastoId) => ({ gastoId, incluido: true, cfdiUuid: uuid })) };
  });
});

const motivos = (r: Awaited<ReturnType<typeof correr>>) => r.porGasto.map((p) => p.motivo);
const acciones = (a: string) => memoria.bitacora.filter((b) => b.accion === a);

// ═══════════════════════════════════════════════════════════════════════════
// 1. FELIZ
// ═══════════════════════════════════════════════════════════════════════════
describe('Agente 6 · FELIZ: propone → la persona confirma → se consume UNA vez → emite dentro del cupo', () => {
  it('ciclo completo del lote supervisado, con el UUID repartido por gasto y el cupo contado', async () => {
    gastos.push(gasto('g1', A), gasto('g2', A));
    prepararFlota(A);

    // Corrida 1: fase supervisada → el agente PROPONE y no abre el portal.
    const r1 = await correr(A, ['g1', 'g2'], 0);
    expect(motivos(r1)).toEqual(['espera_control', 'espera_control']);
    expect(portal.llamadas).toHaveLength(0);
    expect(memoria.lotes).toHaveLength(1);
    expect(memoria.lotes[0]).toMatchObject({ tenantId: A, comercio: 'enerser', estado: 'propuesto', gastoIds: ['g1', 'g2'] });
    expect(acciones('autofactura.lote_propuesto')).toHaveLength(1);
    expect(fila('g1').cfdi_uuid).toBeNull();

    // La persona confirma en el panel (lo hace la RPC decidir_lote_emision; aquí, el doble).
    memoria.confirmarLote(A, 'enerser');

    // Corrida 2 (el cron siguiente): consume el lote y emite UNA factura con los dos gastos.
    const r2 = await correr(A, ['g1', 'g2'], 1);
    expect(r2.facturados).toBe(2);
    expect(portal.llamadas).toEqual([{ tenantId: A, comercio: 'enerser', modo: 'emitir', gastoIds: ['g1', 'g2'] }]);
    expect(portal.emitidos).toHaveLength(1);
    const uuid = portal.emitidos[0].uuid;
    expect(fila('g1')).toMatchObject({ cfdi_uuid: uuid, cfdi_orden: 1 });
    expect(fila('g2')).toMatchObject({ cfdi_uuid: uuid, cfdi_orden: 2 });
    // La marca de «emisión en curso» se levantó solo después de escribir el UUID.
    expect(fila('g1').autofactura_bloqueo).toBeNull();
    expect(fila('g2').autofactura_bloqueada_en).toBeNull();

    // El control cerró su ciclo: lote consumido, cupo del día usado, emisiones confirmadas, bitácora.
    expect(memoria.lotes[0].estado).toBe('ejecutado');
    expect(memoria.cupos.get(`${A}|${memoria.hoy}`)).toEqual({ tickets: 2, monto: 800 });
    expect(memoria.fases.get(`${A}|enerser`)?.emisionesConfirmadas).toBe(2);
    expect(acciones('autofactura.emision_autorizada')).toHaveLength(1);
    expect(acciones('autofactura.emitido').map((b) => b.entidadId).sort()).toEqual(['g1', 'g2']);
    expect(JSON.stringify(memoria.bitacora)).not.toMatch(/cookie|password|contrase/i);
  });

  it('un portal en fase AUTÓNOMA emite sin lote, pero sigue topado por el límite del lote y el del día', async () => {
    gastos.push(...['g1', 'g2', 'g3', 'g4'].map((id) => gasto(id, A)));
    prepararFlota(A, { maxTicketsLote: 3, maxTicketsDia: 3 });
    memoria.ponerFase(A, 'enerser', 'autonoma', 5);

    const r = await correr(A, ['g1', 'g2', 'g3', 'g4'], 0);
    expect(portal.llamadas[0].gastoIds).toEqual(['g1', 'g2', 'g3']);
    expect(r.facturados).toBe(3);
    expect(r.porGasto.find((p) => p.gastoId === 'g4')).toMatchObject({ motivo: 'espera_control', intentado: false });
    expect(fila('g4').cfdi_uuid).toBeNull();

    // Mañana-equivalente: el cupo del día ya está lleno (3/3); el cuarto sigue sin salir hoy.
    const r2 = await correr(A, ['g4'], 2);
    expect(r2.facturados).toBe(0);
    expect(portal.emitidos).toHaveLength(1);
  });

  it('vinculación asistida de punta a punta: código de un solo uso → máquina con pantalla → cookies SOLO del portal, cifradas', async () => {
    const reloj = { ahora: new Date(T0) };
    const mem = crearMemoriaVinculacion(reloj);

    const ini = await vinc.iniciarVinculacion({ tenantId: A, userId: 'u-dueno', comercio: 'oxxo_gas' }, mem.deps);
    if (!ini.ok) throw new Error(ini.motivo);
    expect(ini.comando).toContain(ini.codigo);
    // En la base solo vive el hash: ni el código en claro ni nada derivable a simple vista.
    expect(JSON.stringify(mem.filas)).not.toContain(ini.codigo);
    expect(mem.filas[0].hash).toBe(vinc.hashCodigo(ini.codigo));

    const rec = await vinc.reclamarVinculacion(ini.codigo, mem.deps);
    expect(rec).toMatchObject({ ok: true, comercio: 'oxxo_gas', portal: 'https://facturacion.oxxogas.com/' });

    const estado = JSON.stringify({
      cookies: [
        { name: 'sid', value: 'v1', domain: 'facturacion.oxxogas.com', path: '/' },
        { name: 'otro', value: 'v2', domain: 'correo.ejemplo.test', path: '/' }, // ajena: NO se guarda
      ],
      origins: [],
    });
    reloj.ahora = new Date(T0 + 3 * 60_000);
    const fin = await vinc.completarVinculacion({ codigo: ini.codigo, storageState: estado }, mem.deps);
    expect(fin).toEqual({ ok: true, comercio: 'oxxo_gas', cookies: 1 });

    const guardada = mem.guardadas.get(`${A}|oxxo_gas`)!;
    expect(guardada.storageState).toContain('facturacion.oxxogas.com');
    expect(guardada.storageState).not.toContain('correo.ejemplo.test');
    expect(mem.vinculados.has(`${A}|oxxo_gas`)).toBe(true);
    expect(mem.filas[0].estado).toBe('completada');
    expect(mem.bitacora.map((b) => b.accion)).toEqual([
      'autofactura.vinculacion_iniciada', 'autofactura.vinculacion_reclamada', 'autofactura.vinculacion_completada',
    ]);
    expect(JSON.stringify(mem.bitacora)).not.toContain(ini.codigo);
    expect(vinc.estadoVisible(mem.filas[0], reloj.ahora)).toBe('completada');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. FALLO — falla CERRADO: ante la duda, ensayo; ante un muro, una persona
// ═══════════════════════════════════════════════════════════════════════════
describe('Agente 6 · FALLO: cada llave faltante degrada a ensayo y lo dice; cada muro saca el ticket de la cola', () => {
  const confirmarYa = async (ids: string[]) => {
    await correr(A, ids, 0); // propone
    memoria.confirmarLote(A, 'enerser');
  };

  it('portal SIN verificación real (verificaciones.json vacío) → ensayo: se llena, no se aprieta emitir', async () => {
    memoria = crearMemoriaControl({ verificados: [] });
    gastos.push(gasto('g1', A)); prepararFlota(A); memoria.ponerFase(A, 'enerser', 'autonoma', 5);
    const r = await correr(A, ['g1'], 0);
    expect(portal.llamadas).toEqual([{ tenantId: A, comercio: 'enerser', modo: 'ensayo', gastoIds: ['g1'] }]);
    expect(r.facturados).toBe(0);
    expect(portal.emitidos).toHaveLength(0);
    expect(fila('g1').cfdi_uuid).toBeNull();
    expect(fila('g1').autofactura_bloqueo).toBeNull(); // un ensayo no ensucia la pantalla con marcas
  });

  it('portal con selectores OBSOLETOS (la tabla cambió tras la visita) → ensayo', async () => {
    memoria = crearMemoriaControl({ obsoletos: ['enerser'] });
    gastos.push(gasto('g1', A)); prepararFlota(A); memoria.ponerFase(A, 'enerser', 'autonoma', 5);
    await correr(A, ['g1'], 0);
    expect(portal.llamadas[0].modo).toBe('ensayo');
  });

  it('SIN mandato legal de la flota, o con el interruptor global sin aceptar → ensayo, aunque todo lo demás esté abierto', async () => {
    gastos.push(gasto('g1', A), gasto('g2', A)); prepararFlota(A); memoria.ponerFase(A, 'enerser', 'autonoma', 5);
    mandatoFlotaVigente.mockResolvedValue(false);
    await correr(A, ['g1'], 0);
    mandatoFlotaVigente.mockResolvedValue(true);
    process.env.FACTURACION_MANDATO_ACEPTADO = 'no';
    await correr(A, ['g2'], 0);
    expect(portal.llamadas.map((l) => l.modo)).toEqual(['ensayo', 'ensayo']);
    expect(portal.emitidos).toHaveLength(0);
  });

  it('bandera de la flota apagada, o la base del control que no contesta → ensayo (nunca emitir a ciegas)', async () => {
    gastos.push(gasto('g1', A), gasto('g2', A));
    // Sin fila de control = apagada.
    await correr(A, ['g1'], 0);
    // Con la bandera encendida pero el control ilegible.
    prepararFlota(A); memoria.ponerFase(A, 'enerser', 'autonoma', 5); memoria.falla.control = true;
    await correr(A, ['g2'], 0);
    expect(portal.llamadas.map((l) => l.modo)).toEqual(['ensayo', 'ensayo']);
    expect(portal.emitidos).toHaveLength(0);
  });

  it('un ticket por encima del límite de monto no llega al portal: lo emite una persona', async () => {
    gastos.push(gasto('g1', A, { monto: 5000 }), gasto('g2', A));
    prepararFlota(A, { maxMontoTicket: 1500 }); memoria.ponerFase(A, 'enerser', 'autonoma', 5);
    const r = await correr(A, ['g1', 'g2'], 0);
    expect(portal.llamadas[0].gastoIds).toEqual(['g2']);
    expect(r.porGasto.find((p) => p.gastoId === 'g1')).toMatchObject({ motivo: 'espera_control' });
    expect(r.porGasto.find((p) => p.gastoId === 'g1')?.detalle).toMatch(/excede el límite/);
  });

  it('CAPTCHA/vinculación: el ticket sale de la cola automática con su motivo, no se reintenta solo, y el cupo se devuelve', async () => {
    gastos.push(gasto('g1', A), gasto('g2', A)); prepararFlota(A);
    await confirmarYa(['g1', 'g2']);
    portal.fallo = { requiereCaptcha: true, error: 'reCAPTCHA en pantalla' };

    const r = await correr(A, ['g1', 'g2'], 1);
    expect(r.facturados).toBe(0);
    expect(r.bloqueados.map((b) => b.gastoId).sort()).toEqual(['g1', 'g2']);
    expect(String(fila('g1').autofactura_bloqueo)).toMatch(/CAPTCHA/);
    expect(fila('g1').cfdi_uuid).toBeNull();
    expect(memoria.cupos.get(`${A}|${memoria.hoy}`)).toEqual({ tickets: 0, monto: 0 }); // no emitió: devuelve el cupo
    expect(acciones('autofactura.emision_fallida')).toHaveLength(2);

    // El cron siguiente NO vuelve contra el mismo muro.
    const r2 = await correr(A, ['g1', 'g2'], 2);
    expect(motivos(r2)).toEqual(['ya_en_proceso', 'ya_en_proceso']);
    expect(portal.llamadas).toHaveLength(1);
  });

  it('«se apretó emitir y no se pudo confirmar»: el ticket se bloquea y el cupo se CONSERVA (el CFDI pudo existir)', async () => {
    gastos.push(gasto('g1', A)); prepararFlota(A);
    await confirmarYa(['g1']);
    portal.fallo = { emisionSinConfirmar: true, error: 'el portal no devolvió folio' };

    const r = await correr(A, ['g1'], 1);
    expect(r.facturados).toBe(0);
    expect(String(fila('g1').autofactura_bloqueo)).toMatch(/PUEDE QUE EL CFDI YA EXISTA|puede que el CFDI ya exista/i);
    expect(memoria.cupos.get(`${A}|${memoria.hoy}`)).toEqual({ tickets: 1, monto: 400 });
    // Y nadie lo reintenta solo: un segundo intento duplicaría el CFDI.
    const r2 = await correr(A, ['g1'], 3);
    expect(motivos(r2)).toEqual(['ya_en_proceso']);
    expect(portal.llamadas).toHaveLength(1);
  });

  it('el portal tira un 5xx limpio (sin apretar emitir): la marca se levanta, el cupo vuelve y el ticket reintenta con una confirmación nueva', async () => {
    gastos.push(gasto('g1', A)); prepararFlota(A);
    await confirmarYa(['g1']);
    portal.fallo = { error: 'portal caído (502)' };
    const r = await correr(A, ['g1'], 1);
    expect(r.facturados).toBe(0);
    expect(fila('g1').autofactura_bloqueo).toBeNull();
    expect(fila('g1').autofactura_bloqueo).not.toBe(BLOQUEO_EMISION_EN_CURSO);
    expect(memoria.cupos.get(`${A}|${memoria.hoy}`)).toEqual({ tickets: 0, monto: 0 });
    // El lote ya se consumió (UNA vez): el reintento exige una confirmación nueva, no emite solo.
    portal.fallo = null;
    const r2 = await correr(A, ['g1'], 2);
    expect(motivos(r2)).toEqual(['espera_control']);
    expect(portal.emitidos).toHaveLength(0);
  });

  it('vinculación: el cofre sin llave, o una sesión sin cookies del portal, fallan CERRADO y no dejan nada guardado', async () => {
    const reloj = { ahora: new Date(T0) };
    const mem = crearMemoriaVinculacion(reloj);
    const ini = await vinc.iniciarVinculacion({ tenantId: A, userId: 'u', comercio: 'oxxo_gas' }, mem.deps);
    if (!ini.ok) throw new Error(ini.motivo);
    await vinc.reclamarVinculacion(ini.codigo, mem.deps);

    mem.salidas.fallaCofre = true;
    const bueno = JSON.stringify({ cookies: [{ name: 's', value: '1', domain: 'facturacion.oxxogas.com', path: '/' }], origins: [] });
    const r = await vinc.completarVinculacion({ codigo: ini.codigo, storageState: bueno }, mem.deps);
    expect(r).toMatchObject({ ok: false });
    expect((r as { motivo: string }).motivo).toMatch(/cofre/i);
    expect(mem.guardadas.size).toBe(0);
    expect(mem.filas[0].estado).toBe('fallida');

    // Otra solicitud, ahora con un storageState que solo trae cookies de OTRO sitio.
    const ini2 = await vinc.iniciarVinculacion({ tenantId: A, userId: 'u', comercio: 'oxxo_gas' }, mem.deps);
    if (!ini2.ok) throw new Error(ini2.motivo);
    await vinc.reclamarVinculacion(ini2.codigo, mem.deps);
    mem.salidas.fallaCofre = false;
    const ajeno = JSON.stringify({ cookies: [{ name: 's', value: '1', domain: 'banco.ejemplo.test', path: '/' }], origins: [] });
    const r2 = await vinc.completarVinculacion({ codigo: ini2.codigo, storageState: ajeno }, mem.deps);
    expect(r2.ok).toBe(false);
    expect(mem.guardadas.size).toBe(0);
    expect(mem.vinculados.size).toBe(0);
  });

  it('un portal que NO pide cuenta no se «vincula»: el panel lo dice en vez de entregar un código inútil', async () => {
    const mem = crearMemoriaVinculacion({ ahora: new Date(T0) });
    const r = await vinc.iniciarVinculacion({ tenantId: A, userId: 'u', comercio: 'enerser' }, mem.deps);
    expect(r.ok).toBe(false);
    expect(mem.filas).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. DUPLICADO — el CFDI es irreversible: UNA emisión por ticket
// ═══════════════════════════════════════════════════════════════════════════
describe('Agente 6 · DUPLICADO: el mismo lote o el mismo ticket por dos corridas emite UNA sola factura', () => {
  it('dos corridas SOLAPADAS del cron sobre el mismo lote confirmado: gana una, la otra no abre el portal', async () => {
    gastos.push(gasto('g1', A), gasto('g2', A)); prepararFlota(A);
    await correr(A, ['g1', 'g2'], 0);
    memoria.confirmarLote(A, 'enerser');

    const [a, b] = await Promise.all([correr(A, ['g1', 'g2'], 1), correr(A, ['g1', 'g2'], 1)]);
    expect(portal.llamadas).toHaveLength(1);
    expect(portal.emitidos).toHaveLength(1);
    expect(a.facturados + b.facturados).toBe(2);
    const perdedora = a.facturados === 0 ? a : b;
    expect(motivos(perdedora)).toEqual(['ya_en_proceso', 'ya_en_proceso']);
    // Un solo UUID por gasto, sin orden repetido.
    expect([fila('g1').cfdi_orden, fila('g2').cfdi_orden]).toEqual([1, 2]);
    expect(memoria.cupos.get(`${A}|${memoria.hoy}`)).toEqual({ tickets: 2, monto: 800 });
  });

  it('el lote confirmado se consume UNA vez: reintentar el mismo lote en el cron siguiente no emite nada', async () => {
    gastos.push(gasto('g1', A)); prepararFlota(A);
    await correr(A, ['g1'], 0);
    memoria.confirmarLote(A, 'enerser');
    await correr(A, ['g1'], 1);
    const r = await correr(A, ['g1'], 2);
    expect(motivos(r)).toEqual(['ya_facturado']);
    expect(portal.emitidos).toHaveLength(1);
    expect(memoria.fases.get(`${A}|enerser`)?.emisionesConfirmadas).toBe(1);
  });

  it('el cron cada 15 min NO propone otro lote ni vuelve a tocar un ticket cuyo claim sigue vivo', async () => {
    gastos.push(gasto('g1', A)); prepararFlota(A);
    await correr(A, ['g1'], 0);
    const r = await facturarLoteAlVuelo({ tenantId: A, comercio: 'enerser', gastoIds: ['g1'], modo: 'emitir', hoy: HOY, ahora: new Date(T0 + 5 * 60_000).toISOString() });
    expect(motivos(r)).toEqual(['ya_en_proceso']);
    expect(memoria.lotes).toHaveLength(1);
  });

  it('un proceso que MUERE a media sesión deja la marca de «emisión en curso»: el cron siguiente no timbra de nuevo', async () => {
    gastos.push(gasto('g1', A)); prepararFlota(A);
    await correr(A, ['g1'], 0);
    memoria.confirmarLote(A, 'enerser');
    facturarLoteConAgente.mockImplementationOnce(async () => { throw new Error('Vercel mató la función'); });
    await expect(correr(A, ['g1'], 1)).rejects.toThrow('Vercel mató');
    expect(fila('g1').autofactura_bloqueo).toBe(BLOQUEO_EMISION_EN_CURSO);
    const r = await correr(A, ['g1'], 3);
    expect(motivos(r)).toEqual(['ya_en_proceso']);
    expect(portal.emitidos).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. FUERA DE ORDEN
// ═══════════════════════════════════════════════════════════════════════════
describe('Agente 6 · FUERA DE ORDEN: lo confirmado cubre solo lo que la persona vio; el código no se puede reusar ni resucitar', () => {
  it('un ticket que llega DESPUÉS de la confirmación NO se cuela en el lote: espera su propia propuesta', async () => {
    gastos.push(gasto('g1', A), gasto('g2', A)); prepararFlota(A);
    await correr(A, ['g1', 'g2'], 0);
    memoria.confirmarLote(A, 'enerser');
    gastos.push(gasto('g3', A)); // llega tarde, ya confirmado el lote de los otros dos

    const r = await correr(A, ['g1', 'g2', 'g3'], 1);
    expect(portal.llamadas[0].gastoIds).toEqual(['g1', 'g2']);
    expect(r.porGasto.find((p) => p.gastoId === 'g3')).toMatchObject({ motivo: 'espera_control', intentado: false });
    expect(fila('g3').cfdi_uuid).toBeNull();
    const nuevo = memoria.lotes.find((l) => l.estado === 'propuesto');
    expect(nuevo?.gastoIds).toEqual(['g3']);
  });

  it('confirmar sin propuesta previa no existe: no hay lote que confirmar (la confirmación no se adelanta al agente)', () => {
    prepararFlota(A);
    expect(() => memoria.confirmarLote(A, 'enerser')).toThrow('no hay lote propuesto');
  });

  it('un ticket que se vuelve a leer con monto mayor al límite tras proponerse ya no entra aunque el lote esté confirmado', async () => {
    gastos.push(gasto('g1', A)); prepararFlota(A, { maxMontoTicket: 1500 });
    await correr(A, ['g1'], 0);
    memoria.confirmarLote(A, 'enerser');
    fila('g1').monto = 9000; // una corrección posterior del OCR
    const r = await correr(A, ['g1'], 1);
    expect(motivos(r)).toEqual(['espera_control']);
    expect(portal.emitidos).toHaveLength(0);
  });

  it('vinculación: el código sirve UNA vez; completar sin reclamar, tras vencer o tras cancelar falla sin guardar nada', async () => {
    const reloj = { ahora: new Date(T0) };
    const mem = crearMemoriaVinculacion(reloj);
    const sesion = JSON.stringify({ cookies: [{ name: 's', value: '1', domain: 'facturacion.oxxogas.com', path: '/' }], origins: [] });
    const nuevo = async () => {
      const r = await vinc.iniciarVinculacion({ tenantId: A, userId: 'u', comercio: 'oxxo_gas' }, mem.deps);
      if (!r.ok) throw new Error(r.motivo);
      return r.codigo;
    };

    // a) Completar ANTES de reclamar: no hay vinculación en curso.
    const c1 = await nuevo();
    expect(await vinc.completarVinculacion({ codigo: c1, storageState: sesion }, mem.deps)).toMatchObject({ ok: false });
    // b) Dos máquinas reclaman el mismo código: la segunda pierde.
    expect((await vinc.reclamarVinculacion(c1, mem.deps)).ok).toBe(true);
    expect((await vinc.reclamarVinculacion(c1, mem.deps)).ok).toBe(false);
    // c) Una solicitud viva por (flota, portal): pedir otra mientras tanto se rechaza.
    expect((await vinc.iniciarVinculacion({ tenantId: A, userId: 'u', comercio: 'oxxo_gas' }, mem.deps)).ok).toBe(false);
    // d) Vence a los 15 min: completar tarde no guarda nada y el panel la ve vencida.
    reloj.ahora = new Date(T0 + (vinc.VIGENCIA_CODIGO_MIN + 1) * 60_000);
    const tarde = await vinc.completarVinculacion({ codigo: c1, storageState: sesion }, mem.deps);
    expect(tarde.ok).toBe(false);
    expect((tarde as { motivo: string }).motivo).toMatch(/venci/i);
    expect(mem.guardadas.size).toBe(0);
    expect(vinc.estadoVisible(mem.filas[0], reloj.ahora)).toBe('expirada');
    // e) Un código nuevo, cancelado desde el panel, no se puede completar después.
    const c2 = await nuevo();
    await vinc.reclamarVinculacion(c2, mem.deps);
    expect(await vinc.cancelarVinculacion({ tenantId: A, userId: 'u', comercio: 'oxxo_gas' }, mem.deps)).toBe(1);
    expect((await vinc.completarVinculacion({ codigo: c2, storageState: sesion }, mem.deps)).ok).toBe(false);
    expect(mem.guardadas.size).toBe(0);
    // f) Un código con forma inválida ni siquiera llega a la base.
    expect((await vinc.reclamarVinculacion('no-es-un-codigo', mem.deps)).ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. OTRO TENANT
// ═══════════════════════════════════════════════════════════════════════════
describe('Agente 6 · OTRO TENANT: bandera, lote, cupo, credenciales y vinculación son por flota', () => {
  it('la flota B (sin bandera encendida) ensaya aunque la A emita; la confirmación de A no la consume B', async () => {
    gastos.push(gasto('a1', A), gasto('b1', B));
    prepararFlota(A);
    await correr(A, ['a1'], 0);
    memoria.confirmarLote(A, 'enerser');

    const rb = await correr(B, ['b1'], 1);
    expect(portal.llamadas).toEqual([{ tenantId: B, comercio: 'enerser', modo: 'ensayo', gastoIds: ['b1'] }]);
    expect(rb.facturados).toBe(0);
    expect(memoria.lotes.find((l) => l.tenantId === A)?.estado).toBe('confirmado'); // intacto, de A

    const ra = await correr(A, ['a1'], 2);
    expect(ra.facturados).toBe(1);
    expect(portal.emitidos.map((e) => e.tenantId)).toEqual([A]);
    expect(fila('b1').cfdi_uuid).toBeNull();
  });

  it('B encendida en fase supervisada propone SU lote: no usa ni contamina el lote ni el cupo de A', async () => {
    gastos.push(gasto('a1', A), gasto('b1', B));
    prepararFlota(A); prepararFlota(B);
    await correr(A, ['a1'], 0);
    memoria.confirmarLote(A, 'enerser');

    const rb = await correr(B, ['b1'], 1);
    expect(motivos(rb)).toEqual(['espera_control']);
    expect(portal.llamadas).toHaveLength(0);
    expect(memoria.lotes.filter((l) => l.tenantId === B)).toHaveLength(1);
    expect(memoria.lotes.find((l) => l.tenantId === A)?.estado).toBe('confirmado');
    expect(memoria.cupos.has(`${B}|${memoria.hoy}`)).toBe(false);
  });

  it('pedir a la flota B el gasto de A: «no existe en esta flota», no se sella ni se toca la fila de A', async () => {
    gastos.push(gasto('a1', A)); prepararFlota(B);
    const r = await correr(B, ['a1'], 0);
    expect(r.porGasto[0]).toMatchObject({ gastoId: 'a1', intentado: false, facturado: false, detalle: 'no existe en esta flota' });
    expect(portal.llamadas).toHaveLength(0);
    expect(fila('a1').autofactura_intentada_en).toBeNull();
    expect(escrituras).toHaveLength(0);
  });

  it('el cupo diario es por flota: A agota el suyo y B sigue teniendo el suyo', async () => {
    gastos.push(gasto('a1', A), gasto('a2', A), gasto('b1', B));
    prepararFlota(A, { maxTicketsLote: 2, maxTicketsDia: 2 }); prepararFlota(B, { maxTicketsLote: 2, maxTicketsDia: 2 });
    memoria.ponerFase(A, 'enerser', 'autonoma', 5); memoria.ponerFase(B, 'enerser', 'autonoma', 5);
    await correr(A, ['a1', 'a2'], 0);
    await correr(B, ['b1'], 0);
    expect(memoria.cupos.get(`${A}|${memoria.hoy}`)).toEqual({ tickets: 2, monto: 800 });
    expect(memoria.cupos.get(`${B}|${memoria.hoy}`)).toEqual({ tickets: 1, monto: 400 });
    expect(portal.emitidos.map((e) => e.tenantId).sort()).toEqual([A, B]);
  });

  it('vinculación: la solicitud de A no se ve, no se cancela y no guarda sesión en la flota B', async () => {
    const reloj = { ahora: new Date(T0) };
    const mem = crearMemoriaVinculacion(reloj);
    const ini = await vinc.iniciarVinculacion({ tenantId: A, userId: 'u-a', comercio: 'oxxo_gas' }, mem.deps);
    if (!ini.ok) throw new Error(ini.motivo);

    expect(await mem.repo.listar(B)).toEqual([]);
    expect(await vinc.cancelarVinculacion({ tenantId: B, userId: 'u-b', comercio: 'oxxo_gas' }, mem.deps)).toBe(0);
    expect(mem.filas[0].estado).toBe('pendiente');

    await vinc.reclamarVinculacion(ini.codigo, mem.deps);
    const sesion = JSON.stringify({ cookies: [{ name: 's', value: '1', domain: 'facturacion.oxxogas.com', path: '/' }], origins: [] });
    await vinc.completarVinculacion({ codigo: ini.codigo, storageState: sesion }, mem.deps);
    expect([...mem.guardadas.keys()]).toEqual([`${A}|oxxo_gas`]);
    expect(mem.vinculados.has(`${B}|oxxo_gas`)).toBe(false);
    // Y la flota B puede pedir la suya sin chocar con la viva de A.
    expect((await vinc.iniciarVinculacion({ tenantId: B, userId: 'u-b', comercio: 'oxxo_gas' }, mem.deps)).ok).toBe(true);
  });
});
