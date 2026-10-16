import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));
vi.mock('@/lib/meta/client', () => ({ enviarSolicitudUbicacion: vi.fn(async () => ({ ok: true })) }));

const { atenderConductor, hitoParaEvidenciaDelChofer, registrarHitoDesdeFoto, registrarEvidenciaDelChofer } = await import('./atender');
const { correrDeteccionParada } = await import('./deteccion_parada');
const { evaluarCompuertaDeViajes, puertosReales } = await import('./ejecutor');
const { crearMundo } = await import('./mundo.fixture');
const { viajeBase } = await import('./memoria.fixture');
const { SEMILLA_CICLOS } = await import('./ciclo_servicio');
const { crearDobleSenales, senalesApagadas } = await import('./senales_conduccion');
const { puertosSenalVidaReales } = await import('./senal_vida_real');
const { CONFIG_CONDUCTOR_DEFAULT } = await import('./config');
type Servicio = import('./ciclo_servicio').Servicio;
type MuestraGps = import('./ciclo_gps').MuestraGps;
type EventoDetencionFila = import('./repo').EventoDetencionFila;
type ParadaFila = import('./paradas').ParadaFila;
type PuertosDetencion = import('./deteccion_parada').PuertosDetencion;
type ConfigConductor = import('./config').ConfigConductor;

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-68 — CABLEADO EN EL FLUJO REAL DEL CHOFER (lo que rechazó T-A5-60). Todo entra por `atenderConductor` (la entrada del processor) y
// por los crons con sus puertos: nada de llamar a la función pura. 100 % sintético (SIM-0001, teléfonos 28999…, coordenadas inventadas).
// ═══════════════════════════════════════════════════════════════════════════

const V1 = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d068';
const T0 = new Date('2026-10-02T18:00:00.000Z'); // 12:00 en la Ciudad de México
const min = (m: number) => new Date(T0.getTime() + m * 60_000);
const LAT = 20.7;
const LNG = -103.4;
const base = { tenantId: 't1', operadorId: 'o1', telefono: '2899900000001', viajeAbiertoId: V1 };

interface OpcionesFlujo { servicio?: Servicio; ciclos?: boolean; config?: Partial<ConfigConductor> }

function flujo(o: OpcionesFlujo = {}) {
  const w = crearMundo({
    viajes: [viajeBase({ id: V1, folio: 'SIM-0001', unidadId: 'u1', operadorTelefono: base.telefono, ...(o.servicio ? { servicio: o.servicio } : {}) })],
    configs: { t1: { diasSemana: [1, 2, 3, 4, 5, 6, 7], ...o.config } },
    destinatarios: { t1: { 1: ['2899900000009'] } },
    enviar: async () => ({ ok: true, via: 'botones', id: 'wamid.X', motivo: 'ventana_abierta', ventana: 'abierta' }),
  });
  w.m.sembrar(V1);
  if (o.ciclos) for (const p of SEMILLA_CICLOS) w.m.ciclos.push({ tenantId: 't1', servicio: p.servicio, orden: p.orden, hito: p.hito, activo: true });
  const hito = (tipo: string) => w.m.de(V1).find((h) => h.tipo === tipo)!;
  const dice = (texto: string, m = 0) => atenderConductor({ ...base, texto, ahora: min(m), mensajeEn: min(m) }, w.m.deps);
  return { w, hito, dice };
}
const textos = (r: Awaited<ReturnType<typeof atenderConductor>>) => (r?.mensajes ?? []).map((x) => x.texto).join('\n');

