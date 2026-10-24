import { describe, it, expect, vi, beforeEach } from 'vitest';

const registrarCorrida = vi.fn(async (..._a: unknown[]) => {});
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../interruptores', () => ({ estaApagado: async () => false }));
vi.mock('../agentes/corridas', () => ({ registrarCorrida: (...a: unknown[]) => registrarCorrida(...a) }));
vi.mock('../carta_porte_docs/repo', () => ({
  reclamarCorreo: async () => ({ resultado: 'claimed', token: 't' }),
  finalizarCorreo: async () => true,
}));
vi.mock('./datos', () => ({
  buzonCorreoPeajesPorToken: async () => ({ tenantId: 'ten-1', activo: true, remitentes: [] }),
}));
vi.mock('./ingesta', () => ({
  MAX_ARCHIVO_INGESTA_BYTES: 4 * 1024 * 1024,
  recibirArchivoPeaje: async () => ({ ok: true, duplicado: false }),
}));

const { atenderCorreoPeajes } = await import('./correo_entrante');

const correo = (n: number) => ({
  emailId: 'e1', from: 'x@y.mx', to: [], subject: '',
  attachments: Array.from({ length: n }, (_, i) => ({ id: `a${i}`, filename: `f${i}.xlsx` })),
}) as never;

beforeEach(() => { registrarCorrida.mockClear(); process.env.RESEND_API_KEY = 'k'; });

describe('atenderCorreoPeajes — A37-S52-02 descartes visibles', () => {
  it('un adjunto de más de 4 MB deja una corrida de fallo con el motivo', async () => {
    const descargar = async () => ({ ok: true as const, bytes: new Uint8Array(5 * 1024 * 1024) });
    const r = await atenderCorreoPeajes('tok', correo(1), { descargar } as never);
    expect(r.status).toBe(200);
    expect(registrarCorrida).toHaveBeenCalledOnce();
    const [tenant, agente, c] = registrarCorrida.mock.calls[0] as [string, string, { estado: string; error: string }];
    expect(tenant).toBe('ten-1'); expect(agente).toBe('peajes');
    expect(c.estado).toBe('fallo'); expect(c.error).toMatch(/4 MB/);
  });
  it('7 adjuntos: se importan 5 y la corrida avisa de los 2 de más (parcial)', async () => {
    const descargar = async () => ({ ok: true as const, bytes: new Uint8Array(10) });
    await atenderCorreoPeajes('tok', correo(7), { descargar } as never);
    const c = registrarCorrida.mock.calls[0][2] as { estado: string; error: string };
    expect(c.estado).toBe('parcial'); expect(c.error).toMatch(/2 adjunto/);
  });
  it('todo bien: no se registra corrida extra', async () => {
    const descargar = async () => ({ ok: true as const, bytes: new Uint8Array(10) });
    await atenderCorreoPeajes('tok', correo(2), { descargar } as never);
    expect(registrarCorrida).not.toHaveBeenCalled();
  });
});
