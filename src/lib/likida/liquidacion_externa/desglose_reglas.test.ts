import { describe, it, expect } from 'vitest';
import { DESGLOSE_SINTETICO, type RenglonDesglose } from './desglose.fixture';
import { aCentavos } from './esquema';
import { validarDesgloseBitacora, type DesgloseBitacora, type RenglonBitacora } from './desglose_contrato';
import {
  aplicarRenombres, colapsarRenglonViaje, guardasPreEnvio, netoEnCentavos, RENOMBRE_EJEMPLO, type Renombre,
} from './desglose_reglas';

const reng = (r: RenglonDesglose): RenglonBitacora => ({ concepto: r.descripcion, monto: r.monto, ...(r.vale ? { vale: r.vale } : {}) });
const perc = DESGLOSE_SINTETICO.percepciones.map(reng);
const ded = DESGLOSE_SINTETICO.deducciones.map(reng);
const suma = (rs: RenglonBitacora[]) => rs.reduce((a, r) => a + aCentavos(r.monto), 0);

function desglose(extra: Record<string, unknown> = {}): DesgloseBitacora {
  const f = DESGLOSE_SINTETICO;
  return validarDesgloseBitacora({
    terminal: 'TERM1', bitacora: f.bitacora, poliza: 'POL-1', operador: { numeroEmpleado: '900001' }, unidad: f.unidad,
    tipoOperador: 'foraneo', desde: f.desde, hasta: f.hasta, percepciones: perc, deducciones: ded, ...extra,
  });
}

describe('colapsarRenglonViaje', () => {
  it('fixture: 7 percepciones, primera «Pago de viaje» 5 500.50, Σ = 9 850.50', () => {
    const r = colapsarRenglonViaje(perc, { activa: true });
    expect(r).toHaveLength(7);
    expect(r[0]).toEqual({ concepto: 'Pago de viaje', monto: 5500.5 });
    expect(suma(r)).toBe(985050);
    // los viáticos con descripción (taxi, talacha) se conservan
    expect(r.map((x) => x.concepto)).toEqual(expect.arrayContaining(['Taxi', 'Talacha']));
    expect(r.map((x) => x.concepto)).not.toContain('Sueldo');
    expect(r.map((x) => x.concepto)).not.toContain('Viáticos');
  });
  it('desactivada: intacto (copia, no el mismo arreglo)', () => {
    const r = colapsarRenglonViaje(perc, { activa: false });
    expect(r).toEqual(perc);
    expect(r).not.toBe(perc);
  });
  it('etiqueta y conceptos de origen configurables; comparación sin acentos', () => {
    const r = colapsarRenglonViaje(perc, { activa: true, etiqueta: 'Sueldo de viaje', conceptosOrigen: ['sueldo', 'VIATICOS'] });
    expect(r[0]).toEqual({ concepto: 'Sueldo de viaje', monto: 5500.5 });
  });
  it('local con soloTipos [foraneo]: no colapsa; foráneo sí; tipo desconocido no', () => {
    expect(colapsarRenglonViaje(perc, { activa: true, soloTipos: ['foraneo'], tipoOperador: 'local' })).toEqual(perc);
    expect(colapsarRenglonViaje(perc, { activa: true, soloTipos: ['foraneo'] })).toEqual(perc);
    expect(colapsarRenglonViaje(perc, { activa: true, soloTipos: ['foraneo'], tipoOperador: 'foraneo' })).toHaveLength(7);
  });
  it('sin conceptos de origen: no inventa el renglón', () => {
    const solo = perc.filter((p) => p.concepto === 'Taxi');
    expect(colapsarRenglonViaje(solo, { activa: true })).toEqual(solo);
  });
});

