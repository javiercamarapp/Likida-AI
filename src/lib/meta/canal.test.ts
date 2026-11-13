import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// w34 · canal de WhatsApp por tenant. Sin línea propia el canal es EXACTAMENTE el de hoy (entorno global); con línea activa es el
// del tenant; pausada o con token vencido falla cerrado; un phone_number_id desconocido se descarta; el token cifrado está atado a
// su tenant y número; y el token en claro no aparece en errores ni en logs. Supabase va en memoria; Meta nunca se llama.
// ═══════════════════════════════════════════════════════════════════════════

type Fila = Record<string, unknown>;
const bd = vi.hoisted(() => ({ filas: [] as Fila[], lecturas: 0, falla: null as null | { code?: string; message: string }, siguienteId: 1 }));
const logs = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: logs }));

function constructor(tabla: string) {
  if (tabla !== 'tenant_whatsapp_linea') throw new Error(`tabla inesperada: ${tabla}`);
  const filtros: Array<(f: Fila) => boolean> = [];
  let op: 'select' | 'insert' | 'update' = 'select';
  let valores: Fila = {};
  let unica: 'single' | 'maybe' | null = null;
  let devuelve = false;
  let tope = Infinity;
  const q: Record<string, unknown> = {};
  const ejecutar = (): { data: unknown; error: unknown } => {
    if (bd.falla) return { data: null, error: bd.falla };
    if (op === 'insert') {
      const nueva: Fila = { id: `lin-${bd.siguienteId++}`, estado: 'pendiente', principal: false, etiqueta: null, terminal_id: null, proposito: null, creada_en: new Date().toISOString(), waba_id: null, numero_visible: null, ultimo_error: null, verificada_en: null, ...valores };
      if (bd.filas.some((f) => f.phone_number_id === nueva.phone_number_id)) return { data: null, error: { code: '23505', message: 'duplicado' } };
      if (nueva.principal === true && nueva.estado === 'activa' && bd.filas.some((f) => f.tenant_id === nueva.tenant_id && f.principal === true && f.estado === 'activa')) return { data: null, error: { code: '23505', message: 'una principal' } };
      bd.filas.push(nueva);
      return { data: unica ? nueva : [nueva], error: null };
    }
    const sel = bd.filas.filter((f) => filtros.every((p) => p(f)));
    if (op === 'update') {
      sel.forEach((f) => Object.assign(f, valores));
      return { data: devuelve ? sel.map((f) => ({ id: f.id })) : null, error: null };
    }
    bd.lecturas++;
    const salida = sel.slice(0, tope).map((f) => ({ ...f }));
    if (unica === 'maybe') return { data: salida[0] ?? null, error: null };
    return { data: salida, error: null };
  };
  Object.assign(q, {
    select() { if (op !== 'select') devuelve = true; return q; },
    insert(v: Fila) { op = 'insert'; valores = v; return q; },
    update(v: Fila) { op = 'update'; valores = v; return q; },
    eq(c: string, v: unknown) { filtros.push((f) => f[c] === v); return q; },
    in(c: string, v: unknown[]) { filtros.push((f) => v.includes(f[c])); return q; },
    order() { return q; },
    limit(n: number) { tope = n; return q; },
    maybeSingle() { unica = 'maybe'; return q; },
    single() { unica = 'single'; return q; },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(ejecutar()).then(res, rej); },
  });
  return q;
}
// tenant_whatsapp_linea_hacer_principal: igual que la función SQL (la línea debe estar activa; baja las demás principales del tenant).
function rpc(nombre: string, args: { p_linea_id: string }) {
  if (nombre !== 'tenant_whatsapp_linea_hacer_principal') throw new Error(`rpc inesperada: ${nombre}`);
  const l = bd.filas.find((f) => f.id === args.p_linea_id && f.estado === 'activa');
  if (!l) return Promise.resolve({ data: false, error: null });
  bd.filas.filter((f) => f.tenant_id === l.tenant_id && f.id !== l.id).forEach((f) => { f.principal = false; });
  l.principal = true;
  return Promise.resolve({ data: true, error: null });
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: constructor, rpc }) }));

const repo = await import('./linea_repo');
const canal = await import('./canal');
const { cifrar } = await import('@/lib/likida/conectores/cofre');

