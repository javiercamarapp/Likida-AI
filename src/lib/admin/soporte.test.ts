import { describe, it, expect, vi, beforeEach } from 'vitest';

// getTicketsCruzados — la cola de `ticket_soporte` (0051) cruzada por TODOS
// los tenants, para /admin/soporte.
//
// ── FE-11 (22-ago-2026) ────────────────────────────────────────────────────
// Era un `traerTodo` de la tabla ENTERA (hasta 100,000 filas por el techo de
// `traerTodo`) para pintar una tabla y sumar cuatro KPIs, llamado por TRES
// pantallas en cada carga — y la ficha de cliente lo pedía sin filtro de
// tenant para quedarse con los de uno solo. Ahora lleva `.limit()`, acepta
// `tenantId` que va al `.eq()`, y los conteos salen de `count exact, head`.
//
// El mock registra la CADENA que se armó (tabla, filtros, orden, límite):
// es lo único que distingue "se acotó en la base" de "se acotó en memoria",
// que es exactamente el hallazgo.
type Resp = { data: unknown; error: { message: string } | null; count?: number | null };
const respuestas = new Map<string, Resp>();
/** Una llamada por consulta: qué se pidió y con qué filtros. */
interface Llamada {
  tabla: string; conteo: boolean; limite: number | null;
  eq: Array<[string, unknown]>; not: Array<[string, string, unknown]>;
  in: Array<[string, unknown]>; is: Array<[string, unknown]>; lt: Array<[string, unknown]>;
  order: Array<[string, unknown]>;
}
const llamadas: Llamada[] = [];

function crearBuilder(tabla: string) {
  const l: Llamada = { tabla, conteo: false, limite: null, eq: [], not: [], in: [], is: [], lt: [], order: [] };
  const b: Record<string, unknown> = {};
  const resp = (): Resp => respuestas.get(tabla) ?? { data: [], error: null, count: 0 };
  b.select = (_cols?: unknown, opts?: { count?: string; head?: boolean }) => {
    if (opts?.count === 'exact') { l.conteo = true; llamadas.push(l); return Promise.resolve(resp()) as never; }
    llamadas.push(l);
    return b;
  };
  b.eq = (c: string, v: unknown) => { l.eq.push([c, v]); return b; };
  b.not = (c: string, op: string, v: unknown) => { l.not.push([c, op, v]); return b; };
  b.in = (c: string, v: unknown) => { l.in.push([c, v]); return b; };
  b.is = (c: string, v: unknown) => { l.is.push([c, v]); return b; };
  b.lt = (c: string, v: unknown) => { l.lt.push([c, v]); return b; };
  b.order = (c: string, o?: unknown) => { l.order.push([c, o]); return b; };
  b.limit = (n: number) => { l.limite = n; return Promise.resolve(resp()); };
  return b;
}

