import { describe, it, expect } from 'vitest';
import {
  centavosDeMontoMuestra, convertirBitacoraMuestra, convertirMuestraTms, listaDeMuestra, EnvoltorioInvalido,
  resolverOperadorPorNombre, CONTRATOS_DESGLOSE_TMS, NO_DISPONIBLE_MUESTRA,
} from './desglose_muestra_tms';
import { BITACORA_MUESTRA, NETO_MUESTRA_CENTAVOS, PADRON_MUESTRA } from './desglose_muestra_tms.fixture';
import { aplicarRenombres, RENOMBRE_EJEMPLO, netoEnCentavos } from './desglose_reglas';
import { aLiquidacionExterna } from './desglose_contrato';

const padron = PADRON_MUESTRA;
const conv = (o: Record<string, unknown>) => convertirBitacoraMuestra({ ...BITACORA_MUESTRA, ...o }, { padron });
const codigos = (r: { revision: Array<{ codigo: string }> }) => r.revision.map((m) => m.codigo);

describe('muestra-tms · caso feliz', () => {
  it('convierte, resuelve el operador por nombre y cuadra al centavo', () => {
    const r = conv({});
    expect(r.revision).toEqual([]);
    expect(r.desglose).toMatchObject({
      bitacora: '900001', poliza: null, unidad: '526', desde: '2026-10-09', hasta: '2026-10-14',
      operador: { numeroEmpleado: '1001', nombre: 'Operador Ficticio Uno' },
    });
    expect(r.desglose?.percepciones).toHaveLength(4);
    expect(r.desglose?.deducciones[3]).toEqual({ concepto: 'Diésel excedente', monto: 99.9 });
    expect(r.netoCentavos).toBe(NETO_MUESTRA_CENTAVOS);
    expect(netoEnCentavos(r.desglose!)).toBe(NETO_MUESTRA_CENTAVOS);
    expect(aLiquidacionExterna(r.desglose!, { sistemaOrigen: 't' }).totalOrigen).toBe('calculado');
    expect(r.periodoMx?.inicia).toBe('2026-10-09T12:00:00.000Z');
  });

  it('lo que la muestra no trae queda no disponible y NO se inventa', () => {
    const r = conv({});
    expect(r.noDisponible).toEqual([...NO_DISPONIBLE_MUESTRA, 'numeroEmpleado', 'tipoOperador', 'poliza', 'numeroPago', 'neto', 'folio']);
    expect(r.desglose).not.toHaveProperty('numeroLiquidacion');
    expect(r.desglose).not.toHaveProperty('tipoOperador');
    expect(r.desglose).not.toHaveProperty('terminal');
    expect(r.desglose).not.toHaveProperty('neto');
    expect(r.desglose).not.toHaveProperty('enviadoOrigen');
  });

  it('diésel es categoría «otros» y la regla existente del contralor lo renombra', () => {
    const r = conv({});
    expect(r.categorias.find((c) => c.donde === 'Deducciones[3]')?.categoria).toBe('otros');
    expect(aplicarRenombres(r.desglose!.deducciones, [RENOMBRE_EJEMPLO]).map((d) => d.concepto)).toContain('Otros');
    expect(r.categorias.map((c) => c.categoria)).toEqual(
      ['sueldo', 'bono', 'estadia', 'recoleccion', 'fonacot', 'infonavit', 'anticipo', 'otros']);
  });

  it('el registro de contratos conserva el supuesto y añade la muestra', () => {
    expect(Object.keys(CONTRATOS_DESGLOSE_TMS)).toEqual(['supuesto', 'muestra-tms']);
  });
});