describe('aplicarRenombres', () => {
  const conDiesel: RenglonBitacora[] = [...ded, { concepto: 'Descuento diésel', monto: 120.1 }, { concepto: 'Reembolso UREA', monto: 10 }];
  it('diésel→Otros aplicado, total intacto, renglones separados por defecto', () => {
    const r = aplicarRenombres(conDiesel, [RENOMBRE_EJEMPLO]);
    expect(r.filter((x) => x.concepto === 'Otros')).toHaveLength(2);
    expect(r).toHaveLength(conDiesel.length);
    expect(suma(r)).toBe(suma(conDiesel));
  });
  it('fusionar:true suma los renombrados en el lugar del primero', () => {
    const r = aplicarRenombres(conDiesel, [{ ...RENOMBRE_EJEMPLO, fusionar: true }]);
    expect(r.filter((x) => x.concepto === 'Otros')).toEqual([{ concepto: 'Otros', monto: 130.1 }]);
    expect(suma(r)).toBe(suma(conDiesel));
  });
  it('si la fuente ya entregó desglose, no renombra', () => {
    expect(aplicarRenombres(conDiesel, [RENOMBRE_EJEMPLO], { fuenteEntregoDesglose: true })).toEqual(conDiesel);
  });
  it('conserva el vale al renombrar sin fusionar; regex con flag g no arrastra estado', () => {
    const entrada: RenglonBitacora[] = [{ concepto: 'Diesel a', monto: 1, vale: '55' }, { concepto: 'Diesel b', monto: 2 }];
    const r = aplicarRenombres(entrada, [{ patron: /diesel/gi, a: 'Otros' }]);
    expect(r).toEqual([{ concepto: 'Otros', monto: 1, vale: '55' }, { concepto: 'Otros', monto: 2 }]);
  });
  it('sin reglas: copia intacta', () => {
    expect(aplicarRenombres(conDiesel, [])).toEqual(conDiesel);
  });
});

describe('guardasPreEnvio', () => {
  it('desglose normal de foráneo: enviar', () => {
    expect(guardasPreEnvio(desglose())).toEqual({ decision: 'enviar', motivos: [], detalle: [] });
  });
  it('concepto prohibido («Descuento diésel») → retener con motivo', () => {
    const d = desglose({ deducciones: [...ded, { concepto: 'Descuento diésel', monto: 50 }] });
    const r = guardasPreEnvio(d, { conceptos_prohibidos: ['diesel'] });
    expect(r.decision).toBe('retener');
    expect(r.motivos).toEqual(['concepto_prohibido']);
    expect(r.detalle[0]).toContain('Descuento diésel');
    expect(guardasPreEnvio(d, { conceptos_prohibidos: [/di[eé]sel/i] }).motivos).toEqual(['concepto_prohibido']);
  });
  it('neto −120.00 → retener; con neto_negativo "enviar" → enviar', () => {
    const d = desglose({ neto: -120 });
    expect(netoEnCentavos(d)).toBe(-12000);
    expect(guardasPreEnvio(d, { neto_negativo: 'retener' })).toMatchObject({ decision: 'retener', motivos: ['neto_negativo'] });
    expect(guardasPreEnvio(d, { neto_negativo: 'enviar' }).decision).toBe('enviar');
  });
  it('neto negativo calculado de los renglones cuando la fuente no manda neto', () => {
    const d = desglose({ percepciones: [{ concepto: 'Sueldo', monto: 100 }], deducciones: [{ concepto: 'Retención', monto: 220 }] });
    expect(guardasPreEnvio(d).motivos).toEqual(['neto_negativo']);
  });
  it('permisionario → retener por defecto; local y foráneo pasan; tipo ausente se retiene', () => {
    expect(guardasPreEnvio(desglose({ tipoOperador: 'permisionario' }))).toMatchObject({ decision: 'retener', motivos: ['tipo_sin_regla'] });
    expect(guardasPreEnvio(desglose({ tipoOperador: 'local' })).decision).toBe('enviar');
    const sinTipo = validarDesgloseBitacora({ ...desglose(), tipoOperador: undefined });
    expect(guardasPreEnvio(sinTipo).motivos).toEqual(['tipo_sin_regla']);
  });
  it('política configurable: permisionario habilitado o sin restricción de tipos', () => {
    const d = desglose({ tipoOperador: 'permisionario' });
    expect(guardasPreEnvio(d, { tipos_que_reciben: ['foraneo', 'local', 'permisionario'] }).decision).toBe('enviar');
    expect(guardasPreEnvio(d, { tipos_que_reciben: null }).decision).toBe('enviar');
  });
  it('sin póliza solo retiene si la config lo exige', () => {
    const d = desglose({ poliza: null });
    expect(guardasPreEnvio(d).decision).toBe('enviar');
    expect(guardasPreEnvio(d, { requiere_poliza: true }).motivos).toEqual(['sin_poliza']);
  });
  it('acumula varios motivos', () => {
    const d = desglose({ tipoOperador: 'permisionario', neto: -1 });
    expect(guardasPreEnvio(d).motivos).toEqual(['neto_negativo', 'tipo_sin_regla']);
  });
});

