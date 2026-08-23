import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL CIERRE DE LA CORRIDA GLOBAL DE COBRANZA — el cable (B6, auditoría 4).
//
// El hallazgo: los bugs de cableado de notificaciones pasaban con suite verde
// porque ningún test de cobranza mencionaba notificaciones. Lo que este
// archivo fija es que `ejecutarCobranzaGlobal` entrega el MAPA correcto a
// `avisarCorridasPorFlota('cobranza', ...)`: la flota que corrió bien entra
// con `null` (es lo que rearma el filo del anti-ruido — ver
// notificaciones_corrida.test.ts, que prueba el motor), y la flota cuya
// corrida LANZÓ entra con su error. Un refactor que llame al aviso solo en el
// catch —o que no lo llame— se pone rojo aquí.
//
// El motor de avisos y la bitácora se mockean ENTEROS: aquí se mira la
// llamada, no la base que tocan por dentro.
// ═══════════════════════════════════════════════════════════════════════════

const { avisarCorridasPorFlota, registrarCorrida } = vi.hoisted(() => ({
  avisarCorridasPorFlota: vi.fn(),
  registrarCorrida: vi.fn(),
}));
vi.mock('./notificaciones', () => ({ avisarCorridasPorFlota }));
vi.mock('./corridas', () => ({ registrarCorrida }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/meta/client', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  sendText: vi.fn(), sendTemplate: vi.fn(),
  motivoDeFalloWhatsApp: (error: string) => error,
  enviarTexto: async () => ({ ok: false, error: 'rechazado', codigo: 131047, status: 400 }),
}));

/** El último tenant filtrado con `.eq('tenant_id', …)` — es lo que decide qué
 *  contesta `maybeSingle` (la config de ESA flota). */
const estado = vi.hoisted(() => ({ tenant: '' }));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const b: Record<string, unknown> = {};
      const chain = () => b;
      Object.assign(b, {
        select: chain, in: chain, not: chain, limit: chain, order: chain,
        is: chain, lt: chain, delete: chain,
        eq: (col: string, val: unknown) => {
          if (col === 'tenant_id') estado.tenant = String(val);
          return b;
        },
        // La config de cobranza: `t-rota` no se puede leer (su corrida entera
        // lanza en `leerConfigCobranza`); las demás caen a los defaults.
        maybeSingle: async () =>
          estado.tenant === 't-rota'
            ? { data: null, error: { message: 'PostgREST 503' } }
            : { data: null, error: null },
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve(tabla === 'viaje'
            // La consulta global de tenants con viajes vivos.
            ? { data: [{ tenant_id: 't-buena' }, { tenant_id: 't-rota' }], error: null }
            : { data: [], error: null }).then(res),
        // `traerTodo` pagina con `.range(d, h)`: el mock rebana como lo haría
        // el servidor — la página más allá del final llega vacía y cierra.
        range: (d: number, h: number) =>
          Promise.resolve({
            data: (tabla === 'viaje' ? [{ tenant_id: 't-buena' }, { tenant_id: 't-rota' }] : []).slice(d, h + 1),
            error: null,
          }),
      });
      return b;
    },
  }),
}));

const { ejecutarCobranzaGlobal } = await import('./cobranza');

// Domingo 11:00 CDMX: fuera de la ventana default (dias 1-6). La flota buena
// termina en `omitido` sin tocar más base — lo que se prueba es el CIERRE,
// no los envíos (esos viven en cobranza_reloj.test.ts).
const AHORA = new Date('2026-08-16T17:00:00Z');

beforeEach(() => {
  estado.tenant = '';
  avisarCorridasPorFlota.mockReset();
  avisarCorridasPorFlota.mockResolvedValue(undefined);
  registrarCorrida.mockReset();
  registrarCorrida.mockResolvedValue(undefined);
});

describe('ejecutarCobranzaGlobal cierra la corrida con el mapa correcto', () => {
  it('la flota que corrió bien va con null; la que lanzó, con SU error', async () => {
    const r = await ejecutarCobranzaGlobal(AHORA);

    expect(r.tenants).toBe(2);
    expect(avisarCorridasPorFlota).toHaveBeenCalledTimes(1);
    const [agente, corridas, ahora] = avisarCorridasPorFlota.mock.calls[0] as
      [string, Map<string, unknown>, Date];
    expect(agente).toBe('cobranza');
    expect(corridas.size).toBe(2);
    // El éxito TAMBIÉN entra: es lo que rearma el filo del anti-ruido. Un
    // cierre que solo reporta fallos deja la racha de la flota sana arriba
    // para siempre (el bug que notificaciones_corrida.test.ts documenta).
    expect(corridas.get('t-buena')).toBeNull();
    expect(corridas.get('t-rota')).toBeInstanceOf(Error);
    expect((corridas.get('t-rota') as Error).message).toContain('PostgREST 503');
    // Con el MISMO reloj de la corrida, no uno propio.
    expect(ahora).toBe(AHORA);
  });

  it('la bitácora se anota por flota: ok para la sana, fallo para la rota', async () => {
    await ejecutarCobranzaGlobal(AHORA);

    const porTenant = new Map(registrarCorrida.mock.calls.map((c) => [c[0], c[2] as { estado: string }]));
    expect(registrarCorrida.mock.calls.every((c) => c[1] === 'cobranza')).toBe(true);
    expect(porTenant.get('t-buena')?.estado).toBe('ok');
    expect(porTenant.get('t-rota')?.estado).toBe('fallo');
  });

  it('un fallo del aviso de bitácora no tumba la corrida global', async () => {
    // `registrarCorrida` promete no lanzar; la corrida no cuelga de esa
    // promesa — se prueba con la forma de fallo que la promesa NO cubre.
    registrarCorrida.mockRejectedValue(new Error('bitácora caída'));
    await expect(ejecutarCobranzaGlobal(AHORA)).resolves.toMatchObject({ tenants: 2 });
  });
});
