import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL VIGÍA LEE AL CONDUCTOR (ronda 03): los cinco hitos, la cita/ETA y el andén alimentan lo que se le
// contesta a un cliente. Se prueba con la función REAL del Conductor (`construirEstatus`) en el medio, para que si
// cambia la forma de uno el otro lo note, y con una base grabadora para el cableado del estatus real.
// ═══════════════════════════════════════════════════════════════════════════

type Fila = Record<string, unknown>;
let tablas: Record<string, Fila[]> = {};
const consultas: Array<{ tabla: string; filtros: Array<[string, unknown]> }> = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const q = { tabla, filtros: [] as Array<[string, unknown]> };
      consultas.push(q);
      const b: Record<string, unknown> = {};
      const filtrar = () => (tablas[tabla] ?? []).filter((f) => q.filtros.every(([c, v]) => (Array.isArray(v) ? v.includes(f[c]) : f[c] === v)));
      b.select = () => b;
      b.eq = (c: string, v: unknown) => { q.filtros.push([c, v]); return b; };
      b.in = (c: string, v: unknown[]) => { q.filtros.push([c, v]); return b; };
      b.is = () => b; b.order = () => b; b.limit = () => b;
      b.maybeSingle = () => Promise.resolve({ data: filtrar()[0] ?? null, error: null });
      b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: filtrar(), error: null }).then(ok, ko);
      return b;
    },
    storage: { from: () => ({ createSignedUrl: async (ruta: string) => ({ data: { signedUrl: `https://firmada.test/${ruta}?t=1` }, error: null }) }) },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { crearEstatusViajeReal, archivoAdjuntoReal } = await import('./repo');
const { parteDelConductor, mezclarEstatus } = await import('./desde_conductor');
const { construirEstatus } = await import('../conductor/estatus_viaje');
const { CONFIG_CONDUCTOR_DEFAULT } = await import('../conductor/config');
const { hitoVacio } = await import('../conductor/memoria.fixture');
const { T1, T2, CLIENTE_A, CLIENTE_A2, VIAJE_1 } = await import('./datos.fixture');
type ViajeTablero = import('../conductor/repo_validacion').ViajeTablero;
type HitoFila = import('../conductor/tipos').HitoFila;
type TipoHito = import('../conductor/tipos').TipoHito;

const AHORA = new Date('2026-10-02T18:00:00.000Z');
const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString();
const en = (min: number) => hace(-min);

const viajeConductor = (p: Partial<ViajeTablero> = {}): ViajeTablero => ({
  id: VIAJE_1, folio: 'F-1042', origen: 'Zapopan', destino: 'Monterrey', estatus: 'abierto', operadorId: 'o1', operadorNombre: 'Juan Pérez', terminalId: null,
  terminalNombre: null, clienteId: CLIENTE_A, clienteNombre: 'Cliente A', unidadId: null, aceptadoEn: hace(900), citaOrigenEn: null, citaDestinoEn: null,
  etaOrigenEn: null, etaDestinoEn: null, origenSitioId: null, destinoSitioId: null, ...p,
});
const hitos = (e: Partial<Record<TipoHito, string>>): HitoFila[] =>
  (['llegada_carga', 'salida_carga', 'llegada_descarga', 'salida_descarga', 'regreso'] as TipoHito[]).map((tipo) =>
    hitoVacio({ id: `${VIAJE_1}-${tipo}`, tipo, viajeId: VIAJE_1, tenantId: T1, ...(e[tipo] ? { estado: 'recibido', fuente: 'texto', mensajeEn: e[tipo]!, recibidoEn: e[tipo]! } : {}) }));
const estatusConductor = (v: ViajeTablero, h: HitoFila[]) => construirEstatus(v, h, { ...CONFIG_CONDUCTOR_DEFAULT }, AHORA);

function sembrarViaje(extra: Fila = {}) {
  tablas = {
    viaje: [{ id: VIAJE_1, tenant_id: T1, cliente_id: CLIENTE_A, folio: 'F-1042', origen: 'Zapopan', destino: 'Monterrey', estatus: 'abierto', unidad_id: null, llegada_en: null, descarga_en: null, regreso_en: null, ...extra }],
    pod: [], factura_emitida: [], factura_viaje: [], posicion: [],
  };
}
beforeEach(() => { consultas.length = 0; sembrar(); });
function sembrar() { sembrarViaje(); }

