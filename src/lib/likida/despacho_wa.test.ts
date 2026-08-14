import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// El flujo completo del despacho por WhatsApp: petición → resumen con el
// nombre RESUELTO → sí/no → crearViaje. Lo que más se prueba es lo que más
// cuesta si falla: que un "sí" viejo o un rol equivocado NO creen un viaje.
// ═══════════════════════════════════════════════════════════════════════════

// El estado pendiente vive aquí — un jsonb de a mentiras por (tenant, tel).
let estadoGuardado: Record<string, unknown> | null = null;
// El sello del aviso (AG-A4): lo que la lectura post-crearViaje encuentra.
let viajeLeido: { avisado_en: string | null } | null = { avisado_en: '2026-08-14T17:00:05Z' };
let errorLecturaViaje: { message: string } | null = null;
// El claim BE-A2: cada estado que pasa por upsert queda anotado aquí — la
// diferencia entre "el pendiente sobrevivió porque nadie lo tocó" y "alguien
// lo RESTAURÓ de verdad" es exactamente esta lista.
let upserts: Record<string, unknown>[] = [];
let errorUpsert: { message: string } | null = null;
// Cuando no es null, el UPDATE condicional del claim devuelve esto tal cual —
// para simular al "sí" que llegó segundo (data: []) o la base caída (error).
let reclamoForzado: { data: { telefono: string }[] | null; error: { message: string } | null } | null = null;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      if (tabla === 'viaje') {
        const v = {
          select: () => v, eq: () => v,
          maybeSingle: async () => ({ data: errorLecturaViaje ? null : viajeLeido, error: errorLecturaViaje }),
        };
        return v;
      }
      if (tabla !== 'wa_conversacion') {
        throw new Error(`despacho_wa solo puede tocar wa_conversacion y viaje; pidió ${tabla}`);
      }
      let actualizando: { estado: Record<string, unknown> } | null = null;
      const b = {
        // En la lectura, `select` abre la cadena y devuelve el builder. En el
        // claim, `select` la CIERRA (update→eq→eq→not→select) y ahí se decide
        // atómico: si había viajePendiente, se borra y sale 1 fila; si no, 0.
        select: () => {
          if (!actualizando) return b;
          if (reclamoForzado) return Promise.resolve(reclamoForzado);
          const habia = Boolean((estadoGuardado as { viajePendiente?: unknown } | null)?.viajePendiente);
          if (habia) estadoGuardado = actualizando.estado;
          return Promise.resolve({ data: habia ? [{ telefono: '5215550000001' }] : [], error: null });
        },
        eq: () => b, not: () => b,
        update: (fila: { estado: Record<string, unknown> }) => { actualizando = fila; return b; },
        maybeSingle: async () => ({ data: estadoGuardado ? { estado: estadoGuardado } : null, error: null }),
        upsert: (fila: { estado: Record<string, unknown> }) => {
          if (errorUpsert) return Promise.resolve({ error: errorUpsert });
          upserts.push(fila.estado);
          estadoGuardado = fila.estado;
          return Promise.resolve({ error: null });
        },
      };
      return b;
    },
  }),
}));
vi.mock('./presupuesto', async (orig) => ({
  ...(await orig() as object),
  acotada: (q: unknown) => q,
}));
const crearViaje = vi.fn(async () => 'viaje-nuevo-1');
vi.mock('./operacion', () => ({ crearViaje: (...a: unknown[]) => crearViaje(...a) }));
const resolver = vi.fn();
vi.mock('./crear_viaje_wa', async (orig) => ({
  ...(await orig() as object),
  resolverOperadorPorNombre: (...a: unknown[]) => resolver(...a),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { atenderDespachoOficina, VIGENCIA_PENDIENTE_MS } = await import('./despacho_wa');
const { OperadorNombreAmbiguo } = await import('./crear_viaje_wa');
const { ConsultaFallida } = await import('./conv');

const JEFE = { tenantId: 't1', rol: 'flota_admin' as const };
const TEL = '5215550000001';
const AHORA = new Date('2026-08-14T17:00:00Z');

beforeEach(() => {
  estadoGuardado = null;
  viajeLeido = { avisado_en: '2026-08-14T17:00:05Z' };
  errorLecturaViaje = null;
  upserts = [];
  errorUpsert = null;
  reclamoForzado = null;
  crearViaje.mockClear();
  resolver.mockReset();
});

describe('lo que NO es despacho', () => {
  it('un saludo devuelve null y no toca el estado', async () => {
    const r = await atenderDespachoOficina(JEFE, TEL, 'hola, ¿cómo van mis viajes?', AHORA);
    expect(r).toBeNull();
    expect(estadoGuardado).toBeNull();
  });
});

describe('la petición y su resumen', () => {
  it('petición completa: guarda el pendiente y el resumen trae el nombre RESUELTO de la base', async () => {
    resolver.mockResolvedValue({ operadorId: 'op-9', nombre: 'Juan Pérez López' });
    const r = await atenderDespachoOficina(JEFE, TEL, 'nuevo viaje para juan perez, Puebla a Monterrey, anticipo 8000', AHORA);
    expect(r).toContain('Juan Pérez López');
    expect(r).toContain('Puebla → Monterrey');
    expect(r).toContain('Responde SÍ');
    expect((estadoGuardado?.viajePendiente as { operadorId: string }).operadorId).toBe('op-9');
    expect(crearViaje).not.toHaveBeenCalled();
  });

  it('petición incompleta: pide lo que falta, sin tocar la base de operadores', async () => {
    const r = await atenderDespachoOficina(JEFE, TEL, 'nuevo viaje para Juan Pérez', AHORA);
    expect(r).toContain('me falta');
    expect(resolver).not.toHaveBeenCalled();
    expect(estadoGuardado).toBeNull();
  });

  it('el contador NO despacha, aunque escriba la petición perfecta', async () => {
    const r = await atenderDespachoOficina({ tenantId: 't1', rol: 'contador' }, TEL, 'nuevo viaje para Juan, Puebla a Monterrey', AHORA);
    expect(r).toContain('tu rol');
    expect(resolver).not.toHaveBeenCalled();
    expect(crearViaje).not.toHaveBeenCalled();
  });

  it('nombre ambiguo: enseña a los candidatos, no elige por el jefe', async () => {
    resolver.mockRejectedValue(new OperadorNombreAmbiguo('2', [
      { operadorId: 'a', nombre: 'José Martínez Ruiz' },
      { operadorId: 'b', nombre: 'José Martínez Cano' },
    ]));
    const r = await atenderDespachoOficina(JEFE, TEL, 'nuevo viaje para Martínez, Puebla a Monterrey', AHORA);
    expect(r).toContain('José Martínez Ruiz');
    expect(r).toContain('José Martínez Cano');
    expect(estadoGuardado).toBeNull();
  });

  it('operador desconocido y base caída se dicen distinto', async () => {
    resolver.mockResolvedValue(null);
    const r1 = await atenderDespachoOficina(JEFE, TEL, 'nuevo viaje para Ramiro, Puebla a Monterrey', AHORA);
    expect(r1).toContain('No tengo un operador activo');

    resolver.mockRejectedValue(new ConsultaFallida('se cayó'));
    const r2 = await atenderDespachoOficina(JEFE, TEL, 'nuevo viaje para Ramiro, Puebla a Monterrey', AHORA);
    expect(r2).toContain('inténtalo de nuevo');
  });
});

describe('la confirmación', () => {
  async function proponer() {
    resolver.mockResolvedValue({ operadorId: 'op-9', nombre: 'Juan Pérez' });
    await atenderDespachoOficina(JEFE, TEL, 'nuevo viaje para Juan, Puebla a Monterrey, anticipo 8000', AHORA);
  }

  it('SÍ crea el viaje con lo confirmado y con fecha_inicio del día de México', async () => {
    await proponer();
    const r = await atenderDespachoOficina(JEFE, TEL, 'sí', new Date(AHORA.getTime() + 60_000));
    expect(r).toContain('Viaje creado');
    expect(crearViaje).toHaveBeenCalledWith('t1', expect.objectContaining({
      operadorId: 'op-9', origen: 'Puebla', destino: 'Monterrey', anticipo: 8000,
      fechaInicio: '2026-08-14',
    }));
    // El pendiente se consumió: otro "sí" ya no crea nada.
    const r2 = await atenderDespachoOficina(JEFE, TEL, 'sí', new Date(AHORA.getTime() + 120_000));
    expect(r2).toBeNull();
    expect(crearViaje).toHaveBeenCalledTimes(1);
  });

  it('NO lo deja y lo dice', async () => {
    await proponer();
    const r = await atenderDespachoOficina(JEFE, TEL, 'no', new Date(AHORA.getTime() + 60_000));
    expect(r).toContain('no creé nada');
    expect(crearViaje).not.toHaveBeenCalled();
  });

  it('un SÍ después de la vigencia NO crea nada — el resumen ya nadie lo recuerda', async () => {
    await proponer();
    const tarde = new Date(AHORA.getTime() + VIGENCIA_PENDIENTE_MS + 60_000);
    const r = await atenderDespachoOficina(JEFE, TEL, 'sí', tarde);
    expect(r).toBeNull();
    expect(crearViaje).not.toHaveBeenCalled();
  });

  it('un mensaje que no es sí/no re-enseña lo que está en juego', async () => {
    await proponer();
    const r = await atenderDespachoOficina(JEFE, TEL, 'oye y de paso revisa las facturas', new Date(AHORA.getTime() + 60_000));
    expect(r).toContain('esperando tu confirmación');
    expect(crearViaje).not.toHaveBeenCalled();
  });

  it('si crearViaje truena, el pendiente SE CONSERVA para reintentar', async () => {
    await proponer();
    crearViaje.mockRejectedValueOnce(new Error('se cayó el insert'));
    const r1 = await atenderDespachoOficina(JEFE, TEL, 'sí', new Date(AHORA.getTime() + 60_000));
    expect(r1).toContain('No se pudo crear');
    const r2 = await atenderDespachoOficina(JEFE, TEL, 'sí', new Date(AHORA.getTime() + 120_000));
    expect(r2).toContain('Viaje creado');
    expect(crearViaje).toHaveBeenCalledTimes(2);
  });
});

describe('el choque 0029 — el operador ya trae un viaje abierto (AG-A3)', () => {
  async function proponer() {
    resolver.mockResolvedValue({ operadorId: 'op-9', nombre: 'Juan Pérez' });
    await atenderDespachoOficina(JEFE, TEL, 'nuevo viaje para Juan, Puebla a Monterrey, anticipo 8000', AHORA);
  }

  it('el Error envuelto de crearViaje se narra como PERMANENTE — nada de "vuelve a responder SÍ" — y limpia el pendiente', async () => {
    await proponer();
    // La forma EXACTA de producción: operacion.ts:570 envuelve el error de
    // Postgres en un Error plano — el `code` 23505 no sobrevive, el nombre
    // del índice sí (viene en el message de Postgres).
    crearViaje.mockRejectedValueOnce(new Error('crearViaje: duplicate key value violates unique constraint "uq_viaje_abierto_por_operador"'));
    const r1 = await atenderDespachoOficina(JEFE, TEL, 'sí', new Date(AHORA.getTime() + 60_000));
    expect(r1).toContain('«Juan Pérez» todavía tiene un viaje abierto');
    expect(r1).toContain('No creé nada');
    expect(r1).not.toContain('Vuelve a responder SÍ');
    // El pendiente se limpió: otro "sí" NO repite el mismo choque.
    const r2 = await atenderDespachoOficina(JEFE, TEL, 'sí', new Date(AHORA.getTime() + 120_000));
    expect(r2).toBeNull();
    expect(crearViaje).toHaveBeenCalledTimes(1);
  });

  it('el error crudo con code 23505 (si algún día llega sin envolver) toma el mismo camino', async () => {
    await proponer();
    crearViaje.mockRejectedValueOnce({ code: '23505', message: 'duplicate key value violates unique constraint "uq_viaje_abierto_por_operador"' });
    const r = await atenderDespachoOficina(JEFE, TEL, 'sí', new Date(AHORA.getTime() + 60_000));
    expect(r).toContain('todavía tiene un viaje abierto');
  });

  it('un choque contra OTRO índice sigue siendo transitorio: conserva el pendiente', async () => {
    await proponer();
    crearViaje.mockRejectedValueOnce(new Error('crearViaje: duplicate key value violates unique constraint "otro_indice_cualquiera"'));
    const r1 = await atenderDespachoOficina(JEFE, TEL, 'sí', new Date(AHORA.getTime() + 60_000));
    expect(r1).toContain('No se pudo crear');
    const r2 = await atenderDespachoOficina(JEFE, TEL, 'sí', new Date(AHORA.getTime() + 120_000));
    expect(r2).toContain('Viaje creado');
  });
});

describe('el claim del pendiente (BE-A2)', () => {
  async function proponer() {
    resolver.mockResolvedValue({ operadorId: 'op-9', nombre: 'Juan Pérez' });
    await atenderDespachoOficina(JEFE, TEL, 'nuevo viaje para Juan, Puebla a Monterrey, anticipo 8000', AHORA);
    // Lo que le importa a este describe es lo que pase DESPUÉS de proponer.
    upserts = [];
  }

  it('el "sí" perdedor (el claim salió sin filas) NO llega a crearViaje y lo dice', async () => {
    await proponer();
    // El otro "sí" de la misma ventana ya se llevó el pendiente entre nuestra
    // lectura y nuestro claim — el UPDATE condicional regresa 0 filas.
    reclamoForzado = { data: [], error: null };
    const r = await atenderDespachoOficina(JEFE, TEL, 'sí', new Date(AHORA.getTime() + 60_000));
    expect(r).toContain('ya la estoy procesando');
    expect(crearViaje).not.toHaveBeenCalled();
  });

  it('el claim que FALLA cierra el paso: sin crearViaje, pidiendo el SÍ de nuevo, pendiente intacto', async () => {
    await proponer();
    reclamoForzado = { data: null, error: { message: 'se cayó el update' } };
    const r = await atenderDespachoOficina(JEFE, TEL, 'sí', new Date(AHORA.getTime() + 60_000));
    expect(r).toContain('mándame el SÍ otra vez');
    expect(crearViaje).not.toHaveBeenCalled();
    // El update que falló no borró nada: el reintento sí encuentra el pendiente.
    expect((estadoGuardado?.viajePendiente as { operadorId: string }).operadorId).toBe('op-9');
  });

  it('error transitorio tras GANAR el claim: el pendiente se RESTAURA con un upsert real', async () => {
    await proponer();
    crearViaje.mockRejectedValueOnce(new Error('se cayó el insert'));
    const r1 = await atenderDespachoOficina(JEFE, TEL, 'sí', new Date(AHORA.getTime() + 60_000));
    expect(r1).toContain('No se pudo crear');
    // La restauración es un upsert VERDADERO con el viajePendiente adentro —
    // no un pendiente que "sobrevivió" porque nadie lo tocó: el claim ya lo
    // había borrado.
    expect(upserts.some((e) =>
      (e as { viajePendiente?: { operadorId?: string } }).viajePendiente?.operadorId === 'op-9',
    )).toBe(true);
    // Y el reintento con otro "sí" funciona de verdad.
    const r2 = await atenderDespachoOficina(JEFE, TEL, 'sí', new Date(AHORA.getTime() + 120_000));
    expect(r2).toContain('Viaje creado');
  });

  it('si la restauración TAMBIÉN falla, el mensaje pide re-dictar — "vuelve a responder SÍ" sería mentira', async () => {
    await proponer();
    crearViaje.mockRejectedValueOnce(new Error('se cayó el insert'));
    errorUpsert = { message: 'tampoco se pudo guardar' };
    const r = await atenderDespachoOficina(JEFE, TEL, 'sí', new Date(AHORA.getTime() + 60_000));
    expect(r).toContain('Díctame el viaje otra vez');
    expect(r).not.toContain('Vuelve a responder SÍ');
  });

  it('el "sí" ganador crea el viaje y responde el éxito de siempre — sin un segundo write de limpieza', async () => {
    await proponer();
    const r = await atenderDespachoOficina(JEFE, TEL, 'sí', new Date(AHORA.getTime() + 60_000));
    expect(r).toContain('Viaje creado');
    expect(crearViaje).toHaveBeenCalledTimes(1);
    // El claim ES el borrado: después del éxito no queda ningún upsert de
    // limpieza que pueda fallar y dejar un pendiente fantasma…
    expect(upserts).toHaveLength(0);
    // …y aun así el pendiente quedó consumido.
    const r2 = await atenderDespachoOficina(JEFE, TEL, 'sí', new Date(AHORA.getTime() + 120_000));
    expect(r2).toBeNull();
    expect(crearViaje).toHaveBeenCalledTimes(1);
  });
});

describe('la verdad sobre el aviso al chofer (AG-A4)', () => {
  async function proponer() {
    resolver.mockResolvedValue({ operadorId: 'op-9', nombre: 'Juan Pérez' });
    await atenderDespachoOficina(JEFE, TEL, 'nuevo viaje para Juan, Puebla a Monterrey, anticipo 8000', AHORA);
  }

  it('avisado_en sellado: se afirma que el aviso YA SALIÓ — nunca un "va en camino" sin el dato', async () => {
    await proponer();
    viajeLeido = { avisado_en: '2026-08-14T17:01:00Z' };
    const r = await atenderDespachoOficina(JEFE, TEL, 'sí', new Date(AHORA.getTime() + 60_000));
    expect(r).toContain('Viaje creado');
    expect(r).toContain('El aviso ya salió a su WhatsApp');
    expect(r).not.toContain('va en camino');
  });

  it('avisado_en NULL: el aviso NO salió y se dice — con la escalación ciega incluida', async () => {
    await proponer();
    viajeLeido = { avisado_en: null };
    const r = await atenderDespachoOficina(JEFE, TEL, 'sí', new Date(AHORA.getTime() + 60_000));
    expect(r).toContain('Viaje creado'); // el viaje SÍ existe: esa mitad es verdad
    expect(r).toContain('el aviso NO salió');
    expect(r).toContain('escalación');
    expect(r).not.toContain('va en camino');
  });

  it('lectura fallida: ni "salió" ni "no salió" — se dice que no se pudo verificar', async () => {
    await proponer();
    errorLecturaViaje = { message: 'se cayó la lectura' };
    const r = await atenderDespachoOficina(JEFE, TEL, 'sí', new Date(AHORA.getTime() + 60_000));
    expect(r).toContain('Viaje creado');
    expect(r).toContain('No pude verificar si el aviso salió');
    expect(r).not.toContain('va en camino');
    expect(r).not.toContain('ya salió');
  });
});
