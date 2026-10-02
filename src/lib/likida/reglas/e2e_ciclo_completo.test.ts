import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearBaseEnMemoria, type BaseEnMemoria } from '@/lib/pruebas/tablas_en_memoria.fixture';

// ═══════════════════════════════════════════════════════════════════════════
// «MIS REGLAS» (Agente 13) — PRUEBA E2E DEL CICLO COMPLETO, con dobles SOLO de
// los proveedores (modelo, WhatsApp/Meta, registro de ventana) y de la base en
// memoria. Todo lo demás es el código REAL, de punta a punta:
//
//   frase → interpretar (traductor) → crearReglaPendiente → [pendiente: NO vigila]
//   → confirmarRegla (humano) → vigilarReglas → lector REAL (gasto) → frecuencia
//   → enviarConFallback REAL (texto o plantilla regla_aviso_v1) → sello +
//   historial de avisos + bitácora de la regla.
//
// Cubre: feliz, fallo del proveedor, duplicado, fuera de ventana de 24 h /
// fuera de orden (confirmar dos veces, pausar), otro tenant, y el límite de
// frecuencia por regla. Lo que un doble en memoria NO puede probar (los CHECK,
// RLS y la FK compuesta) lo prueba supabase/tests/0520_reglas_frecuencia.sql
// contra Postgres real.
// ═══════════════════════════════════════════════════════════════════════════

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const DUENO_A = { id: 'u-a', rol: 'flota_admin' };

const estado = vi.hoisted(() => ({ db: null as unknown as BaseEnMemoria }));
const generateStructured = vi.hoisted(() => vi.fn());
const ventana = vi.hoisted(() => ({ estado: 'cerrada' as 'abierta' | 'cerrada' | 'desconocida' }));
const meta = vi.hoisted(() => ({
  enviarTexto: vi.fn(), enviarBotones: vi.fn(), sendTemplate: vi.fn(),
}));
const decisiones = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const bitacora = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const telefonos = vi.hoisted(() => new Map<string, string | null>());

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => estado.db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/env', () => ({ appUrl: () => 'https://app.likida.ai' }));
vi.mock('@/lib/llm/openrouter', () => ({ generateStructured }));
vi.mock('@/lib/llm/budget', () => ({
  createLlmBudget: () => ({ tenantId: A, runId: 'run', maxRunUsd: 0.5, maxTenantDailyUsd: 5, reservadoRunUsd: 0 }),
  LlmBudgetExceededError: class extends Error {},
}));
vi.mock('../bitacora_escritura', () => ({ anotarBitacora: async (e: Record<string, unknown>) => { bitacora.push(e); return true; } }));
vi.mock('../contactos', () => ({
  telefonoJefeDe: async (t: string) => telefonos.get(`jefe:${t}`) ?? null,
  telefonoParaDineroDe: async (t: string) => telefonos.get(`dinero:${t}`) ?? null,
}));
vi.mock('@/lib/likida/wa_ventana', () => ({
  ventanaDeContacto: async () => ({ estado: ventana.estado }),
  registrarDecisionEnvio: async (d: Record<string, unknown>) => { decisiones.push(d); },
}));
vi.mock('@/lib/meta/client', () => ({
  enviarTexto: (...a: unknown[]) => meta.enviarTexto(...a),
  enviarBotones: (...a: unknown[]) => meta.enviarBotones(...a),
  sendTemplate: (...a: unknown[]) => meta.sendTemplate(...a),
  esReintentableMeta: (codigo?: number, status?: number) => codigo === 130429 || status === 429,
  motivoDeFalloWhatsApp: (error: string) => error,
}));

const { interpretar } = await import('./traductor');
const repo = await import('./repo');
const { vigilarReglas } = await import('./vigilante');

const T0 = new Date('2026-10-02T15:00:00Z');
const despues = (horas: number) => new Date(T0.getTime() + horas * 3_600_000);

function gasto(tenant: string, id: string, monto: number, extra: Record<string, unknown> = {}) {
  return {
    id, tenant_id: tenant, viaje_id: `viaje-${id}-xxxxxxxx`, concepto: 'caseta', monto,
    fecha: '2026-10-02', folio: `F-${id}`, cfdi_uuid: null, created_at: T0.toISOString(), ...extra,
  };
}

