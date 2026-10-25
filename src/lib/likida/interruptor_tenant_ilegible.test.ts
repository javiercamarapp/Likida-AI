import { describe, it, expect, vi, beforeEach } from 'vitest';

// A37-S47-09 — el interruptor por flota fallaba ABIERTO justo en el caso de incidente: la flota se
// apaga a propósito (mensajes erróneos a choferes reales), un parpadeo de la base hace que la
// lectura siguiente diga «encendido» y el agente vuelve a contestar. Ahora se usa el ÚLTIMO VALOR
// CONOCIDO cuando la lectura falla; sin valor previo sigue siendo «encendido» (palanca operativa).

let lectura: () => Promise<{ data: { apagado: boolean } | null; error: { message: string } | null }>;

vi.mock('@/lib/auth/perfil_tenant', () => ({ perfilDeTenant: async () => null }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.maybeSingle = () => lectura();
      return b;
    },
  }),
}));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (p: unknown) => p }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { pipelineTenantApagado, reiniciarCacheInterruptorTenant } = await import('./interruptor_tenant');

const ok = (apagado: boolean | null) => async () => ({ data: apagado === null ? null : { apagado }, error: null });
const falla = async () => ({ data: null, error: { message: 'timeout' } });
const lanza = async () => { throw new Error('red caída'); };

beforeEach(() => reiniciarCacheInterruptorTenant());

describe('A37-S47-09 — interruptor por flota con lectura caída', () => {
  it('apagada a propósito + error de lectura => SIGUE apagada', async () => {
    lectura = ok(true);
    expect(await pipelineTenantApagado('t1', 'whatsapp')).toBe(true);
    lectura = falla;
    expect(await pipelineTenantApagado('t1', 'whatsapp')).toBe(true);
  });

  it('apagada a propósito + excepción de lectura => SIGUE apagada', async () => {
    lectura = ok(true);
    await pipelineTenantApagado('t1', 'ocr');
    lectura = lanza;
    expect(await pipelineTenantApagado('t1', 'ocr')).toBe(true);
  });

  it('encendida y luego error => sigue encendida; el cache es por flota y por pipeline', async () => {
    lectura = ok(false);
    await pipelineTenantApagado('t1', 'whatsapp');
    lectura = ok(true);
    await pipelineTenantApagado('t2', 'whatsapp');
    await pipelineTenantApagado('t1', 'ocr'); // t1/ocr apagado, t1/whatsapp encendido
    lectura = falla;
    expect(await pipelineTenantApagado('t1', 'whatsapp')).toBe(false);
    expect(await pipelineTenantApagado('t2', 'whatsapp')).toBe(true);
    expect(await pipelineTenantApagado('t1', 'ocr')).toBe(true);
  });

  it('sin valor previo y lectura caída => encendido (palanca operativa, no de incidente)', async () => {
    lectura = falla;
    expect(await pipelineTenantApagado('t9', 'whatsapp')).toBe(false);
    lectura = lanza;
    expect(await pipelineTenantApagado('t9', 'cuadre')).toBe(false);
  });

  it('un encendido explícito posterior reemplaza al apagado recordado', async () => {
    lectura = ok(true);
    await pipelineTenantApagado('t1', 'whatsapp');
    lectura = ok(null); // sin fila = encendido
    expect(await pipelineTenantApagado('t1', 'whatsapp')).toBe(false);
    lectura = falla;
    expect(await pipelineTenantApagado('t1', 'whatsapp')).toBe(false);
  });
});
