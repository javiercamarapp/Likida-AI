import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 22 · OP-A2 y OP-A3 (ALTOS) — dos maneras de perder un incidente.
//
// OP-A2: `redactarTexto` convierte todo UUID en una huella FNV irreversible.
// Bien pensado para datos de persona; catastrófico para un FOLIO FISCAL. Si el
// PAC timbra y el `update {uuid_fiscal}` falla, el comprobante existe SOLO ante
// el SAT — y el correo decía «el PAC timbró el uuid id:33ab7e19c0d1». Un
// comprobante fiscal vivo que Likida no puede nombrar.
//
// OP-A3: el piso anti-ruido se reservaba por NOMBRE DE EVENTO. `carta_porte_
// timbre.ts` manda cinco alertas distintas bajo el mismo nombre, así que el
// segundo incidente de la hora se descartaba en silencio.
// ═══════════════════════════════════════════════════════════════════════════

const enviados: Array<{ asunto: string; cuerpo: string }> = [];
vi.mock('@/lib/correo/enviar', () => ({
  correoConfigurado: () => true,
  enviarCorreo: async (_para: string, m: { asunto: string; parrafos?: string[]; datos?: Array<[string, string]> }) => {
    enviados.push({
      asunto: m.asunto,
      cuerpo: JSON.stringify(m.datos ?? []) + (m.parrafos ?? []).join(' '),
    });
    return { ok: true as const };
  },
}));
vi.mock('@/lib/env', () => ({ appUrl: () => 'https://app.likida.ai' }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  redactarTexto: (s: string) => s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, 'id:HUELLA'),
}));

const { alertarOperador } = await import('./alerta');

const UUID = 'a3f21b9c-1111-2222-3333-444455556666';

beforeEach(() => {
  enviados.length = 0;
  process.env.ALERTA_EMAIL = 'javier@example.com';
  // Sin Redis, `reservarPiso` cae al Map de la instancia — que es exactamente
  // el camino que esta suite quiere medir.
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

describe('OP-A2: el folio fiscal llega entero al correo', () => {
  it('el uuid NO se convierte en huella: es la única llave para reconstruirlo', async () => {
    await alertarOperador(`timbre.uuid_no_persistido.${Math.random()}`, {
      viajeId: '9f2c1a4b-0000-0000-0000-000000000000',
      uuid: UUID,
      error: 'timeout al guardar el folio',
    });
    expect(enviados).toHaveLength(1);
    // Lo que rompía: `id:HUELLA` en lugar del folio.
    expect(enviados[0].cuerpo).toContain(UUID);
  });

  it('pero lo que NO es folio fiscal se sigue redactando', async () => {
    await alertarOperador(`timbre.otro.${Math.random()}`, {
      viajeId: '9f2c1a4b-0000-0000-0000-000000000000',
    });
    expect(enviados[0].cuerpo).toContain('id:HUELLA');
    expect(enviados[0].cuerpo).not.toContain('9f2c1a4b-0000');
  });
});

describe('OP-A3: dos incidentes distintos son dos alarmas', () => {
  it('el segundo viaje que falla en la misma hora SÍ avisa', async () => {
    const evento = `timbre.fallo.${Math.random()}`;
    await alertarOperador(evento, { viajeId: 'viaje-A', codigo: 'PAC_TIMEOUT' });
    await alertarOperador(evento, { viajeId: 'viaje-B', codigo: 'PAC_TIMEOUT' });
    // Lo que rompía: el segundo se descartaba en silencio y el contralor solo
    // sabía de uno.
    expect(enviados).toHaveLength(2);
  });

  it('el MISMO incidente repitiéndose sigue siendo una sola alarma', async () => {
    const evento = `timbre.repetido.${Math.random()}`;
    await alertarOperador(evento, { viajeId: 'viaje-A', codigo: 'PAC_TIMEOUT', error: 'timeout 3011ms' });
    await alertarOperador(evento, { viajeId: 'viaje-A', codigo: 'PAC_TIMEOUT', error: 'timeout 4082ms' });
    // El mensaje cambia de milisegundos entre reintentos; el incidente no.
    expect(enviados).toHaveLength(1);
  });
});