describe('propiedad: Σperc − Σded no cambia (200 combinaciones, semilla fija)', () => {
  function rng(semilla: number) {
    let a = semilla >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const nombres = ['Sueldo', 'Viáticos', 'Taxi', 'Talacha', 'Descuento diésel', 'Reembolso urea', 'Anticipo', 'Bono', 'Movimiento'];
  it('colapsar y renombrar conservan el neto en centavos', () => {
    const r = rng(20261014);
    for (let i = 0; i < 200; i++) {
      const gen = (n: number): RenglonBitacora[] =>
        Array.from({ length: n }, () => ({ concepto: nombres[Math.floor(r() * nombres.length)], monto: Math.round(r() * 1_000_000 + 1) / 100 }));
      const p = gen(1 + Math.floor(r() * 12));
      const d = gen(Math.floor(r() * 10));
      const antes = suma(p) - suma(d);
      const regla: Renombre = { ...RENOMBRE_EJEMPLO, fusionar: r() < 0.5 };
      const p2 = colapsarRenglonViaje(aplicarRenombres(p, [regla]), { activa: r() < 0.8 });
      const d2 = aplicarRenombres(d, [regla]);
      expect(suma(p2) - suma(d2)).toBe(antes);
    }
  });
});


describe('A37-A1-liquidaciones-11: los renombres no distinguen acentos ni la forma Unicode', () => {
  const crudo = [{ concepto: 'DIESEL', monto: 100 }, { concepto: 'Sueldo', monto: 500 }];
  // Así los guarda la pantalla de configuración: texto escapado, flag «i», tal cual lo escribió el contralor.
  const regla = (patron: string): Renombre => ({ patron: new RegExp(patron, 'i'), a: 'Otros' });

  it('«Diésel → Otros» (con acento) renombra «DIESEL» que manda el TMS', () => {
    const r = aplicarRenombres(crudo, [regla('Diésel')]);
    expect(r[0]).toMatchObject({ concepto: 'Otros', monto: 100 });
    expect(r[1]).toMatchObject({ concepto: 'Sueldo' });
  });
  it('y a la inversa: regla sin acento contra concepto con acento', () => {
    expect(aplicarRenombres([{ concepto: 'Diésel premium', monto: 10 }], [regla('diesel')])[0]?.concepto).toBe('Otros');
  });
  it('forma Unicode distinta (é compuesta vs e + acento combinado) también coincide', () => {
    const descompuesto = 'Die\u0301sel';
    expect(aplicarRenombres([{ concepto: descompuesto, monto: 10 }], [regla('Diésel')])[0]?.concepto).toBe('Otros');
    expect(aplicarRenombres([{ concepto: 'Diésel', monto: 10 }], [regla('Die\u0301sel')])[0]?.concepto).toBe('Otros');
  });
  it('no cambia lo que no coincide ni el neto', () => {
    const r = aplicarRenombres([{ concepto: 'Sueldo', monto: 500 }], [regla('Diésel')]);
    expect(r).toEqual([{ concepto: 'Sueldo', monto: 500 }]);
  });
});
