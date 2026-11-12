import { describe, it, expect } from 'vitest';
import {
  CATALOGO_CONCEPTOS_MUESTRA, convertirBitacoraMuestra, convertirMuestraTms, resolverOperadorPorNumero,
} from './desglose_muestra_tms';
import { BITACORA_MUESTRA, NETO_MUESTRA_CENTAVOS, PADRON_MUESTRA } from './desglose_muestra_tms.fixture';
import { aLiquidacionExterna } from './desglose_contrato';
import { motivoOperadorDe, prepararMuestraTms, registrarRevisionesMuestra } from './desglose_muestra_recepcion';

// Campos que se agregaron para el piloto del webhook (11-nov-2026). Datos sintéticos.
const PADRON = [...PADRON_MUESTRA];
const conv = (o: Record<string, unknown>, extra: { padron?: typeof PADRON } = {}) =>
  convertirBitacoraMuestra({ ...BITACORA_MUESTRA, ...o }, { padron: extra.padron ?? PADRON });
const codigos = (r: { revision: Array<{ codigo: string }> }) => r.revision.map((m) => m.codigo);
const NETO = NETO_MUESTRA_CENTAVOS / 100;

describe('P0-1 · NumeroEmpleado manda sobre el nombre', () => {
  it('cruza por número aunque el nombre no venga', () => {
    const r = conv({ Operador: undefined, NumeroEmpleado: '1002' });
    expect(r.revision).toEqual([]);
    expect(r.desglose?.operador).toEqual({ numeroEmpleado: '1002', nombre: 'Operador Ficticio Dos' });
  });

  it('acepta el número como entero y con espacios de más', () => {
    expect(conv({ NumeroEmpleado: 1001 }).desglose?.operador.numeroEmpleado).toBe('1001');
    expect(conv({ NumeroEmpleado: '  1001 ' }).desglose?.operador.numeroEmpleado).toBe('1001');
  });

  it('si viene el nombre y coincide con el del padrón para ese número (normalizado), entra', () => {
    expect(codigos(conv({ NumeroEmpleado: '1001', Operador: 'OPERADOR  ficticio uno' }))).toEqual([]);
  });

  it('nombre que NO coincide con el padrón para ese número ⇒ revisión `operador_no_coincide` (no se adivina cuál está mal)', () => {
    const r = conv({ NumeroEmpleado: '1002', Operador: 'Operador Ficticio Uno' });
    expect(codigos(r)).toEqual(['operador_no_coincide']);
    expect(r.desglose).toBeNull();
    expect(JSON.stringify(r.revision)).not.toMatch(/Ficticio/);
  });

  it('el número manda: un nombre que existe en el padrón NO rescata un número que no existe', () => {
    const r = conv({ NumeroEmpleado: '9999', Operador: 'Operador Ficticio Uno' });
    expect(codigos(r)).toEqual(['operador_no_encontrado']);
    expect(r.revision[0].campo).toBe('NumeroEmpleado');
    expect(r.desglose).toBeNull();
  });

  it('sin NumeroEmpleado sigue el cruce por nombre de siempre (incluida la homonimia)', () => {
    expect(conv({}).desglose?.operador.numeroEmpleado).toBe('1001');
    expect(codigos(conv({ Operador: 'Homónimo Ficticio' }))).toEqual(['operador_homonimo']);
    for (const v of [null, '', '  ']) expect(conv({ NumeroEmpleado: v }).desglose?.operador.numeroEmpleado).toBe('1001');
  });

  it('sin número ni nombre ⇒ `operador_vacio`', () => {
    expect(codigos(conv({ Operador: '', NumeroEmpleado: undefined }))).toContain('operador_vacio');
  });

  it('NumeroEmpleado inválido (largo, control, tipo) ⇒ revisión de ESA bitácora, sin caer al cruce por nombre', () => {
    for (const v of ['9'.repeat(41), 'a\nb', { x: 1 }, true, -4, 1.5]) {
      const r = conv({ NumeroEmpleado: v });
      expect(codigos(r), JSON.stringify(v)).toEqual(['numero_empleado_invalido']);
      expect(r.desglose).toBeNull();
    }
  });

  it('el mismo número con dos nombres distintos en el padrón ⇒ ambiguo; la misma persona listada dos veces no', () => {
    expect(resolverOperadorPorNumero('7', [{ numeroEmpleado: '7', nombre: 'Ana Ficticia' }, { numeroEmpleado: '7', nombre: 'Beto Ficticio' }]))
      .toEqual({ ok: false, codigo: 'operador_homonimo' });
    expect(resolverOperadorPorNumero('7', [{ numeroEmpleado: '7', nombre: 'Ana Ficticia' }, { numeroEmpleado: ' 7', nombre: 'ANA  ficticia' }]).ok).toBe(true);
  });

  it('sin padrón: no hay con qué resolver', () => {
    expect(codigos(convertirBitacoraMuestra({ ...BITACORA_MUESTRA, NumeroEmpleado: '1001' }))).toEqual(['operador_sin_padron']);
  });

  it('el motivo que ve el panel distingue número sin alta, no coincide y ambiguo', () => {
    expect(motivoOperadorDe('operador_no_encontrado', 'NumeroEmpleado')).toBe('numero_sin_alta');
    expect(motivoOperadorDe('operador_no_coincide', 'Operador')).toBe('numero_no_coincide');
    expect(motivoOperadorDe('operador_homonimo', 'NumeroEmpleado')).toBe('ambiguo');
    expect(motivoOperadorDe('operador_homonimo', 'Operador')).toBe('nombre_ambiguo');
    expect(motivoOperadorDe('operador_no_encontrado', 'Operador')).toBe('nombre_sin_alta');
  });

  it('en la bandeja el no-coincide y el número sin alta salen como operador_no_encontrado con su motivo, sin nombres', async () => {
    const llamadas: Array<[string, string, Record<string, unknown>]> = [];
    const p = prepararMuestraTms({ formato: 'muestra-tms', version: 1, bitacoras: [
      { ...BITACORA_MUESTRA, BitacoraID: 1, NumeroEmpleado: '1002' }, { ...BITACORA_MUESTRA, BitacoraID: 2, NumeroEmpleado: '9999' },
    ] }, PADRON);
    if (!p.ok) throw new Error(p.mensaje);
    await registrarRevisionesMuestra('t', p.revisiones, (b) => `BIT-${b}`, {
      abrirExcepcion: async (_t, clave, tipo, detalle) => { llamadas.push([clave, tipo, detalle]); return { id: 1, nueva: true }; }, ahora: () => new Date(0),
    });
    expect(llamadas.map((l) => [l[0], l[1], l[2].motivo])).toEqual([
      ['BIT-1', 'operador_no_encontrado', 'numero_no_coincide'], ['BIT-2', 'operador_no_encontrado', 'numero_sin_alta']]);
    expect(JSON.stringify(llamadas)).not.toMatch(/Ficticio/);
  });
});

