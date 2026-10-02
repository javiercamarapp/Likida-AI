import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbMemoria, type DbMemoria, type Fila } from './db_memoria.fixture';

// ═══════════════════════════════════════════════════════════════════════════
// E2E AGENTE 8 — ESCALACIÓN DEL VIAJE NO ACEPTADO.
//
// Cadena REAL: escalarViajesSinAceptar (cron horario) → cola de viajes avisados sin aceptar → config por flota →
// claim (UPDATE condicional de escalado_en) → recordatorio al chofer (texto o plantilla según ventana) →
// aviso al jefe (selector enviarConFallback) → cierre de corrida. DOBLES: base en memoria, Meta (meta.fixture),
// teléfonos de jefe, config por flota, avisos/bitácora. Datos sintéticos.
// ═══════════════════════════════════════════════════════════════════════════

let db: DbMemoria;
const horasPorFlota: Record<string, number> = {}; // (se usa solo para sembrar tenant.config)
const jefes: Record<string, string> = {};
const avisosChofer: Array<{ t: string; op: string; v: string }> = [];
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: vi.fn(async () => {}) }));
vi.mock('@/lib/correo/avisos', () => ({ avisoEscalados: vi.fn(async () => {}) }));
vi.mock('../agentes/notificaciones', () => ({ avisar: vi.fn(async () => {}), avisarCorridasPorFlota: vi.fn(async () => {}) }));
const corridas: unknown[] = [];
vi.mock('../agentes/corridas', () => ({ registrarCorrida: async (t: string, a: string, c: unknown) => { corridas.push({ t, a, c }); } }));
vi.mock('../contactos', () => ({ telefonosJefe: async (ts: string[]) => Object.fromEntries(ts.filter((t) => jefes[t]).map((t) => [t, jefes[t]])) }));
// avisarAlChofer es el aviso por PLANTILLA «viaje asignado»: aquí manda la plantilla por el doble de Meta.
vi.mock('../operacion', async () => {
  const { meta } = await import('../conductor/meta.fixture');
  return {
    avisarAlChofer: async (t: string, op: string, v: string) => {
      avisosChofer.push({ t, op, v });
      const fila = db.tablas.viaje.find((x) => x.id === v)!;
      const tel = (fila.operador as { telefono: string }).telefono;
      await meta.sendTemplate(tel, 'viaje_asignado', { parametros: [String(fila.folio)] });
    },
  };
});
vi.mock('@/lib/meta/client', async (original) => {
  const real = await original<Record<string, unknown>>();
  const { meta } = await import('../conductor/meta.fixture');
  return {
    ...real,
    sendText: async (a: string, c: string) => { const r = await meta.enviarTexto(a, c); return r.ok ? r.id : null; },
    enviarTexto: (...a: Parameters<typeof meta.enviarTexto>) => meta.enviarTexto(...a),
    enviarBotones: (...a: Parameters<typeof meta.enviarBotones>) => meta.enviarBotones(...a),
    sendTemplate: (...a: Parameters<typeof meta.sendTemplate>) => meta.sendTemplate(...a),
  };
});
vi.mock('../wa_ventana', async (original) => {
  const real = await original<typeof import('../wa_ventana')>();
  const { meta } = await import('../conductor/meta.fixture');
  return {
    ...real,
    ventanaDeContacto: async (tel: string, ahora: Date = new Date()) => real.estadoDeVentana(meta.ultimoEntrante.get(real.normalizarTelefonoWa(tel)) ?? null, ahora),
    registrarDecisionEnvio: async () => {},
  };
});

const { escalarViajesSinAceptar, viajesSinAceptar } = await import('../escalar_viaje');
const { meta } = await import('../conductor/meta.fixture');

const A = 't-a'; const B = 't-b';
const AHORA = new Date('2026-10-02T20:00:00.000Z');
const hace = (h: number) => new Date(AHORA.getTime() - h * 3_600_000).toISOString();
const TEL = { a1: '5219990000001', a2: '5219990000002', b1: '5219990000011', jefeA: '5219990000091', jefeB: '5219990000092' };

const viaje = (id: string, tenant: string, avisadoHace: number, tel: string | null, extra: Fila = {}): Fila => ({
  id, tenant_id: tenant, folio: `F-${id}`, estatus: 'abierto', operador_id: `op-${id}`, avisado_en: hace(avisadoHace), aceptado_en: null, escalado_en: null,
  avisos_enviados: 1, operador: { nombre: `Operador Ficticio ${id}`, telefono: tel }, ...extra,
});
const fila = (id: string) => db.tablas.viaje.find((v) => v.id === id)!;
const a = (tel: string) => meta.salientes.filter((s) => s.a === tel);

