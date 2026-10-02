import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbMemoria, type DbMemoria } from './db_memoria.fixture';
import { reclamoEnMemoria } from '../reglas/reclamo_en_memoria.fixture';

// ═══════════════════════════════════════════════════════════════════════════
// E2E AGENTE 13 — MIS REGLAS (español libre → plantilla del catálogo → confirmación humana → vigilante SQL → WhatsApp).
//
// Cadena REAL: interpretar (modelo DOBLE por OpenRouter) / interpretarAMano → crearReglaPendiente → confirmarRegla
// (única puerta de activación) → vigilarReglas → lectores SQL reales (gasto) → sellos → selector de envío real
// (texto o plantilla regla_aviso_v1 según la ventana). DOBLES: base en memoria, OpenRouter, contactos, Meta. Sintético.
// ═══════════════════════════════════════════════════════════════════════════

let db: DbMemoria;
const reclamo = reclamoEnMemoria(() => (db.tablas.regla_disparo ??= []));
const jefes: Record<string, string | null> = {};
const dineros: Record<string, string | null> = {};
const generateStructured = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/llm/openrouter', () => ({ generateStructured }));
vi.mock('@/lib/llm/budget', () => ({ createLlmBudget: () => ({ tenantId: 't', runId: 'r', maxRunUsd: 0.5, maxTenantDailyUsd: 5, reservadoRunUsd: 0 }), LlmBudgetExceededError: class extends Error {} }));
vi.mock('../bitacora_escritura', () => ({ anotarBitacora: vi.fn(async () => {}) }));
vi.mock('../contactos', () => ({ telefonoJefeDe: async (t: string) => jefes[t] ?? null, telefonoParaDineroDe: async (t: string) => dineros[t] ?? null }));
vi.mock('@/lib/meta/client', async (original) => {
  const real = await original<Record<string, unknown>>();
  const { meta } = await import('../conductor/meta.fixture');
  return { ...real, enviarTexto: (...a: Parameters<typeof meta.enviarTexto>) => meta.enviarTexto(...a), enviarBotones: (...a: Parameters<typeof meta.enviarBotones>) => meta.enviarBotones(...a), sendTemplate: (...a: Parameters<typeof meta.sendTemplate>) => meta.sendTemplate(...a) };
});
vi.mock('../wa_ventana', async (original) => {
  const real = await original<typeof import('../wa_ventana')>();
  const { meta } = await import('../conductor/meta.fixture');
  return { ...real, ventanaDeContacto: async (tel: string, ahora: Date = new Date()) => real.estadoDeVentana(meta.ultimoEntrante.get(real.normalizarTelefonoWa(tel)) ?? null, ahora), registrarDecisionEnvio: async () => {} };
});

const { interpretar, interpretarAMano } = await import('../reglas/traductor');
const { crearReglaPendiente, confirmarRegla, alternarPausa, borrarRegla, listarReglas, TOPE_REGLAS_POR_FLOTA } = await import('../reglas/repo');
const { vigilarReglas } = await import('../reglas/vigilante');
const { meta } = await import('../conductor/meta.fixture');

const A = 't-a'; const B = 't-b';
const AHORA = new Date('2026-10-02T18:00:00.000Z');
const TEL_DINERO_A = '5219990000001'; const TEL_JEFE_A = '5219990000002'; const TEL_DINERO_B = '5219990000011';
const ACTOR = { id: 'user-1', email: 'dueno@ejemplo.invalid' };

const modelo = (parcial: Record<string, unknown>) => ({ data: { plantilla: 'ninguna', documento: null, concepto: null, monto: null, dias: null, horas: null, n: null, usd: null, ...parcial }, raw: '{}', model: 'modelo-doble', tokensIn: 100, tokensOut: 20, cost: 0.0001 });
const gasto = (id: string, tenant: string, monto: number, extra: Record<string, unknown> = {}) => ({ id, tenant_id: tenant, viaje_id: `viaje-${id}-xxxxxxxx`, concepto: 'caseta', monto, fecha: '2026-10-02', folio: `T-${id}`, cfdi_uuid: null, created_at: '2026-10-02T15:00:00.000Z', ...extra });