// ── (1) T-A5-40: el sello, en el paso «ya salí» del manejador real ─────────────────────────────────────────────────────
describe('«ya salí» exige el sello según la perilla del cliente (entra por atenderConductor)', () => {
  it('importación, opción encendida, sin foto: NO registra el inicio y pide la foto', async () => {
    const { hito, dice, w } = flujo({ servicio: 'importacion', config: { exigirSelloInicio: true } });
    const r = await dice('ya salí');
    expect(hito('salida_carga').estado).toBe('esperado');
    expect(textos(r)).toMatch(/foto del sello/);
    expect(textos(r)).toMatch(/Antes de iniciar el viaje/);
    expect(w.m.legado).toHaveLength(0);
  });

  it('con la foto «sello» recibida (la foto registra el inicio con su evidencia), «ya salí» después ya no pide nada', async () => {
    const { hito, dice, w } = flujo({ servicio: 'importacion', config: { exigirSelloInicio: true } });
    await dice('ya salí');
    const previa = await hitoParaEvidenciaDelChofer({ tenantId: 't1', operadorId: 'o1', viajeId: V1, caption: 'sello', ahora: min(1) }, w.m.deps);
    expect(previa).toMatchObject({ tipo: 'sello', hito: null, comoHito: 'salida_carga' });
    await registrarHitoDesdeFoto({ tenantId: 't1', operadorId: 'o1', telefono: base.telefono, viajeId: V1, tipo: 'sello', ruta: `t1/${V1}/sello.jpg`, sha256: 'a'.repeat(64), ahora: min(1) }, w.m.deps);
    expect(hito('salida_carga').estado).toBe('recibido');
    expect(w.m.evidencias).toHaveLength(1);
    const otra = await dice('ya salí', 2);
    expect(textos(otra)).not.toMatch(/foto del sello/);
  });

  it('con la foto ya colgada de la llegada (flota donde la foto no registra hito): «ya salí» registra sin pedir', async () => {
    const { hito, dice, w } = flujo({ servicio: 'importacion', config: { exigirSelloInicio: true, fotoRegistraHito: false } });
    await dice('ya llegué a cargar', 0);
    const previa = await hitoParaEvidenciaDelChofer({ tenantId: 't1', operadorId: 'o1', viajeId: V1, caption: 'sello', ahora: min(5) }, w.m.deps);
    expect(previa?.hito?.tipo).toBe('llegada_carga');
    await registrarEvidenciaDelChofer({ tenantId: 't1', hito: previa!.hito!, tipo: 'sello', ruta: `t1/${V1}/sello.jpg`, sha256: 'b'.repeat(64), ahora: min(5) }, w.m.deps);
    const r = await dice('ya salí', 10);
    expect(hito('salida_carga').estado).toBe('recibido');
    expect(textos(r)).not.toMatch(/foto del sello/);
  });

  it('opción apagada (la de fábrica): registra el inicio y solo RECOMIENDA la foto, una vez', async () => {
    const { hito, dice } = flujo({ servicio: 'importacion' });
    expect(CONFIG_CONDUCTOR_DEFAULT.exigirSelloInicio).toBe(false);
    const r = await dice('ya salí');
    expect(hito('salida_carga').estado).toBe('recibido');
    expect(textos(r)).toMatch(/Si puedes, manda la foto del sello/);
    expect(textos(r).match(/foto del sello/g)).toHaveLength(1);
  });

  it('con la invitación de foto de la flota encendida no se duplica la recomendación', async () => {
    const { dice } = flujo({ servicio: 'importacion', config: { pedirFotoEvidencia: true } });
    const r = await dice('ya salí');
    expect(textos(r).match(/foto del sello/g)).toHaveLength(1);
  });

  it('exportación NUNCA lo exige ni lo recomienda, aunque la opción esté encendida', async () => {
    const { hito, dice } = flujo({ servicio: 'exportacion', config: { exigirSelloInicio: true } });
    const r = await dice('ya salí');
    expect(hito('salida_carga').estado).toBe('recibido');
    expect(textos(r)).not.toMatch(/foto del sello/);
  });

  it('una lectura de evidencias que falla con la opción encendida NO registra y pide reintentar (falla cerrado)', async () => {
    const { hito, dice, w } = flujo({ servicio: 'importacion', config: { exigirSelloInicio: true } });
    w.m.deps.evidenciasSello = async () => { throw new Error('base caída'); };
    const r = await dice('ya salí');
    expect(hito('salida_carga').estado).toBe('esperado');
    expect(textos(r)).toMatch(/No pude anotarlo/);
  });

  it('con la opción apagada, la misma falla no estorba: registra el inicio', async () => {
    const { hito, dice, w } = flujo({ servicio: 'importacion' });
    w.m.deps.evidenciasSello = async () => { throw new Error('base caída'); };
    await dice('ya salí');
    expect(hito('salida_carga').estado).toBe('recibido');
  });

  it('el paso previo solo toca el inicio de viaje: «ya llegué a cargar» no pide sello', async () => {
    const { hito, dice } = flujo({ servicio: 'importacion', config: { exigirSelloInicio: true } });
    const r = await dice('ya llegué a cargar');
    expect(hito('llegada_carga').estado).toBe('recibido');
    expect(textos(r)).not.toMatch(/foto del sello/);
  });
});