function nuevaBase(extra: Record<string, Array<Record<string, unknown>>> = {}) {
  estado.db = crearBaseEnMemoria(
    { gasto: [], regla_vigilancia: [], regla_disparo: [], regla_aviso: [], ...extra },
    [
      // El índice parcial de la 0229 (misma vigilancia viva dos veces).
      { tabla: 'regla_vigilancia', nombre: 'regla_vigilancia_unica', columnas: ['tenant_id', 'plantilla', 'params'] },
    ],
    { regla_vigilancia: { max_avisos_dia: 4, min_horas_entre_avisos: 1, ultima_corrida_en: null, ultimo_disparo_en: null } },
  );
}

/** Declara una regla por el camino REAL de la pantalla: interpretar + guardar pendiente. */
async function declarar(tenant: string, frase = 'avísame si un gasto de caseta pasa de $3,000') {
  generateStructured.mockResolvedValue({
    data: { plantilla: 'gasto_de_concepto_mayor_a', documento: null, concepto: 'caseta', monto: 3000, dias: null, horas: null, n: null, usd: null },
    raw: '{}', model: 'modelo-falso', tokensIn: 100, tokensOut: 20, cost: 0.0001,
  });
  const lectura = await interpretar(frase, { tenantId: tenant, rol: 'flota_admin' });
  if (!lectura.ok) throw new Error(`no se interpretó: ${lectura.motivo}`);
  const guardada = await repo.crearReglaPendiente(tenant, {
    plantilla: lectura.plantilla, params: lectura.params, textoOriginal: frase,
    frase: lectura.frase, modelo: lectura.modelo, costoUsd: lectura.costoUsd,
  }, DUENO_A.id);
  return { lectura, guardada };
}

const OK_META = { ok: true, id: 'wamid.OK' };

beforeEach(() => {
  nuevaBase();
  generateStructured.mockReset();
  ventana.estado = 'cerrada';
  meta.enviarTexto.mockReset().mockResolvedValue(OK_META);
  meta.enviarBotones.mockReset().mockResolvedValue(OK_META);
  meta.sendTemplate.mockReset().mockResolvedValue(OK_META);
  decisiones.length = 0; bitacora.length = 0; telefonos.clear();
  telefonos.set(`dinero:${A}`, '5210000000001');
  telefonos.set(`dinero:${B}`, '5210000000002');
});

