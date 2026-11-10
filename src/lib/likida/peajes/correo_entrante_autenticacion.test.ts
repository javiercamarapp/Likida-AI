import { describe, it, expect, vi, beforeEach } from 'vitest';

const avisos: Array<{ evento: string; datos: unknown }> = [];
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: (evento: string, datos: unknown) => { avisos.push({ evento, datos }); } } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('sin base'); } }));
vi.mock('@/lib/likida/interruptores', () => ({ estaApagado: async () => false }));
vi.mock('../agentes/corridas', () => ({ registrarCorrida: async () => {} }));
vi.mock('../carta_porte_docs/repo', () => ({
  reclamarCorreo: async () => ({ resultado: 'claimed', token: 't' }),
  finalizarCorreo: async () => true,
}));
vi.mock('./datos', () => ({ buzonCorreoPeajesPorToken: async () => ({ tenantId: 'T-1', activo: true, remitentes: ['b.test'] }) }));
const recibidos: string[] = [];
vi.mock('./ingesta', () => ({
  MAX_ARCHIVO_INGESTA_BYTES: 4 * 1024 * 1024,
  recibirArchivoPeaje: async (_t: string, a: { nombre: string }) => { recibidos.push(a.nombre); return { ok: true, id: 'x', duplicado: false, estado: 'pendiente' }; },
}));
process.env.RESEND_API_KEY = 'x';
const { atenderCorreoPeajes } = await import('./correo_entrante');

const TOKEN = 'a'.repeat(24);
const deps = { descargar: async () => ({ ok: true as const, bytes: new Uint8Array([1]) }) };
const correo = (headers?: unknown) => ({ emailId: 'e1', from: 'Juan <juan@b.test>', headers, attachments: [{ id: 'a', filename: 'corte.csv' }] }) as never;

beforeEach(() => { avisos.length = 0; recibidos.length = 0; });

describe('peajes por correo: SPF/DKIM del remitente', () => {
  it('SPF o DKIM pasaron: entra', async () => {
    const r = await atenderCorreoPeajes(TOKEN, correo([{ name: 'Authentication-Results', value: 'mx; spf=pass smtp.mailfrom=b.test' }]), deps);
    expect(r.cuerpo).toMatchObject({ recibidos: 1 });
    expect(recibidos).toEqual(['corte.csv']);
  });
  it('SPF y DKIM fallan: no entra, falla cerrado y sin la dirección en el log', async () => {
    const r = await atenderCorreoPeajes(TOKEN, correo([{ name: 'Authentication-Results', value: 'mx; spf=fail smtp.mailfrom=b.test; dkim=fail header.d=b.test' }]), deps);
    expect(r.cuerpo).toMatchObject({ ignorado: 'remitente_no_autenticado' });
    expect(recibidos).toEqual([]);
    expect(JSON.stringify(avisos)).not.toContain('juan@');
  });
  it('sin información de autenticación: se conserva el comportamiento (entra) pero queda registrado', async () => {
    const r = await atenderCorreoPeajes(TOKEN, correo(undefined), deps);
    expect(r.cuerpo).toMatchObject({ recibidos: 1 });
    expect(avisos.map((a) => a.evento)).toContain('peajes_correo.autenticacion_no_verificable');
    expect(JSON.stringify(avisos)).not.toContain('juan@');
  });
});