beforeEach(() => {
  meta.reiniciar(); meta.estado.reloj = AHORA; corridas.length = 0; avisosChofer.length = 0;
  for (const k of Object.keys(horasPorFlota)) delete horasPorFlota[k];
  jefes[A] = TEL.jefeA; jefes[B] = TEL.jefeB;
  db = crearDbMemoria({ tenant: [A, B].map((id) => ({ id, rfc: null, config: horasPorFlota[id] ? { agentes: { conductores: { horasEscalacion: horasPorFlota[id] } } } : null })), viaje: [viaje('v1', A, 6, TEL.a1), viaje('v2', A, 2, TEL.a2), viaje('v3', B, 7, TEL.b1)] });
  // El chofer escribió hace una hora, el jefe también: ventanas abiertas.
  for (const t of Object.values(TEL)) meta.entrante(t, new Date(AHORA.getTime() - 3_600_000));
});

describe('feliz', () => {
  it('a las 5 h sin aceptar: recordatorio al chofer + aviso al jefe de SU flota, una sola vez, con sello y sin tocar al que aún está a tiempo', async () => {
    const r = await escalarViajesSinAceptar({ ahora: AHORA });
    expect(r).toMatchObject({ revisados: 2, escalados: 2, fallos: [] });
    expect(a(TEL.a1)[0].cuerpo).toMatch(/F-v1/);                  // recordatorio al chofer (texto, ventana abierta)
    expect(a(TEL.jefeA)).toHaveLength(1);                         // el jefe de A se entera de v1
    expect(a(TEL.jefeA)[0].cuerpo).toMatch(/F-v1/);
    expect(a(TEL.jefeB)[0].cuerpo).toMatch(/F-v3/);
    expect(a(TEL.a2)).toHaveLength(0);                            // v2 lleva 2 h: no toca
    expect(fila('v1').escalado_en).toBe(AHORA.toISOString());
    expect(fila('v2').escalado_en).toBeNull();
    expect(fila('v1').avisos_enviados).toBe(2);
  });
});

describe('fallo', () => {
  it('chofer con ventana cerrada: el recordatorio va por PLANTILLA (avisarAlChofer), no se gasta un texto que Meta rechazaría', async () => {
    meta.ultimoEntrante.delete(meta.norm(TEL.a1));
    await escalarViajesSinAceptar({ ahora: AHORA });
    expect(avisosChofer).toEqual([{ t: A, op: 'op-v1', v: 'v1' }]);
    expect(meta.salientes.filter((s) => s.a === TEL.a1).every((s) => s.tipo === 'plantilla')).toBe(true);
  });

  it('flota SIN teléfono de jefe: se marca igual (no reintentar para siempre), se dice en fallos y el chofer sí recibe su recordatorio', async () => {
    delete jefes[A];
    const r = await escalarViajesSinAceptar({ ahora: AHORA });
    expect(r.fallos.join()).toMatch(/no tiene teléfono de jefe/);
    expect(fila('v1').escalado_en).not.toBeNull();
    expect(a(TEL.a1)).toHaveLength(1);
  });

  it('rate limit al avisar al jefe (REINTENTABLE): el sello se LIBERA y la corrida siguiente escala el viaje; Meta no tumba el cron', async () => {
    meta.estado.bloqueados.add(meta.norm(TEL.jefeA));
    const r = await escalarViajesSinAceptar({ ahora: AHORA });
    expect(r.rechazosReintentables).toBe(1);
    expect(fila('v1').escalado_en).toBeNull();
    meta.estado.bloqueados.clear();
    const r2 = await escalarViajesSinAceptar({ ahora: new Date(AHORA.getTime() + 3_600_000) });
    expect(r2.escalados).toBeGreaterThanOrEqual(1);
    expect(fila('v1').escalado_en).not.toBeNull();
    expect(a(TEL.jefeA).filter((s) => /F-v1/.test(s.cuerpo))).toHaveLength(1);
  });

  it('la base no contesta: el cron LANZA (un error no es «nadie dejó de aceptar»)', async () => {
    db.fallar('viaje.select', 'PostgREST 503');
    await expect(escalarViajesSinAceptar({ ahora: AHORA })).rejects.toThrow(/viajesSinAceptar/);
  });

  it('el reloj de la corrida vence ANTES del claim: nada se marca y se dice cuántos quedaron', async () => {
    const r = await escalarViajesSinAceptar({ ahora: AHORA, venceEn: Date.now() - 1 });
    expect(r.cortadosPorReloj).toBe(2);
    expect(db.tablas.viaje.every((v) => v.escalado_en === null)).toBe(true);
    expect(meta.salientes).toHaveLength(0);
  });
});

