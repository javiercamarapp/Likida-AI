// ═══════════════════════════════════════════════════════════════════════════
// LA INVITACIÓN DEL OPERADOR POR WHATSAPP (W2 «producto»).
//
// Lo que estas pruebas fijan, contra una base en memoria que aplica los filtros
// de verdad (no un doble que solo cuenta llamadas):
//   1. NADIE RECIBE DOS INVITACIONES. El reclamo es un UPDATE condicionado: dos
//      envíos simultáneos sobre los mismos choferes mandan UNA plantilla por
//      chofer, no dos.
//   2. UN FALLO NO BLOQUEA A LOS DEMÁS. Un número que Meta rechaza para siempre
//      queda marcado y sale de «pendientes»; no frena a los siguientes.
//   3. UN FALLO REINTENTABLE NO MARCA NADA: el siguiente intento lo recoge.
//   4. EL ALCANCE DE PATIO SE RESPETA: un jefe con patio no invita a otro patio.
//   5. SE MANDA POR EL SELECTOR, con la plantilla del catálogo y sus variables.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearBaseEnMemoria, type BaseEnMemoria, type Fila } from '@/lib/pruebas/tablas_en_memoria.fixture';

let base: BaseEnMemoria;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => base.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const anotarBitacora = vi.fn(async (_e: Record<string, unknown>) => true);
vi.mock('./bitacora_escritura', () => ({ anotarBitacora: (e: Record<string, unknown>) => anotarBitacora(e) }));

type Opciones = { texto: string; plantilla: { nombre: string; parametros?: string[] }; contexto: string; tenantId?: string };
const enviar = vi.fn(async (_tel: string, _op: Opciones): Promise<unknown> => ({ ok: true, via: 'plantilla', id: 'wamid', motivo: 'ventana_cerrada', ventana: 'cerrada' }));
vi.mock('@/lib/meta/enviar_con_fallback', () => ({ enviarConFallback: (t: string, o: Opciones) => enviar(t, o) }));

const { invitarOperadores, contarPendientes, contarConFallo, LIMITE_POR_LLAMADA, MINUTOS_RECLAMO_HUERFANO, primerNombre, motivoCorto } = await import('./invitacion_operador');
const { DatoInvalido } = await import('./errores');

const T = '11111111-1111-4111-8111-111111111111';
const OTRA = '22222222-2222-4222-8222-222222222222';
const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function op(n: number, extra: Fila = {}): Fila {
  return {
    id: uuid(n), tenant_id: T, nombre: `Chofer Número ${n}`, telefono: `5255${String(n).padStart(8, '0')}`, activo: true,
    terminal_id: null, created_at: `2026-10-01T10:${String(n % 60).padStart(2, '0')}:00Z`,
    invitacion_enviada_en: null, invitacion_via: null, invitacion_fallo: null, invitacion_fallo_en: null, ...extra,
  };
}
const flota = { alcance: { tipo: 'flota' } as const };

beforeEach(() => {
  base = crearBaseEnMemoria({ tenant: [{ id: T, nombre: 'Transportes del Norte' }], operador: [] });
  enviar.mockClear();
  enviar.mockImplementation(async () => ({ ok: true, via: 'plantilla', id: 'wamid', motivo: 'ventana_cerrada', ventana: 'cerrada' }));
  anotarBitacora.mockClear();
});