describe('el ciclo feliz, de la frase al historial', () => {
  it('escribe → queda PENDIENTE y no vigila → un humano confirma → avisa por plantilla (ventana cerrada) → sella y deja historial', async () => {
    nuevaBase({ gasto: [gasto(A, 'g1', 4000)] });
    const { guardada } = await declarar(A);
    expect(guardada.ok).toBe(true);
    if (!guardada.ok) return;
    const regla = guardada.valor;
    expect(regla.estado).toBe('pendiente');

    // 1. PENDIENTE no vigila: el barrido ni la lee, aunque haya un gasto que la dispararía.
    const sinConfirmar = await vigilarReglas(T0);
    expect(sinConfirmar).toMatchObject({ reglas: 0, avisos: 0 });
    expect(meta.sendTemplate).not.toHaveBeenCalled();
    expect(meta.enviarTexto).not.toHaveBeenCalled();

    // 2. La confirmación humana la enciende y deja autor en la bitácora.
    const conf = await repo.confirmarRegla(A, regla.id, DUENO_A);
    expect(conf).toEqual({ ok: true, valor: 'confirmada' });
    const fila = estado.db.tabla('regla_vigilancia')[0];
    expect(fila.estado).toBe('activa');
    expect(fila.confirmada_por).toBe(DUENO_A.id);
    expect(fila.confirmada_en).toBeTruthy();
    expect(bitacora).toContainEqual(expect.objectContaining({ accion: 'regla.confirmada', entidadId: regla.id }));

    // 3. El barrido la corre: ventana de 24 h CERRADA → plantilla regla_aviso_v1, nunca texto libre.
    const r = await vigilarReglas(T0);
    expect(r).toMatchObject({ reglas: 1, disparadas: 1, avisos: 1, fallos: 0, diferidas: 0 });
    expect(meta.enviarTexto).not.toHaveBeenCalled();
    expect(meta.sendTemplate).toHaveBeenCalledTimes(1);
    const [telefono, nombre, opciones] = meta.sendTemplate.mock.calls[0] as [string, string, { parametros: string[] }];
    expect(telefono).toBe('5210000000001');
    expect(nombre).toBe('regla_aviso_v1');
    expect(opciones.parametros[0]).toBe('1');
    expect(opciones.parametros[1]).toContain('$3,000');
    expect(opciones.parametros[2]).toBe('https://app.likida.ai/dashboard/reglas');

    // 4. Sello + historial + bitácora de operación.
    expect(estado.db.tabla('regla_disparo')).toHaveLength(1);
    expect(estado.db.tabla('regla_disparo')[0]).toMatchObject({ tenant_id: A, regla_id: regla.id, objeto: 'gasto', objeto_id: 'g1' });
    expect(estado.db.tabla('regla_aviso')).toHaveLength(1);
    expect(estado.db.tabla('regla_aviso')[0]).toMatchObject({
      tenant_id: A, regla_id: regla.id, resultado: 'enviado', casos: 1, via: 'plantilla', motivo: 'ventana_cerrada',
    });
    expect(fila.ultimo_disparo_en).toBe(T0.toISOString());
    expect(decisiones).toContainEqual(expect.objectContaining({ canal: 'plantilla', motivo: 'ventana_cerrada', ok: true }));

    // 5. La pantalla lee el historial y la evidencia.
    const lista = await repo.listarReglas(A);
    expect(lista[0].ultimosAvisos).toEqual([expect.objectContaining({ resultado: 'enviado', via: 'plantilla', casos: 1 })]);
    expect(lista[0].ultimasEvidencias[0].evidencia).toContain('$4,000.00');
  });

  it('con la ventana ABIERTA el aviso sale como TEXTO con la frase y la evidencia, sin plantilla', async () => {
    nuevaBase({ gasto: [gasto(A, 'g1', 4000)] });
    ventana.estado = 'abierta';
    const { guardada } = await declarar(A);
    if (!guardada.ok) throw new Error('no se guardó');
    await repo.confirmarRegla(A, guardada.valor.id, DUENO_A);
    await vigilarReglas(T0);
    expect(meta.sendTemplate).not.toHaveBeenCalled();
    const texto = meta.enviarTexto.mock.calls[0][1] as string;
    expect(texto).toContain('Tu regla:');
    expect(texto).toContain('$4,000.00');
    expect(estado.db.tabla('regla_aviso')[0]).toMatchObject({ via: 'texto', motivo: 'ventana_abierta' });
  });
});

describe('duplicado y fuera de orden', () => {
  it('la misma vigilancia declarada dos veces se rechaza con mensaje propio', async () => {
    await declarar(A);
    const otra = await declarar(A);
    expect(otra.guardada).toEqual({ ok: false, error: 'Esa misma vigilancia ya está declarada, con esos mismos números.' });
    expect(estado.db.tabla('regla_vigilancia')).toHaveLength(1);
  });

  it('confirmar dos veces (doble clic o POST repetido) no re-firma: la segunda dice que ya no espera', async () => {
    const { guardada } = await declarar(A);
    if (!guardada.ok) throw new Error('x');
    const [uno, dos] = await Promise.all([
      repo.confirmarRegla(A, guardada.valor.id, DUENO_A),
      repo.confirmarRegla(A, guardada.valor.id, { id: 'u-otro' }),
    ]);
    expect([uno.ok, dos.ok].sort()).toEqual([false, true]);
    // Quien ganó dejó su firma; el segundo no la pisó.
    expect(['u-a', 'u-otro']).toContain(estado.db.tabla('regla_vigilancia')[0].confirmada_por);
    expect(bitacora.filter((b) => b.accion === 'regla.confirmada')).toHaveLength(1);
  });

  it('el mismo caso no vuelve a sonar en la siguiente corrida; un gasto NUEVO sí', async () => {
    nuevaBase({ gasto: [gasto(A, 'g1', 4000)] });
    const { guardada } = await declarar(A);
    if (!guardada.ok) throw new Error('x');
    await repo.confirmarRegla(A, guardada.valor.id, DUENO_A);
    await vigilarReglas(T0);
    const segunda = await vigilarReglas(despues(2));
    expect(segunda).toMatchObject({ disparadas: 0, avisos: 0 });
    expect(meta.sendTemplate).toHaveBeenCalledTimes(1);

    estado.db.tabla('gasto').push(gasto(A, 'g2', 5200, { created_at: despues(2).toISOString() }));
    const tercera = await vigilarReglas(despues(3));
    expect(tercera).toMatchObject({ disparadas: 1, avisos: 1 });
    expect(meta.sendTemplate).toHaveBeenCalledTimes(2);
  });

  it('pausar la regla la saca del barrido y reanudarla la vuelve a meter, sin re-confirmar', async () => {
    nuevaBase({ gasto: [gasto(A, 'g1', 4000)] });
    const { guardada } = await declarar(A);
    if (!guardada.ok) throw new Error('x');
    const id = guardada.valor.id;
    await repo.confirmarRegla(A, id, DUENO_A);
    expect(await repo.alternarPausa(A, id, true, DUENO_A)).toEqual({ ok: true, valor: 'pausada' });
    expect((await vigilarReglas(T0)).reglas).toBe(0);
    expect(await repo.alternarPausa(A, id, true, DUENO_A)).toMatchObject({ ok: false });
    expect(await repo.alternarPausa(A, id, false, DUENO_A)).toEqual({ ok: true, valor: 'activa' });
    expect((await vigilarReglas(T0)).avisos).toBe(1);
  });
});

