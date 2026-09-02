import { createHmac } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

type Filtro = { columna: string; valor: unknown };
type Resultado = { data: unknown; error: { message: string } | null };
type Builder = {
  select: () => Builder;
  eq: (columna: string, valor: unknown) => Builder;
  is: (columna: string, valor: unknown) => Builder;
  order: (...args: unknown[]) => Builder;
  limit: (...args: unknown[]) => Builder;
  insert: (fila: Record<string, unknown>) => Builder;
  update: (fila: Record<string, unknown>) => Builder;
  delete: () => Builder;
  maybeSingle: () => Promise<Resultado>;
  then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise<unknown>;
};

const db = vi.hoisted(() => ({
  prospecto: { id: 'p-landing-1' } as { id: string } | null,
  lookupError: false,
  eventError: false,
  updateError: false,
  eventKeys: new Set<string>(),
  borradoError: false,
  borrados: [] as string[],
  inserts: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ cambios: Record<string, unknown>; filtros: Filtro[] }>,
  filtros: [] as Filtro[],
}));

function builder(table: string): Builder {
  const b = {} as Builder;
  let evento: Record<string, unknown> | null = null;
  let cambios: Record<string, unknown> | null = null;
  let borrando = false;
  const filtros: Filtro[] = [];
  b.select = () => b;
  b.eq = (columna: string, valor: unknown) => { filtros.push({ columna, valor }); return b; };
  b.is = (columna: string, valor: unknown) => { filtros.push({ columna, valor }); return b; };
  b.order = () => b;
  b.limit = () => b;
  b.insert = (fila: Record<string, unknown>) => {
    if (table === 'comercial_evento') {
      evento = fila;
      db.inserts.push(fila);
    }
    return b;
  };
  b.update = (fila: Record<string, unknown>) => { cambios = fila; return b; };
  b.delete = () => { borrando = true; return b; };
  b.maybeSingle = async () => {
    if (table === 'prospecto') {
      return db.lookupError
        ? { data: null, error: { message: 'CRM read failed' } }
        : { data: db.prospecto, error: null };
    }
    const clave = String(evento?.clave_idempotencia ?? '');
    if (db.eventError) return { data: null, error: { message: 'ledger write failed' } };
    if (db.eventKeys.has(clave)) return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
    db.eventKeys.add(clave);
    return { data: { id: 'evento-1' }, error: null };
  };
  b.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
    if (table === 'comercial_evento' && borrando) {
      const clave = String(filtros.find((f) => f.columna === 'clave_idempotencia')?.valor ?? '');
      if (db.borradoError) return Promise.resolve({ data: null, error: { message: 'ledger delete failed' } }).then(resolve, reject);
      db.eventKeys.delete(clave);
      db.borrados.push(clave);
      return Promise.resolve({ data: null, error: null }).then(resolve, reject);
    }
    if (table === 'prospecto' && cambios) {
      db.updates.push({ cambios, filtros: [...filtros] });
      const response = db.updateError ? { data: null, error: { message: 'CRM update failed' } } : { data: null, error: null };
      return Promise.resolve(response).then(resolve, reject);
    }
    return Promise.resolve({ data: null, error: null }).then(resolve, reject);
  };
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (table: string) => builder(table) }) }));
vi.mock('@/lib/ratelimit', () => ({ bodyExcede: vi.fn(() => false) }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

const { POST } = await import('./route');
const { logger } = await import('@/lib/logger');

const SECRET = 'calcom-test-secret';

function postear(cuerpo: string, firma = firmar(cuerpo)) {
  return POST(new Request('https://app.likida.ai/api/webhook/calcom', {
    method: 'POST',
    headers: { 'x-cal-signature-256': firma, 'content-type': 'application/json' },
    body: cuerpo,
  }));
}

function firmar(cuerpo: string): string {
  return createHmac('sha256', SECRET).update(cuerpo).digest('hex');
}

const EVENTO = JSON.stringify({
  triggerEvent: 'BOOKING_CREATED',
  bookingId: 'booking-1',
  payload: { attendees: [{ email: '  lead@landing.mx ' }] },
});

beforeEach(() => {
  process.env.CALCOM_WEBHOOK_SECRET = SECRET;
  db.prospecto = { id: 'p-landing-1' };
  db.lookupError = false;
  db.eventError = false;
  db.updateError = false;
  db.eventKeys.clear();
  db.inserts.length = 0;
  db.updates.length = 0;
  db.borradoError = false;
  db.borrados.length = 0;
});

afterEach(() => { delete process.env.CALCOM_WEBHOOK_SECRET; });

describe('POST /api/webhook/calcom — puerta y durabilidad', () => {
  it('firma inválida responde 401 y no toca CRM', async () => {
    const r = await postear(EVENTO, '00'.repeat(32));
    expect(r.status).toBe(401);
    expect(db.inserts).toHaveLength(0);
    expect(db.updates).toHaveLength(0);
  });

  it('lead landing global sin tenant se enlaza por correo y pasa a appointment', async () => {
    const r = await postear(EVENTO);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, prospectoId: 'p-landing-1' });
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].cambios).toMatchObject({ estado: 'appointment', cerrado_en: null });
    expect(db.updates[0].filtros).toContainEqual({ columna: 'id', valor: 'p-landing-1' });
    expect(db.inserts[0]).toMatchObject({ fuente: 'calcom', tipo: 'BOOKING_CREATED', prospecto_id: 'p-landing-1' });
  });

  it('repetir el mismo webhook responde 200 repetido y no vuelve a actualizar', async () => {
    expect((await postear(EVENTO)).status).toBe(200);
    const r = await postear(EVENTO);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, repetido: true });
    expect(db.updates).toHaveLength(1);
    // Both deliveries attempt the durable insert; the unique key turns the
    // second attempt into `repetido` before any prospect update.
    expect(db.inserts).toHaveLength(2);
  });

  it('JSON inválido firmado responde 400', async () => {
    const r = await postear('{');
    expect(r.status).toBe(400);
    expect(db.inserts).toHaveLength(0);
  });

  it('payload sobredimensionado responde 413 antes de consultar CRM', async () => {
    const cuerpo = JSON.stringify({ triggerEvent: 'BOOKING_CREATED', bookingId: 'big', payload: { blob: 'x'.repeat(256 * 1024) } });
    const r = await postear(cuerpo);
    expect(r.status).toBe(413);
    expect(db.inserts).toHaveLength(0);
  });

  it('fallo de base responde 500 para que Cal.com reintente', async () => {
    db.lookupError = true;
    const r = await postear(EVENTO);
    expect(r.status).toBe(500);
    expect(db.inserts).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24, BE-17 — el libro se sellaba ANTES de aplicar el cambio al
// prospecto. Un bache en el `UPDATE` dejaba el evento REGISTRADO y NUNCA
// APLICADO: el 500 hacía reintentar a Cal.com, la clave ya escrita devolvía
// `repetido` con 200, y un BOOKING_CANCELLED dejaba al prospecto en
// `appointment` para siempre — el vendedor le habla el día de una cita que ya
// no existe.
// ═══════════════════════════════════════════════════════════════════════════
describe('BE-17 — un evento sellado pero no aplicado se puede reintentar', () => {
  const CANCELADO = JSON.stringify({
    triggerEvent: 'BOOKING_CANCELLED',
    bookingId: 'booking-98765',
    payload: { attendees: [{ email: 'lead@landing.mx' }] },
  });

  it('REPRO: el UPDATE falla una vez y el SEGUNDO envío sí aplica', async () => {
    db.updateError = true;
    expect((await postear(CANCELADO)).status).toBe(500);
    // La reclamación se soltó: el reintento no puede salir como `repetido`.
    expect(db.borrados).toEqual(['calcom:BOOKING_CANCELLED:booking-98765']);

    db.updateError = false;
    const r = await postear(CANCELADO);

    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, prospectoId: 'p-landing-1' });
    expect(db.updates.at(-1)!.cambios).toMatchObject({ estado: 'cancelled' });
  });

  it('si NI SIQUIERA se puede soltar la reclamación, se nombra en el log', async () => {
    db.updateError = true;
    db.borradoError = true;
    expect((await postear(CANCELADO)).status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith('calcom.webhook.reclamacion_atorada', expect.objectContaining({
      clave: 'calcom:BOOKING_CANCELLED:booking-98765',
    }));
  });

  it('un evento que SÍ aplicó no suelta nada: el repetido sigue siendo repetido', async () => {
    expect((await postear(CANCELADO)).status).toBe(200);
    expect(db.borrados).toHaveLength(0);
    const r = await postear(CANCELADO);
    expect(await r.json()).toMatchObject({ repetido: true });
    expect(db.updates).toHaveLength(1);
  });
});
