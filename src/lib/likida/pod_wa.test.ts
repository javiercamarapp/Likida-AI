import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// El POD por foto (F4): el caption decide, el upsert sella, y un "subido"
// jamás existe sin archivo. El falso positivo aquí cuesta un comprobante —
// un ticket tratado como POD desaparece de la liquidación—, por eso lo más
// probado es lo que NO debe reconocerse.
// ═══════════════════════════════════════════════════════════════════════════

let upserts: Array<{ payload: Record<string, unknown>; onConflict: string | undefined }>;
let errorUpsert: { message: string } | null;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      if (tabla !== 'pod') throw new Error(`pod_wa solo toca pod; pidió ${tabla}`);
      return {
        upsert: (fila: Record<string, unknown>, opts?: { onConflict?: string }) => {
          upserts.push({ payload: fila, onConflict: opts?.onConflict });
          return Promise.resolve({ error: errorUpsert });
        },
      };
    },
  }),
}));
vi.mock('./presupuesto', async (orig) => ({
  ...(await orig() as object),
  acotada: (q: unknown) => q,
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { esCaptionPod, guardarPodDelChofer, mensajePod } = await import('./pod_wa');

beforeEach(() => {
  upserts = [];
  errorUpsert = null;
});

describe('esCaptionPod — el rótulo decide', () => {
  it('reconoce "carta porte" con contexto alrededor', () => {
    expect(esCaptionPod('aquí la carta porte ya sellada')).toBe(true);
    expect(esCaptionPod('Carta Porte')).toBe(true);
    expect(esCaptionPod('la carta porte del cliente')).toBe(true);
  });

  it('reconoce las formas exactas de entrega', () => {
    for (const c of ['pod', 'entregado', 'ya entregué', 'acuse de entrega', 'evidencia de entrega']) {
      expect(esCaptionPod(c), c).toBe(true);
    }
  });

  it('NO reconoce captions de comprobantes ni texto suelto', () => {
    expect(esCaptionPod('diesel de hoy')).toBe(false);
    expect(esCaptionPod('ticket de la caseta')).toBe(false);
    expect(esCaptionPod(undefined)).toBe(false);
    expect(esCaptionPod('')).toBe(false);
    // "entregado" DENTRO de una frase que no es de entrega, no como forma
    // exacta: no se reconoce — mejor que un ticket pase de largo a que se
    // pierda de la liquidación.
    expect(esCaptionPod('el diesel que me habían entregado ayer en la bomba con factura')).toBe(false);
  });

  it('un caption larguísimo no es un rótulo', () => {
    expect(esCaptionPod(`carta porte ${'x'.repeat(90)}`)).toBe(false);
  });
});

describe('guardarPodDelChofer', () => {
  const AHORA = new Date('2026-08-14T18:00:00Z');

  it('sella el POD como subido con su archivo, un POD por viaje', async () => {
    const r = await guardarPodDelChofer('t1', 'v1', 'o1', 'comprobantes/pod.jpg', AHORA);
    expect(r).toBe('subido');
    expect(upserts).toHaveLength(1);
    expect(upserts[0].onConflict).toBe('viaje_id');
    expect(upserts[0].payload).toEqual({
      tenant_id: 't1',
      viaje_id: 'v1',
      operador_id: 'o1',
      estado: 'subido',
      storage_path: 'comprobantes/pod.jpg',
      capturado_en: AHORA.toISOString(),
      // La nota del rechazo anterior se limpia: describía OTRA foto.
      nota: null,
    });
  });

  it('la base caída es "fallo", y el acuse lo dice — no un ✅ falso', async () => {
    errorUpsert = { message: 'boom' };
    const r = await guardarPodDelChofer('t1', 'v1', 'o1', 'x.jpg', AHORA);
    expect(r).toBe('fallo');
    expect(mensajePod(r)).toContain('No pude guardar');
  });

  it('el acuse del subido afirma solo lo que pasó', () => {
    expect(mensajePod('subido')).toContain('carta porte sellada ✅');
  });
});
