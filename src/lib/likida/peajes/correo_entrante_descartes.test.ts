import { describe, it, expect, vi, beforeEach } from 'vitest';

// A37-A2-16: un adjunto que el correo NO puede recibir (más de 4 MB, vacío, ilegible de bajar) no se pierde en silencio:
// queda una corrida `parcial` en la bitácora del agente de peajes, que es lo que la oficina SÍ ve.
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('sin base'); } }));
vi.mock('@/lib/likida/interruptores', () => ({ estaApagado: async () => false }));
const corridas: Array<{ tenant: string | null; agente: string; c: Record<string, unknown> }> = [];
vi.mock('../agentes/corridas', () => ({ registrarCorrida: async (tenant: string | null, agente: string, c: Record<string, unknown>) => { corridas.push({ tenant, agente, c }); } }));
const finalizados: boolean[] = [];
let finalizarOk = true;
vi.mock('../carta_porte_docs/repo', () => ({
  reclamarCorreo: async () => ({ resultado: 'claimed', token: 't' }),
  finalizarCorreo: async (_e: string, _t: string, ok: boolean) => { finalizados.push(ok); return finalizarOk; },
}));
vi.mock('./datos', () => ({ buzonCorreoPeajesPorToken: async () => ({ tenantId: 'T-1', activo: true, remitentes: [] }) }));
const recibidos: string[] = [];
vi.mock('./ingesta', () => ({
  MAX_ARCHIVO_INGESTA_BYTES: 4 * 1024 * 1024,
  recibirArchivoPeaje: async (_t: string, a: { nombre: string }) => { recibidos.push(a.nombre); return { ok: true, id: 'x', duplicado: false, estado: 'pendiente' }; },
}));

process.env.RESEND_API_KEY = 'x';
const { atenderCorreoPeajes } = await import('./correo_entrante');

const correo = (adj: Array<[string, string]>) => ({ emailId: 'e1', from: 'a@b.c', attachments: adj.map(([filename, id]) => ({ id, filename })) }) as never;
const TOKEN = 'a'.repeat(24);

beforeEach(() => { corridas.length = 0; finalizados.length = 0; recibidos.length = 0; finalizarOk = true; });

describe('adjuntos descartados por el correo de peajes', () => {
  it('un adjunto de más de 4 MB deja una corrida parcial con el nombre y el motivo; los demás sí entran', async () => {
    const grande = new Uint8Array(4 * 1024 * 1024 + 1);
    const bueno = new Uint8Array([1, 2, 3]);
    const r = await atenderCorreoPeajes(TOKEN, correo([['enorme.xlsx', 'g'], ['corte.csv', 'b']]), {
      descargar: async (_e, id) => ({ ok: true, bytes: id === 'g' ? grande : bueno }),
    });
    expect(r).toMatchObject({ status: 200, cuerpo: { recibidos: 1, ignorados: 1 } });
    expect(recibidos).toEqual(['corte.csv']);
    expect(corridas).toHaveLength(1);
    expect(corridas[0]).toMatchObject({ tenant: 'T-1', agente: 'peajes', c: { estado: 'parcial', disparo: 'correo' } });
    expect(String(corridas[0].c.error)).toMatch(/enorme\.xlsx/);
    expect(String(corridas[0].c.error)).toMatch(/4 MB/);
  });

  it('sin descartes no se anota nada', async () => {
    await atenderCorreoPeajes(TOKEN, correo([['corte.csv', 'b']]), { descargar: async () => ({ ok: true, bytes: new Uint8Array([1]) }) });
    expect(corridas).toHaveLength(0);
  });

  it('si el correo no se pudo finalizar (se reintentará) no se anota todavía: no se duplica la corrida', async () => {
    finalizarOk = false;
    const r = await atenderCorreoPeajes(TOKEN, correo([['enorme.xlsx', 'g']]), { descargar: async () => ({ ok: true, bytes: new Uint8Array(4 * 1024 * 1024 + 1) }) });
    expect(r.status).toBe(503);
    expect(corridas).toHaveLength(0);
  });

  it('una descarga definitiva fallida también se anota', async () => {
    await atenderCorreoPeajes(TOKEN, correo([['raro.pdf', 'x']]), { descargar: async () => ({ ok: false, transitorio: false }) });
    expect(corridas).toHaveLength(1);
    expect(String(corridas[0].c.error)).toMatch(/raro\.pdf/);
  });
});
