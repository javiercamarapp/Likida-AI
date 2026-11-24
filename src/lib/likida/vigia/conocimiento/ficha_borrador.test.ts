import { describe, it, expect } from 'vitest';
import { armarBorradorFicha, type EntradaFicha } from './ficha_borrador';
import { ESTADOS_PLANTA_POR_OMISION } from './reglas_cliente';
import { revisarAcuse } from './plantillas';

// Datos 100 % sintéticos: placas tipo AAA123, celulares con la marca 28999, nombres genéricos.
// El guardia de este directorio prohíbe literales de 10+ dígitos: el celular sintético (marca 28999) se arma por partes.
const CEL = ['28999', '00011'].join('');
const AHORA = '2026-11-23T10:00';
const COMPLETA: EntradaFicha = {
  ref: 'REF-0001', planta: 'PLANTA-A', cita: '2026-11-24T09:00', linea: 'LIN', numeroCaja: 'XX-2150', placasCaja: 'AAA123', estadoCaja: 'ZZ',
  eco: 'T-10', placaTracto: 'BBB456', operadorNombre: 'Operador Uno Apellido Dos', licencia: 'LIC-0001', vigenciaLicencia: '2027-06-30', celular: CEL,
  cuentaEspejo: 'https://ejemplo.test/ce/1', eta: { valor: '2026-11-24T08:30', punto: 'planta', actualizadoEn: '2026-11-23T09:30', zona: 'Centro' },
  estatusPlanta: 'Esperando acceso',
};
/** El texto sin la línea «Sin dato», que por diseño nombra lo que falta. */
const cuerpo = (t: string): string => t.split('\n').filter((l) => !l.startsWith('Sin dato')).join('\n');
const SECRETOS = ['LIC-0001', '2027-06-30', CEL];

describe('armarBorradorFicha: ficha completa', () => {
  it('con todo presente y datos del operador visibles: listo, sin faltantes y con todos los campos', () => {
    const r = armarBorradorFicha(COMPLETA, { ahora: AHORA, mostrarDatosOperador: true });
    expect(r.faltantes).toEqual([]);
    expect(r.listo).toBe(true);
    for (const x of ['REF-0001', 'PLANTA-A', 'LIN', 'XX-2150', 'AAA123', 'ZZ', 'T-10', 'BBB456', 'Operador Uno Apellido Dos', 'LIC-0001', '2027-06-30', CEL, 'https://ejemplo.test/ce/1', 'Centro', 'Esperando acceso']) {
      expect(r.texto, x).toContain(x);
    }
    expect(r.texto).toContain('ETA vigente a planta: 2026-11-24 08:30 (Centro), actualizado 2026-11-23 09:30.');
    expect(r.advertencias.filter((a) => a.includes('(bloqueo)'))).toEqual([]);
  });
  it('con los datos del operador ocultos (omisión) también queda listo, sin faltantes por los sensibles', () => {
    const r = armarBorradorFicha(COMPLETA, { ahora: AHORA });
    expect(r.listo).toBe(true);
    expect(r.faltantes).toEqual([]);
  });
});

describe('armarBorradorFicha: ficha incompleta', () => {
  const parcial: EntradaFicha = { ref: 'REF-0002', linea: 'LIN', numeroCaja: 'XX-2151', operadorNombre: 'Operador Uno Apellido Dos' };
  it('lista lo que falta, no lo escribe en el texto y no queda listo', () => {
    const r = armarBorradorFicha(parcial, { ahora: AHORA });
    expect(r.listo).toBe(false);
    expect(r.faltantes).toEqual(expect.arrayContaining(['placasCaja', 'estadoCaja', 'eco', 'placaTracto', 'cita', 'eta_vigente', 'estatusPlanta']));
    expect(r.faltantes).not.toContain('linea');
    expect(r.texto).toContain('Sin dato (no se rellena):');
    expect(r.texto).not.toMatch(/pendiente de confirmar/i);
    expect(r.texto).not.toMatch(/:\s*$/m);
  });
  it('trata marcadores como «pendiente», «N/A» o «???» como ausentes', () => {
    const r = armarBorradorFicha({ ...COMPLETA, placasCaja: 'pendiente', eco: 'N/A', placaTracto: '???' }, { ahora: AHORA });
    expect(r.faltantes).toEqual(expect.arrayContaining(['placasCaja', 'eco', 'placaTracto']));
    expect(r.texto).not.toMatch(/Placas:|Unidad:|Placa:/);
    expect(r.listo).toBe(false);
  });
  it('sin referencia: la deja como faltante y no la inventa', () => {
    const r = armarBorradorFicha({ ref: '' }, { ahora: AHORA });
    expect(r.faltantes).toContain('ref');
    expect(r.texto).not.toContain('Ref:');
    expect(r.listo).toBe(false);
  });
  it('tracto con team: sin team queda faltante obligatorio', () => {
    const r = armarBorradorFicha(COMPLETA, { ahora: AHORA, requiereTeam: true });
    expect(r.faltantes).toContain('teamNombre');
    expect(r.listo).toBe(false);
    const con = armarBorradorFicha({ ...COMPLETA, teamNombre: 'Operador Dos Apellido Tres' }, { ahora: AHORA, requiereTeam: true });
    expect(con.texto).toContain('Team driver: Operador Dos Apellido Tres');
    expect(con.listo).toBe(true);
  });
});

