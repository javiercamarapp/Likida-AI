import { describe, it, expect, vi, beforeEach } from 'vitest';

// El botón se lee de un TEXTO que llega del teléfono del chofer: hay que tratar
// ese texto como hostil. Lo que se fija es que SOLO el id exacto —prefijo, dos
// puntos y un uuid completo— dispara un acuse, y que el texto que se le devuelve
// al chofer afirma únicamente lo que de verdad se guardó.

const registrarAcuse = vi.fn(async (..._a: unknown[]): Promise<{ resultado: string; avisoOficina: string }> => ({ resultado: 'registrado', avisoOficina: 'no_aplica' }));
vi.mock('./servicio', () => ({ registrarAcuseConAviso: (...a: unknown[]) => registrarAcuse(...a) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { leerBotonLiquidacionExterna, atenderAcuseLiquidacionExterna } = await import('./acuse');

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const op = { tenantId: 't-1', operadorId: 'o-1' };

beforeEach(() => { registrarAcuse.mockReset(); registrarAcuse.mockResolvedValue({ resultado: 'registrado', avisoOficina: 'no_aplica' }); });

describe('leerBotonLiquidacionExterna', () => {
  it('lee los dos botones', () => {
    expect(leerBotonLiquidacionExterna(`liqext_ok:${ID}`)).toEqual({ tipo: 'recibida', liquidacionId: ID });
    expect(leerBotonLiquidacionExterna(`liqext_no:${ID}`)).toEqual({ tipo: 'no_coincide', liquidacionId: ID });
  });

  it('tolera espacios alrededor y mayúsculas, y normaliza el uuid a minúsculas', () => {
    expect(leerBotonLiquidacionExterna(`  LIQEXT_OK:${ID.toUpperCase()}  \n`)).toEqual({ tipo: 'recibida', liquidacionId: ID });
  });

  it('NADA más dispara el acuse: texto alrededor, uuid corto, prefijo ajeno, inyección', () => {
    for (const t of [
      '', 'hola', 'liqext_ok:', 'liqext_ok:123', `liqext_ok:${ID}x`, `x${ID}`, `liqext_ok: ${ID}`,
      `liqext_xx:${ID}`, `liqext_ok:${ID}\nliqext_no:${ID}`, `liqext_ok:${ID.slice(0, -1)}`,
      `liqext_ok:${ID}'; drop table liquidacion_externa;--`, `ok:${ID}`, `mal:${ID}`,
      `liqext_ok:${ID.replace(/-/g, '')}`,
    ]) {
      expect(leerBotonLiquidacionExterna(t), JSON.stringify(t)).toBeNull();
    }
  });

  it('un valor no-texto no truena', () => {
    expect(leerBotonLiquidacionExterna(undefined as unknown as string)).toBeNull();
    expect(leerBotonLiquidacionExterna(null as unknown as string)).toBeNull();
  });
});

describe('atenderAcuseLiquidacionExterna', () => {
  it('lo que no es botón nuestro devuelve null (sigue su camino) y no toca el servicio', async () => {
    expect(await atenderAcuseLiquidacionExterna(op, 'hola')).toBeNull();
    expect(registrarAcuse).not.toHaveBeenCalled();
  });

  it('el operador y el tenant salen del contexto del TELÉFONO, no del texto del botón', async () => {
    await atenderAcuseLiquidacionExterna(op, `liqext_ok:${ID}`);
    expect(registrarAcuse).toHaveBeenCalledWith('t-1', 'o-1', ID, 'recibida');
  });

  const r = (resultado: string, avisoOficina = 'no_aplica') => ({ resultado, avisoOficina });
  it('cada resultado del servicio tiene su frase, y ninguna afirma de más', async () => {
    registrarAcuse.mockResolvedValueOnce(r('registrado'));
    expect(await atenderAcuseLiquidacionExterna(op, `liqext_ok:${ID}`)).toMatch(/quedó registrado que recibiste/);
    registrarAcuse.mockResolvedValueOnce(r('ya_registrado'));
    expect(await atenderAcuseLiquidacionExterna(op, `liqext_ok:${ID}`)).toMatch(/Ya tenía registrada/);
    registrarAcuse.mockResolvedValueOnce(r('no_encontrada'));
    expect(await atenderAcuseLiquidacionExterna(op, `liqext_ok:${ID}`)).toMatch(/No encontré esa liquidación/);
  });

  it('«No coincide»: «ya le avisé a tu oficina» SOLO si el aviso salió; si no, lo dice y sugiere avisar directo', async () => {
    registrarAcuse.mockResolvedValueOnce(r('registrado', 'enviado'));
    const enviado = await atenderAcuseLiquidacionExterna(op, `liqext_no:${ID}`);
    expect(enviado).toMatch(/NO coincide.*Ya le avisé a tu oficina/);
    registrarAcuse.mockResolvedValueOnce(r('registrado', 'no_enviado'));
    const noEnviado = await atenderAcuseLiquidacionExterna(op, `liqext_no:${ID}`);
    expect(noEnviado).toMatch(/NO coincide.*panel de tu oficina.*no pude avisarles/);
    expect(noEnviado).not.toMatch(/Ya le avisé/);
  });

  it('si el servicio lanza, falla CERRADO: nunca dice «registrado»', async () => {
    registrarAcuse.mockRejectedValueOnce(new Error('base caída'));
    const r = await atenderAcuseLiquidacionExterna(op, `liqext_no:${ID}`);
    expect(r).toMatch(/No pude registrar/);
    expect(r).not.toMatch(/quedó|Anotado|Listo/);
  });
});