describe('parteDelConductor / mezclarEstatus (puros)', () => {
  it('sin datos del Conductor no aporta nada', () => {
    expect(parteDelConductor(null)).toEqual({ etapa: null, ultimoHito: null, etaIso: null, etaFuente: null, citaCarga: null, enAnden: null });
  });

  it('la etapa sale del ÚLTIMO hito registrado, con la hora del mensaje del chofer', () => {
    const p = parteDelConductor(estatusConductor(viajeConductor(), hitos({ llegada_carga: hace(300), salida_carga: hace(240) })));
    expect(p.etapa).toBe('en_ruta');
    expect(p.ultimoHito).toEqual({ tipo: 'salida_carga', en: hace(240) });
    const q = parteDelConductor(estatusConductor(viajeConductor(), hitos({ llegada_carga: hace(75) })));
    expect(q.etapa).toBe('en_origen');
    expect(q.enAnden).toMatchObject({ lugar: 'carga', desde: hace(75) });
  });

  it('la ETA que ve el cliente es la de LLEGADA A DESCARGA y dice si es cita o ETA; la cita manda', () => {
    const v = viajeConductor({ citaDestinoEn: en(600), etaDestinoEn: en(500), etaOrigenEn: en(60) });
    const p = parteDelConductor(estatusConductor(v, hitos({})));
    expect(p.etaIso).toBe(en(600));
    expect(p.etaFuente).toBe('cita');
    expect(p.citaCarga).toEqual({ en: en(60), fuente: 'eta' });
    const solo = parteDelConductor(estatusConductor(viajeConductor({ etaDestinoEn: en(500) }), hitos({})));
    expect(solo).toMatchObject({ etaIso: en(500), etaFuente: 'eta' });
  });

  it('una llegada ya registrada deja de ser un dato futuro: no hay cita de carga si ya llegó a cargar', () => {
    const v = viajeConductor({ citaOrigenEn: en(-30), citaDestinoEn: en(600) });
    const p = parteDelConductor(estatusConductor(v, hitos({ llegada_carga: hace(20) })));
    expect(p.citaCarga).toBeNull();
    expect(p.etaIso).toBe(en(600));
    const llego = parteDelConductor(estatusConductor(v, hitos({ llegada_carga: hace(500), salida_carga: hace(400), llegada_descarga: hace(10) })));
    expect(llego.etaIso).toBeNull();
    expect(llego.etapa).toBe('en_destino');
  });

  it('gana el hito más reciente: un sello viejo más nuevo que el del Conductor se respeta; el empate es del Conductor', () => {
    const parte = { etapa: 'en_origen' as const, ultimoHito: { tipo: 'llegada_carga' as const, en: hace(100) }, etaIso: null, etaFuente: null, citaCarga: null, enAnden: null };
    const viejo = { etapa: 'regresando' as const, ultimoHito: { tipo: 'regreso' as const, en: hace(10) } };
    expect(mezclarEstatus(viejo, parte)).toEqual(viejo);
    const empate = { etapa: 'en_destino' as const, ultimoHito: { tipo: 'llegada' as const, en: hace(100) } };
    expect(mezclarEstatus(empate, parte)).toEqual({ etapa: 'en_origen', ultimoHito: parte.ultimoHito });
    expect(mezclarEstatus({ etapa: 'en_curso', ultimoHito: null }, parte)).toEqual({ etapa: 'en_origen', ultimoHito: parte.ultimoHito });
  });

  it('un viaje liquidado queda cerrado aunque haya un hito tardío', () => {
    const parte = parteDelConductor(estatusConductor(viajeConductor(), hitos({ llegada_carga: hace(10) })));
    expect(mezclarEstatus({ etapa: 'cerrado', ultimoHito: null }, parte).etapa).toBe('cerrado');
  });
});

