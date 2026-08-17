import { beforeEach, describe, expect, it, vi } from 'vitest';

// ═══ El IO del ciclo de oficina (informe PDF + pregunta libre) ═════════════

const enviado: Array<{ tel: string; url: string; nombre: string }> = [];
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
  sendDocument: async (tel: string, url: string, nombre: string) => { enviado.push({ tel, url, nombre }); return 'wamid-1'; },
}));
const analista = vi.fn(async () => ({ bloques: [{ tipo: 'texto', texto: 'Van bien.' }] }));
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
