import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbMemoria, type DbMemoria, type Fila } from './db_memoria.fixture';
import './reloj_adelantado.fixture';
import type { Http } from '../conectores/tipos';
import type { DepsValidacion } from '../conductor/validar_hito';
import type { SitioValidable, Veredicto } from '../conductor/validacion';

// ═══════════════════════════════════════════════════════════════════════════
// E2E AGENTE 10 — GPS: del poll al veredicto del Conductor.
//
// Cadena REAL: lector de proveedor (Samsara, con un doble HTTP) → `sincronizarGpsDeFlota` → el asentador común
// (`asentarLecturas`: frontera, liga dispositivo→unidad de LA flota, compuerta de privacidad, upsert idempotente, sello
// `gps_visto_en`) → tabla `posicion` → `posicionesDeUnidad` / `unidadReportaGps` REALES → `barridoValidacion` (el cron del
// Conductor que concilia «ya llegué» contra la posición del tractor).
// DOBLES: la base en memoria (`db_memoria.fixture`, con ON CONFLICT DO NOTHING), el HTTP del proveedor, el cofre
// (la credencial va en claro), el estado durable del poll (solo para ver con qué clase de falla se cierra) y el sitio de
// la llegada (la geocerca; su lectura real la prueban `repo_validacion` y `tabla_propia/e2e.test.ts`).
// No es Postgres: el `uq_posicion_lectura` y los CHECK de la 0176/0287 los prueban las pruebas SQL; aquí se prueba que la
// APP escribe con la llave correcta, que dice lo que descarta y que nunca cruza flotas. Datos sintéticos.
// ═══════════════════════════════════════════════════════════════════════════

let db: DbMemoria;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../presupuesto', () => ({ acotada: (q: unknown) => q }));
vi.mock('../conectores/cofre', () => ({
  descifrar: (s: string) => {
    if (s === 'ROTO') throw new Error('llave equivocada');
    return JSON.parse(s) as Record<string, string>;
  },
}));
// El estado durable del poll (RPC de la 0500): aquí solo se observa con qué resultado se cierra cada flota.
const cierres: Array<{ tenantId: string; resultado: Record<string, unknown> }> = [];
let reclamadas: Array<Record<string, unknown>> = [];
vi.mock('../conectores/poll_durable', () => ({
  reclamarPolls: async () => reclamadas,
  finalizarPoll: async (_r: string, c: { tenantId: string }, resultado: Record<string, unknown>) => { cierres.push({ tenantId: c.tenantId, resultado }); },
}));

const { sincronizarGpsDeFlota, sincronizarGpsTodas, asentarLecturas } = await import('../conectores/sincronizar_gps');
const { posicionesDeUnidad, unidadReportaGps } = await import('../conductor/repo_validacion');
const { barridoValidacion } = await import('../conductor/validar_hito');
const { CONFIG_CONDUCTOR_DEFAULT } = await import('../conductor/config');
const { hitoVacio, viajeBase } = await import('../conductor/memoria.fixture');

const A = 't-a'; const B = 't-b';
const CRED = JSON.stringify({ token: 'tok-sintetico' });
/** La planta de la carga: el sitio contra el que se concilia «ya llegué». */
const SITIO: SitioValidable = { id: 'sitio-1', nombre: 'Planta Zapopan', lat: 20.72, lng: -103.39, radioM: 300 };
const DENTRO = { lat: 20.7201, lng: -103.3901 };   // ≈ 15 m del centro
const LEJOS = { lat: 20.80, lng: -103.39 };         // ≈ 9 km
const AHORA = new Date('2026-10-20T14:45:00.000Z'); // 08:45 en CDMX
const MENSAJE = '2026-10-20T14:32:00.000Z';         // el chofer escribe «ya llegué»
const iso = (hhmm: string, dia = '2026-10-20') => `${dia}T${hhmm}:00.000Z`;

const samsara = (v: Array<{ id: string; lat: number; lng: number; t: string }>) =>
  JSON.stringify({ data: v.map((x) => ({ id: x.id, gps: { latitude: x.lat, longitude: x.lng, time: x.t } })) });