/** Declara y confirma «gasto de caseta > $3,000» para una flota con el camino completo, devolviendo el id de la regla. */
async function declararYConfirmar(tenant: string, texto = 'avísame si un gasto de caseta pasa de $3,000') {
  generateStructured.mockResolvedValueOnce(modelo({ plantilla: 'gasto_de_concepto_mayor_a', concepto: 'caseta', monto: 3000 }));
  const i = await interpretar(texto, { tenantId: tenant, rol: 'flota_admin' });
  if (!i.ok) throw new Error(i.motivo);
  const r = await crearReglaPendiente(tenant, { plantilla: i.plantilla, params: i.params, textoOriginal: texto, frase: i.frase, modelo: i.modelo, costoUsd: i.costoUsd }, ACTOR.id);
  if (!r.ok) throw new Error(r.error);
  const c = await confirmarRegla(tenant, r.valor.id, ACTOR);
  if (!c.ok) throw new Error(c.error);
  return r.valor;
}
const mensajesA = (tel: string) => meta.salientes.filter((s) => s.a === tel);

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.likida.ai';
  meta.reiniciar(); meta.estado.reloj = AHORA; generateStructured.mockReset();
  jefes[A] = TEL_JEFE_A; dineros[A] = TEL_DINERO_A; dineros[B] = TEL_DINERO_B; jefes[B] = null;
  for (const t of [TEL_DINERO_A, TEL_JEFE_A, TEL_DINERO_B]) meta.entrante(t, new Date(AHORA.getTime() - 3_600_000));
  db = crearDbMemoria(
    { regla_vigilancia: [], regla_disparo: [], gasto: [gasto('g1', A, 3500), gasto('g2', A, 1000), gasto('g3', B, 9000)] },
    // Las tres RPC del reclamo (0660) sobre las mismas filas de `regla_disparo`.
    {
      reclamar_disparos_regla: (a) => reclamo.reclamar(a),
      confirmar_disparos_regla: (a) => reclamo.confirmar(a) as unknown as boolean,
      liberar_disparos_regla: (a) => reclamo.liberar(a) as unknown as boolean,
    },
    { regla_vigilancia: [['tenant_id', 'plantilla', 'params']], regla_disparo: [['regla_id', 'objeto', 'objeto_id', 'clave']] },
    { regla_vigilancia: { confirmada_en: null, ultima_corrida_en: null, ultimo_disparo_en: null } },
  );
});

describe('feliz', () => {
  it('español libre → regla pendiente (no vigila) → confirmación humana → el vigilante avisa con la evidencia citada y sella', async () => {
    generateStructured.mockResolvedValueOnce(modelo({ plantilla: 'gasto_de_concepto_mayor_a', concepto: 'caseta', monto: 3000 }));
    const i = await interpretar('avísame si un gasto de caseta pasa de $3,000', { tenantId: A, rol: 'flota_admin' });
    expect(i).toMatchObject({ ok: true, plantilla: 'gasto_de_concepto_mayor_a' });
    const r = await crearReglaPendiente(A, { plantilla: (i as unknown as { plantilla: never }).plantilla, params: (i as unknown as { params: never }).params, textoOriginal: 'x', frase: (i as unknown as { frase: string }).frase, modelo: 'm', costoUsd: 0.0001 }, ACTOR.id);
    expect(r).toMatchObject({ ok: true, valor: { estado: 'pendiente' } });

    // Pendiente: el vigilante NO la corre.
    expect(await vigilarReglas(AHORA)).toMatchObject({ reglas: 0, avisos: 0 });
    expect(meta.salientes).toHaveLength(0);

    await confirmarRegla(A, (r as { valor: { id: string } }).valor.id, ACTOR);
    expect(await vigilarReglas(AHORA)).toMatchObject({ reglas: 1, disparadas: 1, avisos: 1, fallos: 0 });
    const m = mensajesA(TEL_DINERO_A);
    expect(m).toHaveLength(1);
    expect(m[0].cuerpo).toMatch(/Tu regla:/);
    expect(m[0].cuerpo).toMatch(/\$3,500\.00 de casetas/);   // cifra medida de la fila, no redactada
    expect(m[0].cuerpo).not.toMatch(/\$1,000/);              // el gasto bajo el tope no sale
    expect(db.tablas.regla_disparo).toHaveLength(1);
  });

  it('camino SIN modelo: elegir la vigilancia a mano también produce una regla válida', () => {
    expect(interpretarAMano('gasto_de_concepto_mayor_a', { concepto: 'caseta', monto: 3000 }, 'flota_admin')).toMatchObject({ ok: true, modelo: null, costoUsd: 0 });
  });
});

