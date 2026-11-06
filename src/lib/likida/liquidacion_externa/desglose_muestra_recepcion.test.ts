import { describe, it, expect, vi } from 'vitest';
import {
  esFormatoMuestraTms, muestraTmsHabilitada, prepararMuestraTms, registrarRevisionesMuestra, resumenRevisiones,
  MAX_BITACORAS_MUESTRA, MAX_RENGLONES_BLOQUE_MUESTRA, VERSION_MUESTRA_TMS,
} from './desglose_muestra_recepcion';
import { BITACORA_MUESTRA, NETO_MUESTRA_CENTAVOS, PADRON_MUESTRA } from './desglose_muestra_tms.fixture';
import { netoEnCentavos } from './desglose_reglas';

// Contrato SUPUESTO (muestra del cliente, 5-nov-2026). Datos sintéticos.
const sobre = (bitacoras: unknown[], extra: Record<string, unknown> = {}) => ({ formato: 'muestra-tms', version: VERSION_MUESTRA_TMS, bitacoras, ...extra });
const una = (o: Record<string, unknown> = {}) => ({ ...BITACORA_MUESTRA, ...o });
const preparar = (c: Record<string, unknown>, padron = PADRON_MUESTRA) => prepararMuestraTms(c, padron);
const ok = (c: Record<string, unknown>, padron = PADRON_MUESTRA) => {
  const r = preparar(c, padron);
  if (!r.ok) throw new Error(r.mensaje);
  return r;
};

describe('reconocer el formato por su forma', () => {
  it('sobre con formato o bitácora suelta; el contrato interno no se confunde', () => {
    expect(esFormatoMuestraTms(sobre([]))).toBe(true);
    expect(esFormatoMuestraTms({ ...BITACORA_MUESTRA })).toBe(true);
    expect(esFormatoMuestraTms({ desgloses: [] })).toBe(false);
    expect(esFormatoMuestraTms({ terminal: 'T1', bitacora: 'B-1', poliza: 'P', bitacoras: ['B-1'] })).toBe(false);
  });
});

describe('caso feliz y formato interno intacto', () => {
  it('convierte, cuadra al centavo y marca lista', () => {
    const r = ok(sobre([una()]));
    expect(r.revisiones).toEqual([]);
    expect(r.desgloses).toHaveLength(1);
    expect(r.desgloses[0]).toMatchObject({ bitacora: '900001', operador: { numeroEmpleado: '1001' }, desde: '2026-10-09', hasta: '2026-10-14' });
    expect(netoEnCentavos(r.desgloses[0])).toBe(NETO_MUESTRA_CENTAVOS);
  });
  it('una bitácora suelta equivale al sobre de una', () => {
    expect(ok({ ...una() }).desgloses).toEqual(ok(sobre([una()])).desgloses);
  });
  it('montos con centavos y deducciones se leen exactos', () => {
    const r = ok(sobre([una()]));
    expect(r.desgloses[0].percepciones.map((p) => p.monto)).toContain(500.5);
    expect(r.desgloses[0].deducciones.map((p) => p.monto)).toEqual([200.1, 350, 1000, 99.9]);
  });
});

