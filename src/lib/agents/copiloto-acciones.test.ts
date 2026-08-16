import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LAS ACCIONES DEL COPILOTO — el ejecutor determinista. Lo que se fija:
// el catálogo rechaza lo desconocido y lo no implementado CON PALABRAS,
// apagar_agente valida el interruptor y delega en la MISMA función del ⌘K
// (que ya exige motivo y ya anota bitácora — una puerta más, un mecanismo).
// ═══════════════════════════════════════════════════════════════════════════

const apagar = vi.fn(async () => {});
vi.mock('@/lib/likida/interruptores', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, apagar };
});

const { ejecutarAccionCopiloto, CATALOGO_ACCIONES, accionDelCatalogo } = await import('./copiloto-acciones');
const { DatoInvalido } = await import('@/lib/likida/errores');

beforeEach(() => { apagar.mockClear(); });

describe('el catálogo de acciones', () => {
  it('las 9 acciones del diseño §3c existen, y SOLO apagar_agente está implementada', () => {
    expect(CATALOGO_ACCIONES).toHaveLength(9);
    const implementadas = CATALOGO_ACCIONES.filter((a) => a.implementada).map((a) => a.id);
    expect(implementadas).toEqual(['apagar_agente']);
  });

  it('toda acción 🔴 del diseño está marcada doble — el gateo es contrato, no default', () => {
    for (const id of ['encender_agente', 'aprobar_pendiente', 'rechazar_pendiente', 'marcar_pago_conciliado', 'reabrir_liquidacion']) {
      expect(accionDelCatalogo(id)?.gateo, id).toBe('doble');
    }
  });
});

describe('ejecutarAccionCopiloto', () => {
  it('una acción fuera del catálogo se rechaza con texto para pantalla', async () => {
    await expect(ejecutarAccionCopiloto('borrar_todo', {}, 'u-1')).rejects.toThrow(DatoInvalido);
    expect(apagar).not.toHaveBeenCalled();
  });

  it('una acción del catálogo NO implementada se rechaza diciéndolo con esas palabras', async () => {
    await expect(ejecutarAccionCopiloto('encender_agente', { id: 'agente:cobranza' }, 'u-1'))
      .rejects.toThrow(/no está implementada/);
  });

  it('apagar_agente con un interruptor que no existe se rechaza sin tocar la palanca', async () => {
    await expect(ejecutarAccionCopiloto('apagar_agente', { id: 'agente:inventado', motivo: 'x' }, 'u-1'))
      .rejects.toThrow(/no es un interruptor/);
    expect(apagar).not.toHaveBeenCalled();
  });

  it('apagar_agente delega en apagar() con el interruptor, el motivo y el userId DE LA SESIÓN', async () => {
    const r = await ejecutarAccionCopiloto('apagar_agente', { id: 'agente:cobranza', motivo: 'está mandando de más' }, 'u-javier');
    expect(r.ok).toBe(true);
    expect(apagar).toHaveBeenCalledWith('agente:cobranza', 'está mandando de más', 'u-javier');
  });

  it('el motivo vacío VIAJA a apagar() — quien lo rebota es la función real, no una copia de su regla', async () => {
    apagar.mockRejectedValueOnce(new DatoInvalido('Apagar exige un motivo.'));
    await expect(ejecutarAccionCopiloto('apagar_agente', { id: 'agente:cobranza' }, 'u-1'))
      .rejects.toThrow(/motivo/);
  });
});
