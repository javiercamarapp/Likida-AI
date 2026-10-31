import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const avisarOficina = vi.fn();
vi.mock('@/lib/meta/aviso_oficina', () => ({
  avisarOficina: (...a: unknown[]) => avisarOficina(...a),
  parametrosAvisoOficina: (c: string, r: string, l: string) => [c, r, l],
}));

const { canalWhatsAppPeajes, enviarPorCanales } = await import('./aviso_canal');
import type { CanalAvisoPeajes, AvisoPeajes } from './aviso_canal';

const aviso: AvisoPeajes = { tenantId: 't1', tipo: 'plazo', texto: 'hola', resumen: 'resumen', liga: 'https://x' };

beforeEach(() => avisarOficina.mockReset());

describe('canalWhatsAppPeajes', () => {
  it('manda por el selector central con el contexto de la flota y cuenta ok', async () => {
    avisarOficina.mockResolvedValue({ ok: true, via: 'texto', id: 'w1' });
    const c = canalWhatsAppPeajes(async () => '5215500000000');
    expect(await c.enviar('5215500000000', aviso)).toBe(true);
    expect(avisarOficina).toHaveBeenCalledWith('5215500000000', 'hola', expect.objectContaining({ parametros: ['Peajes', 'resumen', 'https://x'], contexto: expect.objectContaining({ tenantId: 't1', agente: 'peajes' }) }));
  });
  it('lo que quedó en la cola del outbox cuenta como enviado (soltar el sello lo duplicaría)', async () => {
    avisarOficina.mockResolvedValue({ ok: false, motivo: '429', fueraDeVentana: false, reintentable: true });
    expect(await canalWhatsAppPeajes(async () => 'x').enviar('x', aviso)).toBe(true);
  });
  it('un rechazo real es false', async () => {
    avisarOficina.mockResolvedValue({ ok: false, motivo: 'plantilla no aprobada', codigo: 132001, fueraDeVentana: true, reintentable: false });
    expect(await canalWhatsAppPeajes(async () => 'x').enviar('x', aviso)).toBe(false);
  });
});

describe('enviarPorCanales (punto de extensión: un segundo canal, p. ej. correo)', () => {
  const canal = (nombre: string, dest: string | null, ok: boolean): CanalAvisoPeajes & { enviar: ReturnType<typeof vi.fn> } =>
    ({ nombre, destinatario: async () => dest, enviar: vi.fn(async () => ok) });

  it('enviado si ALGÚN canal lo aceptó, aunque otro falle', async () => {
    const wa = canal('whatsapp', '521', false);
    const correo = canal('correo', 'a@b.c', true);
    expect(await enviarPorCanales([wa, correo], aviso)).toBe('enviado');
    expect(wa.enviar).toHaveBeenCalled();
    expect(correo.enviar).toHaveBeenCalled();
  });
  it('sin destinatario en ningún canal: sin_destinatario y nadie envía', async () => {
    const wa = canal('whatsapp', null, true);
    expect(await enviarPorCanales([wa], aviso)).toBe('sin_destinatario');
    expect(wa.enviar).not.toHaveBeenCalled();
  });
  it('hubo a quién mandar pero todos fallaron o lanzaron: fallido', async () => {
    const lanza: CanalAvisoPeajes = { nombre: 'x', destinatario: async () => 'd', enviar: async () => { throw new Error('boom'); } };
    expect(await enviarPorCanales([lanza, canal('wa', '1', false)], aviso)).toBe('fallido');
  });
  it('un canal cuyo destinatario no se pudo leer se salta sin tumbar a los demás', async () => {
    const roto: CanalAvisoPeajes = { nombre: 'roto', destinatario: async () => { throw new Error('boom'); }, enviar: async () => true };
    expect(await enviarPorCanales([roto, canal('wa', '1', true)], aviso)).toBe('enviado');
  });
});