describe('fallo del proveedor', () => {
  it('si Meta rechaza, NO se sella, el intento queda como fallido, y al arreglarse el siguiente barrido lo manda', async () => {
    nuevaBase({ gasto: [gasto(A, 'g1', 4000)] });
    const { guardada } = await declarar(A);
    if (!guardada.ok) throw new Error('x');
    await repo.confirmarRegla(A, guardada.valor.id, DUENO_A);

    meta.sendTemplate.mockResolvedValue({ ok: false, error: 'La plantilla no está aprobada', codigo: 132001, status: 400 });
    meta.enviarTexto.mockResolvedValue({ ok: false, error: 'ventana', codigo: 131047, status: 400 });
    const mal = await vigilarReglas(T0);
    expect(mal).toMatchObject({ fallos: 1, avisos: 0, disparadas: 0 });
    expect(estado.db.tabla('regla_disparo')).toHaveLength(0);
    expect(estado.db.tabla('regla_aviso')).toEqual([expect.objectContaining({ resultado: 'fallido', via: null, casos: 1 })]);

    // El fallido NO consume el cupo de frecuencia: la siguiente hora sí puede salir.
    meta.sendTemplate.mockResolvedValue(OK_META);
    const bien = await vigilarReglas(despues(1));
    expect(bien).toMatchObject({ fallos: 0, avisos: 1, disparadas: 1 });
    expect(estado.db.tabla('regla_disparo')).toHaveLength(1);
    expect(estado.db.tabla('regla_aviso').map((a) => a.resultado)).toEqual(['fallido', 'enviado']);
  });

  it('sin teléfono registrado la regla falla por su lado, no sella, y sale cuando lo capturan', async () => {
    nuevaBase({ gasto: [gasto(A, 'g1', 4000)] });
    telefonos.set(`dinero:${A}`, null);
    const { guardada } = await declarar(A);
    if (!guardada.ok) throw new Error('x');
    await repo.confirmarRegla(A, guardada.valor.id, DUENO_A);
    expect((await vigilarReglas(T0)).fallos).toBe(1);
    expect(meta.sendTemplate).not.toHaveBeenCalled();
    telefonos.set(`dinero:${A}`, '5210000000001');
    expect((await vigilarReglas(despues(1))).avisos).toBe(1);
  });

  it('si el modelo no contesta, la interpretación falla con mensaje y NO guarda nada', async () => {
    generateStructured.mockRejectedValue(new Error('proveedor caído'));
    const r = await interpretar('avísame si un gasto de caseta pasa de $3,000', { tenantId: A, rol: 'flota_admin' });
    expect(r.ok).toBe(false);
    expect(estado.db.tabla('regla_vigilancia')).toHaveLength(0);
  });
});

