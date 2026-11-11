import { describe, it, expect, vi } from 'vitest';

// F20: el aviso visible en el dashboard y en la ficha de /admin. Pausa y cancelación lo pintan con su frase; libre no pinta nada.
let veredicto: { salen: boolean; estado: string; mensaje?: string } = { salen: true, estado: 'libre' };
vi.mock('@/lib/saas/salidas_flota', () => ({ veredictoSalidasDeFlota: async () => veredicto }));

const { AvisoPlanEnPausa } = await import('./aviso-plan-en-pausa');

function texto(n: unknown): string {
  if (n == null || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(texto).join('');
  return texto((n as { props?: { children?: unknown } }).props?.children);
}

describe('AvisoPlanEnPausa', () => {
  it('plan en pausa: dice «Plan en pausa: los agentes no envían nada»', async () => {
    veredicto = { salen: false, estado: 'pausada', mensaje: 'Plan en pausa: los agentes no envían nada' };
    expect(texto(await AvisoPlanEnPausa({ tenantId: 't1' }))).toContain('Plan en pausa: los agentes no envían nada');
  });
  it('plan ilegible: lo dice también (no calla)', async () => {
    veredicto = { salen: false, estado: 'ilegible', mensaje: 'No se pudo leer el plan de la flota' };
    expect(texto(await AvisoPlanEnPausa({ tenantId: 't1' }))).toContain('No se pudo leer el plan');
  });
  it('plan libre o sin flota: nada', async () => {
    veredicto = { salen: true, estado: 'activa' };
    expect(await AvisoPlanEnPausa({ tenantId: 't1' })).toBeNull();
    expect(await AvisoPlanEnPausa({ tenantId: null })).toBeNull();
  });
});