// ── (2) T-A5-42: el ciclo del servicio en «ya llegué a descargar» / «ya salí» ──────────────────────────────────────────
describe('el manejador del chofer pasa el ciclo del servicio', () => {
  it('importación: «ya llegué» a secas es la descarga y «ya salí» después es la salida de la descarga', async () => {
    const { hito, dice } = flujo({ servicio: 'importacion', ciclos: true });
    await dice('ya llegué', 0);
    expect(hito('llegada_descarga').estado).toBe('recibido');
    expect(hito('llegada_carga').estado).not.toBe('recibido');
    await dice('ya salí', 30);
    expect(hito('salida_descarga').estado).toBe('recibido');
    expect(hito('salida_carga').estado).not.toBe('recibido');
  });

  it('el MISMO texto sin ciclos configurados en la flota sigue el ciclo de siempre (cero regresión)', async () => {
    const { hito, dice } = flujo({ servicio: 'importacion', ciclos: false });
    await dice('ya llegué', 0);
    expect(hito('llegada_carga').estado).toBe('recibido');
    expect(hito('llegada_descarga').estado).not.toBe('recibido');
  });

  it('exportación: «ya llegué» es la carga, «ya salí» la salida de la carga, y no se pide sello', async () => {
    const { hito, dice } = flujo({ servicio: 'exportacion', ciclos: true, config: { exigirSelloInicio: true } });
    await dice('ya llegué', 0);
    expect(hito('llegada_carga').estado).toBe('recibido');
    const r = await dice('ya salí', 30);
    expect(hito('salida_carga').estado).toBe('recibido');
    expect(textos(r)).not.toMatch(/foto del sello/);
  });

  it('importación con ciclo: el «ya salí» de ARRANQUE no cierra el viaje como salida de descarga; es el inicio y pasa por el sello', async () => {
    const { hito, dice } = flujo({ servicio: 'importacion', ciclos: true, config: { exigirSelloInicio: true } });
    const pide = await dice('ya salí', 0);
    expect(textos(pide)).toMatch(/foto del sello/);
    expect(hito('salida_carga').estado).toBe('esperado');
    expect(hito('salida_descarga').estado).not.toBe('recibido');
  });

  it('la lectura del ciclo falla: el chofer igual registra con el ciclo de siempre', async () => {
    const { hito, dice, w } = flujo({ servicio: 'importacion', ciclos: true });
    w.m.deps.ciclosDe = async () => { throw new Error('base caída'); };
    await dice('ya llegué', 0);
    expect(hito('llegada_carga').estado).toBe('recibido');
  });
});

// ── (3) T-A5-65: la señal de conducción llega a la compuerta desde el cron ─────────────────────────────────────────────
const quieta = (ref: Date, desde = 40): MuestraGps[] => {
  const s: MuestraGps[] = [];
  for (let t = desde; t >= 0; t -= 5) s.push({ lat: LAT, lng: LNG, medidaEn: new Date(ref.getTime() - t * 60_000) });
  return s;
};
const ENCENDIDA: Partial<ConfigConductor> = { compuertaMovimientoActiva: true, poleoMin: 5 };