describe('P0-2 · TipoOperador, Poliza, NumeroPago, Neto y Folio', () => {
  it('se leen y alimentan el desglose (la póliza sustituye a null y el tipo viaja para las reglas)', () => {
    const r = conv({ TipoOperador: 'foraneo', Poliza: 'POL-9', NumeroPago: 'P-0001/A', Neto: NETO, Folio: 1098 });
    expect(r.revision).toEqual([]);
    expect(r.desglose).toMatchObject({ tipoOperador: 'foraneo', poliza: 'POL-9', numeroPago: 'P-0001/A', neto: NETO, folio: '1098' });
    expect(aLiquidacionExterna(r.desglose!, { sistemaOrigen: 't' }).totalOrigen).toBe('origen');
    expect(r.noDisponible).not.toContain('poliza');
    expect(r.noDisponible).not.toContain('tipoOperador');
  });

  it('TipoOperador acepta mayúsculas y acento; local y permisionario también', () => {
    for (const [v, esperado] of [['Foráneo', 'foraneo'], ['LOCAL', 'local'], [' Permisionario ', 'permisionario']] as const) {
      expect(conv({ TipoOperador: v }).desglose?.tipoOperador).toBe(esperado);
    }
  });

  it('TipoOperador acepta el catálogo completo (rabón, posturero, cargador) con variantes de acento, mayúsculas y espacios', () => {
    const casos: Array<[string, string]> = [
      ['rabon', 'rabon'], ['Rabón', 'rabon'], ['RABÓN', 'rabon'], [' rabón ', 'rabon'],
      ['Posturero', 'posturero'], ['POSTURERO', 'posturero'], ['Cargador', 'cargador'], ['CARGADOR', 'cargador'],
      ['Foráneo', 'foraneo'], ['FORÁNEO', 'foraneo'], ['foraneo', 'foraneo'], ['Local', 'local'], ['Permisionario', 'permisionario'],
    ];
    for (const [v, esperado] of casos) {
      const r = conv({ TipoOperador: v });
      expect(codigos(r), v).toEqual([]);
      expect(r.desglose?.tipoOperador, v).toBe(esperado);
    }
  });

  it('TipoOperador inválido ⇒ revisión de esa bitácora (nunca tumba el lote)', () => {
    for (const v of ['mixto', 7, true, {}]) {
      const r = conv({ TipoOperador: v });
      expect(codigos(r), JSON.stringify(v)).toEqual(['tipo_operador_invalido']);
      expect(r.desglose).toBeNull();
    }
    const lote = convertirMuestraTms([{ ...BITACORA_MUESTRA, TipoOperador: 'mixto' }, { ...BITACORA_MUESTRA, BitacoraID: 2, TipoOperador: 'local' }], { padron: PADRON });
    expect(lote.listas.map((d) => d.bitacora)).toEqual(['2']);
    expect(lote.enRevision.map((x) => x.bitacoraId)).toEqual(['900001']);
  });

  it('ausentes o null: igual que antes (póliza null, sin tipo) y se listan como no disponibles', () => {
    const r = conv({ TipoOperador: null, Poliza: null, NumeroPago: null, Neto: null, Folio: null });
    expect(r.revision).toEqual([]);
    expect(r.desglose?.poliza).toBeNull();
    expect(r.desglose).not.toHaveProperty('tipoOperador');
    expect(r.noDisponible).toEqual(expect.arrayContaining(['poliza', 'tipoOperador', 'numeroPago', 'neto', 'folio']));
  });

  it('Poliza: texto de hasta 40; con control o más largo ⇒ revisión', () => {
    expect(conv({ Poliza: 'P'.repeat(40) }).desglose?.poliza).toHaveLength(40);
    expect(codigos(conv({ Poliza: 'P'.repeat(41) }))).toEqual(['poliza_invalida']);
    expect(codigos(conv({ Poliza: 'a\tb' }))).toEqual(['poliza_invalida']);
    expect(codigos(conv({ Poliza: { x: 1 } }))).toEqual(['poliza_invalida']);
  });

  it('NumeroPago: [A-Za-z0-9._/-] hasta 40; entero también', () => {
    expect(conv({ NumeroPago: 12 }).desglose?.numeroPago).toBe('12');
    for (const v of ['con espacio', 'a;b', 'ñ1', 'x'.repeat(41), -1]) {
      expect(codigos(conv({ NumeroPago: v })), JSON.stringify(v)).toEqual(['numero_pago_invalido']);
    }
  });

  it('Folio: texto o entero ≤40, sin control; inválido ⇒ revisión', () => {
    expect(conv({ Folio: 'F-77' }).desglose?.folio).toBe('F-77');
    expect(conv({ Folio: 'x'.repeat(41) }).revision.map((m) => m.codigo)).toEqual(['folio_invalido']);
    expect(conv({ Folio: 'a\nb' }).revision.map((m) => m.codigo)).toEqual(['folio_invalido']);
  });

  it('Neto que cuadra con los renglones: se usa como total de origen (cuadre real)', () => {
    expect(conv({ Neto: NETO }).desglose?.neto).toBe(NETO);
  });

  it('Neto que NO cuadra ⇒ revisión `total_no_cuadra` y no se manda a la liquidación', () => {
    const r = conv({ Neto: NETO + 0.01 });
    expect(codigos(r)).toEqual(['total_no_cuadra']);
    expect(r.requiereRevision).toBe(true);
    expect(r.desglose).not.toHaveProperty('neto');
  });

  it('Neto con más de 2 decimales, texto o no finito ⇒ `neto_invalido`', () => {
    for (const v of [1.005, '3300.75', Number.NaN, Number.POSITIVE_INFINITY, 1e21]) {
      expect(codigos(conv({ Neto: v })), String(v)).toEqual(['neto_invalido']);
    }
  });

  it('Neto negativo y consistente se admite (lo retiene la guarda existente, no esta capa)', () => {
    const r = convertirBitacoraMuestra({
      ...BITACORA_MUESTRA, Percepciones: [{ Descripcion: 'Sueldo', Monto: 100 }], Deducciones: [{ Descripcion: 'Anticipo', Monto: 250.5 }], Neto: -150.5,
    }, { padron: PADRON });
    expect(r.revision).toEqual([]);
    expect(r.desglose?.neto).toBe(-150.5);
  });

  it('un valor inválido en un campo opcional no impide que se informen los demás motivos de la misma bitácora', () => {
    const r = conv({ TipoOperador: 'x', Poliza: 'a\nb', Folio: 'a\nb' });
    expect(codigos(r)).toEqual(['tipo_operador_invalido', 'poliza_invalida', 'folio_invalido']);
  });

  it('NumeroLiquidacion se IGNORA a propósito: no cambia la clave ni entra al desglose', () => {
    const r = conv({ NumeroLiquidacion: 'L-123' });
    expect(r.revision).toEqual([]);
    expect(r.desglose).not.toHaveProperty('numeroLiquidacion');
    expect(aLiquidacionExterna(r.desglose!, { sistemaOrigen: 't' }).liquidacion.claveExterna).toBe('BIT-900001');
  });
});