const TA = '10000000-0000-4000-8000-00000000000a';
const TB = '20000000-0000-4000-8000-00000000000b';
const TOKEN_A = 'EAAT-token-secreto-del-tenant-A-0001';
const TOKEN_B = 'EAAT-token-secreto-del-tenant-B-0002';
const PN_A = '111111111111111';
const PN_B = '222222222222222';

/** Inserta una fila ya activa, saltándose el alta (que nace pendiente). */
async function darDeAltaActiva(tenantId: string, phoneNumberId: string, token: string): Promise<string> {
  const l = await repo.altaLinea({ tenantId, phoneNumberId, token });
  await repo.cambiarEstadoLinea(l.id, 'activa');
  return l.id;
}
const fila = (id: string) => bd.filas.find((f) => f.id === id) as Fila;

beforeEach(() => {
  process.env.LIKIDA_COFRE_LLAVE = 'una-llave-de-cofre-de-prueba-de-mas-de-32-caracteres';
  process.env.WHATSAPP_ACCESS_TOKEN = 'tok-plataforma-0000000000';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '999999999999999';
  bd.filas = []; bd.lecturas = 0; bd.falla = null; bd.siguienteId = 1;
  Object.values(logs).forEach((f) => f.mockClear());
  repo.invalidarCacheLineas();
});
afterEach(() => { vi.useRealTimers(); });

describe('canalDePlataforma: lo de hoy', () => {
  it('lee el entorno', () => {
    expect(canal.canalDePlataforma()).toEqual({ phoneNumberId: '999999999999999', token: 'tok-plataforma-0000000000', origen: 'plataforma', lineaId: null });
  });
  it('lanza con los mismos mensajes de siempre si falta algo', () => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    expect(() => canal.canalDePlataforma()).toThrow('WHATSAPP_ACCESS_TOKEN no configurado');
    process.env.WHATSAPP_ACCESS_TOKEN = 'x';
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    expect(() => canal.canalDePlataforma()).toThrow('WHATSAPP_PHONE_NUMBER_ID no configurado');
  });
});