describe('invitarOperadores — el envío', () => {
  it('manda por el selector con la plantilla del catálogo, el primer nombre y el de la flota', async () => {
    base.tabla('operador').push(op(1, { nombre: 'Juan Pérez García' }));
    const r = await invitarOperadores(T, flota);
    expect(r).toMatchObject({ enviadas: 1, fallidas: [], pendientesRestantes: 0 });
    const [tel, o] = enviar.mock.calls[0];
    expect(tel).toBe('525500000001');
    expect(o.plantilla.nombre).toBe('operador_invitacion_v1');
    expect(o.plantilla.parametros).toEqual(['Juan', 'Transportes del Norte']);
    expect(o.texto).toContain('Hola Juan, Transportes del Norte te dio de alta en Likida');
    expect(o.contexto).toBe('operador.invitacion');
    expect(o.tenantId).toBe(T);
  });

  it('deja la constancia de la vía real (plantilla fuera de ventana) y la fecha', async () => {
    base.tabla('operador').push(op(1));
    await invitarOperadores(T, { ...flota, ahora: new Date('2026-10-01T18:00:00Z') });
    expect(base.tabla('operador')[0]).toMatchObject({ invitacion_via: 'plantilla', invitacion_enviada_en: '2026-10-01T18:00:00.000Z', invitacion_fallo: null });
  });

  it('con la ventana abierta la vía es texto (lo que dijo el selector)', async () => {
    base.tabla('operador').push(op(1));
    enviar.mockImplementation(async () => ({ ok: true, via: 'texto', id: 'w', motivo: 'ventana_abierta', ventana: 'abierta' }));
    await invitarOperadores(T, flota);
    expect(base.tabla('operador')[0].invitacion_via).toBe('texto');
  });

  it('solo los ACTIVOS: un chofer dado de baja no recibe invitación', async () => {
    base.tabla('operador').push(op(1), op(2, { activo: false }));
    const r = await invitarOperadores(T, flota);
    expect(r.enviadas).toBe(1);
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(base.tabla('operador')[1].invitacion_enviada_en).toBeNull();
  });

  it('aislamiento: las fichas de OTRA flota no se tocan ni se invitan', async () => {
    base.tabla('operador').push(op(1), op(2, { tenant_id: OTRA }));
    const r = await invitarOperadores(T, flota);
    expect(r.enviadas).toBe(1);
    expect(base.tabla('operador')[1].invitacion_enviada_en).toBeNull();
  });

  it('por ids: un id de otra flota cuenta como saltado y no se envía', async () => {
    base.tabla('operador').push(op(1), op(2, { tenant_id: OTRA }));
    const r = await invitarOperadores(T, { ...flota, ids: [uuid(1), uuid(2)] });
    expect(r).toMatchObject({ enviadas: 1, saltadas: 1 });
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it('ids que no son uuid o una lista vacía se rechazan ANTES de tocar nada', async () => {
    await expect(invitarOperadores(T, { ...flota, ids: ["x' or 1=1"] })).rejects.toThrow(DatoInvalido);
    await expect(invitarOperadores(T, { ...flota, ids: [] })).rejects.toThrow(DatoInvalido);
    expect(base.bitacora).toHaveLength(0);
  });

  it('deja UNA línea de bitácora con ids (no nombres ni teléfonos)', async () => {
    base.tabla('operador').push(op(1), op(2));
    await invitarOperadores(T, { ...flota, actor: { id: 'u-1' } });
    expect(anotarBitacora).toHaveBeenCalledTimes(1);
    const e = anotarBitacora.mock.calls[0][0] as { accion: string; detalle: { ids: string[]; enviadas: number } };
    expect(e.accion).toBe('operador.invitados');
    expect(e.detalle.ids.sort()).toEqual([uuid(1), uuid(2)]);
    expect(JSON.stringify(e)).not.toContain('Chofer');
    expect(JSON.stringify(e)).not.toContain('5255');
  });
});

describe('idempotencia: nadie recibe dos invitaciones', () => {
  it('el MISMO envío dos veces: la segunda no manda nada (ya están invitados)', async () => {
    base.tabla('operador').push(op(1), op(2));
    await invitarOperadores(T, flota);
    enviar.mockClear();
    const r = await invitarOperadores(T, flota);
    expect(r.enviadas).toBe(0);
    expect(enviar).not.toHaveBeenCalled();
  });

  it('DOS envíos simultáneos sobre los mismos choferes: una plantilla por chofer, no dos', async () => {
    for (let i = 1; i <= 12; i++) base.tabla('operador').push(op(i));
    const [a, b] = await Promise.all([invitarOperadores(T, flota), invitarOperadores(T, flota)]);
    expect(a.enviadas + b.enviadas).toBe(12);
    expect(enviar).toHaveBeenCalledTimes(12);
    const telefonos = enviar.mock.calls.map((c) => c[0]);
    expect(new Set(telefonos).size).toBe(12);
  });

  it('dos envíos simultáneos POR IDS (dos jefes, el mismo grupo): tampoco se duplica', async () => {
    for (let i = 1; i <= 5; i++) base.tabla('operador').push(op(i));
    const ids = [1, 2, 3, 4, 5].map(uuid);
    const [a, b] = await Promise.all([
      invitarOperadores(T, { ...flota, ids }), invitarOperadores(T, { ...flota, ids }),
    ]);
    expect(a.enviadas + b.enviadas).toBe(5);
    expect(a.saltadas + b.saltadas).toBe(5);
    expect(enviar).toHaveBeenCalledTimes(5);
  });

  it('un reclamo HUÉRFANO (el proceso murió entre reclamar y enviar) se recoge pasados 15 minutos', async () => {
    const ahora = new Date('2026-10-01T18:00:00Z');
    const viejo = new Date(ahora.getTime() - (MINUTOS_RECLAMO_HUERFANO + 1) * 60_000).toISOString();
    const reciente = new Date(ahora.getTime() - 2 * 60_000).toISOString();
    base.tabla('operador').push(
      op(1, { invitacion_enviada_en: viejo, invitacion_via: 'reclamada' }),
      op(2, { invitacion_enviada_en: reciente, invitacion_via: 'reclamada' }),
    );
    const r = await invitarOperadores(T, { ...flota, ahora });
    expect(r.enviadas).toBe(1);
    expect(enviar.mock.calls.map((c) => c[0])).toEqual(['525500000001']);
  });

  it('un envío exitoso nunca se vuelve a reclamar, ni por ids', async () => {
    base.tabla('operador').push(op(1, { invitacion_enviada_en: '2026-09-01T00:00:00Z', invitacion_via: 'plantilla' }));
    const r = await invitarOperadores(T, { ...flota, ids: [uuid(1)] });
    expect(r).toMatchObject({ enviadas: 0, saltadas: 1 });
    expect(enviar).not.toHaveBeenCalled();
  });
});

describe('fallos: no bloquean a los demás', () => {
  it('un rechazo PERMANENTE marca el motivo en la ficha y suelta el reclamo; los demás salen', async () => {
    base.tabla('operador').push(op(1), op(2), op(3));
    enviar.mockImplementation(async (tel: string) => tel.endsWith('2')
      ? { ok: false, motivo: 'plantilla_rechazada', mensaje: 'Ese número no tiene WhatsApp.', reintentable: false, fueraDeVentana: true, ventana: 'cerrada' }
      : { ok: true, via: 'plantilla', id: 'w', motivo: 'ventana_cerrada', ventana: 'cerrada' });
    const r = await invitarOperadores(T, flota);
    expect(r.enviadas).toBe(2);
    expect(r.fallidas).toEqual([{ operadorId: uuid(2), nombre: 'Chofer Número 2', motivo: 'Ese número no tiene WhatsApp.' }]);
    const f = base.tabla('operador').find((x) => x.id === uuid(2))!;
    expect(f).toMatchObject({ invitacion_enviada_en: null, invitacion_via: null, invitacion_fallo: 'Ese número no tiene WhatsApp.' });
    expect(f.invitacion_fallo_en).toBeTruthy();
  });

  it('el fallo permanente SALE de pendientes: el siguiente «enviar pendientes» no lo reintenta ni se atora en él', async () => {
    base.tabla('operador').push(op(1), op(2));
    enviar.mockImplementation(async (tel: string) => tel.endsWith('1')
      ? { ok: false, motivo: 'plantilla_rechazada', mensaje: 'Número inválido.', reintentable: false, fueraDeVentana: true, ventana: 'cerrada' }
      : { ok: true, via: 'plantilla', id: 'w', motivo: 'ventana_cerrada', ventana: 'cerrada' });
    await invitarOperadores(T, flota);
    enviar.mockClear();
    expect(await contarPendientes(T, { tipo: 'flota' })).toBe(0);
    expect(await contarConFallo(T, { tipo: 'flota' })).toBe(1);
    const r = await invitarOperadores(T, flota);
    expect(r.enviadas).toBe(0);
    expect(enviar).not.toHaveBeenCalled();
  });

  it('pero SE REINTENTA a mano, por ids, y un éxito limpia el fallo', async () => {
    base.tabla('operador').push(op(1, { invitacion_fallo: 'Número inválido.', invitacion_fallo_en: '2026-10-01T10:00:00Z' }));
    const r = await invitarOperadores(T, { ...flota, ids: [uuid(1)] });
    expect(r.enviadas).toBe(1);
    expect(base.tabla('operador')[0]).toMatchObject({ invitacion_fallo: null, invitacion_fallo_en: null, invitacion_via: 'plantilla' });
  });

  it('un rechazo REINTENTABLE (429, red) suelta el reclamo SIN marcar fallo: el siguiente envío lo recoge', async () => {
    base.tabla('operador').push(op(1));
    enviar.mockImplementation(async () => ({ ok: false, motivo: 'rechazo_no_ventana', mensaje: 'Meta pide esperar.', reintentable: true, fueraDeVentana: false, ventana: 'desconocida' }));
    const r = await invitarOperadores(T, flota);
    expect(r.fallidas).toHaveLength(1);
    expect(base.tabla('operador')[0]).toMatchObject({ invitacion_enviada_en: null, invitacion_via: null, invitacion_fallo: null });
    expect(await contarPendientes(T, { tipo: 'flota' })).toBe(1);
  });

  it('un lanzamiento inesperado del selector tampoco deja el reclamo colgado ni rompe a los demás', async () => {
    base.tabla('operador').push(op(1), op(2));
    enviar.mockImplementation(async (tel: string) => {
      if (tel.endsWith('1')) throw new Error('boom');
      return { ok: true, via: 'plantilla', id: 'w', motivo: 'ventana_cerrada', ventana: 'cerrada' };
    });
    const r = await invitarOperadores(T, flota);
    expect(r.enviadas).toBe(1);
    expect(r.fallidas).toHaveLength(1);
    expect(base.tabla('operador')[0].invitacion_via).toBeNull();
  });

  it('si no se puede RECLAMAR (la base falla) no se manda NADA y se dice', async () => {
    base.tabla('operador').push(op(1));
    base.fallarProxima('operador', 'update', { message: 'se cayó' });
    const r = await invitarOperadores(T, flota);
    expect(r.error).toMatch(/No pude preparar las invitaciones/);
    expect(r.enviadas).toBe(0);
    expect(enviar).not.toHaveBeenCalled();
  });
});

describe('acotado y con alcance', () => {
  it(`manda a lo más ${LIMITE_POR_LLAMADA} por llamada y dice cuántos quedan`, async () => {
    for (let i = 1; i <= LIMITE_POR_LLAMADA + 10; i++) base.tabla('operador').push(op(i));
    const r = await invitarOperadores(T, flota);
    expect(r.enviadas).toBe(LIMITE_POR_LLAMADA);
    expect(r.pendientesRestantes).toBe(10);
    const r2 = await invitarOperadores(T, flota);
    expect(r2.enviadas).toBe(10);
    expect(r2.pendientesRestantes).toBe(0);
  });

  it('el más antiguo primero (orden por alta): el recorrido es determinista', async () => {
    base.tabla('operador').push(op(30), op(5), op(17));
    await invitarOperadores(T, flota);
    expect(enviar.mock.calls.map((c) => c[0]).sort()).toEqual(['525500000005', '525500000017', '525500000030']);
  });

  it('un jefe CON patio solo invita a los de su patio', async () => {
    base.tabla('operador').push(op(1, { terminal_id: P1 }), op(2, { terminal_id: P2 }), op(3, { terminal_id: null }));
    const r = await invitarOperadores(T, { alcance: { tipo: 'patio', terminalId: P1 } });
    expect(r.enviadas).toBe(1);
    expect(enviar.mock.calls.map((c) => c[0])).toEqual(['525500000001']);
    expect(await contarPendientes(T, { tipo: 'patio', terminalId: P1 })).toBe(0);
    expect(await contarPendientes(T, { tipo: 'flota' })).toBe(2);
  });

  it('un jefe con patio NO puede invitar por ids a un chofer de otro patio (queda saltado)', async () => {
    base.tabla('operador').push(op(1, { terminal_id: P2 }));
    const r = await invitarOperadores(T, { alcance: { tipo: 'patio', terminalId: P1 }, ids: [uuid(1)] });
    expect(r).toMatchObject({ enviadas: 0, saltadas: 1 });
    expect(enviar).not.toHaveBeenCalled();
  });
});

describe('ayudas', () => {
  it('primerNombre: solo el primero, y un nombre vacío no rompe el saludo', () => {
    expect(primerNombre('  Juan   Pérez García ')).toBe('Juan');
    expect(primerNombre('')).toBe('operador');
  });
  it('motivoCorto: sin saltos de línea, con tope y con valor por omisión', () => {
    expect(motivoCorto('a\n\nb')).toBe('a b');
    expect(motivoCorto('x'.repeat(500)).length).toBe(200);
    expect(motivoCorto('   ')).toBe('Meta rechazó el mensaje');
  });
});