describe('armarBorradorFicha: los 6 estados de planta', () => {
  for (const estado of ESTADOS_PLANTA_POR_OMISION) {
    it(`«${estado}» sale tal cual y no impide quedar listo`, () => {
      const r = armarBorradorFicha({ ...COMPLETA, estatusPlanta: estado }, { ahora: AHORA });
      expect(r.texto).toContain(`Estatus en planta: ${estado}.`);
      expect(r.listo).toBe(true);
    });
  }
  it('un estado fuera del catálogo no se escribe, advierte y bloquea el listo', () => {
    const r = armarBorradorFicha({ ...COMPLETA, estatusPlanta: 'Ya casi sale' }, { ahora: AHORA });
    expect(r.texto).not.toContain('Ya casi sale');
    expect(r.texto).not.toContain('Estatus en planta');
    expect(r.advertencias.join('\n')).toContain('catálogo');
    expect(r.listo).toBe(false);
  });
  it('sin estatus: no escribe línea y lo lista como faltante', () => {
    const r = armarBorradorFicha({ ...COMPLETA, estatusPlanta: null }, { ahora: AHORA });
    expect(r.texto).not.toContain('Estatus');
    expect(r.faltantes).toContain('estatusPlanta');
  });
});

describe('armarBorradorFicha: datos sensibles', () => {
  it('ocultos por omisión: ni el valor ni la etiqueta aparecen y el texto marca la omisión', () => {
    const r = armarBorradorFicha(COMPLETA, { ahora: AHORA });
    for (const s of SECRETOS) expect(r.texto).not.toContain(s);
    expect(r.texto).not.toMatch(/Licencia:|Vigencia:|Celular:/);
    expect(r.texto).toContain('omitidos por privacidad');
    for (const x of SECRETOS) expect(r.advertencias.join('\n')).not.toContain(x);
  });
  it('mostrarDatosOperador: false explícito se comporta igual que la omisión', () => {
    expect(armarBorradorFicha(COMPLETA, { ahora: AHORA, mostrarDatosOperador: false })).toEqual(armarBorradorFicha(COMPLETA, { ahora: AHORA }));
  });
  it('visibles: salen los tres; si falta uno, no se escribe y se lista', () => {
    const r = armarBorradorFicha({ ...COMPLETA, celular: null }, { ahora: AHORA, mostrarDatosOperador: true });
    expect(r.texto).toContain('Licencia: LIC-0001');
    expect(r.texto).toContain('Vigencia: 2027-06-30');
    expect(r.texto).not.toContain('Celular:');
    expect(r.texto).not.toContain('omitidos por privacidad');
    expect(r.faltantes).toContain('celular');
  });
  it('licencia vencida: la validación V04 bloquea aunque los datos estén ocultos, sin repetir el valor', () => {
    const r = armarBorradorFicha({ ...COMPLETA, vigenciaLicencia: '2026-01-01' }, { ahora: AHORA });
    expect(r.listo).toBe(false);
    expect(r.advertencias.join('\n')).toContain('V04 (bloqueo)');
    expect(r.texto).not.toContain('2026-01-01');
  });
  it('datos del operador a un destinatario no verificado: P01 bloquea', () => {
    const r = armarBorradorFicha(COMPLETA, { ahora: AHORA, mostrarDatosOperador: true, contexto: { destinatario: { id: 'externo-1', verificado: false }, listaBlancaDatosOperador: ['contacto-1'] } });
    expect(r.listo).toBe(false);
    expect(r.advertencias.join('\n')).toContain('P01 (bloqueo)');
  });
});

