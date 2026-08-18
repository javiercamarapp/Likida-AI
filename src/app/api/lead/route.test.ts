import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL LEAD DE /getdemo — lo que se fija:
//  · CORS cerrado: solo likida.ai recibe la cabecera. Un origen cualquiera no,
//    porque este endpoint ESCRIBE en `prospecto`.
//  · NUNCA rompe al visitante: base caída, JSON raro o empresa vacía → 200.
//    Si esto devolviera error, el formulario se traba y se pierde la CITA, que
//    vale más que el lead.
//  · Un lead que vuelve no es dos prospectos, y al deduplicar solo AGREGA
//    datos: jamás borra el teléfono que el censo ya tenía.
//  · Las unidades se leen de texto libre y un 0 es `null`, no cero.
// ═══════════════════════════════════════════════════════════════════════════

const llamadas: Array<{ op: string; payload: Record<string, unknown> }> = [];
const respuestas: Array<{ data: unknown; error: { message: string } | null }> = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b,
        eq: () => b,
        limit: () => b,
        update: (p: Record<string, unknown>) => { llamadas.push({ op: 'update', payload: p }); return b; },
        insert: (p: Record<string, unknown>) => { llamadas.push({ op: 'insert', payload: p }); return b; },
        then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve().then(() => respuestas.shift() ?? { data: [], error: null }).then(res, rej),
      });
      return b;
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async () => true,
  bodyExcede: () => false,
  clientIp: () => '1.2.3.4',
}));

const { POST, OPTIONS } = await import('./route');

const LANDING = 'https://likida.ai';

function postear(cuerpo: unknown, origen: string | null = LANDING) {
  return POST(new Request('https://app.likida.ai/api/lead', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origen ? { origin: origen } : {}) },
    body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
  }));
}

const LEAD = { empresa: 'Transportes GAL', nombre: 'Alejandro', apellido: 'Vargas',
  correo: 'a@gal.mx', whatsapp: '8112345678', unidades: '40' };

beforeEach(() => { llamadas.length = 0; respuestas.length = 0; });

describe('CORS: la lista de orígenes es cerrada', () => {
  it('likida.ai sí recibe la cabecera', async () => {
    respuestas.push({ data: [], error: null }, { data: null, error: null });
    const r = await postear(LEAD);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(LANDING);
  });

  it('un origen cualquiera NO la recibe: escribir en prospecto no es para todos', async () => {
    respuestas.push({ data: [], error: null }, { data: null, error: null });
    const r = await postear(LEAD, 'https://sitio-ajeno.example');
    expect(r.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('el preflight contesta 204', async () => {
    const r = await OPTIONS(new Request('https://app.likida.ai/api/lead', {
      method: 'OPTIONS', headers: { origin: LANDING },
    }));
    expect(r.status).toBe(204);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(LANDING);
  });
});

describe('el lead se guarda', () => {
  it('uno nuevo entra con fuente landing y las unidades como número', async () => {
    respuestas.push({ data: [], error: null }, { data: null, error: null });
    const r = await postear(LEAD);
    expect(r.status).toBe(200);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].op).toBe('insert');
    expect(llamadas[0].payload).toMatchObject({
      empresa: 'Transportes GAL',
      contacto_nombre: 'Alejandro Vargas',
      correo: 'a@gal.mx',
      telefono: '8112345678',
      unidades: 40,
      fuente: 'landing',
      estado: 'nuevo',
    });
  });

  it('"40 camiones" se lee como 40 — el campo es texto libre', async () => {
    respuestas.push({ data: [], error: null }, { data: null, error: null });
    await postear({ ...LEAD, unidades: '40 camiones' });
    expect(llamadas[0].payload.unidades).toBe(40);
  });

  it('un 0 se guarda como null: "no se sabe" no es "flota sin camiones"', async () => {
    respuestas.push({ data: [], error: null }, { data: null, error: null });
    await postear({ ...LEAD, unidades: '0' });
    expect(llamadas[0].payload.unidades).toBeNull();
  });
});

describe('deduplicar sin destruir', () => {
  it('un correo ya conocido ACTUALIZA, no inserta un segundo prospecto', async () => {
    respuestas.push({ data: [{ id: 'p-1', estado: 'negociacion' }], error: null }, { data: null, error: null });
    await postear(LEAD);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].op).toBe('update');
  });

  it('no toca `estado`: un prospecto en negociación no vuelve a "nuevo"', async () => {
    respuestas.push({ data: [{ id: 'p-1', estado: 'negociacion' }], error: null }, { data: null, error: null });
    await postear(LEAD);
    expect(llamadas[0].payload).not.toHaveProperty('estado');
    expect(llamadas[0].payload).not.toHaveProperty('fuente');
  });

  it('un lead SIN whatsapp no borra el teléfono que el censo ya traía', async () => {
    respuestas.push({ data: [{ id: 'p-1', estado: 'nuevo' }], error: null }, { data: null, error: null });
    await postear({ ...LEAD, whatsapp: '', unidades: '' });
    expect(llamadas[0].payload).not.toHaveProperty('telefono');
    expect(llamadas[0].payload).not.toHaveProperty('unidades');
    expect(llamadas[0].payload).toMatchObject({ empresa: 'Transportes GAL' });
  });
});

describe('la red de seguridad de la 0137', () => {
  it('si la columna `unidades` no existe todavía, el lead SE SALVA en notas', async () => {
    respuestas.push(
      { data: [], error: null },
      { data: null, error: { message: 'column "unidades" of relation "prospecto" does not exist' } },
      { data: null, error: null },
    );
    const r = await postear(LEAD);
    expect(r.status).toBe(200);
    expect(llamadas).toHaveLength(2);
    expect(llamadas[1].payload).not.toHaveProperty('unidades');
    expect(llamadas[1].payload.notas).toContain('40');
    expect(llamadas[1].payload).toMatchObject({ empresa: 'Transportes GAL', fuente: 'landing' });
  });
});

describe('nunca rompe el flujo del visitante', () => {
  it('si la base falla, contesta 200 igual: la cita vale más que el lead', async () => {
    respuestas.push({ data: null, error: { message: 'db down' } });
    const r = await postear(LEAD);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });

  it('sin empresa no se escribe nada, pero tampoco se protesta', async () => {
    const r = await postear({ ...LEAD, empresa: '   ' });
    expect(r.status).toBe(200);
    expect(llamadas).toHaveLength(0);
  });

  it('un JSON roto sí es 400: eso es el formulario mal armado, no el visitante', async () => {
    const r = await postear('{roto');
    expect(r.status).toBe(400);
  });
});
