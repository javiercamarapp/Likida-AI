import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LiquidacionExterna } from './repo';

// El aviso a la oficina cuando el chofer responde «No coincide»: a quién va, qué cuenta como «le llegó» y qué lleva la tarea
// durable. La base, Meta y los contactos son dobles; la lógica de aviso_no_coincide.ts es la real.

let telefonos: { copia: string[]; discrepancia: string[] } | null = null;
let telefonoDinero: string | null = null;
const respuestas = new Map<string, unknown>();
const enviados: string[] = [];

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/env', () => ({ appUrl: () => 'https://app.example' }));
vi.mock('../contactos', () => ({ telefonoParaDineroDe: vi.fn(async () => telefonoDinero) }));
vi.mock('./repo', () => ({ leerTelefonosFlota: vi.fn(async () => telefonos) }));
vi.mock('@/lib/meta/aviso_oficina', () => ({
  parametrosAvisoOficina: (a: string, b: string, c: string) => [a, b, c],
  avisarOficina: vi.fn(async (tel: string) => { enviados.push(tel); return respuestas.get(tel) ?? { ok: true, via: 'texto', id: 'w' }; }),
}));

const { avisarNoCoincidePorOmision, destinatariosDiscrepancia, tareaDeDiferencia } = await import('./aviso_no_coincide');
const liq = (extra: Partial<LiquidacionExterna> = {}) => ({
  id: 'l1', tenantId: 't1', claveExterna: 'SAP-1', sistemaOrigen: 'SAP', operadorNombre: 'Juan Pérez', foliosViaje: [], viajeIds: [], ...extra,
}) as unknown as LiquidacionExterna;

beforeEach(() => { telefonos = null; telefonoDinero = null; respuestas.clear(); enviados.length = 0; });

describe('a quién se avisa', () => {
  it('la persona responsable → la copia al jefe → quien ve dinero (en ese orden)', async () => {
    telefonos = { copia: ['525511110001'], discrepancia: ['525511110002'] };
    telefonoDinero = '525599990000';
    expect(await destinatariosDiscrepancia('t1')).toEqual(['525511110002']);
    telefonos = { copia: ['525511110001'], discrepancia: [] };
    expect(await destinatariosDiscrepancia('t1')).toEqual(['525511110001']);
    telefonos = null;
    expect(await destinatariosDiscrepancia('t1')).toEqual(['525599990000']);
    telefonoDinero = null;
    expect(await destinatariosDiscrepancia('t1')).toEqual([]);
  });
});

describe('qué cuenta como «le llegó»', () => {
  it('sin a quién avisar: nadie aceptó y lo dice (el aviso queda pendiente, no «enviado»)', async () => {
    const r = await avisarNoCoincidePorOmision(liq());
    expect(r.destinatarios).toEqual([]);
    expect(r.aceptados).toEqual([]);
    expect(r.motivo).toMatch(/a quién avisar/);
    expect(enviados).toEqual([]);
  });

  it('Meta aceptó, o el rechazo transitorio YA quedó en el outbox: cuenta; un rechazo definitivo no', async () => {
    telefonos = { copia: [], discrepancia: ['525511110001', '525511110002', '525511110003'] };
    respuestas.set('525511110002', { ok: false, motivo: 'timeout', fueraDeVentana: false, reintentable: true });
    respuestas.set('525511110003', { ok: false, motivo: 'plantilla rechazada', fueraDeVentana: true, reintentable: false });
    const r = await avisarNoCoincidePorOmision(liq());
    expect(r.aceptados).toEqual(['525511110001', '525511110002']);
    expect(r.motivo).toBe('plantilla rechazada');
  });

  it('el token vencido (encolado sin ser reintentable) cuenta como aceptado: reenviarlo lo duplicaría', async () => {
    telefonos = { copia: [], discrepancia: ['525511110001'] };
    respuestas.set('525511110001', { ok: false, motivo: 'token vencido', codigo: 190, fueraDeVentana: false, reintentable: false, encolado: true });
    expect((await avisarNoCoincidePorOmision(liq())).aceptados).toEqual(['525511110001']);
  });

  it('un reintento NO repite el WhatsApp a quien ya lo recibió', async () => {
    telefonos = { copia: [], discrepancia: ['525511110001', '525511110002'] };
    const r = await avisarNoCoincidePorOmision(liq(), ['525511110001']);
    expect(enviados).toEqual(['525511110002']);
    expect(r.aceptados.sort()).toEqual(['525511110001', '525511110002']);
  });

  it('nunca lanza: si leer los teléfonos truena, nadie aceptó', async () => {
    const repo = await import('./repo');
    vi.mocked(repo.leerTelefonosFlota).mockRejectedValueOnce(new Error('base caída'));
    const r = await avisarNoCoincidePorOmision(liq());
    expect(r.aceptados).toEqual([]);
    expect(r.motivo).toBeTruthy();
  });

  it('el texto del aviso no lleva cifras (el detalle vive en el panel)', async () => {
    telefonos = { copia: [], discrepancia: ['525511110001'] };
    const { avisarOficina } = await import('@/lib/meta/aviso_oficina');
    await avisarNoCoincidePorOmision(liq({ total: 1234.5 } as Partial<LiquidacionExterna>));
    const texto = String(vi.mocked(avisarOficina).mock.calls.at(-1)?.[1]);
    expect(texto).toMatch(/Juan Pérez.*No coincide.*SAP-1/);
    expect(texto).not.toMatch(/1,?234/);
  });
});

describe('la tarea durable para una persona', () => {
  it('lleva al chofer y la clave, sin números largos ni ligas, y el folio solo si es uno', () => {
    const t = tareaDeDiferencia(liq({ foliosViaje: ['VJ-100'], viajeIds: ['v-uuid-1'] }));
    expect(t.resumen).toMatch(/Juan Pérez respondió «No coincide».*SAP-1/);
    expect(t).toMatchObject({ viajeFolio: 'VJ-100', viajeId: 'v-uuid-1' });
    const varios = tareaDeDiferencia(liq({ foliosViaje: ['VJ-1', 'VJ-2'], viajeIds: ['a', 'b'] }));
    expect(varios).toMatchObject({ viajeFolio: null, viajeId: null });
  });

  it('una clave con un número largo (CLABE, teléfono) NO viaja a la cola', () => {
    const t = tareaDeDiferencia(liq({ claveExterna: 'LIQ-5512345678901' }));
    expect(t.resumen).not.toMatch(/\d{10}/);
    expect(t.resumen.length).toBeLessThanOrEqual(300);
  });
});
