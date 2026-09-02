import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24, DAT-5 (ALTO) — EL «SÍ» DEL JEFE ENTRA POR OTRA FORMA DEL
// MISMO NÚMERO Y TIENE QUE ENCONTRAR SU PENDIENTE.
//
// Meta entrega el wa_id unas veces como `5219993700779` (con el 1 de móvil) y
// otras como `529993700779`. `despacho_wa` y `asignar_wa` leían y escribían
// con IGUALDAD EXACTA sobre el texto crudo, así que el pendiente se guardaba
// bajo una forma y se buscaba bajo la otra: el jefe contestaba «sí» y el
// asistente le volvía a preguntar «¿Confirmas?», o —peor— el upsert estrenaba
// una SEGUNDA conversación y con el índice de la 0274
// (`telefono_normalizado(telefono)` único por tenant) reventaba con 23505.
//
// A diferencia del arnés de `despacho_wa.test.ts`, esta "base" SÍ está
// indexada por teléfono: es lo único que hace visible el defecto.
// ═══════════════════════════════════════════════════════════════════════════

/** La tabla `wa_conversacion` de a mentiras, con el teléfono como llave real. */
const filas = new Map<string, { telefono: string; estado: Record<string, unknown> }>();
/** Cada `upsert` que llegó, para poder afirmar que NO se estrenó una segunda fila. */
let telefonosEscritos: string[] = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      if (tabla === 'viaje') {
        const v: Record<string, unknown> = {};
        Object.assign(v, {
          select: () => v, eq: () => v,
          maybeSingle: async () => ({ data: { avisado_en: '2026-08-14T17:00:05Z' }, error: null }),
        });
        return v;
      }
      if (tabla !== 'wa_conversacion') throw new Error(`tabla inesperada: ${tabla}`);

      let buscados: string[] = [];
      let actualizando: { estado: Record<string, unknown> } | null = null;
      const halladas = () => buscados.map((t) => filas.get(t)).filter((f) => f !== undefined);

      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => {
          if (!actualizando) return b;
          // El claim atómico: update…not(pendiente is null)…select.
          const f = halladas()[0];
          const habia = Boolean(f && (f.estado as { viajePendiente?: unknown }).viajePendiente);
          if (habia && f) f.estado = actualizando.estado;
          return Promise.resolve({ data: habia && f ? [{ telefono: f.telefono }] : [], error: null });
        },
        eq: () => b,
        // La única parte del arnés que de verdad filtra: la lista de variantes.
        in: (_col: string, vals: string[]) => { buscados = vals; return b; },
        not: () => b, order: () => b, limit: () => b,
        update: (fila: { estado: Record<string, unknown> }) => { actualizando = fila; return b; },
        maybeSingle: async () => {
          const f = halladas()[0];
          return { data: f ? { telefono: f.telefono, estado: f.estado } : null, error: null };
        },
        upsert: (fila: { telefono: string; estado: Record<string, unknown> }) => {
          telefonosEscritos.push(fila.telefono);
          filas.set(fila.telefono, { telefono: fila.telefono, estado: fila.estado });
          return Promise.resolve({ error: null });
        },
      });
      return b;
    },
  }),
}));

vi.mock('./presupuesto', async (orig) => ({ ...(await orig() as object), acotada: (q: unknown) => q }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const crearViaje = vi.fn(async (..._a: unknown[]) => 'viaje-nuevo-1');
vi.mock('./operacion', () => ({ crearViaje: (...a: unknown[]) => crearViaje(...a) }));

const resolver = vi.fn();
const resolverUnidad = vi.fn();
vi.mock('./crear_viaje_wa', async (orig) => ({
  ...(await orig() as object),
  resolverOperadorPorNombre: (...a: unknown[]) => resolver(...a),
  resolverUnidadPorEconomico: (...a: unknown[]) => resolverUnidad(...a),
}));

const { atenderDespachoOficina } = await import('./despacho_wa');

const JEFE = { tenantId: 't1', rol: 'flota_admin' as const };
/** Las dos formas del MISMO número, tal como las entrega Meta. */
const CON_1 = '5219993700779';
const SIN_1 = '529993700779';
const AHORA = new Date('2026-08-14T17:00:00Z');
const PETICION = 'nuevo viaje para juan perez, Puebla a Monterrey, anticipo 8000';

beforeEach(() => {
  filas.clear();
  telefonosEscritos = [];
  crearViaje.mockClear();
  resolver.mockReset();
  resolverUnidad.mockReset();
  resolver.mockResolvedValue({ operadorId: 'op-9', nombre: 'Juan Pérez López' });
});

describe('DAT-5 · el pendiente se encuentra aunque el número cambie de forma', () => {
  it('pide con 521… y confirma con 52…: el viaje SE CREA', async () => {
    const propuesta = await atenderDespachoOficina(JEFE, CON_1, PETICION, AHORA);
    expect(propuesta).toContain('Responde SÍ');
    expect(filas.size).toBe(1);

    // El «sí» entra por la otra puerta del mismo teléfono.
    const r = await atenderDespachoOficina(JEFE, SIN_1, 'sí', new Date(AHORA.getTime() + 30_000));

    expect(crearViaje).toHaveBeenCalledTimes(1);
    expect(r).not.toContain('Responde SÍ');
  });

  it('la confirmación NO estrena una segunda conversación', async () => {
    await atenderDespachoOficina(JEFE, CON_1, PETICION, AHORA);
    await atenderDespachoOficina(JEFE, SIN_1, 'sí', new Date(AHORA.getTime() + 30_000));

    // Una sola fila, y todas las escrituras contra el MISMO teléfono: es lo
    // que evita el 23505 contra `uq_wa_conversacion_tenant_telefono_norm`.
    expect(filas.size).toBe(1);
    expect([...new Set(telefonosEscritos)]).toEqual([CON_1]);
  });

  it('el «sí» sigue ganándose una sola vez, aunque llegue por las dos formas', async () => {
    await atenderDespachoOficina(JEFE, CON_1, PETICION, AHORA);
    await atenderDespachoOficina(JEFE, SIN_1, 'sí', new Date(AHORA.getTime() + 30_000));
    await atenderDespachoOficina(JEFE, CON_1, 'sí', new Date(AHORA.getTime() + 40_000));

    // El claim atómico borró el pendiente en el primero: el segundo no crea nada.
    expect(crearViaje).toHaveBeenCalledTimes(1);
  });

  it('el número de OTRO jefe no reclama este pendiente', async () => {
    await atenderDespachoOficina(JEFE, CON_1, PETICION, AHORA);
    const r = await atenderDespachoOficina(JEFE, '5215550009999', 'sí', new Date(AHORA.getTime() + 30_000));
    expect(crearViaje).not.toHaveBeenCalled();
    expect(r).toBeNull();
  });
});
