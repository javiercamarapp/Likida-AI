// ═══════════════════════════════════════════════════════════════════════════
// ESCRITURA DEL BUZÓN (C1, auditoría 4).
//
// Lo que se fija aquí no es que el mock de Supabase funcione: es lo que el
// motor le MANDA y cómo reacciona a lo que vuelve —
//   · el token que viaja al UPDATE respeta la forma del CHECK de la 0095;
//   · el UPDATE va anclado al id y mira las filas devueltas (0 filas ≠ éxito);
//   · un 23505 del unique global se reintenta con token NUEVO, máximo 3;
//   · un error cualquiera LANZA, y el token no viaja en el mensaje;
//   · el token JAMÁS entra a la bitácora ni al logger.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Registro = {
  tabla: string;
  op: string | null;
  payload: unknown;
  eq: Array<[string, unknown]>;
  select: string | null;
};

type Respuesta = { data: unknown; error: { message: string; code?: string } | null };

const llamadas: Registro[] = [];
// Cola POR TABLA: el reintento del unique necesita que dos UPDATEs seguidos a
// `tenant` contesten distinto. Si la cola se vacía, se repite la última.
const colas = new Map<string, Respuesta[]>();

function contestar(tabla: string): Respuesta {
  const cola = colas.get(tabla) ?? [];
  const r = cola.length > 1 ? cola.shift() : cola[0];
  return r ?? { data: null, error: null };
}

function builder(tabla: string) {
  const r: Registro = { tabla, op: null, payload: null, eq: [], select: null };
  llamadas.push(r);
  const b: Record<string, unknown> = {};
  b.insert = (p: unknown) => { r.op = 'insert'; r.payload = p; return b; };
  b.update = (p: unknown) => { r.op = 'update'; r.payload = p; return b; };
  b.select = (cols: string) => { r.select = cols; if (!r.op) r.op = 'select'; return b; };
  b.eq = (c: string, v: unknown) => { r.eq.push([c, v]); return b; };
  b.maybeSingle = async () => contestar(tabla);
  // El builder de supabase-js es "thenable": las cadenas sin `.single()` se
  // esperan directo (y `acotada` les hace Promise.race encima).
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(contestar(tabla)).then(res, rej);
  return b;
}

const logs = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: logs }));

const { getBuzon, generarBuzon, rotarBuzon } = await import('./buzon_escritura');

const TENANT = 't-flota-1';
/** La forma que exige el CHECK `tenant_buzon_token_forma` (0095), tal cual. */
const FORMA_0095 = /^[a-hjkmnp-tv-z2-9]{24}$/;

const dominioOriginal = process.env.RESEND_EMAIL_DOMAIN;
beforeEach(() => {
  llamadas.length = 0;
  colas.clear();
  logs.info.mockClear();
  logs.warn.mockClear();
  logs.error.mockClear();
  process.env.RESEND_EMAIL_DOMAIN = 'mail.likida.ai';
});
afterEach(() => {
  if (dominioOriginal === undefined) delete process.env.RESEND_EMAIL_DOMAIN;
  else process.env.RESEND_EMAIL_DOMAIN = dominioOriginal;
});

function updatesDeTenant(): Registro[] {
  return llamadas.filter((l) => l.tabla === 'tenant' && l.op === 'update');
}