describe('resolverCanal: con y sin línea', () => {
  it('sin tenant, o sin línea propia: el canal de la plataforma, idéntico al de hoy', async () => {
    const hoy = canal.canalDePlataforma();
    expect(await canal.resolverCanal()).toEqual(hoy);
    expect(await canal.resolverCanal(null)).toEqual(hoy);
    expect(await canal.resolverCanal(TA)).toEqual(hoy);
  });

  it('línea pendiente (recién dada de alta): el tenant sigue por la plataforma', async () => {
    await repo.altaLinea({ tenantId: TA, phoneNumberId: PN_A, token: TOKEN_A });
    expect(await canal.resolverCanal(TA)).toEqual(canal.canalDePlataforma());
  });

  it('línea activa: número y token del tenant; el otro tenant no se mezcla', async () => {
    const id = await darDeAltaActiva(TA, PN_A, TOKEN_A);
    expect(await canal.resolverCanal(TA)).toEqual({ phoneNumberId: PN_A, token: TOKEN_A, origen: 'tenant', lineaId: id });
    expect(await canal.resolverCanal(TB)).toEqual(canal.canalDePlataforma());
  });

  it('pausada: lanza CanalNoDisponible y NO cae a la plataforma', async () => {
    const id = await darDeAltaActiva(TA, PN_A, TOKEN_A);
    await repo.cambiarEstadoLinea(id, 'pausada');
    const e = await canal.resolverCanal(TA).catch((x) => x);
    expect(e).toBeInstanceOf(canal.CanalNoDisponible);
    expect(e).toMatchObject({ tenantId: TA, motivo: 'pausada' });
  });

  it('con una pausada de historia y otra activa, manda la activa', async () => {
    const vieja = await darDeAltaActiva(TA, PN_A, TOKEN_A);
    await repo.cambiarEstadoLinea(vieja, 'pausada');
    const nueva = await darDeAltaActiva(TA, PN_B, TOKEN_B);
    expect(await canal.resolverCanal(TA)).toMatchObject({ phoneNumberId: PN_B, token: TOKEN_B, lineaId: nueva });
  });

  it('token vencido: lanza CanalNoDisponible(token_vencido); marcarLineaTokenVencido lo provoca desde activa', async () => {
    const id = await darDeAltaActiva(TA, PN_A, TOKEN_A);
    await canal.resolverCanal(TA);
    await canal.marcarLineaTokenVencido(id);
    expect(fila(id).estado).toBe('token_vencido');
    expect(String(fila(id).ultimo_error)).not.toContain(TOKEN_A);
    const e = await canal.resolverCanal(TA).catch((x) => x);
    expect(e).toBeInstanceOf(canal.CanalNoDisponible);
    expect(e.motivo).toBe('token_vencido');
  });

  it('marcarLineaTokenVencido no revive ni pisa una línea pausada, y no lanza con una línea inexistente', async () => {
    const id = await darDeAltaActiva(TA, PN_A, TOKEN_A);
    await repo.cambiarEstadoLinea(id, 'pausada');
    await canal.marcarLineaTokenVencido(id);
    expect(fila(id).estado).toBe('pausada');
    await expect(canal.marcarLineaTokenVencido('no-existe')).resolves.toBeUndefined();
  });

  it('un token que no abre (llave rotada) falla cerrado como sin_token, no cae a la plataforma', async () => {
    const id = await darDeAltaActiva(TA, PN_A, TOKEN_A);
    process.env.LIKIDA_COFRE_LLAVE = 'otra-llave-de-cofre-distinta-de-mas-de-32-caracteres';
    repo.invalidarCacheLineas();
    const e = await canal.resolverCanal(TA).catch((x) => x);
    expect(e).toBeInstanceOf(canal.CanalNoDisponible);
    expect(e.motivo).toBe('sin_token');
    expect(fila(id).estado).toBe('activa');
  });

  it('si la base falla NO cae a la plataforma: lanza', async () => {
    bd.falla = { code: '57014', message: 'canceling statement' };
    await expect(canal.resolverCanal(TA)).rejects.toThrow('No se pudo leer la línea de WhatsApp del tenant');
  });

  it('con la migración sin aplicar (tabla ausente) todo sigue como hoy', async () => {
    bd.falla = { code: '42P01', message: 'relation "tenant_whatsapp_linea" does not exist' };
    expect(await canal.resolverCanal(TA)).toEqual(canal.canalDePlataforma());
    expect(await canal.canalPorPhoneNumberId(PN_A)).toBeNull();
  });
});

describe('canalPorPhoneNumberId: el webhook entrante', () => {
  it('un número desconocido se descarta (null), también el de la plataforma', async () => {
    await darDeAltaActiva(TA, PN_A, TOKEN_A);
    expect(await canal.canalPorPhoneNumberId('333333333333333')).toBeNull();
    expect(await canal.canalPorPhoneNumberId('999999999999999')).toBeNull();
    expect(await canal.canalPorPhoneNumberId('')).toBeNull();
  });

  it('cada número resuelve a SU tenant y a su token, nunca al del otro', async () => {
    const a = await darDeAltaActiva(TA, PN_A, TOKEN_A);
    const b = await darDeAltaActiva(TB, PN_B, TOKEN_B);
    expect(await canal.canalPorPhoneNumberId(PN_A)).toEqual({ tenantId: TA, canal: { phoneNumberId: PN_A, token: TOKEN_A, origen: 'tenant', lineaId: a } });
    expect(await canal.canalPorPhoneNumberId(PN_B)).toEqual({ tenantId: TB, canal: { phoneNumberId: PN_B, token: TOKEN_B, origen: 'tenant', lineaId: b } });
  });

  it('pendiente y pausada se descartan; token_vencido todavía recibe', async () => {
    const id = await darDeAltaActiva(TA, PN_A, TOKEN_A);
    await repo.altaLinea({ tenantId: TB, phoneNumberId: PN_B, token: TOKEN_B });
    expect(await canal.canalPorPhoneNumberId(PN_B)).toBeNull();
    await canal.marcarLineaTokenVencido(id);
    expect((await canal.canalPorPhoneNumberId(PN_A))?.tenantId).toBe(TA);
    await repo.cambiarEstadoLinea(id, 'pausada');
    expect(await canal.canalPorPhoneNumberId(PN_A)).toBeNull();
  });

  it('un token que no abre descarta el mensaje (null) en vez de resolver a otro canal', async () => {
    await darDeAltaActiva(TA, PN_A, TOKEN_A);
    process.env.LIKIDA_COFRE_LLAVE = 'otra-llave-de-cofre-distinta-de-mas-de-32-caracteres';
    repo.invalidarCacheLineas();
    expect(await canal.canalPorPhoneNumberId(PN_A)).toBeNull();
  });
});

