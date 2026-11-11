import { describe, it, expect } from 'vitest';
import { alertasExtra, type LatidoParaAlerta } from './fuentes-alerta-extra';

const ok = (): LatidoParaAlerta => ({ estado: 'ok', haceMin: 2, ultimoEstado: 'ok', detalle: {} });

describe('alertasExtra', () => {
  it('todo sano: ninguna alerta', () => {
    expect(alertasExtra({ latidos: { runner: ok(), gps: ok() }, credencial: { abierto: false, clase: null } })).toEqual([]);
  });

  it('latidos ilegibles: se DICE, no se calla', () => {
    const a = alertasExtra({ latidos: null });
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ id: 'crons_ilegibles', tipo: 'atencion', href: '/admin/crons' });
  });

  it('vencido y sin_latido producen UNA alerta cron_sin_latido con ambos', () => {
    const a = alertasExtra({ latidos: {
      escalar: { ...ok(), estado: 'vencido', haceMin: 200 },
      tms: { estado: 'sin_latido', haceMin: null, ultimoEstado: null, detalle: {} },
      gps: ok(),
    } });
    expect(a).toHaveLength(1);
    expect(a[0].id).toBe('cron_sin_latido');
    expect(a[0].items).toEqual(['escalar', 'tms']);
    expect(a[0].texto).toMatch(/escalar \(hace 200 min\)/);
    expect(a[0].texto).toMatch(/tms \(nunca latió\)/);
  });

  it('estado no ok: parcial/fallo suenan; apagado por palanca y hueco de configuración NO', () => {
    const a = alertasExtra({ latidos: {
      facturar: { ...ok(), ultimoEstado: 'fallo' },
      gps: { ...ok(), ultimoEstado: 'saltado', detalle: { interruptor: 'global' } },
      'descarga-sat': { ...ok(), ultimoEstado: 'parcial', detalle: { configAusente: true, motivo: 'falta LIKIDA_SAT_PROVEEDOR' } },
    } });
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ id: 'cron_estado_no_ok', items: ['facturar'] });
  });

  it('el runner frenado por la bandeja muestra su motivo', () => {
    const a = alertasExtra({ latidos: {
      runner: { ...ok(), ultimoEstado: 'parcial', detalle: { motivo: 'contrapresión de la bandeja: 48 de 49 agentes no corrieron' } },
    } });
    expect(a[0].texto).toMatch(/runner \(parcial\): contrapresión de la bandeja: 48 de 49/);
  });

  it('crédito agotado (402): por circuito o por sonda', () => {
    const base = { latidos: { runner: ok() } };
    expect(alertasExtra({ ...base, credencial: { abierto: true, clase: 'sin_saldo' } })[0]).toMatchObject({ id: 'ia_credito_agotado', href: '/admin/salud-sistema' });
    expect(alertasExtra({ ...base, sonda: { estado: 'sin_saldo' } })[0].id).toBe('ia_credito_agotado');
    // llave inválida (401) no es «crédito agotado»; sonda ok desmiente nada porque no hay circuito
    expect(alertasExtra({ ...base, credencial: { abierto: true, clase: 'llave_invalida' } })).toEqual([]);
    expect(alertasExtra({ ...base, credencial: { abierto: false, clase: 'sin_saldo' } })).toEqual([]);
  });

  it('las alertas comparten la forma de Alerta (tipo/texto/href)', () => {
    const a = alertasExtra({ latidos: null, sonda: { estado: 'sin_saldo' } });
    for (const x of a) expect(x).toMatchObject({ tipo: 'atencion', texto: expect.any(String), href: expect.stringMatching(/^\/admin\//) });
  });
});

describe('F14-C: la campana dice cuándo el diagnóstico se detuvo', () => {
  const con = (estado: string) => ({ latidos: { guardia: { estado: 'ok' as const, haceMin: 1, ultimoEstado: 'ok' as const, detalle: { diagnostico: { estado } } } } });
  it('tope y gasto ilegible suenan; ok no', () => {
    expect(alertasExtra(con('tope')).map((a) => a.id)).toContain('diagnostico_tope');
    expect(alertasExtra(con('gasto_ilegible')).map((a) => a.id)).toContain('diagnostico_sin_gasto');
    expect(alertasExtra(con('ok')).map((a) => a.id)).not.toContain('diagnostico_tope');
  });
});