describe('generarBuzon — el token que viaja y a qué va anclado', () => {
  it('manda un token con la forma del CHECK de la 0095, anclado al id, mirando filas', async () => {
    colas.set('tenant', [{ data: [{ id: TENANT }], error: null }]);
    const r = await generarBuzon(TENANT, { id: 'u-1' });

    const [upd] = updatesDeTenant();
    const fila = upd.payload as Record<string, unknown>;
    expect(String(fila.buzon_token)).toMatch(FORMA_0095);
    expect(upd.eq).toContainEqual(['id', TENANT]);
    expect(upd.select).toBe('id');
    expect(r.token).toBe(fila.buzon_token);
    expect(r.direccion).toBe(`f-${r.token}@mail.likida.ai`);
  });

  it('sin RESEND_EMAIL_DOMAIN el token se guarda igual pero la dirección es null — se dice, no se inventa', async () => {
    delete process.env.RESEND_EMAIL_DOMAIN;
    colas.set('tenant', [{ data: [{ id: TENANT }], error: null }]);
    const r = await generarBuzon(TENANT);
    expect(r.token).toMatch(FORMA_0095);
    expect(r.direccion).toBeNull();
  });

  it('un 23505 del unique global se reintenta con token NUEVO', async () => {
    colas.set('tenant', [
      { data: null, error: { message: 'duplicate key value violates unique constraint "tenant_buzon_token_unico"', code: '23505' } },
      { data: [{ id: TENANT }], error: null },
    ]);
    const r = await generarBuzon(TENANT);

    const upds = updatesDeTenant();
    expect(upds).toHaveLength(2);
    const t1 = (upds[0].payload as Record<string, unknown>).buzon_token;
    const t2 = (upds[1].payload as Record<string, unknown>).buzon_token;
    // Reintentar con el MISMO token volvería a chocar por definición.
    expect(t1).not.toBe(t2);
    expect(r.token).toBe(t2);
  });

  it('tres 23505 seguidos LANZAN — eso ya no es azar, es un generador roto', async () => {
    colas.set('tenant', [
      { data: null, error: { message: 'duplicate key', code: '23505' } },
    ]);
    await expect(generarBuzon(TENANT)).rejects.toThrow(/no es azar/);
    expect(updatesDeTenant()).toHaveLength(3);
  });

  it('un error que NO es 23505 lanza a la primera, sin reintentar y sin el token en el mensaje', async () => {
    colas.set('tenant', [{ data: null, error: { message: 'fetch failed', code: 'XX000' } }]);
    await expect(generarBuzon(TENANT)).rejects.toThrow(/escribirToken\(buzon\.generado\): fetch failed/);
    const upds = updatesDeTenant();
    expect(upds).toHaveLength(1);
    // El mensaje del throw no debe cargar el token (acaba en un log de arriba).
    const token = String((upds[0].payload as Record<string, unknown>).buzon_token);
    await expect(generarBuzon(TENANT)).rejects.toSatisfy((e: unknown) =>
      e instanceof Error && !e.message.includes(token));
  });

  it('0 filas tocadas LANZA: una flota que no existe no tiene buzón "generado"', async () => {
    colas.set('tenant', [{ data: [], error: null }]);
    await expect(generarBuzon(TENANT)).rejects.toThrow(/la flota no existe/);
  });

  it('el token NO viaja a la bitácora ni al logger', async () => {
    colas.set('tenant', [{ data: [{ id: TENANT }], error: null }]);
    const r = await generarBuzon(TENANT, { id: 'u-1', email: 'dueño@flota.mx' });

    const bitacoras = llamadas.filter((l) => l.tabla === 'bitacora_auditoria');
    expect(bitacoras).toHaveLength(1);
    expect(JSON.stringify(bitacoras[0].payload)).not.toContain(r.token as string);

    const logueado = JSON.stringify([logs.info.mock.calls, logs.warn.mock.calls, logs.error.mock.calls]);
    expect(logueado).not.toContain(r.token as string);
  });

  it('una bitácora caída NO tira la operación — el buzón ya se escribió', async () => {
    colas.set('tenant', [{ data: [{ id: TENANT }], error: null }]);
    colas.set('bitacora_auditoria', [{ data: null, error: { message: 'fetch failed' } }]);
    const r = await generarBuzon(TENANT);
    expect(r.token).toMatch(FORMA_0095);
    expect(logs.warn).toHaveBeenCalledWith('buzon.bitacora_no_escribio', expect.anything());
  });
});

describe('rotarBuzon — misma mecánica, intención DICHA', () => {
  it('escribe token nuevo y deja constancia como rotación, no como alta', async () => {
    colas.set('tenant', [{ data: [{ id: TENANT }], error: null }]);
    const r = await rotarBuzon(TENANT, { id: 'u-1' });
    expect(r.token).toMatch(FORMA_0095);

    const [bit] = llamadas.filter((l) => l.tabla === 'bitacora_auditoria');
    expect((bit.payload as Record<string, unknown>).accion).toBe('buzon.rotado');
  });
});

describe('getBuzon — lee, no genera', () => {
  it('con token y dominio devuelve la dirección completa', async () => {
    colas.set('tenant', [{ data: { buzon_token: 'abcdefghjkmnpqrstvwxyz23' }, error: null }]);
    const r = await getBuzon(TENANT);
    expect(r).toEqual({
      token: 'abcdefghjkmnpqrstvwxyz23',
      direccion: 'f-abcdefghjkmnpqrstvwxyz23@mail.likida.ai',
    });
    // Y NO escribió nada: abrir la pantalla no genera buzones.
    expect(updatesDeTenant()).toHaveLength(0);
  });

  it('sin token devuelve null en las dos — es el estado "genera el tuyo"', async () => {
    colas.set('tenant', [{ data: { buzon_token: null }, error: null }]);
    expect(await getBuzon(TENANT)).toEqual({ token: null, direccion: null });
  });

  it('con token pero sin dominio, la dirección es null: no se arma una que no existe', async () => {
    delete process.env.RESEND_EMAIL_DOMAIN;
    colas.set('tenant', [{ data: { buzon_token: 'abcdefghjkmnpqrstvwxyz23' }, error: null }]);
    const r = await getBuzon(TENANT);
    expect(r.token).toBe('abcdefghjkmnpqrstvwxyz23');
    expect(r.direccion).toBeNull();
  });

  it('un error de lectura LANZA — no se disfraza de "sin buzón"', async () => {
    colas.set('tenant', [{ data: null, error: { message: 'fetch failed' } }]);
    await expect(getBuzon(TENANT)).rejects.toThrow(/getBuzon: fetch failed/);
  });

  it('una flota inexistente LANZA — "sin buzón" invitaría a generar sobre nada', async () => {
    colas.set('tenant', [{ data: null, error: null }]);
    await expect(getBuzon(TENANT)).rejects.toThrow(/la flota no existe/);
  });
});
