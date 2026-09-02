import { describe, it, expect, vi, beforeEach } from 'vitest';

// PRUEBAS (barrido MEDIO/BAJO): `abrirTicket` no tenía ni una prueba. Es la
// PUERTA de la señal de PMF #3 (auditoría externa 16-ago-2026, P2):
// `ticket_soporte.abierto_por` distingue "el cliente se quejó por su cuenta"
// (un id real) de "Likida lo abrió a nombre de la flota" (NULL, convención de
// la 0051) — un superadmin en un demo con `?tenant=` que colara su propio id
// ahí contaminaría para siempre la métrica que ese ticket alimenta.

const insertado = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      insert: (fila: Record<string, unknown>) => {
        insertado(fila);
        return { select: () => ({ single: () => Promise.resolve({ data: { id: 'ticket-1' }, error: null }) }) };
      },
    }),
  }),
}));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));

const { abrirTicket } = await import('./comercial');

describe('abrirTicket: la puerta de abierto_por (señal de PMF #3)', () => {
  beforeEach(() => insertado.mockReset());

  it('un usuario real de la flota deja su id en abierto_por', async () => {
    await abrirTicket('t-1', 'usuario-real', { asunto: 'a', descripcion: 'd', categoria: 'tecnico', prioridad: 'baja' });
    expect(insertado).toHaveBeenCalledWith(expect.objectContaining({ abierto_por: 'usuario-real' }));
  });

  it('un superadmin (demo con ?tenant=) pasa null — NO contamina la señal', async () => {
    await abrirTicket('t-1', null, { asunto: 'a', descripcion: 'd', categoria: 'tecnico', prioridad: 'baja' });
    expect(insertado).toHaveBeenCalledWith(expect.objectContaining({ abierto_por: null }));
  });

  it('rechaza asunto vacío o mayor a 200 caracteres, sin llegar a insertar', async () => {
    await expect(abrirTicket('t-1', null, { asunto: '  ', descripcion: '', categoria: 'tecnico', prioridad: 'baja' }))
      .rejects.toThrow(/asunto es obligatorio/);
    await expect(abrirTicket('t-1', null, { asunto: 'x'.repeat(201), descripcion: '', categoria: 'tecnico', prioridad: 'baja' }))
      .rejects.toThrow(/asunto es obligatorio/);
    expect(insertado).not.toHaveBeenCalled();
  });

  it('rechaza categoría o prioridad fuera del catálogo', async () => {
    await expect(abrirTicket('t-1', null, { asunto: 'a', descripcion: '', categoria: 'inventada', prioridad: 'baja' }))
      .rejects.toThrow(/categoría no existe/);
    await expect(abrirTicket('t-1', null, { asunto: 'a', descripcion: '', categoria: 'tecnico', prioridad: 'inventada' }))
      .rejects.toThrow(/prioridad no existe/);
  });

  it('descripción vacía se guarda como null, no como cadena vacía', async () => {
    await abrirTicket('t-1', 'u1', { asunto: 'a', descripcion: '   ', categoria: 'otro', prioridad: 'media' });
    expect(insertado).toHaveBeenCalledWith(expect.objectContaining({ descripcion: null }));
  });

  it('descripción se recorta a 4000 caracteres', async () => {
    await abrirTicket('t-1', 'u1', { asunto: 'a', descripcion: 'x'.repeat(4200), categoria: 'otro', prioridad: 'media' });
    expect(insertado).toHaveBeenCalledWith(expect.objectContaining({ descripcion: 'x'.repeat(4000) }));
  });
});