const httpCon = (estado: number, cuerpo = '{}') => {
  const o = { llamadas: 0, http: (async () => { o.llamadas++; return { estado, cuerpo }; }) as Http };
  return o;
};
const sinEspera = async () => undefined;

const unidad = (id: string, tenant: string, device: string): Fila =>
  ({ id, tenant_id: tenant, gps_proveedor: 'samsara', gps_device_id: device, numero_economico: `E-${id}`, activo: true, gps_visto_en: null });
const posiciones = (tenant: string, unidadId?: string) =>
  db.tablas.posicion.filter((p) => p.tenant_id === tenant && (unidadId === undefined || p.unidad_id === unidadId));

const poll = (tenant: string, http: Http, ahora: Date = AHORA) =>
  sincronizarGpsDeFlota(tenant, 'samsara', CRED, http, () => ahora.getTime(), { dormir: sinEspera });

const veredictos: Array<{ tenantId: string; hito: string; v: Veredicto }> = [];
const deps: DepsValidacion = {
  sitio: async () => SITIO,
  posiciones: posicionesDeUnidad,   // REAL: lee `posicion` de la base
  gpsActivo: unidadReportaGps,      // REAL
  aplicar: async (tenantId, hito, v) => { veredictos.push({ tenantId, hito: hito.id, v }); return 'nuevo'; },
};
const llegada = (id: string, tenant: string, unidadId: string, viajeId: string) => ({
  hito: hitoVacio({ id, tipo: 'llegada_carga', viajeId, tenantId: tenant, estado: 'recibido', fuente: 'texto', mensajeEn: MENSAJE, recibidoEn: MENSAJE }),
  viaje: viajeBase({ id: viajeId, tenantId: tenant, unidadId }),
});
const barrer = (candidatos: ReturnType<typeof llegada>[]) =>
  barridoValidacion({ candidatos: async () => candidatos, configDe: async () => ({ ...CONFIG_CONDUCTOR_DEFAULT }), deps }, AHORA);

beforeEach(() => {
  veredictos.length = 0; cierres.length = 0; reclamadas = [];
  db = crearDbMemoria({
    unidad: [unidad('u-a1', A, '1234'), unidad('u-a2', A, '5678'), unidad('u-b1', B, '1234')],   // el MISMO device_id en dos flotas
    posicion: [], gps_dispositivo_huerfano: [], viaje: [],
  });
});

describe('FELIZ: el tractor llega, el poll lo asienta y el barrido concilia el «ya llegué»', () => {
  it('Samsara → posición en la unidad de ESA flota con su sello → el barrido valida la llegada con fuente GPS', async () => {
    const { http } = httpCon(200, samsara([{ id: '1234', ...DENTRO, t: iso('14:30') }]));
    const r = await poll(A, http);
    expect(r).toMatchObject({ leidas: 1, guardadas: 1, huerfanas: 0 });
    expect(r.error).toBeUndefined();
    expect(posiciones(A)).toEqual([expect.objectContaining({ tenant_id: A, unidad_id: 'u-a1', proveedor: 'samsara', medida_en: iso('14:30') })]);
    expect(db.tablas.unidad.find((u) => u.id === 'u-a1')!.gps_visto_en).toBe(AHORA.toISOString());   // «la fuente entra de verdad»
    expect(db.tablas.unidad.find((u) => u.id === 'u-a2')!.gps_visto_en).toBeNull();                    // la que no reportó no se sella

    const b = await barrer([llegada('h1', A, 'u-a1', 'v1')]);
    expect(b).toMatchObject({ revisados: 1, validados: 1, sinDato: 0, fallos: 0 });
    expect(veredictos).toEqual([{ tenantId: A, hito: 'h1', v: expect.objectContaining({ resultado: 'validado', fuente: 'gps' }) }]);
  });

  it('la misma cadena dice la verdad en el otro sentido: el GPS lejos del sitio es «sin coincidencia», no «validado»', async () => {
    await poll(A, httpCon(200, samsara([{ id: '1234', ...LEJOS, t: iso('14:30') }])).http);
    const b = await barrer([llegada('h1', A, 'u-a1', 'v1')]);
    expect(b).toMatchObject({ validados: 0, sinCoincidencia: 1 });
    expect(veredictos[0].v.resultado).toBe('sin_coincidencia');
  });
});

