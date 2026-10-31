import { describe, it, expect, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// A38-SEG-01 (ALTO, abierto desde la auditoría 38) — la regla de oro de la ola
// («nada proactivo a un chofer con baja u oposición ARCO») se aplicaba en 2 de
// 3 emisores. Este, el tercero, la reimplementaba a mano y su `select` NO pedía
// `oposicion_automatizada`: un operador que ejerció su derecho de oposición al
// tratamiento automatizado (`operador.oposicion_automatizada`, mig. 0100) no
// recibía la solicitud del Agente 5 pero SÍ el aviso de tope de jornada, el
// mismo día y al mismo teléfono.
//
// Los dos emisores que sí la honran usan el mismo predicado, y es el que se
// copia aquí:
//   `conductor/repo.ts:184`  → activo !== false && !oposicion_automatizada
//   `convenios/repo.ts:656`  → activo !== false && !oposicion_automatizada
//
// La compuerta de `enviarWa` (`alerta_tope_datos.ts:126-137`) tampoco la mira,
// así que el único lugar donde se puede cerrar sin duplicar la regla es aquí:
// sin teléfono no hay envío proactivo, que es exactamente como ya se trata la
// baja. El expediente del operador sigue siendo evaluable (el encargado sí
// recibe su escalación): lo que se corta es el mensaje AL CHOFER.
// ═══════════════════════════════════════════════════════════════════════════

const fila: Record<string, unknown> = {};
let columnas = '';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: (cols: string) => {
        columnas = cols;
        const chain = { eq: () => chain, maybeSingle: async () => ({ data: fila, error: null }) };
        return chain;
      },
    }),
  }),
}));
vi.mock('@/lib/meta/enviar_con_fallback', () => ({ enviarConFallback: vi.fn() }));
vi.mock('../conductor/repo', () => ({ leerAgenteChoferHabilitado: vi.fn(), leerConfigConductor: vi.fn() }));
// El merge de la 40 trajo `compuerta_operador.ts`, que al cargarse lee TRES
// exports de este modulo (`trabajo.ts:5` de `compuerta_operador.ts`). El doble
// tiene que ofrecerlos los tres o el modulo no se puede importar.
vi.mock('../conductor/trabajo', () => ({
  hayEmergenciaDeTelefono: vi.fn(),
  leerViajesAbiertosDeTelefono: vi.fn(),
  leerMuestrasGps: vi.fn(),
  leerSitiosGeometriaDeViajes: vi.fn(),
}));
vi.mock('../conductor/escalamiento', () => ({ destinatariosEscalacion: vi.fn() }));
vi.mock('./repo', () => ({ asientosDeJornada: vi.fn(), leerPolitica: vi.fn() }));
vi.mock('../presupuesto', () => ({ acotada: async <T,>(p: PromiseLike<T>) => p }));

const { puertosAlertaReales } = await import('./alerta_tope_datos');

const leer = (f: Record<string, unknown>) => {
  for (const k of Object.keys(fila)) delete fila[k];
  Object.assign(fila, f);
  return puertosAlertaReales.datosDelOperador('t1', 'op-1');
};

describe('A38-SEG-01 — el aviso de jornada honra la oposición ARCO', () => {
  it('operador con oposición ARCO vigente: SIN teléfono, no se le puede escribir', async () => {
    const d = await leer({ nombre: 'José Ramírez', telefono: '5215550001', terminal_id: 'T1', activo: true, oposicion_automatizada: '2026-10-01T00:00:00Z' });
    expect(d).toEqual({ nombre: 'José Ramírez', telefono: null, terminalId: 'T1' });
  });

  it('operador sano: sí lleva teléfono (la regla no apaga el aviso de todos)', async () => {
    const d = await leer({ nombre: 'Ana Ruiz', telefono: '5215550002', terminal_id: 'T2', activo: true, oposicion_automatizada: null });
    expect(d).toEqual({ nombre: 'Ana Ruiz', telefono: '5215550002', terminalId: 'T2' });
  });

  it('operador dado de baja: SIN teléfono (la conducta que ya existía, de control)', async () => {
    const d = await leer({ nombre: 'Luis Paz', telefono: '5215550003', terminal_id: null, activo: false, oposicion_automatizada: null });
    expect(d).toEqual({ nombre: 'Luis Paz', telefono: null, terminalId: null });
  });

  it('baja Y oposición a la vez: SIN teléfono', async () => {
    const d = await leer({ nombre: 'Eva Mora', telefono: '5215550004', terminal_id: 'T1', activo: false, oposicion_automatizada: '2026-09-09T00:00:00Z' });
    expect(d?.telefono).toBeNull();
  });

  it('la consulta PIDE la columna: sin ella la regla es indecidible por construcción', async () => {
    await leer({ nombre: 'x', telefono: '1', terminal_id: null, activo: true, oposicion_automatizada: null });
    expect(columnas).toMatch(/\boposicion_automatizada\b/);
  });
});
