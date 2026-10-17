import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { esFlotaSimulada, PREFIJO_REFERENCIA_SIMULADA, salidaSimulada } from './salida_simulada';
import { salidaDeFlota } from './worker_envios_deps';
import { SIN_TMS, type EntradaCarga } from './tms_puerto';

const SINTETICA = '11111111-1111-4111-8111-111111111111';
const OTRA = '22222222-2222-4222-8222-222222222222';

const carga = (llave: string): EntradaCarga => ({
  tenantId: SINTETICA, idempotencyKey: llave, archivo: new Uint8Array([1, 2, 3]), nombre: 'plantilla.xlsx',
  mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', plantilla: 'normal', metadatos: { clienteInterno: null, folio: null },
});

describe('esFlotaSimulada: solo las flotas declaradas una por una', () => {
  it('sin variable o vacía, ninguna flota', () => {
    expect(esFlotaSimulada(SINTETICA, {})).toBe(false);
    expect(esFlotaSimulada(SINTETICA, { SALIDA_TMS_SIMULADA: '' })).toBe(false);
    expect(esFlotaSimulada('', { SALIDA_TMS_SIMULADA: ',' })).toBe(false);
  });
  it('con lista, solo las que aparecen (sin importar mayúsculas ni espacios)', () => {
    const env = { SALIDA_TMS_SIMULADA: ` ${SINTETICA.toUpperCase()} , ${'33333333-3333-4333-8333-333333333333'}` };
    expect(esFlotaSimulada(SINTETICA, env)).toBe(true);
    expect(esFlotaSimulada(OTRA, env)).toBe(false);
  });
});

describe('salidaSimulada: acepta, rotula la referencia y es idempotente', () => {
  it('devuelve ok con referencia SIMULADO-… y marca el duplicado de la misma llave', async () => {
    const s = salidaSimulada();
    const a = await s.cargarPlantilla(carga('k1'));
    const b = await s.cargarPlantilla(carga('k1'));
    const c = await s.cargarPlantilla(carga('k2'));
    expect(a).toMatchObject({ ok: true, duplicado: false });
    expect(a.ok && a.referencia?.startsWith(PREFIJO_REFERENCIA_SIMULADA)).toBe(true);
    expect(b).toMatchObject({ ok: true, duplicado: true, referencia: a.ok ? a.referencia : null });
    expect(c.ok && c.referencia).not.toBe(a.ok && a.referencia);
  });
});

describe('salidaDeFlota: el simulador solo para la flota declarada', () => {
  it('flota declarada ⇒ simulador; cualquier otra ⇒ SIN_TMS', async () => {
    const antes = process.env.SALIDA_TMS_SIMULADA;
    process.env.SALIDA_TMS_SIMULADA = SINTETICA;
    try {
      const sim = await salidaDeFlota(SINTETICA);
      expect(sim).not.toBe(SIN_TMS);
      expect(await sim.cargarPlantilla(carga('k'))).toMatchObject({ ok: true });
      expect(await salidaDeFlota(OTRA)).toBe(SIN_TMS);
    } finally {
      if (antes === undefined) delete process.env.SALIDA_TMS_SIMULADA; else process.env.SALIDA_TMS_SIMULADA = antes;
    }
  });
});

describe('guion neutral de la demo (docs/demo/a3-salida-tms.md)', () => {
  const ruta = fileURLToPath(new URL('../../../../docs/demo/a3-salida-tms.md', import.meta.url));
  it('existe, recorre las 5 muestras, termina en «subido al TMS (simulado)» y no promete lo real', () => {
    expect(existsSync(ruta)).toBe(true);
    const t = readFileSync(ruta, 'utf8');
    for (const m of ['M1', 'M2', 'M3', 'M4', 'M5']) expect(t).toContain(m);
    expect(t).toMatch(/subido al TMS \(simulado\)/i);
    expect(t).toMatch(/exportacion\.ts/);
    expect(t).not.toMatch(/subida real (est[aá]|funciona)/i);
  });
});