describe('FALLO: la credencial y el proveedor fallan con nombre, y no se escribe nada', () => {
  it('401 del proveedor: falla de CREDENCIAL (decide el backoff largo), cero filas, cero sellos', async () => {
    const h = httpCon(401);
    const r = await poll(A, h.http);
    expect(r).toMatchObject({ falla: 'credencial', leidas: 0, guardadas: 0 });
    expect(r.error).toMatch(/401/);
    expect(h.llamadas).toBe(1);   // una credencial mala no se reintenta en caliente
    expect(db.tablas.posicion).toHaveLength(0);
    expect(db.tablas.unidad.every((u) => u.gps_visto_en === null)).toBe(true);
  });

  it('5xx sostenido: reintenta 3 veces con espera y se declara falla del PROVEEDOR con backlog (no «0 lecturas»)', async () => {
    const h = httpCon(503);
    const r = await poll(A, h.http);
    expect(h.llamadas).toBe(4);   // el intento y 3 reintentos
    expect(r).toMatchObject({ falla: 'proveedor', backlog: true, guardadas: 0 });
    expect(db.tablas.posicion).toHaveLength(0);
  });

  it('200 con un cuerpo que no es JSON: falla de FORMATO, nombrada', async () => {
    const r = await poll(A, httpCon(200, '<html>mantenimiento</html>').http);
    expect(r).toMatchObject({ falla: 'formato', guardadas: 0 });
  });

  it('credencial ilegible en el cofre: no llama al proveedor y el panel recibe una frase, no el detalle', async () => {
    const h = httpCon(200, samsara([]));
    const r = await sincronizarGpsDeFlota(A, 'samsara', 'ROTO', h.http, () => AHORA.getTime());
    expect(h.llamadas).toBe(0);
    expect(r.error).toBe('la credencial del conector no se pudo leer');
  });

  it('el cron cierra el estado durable de CADA flota con la clase de su falla, y una flota rota no frena a la sana', async () => {
    reclamadas = [
      { tenantId: A, proveedor: 'samsara', valoresCifrados: CRED, claimToken: 'c1', watermarkEn: null, tailWatermarkEn: null },
      { tenantId: B, proveedor: 'samsara', valoresCifrados: CRED, claimToken: 'c2', watermarkEn: null, tailWatermarkEn: null },
    ];
    // La flota A recibe 401; la B recibe una posición. El doble responde según el token del encabezado: aquí, por orden de llamada.
    let n = 0;
    // `sincronizarGpsTodas` usa el reloj real para validar la frontera: la muestra va fechada 5 min antes de AHORA real.
    const reciente = new Date(Date.now() - 5 * 60_000).toISOString();
    const http: Http = async () => (++n === 1 ? { estado: 401, cuerpo: '{}' } : { estado: 200, cuerpo: samsara([{ id: '1234', ...DENTRO, t: reciente }]) });
    const salida = await sincronizarGpsTodas(http, { ahora: () => AHORA.getTime() });
    const porTenant = Object.fromEntries(salida.map((s) => [s.tenantId, s]));
    // Con ancho de fan-out > 1 el orden de las dos llamadas no es fijo: lo que importa es que una falló con credencial y la otra guardó.
    const fallada = salida.find((s) => s.falla === 'credencial');
    const sana = salida.find((s) => s.guardadas === 1);
    expect(fallada).toBeDefined();
    expect(sana).toBeDefined();
    expect(fallada!.tenantId).not.toBe(sana!.tenantId);
    expect(Object.keys(porTenant).sort()).toEqual([A, B]);
    expect(cierres).toHaveLength(2);
    expect(cierres.find((c) => c.tenantId === fallada!.tenantId)!.resultado).toMatchObject({ completo: false, falla: 'credencial' });
    expect(cierres.find((c) => c.tenantId === sana!.tenantId)!.resultado).toMatchObject({ completo: true });
    expect(cierres.find((c) => c.tenantId === sana!.tenantId)!.resultado.falla).toBeUndefined();
  });
});

