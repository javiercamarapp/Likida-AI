import { describe, it, expect, vi, beforeEach } from 'vitest';

// S-06 / CT-SEG-06 (parcial): el buzón de peajes se autentica por token + From DECLARADO. Con la lista de remitentes vacía,
// cualquiera que conociera la dirección alimentaba la conciliación. Ahora la lista vacía FALLA CERRADO: no se descarga,
// no se reclama el correo y se contesta 200 con un motivo claro (reintentar no lo arregla; lo arregla la flota en el panel).
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('sin base'); } }));
vi.mock('@/lib/likida/interruptores', () => ({ estaApagado: async () => false }));
vi.mock('../agentes/corridas', () => ({ registrarCorrida: async () => undefined }));
let remitentes: string[] = [];
const reclamos: string[] = [];
vi.mock('../carta_porte_docs/repo', () => ({
  reclamarCorreo: async (id: string) => { reclamos.push(id); return { resultado: 'claimed', token: 't' }; },
  finalizarCorreo: async () => true,
}));
vi.mock('./datos', () => ({ buzonCorreoPeajesPorToken: async () => ({ tenantId: 'T-1', activo: true, remitentes }) }));
const recibidos: string[] = [];
vi.mock('./ingesta', () => ({
  MAX_ARCHIVO_INGESTA_BYTES: 4 * 1024 * 1024,
  recibirArchivoPeaje: async (_t: string, a: { nombre: string }) => { recibidos.push(a.nombre); return { ok: true, id: 'x', duplicado: false, estado: 'pendiente' }; },
}));

process.env.RESEND_API_KEY = 'x';
const { atenderCorreoPeajes } = await import('./correo_entrante');

const TOKEN = 'a'.repeat(24);
const correo = (from: string) => ({ emailId: 'e1', from, attachments: [{ id: 'a1', filename: 'corte.csv' }] }) as never;
const descargas: string[] = [];
const deps = { descargar: async (_e: string, id: string) => { descargas.push(id); return { ok: true as const, bytes: new Uint8Array([1, 2, 3]) }; } };

beforeEach(() => { remitentes = []; reclamos.length = 0; recibidos.length = 0; descargas.length = 0; });

describe('buzón de peajes: la lista de remitentes vacía no acepta a cualquiera', () => {
  it('lista vacía: 200 sin_remitentes_autorizados, sin descargar, sin reclamar y sin encolar', async () => {
    const r = await atenderCorreoPeajes(TOKEN, correo('cualquiera@x.com'), deps);
    expect(r).toMatchObject({ status: 200, cuerpo: { ok: true, ignorado: 'sin_remitentes_autorizados' } });
    expect(descargas).toEqual([]);
    expect(reclamos).toEqual([]);
    expect(recibidos).toEqual([]);
  });

  it('con lista, el remitente reconocido sigue entrando', async () => {
    remitentes = ['proveedor.mx'];
    const r = await atenderCorreoPeajes(TOKEN, correo('Peajes <cortes@proveedor.mx>'), deps);
    expect(r.status).toBe(200);
    expect(recibidos).toEqual(['corte.csv']);
  });

  it('con lista, el remitente ajeno sigue ignorado', async () => {
    remitentes = ['proveedor.mx'];
    const r = await atenderCorreoPeajes(TOKEN, correo('x@falso.test'), deps);
    expect(r).toMatchObject({ status: 200, cuerpo: { ignorado: 'remitente_no_permitido' } });
    expect(recibidos).toEqual([]);
  });
});
