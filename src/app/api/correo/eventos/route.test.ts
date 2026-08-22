import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

// ═══════════════════════════════════════════════════════════════════════════
// EL WEBHOOK DE ENTREGA (0124) — lo que se fija:
//  · Sin secreto configurado: 500 (Resend reintenta; nadie procesa sin
//    firma). Firma inválida o vieja: 401.
//  · delivered/bounced/complained escriben el estado sobre la pieza por
//    provider_message_id; un "entregado" tardío NO pisa a un rebote.
//  · Si la base no responde: 500 — el evento es la única fuente del dato.
// ═══════════════════════════════════════════════════════════════════════════

// ── UNA TABLA EN MEMORIA CON LA SEMÁNTICA DE SQL, no un doble que dice "sí" ──
//
// AUDITORÍA 18, A4: el doble anterior devolvía `[{id:'pz-1'}]` pasara lo que
// pasara y solo afirmaba que `.neq(...)` FUE LLAMADO. Con eso, un filtro que en
// Postgres no casaba ninguna fila (`NULL <> 'rebotado'` es NULL) pasaba verde.
// Aquí los filtros se APLICAN sobre filas con `entrega_estado: null` con las
// tres reglas de SQL que importan: `eq`/`neq` contra NULL no casan; `is.null`
// sí; `or(...)` une ramas. Si alguien vuelve a poner un `<>` sobre la columna
// anulable, la pieza recién aceptada deja de escribirse y esto lo caza.
type Fila = { id: string; provider_message_id: string; entrega_estado: string | null };
const tabla: Fila[] = [];
const respuestas: Array<{ data: unknown; error: { message: string } | null }> = [];
type Cond = (f: Fila) => boolean;
function condDe(col: string, op: string, v: string): Cond {
  const k = col as keyof Fila;
  if (op === 'is' && v === 'null') return (f) => f[k] === null;
  if (op === 'eq') return (f) => f[k] !== null && f[k] === v;
  if (op === 'neq') return (f) => f[k] !== null && f[k] !== v; // NULL <> x → NULL → no casa
  throw new Error(`op no soportado en el doble: ${op}`);
}
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const conds: Cond[] = [];
      let parche: Partial<Fila> = {};
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        update: (p: Partial<Fila>) => { parche = p; return b; },
        eq: (c: string, v: string) => { conds.push(condDe(c, 'eq', v)); return b; },
        neq: (c: string, v: string) => { conds.push(condDe(c, 'neq', v)); return b; },
        or: (expr: string) => {
          const ramas = expr.split(',').map((r) => { const [c, op, v] = r.split('.'); return condDe(c, op, v); });
          conds.push((f) => ramas.some((r) => r(f)));
          return b;
        },
        select: () => b,
        then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve().then(() => {
            const forzada = respuestas.shift();
            if (forzada) return forzada;
            const tocadas = tabla.filter((f) => conds.every((c) => c(f)));
            for (const f of tocadas) Object.assign(f, parche);
            return { data: tocadas.map((f) => ({ id: f.id })), error: null };
          }).then(res, rej),
      });
      return b;
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { POST } = await import('./route');

const SECRETO_CRUDO = crypto.randomBytes(24);
const SECRETO = `whsec_${SECRETO_CRUDO.toString('base64')}`;

function postear(cuerpo: string, opts: { firmar?: boolean; ts?: number } = {}) {
  const id = 'msg_1';
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
  const firma = crypto.createHmac('sha256', SECRETO_CRUDO).update(`${id}.${ts}.${cuerpo}`).digest('base64');
  return POST(new Request('https://app.likida.ai/api/correo/eventos', {
    method: 'POST',
    headers: {
      'svix-id': id, 'svix-timestamp': ts,
      'svix-signature': opts.firmar === false ? 'v1,AAAA' : `v1,${firma}`,
    },
    body: cuerpo,
  }));
}

const EVENTO = JSON.stringify({ type: 'email.bounced', data: { email_id: 're_123' } });

beforeEach(() => {
  respuestas.length = 0;
  tabla.length = 0;
  // La pieza recién aceptada por Resend: `entrega_estado` NACE NULL (0124).
  tabla.push({ id: 'pz-1', provider_message_id: 're_123', entrega_estado: null });
  process.env.RESEND_EVENTOS_WEBHOOK_SECRET = SECRETO;
});

const entregado = JSON.stringify({ type: 'email.delivered', data: { email_id: 're_123' } });

describe('la puerta', () => {
  it('sin secreto configurado: 500 — Resend reintenta, nadie procesa sin firma', async () => {
    delete process.env.RESEND_EVENTOS_WEBHOOK_SECRET;
    expect((await postear(EVENTO)).status).toBe(500);
  });

  it('firma inválida: 401; timestamp viejo (replay): 401', async () => {
    expect((await postear(EVENTO, { firmar: false })).status).toBe(401);
    expect((await postear(EVENTO, { ts: Math.floor(Date.now() / 1000) - 3600 })).status).toBe(401);
  });
});

describe('el circuito', () => {
  it('un rebote escribe el estado sobre la pieza recién aceptada (columna NULL), por provider_message_id', async () => {
    const r = await postear(EVENTO);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ pieza: 'pz-1', estado: 'rebotado' });
    expect(tabla[0].entrega_estado).toBe('rebotado');
  });

  it('un "entregado" sobre la pieza recién aceptada (columna NULL) SÍ se escribe — era el bug A4', async () => {
    // Con `.neq('entrega_estado','rebotado')` esto contestaba `sinPieza` y la
    // columna se quedaba NULL para siempre.
    const r = await postear(entregado);
    expect(await r.json()).toMatchObject({ pieza: 'pz-1', estado: 'entregado' });
    expect(tabla[0].entrega_estado).toBe('entregado');
  });

  it('un "entregado" tardío NO pisa a un rebote ni a una queja — la mala noticia es la que opera', async () => {
    tabla[0].entrega_estado = 'rebotado';
    expect(await (await postear(entregado)).json()).toMatchObject({ sinPieza: true });
    expect(tabla[0].entrega_estado).toBe('rebotado');
    tabla[0].entrega_estado = 'queja';
    expect(await (await postear(entregado)).json()).toMatchObject({ sinPieza: true });
    expect(tabla[0].entrega_estado).toBe('queja');
  });

  it('un rebote SÍ pisa a un "entregado" anterior', async () => {
    tabla[0].entrega_estado = 'entregado';
    expect(await (await postear(EVENTO)).json()).toMatchObject({ pieza: 'pz-1', estado: 'rebotado' });
    expect(tabla[0].entrega_estado).toBe('rebotado');
  });

  it('un provider_message_id desconocido: 200 con sinPieza, sin tocar nada', async () => {
    const r = await postear(JSON.stringify({ type: 'email.bounced', data: { email_id: 're_otro' } }));
    expect(await r.json()).toMatchObject({ sinPieza: true });
    expect(tabla[0].entrega_estado).toBeNull();
  });

  it('un tipo que no rastrea entrega se acusa sin efecto', async () => {
    const r = await postear(JSON.stringify({ type: 'email.opened', data: { email_id: 're_123' } }));
    expect(await r.json()).toMatchObject({ ignorado: 'email.opened' });
    expect(tabla[0].entrega_estado).toBeNull();
  });

  it('base caída: 500 para que Resend reintente — el evento es la única fuente', async () => {
    respuestas.push({ data: null, error: { message: 'db down' } });
    expect((await postear(EVENTO)).status).toBe(500);
  });
});