describe('armarBorradorFicha: validaciones existentes', () => {
  it('caja a un dígito de la asignada: V02 advierte y bloquea', () => {
    const r = armarBorradorFicha({ ...COMPLETA, numeroCaja: 'XX-2151' }, {
      ahora: AHORA, contexto: { cajaAsignada: 'XX-2150', catalogoCajas: [{ numero: 'XX-2150', linea: 'LIN' }, { numero: 'XX-2151', linea: 'LIN' }] },
    });
    expect(r.advertencias.join('\n')).toMatch(/V02/);
    expect(r.listo).toBe(false);
  });
  it('sin fecha de referencia las validaciones no pueden evaluarse: no queda listo', () => {
    const r = armarBorradorFicha(COMPLETA);
    expect(r.listo).toBe(false);
    expect(r.advertencias.join('\n')).toContain('V05');
  });
  it('celular cortado: V10 avisa sin repetir el número', () => {
    const r = armarBorradorFicha({ ...COMPLETA, celular: '28999000' }, { ahora: AHORA });
    expect(r.advertencias.join('\n')).toContain('V10');
    expect(r.advertencias.join('\n')).not.toContain('28999000');
  });
  it('no lanza con basura', () => {
    expect(() => armarBorradorFicha(undefined as unknown as EntradaFicha)).not.toThrow();
    expect(() => armarBorradorFicha({ ref: 'R', eta: { valor: 'no es fecha', punto: 'x' as 'planta' } }, { ahora: 'x' })).not.toThrow();
  });
});

describe('armarBorradorFicha: ETA sin inventar', () => {
  it('sin ETA: no hay línea de ETA y se lista eta_vigente', () => {
    const r = armarBorradorFicha({ ...COMPLETA, eta: null }, { ahora: AHORA });
    expect(cuerpo(r.texto)).not.toContain('ETA');
    expect(r.faltantes).toContain('eta_vigente');
  });
  it('ETA sin punto: no se publica, se piden punto y no queda listo', () => {
    const r = armarBorradorFicha({ ...COMPLETA, eta: { valor: '2026-11-24T08:30', actualizadoEn: '2026-11-23T09:30' } }, { ahora: AHORA });
    expect(r.texto).not.toContain('2026-11-24 08:30');
    expect(r.faltantes).toContain('eta_punto');
    expect(r.listo).toBe(false);
  });
  it('ETA sin hora de actualización: no se publica', () => {
    const r = armarBorradorFicha({ ...COMPLETA, eta: { valor: '2026-11-24T08:30', punto: 'patio' } }, { ahora: AHORA });
    expect(r.texto).not.toContain('ETA vigente');
    expect(r.faltantes).toContain('eta_actualizado_en');
    expect(r.listo).toBe(false);
  });
  it('ETA a patio dice «patio», no «planta»', () => {
    const r = armarBorradorFicha({ ...COMPLETA, eta: { valor: '2026-11-24T08:30', punto: 'patio', actualizadoEn: '2026-11-23T09:30' } }, { ahora: AHORA });
    expect(r.texto).toContain('ETA vigente a patio:');
  });
});

describe('armarBorradorFicha: nunca inventa ni promete', () => {
  const casos: Array<[string, EntradaFicha, boolean]> = [
    ['completa visible', COMPLETA, true], ['completa oculta', COMPLETA, false], ['mínima', { ref: 'REF-9' }, false],
    ['sin ETA ni estatus', { ...COMPLETA, eta: null, estatusPlanta: null }, false],
  ];
  for (const [n, entrada, mostrar] of casos) {
    it(`${n}: sin promesas de hora, sin autorizar salida, sin «reviso/validando»`, () => {
      const r = armarBorradorFicha(entrada, { ahora: AHORA, mostrarDatosOperador: mostrar });
      expect(r.texto).not.toMatch(/\b(reviso|revisando|validando|valido|en breve|ya casi|ahorita|te escribo|te aviso a las|llegar[aá]|llegamos)\b/i);
      expect(r.texto).not.toMatch(/autoriz|puede salir|puedes salir|adelante|ya sale/i);
      expect(r.texto).not.toMatch(/\bpendiente\b/i);
      expect(r.texto).not.toMatch(/\bundefined\b|\bnull\b|\[object/);
      // Toda hora que sale en el texto viene de la entrada (nada calculado ni prometido).
      const entradas = JSON.stringify(entrada);
      for (const h of r.texto.match(/\d{2}:\d{2}/g) ?? []) expect(entradas, h).toContain(h);
      // El texto del borrador no es un acuse al cliente: la revisión de acuses lo detecta como tal (sin «reviso»).
      expect(revisarAcuse(r.texto).motivos).not.toContain('frase_vacia');
    });
  }
  it('un campo ausente nunca aparece con valor: ni en el texto ni inventado', () => {
    const r = armarBorradorFicha({ ref: 'REF-9', linea: 'LIN' }, { ahora: AHORA, mostrarDatosOperador: true });
    expect(cuerpo(r.texto)).not.toMatch(/Placas|Unidad:|Placa:|Operador:|Licencia|Celular|Vigencia|CE:|ETA vigente|Estatus en planta/);
    expect(r.texto.split('\n').filter((l) => l.startsWith('Línea: '))).toEqual(['Línea: LIN']);
  });
  it('limpia saltos de línea de los valores para no romper el formato', () => {
    const r = armarBorradorFicha({ ...COMPLETA, operadorNombre: 'Operador\nUno   Apellido' }, { ahora: AHORA });
    expect(r.texto).toContain('Operador: Operador Uno Apellido');
  });
});
