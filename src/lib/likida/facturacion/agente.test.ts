import { describe, it, expect, beforeEach } from 'vitest';
import {
  pideCaptcha, pideVinculacion, cambioElPortal,
  registrarAdaptador, olvidarAdaptadores, facturarLoteConAgente,
  type AdaptadorPortal, type ResultadoAgente,
} from './agente';

describe('pideCaptcha — la señal que saca un ticket de la cola automática', () => {
  it('true SOLO cuando el portal lo pide', () => {
    expect(pideCaptcha({ requiereCaptcha: true })).toBe(true);
    expect(pideCaptcha({ requiereCaptcha: false })).toBe(false);
  });
  it('false si la respuesta no trae el campo (no se asume)', () => {
    expect(pideCaptcha({})).toBe(false);
  });
});

describe('las dos señales nuevas del vínculo', () => {
  it('`pideVinculacion` es "espera a que una persona abra la puerta"', () => {
    expect(pideVinculacion({ requiereVinculacion: true })).toBe(true);
    expect(pideVinculacion({ requiereVinculacion: false })).toBe(false);
    expect(pideVinculacion({})).toBe(false);
  });

  it('`cambioElPortal` es el ÚNICO bloqueo que no se arregla del lado del cliente', () => {
    expect(cambioElPortal({ portalCambio: true })).toBe(true);
    expect(cambioElPortal({})).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL MURO ES DEL PORTAL, NO DEL TICKET.
//
// Un adaptador sin `facturarLote` se llama ticket por ticket, y ahí las
// banderas del vínculo se AGREGAN al lote: si el primero se topó con el login,
// los siete que vienen detrás en la misma sesión se van a topar con lo mismo.
// Sin esta agregación, el lote no diría nada y el cron no sabría que hay que
// apagar la sesión guardada.
// ═══════════════════════════════════════════════════════════════════════════

const TENANT = '44444444-4444-4444-4444-444444444444';
const CAMPOS = [{ clave: 'webId' as const, etiqueta: 'Web ID', valor: '650', requerido: true }];
const ticket = (id: string) => ({ gastoId: id, campos: CAMPOS });

function adaptador(respuestas: ResultadoAgente[]): AdaptadorPortal {
  let i = 0;
  return {
    comercio: 'la_gas',
    portal: 'https://facturacion.lagas.com.mx/',
    facturar: async () => respuestas[Math.min(i++, respuestas.length - 1)],
  };
}

const NO_PUDO: ResultadoAgente = { modo: 'ensayo', ok: false, capturado: {} };

beforeEach(() => olvidarAdaptadores(TENANT));

describe('facturarLoteConAgente — el vínculo se agrega al lote', () => {
  it('un solo ticket con «requiere vinculación» lo declara para el lote entero', async () => {
    registrarAdaptador(TENANT, adaptador([
      { ...NO_PUDO, requiereVinculacion: true, sesionCaducada: true, error: 'la sesión ya no sirve' },
      NO_PUDO,
    ]));
    const r = await facturarLoteConAgente({ tenantId: TENANT, comercio: 'la_gas', tickets: [ticket('a'), ticket('b')] });
    expect(r.requiereVinculacion).toBe(true);
    expect(r.sesionCaducada).toBe(true);
    expect(r.porGasto).toHaveLength(2);
  });

  it('«el portal cambió» también sube, y no se confunde con lo anterior', async () => {
    registrarAdaptador(TENANT, adaptador([{ ...NO_PUDO, portalCambio: true, error: 'falta #rfc' }]));
    const r = await facturarLoteConAgente({ tenantId: TENANT, comercio: 'la_gas', tickets: [ticket('a')] });
    expect(r.portalCambio).toBe(true);
    expect(r.requiereVinculacion, 'aquí no hay nada que re-vincular').toBeUndefined();
  });

  it('un lote sano no inventa ninguna de las tres banderas', async () => {
    registrarAdaptador(TENANT, adaptador([{ modo: 'ensayo', ok: true, capturado: { '#webid': '650' } }]));
    const r = await facturarLoteConAgente({ tenantId: TENANT, comercio: 'la_gas', tickets: [ticket('a')] });
    expect(r.requiereVinculacion).toBeUndefined();
    expect(r.sesionCaducada).toBeUndefined();
    expect(r.portalCambio).toBeUndefined();
  });
});

// A37-S42-04 · un throw en modo emitir NO es «no se intentó».
describe('un adaptador que lanza en modo emitir marca emisión sin confirmar', () => {
  const quienLanza = (): AdaptadorPortal => ({
    comercio: 'la_gas',
    portal: 'https://facturacion.lagas.com.mx/',
    facturar: async () => { throw new Error('se cerró la página'); },
    facturarLote: async () => { throw new Error('se cerró la página'); },
  });

  it('lote en emitir: bandera puesta y motivo veraz (no «no se llegó a intentar»)', async () => {
    registrarAdaptador(TENANT, quienLanza());
    const r = await facturarLoteConAgente({ tenantId: TENANT, comercio: 'la_gas', tickets: [ticket('g1')], modo: 'emitir' });
    expect(r.emisionSinConfirmar).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.porGasto[0].motivo).not.toMatch(/No se llegó a intentar/);
    expect(r.porGasto[0].motivo).toMatch(/NO se sabe si el portal alcanzó a emitir/);
  });

  it('un ticket en emitir (sin facturarLote) también la propaga al lote', async () => {
    registrarAdaptador(TENANT, { ...quienLanza(), facturarLote: undefined });
    const r = await facturarLoteConAgente({ tenantId: TENANT, comercio: 'la_gas', tickets: [ticket('g1')], modo: 'emitir' });
    expect(r.emisionSinConfirmar).toBe(true);
  });

  it('en ensayo NO se marca: ahí no se aprieta emitir', async () => {
    registrarAdaptador(TENANT, quienLanza());
    const r = await facturarLoteConAgente({ tenantId: TENANT, comercio: 'la_gas', tickets: [ticket('g1')], modo: 'ensayo' });
    expect(r.emisionSinConfirmar).toBeUndefined();
  });
});