describe('«atasco»: la señal del proveedor entra por los puertos del cron hasta la compuerta', () => {
  const viaje = viajeBase({ id: V1, unidadId: 'u1', operadorTelefono: base.telefono });
  const puerto = (extra: Record<string, unknown>) => ({
    muestrasUnidad: async (us: Array<{ tenantId: string; unidadId: string }>) => new Map(us.map((u) => [`${u.tenantId}|${u.unidadId}`, quieta(T0)])),
    sitiosDe: async (vs: Array<{ id: string }>) => new Map(vs.map((v) => [v.id, { origen: null, destino: null }])),
    ...extra,
  });
  const configs = new Map<string, ConfigConductor | null>([['t1', { ...CONFIG_CONDUCTOR_DEFAULT, ...ENCENDIDA }]]);

  it('quieta + el proveedor dice que conduce (40 km/h): NO se le escribe; sin la señal, solo-GPS sí deja', async () => {
    const con = await evaluarCompuertaDeViajes(puerto({ senalesConduccion: crearDobleSenales({ u1: { ignicion: true, velocidadKmh: 40, telefonoEnMano: null, medidaEn: T0 } }) }), [viaje], configs, T0);
    expect(con.get(V1)).toEqual({ permitido: false, razon: 'conduciendo' });
    const sin = await evaluarCompuertaDeViajes(puerto({}), [viaje], configs, T0);
    expect(sin.get(V1)).toMatchObject({ permitido: true, razon: 'detenida' });
    const apagada = await evaluarCompuertaDeViajes(puerto({ senalesConduccion: senalesApagadas }), [viaje], configs, T0);
    expect(apagada.get(V1)).toMatchObject({ permitido: true, razon: 'detenida' });
  });

  it('el proveedor dice «teléfono en la mano»: tampoco se le escribe', async () => {
    const r = await evaluarCompuertaDeViajes(puerto({ senalesConduccion: crearDobleSenales({ u1: { ignicion: null, velocidadKmh: null, telefonoEnMano: true, medidaEn: T0 } }) }), [viaje], configs, T0);
    expect(r.get(V1)).toEqual({ permitido: false, razon: 'conduciendo' });
  });

  it('un proveedor que lanza no tumba la pasada: cae a solo-GPS', async () => {
    const roto = { leer: async () => { throw new Error('proveedor caído'); } };
    const r = await evaluarCompuertaDeViajes(puerto({ senalesConduccion: roto }), [viaje], configs, T0);
    expect(r.get(V1)).toMatchObject({ permitido: true, razon: 'detenida' });
  });

  it('los puertos reales del motor y del barrido de señal de vida llevan el puerto de señales (apagado de origen)', () => {
    expect(puertosReales().senalesConduccion).toBe(senalesApagadas);
    expect(puertosSenalVidaReales().senalesConduccion).toBe(senalesApagadas);
  });
});

// ── (4) la detención sin aviso en importación, sin `salida_carga` en el ciclo ──────────────────────────────────────────
describe('detención sin aviso en importación (el ciclo no tiene carga)', () => {
  function mundoCron(senales?: Parameters<typeof crearDobleSenales>[0]) {
    const f = flujo({ servicio: 'importacion', ciclos: true, config: { ...ENCENDIDA, deteccionParadaActiva: true } });
    const bitacora: EventoDetencionFila[] = [];
    const paradas: ParadaFila[] = [];
    const enviados: string[] = [];
    const cron: PuertosDetencion = {
      ...f.w.puertos,
      enviar: async (_t, m) => { enviados.push(m.plantilla.nombre); return { ok: true, via: 'botones', id: 'wamid.X', motivo: 'ventana_abierta', ventana: 'abierta' }; },
      eventosDetencion: async (_t, ids) => bitacora.filter((e) => ids.includes(e.viajeId)),
      guardarEventoDetencion: async (h, detalle) => { bitacora.push({ id: bitacora.length + 1, viajeId: h.viajeId, hitoId: h.id, detalle: { clase: 'deteccion_parada', ...detalle }, creadoEn: T0.toISOString() }); return true; },
      paradasRecientes: async () => paradas,
      muestrasUnidad: async (us) => new Map(us.map((u) => [`${u.tenantId}|${u.unidadId}`, quieta(T0, 40)])),
      sitiosDe: async (vs) => new Map(vs.map((v) => [v.id, { origen: null, destino: null }])),
      ...(senales ? { senalesConduccion: crearDobleSenales(senales) } : {}),
    };
    return { ...f, cron, enviados, bitacora };
  }

  it('«ya salí» de arranque (flujo real) deja el viaje en tránsito y la unidad quieta 40 min recibe UNA pregunta', async () => {
    const m = mundoCron();
    await m.dice('ya salí', -60);
    expect(m.hito('salida_carga').estado).toBe('recibido');
    const r = await correrDeteccionParada(m.cron, { ahora: T0 });
    expect(r.revisados).toBe(1);
    expect(r.preguntas).toBe(1);
    expect(m.enviados.filter((p) => p === 'conductor_detencion_sin_aviso_v1')).toHaveLength(1);
    const otra = await correrDeteccionParada(m.cron, { ahora: min(5) });
    expect(otra.preguntas).toBe(0);
  });

  it('atasco: quieta pero el proveedor dice que conduce → NO se pregunta', async () => {
    const m = mundoCron({ u1: { ignicion: true, velocidadKmh: 35, telefonoEnMano: null, medidaEn: T0 } });
    await m.dice('ya salí', -60);
    const r = await correrDeteccionParada(m.cron, { ahora: T0 });
    expect(r.preguntas).toBe(0);
    expect(m.enviados).toHaveLength(0);
  });
});
