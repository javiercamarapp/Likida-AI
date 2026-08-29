import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL HILO DE WHATSAPP DE UNA FLOTA NO PUEDE VERLO OTRA.
//
// AUDITORÍA 20, hallazgo 6: la conversación bot↔chofer solo se leía desde
// /admin con `getConversacionesActivas`, que consulta `wa_conversacion` SIN
// filtro de tenant a propósito (es la consola cruzada del superadmin). El
// dueño de la flota no podía leer la de SU PROPIO chofer.
//
// Al abrirle esa lectura al panel del cliente, el riesgo cambia de forma: ya
// no es "no se ve", es "se ve de más". Y el modo de falla es silencioso —
// copiar la consulta de /admin y olvidar el `.eq('tenant_id', …)` no rompe
// nada, no lanza, no aparece en un log: simplemente cada flota empieza a leer
// las conversaciones de todas las demás, con teléfonos y texto libre adentro.
//
// Estas pruebas son el candado, y miran DOS cosas distintas:
//
//   1. que el filtro por tenant EXISTA en la consulta, con el tenant recibido
//      (no uno "por defecto", no uno de sesión);
//   2. que el módulo no ofrezca ninguna forma de leer sin tenant — toda
//      función exportada que consulte `wa_conversacion` lo exige en su firma.
//
// Y una tercera que es de la misma familia: las filas con `tenant_id` NULL
// (conversaciones que el webhook no pudo atribuir a ninguna flota) NO son de
// la primera flota que pregunte. El `.eq()` las deja fuera por la semántica de
// `=` en SQL, y aquí se fija que la consulta sigue siendo un `.eq()` y no un
// `.or(tenant_id.is.null)` que alguien agregue "para no perder filas".
// ═══════════════════════════════════════════════════════════════════════════

type Filtro = { metodo: string; args: unknown[] };

let filtros: Filtro[] = [];
let tablas: string[] = [];
let resp: { data: unknown; error: { message: string } | null; count?: number | null } =
  { data: [], error: null };

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      tablas.push(tabla);
      const nodo: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'limit', 'or', 'in', 'is', 'neq', 'filter']) {
        nodo[m] = (...args: unknown[]) => { filtros.push({ metodo: m, args }); return nodo; };
      }
      nodo.then = (r: (v: unknown) => unknown) => Promise.resolve(resp).then(r);
      return nodo;
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const mod = await import('./conversaciones');
const { getHilosDeFlota, contarHilosDeFlota, TOPE_HILOS } = mod;

beforeEach(() => {
  filtros = [];
  tablas = [];
  resp = { data: [], error: null, count: 0 };
});

/** Los `.eq()` de la consulta, como pares llave→valor. */
function eqs(): Array<[string, unknown]> {
  return filtros.filter((f) => f.metodo === 'eq').map((f) => [String(f.args[0]), f.args[1]]);
}

describe('getHilosDeFlota — el aislamiento por flota', () => {
  it('filtra por `tenant_id` EN LA BASE, con el tenant que recibió', async () => {
    await getHilosDeFlota('t-mia');
    expect(tablas).toEqual(['wa_conversacion']);
    expect(eqs()).toContainEqual(['tenant_id', 't-mia']);
  });

  it('no hay `.or()` que rescate filas de otra flota ni las de tenant NULL', async () => {
    // El `.or(...)` es exactamente cómo se cuela una fuga "para no perder
    // filas": una conversación sin flota atribuida no es de nadie, y dársela
    // a quien pregunte primero sería inventarle un dueño.
    await getHilosDeFlota('t-mia');
    expect(filtros.some((f) => f.metodo === 'or')).toBe(false);
    expect(filtros.some((f) => f.metodo === 'is')).toBe(false);
  });

  it('el tope es un tope y va en la consulta, no un recorte en memoria', async () => {
    await getHilosDeFlota('t-mia');
    expect(filtros).toContainEqual({ metodo: 'limit', args: [TOPE_HILOS] });
  });

  it('el conteo TAMBIÉN va acotado — un total cruzado sería la misma fuga en número', async () => {
    resp = { data: null, error: null, count: 7 };
    await expect(contarHilosDeFlota('t-mia')).resolves.toBe(7);
    expect(eqs()).toContainEqual(['tenant_id', 't-mia']);
  });

  it('toda función exportada que consulte exige el tenant en su firma', () => {
    // `getConversacionesActivas` (lib/admin) recibe CERO argumentos y por eso
    // cruza tenants. Aquí no puede existir una gemela: si alguien agrega una
    // lectura sin tenant, esta prueba la delata.
    for (const [nombre, valor] of Object.entries(mod)) {
      if (typeof valor !== 'function') continue;
      expect(valor.length, `${nombre} tiene que recibir el tenantId`).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('getHilosDeFlota — lo que se le entrega a la pantalla', () => {
  it('mapea operador, viaje y turnos; y una fila sin turnos no inventa ninguno', async () => {
    resp = {
      data: [
        {
          telefono: '5215512345678', updated_at: '2026-08-29T18:00:00+00:00',
          estado: { turns: [{ role: 'user', content: 'ya llegué' }, { role: 'assistant', content: 'gracias' }] },
          operador: { nombre: 'Beto Lara' }, viaje: { folio: 'V-0012' },
        },
        { telefono: '5215599999999', updated_at: '2026-08-28T10:00:00+00:00', estado: {}, operador: null, viaje: null },
      ],
      error: null,
    };
    const r = await getHilosDeFlota('t-mia');
    expect(r[0]).toEqual({
      telefono: '5215512345678',
      operadorNombre: 'Beto Lara',
      viajeFolio: 'V-0012',
      turns: [{ role: 'user', content: 'ya llegué' }, { role: 'assistant', content: 'gracias' }],
      actualizadaEn: '2026-08-29T18:00:00+00:00',
    });
    expect(r[1].turns).toEqual([]);
    expect(r[1].operadorNombre).toBeNull();
  });

  it('un `estado` con basura adentro no se pinta como conversación', async () => {
    // `estado` es jsonb libre: lo que no tenga la forma que `conv.ts` escribe
    // se descarta en vez de renderizarse como un turno vacío.
    resp = {
      data: [{
        telefono: '52155', updated_at: '2026-08-29T18:00:00+00:00',
        estado: { turns: ['hola', { role: 'system', content: 'x' }, { role: 'user', content: 42 }, { role: 'assistant', content: 'ok' }] },
        operador: null, viaje: null,
      }],
      error: null,
    };
    const r = await getHilosDeFlota('t-mia');
    expect(r[0].turns).toEqual([{ role: 'assistant', content: 'ok' }]);
  });

  it('si la lectura falla, LANZA — una lista vacía afirmaría "el bot no habló con nadie"', async () => {
    resp = { data: null, error: { message: 'fetch failed' } };
    await expect(getHilosDeFlota('t-mia')).rejects.toThrow(/getHilosDeFlota: fetch failed/);
  });

  it('el conteo que no se pudo hacer es `null`, nunca 0', async () => {
    resp = { data: null, error: { message: 'fetch failed' }, count: null };
    await expect(contarHilosDeFlota('t-mia')).resolves.toBeNull();
  });
});