describe('DUPLICADO: el mismo lote por poll, por push o reenviado no duplica filas', () => {
  it('dos polls seguidos con el camión parado traen la misma última posición: una fila, y el segundo cuenta 0 guardadas', async () => {
    const http = httpCon(200, samsara([{ id: '1234', ...DENTRO, t: iso('14:30') }])).http;
    const uno = await poll(A, http);
    const dos = await poll(A, http, new Date(AHORA.getTime() + 5 * 60_000));
    expect(uno.guardadas).toBe(1);
    expect(dos).toMatchObject({ leidas: 1, guardadas: 0 });
    expect(dos.error).toBeUndefined();   // un duplicado ignorado NO es un error
    expect(posiciones(A)).toHaveLength(1);
  });

  it('el lote que llegó por poll y reenviado por el PUSH (mismo asentador) tampoco duplica', async () => {
    await poll(A, httpCon(200, samsara([{ id: '1234', ...DENTRO, t: iso('14:30') }])).http);
    const push = await asentarLecturas(A, 'samsara', [
      { deviceId: '1234', ...DENTRO, medidaEn: iso('14:30'), velocidad: 0, rumbo: null },
      { deviceId: '1234', ...DENTRO, medidaEn: iso('14:35'), velocidad: 0, rumbo: null },   // una nueva dentro del mismo lote
    ], { ahora: () => AHORA.getTime(), descartadasNoSonError: true });
    expect(push).toMatchObject({ leidas: 2, guardadas: 1 });
    expect(posiciones(A).map((p) => p.medida_en).sort()).toEqual([iso('14:30'), iso('14:35')]);
  });

  it('el barrido repetido del cron no cambia el veredicto del hito ni lo duplica en la base de posiciones', async () => {
    await poll(A, httpCon(200, samsara([{ id: '1234', ...DENTRO, t: iso('14:30') }])).http);
    await barrer([llegada('h1', A, 'u-a1', 'v1')]);
    await barrer([llegada('h1', A, 'u-a1', 'v1')]);
    expect(veredictos.map((x) => x.v.resultado)).toEqual(['validado', 'validado']);
    expect(posiciones(A)).toHaveLength(1);
  });
});

describe('FUERA DE ORDEN: la muestra atrasada concilia después, y la vieja no cuenta', () => {
  it('«ya llegué» a las 14:32 y el GPS reporta tarde: primero «sin dato»; al llegar la muestra de las 14:30 el barrido valida', async () => {
    const antes = await barrer([llegada('h1', A, 'u-a1', 'v1')]);
    expect(antes).toMatchObject({ validados: 0, sinDato: 1 });
    expect(veredictos[0].v).toMatchObject({ resultado: 'sin_dato', motivo: 'sin_ubicacion' });

    await poll(A, httpCon(200, samsara([{ id: '1234', ...DENTRO, t: iso('14:30') }])).http, new Date(AHORA.getTime() + 10 * 60_000));
    const despues = await barrer([llegada('h1', A, 'u-a1', 'v1')]);
    expect(despues).toMatchObject({ validados: 1, sinDato: 0 });
    expect(veredictos[1].v.resultado).toBe('validado');
  });

  it('una muestra de AYER no valida la llegada de hoy', async () => {
    await poll(A, httpCon(200, samsara([{ id: '1234', ...DENTRO, t: iso('14:30', '2026-10-19') }])).http);
    expect(posiciones(A)).toHaveLength(1);   // se guarda (es un dato real), pero no cuenta para esta ventana
    const b = await barrer([llegada('h1', A, 'u-a1', 'v1')]);
    expect(b).toMatchObject({ validados: 0, sinDato: 1 });
  });

  it('una muestra fuera de secuencia (llega la de las 14:20 DESPUÉS de la de las 14:30) se guarda sin pisar a la otra, y manda la más cercana a la hora del mensaje', async () => {
    await poll(A, httpCon(200, samsara([{ id: '1234', ...DENTRO, t: iso('14:30') }])).http);
    await poll(A, httpCon(200, samsara([{ id: '1234', ...LEJOS, t: iso('14:20') }])).http, new Date(AHORA.getTime() + 60_000));
    expect(posiciones(A).map((p) => p.medida_en).sort()).toEqual([iso('14:20'), iso('14:30')]);
    const b = await barrer([llegada('h1', A, 'u-a1', 'v1')]);
    expect(b.validados).toBe(1);   // la de las 14:30 está a 2 min del mensaje; la de las 14:20, a 12
  });

  it('una lectura fechada en el futuro (reloj malo del GPS) se descarta y se DICE; no tumba al resto del lote', async () => {
    const r = await poll(A, httpCon(200, samsara([
      { id: '1234', ...DENTRO, t: iso('14:30') },
      { id: '5678', ...DENTRO, t: '2026-10-21T14:30:00.000Z' },   // un día adelante
    ])).http);
    expect(r).toMatchObject({ guardadas: 1, descartadas: 1, backlog: true });
    expect(r.error).toMatch(/inválida/);
    expect(posiciones(A).map((p) => p.unidad_id)).toEqual(['u-a1']);
  });
});

