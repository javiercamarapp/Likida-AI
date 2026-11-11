import { describe, it, expect, vi } from 'vitest';

vi.mock('./agentes-parados', () => ({ getAgentesParados: vi.fn() }));
vi.mock('./cola-aprobacion', () => ({ contarVencidas: vi.fn() }));
vi.mock('./guardia', () => ({ clasificacionDeGuardia: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { tarjetasDeBriefing, armarBriefing } from './copiloto-briefing';
import { getAgentesParados } from './agentes-parados';
import { contarVencidas } from './cola-aprobacion';
import { clasificacionDeGuardia } from './guardia';

const PARADOS = (n: number) => ({ parados: Array.from({ length: n }, (_, i) => ({ agente: `a${i}`, nombre: null, ultimaCorrida: null, horasSinCorrer: null, motivo: null, causa: null })), habilitados: 49, umbralHoras: 72, latidoDelRunner: null });
const VENCIDAS = (n: number) => ({ corte: 'x', dias: 30, vencidas: n, enElLote: n, limite: 50, porTipo: {}, porAgente: {}, masViejaCreadaEn: null });
const GUARDIA = (s1: number, s2: number, ciegas: string[] = []) => ({ fuentesCiegas: ciegas.map((fuente) => ({ fuente, error: null })), items: [], porSeveridad: { S1: s1, S2: s2, S3: 0, no_incidente: 0 }, limites: [] });

describe('tarjetasDeBriefing', () => {
  it('todo leído y sin pendientes: UNA tarjeta que lo dice', () => {
    const b = tarjetasDeBriefing({ parados: PARADOS(0), vencidas: VENCIDAS(0), guardia: GUARDIA(0, 0) });
    expect(b.tarjetas.map((t) => t.id)).toEqual(['sin_pendientes']);
    expect(b.fuentesCiegas).toEqual([]);
  });
  it('una fuente caída NUNCA se lee como «sin pendientes»', () => {
    const b = tarjetasDeBriefing({ parados: null, vencidas: VENCIDAS(0), guardia: GUARDIA(0, 0) });
    expect(b.tarjetas.find((t) => t.id === 'sin_pendientes')).toBeUndefined();
    expect(b.fuentesCiegas).toEqual(['Agentes parados']);
  });
  it('ordena por severidad: lo grave primero, y cada tarjeta trae decisión, pantalla y pregunta', () => {
    const b = tarjetasDeBriefing({ parados: PARADOS(3), vencidas: VENCIDAS(100), guardia: GUARDIA(1, 2) });
    expect(b.tarjetas.map((t) => t.id)).toEqual(['agentes_parados', 'incidentes', 'bandeja_vencida']);
    for (const t of b.tarjetas) { expect(t.decision).toBeTruthy(); expect(t.href).toMatch(/^\/admin/); expect(t.pregunta).toBeTruthy(); }
    expect(b.tarjetas[0].titulo).toContain('3 agentes llevan 72 horas');
  });
  it('las fuentes ciegas de la guardia se nombran', () => {
    const b = tarjetasDeBriefing({ parados: PARADOS(0), vencidas: VENCIDAS(0), guardia: GUARDIA(0, 0, ['tickets']) });
    expect(b.fuentesCiegas).toEqual(['Escalaciones: tickets']);
  });
});

describe('armarBriefing', () => {
  it('si una lectura lanza, esa fuente queda ciega y las demás se conservan', async () => {
    vi.mocked(getAgentesParados).mockResolvedValue(PARADOS(2));
    vi.mocked(contarVencidas).mockRejectedValue(new Error('base caída'));
    vi.mocked(clasificacionDeGuardia).mockResolvedValue(GUARDIA(0, 0));
    const b = await armarBriefing(0);
    expect(b.fuentesCiegas).toEqual(['Bandeja de aprobaciones']);
    expect(b.tarjetas.map((t) => t.id)).toEqual(['agentes_parados']);
  });
});