describe('otro tenant', () => {
  it('cada flota ve SOLO sus gastos, avisa a SU teléfono y no confirma ni pausa reglas ajenas', async () => {
    nuevaBase({ gasto: [gasto(A, 'ga', 4000), gasto(B, 'gb', 9000)] });
    const ra = await declarar(A);
    const rb = await declarar(B);
    if (!ra.guardada.ok || !rb.guardada.ok) throw new Error('x');

    // Un usuario de B no puede confirmar la regla de A (anclada por tenant).
    expect(await repo.confirmarRegla(B, ra.guardada.valor.id, { id: 'u-b' })).toMatchObject({ ok: false });
    expect(estado.db.tabla('regla_vigilancia').find((r) => r.id === ra.guardada.valor.id)?.estado).toBe('pendiente');

    await repo.confirmarRegla(A, ra.guardada.valor.id, DUENO_A);
    await repo.confirmarRegla(B, rb.guardada.valor.id, { id: 'u-b' });
    const r = await vigilarReglas(T0);
    expect(r).toMatchObject({ reglas: 2, avisos: 2 });

    const porTelefono = new Map(meta.sendTemplate.mock.calls.map((c) => [c[0] as string, c[2] as { parametros: string[] }]));
    expect(porTelefono.get('5210000000001')?.parametros[0]).toBe('1');
    expect(porTelefono.get('5210000000002')?.parametros[0]).toBe('1');
    const sellos = estado.db.tabla('regla_disparo');
    expect(sellos.find((s) => s.tenant_id === A)?.objeto_id).toBe('ga');
    expect(sellos.find((s) => s.tenant_id === B)?.objeto_id).toBe('gb');

    // El historial y la lista de A no incluyen nada de B.
    expect((await repo.listarReglas(A)).map((x) => x.id)).toEqual([ra.guardada.valor.id]);
    expect(await repo.alternarPausa(B, ra.guardada.valor.id, true, { id: 'u-b' })).toMatchObject({ ok: false });
    expect(await repo.borrarRegla(B, ra.guardada.valor.id, { id: 'u-b' })).toMatchObject({ ok: false });
    expect(await repo.actualizarFrecuencia(B, ra.guardada.valor.id, { maxAvisosDia: 1, minHorasEntreAvisos: 1 }, { id: 'u-b' })).toMatchObject({ ok: false });
  });
});

describe('límite de frecuencia por regla, de punta a punta', () => {
  it('con tope 1 al día el segundo aviso se pospone, NO se pierde, y sale pasadas 24 h', async () => {
    nuevaBase({ gasto: [gasto(A, 'g1', 4000)] });
    const { guardada } = await declarar(A);
    if (!guardada.ok) throw new Error('x');
    const id = guardada.valor.id;
    await repo.confirmarRegla(A, id, DUENO_A);
    expect(await repo.actualizarFrecuencia(A, id, { maxAvisosDia: 1, minHorasEntreAvisos: 0 }, DUENO_A)).toMatchObject({ ok: true });

    expect((await vigilarReglas(T0)).avisos).toBe(1);
    // Llega un gasto nuevo dos horas después: el tope lo detiene.
    estado.db.tabla('gasto').push(gasto(A, 'g2', 5200, { created_at: despues(2).toISOString() }));
    const detenido = await vigilarReglas(despues(2));
    expect(detenido).toMatchObject({ avisos: 0, diferidas: 1, fallos: 0 });
    expect(meta.sendTemplate).toHaveBeenCalledTimes(1);
    expect(estado.db.tabla('regla_disparo')).toHaveLength(1);

    // A las 24 h el cupo se libera y el caso pospuesto sale.
    const liberado = await vigilarReglas(despues(24.5));
    expect(liberado).toMatchObject({ avisos: 1, diferidas: 0 });
    expect(estado.db.tabla('regla_disparo').map((s) => s.objeto_id).sort()).toEqual(['g1', 'g2']);
  });

  it('varios casos acumulados salen en UN solo aviso, no en uno por caso', async () => {
    nuevaBase({ gasto: [gasto(A, 'g1', 4000), gasto(A, 'g2', 5000), gasto(A, 'g3', 6000)] });
    const { guardada } = await declarar(A);
    if (!guardada.ok) throw new Error('x');
    await repo.confirmarRegla(A, guardada.valor.id, DUENO_A);
    const r = await vigilarReglas(T0);
    expect(r).toMatchObject({ disparadas: 1, avisos: 3 });
    expect(meta.sendTemplate).toHaveBeenCalledTimes(1);
    expect((meta.sendTemplate.mock.calls[0][2] as { parametros: string[] }).parametros[0]).toBe('3');
    expect(estado.db.tabla('regla_aviso')).toEqual([expect.objectContaining({ casos: 3 })]);
  });
});