describe('duplicado', () => {
  it('el cron cada hora no repite: una vez escalado, las siguientes corridas no mandan nada más', async () => {
    await escalarViajesSinAceptar({ ahora: AHORA });
    const antes = meta.salientes.length;
    await escalarViajesSinAceptar({ ahora: new Date(AHORA.getTime() + 3_600_000) });
    await escalarViajesSinAceptar({ ahora: new Date(AHORA.getTime() + 7_200_000) });
    expect(meta.salientes.length).toBe(antes);
  });

  it('dos corridas SOLAPADAS: el claim condicional deja pasar a una sola, y el jefe recibe UN aviso por viaje', async () => {
    await Promise.all([escalarViajesSinAceptar({ ahora: AHORA }), escalarViajesSinAceptar({ ahora: AHORA })]);
    expect(a(TEL.jefeA).filter((s) => /F-v1/.test(s.cuerpo))).toHaveLength(1);
    expect(a(TEL.a1)).toHaveLength(1);
  });
});

describe('fuera de orden', () => {
  it('el chofer acepta ANTES de que corra el cron: no hay escalación', async () => {
    fila('v1').aceptado_en = hace(1);
    const r = await escalarViajesSinAceptar({ ahora: AHORA });
    expect(r.revisados).toBe(1); // solo v3 (flota B)
    expect(a(TEL.jefeA)).toHaveLength(0);
  });

  it('el chofer acepta DESPUÉS de escalar: el aviso ya salió, no se retira ni se manda otro, y no vuelve a la cola', async () => {
    await escalarViajesSinAceptar({ ahora: AHORA });
    fila('v1').aceptado_en = AHORA.toISOString();
    const antes = meta.salientes.length;
    await escalarViajesSinAceptar({ ahora: new Date(AHORA.getTime() + 3_600_000) });
    expect(meta.salientes.length).toBe(antes);
  });

  it('un viaje que Likida nunca avisó (avisado_en nulo) o ya cerrado jamás entra a la cola', async () => {
    db.tablas.viaje.push(viaje('v8', A, 10, TEL.a1, { avisado_en: null }), viaje('v9', A, 10, TEL.a1, { estatus: 'liquidado' }));
    const cola = await viajesSinAceptar(AHORA, 1);
    expect(cola.map((x) => x.id).sort()).toEqual(['v1', 'v2', 'v3']);
  });

  it('con más viajes vencidos que el lote, sale el MÁS VIEJO primero (la cola drena en orden)', async () => {
    const cola = await viajesSinAceptar(AHORA, 1);
    expect(cola.map((x) => x.id)).toEqual(['v3', 'v1', 'v2']);
  });
});

describe('otro tenant', () => {
  it('cada flota escala con SU plazo y a SU jefe: A con 8 h no escala lo de 6 h, B con 5 h sí', async () => {
    db.tablas.tenant.find((t) => t.id === A)!.config = { agentes: { conductores: { horasEscalacion: 8 } } };
    db.tablas.tenant.find((t) => t.id === B)!.config = { agentes: { conductores: { horasEscalacion: 5 } } };
    await escalarViajesSinAceptar({ ahora: AHORA });
    expect(fila('v1').escalado_en).toBeNull();
    expect(fila('v3').escalado_en).not.toBeNull();
    expect(a(TEL.jefeA)).toHaveLength(0);
    expect(a(TEL.jefeB)).toHaveLength(1);
  });

  it('el aviso de la flota B nunca llega al jefe de la A, ni al revés', async () => {
    await escalarViajesSinAceptar({ ahora: AHORA });
    expect(a(TEL.jefeA).every((s) => !/F-v3/.test(s.cuerpo))).toBe(true);
    expect(a(TEL.jefeB).every((s) => !/F-v1|F-v2/.test(s.cuerpo))).toBe(true);
  });

  it('si la config no se puede leer, esos viajes se saltan (no se escala con datos equivocados) y no sale ningún aviso', async () => {
    db.fallar('tenant.select', 'config ilegible');
    const r = await escalarViajesSinAceptar({ ahora: AHORA });
    expect(r.escalados).toBe(0);
    expect(db.tablas.viaje.every((v) => v.escalado_en === null)).toBe(true);
    expect(meta.salientes).toHaveLength(0);
  });
});