describe('muestra-tms · casos límite de la bitácora', () => {
  it('arreglos vacíos o todo en cero ⇒ revisión sin renglones', () => {
    expect(codigos(conv({ Percepciones: [], Deducciones: [] }))).toEqual(['sin_renglones']);
    const r = conv({ Percepciones: [{ Descripcion: 'Sueldo', Monto: 0 }], Deducciones: [] });
    expect(codigos(r)).toEqual(['sin_renglones']);
    expect(r.ignorados).toHaveLength(1);
  });

  it('BitacoraID 0, negativo, texto o ausente ⇒ revisión', () => {
    for (const v of [0, -3, 1.5, null, undefined, '', 'con espacio', 'raro/slash', 'x'.repeat(41), 2 ** 60]) expect(codigos(conv({ BitacoraID: v }))).toContain('bitacora_invalida');
    expect(conv({ BitacoraID: 0 }).desglose).toBeNull();
  });

  it('fechas inválidas, imposibles o invertidas ⇒ revisión', () => {
    expect(codigos(conv({ Fecha: { Inicia: 'ayer', Termina: '2026-10-14 20:00:00' } }))).toEqual(['fecha_invalida']);
    expect(codigos(conv({ Fecha: { Inicia: '2026-02-30 06:00:00', Termina: '2026-10-14 20:00:00' } }))).toEqual(['fecha_invalida']);
    expect(codigos(conv({ Fecha: { Inicia: '2026-10-09 25:00:00', Termina: '2026-10-14 20:00:00' } }))).toEqual(['fecha_invalida']);
    expect(codigos(conv({ Fecha: { Inicia: '2026-10-09T06:00:00Z', Termina: '2026-10-14 20:00:00' } }))).toEqual(['fecha_invalida']);
    expect(codigos(conv({ Fecha: { Inicia: '2026-10-14 20:00:00', Termina: '2026-10-09 06:00:00' } }))).toEqual(['fechas_invertidas']);
    expect(codigos(conv({ Fecha: null }))).toEqual(['fecha_invalida']);
  });

  it('el día del periodo es el local de México', () => {
    const r = conv({ Fecha: { Inicia: '2026-10-09 23:30:00', Termina: '2026-10-10 00:15:00' } });
    expect(r.desglose).toMatchObject({ desde: '2026-10-09', hasta: '2026-10-10' });
  });

  it('montos null, negativo, 3 decimales, texto y NaN ⇒ revisión y sin desglose', () => {
    const casos: Array<[unknown, string]> = [[null, 'monto_nulo'], [-5, 'monto_negativo'], [1500.505, 'monto_decimales'],
      ['100.00', 'monto_no_numerico'], [Number.NaN, 'monto_no_numerico'], [Infinity, 'monto_no_numerico'], [1e21, 'monto_excesivo']];
    for (const [monto, codigo] of casos) {
      const r = conv({ Percepciones: [{ Descripcion: 'Sueldo', Monto: monto }], Deducciones: [] });
      expect(codigos(r)).toEqual([codigo]);
      expect(r.desglose).toBeNull();
    }
  });

  it('descripción desconocida ⇒ el renglón se conserva y la bitácora va a revisión', () => {
    const r = conv({ Percepciones: [{ Descripcion: 'Concepto raro 77', Monto: 10 }], Deducciones: [] });
    expect(codigos(r)).toEqual(['concepto_desconocido']);
    expect(r.requiereRevision).toBe(true);
    expect(r.desglose?.percepciones).toEqual([{ concepto: 'Concepto raro 77', monto: 10 }]);
  });

  it('concepto conocido del lado contrario ⇒ revisión', () => {
    const r = conv({ Percepciones: [{ Descripcion: 'Fonacot', Monto: 10 }], Deducciones: [] });
    expect(codigos(r)).toEqual(['concepto_lado_inesperado']);
  });

  it('operador homónimo, inexistente, vacío o sin padrón ⇒ revisión, nunca se adivina', () => {
    expect(codigos(conv({ Operador: 'Homónimo Ficticio' }))).toEqual(['operador_homonimo']);
    expect(conv({ Operador: 'Homónimo Ficticio' }).desglose).toBeNull();
    expect(codigos(conv({ Operador: 'Nadie Ficticio' }))).toEqual(['operador_no_encontrado']);
    expect(codigos(conv({ Operador: '  ' }))).toEqual(['operador_vacio']);
    expect(codigos(convertirBitacoraMuestra(BITACORA_MUESTRA, {}))).toEqual(['operador_sin_padron']);
    expect(codigos(conv({ Operador: 'Operador Ficticio' }))).toEqual(['operador_no_encontrado']); // sin parecidos
  });

  it('la misma persona dos veces en el padrón no es homonimia; acentos y mayúsculas no importan', () => {
    const p = [{ numeroEmpleado: '7', nombre: 'José Ficticio' }, { numeroEmpleado: '7', nombre: 'JOSE  FICTICIO' }];
    expect(resolverOperadorPorNombre('jose ficticio', p)).toMatchObject({ ok: true });
  });

  it('campos extra se ignoran; filas que no son objeto o listas mal formadas no rompen', () => {
    expect(conv({ Otro: 1 }).revision).toEqual([]);
    expect(codigos(convertirBitacoraMuestra('texto', { padron }))).toEqual(['fila_invalida']);
    expect(codigos(conv({ Percepciones: 'x' }))).toContain('estructura_invalida');
    expect(codigos(conv({ Percepciones: [5] }))).toContain('estructura_invalida');
  });
});