describe('caché de 30 s e invalidación', () => {
  it('lee la base una vez dentro de la ventana y otra vez al vencer', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T10:00:00Z'));
    await darDeAltaActiva(TA, PN_A, TOKEN_A);
    repo.invalidarCacheLineas();
    bd.lecturas = 0;
    await canal.canalPorPhoneNumberId(PN_A);
    await canal.canalPorPhoneNumberId(PN_A);
    expect(bd.lecturas).toBe(1);
    vi.setSystemTime(new Date('2026-11-13T10:00:29Z'));
    await canal.canalPorPhoneNumberId(PN_A);
    expect(bd.lecturas).toBe(1);
    vi.setSystemTime(new Date('2026-11-13T10:00:31Z'));
    await canal.canalPorPhoneNumberId(PN_A);
    expect(bd.lecturas).toBe(2);
  });

  it('también se guarda el «no hay», y una línea nueva lo invalida', async () => {
    expect(await canal.canalPorPhoneNumberId(PN_A)).toBeNull();
    bd.lecturas = 0;
    expect(await canal.canalPorPhoneNumberId(PN_A)).toBeNull();
    expect(bd.lecturas).toBe(0);
    await darDeAltaActiva(TA, PN_A, TOKEN_A);
    expect((await canal.canalPorPhoneNumberId(PN_A))?.tenantId).toBe(TA);
  });

  it('un cambio de estado se ve de inmediato en esta instancia; invalidarCanales fuerza la relectura', async () => {
    const id = await darDeAltaActiva(TA, PN_A, TOKEN_A);
    await canal.resolverCanal(TA);
    await repo.cambiarEstadoLinea(id, 'pausada');
    await expect(canal.resolverCanal(TA)).rejects.toBeInstanceOf(canal.CanalNoDisponible);
    // un cambio hecho por otra instancia (fuera del repo) no se ve hasta invalidar
    fila(id).estado = 'activa';
    await expect(canal.resolverCanal(TA)).rejects.toBeInstanceOf(canal.CanalNoDisponible);
    canal.invalidarCanales();
    expect((await canal.resolverCanal(TA)).origen).toBe('tenant');
  });
});

describe('aislamiento del cifrado', () => {
  it('el token guardado es v2 y no contiene el token en claro', async () => {
    await darDeAltaActiva(TA, PN_A, TOKEN_A);
    const guardado = String(bd.filas[0].token_cifrado);
    expect(guardado.startsWith('v2.')).toBe(true);
    expect(guardado).not.toContain(TOKEN_A);
    expect(JSON.stringify(bd.filas[0])).not.toContain(TOKEN_A);
    expect(bd.filas[0].token_pistas).toBe(`…${TOKEN_A.slice(-4)}`);
  });

  it('copiar el cifrado de un tenant a la fila de otro NO abre (AAD cruzado)', async () => {
    await darDeAltaActiva(TA, PN_A, TOKEN_A);
    await darDeAltaActiva(TB, PN_B, TOKEN_B);
    bd.filas[1].token_cifrado = bd.filas[0].token_cifrado;
    repo.invalidarCacheLineas();
    const e = await canal.resolverCanal(TB).catch((x) => x);
    expect(e).toBeInstanceOf(canal.CanalNoDisponible);
    expect(e.motivo).toBe('sin_token');
    expect(await canal.canalPorPhoneNumberId(PN_B)).toBeNull();
  });

  it('cambiar el phone_number_id de la fila (mismo tenant) tampoco abre', async () => {
    await darDeAltaActiva(TA, PN_A, TOKEN_A);
    bd.filas[0].phone_number_id = '444444444444444';
    repo.invalidarCacheLineas();
    await expect(canal.resolverCanal(TA)).rejects.toMatchObject({ motivo: 'sin_token' });
  });

  it('un v1 o un cifrado sin contexto correcto no sirve como token de línea', () => {
    const v2OtroContexto = cifrar({ token: TOKEN_A }, `${TB}:${PN_A}`);
    expect(() => repo.abrirToken({ tenantId: TA, phoneNumberId: PN_A, tokenCifrado: v2OtroContexto })).toThrow('no se pudo abrir');
    const v1 = cifrar({ token: TOKEN_A });
    expect(() => repo.abrirToken({ tenantId: TA, phoneNumberId: PN_A, tokenCifrado: v1 })).not.toThrow(); // v1 abre sin contexto: por eso el CHECK de la base exige v2
  });
});

