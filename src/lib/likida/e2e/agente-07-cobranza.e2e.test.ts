import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbMemoria, type DbMemoria, type Fila } from './db_memoria.fixture';
import './reloj_adelantado.fixture';

// ═══════════════════════════════════════════════════════════════════════════
// E2E AGENTE 7 — COBRANZA DE COMPROBANTES (el cron que persigue al chofer que lleva días sin mandar recibos).
//
// Cadena REAL: ejecutarCobranzaGlobal → cola por flota (tiers, ventana, config) → claim con unique(viaje,tier)
// → selector de envío (enviarConFallback: texto o plantilla según la ventana de 24 h) → bitácora → sello 0087.
// DOBLES: base en memoria con la restricción única real (23505), Meta (conductor/meta.fixture), avisos y bitácora de
// corridas. Todo sintético: nombres y teléfonos ficticios.
// ═══════════════════════════════════════════════════════════════════════════

let db: DbMemoria;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: vi.fn(async () => {}) }));
vi.mock('../agentes/notificaciones', () => ({ avisarCorridasPorFlota: vi.fn(async () => {}), avisar: vi.fn(async () => {}) }));
const corridas: unknown[] = [];
vi.mock('../agentes/corridas', () => ({ registrarCorrida: async (t: string, a: string, c: unknown) => { corridas.push({ t, a, c }); } }));
vi.mock('../repo', async (orig) => ({ ...(await orig<Record<string, unknown>>()), getPerfilCrudo: async () => ({}) }));
vi.mock('@/lib/meta/client', async (original) => {
  const real = await original<Record<string, unknown>>();
  const { meta } = await import('../conductor/meta.fixture');
  return { ...real, enviarTexto: (...a: Parameters<typeof meta.enviarTexto>) => meta.enviarTexto(...a), enviarBotones: (...a: Parameters<typeof meta.enviarBotones>) => meta.enviarBotones(...a), sendTemplate: (...a: Parameters<typeof meta.sendTemplate>) => meta.sendTemplate(...a) };
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

const { ejecutarCobranzaGlobal, ejecutarCobranza, colaCobranza } = await import('../agentes/cobranza');
const { meta } = await import('../conductor/meta.fixture');

const A = 't-a'; const B = 't-b';
// Viernes 2-oct-2026, 10:00 hora de México.
const AHORA = new Date('2026-10-02T16:00:00.000Z');
const TEL_A1 = '5219990000001'; const TEL_A2 = '5219990000002'; const TEL_B1 = '5219990000011';

const viaje = (id: string, tenant: string, fechaInicio: string, tel: string | null, extra: Fila = {}): Fila => ({
  id, tenant_id: tenant, folio: `F-${id}`, estatus: 'abierto', fecha_inicio: fechaInicio, avisado_en: `${fechaInicio}T15:00:00Z`,
  recordatorio_comprobacion_en: null, operador: { nombre: `Operador Ficticio ${id}`, telefono: tel }, ...extra,
});

function mundo(extra: Partial<Record<string, Fila[]>> = {}) {
  db = crearDbMemoria({
    viaje: [
      viaje('v1', A, '2026-09-29', TEL_A1), // 3 días → tier 3
      viaje('v2', A, '2026-09-25', TEL_A2), // 7 días → tier 7
      viaje('v3', B, '2026-09-29', TEL_B1),
    ],
    cobranza_contacto: [], agente_cobranza_config: [],
    ...extra,
  }, {}, { cobranza_contacto: [['viaje_id', 'tier']] });
}
const contactos = (viajeId?: string) => db.tablas.cobranza_contacto.filter((c) => !viajeId || c.viaje_id === viajeId);
const aBaja = (tel: string) => meta.salientes.filter((s) => s.a === tel);

beforeEach(() => {
  meta.reiniciar(); meta.estado.reloj = AHORA; corridas.length = 0;
  meta.entrante(TEL_A1, new Date('2026-10-02T09:00:00Z')); meta.entrante(TEL_A2, new Date('2026-10-02T09:00:00Z')); meta.entrante(TEL_B1, new Date('2026-10-02T09:00:00Z'));
  mundo();
});

describe('feliz', () => {
  it('cada viaje recibe el tier que le toca, por texto (ventana abierta), con claim + bitácora + sello 0087', async () => {
    const r = await ejecutarCobranzaGlobal(AHORA);
    expect(r).toMatchObject({ tenants: 2, contactados: 3, fallos: [] });
    expect(aBaja(TEL_A1)[0].cuerpo).toMatch(/Llevas 3 días con tu viaje \*F-v1\*/);
    expect(aBaja(TEL_A2)[0].cuerpo).toMatch(/Llevas 7 días/);
    expect(contactos('v1')).toMatchObject([{ tier: 3, enviado: true }]);
    expect(contactos('v2')).toMatchObject([{ tier: 7, enviado: true }]);
    expect(db.tablas.viaje.find((v) => v.id === 'v1')!.recordatorio_comprobacion_en).toBe(AHORA.toISOString());
    expect(corridas).toHaveLength(2); // una anotación de corrida por flota
  });
});

describe('fallo', () => {
  it('ventana de 24 h cerrada: sale la plantilla recordatorio_cierre (no texto) y la bitácora lo dice', async () => {
    meta.ultimoEntrante.clear();
    await ejecutarCobranzaGlobal(AHORA);
    expect(meta.salientes.every((s) => s.tipo === 'plantilla' && s.plantilla === 'recordatorio_cierre')).toBe(true);
    expect(meta.salientes).toHaveLength(3);
    expect(contactos('v1')[0]).toMatchObject({ enviado: true, detalle: expect.stringMatching(/plantilla recordatorio_cierre/) });
  });

  it('plantilla sin aprobar: el contacto queda enviado=false CON el motivo, y NO se reintenta cada hora (no insistir a un número roto)', async () => {
    meta.ultimoEntrante.clear(); meta.estado.aprobadas = new Set();
    const r = await ejecutarCobranzaGlobal(AHORA);
    expect(r.contactados).toBe(0);
    expect(r.fallos).toHaveLength(3);
    expect(contactos('v1')[0]).toMatchObject({ enviado: false });
    expect(String(contactos('v1')[0].detalle)).toMatch(/132001|aprobad/);
    meta.salientes.length = 0;
    await ejecutarCobranzaGlobal(new Date(AHORA.getTime() + 3_600_000));
    expect(meta.salientes).toHaveLength(0);
  });

  it('rate limit (429, REINTENTABLE): el tier NO se consume y la corrida siguiente lo manda', async () => {
    meta.estado.bloqueados.add(meta.norm(TEL_A1));
    const r = await ejecutarCobranza(A, AHORA);
    expect(r.rechazosReintentables).toBe(1);
    expect(contactos('v1')).toHaveLength(0);          // el claim se liberó
    expect(contactos('v2')).toHaveLength(1);          // el otro viaje sí salió
    meta.estado.bloqueados.clear();
    await ejecutarCobranza(A, new Date(AHORA.getTime() + 3_600_000));
    expect(contactos('v1')).toMatchObject([{ tier: 3, enviado: true }]);
  });

  it('un operador SIN teléfono se anota (para que la pantalla diga a quién no puede) y no truena a los demás', async () => {
    db.tablas.viaje.push(viaje('v4', A, '2026-09-28', null));
    const r = await ejecutarCobranza(A, AHORA);
    expect(r.sinTelefono).toBe(1);
    expect(contactos('v4')).toMatchObject([{ enviado: false, detalle: expect.stringMatching(/no tiene teléfono/) }]);
    expect(r.contactados).toBe(2);
  });

  it('la base no contesta al leer la config de UNA flota: esa flota falla DICIÉNDOLO (sin cobrar a ciegas) y la otra sigue', async () => {
    db.fallar('agente_cobranza_config.select', 'PostgREST 503', (f) => f.some(([c, o, v]) => c === 'tenant_id' && o === 'eq' && v === A));
    const r = await ejecutarCobranzaGlobal(AHORA);
    expect(r.fallos.length).toBeGreaterThan(0);
    expect(contactos('v1')).toHaveLength(0);          // fail-closed: sin config no se contacta con defaults a ciegas
    expect(contactos('v2')).toHaveLength(0);
    expect(aBaja(TEL_A1)).toHaveLength(0);
    expect(contactos('v3')).toMatchObject([{ tenant_id: B, enviado: true }]); // la flota B sí se cobró
    expect(aBaja(TEL_B1)).toHaveLength(1);
  });

  it('la base no contesta para NINGUNA flota: todas fallan diciéndolo y nadie recibe un cobro con defaults a ciegas', async () => {
    db.fallar('agente_cobranza_config.select', 'PostgREST 503');
    const r = await ejecutarCobranzaGlobal(AHORA);
    expect(r.fallos.length).toBeGreaterThan(0);
    expect(r.contactados).toBe(0);
  });
});

describe('duplicado', () => {
  it('correr el cron tres veces el mismo día no repite el aviso: se insiste por tier, no por hora', async () => {
    await ejecutarCobranzaGlobal(AHORA);
    await ejecutarCobranzaGlobal(new Date(AHORA.getTime() + 3_600_000));
    await ejecutarCobranzaGlobal(new Date(AHORA.getTime() + 7_200_000));
    expect(aBaja(TEL_A1)).toHaveLength(1);
    expect(contactos('v1')).toHaveLength(1);
  });

  it('dos corridas SOLAPADAS (at-least-once del cron): el unique(viaje,tier) decide y solo UNA manda', async () => {
    await Promise.all([ejecutarCobranza(A, AHORA), ejecutarCobranza(A, AHORA)]);
    expect(aBaja(TEL_A1)).toHaveLength(1);
    expect(aBaja(TEL_A2)).toHaveLength(1);
    expect(contactos('v1')).toHaveLength(1);
  });
});

describe('fuera de orden', () => {
  it('el cron estuvo caído 15 días: manda SOLO el tier más alto alcanzado (no tres cobros de golpe) y consume los menores', async () => {
    db.tablas.viaje = [viaje('v9', A, '2026-09-17', TEL_A1)]; // 15 días
    await ejecutarCobranza(A, AHORA);
    expect(aBaja(TEL_A1)).toHaveLength(1);
    expect(aBaja(TEL_A1)[0].cuerpo).toMatch(/Llevas 15 días/);
    expect(contactos('v9')).toMatchObject([{ tier: 14 }]);
    await ejecutarCobranza(A, new Date(AHORA.getTime() + 3_600_000));
    expect(aBaja(TEL_A1)).toHaveLength(1);
  });

  it('el chofer comprobó y el viaje se cerró ANTES de que corra el cron: no recibe nada', async () => {
    db.tablas.viaje.find((v) => v.id === 'v1')!.estatus = 'liquidado';
    await ejecutarCobranza(A, AHORA);
    expect(aBaja(TEL_A1)).toHaveLength(0);
  });

  it('fuera de la ventana horaria de la flota (domingo / de madrugada) no se contacta; con «Ejecutar ahora» (humano) sí', async () => {
    const domingo3am = new Date('2026-10-04T09:00:00.000Z');
    expect((await ejecutarCobranza(A, domingo3am)).omitido).toMatch(/ventana/);
    expect(meta.salientes).toHaveLength(0);
    const r = await ejecutarCobranza(A, domingo3am, { ignorarVentana: true });
    expect(r.contactados).toBeGreaterThan(0);
  });

  it('un viaje que Likida NUNCA avisó (importado del TMS) no entra a la cola, aunque lleve días', async () => {
    db.tablas.viaje.push(viaje('v5', A, '2026-09-01', TEL_A1, { avisado_en: null }));
    const cola = await colaCobranza(A, AHORA);
    expect([...cola.paraContactar, ...cola.sinTelefono].some((f) => f.viajeId === 'v5')).toBe(false);
  });
});

describe('otro tenant', () => {
  it('la config de una flota (pausada, tiers propios) no afecta a la otra', async () => {
    db.tablas.agente_cobranza_config.push({ tenant_id: B, activo: false, tiers: [3, 7, 14], hora_inicio: 9, hora_fin: 18, dias_semana: [1, 2, 3, 4, 5, 6], instrucciones: '', firma: '' });
    db.tablas.agente_cobranza_config.push({ tenant_id: A, activo: true, tiers: [2, 5], hora_inicio: 9, hora_fin: 18, dias_semana: [1, 2, 3, 4, 5, 6], instrucciones: 'Manda foto legible.', firma: 'Oficina Ficticia' });
    await ejecutarCobranzaGlobal(AHORA);
    expect(aBaja(TEL_B1)).toHaveLength(0);                     // B pausada: nada
    expect(aBaja(TEL_A1)[0].cuerpo).toMatch(/Manda foto legible\.[\s\S]*Oficina Ficticia/); // A con SU texto
    expect(contactos('v1')[0].tier).toBe(2);                   // y SUS tiers
    expect(contactos('v3')).toHaveLength(0);
  });

  it('el mismo número de tier en dos flotas son claims distintos; el claim lleva el tenant de su viaje', async () => {
    await ejecutarCobranzaGlobal(AHORA);
    expect(contactos('v1')[0].tenant_id).toBe(A);
    expect(contactos('v3')[0].tenant_id).toBe(B);
    expect(contactos('v1')[0].tier).toBe(contactos('v3')[0].tier);
  });

  it('la cola de una flota no incluye viajes de otra', async () => {
    const cola = await colaCobranza(B, AHORA);
    expect(cola.paraContactar.map((f) => f.viajeId)).toEqual(['v3']);
  });
});

// La cobranza por gasto (qué gasto sin comprobante, un mensaje por chofer, efectividad al llegar el comprobante) tiene
// su E2E propio: `agentes/cobranza_gasto_e2e.test.ts`.
