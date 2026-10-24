import { describe, it, expect, vi } from 'vitest';

const getConversacion = vi.fn();
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: async () => ({}) }));
vi.mock('@/lib/admin/negocio', () => ({ getConversacion: (...a: unknown[]) => getConversacion(...a) }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
vi.mock('next/link', () => ({ default: () => null }));
vi.mock('lucide-react', () => ({ ArrowLeft: () => null, MessageCircle: () => null }));
vi.mock('../../../../dashboard/resumen-visual', () => ({ BarraPagina: () => null, TituloSeccion: () => null }));
vi.mock('../../../ui/kit', () => ({ EstadoError: () => null }));

const { default: Pagina } = await import('./page');
const TENANT = '11111111-1111-4111-8111-111111111111';

// A37-S05-06
describe('A37-S05-06: parámetro telefono sin doble decodificación', () => {
  it('un % mal formado es notFound, no URIError (500)', async () => {
    getConversacion.mockResolvedValue(null);
    await expect(Pagina({ params: Promise.resolve({ tenant: TENANT, telefono: '%E0%A4%A' }) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(getConversacion).toHaveBeenCalledWith(TENANT, '%E0%A4%A');
  });
  it('busca el valor tal cual llegó (ya decodificado por Next)', async () => {
    getConversacion.mockClear();
    getConversacion.mockResolvedValue({ telefono: '+5215512345678', mensajes: [] });
    await Pagina({ params: Promise.resolve({ tenant: TENANT, telefono: '+5215512345678' }) }).catch(() => {});
    expect(getConversacion).toHaveBeenCalledWith(TENANT, '+5215512345678');
  });
});
