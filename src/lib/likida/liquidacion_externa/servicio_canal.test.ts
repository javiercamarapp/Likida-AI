import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LiquidacionExterna } from './repo';
import type { EntregaWhatsApp } from './entrega';

// Gate por canal en `intentarEntrega` (T-A1-17): con canal `correo` el camino WhatsApp no corre; con `whatsapp`/`ambos` sí.

const transicionar = vi.fn(async (..._a: unknown[]) => true);
vi.mock('./repo', async (orig) => ({
  ...(await orig<typeof import('./repo')>()),
  transicionar: (...a: unknown[]) => transicionar(...a),
  registrarEvento: vi.fn(async () => undefined),
  leerPorId: vi.fn(async () => null),
  firmarPdfExterno: vi.fn(async () => 'https://firmada'),
}));
vi.mock('./trabajo', () => ({
  trabajoPendiente: vi.fn(async () => trabajo),
  avisosPendientes: vi.fn(async () => []),
}));
vi.mock('../presupuesto', async (orig) => ({ ...(await orig<typeof import('../presupuesto')>()), acotada: (q: unknown) => q }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { intentarEntrega, procesarLiquidacionesExternas } = await import('./servicio');

let trabajo: LiquidacionExterna[] = [];
const liq = (p: Partial<LiquidacionExterna> = {}): LiquidacionExterna => ({
  id: 'l-1', tenantId: 't-1', claveExterna: 'K-1', huella: 'x'.repeat(64), sistemaOrigen: null, operadorId: 'o-1',
  operadorNombre: 'Operador Uno', operadorTelefono: '525500000001', foliosViaje: [], viajeIds: [], // grep-limpio:ok
  periodoDesde: '2026-09-01', periodoHasta: '2026-09-07', conceptos: [], total: 100, moneda: 'MXN',
  pdfRuta: 't-1/externas/x.pdf', pdfOrigen: 'generado', estado: 'pendiente', via: null, generacion: 1, intentos: 0,
  proximoIntentoEn: 'x', ultimoError: null, wamid: null, enviadaEn: null, acuseTipo: null, acuseEn: null, acuseConfirmadoEn: null,
  creadaEn: '2026-09-08T09:00:00.000Z', ...p,
});

const enviar = vi.fn(async (..._a: unknown[]) => ({ estado: 'en_cola' as const, via: 'sesion' as const }));
const entrega = { enviarConFallback: (...a: unknown[]) => enviar(...a) } as unknown as EntregaWhatsApp;
const depsCon = (canalDeEntrega: (t: string) => Promise<'whatsapp' | 'correo' | 'ambos'>) => ({
  entrega, ahora: () => new Date('2026-09-08T12:00:00.000Z'), razonSocial: async () => 'Flota SA',
  firmarPdf: async () => 'https://firmada.example/x.pdf',
  avisarNoCoincide: vi.fn(async () => ({ destinatarios: [], aceptados: [] })),
  formato: async () => null, subirArchivo: async () => undefined,
  copiarAJefe: vi.fn(async () => ({ estado: 'sin_destinatarios' as const })),
  canalDeEntrega,
});

beforeEach(() => { enviar.mockClear(); transicionar.mockClear(); trabajo = []; });

describe('intentarEntrega: gate por canal', () => {
  it('canal correo ⇒ no se llama al puerto de WhatsApp, no se toca la fila y no se gasta intento', async () => {
    const r = await intentarEntrega(liq(), depsCon(async () => 'correo'));
    expect(r).toBe('sin_cambio');
    expect(enviar).not.toHaveBeenCalled();
    expect(transicionar).not.toHaveBeenCalled();
  });

  it('canal correo y sin teléfono del operador ⇒ tampoco falla por «sin teléfono» (el camino WhatsApp ni se mira)', async () => {
    const r = await intentarEntrega(liq({ operadorTelefono: null }), depsCon(async () => 'correo'));
    expect(r).toBe('sin_cambio');
    expect(transicionar).not.toHaveBeenCalled();
  });

  it('canal whatsapp ⇒ el camino de siempre', async () => {
    const r = await intentarEntrega(liq(), depsCon(async () => 'whatsapp'));
    expect(r).toBe('en_cola');
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it('canal ambos ⇒ se conserva el camino WhatsApp', async () => {
    const r = await intentarEntrega(liq(), depsCon(async () => 'ambos'));
    expect(r).toBe('en_cola');
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it('si el canal no se puede leer ⇒ no se manda nada y no se gasta intento', async () => {
    const r = await intentarEntrega(liq(), depsCon(async () => { throw new Error('base caída'); }));
    expect(r).toBe('sin_cambio');
    expect(enviar).not.toHaveBeenCalled();
    expect(transicionar).not.toHaveBeenCalled();
  });

  it('el cron: un lote con una flota de correo y otra de WhatsApp solo entrega la de WhatsApp', async () => {
    trabajo = [liq({ id: 'l-c', tenantId: 't-correo' }), liq({ id: 'l-w', tenantId: 't-wa' })];
    const r = await procesarLiquidacionesExternas(depsCon(async (t) => (t === 't-correo' ? 'correo' : 'whatsapp')));
    expect(r).toMatchObject({ tomadas: 2, en_cola: 1, sin_cambio: 1 });
    expect(enviar).toHaveBeenCalledTimes(1);
    expect((enviar.mock.calls[0][0] as { liquidacionId: string }).liquidacionId).toBe('l-w');
  });
});