describe('OTRO TENANT: el mismo device_id en dos flotas se asienta cada uno en SU unidad', () => {
  it('la lectura del 1234 de la flota A cae en u-a1 y la del 1234 de la B en u-b1; ninguna cruza', async () => {
    await poll(A, httpCon(200, samsara([{ id: '1234', ...DENTRO, t: iso('14:30') }])).http);
    await poll(B, httpCon(200, samsara([{ id: '1234', ...LEJOS, t: iso('14:31') }])).http);
    expect(posiciones(A).map((p) => p.unidad_id)).toEqual(['u-a1']);
    expect(posiciones(B).map((p) => p.unidad_id)).toEqual(['u-b1']);
    expect(db.tablas.posicion.every((p) => (p.tenant_id === A) === (p.unidad_id === 'u-a1'))).toBe(true);
  });

  it('el barrido de la flota B no ve la posición «dentro del sitio» de la A: su hito queda sin coincidencia y el de la A valida', async () => {
    await poll(A, httpCon(200, samsara([{ id: '1234', ...DENTRO, t: iso('14:30') }])).http);
    await poll(B, httpCon(200, samsara([{ id: '1234', ...LEJOS, t: iso('14:30') }])).http);
    await barrer([llegada('hA', A, 'u-a1', 'vA'), llegada('hB', B, 'u-b1', 'vB')]);
    expect(veredictos.find((x) => x.hito === 'hA')!.v.resultado).toBe('validado');
    expect(veredictos.find((x) => x.hito === 'hB')!.v.resultado).toBe('sin_coincidencia');
    // y la lectura directa de posiciones con el tenant equivocado no devuelve nada
    expect(await posicionesDeUnidad(B, 'u-a1', new Date(iso('14:00')), new Date(iso('15:00')))).toEqual([]);
  });

  it('un dispositivo que ninguna unidad de la flota reclama es HUÉRFANO: se lista (id y hora, sin coordenadas) y NO se crea un camión', async () => {
    const r = await poll(A, httpCon(200, samsara([
      { id: '1234', ...DENTRO, t: iso('14:30') },
      { id: 'nadie-lo-tiene', ...DENTRO, t: iso('14:30') },
    ])).http);
    expect(r).toMatchObject({ guardadas: 1, huerfanas: 1 });
    expect(db.tablas.unidad).toHaveLength(3);   // no se dio de alta ninguna
    expect(db.tablas.gps_dispositivo_huerfano).toEqual([expect.objectContaining({ tenant_id: A, proveedor: 'samsara', device_id: 'nadie-lo-tiene' })]);
    expect(Object.keys(db.tablas.gps_dispositivo_huerfano[0])).not.toContain('lat');
  });
});