describe('fallo', () => {
  it('el modelo no entiende («ninguna») o inventa una plantilla fuera del catálogo: no nace ninguna regla y se dice qué SÍ se puede vigilar', async () => {
    generateStructured.mockResolvedValueOnce(modelo({ plantilla: 'ninguna' }));
    const i = await interpretar('avísame si el clima está feo en Monterrey', { tenantId: A, rol: 'flota_admin' });
    expect(i).toMatchObject({ ok: false });
    expect((i as { puedoVigilar: string[] }).puedoVigilar.length).toBeGreaterThan(3);
    expect(db.tablas.regla_vigilancia).toHaveLength(0);
  });

  it('el proveedor del modelo cae: falla POR VALOR con salida a mano, no lanza', async () => {
    generateStructured.mockRejectedValueOnce(new Error('OpenRouter 503'));
    expect(await interpretar('avísame si un gasto de caseta pasa de $3,000', { tenantId: A, rol: 'flota_admin' })).toMatchObject({ ok: false, motivo: expect.stringMatching(/a mano/) });
  });

  it('el WhatsApp NO sale (plantilla sin aprobar con ventana cerrada): NO se sella y la siguiente corrida lo reintenta y lo entrega', async () => {
    await declararYConfirmar(A);
    meta.ultimoEntrante.clear(); meta.estado.aprobadas = new Set();
    expect(await vigilarReglas(AHORA)).toMatchObject({ fallos: 1, avisos: 0 });
    expect(db.tablas.regla_disparo).toHaveLength(0);
    meta.estado.aprobadas = null;
    expect(await vigilarReglas(new Date(AHORA.getTime() + 3_600_000))).toMatchObject({ avisos: 1 });
    expect(meta.salientes.at(-1)).toMatchObject({ tipo: 'plantilla', plantilla: 'regla_aviso_v1' });
  });

  it('la flota no tiene teléfono para ese canal: falla con motivo, sin sellar (cuando lo capture, el aviso sale)', async () => {
    await declararYConfirmar(A);
    dineros[A] = null;
    expect(await vigilarReglas(AHORA)).toMatchObject({ fallos: 1 });
    expect(db.tablas.regla_disparo).toHaveLength(0);
    dineros[A] = TEL_DINERO_A;
    expect(await vigilarReglas(AHORA)).toMatchObject({ avisos: 1 });
  });

  it('un barrido ciego LANZA (no se reporta como calma): base caída al leer las reglas activas', async () => {
    db.fallar('regla_vigilancia.select', 'PostgREST 503');
    await expect(vigilarReglas(AHORA)).rejects.toThrow(/reglasActivas/);
  });

  it('una regla rota (lector falla) no deja sin vigilancia a las demás: la de la flota B sigue avisando', async () => {
    await declararYConfirmar(A);
    await declararYConfirmar(B);
    db.fallar('gasto.select', 'tabla caída', (f) => f.some(([c, o, v]) => c === 'tenant_id' && o === 'eq' && v === A)); // solo la regla de A se rompe
    const r = await vigilarReglas(AHORA);
    expect(r).toMatchObject({ reglas: 2, fallos: 1, avisos: 1 });
    expect(mensajesA(TEL_DINERO_A)).toHaveLength(0);
    expect(mensajesA(TEL_DINERO_B)).toHaveLength(1);
    expect(mensajesA(TEL_DINERO_B)[0].cuerpo).toMatch(/\$9,000\.00/);
  });

  it('si TODOS los lectores fallan, se cuentan los fallos y el barrido no lanza ni avisa', async () => {
    await declararYConfirmar(A);
    await declararYConfirmar(B);
    db.fallar('gasto.select', 'tabla caída');
    const r = await vigilarReglas(AHORA);
    expect(r).toMatchObject({ reglas: 2, fallos: 2 });
    expect(meta.salientes).toHaveLength(0);
  });
});

