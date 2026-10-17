import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SIN_TMS, type EntradaCarga } from './tms_puerto';
import { crearTmsFalso } from './tms_falso.fixture';

const entrada = (over: Partial<EntradaCarga> = {}): EntradaCarga => ({
  tenantId: 't1',
  idempotencyKey: 'k1',
  archivo: new Uint8Array([1, 2, 3]),
  nombre: 'plantilla.xlsx',
  mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  plantilla: 'nueva',
  metadatos: { clienteInterno: 'CLI-SINTETICO', folio: 'F-1' },
  ...over,
});

describe('doble de TMS: cada modo devuelve la clase esperada', () => {
  it('ok', async () => {
    expect(await crearTmsFalso('ok').cargarPlantilla(entrada())).toEqual({ ok: true, referencia: 'REF-1', duplicado: false });
  });
  it.each([
    ['reque_inexistente', 'reque_inexistente'],
    ['auth', 'auth'],
    ['transitorio', 'transitorio'],
  ] as const)('%s', async (modo, clase) => {
    const r = await crearTmsFalso(modo).cargarPlantilla(entrada());
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.clase).toBe(clase); expect(r.mensajeLlano.length).toBeGreaterThan(0); }
  });
  it('transitorio indica cuándo reintentar', async () => {
    const r = await crearTmsFalso('transitorio').cargarPlantilla(entrada());
    expect(!r.ok && r.reintentarEnMs).toBeGreaterThan(0);
  });
  it('validacion trae errores por fila y campo', async () => {
    const r = await crearTmsFalso('validacion').cargarPlantilla(entrada());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.clase).toBe('validacion');
      expect(r.errores.length).toBeGreaterThan(0);
      expect(r.errores[0]).toMatchObject({ fila: expect.any(Number), campo: expect.any(String), detalle: expect.any(String) });
    }
  });
  it('lento termina ok y respeta la cancelación', async () => {
    expect((await crearTmsFalso('lento', { lentoMs: 5 }).cargarPlantilla(entrada())).ok).toBe(true);
    const ac = new AbortController();
    const p = crearTmsFalso('lento', { lentoMs: 1000 }).cargarPlantilla(entrada(), ac.signal);
    ac.abort();
    await expect(p).rejects.toThrow('abortado');
  });
  it('duplicado: misma idempotencyKey → ok con duplicado:true; contenido distinto → duplicado_distinto', async () => {
    const tms = crearTmsFalso('duplicado');
    const a = await tms.cargarPlantilla(entrada());
    const b = await tms.cargarPlantilla(entrada());
    expect(a).toMatchObject({ ok: true, duplicado: false });
    expect(b).toMatchObject({ ok: true, duplicado: true });
    const c = await tms.cargarPlantilla(entrada({ archivo: new Uint8Array([9, 9, 9, 9]) }));
    expect(!c.ok && c.clase).toBe('duplicado_distinto');
  });
  it('registra las llamadas', async () => {
    const tms = crearTmsFalso('ok');
    await tms.cargarPlantilla(entrada());
    expect(tms.llamadas).toHaveLength(1);
  });
});

describe('SIN_TMS (modo manual)', () => {
  it('nunca lanza y responde permanente con mensaje llano', async () => {
    const r = await SIN_TMS.cargarPlantilla(entrada());
    expect(r).toEqual({
      ok: false,
      clase: 'permanente',
      mensajeLlano: 'Esta flota no tiene conectado el sistema del cliente: descarga la plantilla y súbela a mano.',
      errores: [],
    });
    await expect(SIN_TMS.cargarPlantilla(entrada({ archivo: new Uint8Array(0) }))).resolves.toMatchObject({ ok: false });
  });
  it('no declara operaciones opcionales (no acordadas)', () => {
    expect(SIN_TMS.consultarReque).toBeUndefined();
    expect(SIN_TMS.consultarEstadoCcp).toBeUndefined();
  });
});

describe('el puerto no toca el camino del timbre', () => {
  it.each(['tms_puerto.ts', 'tms_falso.fixture.ts'])('%s no importa pac/*, carta_porte_timbre ni carta_porte_cfdi', (f) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- archivo fijo del repo
    const src = readFileSync(join(process.cwd(), 'src/lib/likida/carta_porte_docs', f), 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    expect(/from ['"][^'"]*(carta_porte_timbre|carta_porte_cfdi|\/pac\/|pac\/index|carta_porte_xml)['"]/.test(src)).toBe(false);
  });
});