describe('el token nunca sale en claro', () => {
  it('altaLinea devuelve la línea SIN token cifrado ni en claro', async () => {
    const l = await repo.altaLinea({ tenantId: TA, phoneNumberId: PN_A, token: TOKEN_A });
    expect(l).not.toHaveProperty('tokenCifrado');
    expect(l.estado).toBe('pendiente');
    expect(JSON.stringify(l)).not.toContain(TOKEN_A);
    expect(l.tokenPistas).toBe('…0001');
  });

  it('los errores y los logs no llevan el token ni el cifrado', async () => {
    await darDeAltaActiva(TA, PN_A, TOKEN_A);
    const guardado = String(bd.filas[0].token_cifrado);
    process.env.LIKIDA_COFRE_LLAVE = 'otra-llave-de-cofre-distinta-de-mas-de-32-caracteres';
    repo.invalidarCacheLineas();
    const e = await canal.resolverCanal(TA).catch((x) => x);
    bd.falla = { code: 'XX000', message: `fallo con ${TOKEN_A}` };
    repo.invalidarCacheLineas();
    const e2 = await canal.resolverCanal(TB).catch((x) => x);
    const e3 = await repo.altaLinea({ tenantId: TB, phoneNumberId: PN_B, token: TOKEN_B }).catch((x) => x);
    const volcado = JSON.stringify([e.message, e2.message, e3.message, logs.error.mock.calls, logs.warn.mock.calls, logs.info.mock.calls]);
    for (const secreto of [TOKEN_A, TOKEN_B, guardado]) expect(volcado).not.toContain(secreto);
    expect(logs.error).toHaveBeenCalled();
  });

  it('altaLinea rechaza lo inválido y el número de la plataforma como línea de tenant', async () => {
    await expect(repo.altaLinea({ tenantId: TA, phoneNumberId: 'abc', token: TOKEN_A })).rejects.toThrow('phone_number_id inválido');
    await expect(repo.altaLinea({ tenantId: TA, phoneNumberId: PN_A, token: 'corto' })).rejects.toThrow('Token inválido');
    await expect(repo.altaLinea({ tenantId: TA, phoneNumberId: '999999999999999', token: TOKEN_A })).rejects.toThrow('plataforma');
    expect(bd.filas).toHaveLength(0);
  });

  it('un número no se registra para dos tenants; un tenant SÍ puede tener varias líneas', async () => {
    await repo.altaLinea({ tenantId: TA, phoneNumberId: PN_A, token: TOKEN_A });
    await expect(repo.altaLinea({ tenantId: TB, phoneNumberId: PN_A, token: TOKEN_B })).rejects.toThrow('ya tiene una línea');
    await expect(repo.altaLinea({ tenantId: TA, phoneNumberId: PN_B, token: TOKEN_B })).resolves.toMatchObject({ tenantId: TA, phoneNumberId: PN_B });
    expect(bd.filas).toHaveLength(2);
  });

  it('ultimo_error se recorta y activar marca verificada_en', async () => {
    const l = await repo.altaLinea({ tenantId: TA, phoneNumberId: PN_A, token: TOKEN_A });
    await repo.cambiarEstadoLinea(l.id, 'pendiente', 'x'.repeat(1000));
    expect(String(fila(l.id).ultimo_error)).toHaveLength(300);
    await repo.cambiarEstadoLinea(l.id, 'activa');
    expect(fila(l.id).verificada_en).toBeTruthy();
    expect(fila(l.id).ultimo_error).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VARIAS LÍNEAS POR CLIENTE: principal, por terminal, por propósito, ambigua.
// ─────────────────────────────────────────────────────────────────────────────
const PN_C = '333333333333333';
const TERMINAL_1 = '30000000-0000-4000-8000-000000000001';
const TERMINAL_2 = '30000000-0000-4000-8000-000000000002';

async function altaActiva(tenantId: string, phoneNumberId: string, token: string, extra: { terminalId?: string; proposito?: 'servicio_cliente' | 'operadores' | 'oficina' | 'general'; etiqueta?: string } = {}): Promise<string> {
  const l = await repo.altaLinea({ tenantId, phoneNumberId, token, ...extra });
  await repo.cambiarEstadoLinea(l.id, 'activa');
  return l.id;
}

describe('varias líneas por cliente', () => {
  it('el alta guarda etiqueta, terminal, propósito y principal; el token sigue sin salir', async () => {
    const l = await repo.altaLinea({ tenantId: TA, phoneNumberId: PN_A, token: TOKEN_A, etiqueta: '  Servicio al cliente ', terminalId: TERMINAL_1, proposito: 'servicio_cliente', principal: true });
    expect(l).toMatchObject({ etiqueta: 'Servicio al cliente', terminalId: TERMINAL_1, proposito: 'servicio_cliente', principal: true, estado: 'pendiente' });
    expect(l).not.toHaveProperty('tokenCifrado');
    await expect(repo.altaLinea({ tenantId: TA, phoneNumberId: PN_B, token: TOKEN_B, proposito: 'marketing' as never })).rejects.toThrow('Propósito de línea inválido');
  });

  it('sin opts: la principal activa manda aunque haya más activas', async () => {
    await altaActiva(TA, PN_A, TOKEN_A);
    const p = await altaActiva(TA, PN_B, TOKEN_B);
    await altaActiva(TA, PN_C, 'EAAT-token-secreto-del-tenant-A-0003');
    expect(await repo.hacerLineaPrincipal(p)).toBe(true);
    expect(await canal.resolverCanal(TA)).toMatchObject({ phoneNumberId: PN_B, token: TOKEN_B, lineaId: p });
  });

  it('sin principal y con UNA sola activa: esa (las pendientes y pausadas no cuentan)', async () => {
    const pausada = await altaActiva(TA, PN_A, TOKEN_A);
    await repo.cambiarEstadoLinea(pausada, 'pausada');
    await repo.altaLinea({ tenantId: TA, phoneNumberId: PN_C, token: 'EAAT-token-secreto-del-tenant-A-0003' });
    const viva = await altaActiva(TA, PN_B, TOKEN_B);
    expect(await canal.resolverCanal(TA)).toMatchObject({ phoneNumberId: PN_B, lineaId: viva });
  });

  it('varias activas, sin principal y sin criterio: ambigua, y NO cae a la plataforma ni elige al azar', async () => {
    await altaActiva(TA, PN_A, TOKEN_A);
    await altaActiva(TA, PN_B, TOKEN_B);
    const e = await canal.resolverCanal(TA).catch((x) => x);
    expect(e).toBeInstanceOf(canal.CanalNoDisponible);
    expect(e).toMatchObject({ tenantId: TA, motivo: 'ambigua' });
    // otro tenant sin líneas no se ve afectado
    expect(await canal.resolverCanal(TB)).toEqual(canal.canalDePlataforma());
  });

  it('por línea, por terminal y por propósito: elige la activa que coincide (opts manda sobre la principal)', async () => {
    const serv = await altaActiva(TA, PN_A, TOKEN_A, { proposito: 'servicio_cliente' });
    const op1 = await altaActiva(TA, PN_B, TOKEN_B, { proposito: 'operadores', terminalId: TERMINAL_1 });
    const op2 = await altaActiva(TA, PN_C, 'EAAT-token-secreto-del-tenant-A-0003', { proposito: 'operadores', terminalId: TERMINAL_2 });
    await repo.hacerLineaPrincipal(serv);
    expect((await canal.resolverCanal(TA)).lineaId).toBe(serv);
    expect((await canal.resolverCanal(TA, { lineaId: op2 })).lineaId).toBe(op2);
    expect((await canal.resolverCanal(TA, { terminalId: TERMINAL_1 })).lineaId).toBe(op1);
    expect((await canal.resolverCanal(TA, { proposito: 'servicio_cliente' })).lineaId).toBe(serv);
    expect((await canal.resolverCanal(TA, { proposito: 'operadores', terminalId: TERMINAL_2 })).lineaId).toBe(op2);
    // dos activas que coinciden y ninguna principal entre ellas: ambigua
    await expect(canal.resolverCanal(TA, { proposito: 'operadores' })).rejects.toMatchObject({ motivo: 'ambigua' });
  });

  it('opts que no coincide con ninguna línea: sin_coincidencia (no cae a la principal ni a la plataforma)', async () => {
    const serv = await altaActiva(TA, PN_A, TOKEN_A, { proposito: 'servicio_cliente' });
    await repo.hacerLineaPrincipal(serv);
    await expect(canal.resolverCanal(TA, { proposito: 'oficina' })).rejects.toMatchObject({ motivo: 'sin_coincidencia' });
    await expect(canal.resolverCanal(TA, { lineaId: 'no-existe' })).rejects.toMatchObject({ motivo: 'sin_coincidencia' });
    // una línea de OTRO tenant no sirve aunque se pase su id
    const ajena = await altaActiva(TB, PN_B, TOKEN_B);
    await expect(canal.resolverCanal(TA, { lineaId: ajena })).rejects.toMatchObject({ motivo: 'sin_coincidencia' });
  });

  it('la elegida por criterio pausada o vencida falla cerrado; solo pendiente sigue por la plataforma', async () => {
    await altaActiva(TA, PN_A, TOKEN_A, { proposito: 'servicio_cliente' });
    const oficina = await altaActiva(TA, PN_B, TOKEN_B, { proposito: 'oficina' });
    const operadores = await repo.altaLinea({ tenantId: TA, phoneNumberId: PN_C, token: 'EAAT-token-secreto-del-tenant-A-0003', proposito: 'operadores' });
    expect(await canal.resolverCanal(TA, { proposito: 'operadores' })).toEqual(canal.canalDePlataforma());
    await repo.cambiarEstadoLinea(oficina, 'pausada');
    await expect(canal.resolverCanal(TA, { proposito: 'oficina' })).rejects.toMatchObject({ motivo: 'pausada' });
    await repo.cambiarEstadoLinea(operadores.id, 'token_vencido');
    await expect(canal.resolverCanal(TA, { proposito: 'operadores' })).rejects.toMatchObject({ motivo: 'token_vencido' });
  });

  it('una principal marcada con token vencido no se salta hacia otra activa sin criterio', async () => {
    const p = await altaActiva(TA, PN_A, TOKEN_A);
    await altaActiva(TA, PN_B, TOKEN_B);
    await repo.hacerLineaPrincipal(p);
    await canal.marcarLineaTokenVencido(p);
    await expect(canal.resolverCanal(TA)).rejects.toMatchObject({ motivo: 'token_vencido' });
    // con criterio explícito sí se puede usar la otra
    expect((await canal.resolverCanal(TA, { lineaId: bd.filas[1].id as string })).phoneNumberId).toBe(PN_B);
  });

  it('hacerLineaPrincipal deja UNA sola principal y rechaza una línea no activa o inexistente', async () => {
    const a = await altaActiva(TA, PN_A, TOKEN_A);
    const b = await altaActiva(TA, PN_B, TOKEN_B);
    const pend = (await repo.altaLinea({ tenantId: TA, phoneNumberId: PN_C, token: 'EAAT-token-secreto-del-tenant-A-0003' })).id;
    expect(await repo.hacerLineaPrincipal(a)).toBe(true);
    expect(await repo.hacerLineaPrincipal(b)).toBe(true);
    expect(bd.filas.filter((f) => f.principal === true).map((f) => f.id)).toEqual([b]);
    expect(await repo.hacerLineaPrincipal(pend)).toBe(false);
    expect(await repo.hacerLineaPrincipal('no-existe')).toBe(false);
    expect(bd.filas.filter((f) => f.principal === true).map((f) => f.id)).toEqual([b]);
  });

  it('el webhook entrante resuelve cada número de un mismo tenant a SU línea', async () => {
    const a = await altaActiva(TA, PN_A, TOKEN_A);
    const b = await altaActiva(TA, PN_B, TOKEN_B);
    expect(await canal.canalPorPhoneNumberId(PN_A)).toMatchObject({ tenantId: TA, canal: { lineaId: a, token: TOKEN_A } });
    expect(await canal.canalPorPhoneNumberId(PN_B)).toMatchObject({ tenantId: TA, canal: { lineaId: b, token: TOKEN_B } });
  });
});
