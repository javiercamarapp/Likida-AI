import { describe, it, expect, vi, beforeEach } from 'vitest';

// getTicketsCruzados — la cola de `ticket_soporte` (0051) cruzada por TODOS
// los tenants, para /admin/soporte. Mismo mock paginador que negocio.test.ts:
// `range` REBANA como PostgREST (no devuelve la tabla entera en cada página) y
// `count` solo viene si la consulta lo pidió con `{ count: 'exact' }` — la
// ficción de un mock que siempre da todo es justo la que dejaba pasar el
// recorte silencioso.
type Resp = { data: unknown; error: { message: string } | null; count?: number | null };
const respuestas = new Map<string, Resp>();
const rangos = new Map<string, Array<[number, number]>>();

function crearBuilder(tabla: string) {
  const raw = (): Resp => respuestas.get(tabla) ?? { data: [], error: null };
  let pidioConteo = false;
  const b: Record<string, unknown> = {};
  b.order = () => b; // el orden lo simula el fixture: se declara ya ordenado
  b.select = (_cols?: unknown, opts?: { count?: string }) => {
    if (opts?.count === 'exact') pidioConteo = true;
    return b;
  };
  b.range = (desde: number, hasta: number) => {
    const r = raw();
    if (!rangos.has(tabla)) rangos.set(tabla, []);
    rangos.get(tabla)!.push([desde, hasta]);
    if (r.error) return Promise.resolve(r);
    const todas = (r.data ?? []) as Array<Record<string, unknown>>;
    return Promise.resolve({
      data: todas.slice(desde, hasta + 1),
      error: null,
      count: pidioConteo ? todas.length : null,
    });
  };
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (t: string) => crearBuilder(t) }),
}));

const { getTicketsCruzados } = await import('./soporte');

// El reloj se INYECTA (mismo criterio que `getTickets(tenantId, ahoraMs)` en
// comercial.ts): una prueba de SLA no puede depender de la hora a la que corra.
const AHORA = new Date('2026-08-14T12:00:00Z').getTime();

const TICKETS = [
  {
    id: 'tk1', asunto: 'No baja el PDF', categoria: 'tecnico', prioridad: 'alta',
    estado: 'abierto', abierto_en: '2026-08-13T12:00:00Z', resuelto_en: null,
    // Venció hace 12 horas.
    vence_en: '2026-08-14T00:00:00Z',
    tenant_id: 't1', tenant: { nombre: 'Flota Demo SA de CV' },
  },
  {
    // SIN SLA pactado: `vence_en` NULL → horasRestantes null, NUNCA 0.
    id: 'tk2', asunto: 'Duda de factura', categoria: 'facturacion', prioridad: 'media',
    estado: 'en_proceso', abierto_en: '2026-08-12T12:00:00Z', resuelto_en: null,
    vence_en: null,
    tenant_id: 't2', tenant: { nombre: 'Transportes del Norte' },
  },
  {
    id: 'tk3', asunto: 'Alta de operador', categoria: 'cuenta', prioridad: 'baja',
    estado: 'resuelto', abierto_en: '2026-08-10T12:00:00Z', resuelto_en: '2026-08-11T12:00:00Z',
    // Le quedan 24 horas (aunque ya está resuelto — el reloj es dato crudo,
    // filtrar por estado es de la pantalla).
    vence_en: '2026-08-15T12:00:00Z',
    tenant_id: 't1', tenant: { nombre: 'Flota Demo SA de CV' },
  },
];

describe('getTicketsCruzados', () => {
  beforeEach(() => { respuestas.clear(); rangos.clear(); });

  it('cruza tenants, aplana la flota y ordena como cola: lo más urgente primero, sin-SLA al final', async () => {
    respuestas.set('ticket_soporte', { data: TICKETS, error: null });
    const r = await getTicketsCruzados(AHORA);
    expect(r).toEqual([
      {
        id: 'tk1', asunto: 'No baja el PDF', categoria: 'tecnico', prioridad: 'alta',
        estado: 'abierto', abiertoEn: '2026-08-13T12:00:00Z', resueltoEn: null,
        venceEn: '2026-08-14T00:00:00Z', horasRestantes: -12,
        tenantId: 't1', tenantNombre: 'Flota Demo SA de CV',
      },
      {
        id: 'tk3', asunto: 'Alta de operador', categoria: 'cuenta', prioridad: 'baja',
        estado: 'resuelto', abiertoEn: '2026-08-10T12:00:00Z', resueltoEn: '2026-08-11T12:00:00Z',
        venceEn: '2026-08-15T12:00:00Z', horasRestantes: 24,
        tenantId: 't1', tenantNombre: 'Flota Demo SA de CV',
      },
      {
        // NULL ≠ 0: sin SLA no hay reloj, y por eso va al final de la cola.
        id: 'tk2', asunto: 'Duda de factura', categoria: 'facturacion', prioridad: 'media',
        estado: 'en_proceso', abiertoEn: '2026-08-12T12:00:00Z', resueltoEn: null,
        venceEn: null, horasRestantes: null,
        tenantId: 't2', tenantNombre: 'Transportes del Norte',
      },
    ]);
  });

  it('un join sin nombre de flota se pinta "—", no se inventa ni se cae', async () => {
    respuestas.set('ticket_soporte', { data: [{ ...TICKETS[0], tenant: null }], error: null });
    const r = await getTicketsCruzados(AHORA);
    expect(r[0].tenantNombre).toBe('—');
    expect(r[0].tenantId).toBe('t1');
  });

  it('cola vacía: lista vacía de verdad (0 filas contadas), no un error', async () => {
    const r = await getTicketsCruzados(AHORA);
    expect(r).toEqual([]);
  });

  it('un fallo de Supabase LANZA — una base caída no se lee como "nadie necesita nada"', async () => {
    respuestas.set('ticket_soporte', { data: null, error: { message: 'fetch failed' } });
    await expect(getTicketsCruzados(AHORA)).rejects.toThrow('fetch failed');
  });

  it('pide el total en la primera página: una cola chica cuesta UNA consulta', async () => {
    respuestas.set('ticket_soporte', { data: TICKETS, error: null });
    await getTicketsCruzados(AHORA);
    expect(rangos.get('ticket_soporte')).toEqual([[0, 999]]);
  });
});