// Los conteos encadenan filtros DESPUÉS de `.select(cols, {count})`, así que
// el builder de conteo tiene que seguir siendo encadenable y resolver al
// final. Se distingue por `head`.
function crearBuilderConteo(tabla: string) {
  const l: Llamada = { tabla, conteo: true, limite: null, eq: [], not: [], in: [], is: [], lt: [], order: [] };
  const resp = (): Resp => respuestas.get(`${tabla}#count`) ?? { data: null, error: null, count: 0 };
  const b: Record<string, unknown> = {};
  b.eq = (c: string, v: unknown) => { l.eq.push([c, v]); return b; };
  b.not = (c: string, op: string, v: unknown) => { l.not.push([c, op, v]); return b; };
  b.in = (c: string, v: unknown) => { l.in.push([c, v]); return b; };
  b.is = (c: string, v: unknown) => { l.is.push([c, v]); return b; };
  b.lt = (c: string, v: unknown) => { l.lt.push([c, v]); return b; };
  b.then = (fn: (r: Resp) => unknown) => Promise.resolve(resp()).then(fn);
  llamadas.push(l);
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (t: string) => ({
      select: (cols?: unknown, opts?: { count?: string; head?: boolean }) => (
        opts?.head ? crearBuilderConteo(t) : (crearBuilder(t).select as (c?: unknown, o?: unknown) => unknown)(cols, opts)
      ),
    }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { getTicketsCruzados, contarTickets, TOPE_TICKETS } = await import('./soporte');

// El reloj se INYECTA (mismo criterio que `getTickets(tenantId, ahoraMs)` en
// comercial.ts): una prueba de SLA no puede depender de la hora a la que corra.
const AHORA = new Date('2026-08-14T12:00:00Z').getTime();

// Ya vienen ordenados como los devolvería la base (vence_en asc, nulls al
// final): el orden es de PostgREST desde FE-11, no del `.sort()` de JS.
const TICKETS = [
  {
    id: 'tk1', asunto: 'No baja el PDF', categoria: 'tecnico', prioridad: 'alta',
    estado: 'abierto', abierto_en: '2026-08-13T12:00:00Z', resuelto_en: null,
    // Venció hace 12 horas.
    vence_en: '2026-08-14T00:00:00Z',
    tenant_id: 't1', tenant: { nombre: 'Flota Demo SA de CV' },
  },
  {
    id: 'tk3', asunto: 'Alta de operador', categoria: 'cuenta', prioridad: 'baja',
    estado: 'resuelto', abierto_en: '2026-08-10T12:00:00Z', resuelto_en: '2026-08-11T12:00:00Z',
    vence_en: '2026-08-15T12:00:00Z',
    tenant_id: 't1', tenant: { nombre: 'Flota Demo SA de CV' },
  },
  {
    // SIN SLA pactado: `vence_en` NULL → horasRestantes null, NUNCA 0.
    id: 'tk2', asunto: 'Duda de factura', categoria: 'facturacion', prioridad: 'media',
    estado: 'en_proceso', abierto_en: '2026-08-12T12:00:00Z', resuelto_en: null,
    vence_en: null,
    tenant_id: 't2', tenant: { nombre: 'Transportes del Norte' },
  },
];

describe('getTicketsCruzados', () => {
  beforeEach(() => { respuestas.clear(); llamadas.length = 0; });

  it('cruza tenants, aplana la flota y calcula el reloj de SLA contra el reloj inyectado', async () => {
    respuestas.set('ticket_soporte', { data: TICKETS, error: null });
    const r = await getTicketsCruzados(AHORA);
    expect(r.map((t) => [t.id, t.horasRestantes])).toEqual([['tk1', -12], ['tk3', 24], ['tk2', null]]);
    expect(r[0].tenantNombre).toBe('Flota Demo SA de CV');
    expect(r[2].tenantId).toBe('t2');
  });

  // LA PRUEBA DE FE-11: el orden y el tope viven en la BASE. Ordenar después
  // de recortar enseñaría los 200 tickets equivocados.
  it('pide el orden y el tope a la base — nunca trae la tabla y recorta en memoria', async () => {
    respuestas.set('ticket_soporte', { data: TICKETS, error: null });
    await getTicketsCruzados(AHORA);
    const l = llamadas.find((x) => x.tabla === 'ticket_soporte')!;
    expect(l.limite).toBe(TOPE_TICKETS);
    expect(l.order[0]).toEqual(['vence_en', { ascending: true, nullsFirst: false }]);
    expect(l.eq).toEqual([]);
  });

  // La ficha de cliente pedía TODOS los tickets de TODAS las flotas y se
  // quedaba con los de una: la flota con 12 pagaba la lectura de 40,000.
  it('con tenantId el filtro va al .eq() de la consulta, no a un filter de JS', async () => {
    respuestas.set('ticket_soporte', { data: [TICKETS[0]], error: null });
    await getTicketsCruzados(AHORA, { tenantId: 't1' });
    expect(llamadas.find((x) => x.tabla === 'ticket_soporte')!.eq).toEqual([['tenant_id', 't1']]);
  });

  it('el límite no puede subir por encima del tope, aunque lo pidan', async () => {
    respuestas.set('ticket_soporte', { data: [], error: null });
    await getTicketsCruzados(AHORA, { limite: 99999 });
    expect(llamadas.find((x) => x.tabla === 'ticket_soporte')!.limite).toBe(TOPE_TICKETS);
  });

  it('un join sin nombre de flota se pinta "—", no se inventa ni se cae', async () => {
    respuestas.set('ticket_soporte', { data: [{ ...TICKETS[0], tenant: null }], error: null });
    const r = await getTicketsCruzados(AHORA);
    expect(r[0].tenantNombre).toBe('—');
    expect(r[0].tenantId).toBe('t1');
  });

  it('cola vacía: lista vacía de verdad, no un error', async () => {
    expect(await getTicketsCruzados(AHORA)).toEqual([]);
  });

  it('un fallo de Supabase LANZA — una base caída no se lee como "nadie necesita nada"', async () => {
    respuestas.set('ticket_soporte', { data: null, error: { message: 'fetch failed' } });
    await expect(getTicketsCruzados(AHORA)).rejects.toThrow('fetch failed');
  });
});

describe('contarTickets', () => {
  beforeEach(() => { respuestas.clear(); llamadas.length = 0; });

  it('los cuatro conteos son count exact head — la base cuenta, no viajan filas', async () => {
    respuestas.set('ticket_soporte#count', { data: null, error: null, count: 8123 });
    expect(await contarTickets(AHORA)).toEqual({
      abiertos: 8123, vencidos: 8123, sinSla: 8123, cerrados: 8123,
    });
    expect(llamadas).toHaveLength(4);
    expect(llamadas.every((l) => l.conteo)).toBe(true);
    // "vencido" es SLA pasado contra el reloj INYECTADO, no contra el de quien
    // renderiza: dos relojes en la misma pantalla se cuentan historias.
    expect(llamadas[1].lt).toEqual([['vence_en', new Date(AHORA).toISOString()]]);
    // "sin SLA" NO es vencido: es `vence_en is null`.
    expect(llamadas[2].is).toEqual([['vence_en', null]]);
  });

  it('con tenantId, los cuatro llevan el .eq del tenant', async () => {
    respuestas.set('ticket_soporte#count', { data: null, error: null, count: 3 });
    await contarTickets(AHORA, { tenantId: 't-9' });
    expect(llamadas.every((l) => l.eq.some(([c, v]) => c === 'tenant_id' && v === 't-9'))).toBe(true);
  });

  // `null` ≠ 0: un cero aquí se lee como "nadie necesita nada".
  it('un fallo devuelve null en esa cuenta, nunca cero', async () => {
    respuestas.set('ticket_soporte#count', { data: null, error: { message: 'caída' }, count: null });
    expect(await contarTickets(AHORA)).toEqual({
      abiertos: null, vencidos: null, sinSla: null, cerrados: null,
    });
  });
});
