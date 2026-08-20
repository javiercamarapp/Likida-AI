import { beforeEach, describe, expect, it, vi } from 'vitest';

// ═══ El IO del ciclo de oficina (informe PDF + pregunta libre) ═════════════

const enviado: Array<{ tel: string; url: string; nombre: string }> = [];
// El contrato REAL de `sendDocument` (meta/client.ts:371): un objeto
// discriminado, nunca un string. El mock devolvía `'wamid-1'` —el contrato
// viejo— y por eso la suite no podía ver que `if (!enviado)` es código muerto.
let respuestaEnvio: { ok: true; id: string | null } | { ok: false; error: string; codigo?: number } =
  { ok: true, id: 'wamid-1' };
let subida: { error: { message: string } | null } = { error: null };
let firmada: { data: { signedUrl: string } | null; error: null } = { data: { signedUrl: 'https://firmada/x.pdf' }, error: null };
let anticipos: { data: Array<{ anticipo: number }> | null; error: { message: string } | null } = { data: [{ anticipo: 8000 }, { anticipo: 5000 }], error: null };

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (_tabla: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { nombre: 'Transportes Prueba' }, error: null }),
          in: () => Promise.resolve(anticipos),
        }),
      }),
    }),
    storage: {
      from: () => ({
        upload: async () => subida,
        createSignedUrl: async () => firmada,
      }),
    },
  }),
}));
vi.mock('./operacion', () => ({
  getTableroOperacion: async () => ({ viajesActivos: 3, sinUnidad: 1, podPendientes: 2 }),
}));
vi.mock('@/lib/meta/client', () => ({
  sendDocument: async (tel: string, url: string, nombre: string) => { enviado.push({ tel, url, nombre }); return respuestaEnvio; },
}));
const analista = vi.fn(async (_o: unknown) => ({ bloques: [{ tipo: 'texto', texto: 'Van bien.' }] }));
vi.mock('@/lib/agents/analista', () => ({ ejecutarAnalista: (o: unknown) => analista(o) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { mandarInformePdf, atenderPreguntaLibre } = await import('./oficina_wa');

const DUENO = { tenantId: 't-1', rol: 'flota_admin' as const, userId: 'u-1', nombre: 'Javier' };
const ENCARGADO = { tenantId: 't-1', rol: 'encargado' as const, userId: 'u-2', nombre: 'Lupe' };

beforeEach(() => {
  enviado.length = 0;
  subida = { error: null };
  firmada = { data: { signedUrl: 'https://firmada/x.pdf' }, error: null };
  anticipos = { data: [{ anticipo: 8000 }, { anticipo: 5000 }], error: null };
  respuestaEnvio = { ok: true, id: 'wamid-1' };
  analista.mockClear();
});

describe('mandarInformePdf — el reporte formal por el canal', () => {
  it('al dueño: arma el PDF (con dinero), lo sube, firma y manda como documento', async () => {
    const acuse = await mandarInformePdf(DUENO, '52155');
    expect(enviado).toHaveLength(1);
    expect(enviado[0]).toMatchObject({ tel: '52155', url: 'https://firmada/x.pdf' });
    expect(acuse).toContain('informe');
  });

  it('al ENCARGADO el documento sale SIN la sección de dinero (misma matriz que el panel)', async () => {
    anticipos = { data: null, error: { message: 'no debió consultarse' } };
    // Si intentara leer anticipos, la sección diría "no se pudo" — pero para
    // el encargado NI se consulta: el envío sale limpio.
    const acuse = await mandarInformePdf(ENCARGADO, '52166');
    expect(enviado).toHaveLength(1);
    expect(acuse).toContain('informe');
  });

  // AUDITORÍA 18, ALTO: `sendDocument` devuelve `{ok:false}` cuando Meta rechaza
  // —no lanza, no devuelve null—, así que el `if (!enviado)` de oficina_wa.ts
  // era código muerto sobre un objeto siempre truthy: con un 131030 el dueño
  // leía «Ahí te va tu informe en PDF 📊» y no llegaba nada. Es el mismo
  // criterio que processor.ts:2493 y avisar_cierre.ts:129 ya aplican.
  it('si Meta RECHAZA el documento, LANZA — no se acusa un PDF que no llegó', async () => {
    respuestaEnvio = { ok: false, error: 'Re-engagement message', codigo: 131030 };
    await expect(mandarInformePdf(DUENO, '52155')).rejects.toThrow('WhatsApp no aceptó');
  });

  it('si storage no firma, LANZA — el llamador contesta el fallo, nunca silencio', async () => {
    firmada = { data: null, error: null };
    await expect(mandarInformePdf(DUENO, '52155')).rejects.toThrow('firmar');
    expect(enviado).toHaveLength(0);
  });
});

describe('atenderPreguntaLibre — el analista del panel, en el chat', () => {
  it('dueño: pasa por el analista con su rol y devuelve el texto', async () => {
    const r = await atenderPreguntaLibre(DUENO, '¿cuánto llevamos de diésel?');
    expect(r).toContain('Van bien.');
    expect(analista).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 't-1', usuario: expect.objectContaining({ rol: 'flota_admin' }),
    }));
  });

  it('encargado: null SIN llamar al analista (sus tools devuelven pesos)', async () => {
    expect(await atenderPreguntaLibre(ENCARGADO, '¿cuánto llevamos?')).toBeNull();
    expect(analista).not.toHaveBeenCalled();
  });

  it('si el analista truena: null (cae al saludo que orienta), jamás un error pelón', async () => {
    analista.mockRejectedValueOnce(new Error('modelo caído'));
    expect(await atenderPreguntaLibre(DUENO, '¿cómo vamos?')).toBeNull();
  });
});
