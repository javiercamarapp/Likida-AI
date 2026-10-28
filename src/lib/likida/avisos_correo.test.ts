import { describe, expect, it, vi } from 'vitest';
import { asuntoEsSeguro, enviarAvisoCorreo, limpiarDestinatarios, MAX_DESTINATARIOS, type AvisoCorreo, type DepsAvisoCorreo } from './avisos_correo';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const base: AvisoCorreo = { tenantId: 't1', agente: 'carta_porte', tipo: 'documento_dudoso', asunto: 'Carta Porte: documento por revisar', titulo: 'Un documento necesita tu revisión', parrafos: ['Revísalo.'], para: ['Ana@Flota.test'], referencia: 'a1b2c3d4', liga: 'https://app.test/x', clave: 'doc-1' };
const deps = (r: Awaited<ReturnType<DepsAvisoCorreo['enviar']>> = { ok: true, id: 'e1' }) => {
  const enviar = vi.fn(async () => r);
  return { enviar } satisfies DepsAvisoCorreo;
};

describe('enviarAvisoCorreo', () => {
  it('manda a destinatarios limpios, con la llave de idempotencia derivada de la clave y sin datos en el asunto', async () => {
    const d = deps();
    expect(await enviarAvisoCorreo(base, d)).toEqual({ ok: true, destinatarios: 1 });
    const [para, correo, llave] = d.enviar.mock.calls[0] as unknown as [string[], { asunto: string; boton?: { href: string } }, string];
    expect(para).toEqual(['ana@flota.test']);
    expect(correo.asunto).toBe(base.asunto);
    expect(llave).toMatch(/^[0-9a-f]{64}$/);
    const otra = deps(); await enviarAvisoCorreo({ ...base, clave: 'doc-2' }, otra);
    expect((otra.enviar.mock.calls[0] as unknown as unknown[])[2]).not.toBe(llave);
  });
  it('FALLA CERRADO sin tenant, sin destinatarios válidos o con un asunto con forma de dato', async () => {
    const d = deps();
    expect(await enviarAvisoCorreo({ ...base, tenantId: ' ' }, d)).toEqual({ ok: false, motivo: 'sin_tenant' });
    expect(await enviarAvisoCorreo({ ...base, para: ['no-es-correo', ''] }, d)).toEqual({ ok: false, motivo: 'sin_destinatarios' });
    for (const asunto of ['Documento de ABC010101AB1', 'Aviso para ana@flota.test', 'Folio 20481234', 'Cobro de $1,500', 'Mira https://x.test', 'dos\nlíneas', 'x'.repeat(121)]) {
      expect(await enviarAvisoCorreo({ ...base, asunto }, d)).toEqual({ ok: false, motivo: 'asunto_inseguro' });
    }
    expect(d.enviar).not.toHaveBeenCalled();
  });
  it('traduce los fallos del canal sin lanzar ni citar al destinatario', async () => {
    expect(await enviarAvisoCorreo(base, deps({ ok: false, motivo: 'sin_configurar' }))).toEqual({ ok: false, motivo: 'sin_configurar' });
    expect(await enviarAvisoCorreo(base, deps({ ok: false, motivo: 'rechazado', detalle: 'ana@flota.test inválido' }))).toEqual({ ok: false, motivo: 'rechazado' });
    expect(await enviarAvisoCorreo(base, deps({ ok: false, motivo: 'red', detalle: 'x' }))).toEqual({ ok: false, motivo: 'red' });
    const lanza = { enviar: async () => { throw new Error('boom'); } };
    expect(await enviarAvisoCorreo(base, lanza)).toEqual({ ok: false, motivo: 'red' });
  });
});

describe('helpers', () => {
  it('asuntoEsSeguro', () => {
    expect(asuntoEsSeguro('Carta Porte: documento aprobado')).toBe(true);
    expect(asuntoEsSeguro('   ')).toBe(false);
  });
  it('limpiarDestinatarios deduplica, valida y acota', () => {
    expect(limpiarDestinatarios(['A@x.test', 'a@x.test', null, 'mal', ' b@x.test '])).toEqual(['a@x.test', 'b@x.test']);
    expect(limpiarDestinatarios(Array.from({ length: 30 }, (_, i) => `u${i}@x.test`))).toHaveLength(MAX_DESTINATARIOS);
  });
});