describe('duplicado', () => {
  it('el cron cada hora no repite un caso ya avisado; un caso NUEVO sí suena (solo ese)', async () => {
    await declararYConfirmar(A);
    await vigilarReglas(AHORA);
    await vigilarReglas(new Date(AHORA.getTime() + 3_600_000));
    expect(mensajesA(TEL_DINERO_A)).toHaveLength(1);
    db.tablas.gasto.push(gasto('g4', A, 4200, { created_at: '2026-10-02T19:00:00.000Z' }));
    await vigilarReglas(new Date(AHORA.getTime() + 7_200_000));
    expect(mensajesA(TEL_DINERO_A)).toHaveLength(2);
    expect(mensajesA(TEL_DINERO_A)[1].cuerpo).toMatch(/\$4,200\.00/);
    expect(mensajesA(TEL_DINERO_A)[1].cuerpo).not.toMatch(/\$3,500\.00/);
  });

  it('declarar DOS veces la misma vigilancia con los mismos números se rechaza (índice único), y confirmar dos veces no re-firma', async () => {
    const r1 = await declararYConfirmar(A);
    generateStructured.mockResolvedValueOnce(modelo({ plantilla: 'gasto_de_concepto_mayor_a', concepto: 'caseta', monto: 3000 }));
    const i = await interpretar('otra vez lo mismo de casetas de 3000', { tenantId: A, rol: 'flota_admin' });
    const dup = await crearReglaPendiente(A, { plantilla: (i as unknown as { plantilla: never }).plantilla, params: (i as unknown as { params: never }).params, textoOriginal: 'x', frase: 'f', modelo: null, costoUsd: 0 }, ACTOR.id);
    expect(dup).toMatchObject({ ok: false, error: expect.stringMatching(/ya está declarada/) });
    expect(await confirmarRegla(A, r1.id, ACTOR)).toMatchObject({ ok: false, error: expect.stringMatching(/ya no está esperando/) });
  });

  it('dos corridas SOLAPADAS no rompen: el sello es idempotente aunque el aviso se duplique, y quedan los mismos sellos', async () => {
    await declararYConfirmar(A);
    await Promise.all([vigilarReglas(AHORA), vigilarReglas(AHORA)]);
    expect(db.tablas.regla_disparo).toHaveLength(1);
  });
});

describe('fuera de orden', () => {
  it('una regla PAUSADA deja de barrerse y al reanudarla sigue sin repetir lo ya sellado; una BORRADA no vuelve a sonar', async () => {
    const r = await declararYConfirmar(A);
    await vigilarReglas(AHORA);
    await alternarPausa(A, r.id, true, ACTOR);
    db.tablas.gasto.push(gasto('g5', A, 8000, { created_at: '2026-10-02T19:00:00.000Z' }));
    expect(await vigilarReglas(new Date(AHORA.getTime() + 3_600_000))).toMatchObject({ reglas: 0 });
    await alternarPausa(A, r.id, false, ACTOR);
    await vigilarReglas(new Date(AHORA.getTime() + 7_200_000));
    expect(mensajesA(TEL_DINERO_A).at(-1)!.cuerpo).toMatch(/\$8,000\.00/);
    expect(mensajesA(TEL_DINERO_A).at(-1)!.cuerpo).not.toMatch(/\$3,500\.00/);
    await borrarRegla(A, r.id, ACTOR);
    expect(await vigilarReglas(new Date(AHORA.getTime() + 10_800_000))).toMatchObject({ reglas: 0 });
  });

  it('un gasto ANTERIOR a la declaración (fuera de la ventana de arranque) no vomita el histórico en el primer aviso', async () => {
    db.tablas.gasto.push(gasto('g0', A, 7000, { created_at: '2026-08-01T10:00:00.000Z' }));
    await declararYConfirmar(A);
    await vigilarReglas(AHORA);
    expect(mensajesA(TEL_DINERO_A)[0].cuerpo).not.toMatch(/\$7,000/);
  });

  it('el tope por flota (30 reglas) se respeta aunque se declaren de seguidilla', async () => {
    for (let n = 1; n <= TOPE_REGLAS_POR_FLOTA; n++) {
      const r = await crearReglaPendiente(A, { plantilla: 'gasto_de_concepto_mayor_a', params: { concepto: 'caseta', monto: 1000 + n } as never, textoOriginal: 'x', frase: 'f', modelo: null, costoUsd: 0 }, null);
      expect(r.ok).toBe(true);
    }
    const de_mas = await crearReglaPendiente(A, { plantilla: 'gasto_de_concepto_mayor_a', params: { concepto: 'caseta', monto: 99999 } as never, textoOriginal: 'x', frase: 'f', modelo: null, costoUsd: 0 }, null);
    expect(de_mas).toMatchObject({ ok: false, error: expect.stringMatching(/tope/) });
  });
});