describe('el estatus REAL del Vigía con el Conductor conectado', () => {
  const real = (c: Parameters<typeof crearEstatusViajeReal>[0]['conductor']) => crearEstatusViajeReal({ conductor: c });

  it('trae etapa, último hito, ETA con su fuente y andén desde el Conductor', async () => {
    const v = viajeConductor({ citaDestinoEn: en(600) });
    const s = await real(async () => estatusConductor(v, hitos({ llegada_carga: hace(300), salida_carga: hace(240) })))
      .estatus({ tenantId: T1, clienteId: CLIENTE_A, viajeId: VIAJE_1 });
    expect(s).toMatchObject({
      folio: 'F-1042', etapa: 'en_ruta', ultimoHito: { tipo: 'salida_carga', en: hace(240) }, etaIso: en(600), etaFuente: 'cita', enAnden: null, adjuntos: [],
    });
  });

  it('el viaje se busca por (flota, cliente): un viaje de OTRO cliente no existe y el Conductor ni se consulta', async () => {
    const conductor = vi.fn(async () => estatusConductor(viajeConductor(), hitos({})));
    expect(await real(conductor).estatus({ tenantId: T1, clienteId: CLIENTE_A2, viajeId: VIAJE_1 })).toBeNull();
    expect(await real(conductor).estatus({ tenantId: T2, clienteId: CLIENTE_A, viajeId: VIAJE_1 })).toBeNull();
    expect(conductor).not.toHaveBeenCalled();
  });

  it('si el Conductor habla de OTRO viaje (doble roto), se ignora: no se mezcla un dato ajeno', async () => {
    const ajeno = { ...estatusConductor(viajeConductor({ id: 'otro', citaDestinoEn: en(600) }), hitos({ llegada_carga: hace(5) })), viajeId: 'otro' };
    const s = await real(async () => ajeno).estatus({ tenantId: T1, clienteId: CLIENTE_A, viajeId: VIAJE_1 });
    expect(s).toMatchObject({ etapa: 'en_curso', ultimoHito: null, etaIso: null, enAnden: null });
  });

  it('si el Conductor no se puede leer, el viaje dice lo de sus sellos y SIN ETA (no se rellena)', async () => {
    sembrarViaje({ llegada_en: hace(50) });
    const s = await real(async () => { throw new Error('base caída'); }).estatus({ tenantId: T1, clienteId: CLIENTE_A, viajeId: VIAJE_1 });
    expect(s).toMatchObject({ etapa: 'en_destino', ultimoHito: { tipo: 'llegada', en: hace(50) }, etaIso: null, etaFuente: null });
  });

  it('un viaje que ya llegó a descarga no ofrece «hora estimada»; un viaje liquidado queda cerrado', async () => {
    const v = viajeConductor({ citaDestinoEn: en(-10) });
    const h = hitos({ llegada_carga: hace(500), salida_carga: hace(400), llegada_descarga: hace(20) });
    expect(await real(async () => estatusConductor(v, h)).estatus({ tenantId: T1, clienteId: CLIENTE_A, viajeId: VIAJE_1 }))
      .toMatchObject({ etapa: 'en_destino', etaIso: null, etaFuente: null, enAnden: { lugar: 'descarga' } });
    sembrarViaje({ estatus: 'liquidado' });
    expect(await real(async () => estatusConductor(v, h)).estatus({ tenantId: T1, clienteId: CLIENTE_A, viajeId: VIAJE_1 }))
      .toMatchObject({ etapa: 'cerrado', etaIso: null });
  });

  it('con POD subido ofrece el adjunto; sin POD, no', async () => {
    tablas.pod = [{ tenant_id: T1, viaje_id: VIAJE_1, estado: 'subido', storage_path: `${T1}/pod/${VIAJE_1}.jpg` }];
    const s = await real(async () => null).estatus({ tenantId: T1, clienteId: CLIENTE_A, viajeId: VIAJE_1 });
    expect(s?.podRecibido).toBe(true);
    expect(s?.adjuntos).toEqual([{ clave: 'pod', nombre: 'Comprobante de entrega (POD)' }]);
    tablas.pod = [];
    expect((await real(async () => null).estatus({ tenantId: T1, clienteId: CLIENTE_A, viajeId: VIAJE_1 }))?.adjuntos).toEqual([]);
  });
});

describe('archivoAdjuntoReal: el archivo sale por (flota, cliente, viaje)', () => {
  const ruta = `${T1}/pod/${VIAJE_1}.jpg`;
  beforeEach(() => { tablas.pod = [{ tenant_id: T1, viaje_id: VIAJE_1, estado: 'subido', storage_path: ruta }]; });

  it('firma la ruta del POD de ese cliente y arma nombre y pie con el folio', async () => {
    const a = await archivoAdjuntoReal({ tenantId: T1, clienteId: CLIENTE_A, viajeId: VIAJE_1, clave: 'pod' });
    expect(a).toEqual({ url: `https://firmada.test/${ruta}?t=1`, nombre: 'POD-F-1042.jpg', pie: 'Comprobante de entrega (POD) · viaje F-1042' });
  });

  it('otro cliente de la misma flota, o de otra flota: nada', async () => {
    expect(await archivoAdjuntoReal({ tenantId: T1, clienteId: CLIENTE_A2, viajeId: VIAJE_1, clave: 'pod' })).toBeNull();
    expect(await archivoAdjuntoReal({ tenantId: T2, clienteId: CLIENTE_A, viajeId: VIAJE_1, clave: 'pod' })).toBeNull();
  });

  it('una ruta que no cuelga de la flota (o que intenta salir) NO se firma', async () => {
    tablas.pod = [{ tenant_id: T1, viaje_id: VIAJE_1, estado: 'subido', storage_path: `${T2}/pod/ajeno.jpg` }];
    expect(await archivoAdjuntoReal({ tenantId: T1, clienteId: CLIENTE_A, viajeId: VIAJE_1, clave: 'pod' })).toBeNull();
    tablas.pod = [{ tenant_id: T1, viaje_id: VIAJE_1, estado: 'subido', storage_path: `${T1}/../${T2}/x.jpg` }];
    expect(await archivoAdjuntoReal({ tenantId: T1, clienteId: CLIENTE_A, viajeId: VIAJE_1, clave: 'pod' })).toBeNull();
  });

  it('toda consulta del archivo lleva el tenant', async () => {
    consultas.length = 0;
    await archivoAdjuntoReal({ tenantId: T1, clienteId: CLIENTE_A, viajeId: VIAJE_1, clave: 'pod' });
    expect(consultas.length).toBeGreaterThanOrEqual(2);
    for (const c of consultas) expect(c.filtros.some(([col, v]) => col === 'tenant_id' && v === T1), c.tabla).toBe(true);
  });
});
