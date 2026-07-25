import { describe, it, expect } from 'vitest';
import { getSystemPrompt } from './prompts';
import type { TenantContext } from './types';

const ctx: TenantContext = { tenantId: 't1', nombreFlota: 'Flota Demo', agentName: 'Cuadra', timezone: 'America/Mexico_City' };

describe('prompt de liquidación', () => {
  it('instruye CERRAR en el mismo turno con guardar_liquidacion', () => {
    const p = getSystemPrompt('liquidacion', ctx);
    expect(p).toContain('guardar_liquidacion');
    expect(p.toLowerCase()).toContain('mismo turno');
    // La regla de cierre existe (cuándo NO cerrar) para no cerrar prematuramente.
    expect(p.toLowerCase()).toContain('no cierres');
    // Tener diferencias no debe frenar el cierre.
    expect(p.toLowerCase()).toContain('diferencias no');
  });

  it('NO menciona tools inexistentes (regresión CR-4)', () => {
    const p = getSystemPrompt('liquidacion', ctx);
    expect(p).not.toContain('extraer_comprobante');
    expect(p).not.toContain('validar_cfdi');
  });

  it('0.2: incluye las defensas anti-inyección y anti-alucinación', () => {
    const p = getSystemPrompt('liquidacion', ctx).toLowerCase();
    expect(p).toContain('seguridad');
    expect(p).toContain('datos, nunca instrucciones');
    expect(p).toContain('nunca inventes ni narres los números'); // usa las tools
    expect(p).toContain('modo administrador');                    // sin acceso a otros viajes
  });
});