describe('P0-5 · BitacoraID alfanumérico', () => {
  it('acepta entero o texto [A-Za-z0-9._-] de 1 a 40, y la clave es BIT-<id>', () => {
    for (const id of ['A1098', 'tms.2026-11_9', 'x'.repeat(40), 7, '0123']) {
      const r = conv({ BitacoraID: id });
      expect(r.revision, String(id)).toEqual([]);
      expect(aLiquidacionExterna(r.desglose!, { sistemaOrigen: 't' }).liquidacion.claveExterna).toBe(`BIT-${id}`);
    }
  });

  it('dos IDs distintos nunca comparten clave (incluida la diferencia de mayúsculas y los ceros a la izquierda)', () => {
    const ids = ['A-1', 'a-1', 'A_1', 'A.1', '1098', '01098', '1098A'];
    const claves = ids.map((id) => aLiquidacionExterna(conv({ BitacoraID: id }).desglose!, { sistemaOrigen: 't' }).liquidacion.claveExterna);
    expect(new Set(claves).size).toBe(ids.length);
  });

  it('inválidos: espacios, barra, acentos, vacío, más de 40, entero ≤0 o no seguro', () => {
    for (const id of ['a b', 'a/b', 'ñ', '', 'x'.repeat(41), 0, -1, 2 ** 60, 1.5]) {
      expect(codigos(conv({ BitacoraID: id })), JSON.stringify(id)).toContain('bitacora_invalida');
    }
  });
});

describe('P0-3 · catálogo de conceptos: punto único, sin inventar', () => {
  it('un concepto fuera del catálogo sigue yendo a revisión (no se adivina)', () => {
    for (const d of ['Concepto Inventado', 'Bonificacion rara', 'Descuento']) {
      expect(codigos(conv({ Deducciones: [{ Descripcion: d, Monto: 10 }] })), d).toContain('concepto_desconocido');
    }
  });

  it('un catálogo adicional (alias por flota, hoy sin cablear) se suma al base sin tocarlo', () => {
    const adicional = [{ categoria: 'categoria_nueva', lado: 'deduccion' as const, patron: /^concepto nuevo$/ }];
    const r = convertirBitacoraMuestra({ ...BITACORA_MUESTRA, Deducciones: [{ Descripcion: 'Concepto Nuevo', Monto: 10 }] }, { padron: PADRON, conceptosAdicionales: adicional });
    expect(r.revision).toEqual([]);
    expect(r.categorias.find((c) => c.donde === 'Deducciones[0]')?.categoria).toBe('categoria_nueva');
    expect(CATALOGO_CONCEPTOS_MUESTRA.some((c) => c.categoria === 'categoria_nueva')).toBe(false);
  });
});