describe('muestra-tms · montos sin errores de coma flotante', () => {
  it('convierte exacto', () => {
    const oks: Array<[number, number]> = [[0.1, 10], [0.07, 7], [1500.5, 150050], [4000, 400000], [1.15, 115], [19.99, 1999], [8.2, 820], [1234567.89, 123456789]];
    for (const [n, c] of oks) expect(centavosDeMontoMuestra(n)).toEqual({ ok: true, centavos: c });
    expect(centavosDeMontoMuestra(0.1 + 0.2)).toMatchObject({ ok: false, codigo: 'monto_decimales' });
    expect(centavosDeMontoMuestra(-0)).toEqual({ ok: true, centavos: 0 });
  });
  it('suma de muchos renglones de centavos cuadra exacto', () => {
    const r = conv({ Percepciones: Array.from({ length: 30 }, () => ({ Descripcion: 'Bono', Monto: 0.1 })), Deducciones: [] });
    expect(r.netoCentavos).toBe(300);
  });
});

describe('muestra-tms · envoltorio configurable', () => {
  const una = BITACORA_MUESTRA;
  it('arreglo directo y {data:[...]} dan lo mismo en modo auto', () => {
    const a = convertirMuestraTms([una], { padron });
    const b = convertirMuestraTms({ data: [una] }, { padron });
    expect(a.listas).toEqual(b.listas);
    expect(a.listas).toHaveLength(1);
  });
  it('modo estricto rechaza la otra forma; ruta configurable; objeto suelto en auto', () => {
    expect(() => listaDeMuestra({ data: [una] }, { envoltorio: 'arreglo' })).toThrow(EnvoltorioInvalido);
    expect(() => listaDeMuestra([una], { envoltorio: 'envuelto' })).toThrow(EnvoltorioInvalido);
    expect(listaDeMuestra({ resultado: { filas: [una] } }, { envoltorio: 'envuelto', rutaLista: 'resultado.filas' })).toHaveLength(1);
    expect(listaDeMuestra(una, { envoltorio: 'auto' })).toHaveLength(1);
    expect(() => listaDeMuestra({ otra: 1 })).toThrow(EnvoltorioInvalido);
    expect(() => listaDeMuestra('x')).toThrow(EnvoltorioInvalido);
  });
  it('una bitácora mala no tumba a las demás y se separa a revisión', () => {
    const r = convertirMuestraTms({ data: [una, { ...una, BitacoraID: 0 }, 7] }, { padron });
    expect(r.listas).toHaveLength(1);
    expect(r.enRevision.map((x) => x.revision[0].codigo)).toEqual(['bitacora_invalida', 'fila_invalida']);
  });
});