describe('otro tenant', () => {
  it('cada flota vigila SUS gastos y avisa a SU teléfono: el gasto de 9,000 de la B no suena en la A ni al revés', async () => {
    await declararYConfirmar(A); await declararYConfirmar(B);
    await vigilarReglas(AHORA);
    expect(mensajesA(TEL_DINERO_A)[0].cuerpo).toMatch(/\$3,500\.00/);
    expect(mensajesA(TEL_DINERO_A)[0].cuerpo).not.toMatch(/\$9,000/);
    expect(mensajesA(TEL_DINERO_B)[0].cuerpo).toMatch(/\$9,000\.00/);
    expect(mensajesA(TEL_DINERO_B)[0].cuerpo).not.toMatch(/\$3,500/);
  });

  it('la flota B no puede confirmar, pausar ni borrar la regla de la A', async () => {
    const r = await declararYConfirmar(A);
    expect(await alternarPausa(B, r.id, true, ACTOR)).toMatchObject({ ok: false });
    expect(await borrarRegla(B, r.id, ACTOR)).toMatchObject({ ok: false });
    expect((await listarReglas(B))).toHaveLength(0);
    expect((await listarReglas(A))[0]).toMatchObject({ estado: 'activa' });
  });

  it('la flota B no puede CONFIRMAR una regla pendiente de la A: sigue pendiente y no vigila', async () => {
    generateStructured.mockResolvedValueOnce(modelo({ plantilla: 'gasto_de_concepto_mayor_a', concepto: 'caseta', monto: 3000 }));
    const i = await interpretar('avísame si un gasto de caseta pasa de $3,000', { tenantId: A, rol: 'flota_admin' });
    if (!i.ok) throw new Error(i.motivo);
    const p = await crearReglaPendiente(A, { plantilla: i.plantilla, params: i.params, textoOriginal: 'x', frase: i.frase, modelo: i.modelo, costoUsd: i.costoUsd }, ACTOR.id);
    if (!p.ok) throw new Error(p.error);
    expect(await confirmarRegla(B, p.valor.id, ACTOR)).toMatchObject({ ok: false });
    expect((await listarReglas(A))[0]).toMatchObject({ estado: 'pendiente' });
    expect(await vigilarReglas(AHORA)).toMatchObject({ reglas: 0 });
    expect(meta.salientes).toHaveLength(0);
  });

  it('la misma vigilancia con los mismos parámetros en dos flotas son dos reglas independientes', async () => {
    await declararYConfirmar(A); await declararYConfirmar(B);
    expect(db.tablas.regla_vigilancia).toHaveLength(2);
  });
});

describe('plantilla de respaldo en «Mis reglas» y reglas de otros agentes (Ola 3)', () => {
  it.todo('INTEGRACIÓN PENDIENTE (w3-buzon-cobranza-reglas): el respaldo por plantilla de «Mis reglas» se declara y se prueba desde la pantalla (hoy el selector ya cae a regla_aviso_v1 fuera de ventana; falta la vista de «cuál plantilla usé»)');
});