describe('revisión: nunca se adivina', () => {
  it('operador ausente, ambiguo o sin padrón ⇒ revisión y sin desglose', () => {
    const r = ok(sobre([una({ Operador: 'Nadie Ficticio' }), una({ BitacoraID: 900002, Operador: 'Homónimo Ficticio' })]));
    expect(r.desgloses).toEqual([]);
    expect(r.revisiones.map((x) => [x.bitacora, x.motivos.map((m) => m.codigo)])).toEqual([
      ['900001', ['operador_no_encontrado']], ['900002', ['operador_homonimo']]]);
    const sp = prepararMuestraTms(sobre([una()]), undefined);
    expect(sp.ok && sp.revisiones[0].motivos[0].codigo).toBe('operador_sin_padron');
  });
  it('operador del padrón sin número de empleado ⇒ revisión', () => {
    const r = ok(sobre([una({ Operador: 'Sin Numero' })]), [{ numeroEmpleado: '', nombre: 'Sin Numero' }]);
    expect(r.revisiones[0].motivos.map((m) => m.codigo)).toEqual(['operador_sin_numero']);
  });
  it('acentos, mayúsculas y espacios no impiden la coincidencia única', () => {
    expect(ok(sobre([una({ Operador: '  OPERADOR   ficticio uno ' })])).desgloses).toHaveLength(1);
  });
  it('fecha inválida o invertida ⇒ revisión; las demás siguen', () => {
    const r = ok(sobre([una({ Fecha: { Inicia: 'ayer', Termina: '2026-10-14 20:00:00' } }), una({ BitacoraID: 900003 })]));
    expect(r.desgloses).toHaveLength(1);
    expect(r.revisiones[0].motivos[0].codigo).toBe('fecha_invalida');
    expect(r.revisiones[0].indice).toBe(0);
  });
  it('monto con 3 decimales o texto ⇒ revisión (no se redondea)', () => {
    for (const m of [10.005, '10.00']) {
      const r = ok(sobre([una({ Percepciones: [{ Descripcion: 'Sueldo', Monto: m }] })]));
      expect(r.desgloses).toEqual([]);
      expect(r.revisiones).toHaveLength(1);
    }
  });
  it('concepto desconocido: se conserva pero NO queda lista', () => {
    const r = ok(sobre([una({ Percepciones: [{ Descripcion: 'Concepto raro', Monto: 5 }] })]));
    expect(r.desgloses).toEqual([]);
    expect(r.revisiones[0].motivos.map((m) => m.codigo)).toEqual(['concepto_desconocido']);
  });
  it('BitacoraID repetida en el lote: ambas a revisión', () => {
    const r = ok(sobre([una(), una()]));
    expect(r.desgloses).toEqual([]);
    expect(r.revisiones.map((x) => x.motivos.map((m) => m.codigo))).toEqual([['bitacora_repetida'], ['bitacora_repetida']]);
  });
  it('fila que no es objeto o sin BitacoraID legible: revisión sin clave', () => {
    const r = ok(sobre([7, una({ BitacoraID: 0 }), una({ BitacoraID: 900009 })]));
    expect(r.desgloses).toHaveLength(1);
    expect(r.revisiones.map((x) => x.bitacora)).toEqual([null, null]);
  });
});

describe('sobre estricto y límites (400, no se procesa nada)', () => {
  const msg = (c: Record<string, unknown>) => { const r = preparar(c); return r.ok ? null : r.mensaje; };
  it('lote vacío, campo desconocido, versión, mezcla y tipo', () => {
    expect(msg(sobre([]))).toMatch(/vacía/);
    expect(msg(sobre([una()], { tenant_id: 'x' }))).toMatch(/tenant_id/);
    expect(msg(sobre([una()], { version: 2 }))).toMatch(/Versión/);
    expect(msg({ formato: 'muestra-tms' })).toMatch(/lista/);
    expect(msg(sobre([una()], { desgloses: [] }))).toMatch(/mezcla/);
    expect(msg({ ...una(), version: 1 })).toMatch(/suelta/);
  });
  it('lote enorme y bloque con demasiados renglones', () => {
    expect(msg(sobre(Array.from({ length: MAX_BITACORAS_MUESTRA + 1 }, (_, i) => una({ BitacoraID: 1000 + i }))))).toMatch(/Máximo/);
    expect(ok(sobre(Array.from({ length: MAX_BITACORAS_MUESTRA }, (_, i) => una({ BitacoraID: 1000 + i })))).desgloses).toHaveLength(MAX_BITACORAS_MUESTRA);
    const muchos = Array.from({ length: MAX_RENGLONES_BLOQUE_MUESTRA + 1 }, () => ({ Descripcion: 'Bono', Monto: 1 }));
    expect(msg(sobre([una({ Percepciones: muchos })]))).toMatch(/renglones/);
  });
});

describe('habilitación: apagado por defecto y falla cerrado', () => {
  const base = { bandera: () => true, leer: async () => 'encendido' as const, leerConfig: async () => ({ activa: true, canal: 'correo' as const }) };
  it('solo con bandera, interruptores y envío activo por correo', async () => {
    expect(await muestraTmsHabilitada('t', base)).toEqual({ ok: true });
    expect(await muestraTmsHabilitada('t', { ...base, bandera: () => false })).toEqual({ ok: false, motivo: 'bandera_apagada' });
    expect(await muestraTmsHabilitada('t', { ...base, leer: async () => 'apagado' })).toMatchObject({ ok: false, motivo: 'interruptor_apagado' });
    expect(await muestraTmsHabilitada('t', { ...base, leer: async () => 'ilegible' })).toMatchObject({ ok: false });
    expect(await muestraTmsHabilitada('t', { ...base, leerConfig: async () => ({ activa: false, canal: 'correo' }) })).toMatchObject({ motivo: 'envio_no_activo' });
    expect(await muestraTmsHabilitada('t', { ...base, leerConfig: async () => ({ activa: true, canal: 'whatsapp' }) })).toMatchObject({ motivo: 'envio_no_activo' });
    expect(await muestraTmsHabilitada('t', { ...base, leerConfig: async () => { throw new Error('x'); } })).toMatchObject({ ok: false });
  });
  it('la bandera de plataforma por omisión está apagada', async () => {
    const { banderaMuestraTmsEncendida } = await import('./desglose_muestra_recepcion');
    expect(banderaMuestraTmsEncendida()).toBe(false);
  });
});

describe('registrar revisiones en la bandeja existente', () => {
  it('operador ⇒ operador_no_encontrado; resto ⇒ mapeo_invalido; sin nombres personales', async () => {
    const abrirExcepcion = vi.fn(async () => ({ id: 1, nueva: true }));
    const r = ok(sobre([una({ Operador: 'Homónimo Ficticio', Fecha: null }), una({ BitacoraID: 900004, Operador: 'Nadie Ficticio' }), 7]));
    const n = await registrarRevisionesMuestra('t-1', r.revisiones, (b) => `BIT-${b}`, { abrirExcepcion, ahora: () => new Date('2026-11-05T12:00:00Z') });
    expect(n).toBe(3);
    const llamadas = abrirExcepcion.mock.calls as unknown as Array<[string, string, string, Record<string, unknown>]>;
    expect(llamadas.map((c) => [c[0], c[1], c[2]])).toEqual([
      ['t-1', 'BIT-900001', 'operador_no_encontrado'], ['t-1', 'BIT-900001', 'mapeo_invalido'], ['t-1', 'BIT-900004', 'operador_no_encontrado']]);
    expect(llamadas[0][3]).toMatchObject({ motivo: 'nombre_ambiguo' });
    expect(llamadas[2][3]).toMatchObject({ motivo: 'nombre_sin_alta' });
    expect(JSON.stringify(llamadas)).not.toMatch(/Ficticio/);
  });
  it('el resumen de la respuesta no lleva valores', () => {
    const r = ok(sobre([una({ Operador: 'Nadie Ficticio' })]));
    expect(JSON.stringify(resumenRevisiones(r.revisiones))).not.toMatch(/Ficticio/);
  });
});

describe('cerrarRevisionesResueltas', () => {
  it('cierra operador_no_encontrado y mapeo_invalido de cada clave limpia, y un fallo no tumba el resto', async () => {
    const { cerrarRevisionesResueltas } = await import('./desglose_muestra_recepcion');
    const llamadas: string[] = [];
    const n = await cerrarRevisionesResueltas('t-1', ['BIT-1', 'BIT-2'], {
      ahora: () => new Date('2026-01-01T00:00:00Z'),
      resolverExcepciones: async (t, clave, tipo) => {
        llamadas.push(`${t}:${clave}:${tipo}`);
        if (clave === 'BIT-1' && tipo === 'mapeo_invalido') throw new Error('falla');
        return 1;
      },
    });
    expect(llamadas).toEqual(['t-1:BIT-1:operador_no_encontrado', 't-1:BIT-1:mapeo_invalido', 't-1:BIT-2:operador_no_encontrado', 't-1:BIT-2:mapeo_invalido']);
    expect(n).toBe(3);
  });
});
